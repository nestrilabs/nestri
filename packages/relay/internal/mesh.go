package internal

import (
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"github.com/gorilla/websocket"
	"github.com/oklog/ulid/v2"
	"github.com/pion/webrtc/v4"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"io"
	"log/slog"
	"relay/internal/common"
	"relay/internal/connections"
	gen "relay/internal/proto"
	"time"
)

// PeerRelayData holds information about a peer relay
type PeerRelayData struct {
	WebSocket     *connections.SafeWebSocket
	SharedSecret  []byte
	PublicKey     *ecdsa.PublicKey
	LastHeartbeat time.Time
	SuspectCount  int
	LastSequence  uint64
}

// MeshManager manages the mesh network and gossip protocol
type MeshManager struct {
	relay           *Relay // This relay's instance
	peerRelays      *common.SafeMap[ulid.ULID, *PeerRelayData]
	relayPCs        *common.SafeMap[string, *webrtc.PeerConnection]
	relayDCs        *common.SafeMap[string, *connections.NestriDataChannel]
	State           *common.MeshState
	relayPrivateKey *ecdsa.PrivateKey                                              // For signing approvals
	lastSequence    uint64                                                         // Last sent sequence number
	pendingAcks     *common.SafeMap[uint64, *common.SafeMap[ulid.ULID, time.Time]] // Sequence -> [RelayID -> sent time]
}

// NewMeshManager initializes a MeshManager with a sync interval
func NewMeshManager(relay *Relay) *MeshManager {
	m := &MeshManager{
		relay:        relay,
		peerRelays:   common.NewSafeMap[ulid.ULID, *PeerRelayData](),
		relayPCs:     common.NewSafeMap[string, *webrtc.PeerConnection](),
		relayDCs:     common.NewSafeMap[string, *connections.NestriDataChannel](),
		State:        common.NewMeshState(),
		lastSequence: 0,
		pendingAcks:  common.NewSafeMap[uint64, *common.SafeMap[ulid.ULID, time.Time]](),
	}

	privKey, err := common.GenerateECDHKeyPair()
	if err != nil {
		slog.Error("Failed to generate relay private key", "err", err)
		return nil
	}
	m.relayPrivateKey = privKey

	m.State.SetOnRoomActiveChange(func(roomName string, active bool) {
		room := m.relay.GetRoomByName(roomName)
		if active {
			if room == nil {
				room = m.relay.GetOrCreateRoom(roomName)
				slog.Debug("Room active remotely, created locally", "roomName", roomName)
			}
			if !room.Online && m.peerRelays.Len() > 0 {
				slog.Debug("Room active remotely and peers available, requesting stream", "roomName", roomName)
				if err := m.broadcastStreamRequest(roomName); err != nil {
					slog.Error("Failed to broadcast stream request", "roomName", roomName, "err", err)
				}
			}
		} else if room != nil {
			room.Online = false
			room.signalParticipantsOffline()
			m.relay.DeleteRoomIfEmpty(room)
		}
	})

	// Start heartbeat and retransmission routines
	go m.runHeartbeat()
	go m.monitorHeartbeats()
	go m.handleRetransmissions()

	return m
}

// setWebSocket assigns a WebSocket connection to the MeshManager's map
func (m *MeshManager) setWebSocket(relayID ulid.ULID, ws *connections.SafeWebSocket) {
	if existing, exists := m.peerRelays.Get(relayID); exists {
		existing.WebSocket = ws
		m.peerRelays.Set(relayID, existing)
	} else {
		m.peerRelays.Set(relayID, &PeerRelayData{
			WebSocket:     ws,
			LastHeartbeat: time.Now(),
			SuspectCount:  0,
			LastSequence:  0,
		})
	}
	slog.Debug("WebSocket assigned to relay", "relayID", relayID)
}

// getPeerConnectionForRoom retrieves the PeerConnection for a given room
func (m *MeshManager) getPeerConnectionForRoom(roomName string) (*webrtc.PeerConnection, bool) {
	pc, exists := m.relayPCs.Get(roomName)
	return pc, exists
}

// getDataChannelForRoom retrieves the DataChannel for a given room
func (m *MeshManager) getDataChannelForRoom(roomName string) (*connections.NestriDataChannel, bool) {
	dc, exists := m.relayDCs.Get(roomName)
	return dc, exists
}

// broadcastStateUpdate sends StateUpdate to all relays
func (m *MeshManager) broadcastStateUpdate() error {
	m.lastSequence++
	seq := m.lastSequence
	entities := m.State.SerializeEntities()
	msg := &gen.MeshMessage{
		Type: &gen.MeshMessage_StateUpdate{
			StateUpdate: &gen.StateUpdate{
				SequenceNumber: seq,
				Entities:       entities,
			},
		},
	}
	data, err := proto.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal StateUpdate: %w", err)
	}
	now := time.Now()
	relayMap := common.NewSafeMap[ulid.ULID, time.Time]()
	for relayID := range m.peerRelays.Copy() {
		relayMap.Set(relayID, now)
	}
	m.pendingAcks.Set(seq, relayMap)
	for relayID, pr := range m.peerRelays.Copy() {
		if err := pr.WebSocket.SendBinary(data); err != nil {
			slog.Error("Failed to send StateUpdate", "relayID", relayID, "seq", seq, "err", err)
			if err := m.removeRelay(relayID); err != nil {
				slog.Error("Failed to remove relay after StateUpdate send failure", "relayID", relayID, "err", err)
			}
			relayMap.Delete(relayID)
		}
	}
	return nil
}

// sendAck sends an Ack message
func (m *MeshManager) sendAck(relayID ulid.ULID, seq uint64) error {
	msg := &gen.MeshMessage{
		Type: &gen.MeshMessage_Ack{
			Ack: &gen.Ack{
				RelayId:        m.relay.ID.String(),
				SequenceNumber: seq,
			},
		},
	}
	data, err := proto.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal Ack: %w", err)
	}
	if pr, exists := m.peerRelays.Get(relayID); exists {
		if err := pr.WebSocket.SendBinary(data); err != nil {
			slog.Error("Failed to send Ack", "relayID", relayID, "err", err)
			if err := m.removeRelay(relayID); err != nil {
				slog.Error("Failed to remove relay after Ack send failure", "relayID", relayID, "err", err)
			}
		}
	}
	return nil
}

// runHeartbeat sends periodic heartbeats
func (m *MeshManager) runHeartbeat() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		msg := &gen.MeshMessage{
			Type: &gen.MeshMessage_Heartbeat{
				Heartbeat: &gen.Heartbeat{
					RelayId:   m.relay.ID.String(),
					Timestamp: timestamppb.New(time.Now()),
				},
			},
		}
		data, err := proto.Marshal(msg)
		if err != nil {
			slog.Error("Failed to marshal Heartbeat", "err", err)
			continue
		}
		for relayID, pr := range m.peerRelays.Copy() {
			if err := pr.WebSocket.SendBinary(data); err != nil {
				slog.Error("Failed to send Heartbeat", "relayID", relayID, "err", err)
				if err := m.removeRelay(relayID); err != nil {
					slog.Error("Failed to remove relay after Heartbeat send failure", "relayID", relayID, "err", err)
				}
			}
		}
	}
}

// monitorHeartbeats checks for non-responding relays
func (m *MeshManager) monitorHeartbeats() {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		now := time.Now()
		for relayID, pr := range m.peerRelays.Copy() {
			if now.Sub(pr.LastHeartbeat) > 15*time.Second {
				pr.SuspectCount++
				m.peerRelays.Set(relayID, pr)
				slog.Info("Relay suspected due to a missing heartbeat", "relayID", relayID, "suspectCount", pr.SuspectCount)
				// If more than half of the relays suspect this one, disconnect it
				if pr.SuspectCount >= m.peerRelays.Len()/2+1 {
					if err := m.broadcastDisconnect(relayID); err != nil {
						slog.Error("Failed to broadcast disconnect message", "relayID", relayID, "err", err)
					}
					if err := m.removeRelay(relayID); err != nil {
						slog.Error("Failed to remove relay after heartbeat-suspect disconnect", "relayID", relayID, "err", err)
					} else {
						slog.Info("Relay disconnected due to heartbeat failure", "relayID", relayID)
					}
				} else {
					if err := m.broadcastSuspect(relayID); err != nil {
						slog.Error("Failed to broadcast suspect message", "relayID", relayID, "err", err)
					}
				}
			}
		}
	}
}

// broadcastSuspect notifies others of a suspected relay
func (m *MeshManager) broadcastSuspect(suspectRelayID ulid.ULID) error {
	msg := &gen.MeshMessage{
		Type: &gen.MeshMessage_SuspectRelay{
			SuspectRelay: &gen.SuspectRelay{
				RelayId: suspectRelayID.String(),
				Reason:  "no heartbeat",
			},
		},
	}
	data, err := proto.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal SuspectRelay: %w", err)
	}
	for relayID, pr := range m.peerRelays.Copy() {
		if err := pr.WebSocket.SendBinary(data); err != nil {
			slog.Error("Failed to send SuspectRelay", "relayID", relayID, "err", err)
			if err := m.removeRelay(relayID); err != nil {
				slog.Error("Failed to remove relay after SuspectRelay send failure", "relayID", relayID, "err", err)
			}
		}
	}
	return nil
}

// broadcastDisconnect notifies others to disconnect a relay
func (m *MeshManager) broadcastDisconnect(disconnectRelayID ulid.ULID) error {
	msg := &gen.MeshMessage{
		Type: &gen.MeshMessage_Disconnect{
			Disconnect: &gen.Disconnect{
				RelayId: disconnectRelayID.String(),
				Reason:  "unresponsive",
			},
		},
	}
	data, err := proto.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal Disconnect: %w", err)
	}
	for relayID, pr := range m.peerRelays.Copy() {
		if err := pr.WebSocket.SendBinary(data); err != nil {
			slog.Error("Failed to send Disconnect", "relayID", relayID, "err", err)
			if err := m.removeRelay(relayID); err != nil {
				slog.Error("Failed to remove relay after Disconnect send failure", "relayID", relayID, "err", err)
			}
		}
	}
	return nil
}

// handleRetransmissions resends unacknowledged messages
func (m *MeshManager) handleRetransmissions() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		now := time.Now()
		for seq, relayMap := range m.pendingAcks.Copy() {
			for relayID, sentTime := range relayMap.Copy() {
				if now.Sub(sentTime) > 10*time.Second {
					msg := &gen.MeshMessage{
						Type: &gen.MeshMessage_StateUpdate{
							StateUpdate: &gen.StateUpdate{
								SequenceNumber: seq,
								Entities:       m.State.SerializeEntities(),
							},
						},
					}
					data, err := proto.Marshal(msg)
					if err != nil {
						slog.Error("Failed to marshal retransmission", "seq", seq, "err", err)
						continue
					}
					if pr, exists := m.peerRelays.Get(relayID); exists {
						if err := pr.WebSocket.SendBinary(data); err != nil {
							slog.Error("Failed to retransmit", "relayID", relayID, "seq", seq, "err", err)
							if err := m.removeRelay(relayID); err != nil {
								slog.Error("Failed to remove relay after retransmission failure", "relayID", relayID, "err", err)
							}
							relayMap.Delete(relayID)
						} else {
							relayMap.Set(relayID, now)
						}
					} else {
						relayMap.Delete(relayID)
					}
				}
			}
			if relayMap.Len() == 0 {
				m.pendingAcks.Delete(seq)
			}
		}
	}
}

// removeRelay cleans up a relay’s resources immediately
func (m *MeshManager) removeRelay(relayID ulid.ULID) error {
	if _, exists := m.peerRelays.Get(relayID); exists {
		m.peerRelays.Delete(relayID)
		slog.Info("Relay removed from local mesh state", "relayID", relayID)
		for roomName, entity := range m.State.GetEntities().Copy() {
			if entity.OwnerRelayId == relayID.String() && entity.Active {
				m.State.DeleteRoom(roomName)
			}
		}
		return m.broadcastStateUpdate()
	}
	return nil
}

func (m *MeshManager) handleForwardedSDP(relayWS *connections.SafeWebSocket, fwd *gen.ForwardSDP) error {
	sdp := webrtc.SessionDescription{
		Type: webrtc.NewSDPType(fwd.Type),
		SDP:  fwd.Sdp,
	}
	if len(fwd.ParticipantId) > 0 {
		return m.handleForwardedSDPParticipant(relayWS, fwd.ParticipantId, sdp)
	} else if len(fwd.RoomName) > 0 {
		// Check if offer or answer
		if sdp.Type == webrtc.SDPTypeOffer {
			return m.handleForwardedSDPRoomOffer(relayWS, fwd.RoomName, sdp)
		} else if sdp.Type == webrtc.SDPTypeAnswer {
			return m.handleForwardedSDPRoomAnswer(relayWS, fwd.RoomName, sdp)
		} else {
			return fmt.Errorf("invalid SDP type: %s", sdp.Type.String())
		}
	} else {
		return fmt.Errorf("invalid forwarded SDP message: neither room nor participant ID provided")
	}
}

func (m *MeshManager) handleForwardedSDPRoomOffer(relayWS *connections.SafeWebSocket, roomName string, sdp webrtc.SessionDescription) error {
	room := m.relay.GetOrCreateRoom(roomName)
	relay := GetRelay()

	// Create PeerConnection
	pc, err := common.CreatePeerConnection(func() {
		slog.Debug("Closed PeerConnection of relay stream", "roomName", roomName, "relayID", m.relay.ID)
		m.relayPCs.Delete(roomName)
		if dc, exists := m.relayDCs.Get(roomName); exists {
			_ = dc.Close()
			m.relayDCs.Delete(roomName)
		}
	})
	if err != nil {
		return err
	}

	// Handle incoming tracks
	pc.OnTrack(func(remoteTrack *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		localTrack, err := webrtc.NewTrackLocalStaticRTP(remoteTrack.Codec().RTPCodecCapability, remoteTrack.ID(), fmt.Sprintf("relay-%s", roomName))
		if err != nil {
			slog.Error("Failed to create local track for relayed stream", "roomName", roomName, "err", err)
			return
		}
		if remoteTrack.Kind() == webrtc.RTPCodecTypeAudio {
			room.SetTrack(webrtc.RTPCodecTypeAudio, localTrack)
		} else if remoteTrack.Kind() == webrtc.RTPCodecTypeVideo {
			room.SetTrack(webrtc.RTPCodecTypeVideo, localTrack)
		}

		slog.Debug("Started relaying track to local room", "roomName", roomName, "kind", remoteTrack.Kind())

		// Relay RTP packets to the local track
		rtpBuffer := make([]byte, 1400)
		for {
			read, _, err := remoteTrack.Read(rtpBuffer)
			if err != nil {
				if !errors.Is(err, io.EOF) {
					slog.Error("Failed to read RTP from remote track for room", "room", room.Name, "err", err)
				}
				break
			}
			_, err = localTrack.Write(rtpBuffer[:read])
			if err != nil && !errors.Is(err, io.ErrClosedPipe) {
				slog.Error("Failed to write RTP to local track for room", "room", room.Name, "err", err)
				break
			}
		}

		slog.Debug("Stopped relaying track to local room", "roomName", roomName, "kind", remoteTrack.Kind())
	})

	// Handle added DataChannels
	pc.OnDataChannel(func(dc *webrtc.DataChannel) {
		slog.Debug("Received mesh DataChannel connection", "roomName", roomName, "label", dc.Label())
		relayDC := connections.NewNestriDataChannel(dc)

		relayDC.OnOpen(func() {
			slog.Debug("Mesh DataChannel opened on receiving side", "roomName", roomName)
			// Store the DataChannel
			relay.MeshManager.relayDCs.Set(roomName, relayDC)

			// Update existing participants to forward to mesh
			room.ParticipantsMutex.RLock()
			for _, participant := range room.Participants {
				if participant.DataChannel != nil {
					participant.DataChannel.RegisterMessageCallback("input", func(data []byte) {
						ForwardParticipantDataChannelMessage(participant, room, data)
					})
				}
			}
			room.ParticipantsMutex.RUnlock()
		})

		relayDC.OnClose(func() {
			slog.Debug("Mesh DataChannel closed on receiving side", "roomName", roomName)
			relay.MeshManager.relayDCs.Delete(roomName)
		})

		// TODO: Handle Mesh -> Local relay DataChannel messages?
	})

	// Handle ICE candidates
	pc.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		err := relayWS.SendMeshForwardICE(roomName, "", candidate.ToJSON())
		if err != nil {
			slog.Error("Failed to send ICE candidate to relay", "roomName", roomName, "err", err)
		}
	})

	// Set remote description and create answer
	if err := pc.SetRemoteDescription(sdp); err != nil {
		_ = pc.Close()
		return err
	}
	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		_ = pc.Close()
		return err
	}
	if err := pc.SetLocalDescription(answer); err != nil {
		_ = pc.Close()
		return err
	}

	// Send answer back to Relay 1
	err = relayWS.SendMeshForwardSDP(roomName, "", answer)
	if err != nil {
		_ = pc.Close()
		return err
	}

	// Store the PeerConnection
	relay.MeshManager.relayPCs.Set(roomName, pc)

	return nil
}

func (m *MeshManager) handleForwardedSDPRoomAnswer(_ *connections.SafeWebSocket, roomName string, sdp webrtc.SessionDescription) error {
	relay := GetRelay()
	pc, exists := relay.MeshManager.relayPCs.Get(roomName)
	if !exists || pc.ConnectionState() == webrtc.PeerConnectionStateClosed {
		return fmt.Errorf("PeerConnection not found or is closed for room: %s", roomName)
	}

	if err := pc.SetRemoteDescription(sdp); err != nil {
		_ = pc.Close()
		return err
	}
	slog.Debug("Completed relay-to-relay PeerConnection setup", "roomName", roomName)

	return nil
}

func (m *MeshManager) handleForwardedSDPParticipant(relayWS *connections.SafeWebSocket, partID string, sdp webrtc.SessionDescription) error {
	participantID, err := ulid.Parse(partID)
	if err != nil {
		return err
	}

	// Check if participant exists
	participant := m.relay.GetParticipantByID(participantID)
	if participant == nil {
		return fmt.Errorf("participant not found: %s", participantID)
	}

	// Set remote SDP and generate an answer
	err = participant.PeerConnection.SetRemoteDescription(sdp)
	if err != nil {
		return err
	}

	answer, err := participant.PeerConnection.CreateAnswer(nil)
	if err != nil {
		return err
	}

	err = participant.PeerConnection.SetLocalDescription(answer)
	if err != nil {
		return err
	}

	// Send the answer back to the originating relay
	err = relayWS.SendMeshForwardSDP("", partID, answer)
	if err != nil {
		return err
	}
	return nil
}

func (m *MeshManager) handleForwardedICE(relayWS *connections.SafeWebSocket, fwd *gen.ForwardICE) error {
	if len(fwd.ParticipantId) > 0 {
		return m.handleForwardedICEParticipant(relayWS, fwd)
	} else if len(fwd.RoomName) > 0 {
		return m.handleForwardedICERoom(relayWS, fwd)
	} else {
		return fmt.Errorf("invalid forwarded ICE message: neither room nor participant ID provided")
	}
}

func (m *MeshManager) handleForwardedICEParticipant(_ *connections.SafeWebSocket, fwd *gen.ForwardICE) error {
	participantID, err := ulid.Parse(fwd.ParticipantId)
	if err != nil {
		return err
	}

	participant := m.relay.GetParticipantByID(participantID)
	if participant == nil {
		return fmt.Errorf("participant not found: %s", participantID)
	}

	var sdpMLineIndex uint16
	if fwd.Candidate.SdpMLineIndex != nil {
		sdpMLineIndex = uint16(*fwd.Candidate.SdpMLineIndex)
	}
	err = participant.PeerConnection.AddICECandidate(webrtc.ICECandidateInit{
		Candidate:        fwd.Candidate.Candidate,
		SDPMid:           fwd.Candidate.SdpMid,
		SDPMLineIndex:    &sdpMLineIndex,
		UsernameFragment: fwd.Candidate.UsernameFragment,
	})
	if err != nil {
		return fmt.Errorf("failed to add ICE candidate: %w", err)
	}
	return nil
}

func (m *MeshManager) handleForwardedICERoom(_ *connections.SafeWebSocket, fwd *gen.ForwardICE) error {
	relay := GetRelay()
	pc, exists := relay.MeshManager.relayPCs.Get(fwd.RoomName)
	if !exists || pc.ConnectionState() == webrtc.PeerConnectionStateClosed {
		return fmt.Errorf("PeerConnection not found or is closed for room: %s", fwd.RoomName)
	}

	var sdpMLineIndex uint16
	if fwd.Candidate.SdpMLineIndex != nil {
		sdpMLineIndex = uint16(*fwd.Candidate.SdpMLineIndex)
	}
	if err := pc.AddICECandidate(webrtc.ICECandidateInit{
		Candidate:        fwd.Candidate.Candidate,
		SDPMid:           fwd.Candidate.SdpMid,
		SDPMLineIndex:    &sdpMLineIndex,
		UsernameFragment: fwd.Candidate.UsernameFragment,
	}); err != nil {
		return fmt.Errorf("failed to add ICE candidate: %w", err)
	}
	return nil
}

func (m *MeshManager) handleForwardedIngest(relayWS *connections.SafeWebSocket, fwd *gen.ForwardIngest) error {
	// Get or create the room
	room := m.relay.GetOrCreateRoom(fwd.RoomName)

	// Check if room is already being ingested
	if room.Online {
		if err := relayWS.SendAnswerMessageWS(connections.AnswerInUse); err != nil {
			slog.Error("Failed to send InUse answer for forwarded ingest",
				"room", room.Name,
				"err", err)
		}
		return nil
	}

	// Assign the WebSocket from the original relay and handle ingest
	room.AssignWebSocket(relayWS)
	go IngestHandler(room)

	return nil
}

func (m *MeshManager) ConnectToRelay(relayAddress string) error {
	slog.Info("Attempting to connect to relay", "address", relayAddress)

	// Generate ECDH key pair for this connection
	privKey, err := common.GenerateECDHKeyPair()
	if err != nil {
		return fmt.Errorf("failed to generate ECDH key pair: %w", err)
	}
	pubKey := common.GetPublicKeyBytes(&privKey.PublicKey)

	wsURL := fmt.Sprintf("wss://%s/api/mesh", relayAddress)
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		return fmt.Errorf("failed to connect to relay: %w", err)
	}

	safeWS := connections.NewSafeWebSocket(conn)

	// Wait for binary message of handshake response
	safeWS.RegisterBinaryMessageCallback(func(data []byte) {
		var msg gen.MeshMessage
		if err := proto.Unmarshal(data, &msg); err != nil {
			slog.Error("Failed to unmarshal MeshMessage", "err", err)
			return
		}

		switch t := msg.Type.(type) {
		case *gen.MeshMessage_HandshakeResponse:
			if err := m.handleHandshakeResponse(safeWS, t.HandshakeResponse); err != nil {
				slog.Error("Failed to handle handshake response", "err", err)
				return
			} else {
				slog.Info("Handshake response processed successfully", "relayAddress", relayAddress)
			}
		default:
			slog.Error("Unknown message type in handshake response", "type", t)
			return
		}
	})

	// Send handshake message
	slog.Debug("Sending mesh handshake to relay", "address", relayAddress)
	if err = safeWS.SendMeshHandshake(m.relay.ID.String(), pubKey); err != nil {
		_ = conn.Close()
		return fmt.Errorf("failed to send handshake: %w", err)
	}

	return nil
}

// handleStateUpdate processes incoming state updates
func (m *MeshManager) handleStateUpdate(sourceRelayID ulid.ULID, su *gen.StateUpdate) error {
	if pr, exists := m.peerRelays.Get(sourceRelayID); exists && su.SequenceNumber <= pr.LastSequence {
		return nil // Duplicate or old message
	}
	if err := m.peerRelays.Update(sourceRelayID, "LastSequence", su.SequenceNumber); err != nil {
		return fmt.Errorf("failed to update last sequence: relayID: %s, seq: %d, err: %w", sourceRelayID, su.SequenceNumber, err)
	}
	for roomName, entity := range su.Entities {
		if entity.Active {
			m.State.AddRoom(roomName, sourceRelayID)
		} else {
			m.State.DeleteRoom(roomName)
		}
	}
	return m.sendAck(sourceRelayID, su.SequenceNumber)
}

// handleAck processes incoming ACKs
func (m *MeshManager) handleAck(ack *gen.Ack) error {
	relayID, err := ulid.Parse(ack.RelayId)
	if err != nil {
		return fmt.Errorf("invalid relay ID in Ack: relayID: %s, seq: %d, err: %w", ack.RelayId, ack.SequenceNumber, err)
	}
	if relayMap, exists := m.pendingAcks.Get(ack.SequenceNumber); exists {
		relayMap.Delete(relayID)
		if relayMap.Len() == 0 {
			m.pendingAcks.Delete(ack.SequenceNumber)
		}
	}
	return nil
}

// handleHeartbeat updates heartbeat tracking
func (m *MeshManager) handleHeartbeat(hb *gen.Heartbeat) error {
	relayID, _ := ulid.Parse(hb.RelayId)
	if err := m.peerRelays.Update(relayID, "LastHeartbeat", time.Now()); err != nil {
		return fmt.Errorf("failed to update last heartbeat: relayID: %s, err: %w", relayID, err)
	}
	if err := m.peerRelays.Update(relayID, "SuspectCount", 0); err != nil {
		return fmt.Errorf("failed to reset suspect count: relayID: %s, err: %w", relayID, err)
	}
	return nil
}

// handleSuspectRelay increments suspect count
func (m *MeshManager) handleSuspectRelay(sr *gen.SuspectRelay) error {
	relayID, _ := ulid.Parse(sr.RelayId)
	pr, exists := m.peerRelays.Get(relayID)
	if exists {
		pr.SuspectCount++
		m.peerRelays.Set(relayID, pr)
		if pr.SuspectCount >= m.peerRelays.Len()/2+1 {
			if err := m.removeRelay(relayID); err != nil {
				return err
			}
		}
	}
	return nil
}

// handleDisconnect removes a relay
func (m *MeshManager) handleDisconnect(dc *gen.Disconnect) error {
	relayID, _ := ulid.Parse(dc.RelayId)
	return m.removeRelay(relayID)
}

func (m *MeshManager) decodeState(encodedState string, sharedSecret []byte) ([]byte, error) {
	if sharedSecret != nil {
		return common.DecryptMessage(string(sharedSecret), encodedState)
	}
	return base64.StdEncoding.DecodeString(encodedState)
}

func (m *MeshManager) requestApprovals(peerRelayID ulid.ULID) (map[string]string, error) {
	approvals := make(map[string]string)
	for relayID := range m.peerRelays.Copy() {
		sig, err := m.signApproval(peerRelayID)
		if err == nil {
			approvals[relayID.String()] = base64.StdEncoding.EncodeToString(sig)
		}
	}
	return approvals, nil
}

func (m *MeshManager) signApproval(peerRelayID ulid.ULID) ([]byte, error) {
	hash := sha256.Sum256([]byte(peerRelayID.String()))
	return ecdsa.SignASN1(rand.Reader, m.relayPrivateKey, hash[:])
}

func (m *MeshManager) verifyApprovals(approvals map[string]string, peerRelayID ulid.ULID) bool {
	relayCount := m.peerRelays.Len()

	// If the mesh is new, allow the relay to join without further approvals
	if relayCount <= 1 {
		slog.Debug("Allowing relay to join empty mesh", "peerRelayID", peerRelayID)
		return true
	}

	// 80% of relays must approve
	requiredApprovals := relayCount * 80 / 100
	if requiredApprovals == 0 { // Ensure at least 1 approval if relayCount > 0
		requiredApprovals = 1
	}
	if len(approvals) < requiredApprovals {
		slog.Debug("Not enough approvals", "required", requiredApprovals, "received", len(approvals))
		return false
	}

	validCount := 0
	for relayIDStr, sig := range approvals {
		relayID, err := ulid.Parse(relayIDStr)
		if err != nil {
			continue
		}
		pr, exists := m.peerRelays.Get(relayID)
		if !exists {
			continue
		}
		sigBytes, err := base64.StdEncoding.DecodeString(sig)
		if err != nil {
			continue
		}
		hash := sha256.Sum256([]byte(peerRelayID.String()))
		if ecdsa.VerifyASN1(pr.PublicKey, hash[:], sigBytes) {
			validCount++
			if validCount >= requiredApprovals {
				return true
			}
		}
	}

	slog.Debug("Not enough valid approvals", "required", requiredApprovals, "valid", validCount)
	return false
}

func (m *MeshManager) handleHandshakeResponse(safeWS *connections.SafeWebSocket, msg *gen.HandshakeResponse) error {
	peerRelayID, err := ulid.Parse(msg.RelayId)
	if err != nil {
		return fmt.Errorf("invalid relay ID in handshake: %w", err)
	}

	peerPubKey, err := common.ParsePublicKey(msg.DhPublicKey)
	if err != nil {
		return fmt.Errorf("failed to parse public key: %w", err)
	}

	privKey, err := common.GenerateECDHKeyPair()
	if err != nil {
		return fmt.Errorf("failed to generate ECDH key pair: %w", err)
	}

	sharedSecret, err := common.ComputeSharedSecret(privKey, peerPubKey)
	if err != nil {
		return fmt.Errorf("failed to compute shared secret: %w", err)
	}

	if !m.verifyApprovals(msg.Approvals, peerRelayID) {
		return fmt.Errorf("not enough approvals to connect to relay: %s, approvals: %d", peerRelayID, len(msg.Approvals))
	}

	m.peerRelays.Set(peerRelayID, &PeerRelayData{
		WebSocket:     safeWS,
		SharedSecret:  sharedSecret,
		PublicKey:     peerPubKey,
		LastHeartbeat: time.Now(),
		SuspectCount:  0,
		LastSequence:  0,
	})
	safeWS.SetSharedSecret(sharedSecret)

	slog.Info("Successfully connected to relay", "peerRelayID", peerRelayID)

	// Set new binary message callback to handle all incoming messages
	safeWS.RegisterBinaryMessageCallback(func(data []byte) {
		if err := m.handleBinaryMessage(safeWS, data, peerRelayID); err != nil {
			slog.Error("Failed to handle binary message", "err", err)
			return
		}
	})

	return nil
}

// handleHandshake processes the initial handshake
func (m *MeshManager) handleHandshake(safeWS *connections.SafeWebSocket, msg *gen.Handshake) error {
	peerRelayID, err := ulid.Parse(msg.RelayId)
	if err != nil {
		return fmt.Errorf("invalid relay ID in handshake: %w", err)
	}

	peerPubKey, err := common.ParsePublicKey(msg.DhPublicKey)
	if err != nil {
		return fmt.Errorf("failed to parse public key: %w", err)
	}

	privKey, err := common.GenerateECDHKeyPair()
	if err != nil {
		return fmt.Errorf("failed to generate ECDH key pair: %w", err)
	}
	pubKey := common.GetPublicKeyBytes(&privKey.PublicKey)

	sharedSecret, err := common.ComputeSharedSecret(privKey, peerPubKey)
	if err != nil {
		return fmt.Errorf("failed to compute shared secret: %w", err)
	}

	approvals, err := m.requestApprovals(peerRelayID)
	if err != nil {
		return fmt.Errorf("failed to request approvals: %w", err)
	}

	if err := safeWS.SendMeshHandshakeResponse(m.relay.ID.String(), pubKey, approvals); err != nil {
		return fmt.Errorf("failed to send handshake response: %w", err)
	}

	m.peerRelays.Set(peerRelayID, &PeerRelayData{
		WebSocket:     safeWS,
		SharedSecret:  sharedSecret,
		PublicKey:     peerPubKey,
		LastHeartbeat: time.Now(),
		SuspectCount:  0,
		LastSequence:  0,
	})
	safeWS.SetSharedSecret(sharedSecret)

	slog.Info("Accepted mesh connection", "peerRelayID", peerRelayID)

	// After accepting the connection, request streams for active rooms not online locally
	for roomName, entity := range m.State.GetEntities().Copy() {
		if entity.Active {
			room := m.relay.GetRoomByName(roomName)
			if room == nil {
				room = m.relay.GetOrCreateRoom(roomName)
			}
			if !room.Online {
				slog.Debug("New peer connected, requesting stream for active room", "roomName", roomName, "peerRelayID", peerRelayID)
				if err := m.broadcastStreamRequest(roomName); err != nil {
					slog.Error("Failed to broadcast stream request", "roomName", roomName, "peerRelayID", peerRelayID, "err", err)
				}
			}
		}
	}

	return m.setupMeshWebSocket(safeWS, peerRelayID)
}

func (m *MeshManager) handleStreamRequest(relayWS *connections.SafeWebSocket, fwd *gen.StreamRequest) error {
	room := m.relay.GetRoomByName(fwd.RoomName)
	if room == nil || !room.Online {
		slog.Debug("Stream request for non-existent or offline room", "roomName", fwd.RoomName)
		return nil
	}

	// Check if we already have a PeerConnection for this room
	if pc, exists := m.relayPCs.Get(fwd.RoomName); exists && pc.ConnectionState() != webrtc.PeerConnectionStateClosed {
		return fmt.Errorf("PeerConnection already exists for room: %s", fwd.RoomName)
	}

	// Create a new PeerConnection
	pc, err := common.CreatePeerConnection(func() {
		slog.Debug("Closed PeerConnection of stream request", "roomName", fwd.RoomName, "relayID", m.relay.ID)
		m.relayPCs.Delete(fwd.RoomName)
		if dc, exists := m.relayDCs.Get(fwd.RoomName); exists {
			_ = dc.Close()
			m.relayDCs.Delete(fwd.RoomName)
		}
	})
	if err != nil {
		return err
	}

	// Add tracks to the PeerConnection
	if room.AudioTrack != nil {
		if _, err := pc.AddTrack(room.AudioTrack); err != nil {
			_ = pc.Close()
			return fmt.Errorf("failed to add audio track to relay PeerConnection: %w", err)
		}
	}
	if room.VideoTrack != nil {
		if _, err := pc.AddTrack(room.VideoTrack); err != nil {
			_ = pc.Close()
			return fmt.Errorf("failed to add video track to relay PeerConnection: %w", err)
		}
	}

	// Add DataChannel for message forwarding
	settingOrdered := true
	settingMaxRetransmits := uint16(0)
	dc, err := pc.CreateDataChannel(fmt.Sprintf("relay-data-%s", fwd.RoomName), &webrtc.DataChannelInit{
		Ordered:        &settingOrdered,
		MaxRetransmits: &settingMaxRetransmits,
	})
	if err != nil {
		_ = pc.Close()
		return fmt.Errorf("failed to create DataChannel for relay PeerConnection: roomName: %s, err: %w", fwd.RoomName, err)
	}

	dc.OnOpen(func() {
		slog.Debug("Relay-to-relay DataChannel opened", "roomName", fwd.RoomName)
	})

	dc.OnMessage(func(dcMsg webrtc.DataChannelMessage) {
		// Forward messages from the mesh to the ingress
		if room.DataChannel != nil {
			if err := room.DataChannel.Send(dcMsg.Data); err != nil {
				slog.Error("Failed to forward DataChannel message to ingress", "roomName", fwd.RoomName, "err", err)
			}
		} else {
			slog.Warn("No ingress DataChannel to forward message to", "roomName", fwd.RoomName)
		}
	})

	dc.OnClose(func() {
		slog.Debug("Relay-to-relay DataChannel closed", "roomName", fwd.RoomName)
	})

	// Handle ICE candidates
	pc.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		err := relayWS.SendMeshForwardICE(fwd.RoomName, "", candidate.ToJSON())
		if err != nil {
			slog.Error("Failed to send ICE candidate to relay", "roomName", fwd.RoomName, "err", err)
		}
	})

	// Create and send SDP offer
	offer, err := pc.CreateOffer(nil)
	if err != nil {
		_ = pc.Close()
		return fmt.Errorf("failed to create offer for relay PeerConnection: roomName: %s, err: %w", fwd.RoomName, err)
	}
	if err := pc.SetLocalDescription(offer); err != nil {
		_ = pc.Close()
		return fmt.Errorf("failed to set local description for relay PeerConnection: roomName: %s, err: %w", fwd.RoomName, err)
	}

	err = relayWS.SendMeshForwardSDP(fwd.RoomName, "", offer)
	if err != nil {
		_ = pc.Close()
		return fmt.Errorf("failed to send offer to relay: roomName: %s, err: %w", fwd.RoomName, err)
	}

	// Store the PeerConnection
	m.relayPCs.Set(fwd.RoomName, pc)

	slog.Debug("Initiated relay-to-relay PeerConnection", "roomName", fwd.RoomName)
	return nil
}

// broadcastStreamRequest sends a stream request to all connected relays
func (m *MeshManager) broadcastStreamRequest(roomName string) error {
	if m.peerRelays.Len() <= 0 {
		return nil
	}
	slog.Debug("Broadcasting stream request", "roomName", roomName, "peers", m.peerRelays.Len())
	for relayID, pr := range m.peerRelays.Copy() {
		if err := pr.WebSocket.SendMeshStreamRequest(roomName); err != nil {
			slog.Error("Failed to broadcast stream request", "roomName", roomName, "relayID", relayID, "err", err)
			if err := m.removeRelay(relayID); err != nil {
				slog.Error("Failed to remove relay after stream request send failure", "relayID", relayID, "err", err)
			} else {
				slog.Info("Relay removed after stream request failure", "relayID", relayID)
			}
		} else {
			slog.Debug("Stream request sent", "roomName", roomName, "relayID", relayID)
		}
	}
	return nil
}

func (m *MeshManager) setupMeshWebSocket(ws *connections.SafeWebSocket, peerRelayID ulid.ULID) error {
	// Handle binary protobuf messages
	ws.RegisterBinaryMessageCallback(func(data []byte) {
		var msg gen.MeshMessage
		if err := proto.Unmarshal(data, &msg); err != nil {
			slog.Error("Failed to unmarshal MeshMessage", "err", err, "relayID", peerRelayID)
			return
		}
		if err := m.handleBinaryMessage(ws, data, peerRelayID); err != nil {
			slog.Error("Failed to handle MeshMessage", "err", err, "relayID", peerRelayID)
		}
	})

	// Cleanup on WebSocket close
	ws.RegisterOnClose(func() {
		slog.Info("WebSocket closed", "peerRelayID", peerRelayID)
		if err := m.removeRelay(peerRelayID); err != nil {
			slog.Error("Failed to remove relay on WebSocket close", "peerRelayID", peerRelayID, "err", err)
		}
	})

	return nil
}

func (m *MeshManager) handleBinaryMessage(ws *connections.SafeWebSocket, data []byte, peerRelayID ulid.ULID) error {
	var msg gen.MeshMessage
	if err := proto.Unmarshal(data, &msg); err != nil {
		return err
	}

	switch t := msg.Type.(type) {
	// Level 0
	case *gen.MeshMessage_StateUpdate:
		return m.handleStateUpdate(peerRelayID, t.StateUpdate)
	case *gen.MeshMessage_Ack:
		return m.handleAck(t.Ack)
	case *gen.MeshMessage_Heartbeat:
		return m.handleHeartbeat(t.Heartbeat)
	case *gen.MeshMessage_SuspectRelay:
		return m.handleSuspectRelay(t.SuspectRelay)
	case *gen.MeshMessage_Disconnect:
		return m.handleDisconnect(t.Disconnect)
	// Level 1
	case *gen.MeshMessage_ForwardSdp:
		return m.handleForwardedSDP(ws, t.ForwardSdp)
	case *gen.MeshMessage_ForwardIce:
		return m.handleForwardedICE(ws, t.ForwardIce)
	case *gen.MeshMessage_ForwardIngest:
		return m.handleForwardedIngest(ws, t.ForwardIngest)
	case *gen.MeshMessage_StreamRequest:
		return m.handleStreamRequest(ws, t.StreamRequest)
	// Level 2
	case *gen.MeshMessage_Handshake:
		return m.handleHandshake(ws, t.Handshake)
	case *gen.MeshMessage_HandshakeResponse:
		return m.handleHandshakeResponse(ws, t.HandshakeResponse)
	default:
		return fmt.Errorf("unknown MeshMessage type")
	}
}
