package internal

import (
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
	"io"
	"log/slog"
	"relay/internal/common"
	"relay/internal/connections"
	"sync"
)

// MeshManager manages the mesh network and gossip protocol
type MeshManager struct {
	relay *Relay // This relay's instance
	sync.RWMutex
	relayWebSockets map[uuid.UUID]*connections.SafeWebSocket
	relayPCs        map[string]*webrtc.PeerConnection
	relayDCs        map[string]*connections.NestriDataChannel
	State           *common.MeshState
	sharedSecrets   map[uuid.UUID][]byte           // RelayID -> Shared Secret
	relayPrivateKey *ecdsa.PrivateKey              // For signing approvals
	publicKeyStore  map[uuid.UUID]*ecdsa.PublicKey // RelayID -> Public Key (for approvals)
}

// NewMeshManager initializes a MeshManager with a sync interval
func NewMeshManager(relay *Relay) *MeshManager {
	privKey, err := common.GenerateECDHKeyPair()
	if err != nil {
		slog.Error("Failed to generate relay private key", "err", err)
		return nil
	}
	return &MeshManager{
		relay:           relay,
		relayWebSockets: make(map[uuid.UUID]*connections.SafeWebSocket),
		relayPCs:        make(map[string]*webrtc.PeerConnection),
		relayDCs:        make(map[string]*connections.NestriDataChannel),
		State:           common.NewMeshState(),
		sharedSecrets:   make(map[uuid.UUID][]byte),
		relayPrivateKey: privKey,
		publicKeyStore:  make(map[uuid.UUID]*ecdsa.PublicKey),
	}
}

// setWebSocket assigns a WebSocket connection to the MeshManager's map
func (m *MeshManager) setWebSocket(relayID uuid.UUID, ws *connections.SafeWebSocket) {
	m.Lock()
	defer m.Unlock()
	m.relayWebSockets[relayID] = ws
	slog.Debug("WebSocket assigned to MeshManager", "relayID", relayID)
}

// getPeerConnectionForRoom retrieves the PeerConnection for a given room
func (m *MeshManager) getPeerConnectionForRoom(roomName string) (*webrtc.PeerConnection, bool) {
	m.RLock()
	defer m.RUnlock()
	pc, exists := m.relayPCs[roomName]
	return pc, exists
}

// getDataChannelForRoom retrieves the DataChannel for a given room
func (m *MeshManager) getDataChannelForRoom(roomName string) (*connections.NestriDataChannel, bool) {
	m.RLock()
	defer m.RUnlock()
	dc, exists := m.relayDCs[roomName]
	return dc, exists
}

func (m *MeshManager) AddRoom(roomName string) {
	m.State.AddRoom(roomName)
	m.broadcastChange("add", roomName) // Broadcast the addition
}

func (m *MeshManager) DeleteRoom(roomName string) {
	m.State.DeleteRoom(roomName)
	m.broadcastChange("remove", roomName) // Broadcast the deletion
}

func (m *MeshManager) broadcastChange(action string, roomName string) {
	m.RLock()
	defer m.RUnlock()
	for relayID, ws := range m.relayWebSockets {
		if err := ws.SendMeshStateChange(action, roomName); err != nil {
			slog.Error("Failed to broadcast state change", "relayID", relayID, "err", err)
			m.RUnlock()
			m.removeRelay(relayID)
			m.RLock()
		}
	}
}

func (m *MeshManager) removeRelay(relayID uuid.UUID) {
	m.Lock()
	if ws, exists := m.relayWebSockets[relayID]; exists {
		_ = ws.Close()
		delete(m.relayWebSockets, relayID)
		delete(m.sharedSecrets, relayID)
	}
	m.Unlock()
}

func (m *MeshManager) HandleForwardedSDP(relayWS *connections.SafeWebSocket, msg connections.MessageMeshForwardSDP) error {
	if len(msg.ParticipantID) > 0 {
		return m.handleForwardedSDPParticipant(relayWS, msg)
	} else if len(msg.RoomName) > 0 {
		// Check if offer or answer
		if msg.SDP.Type == webrtc.SDPTypeOffer {
			return m.handleForwardedSDPRoomOffer(relayWS, msg)
		} else if msg.SDP.Type == webrtc.SDPTypeAnswer {
			return m.handleForwardedSDPRoomAnswer(relayWS, msg)
		} else {
			return fmt.Errorf("invalid SDP type: %s", msg.SDP.Type.String())
		}
	} else {
		return fmt.Errorf("invalid forwarded SDP message: neither room nor participant ID provided")
	}
}

func (m *MeshManager) handleForwardedSDPRoomOffer(relayWS *connections.SafeWebSocket, msg connections.MessageMeshForwardSDP) error {
	room := m.relay.GetOrCreateRoom(msg.RoomName)
	relay := GetRelay()

	// Create PeerConnection
	pc, err := common.CreatePeerConnection(func() {
		slog.Debug("Closed PeerConnection of relay stream", "roomName", msg.RoomName)
		// TODO: Remove room?
	})
	if err != nil {
		return err
	}

	// Handle incoming tracks
	pc.OnTrack(func(remoteTrack *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		localTrack, err := webrtc.NewTrackLocalStaticRTP(remoteTrack.Codec().RTPCodecCapability, remoteTrack.ID(), fmt.Sprintf("relay-%s", msg.RoomName))
		if err != nil {
			slog.Error("Failed to create local track for relayed stream", "roomName", msg.RoomName, "err", err)
			return
		}
		if remoteTrack.Kind() == webrtc.RTPCodecTypeAudio {
			room.SetTrack(webrtc.RTPCodecTypeAudio, localTrack)
		} else if remoteTrack.Kind() == webrtc.RTPCodecTypeVideo {
			room.SetTrack(webrtc.RTPCodecTypeVideo, localTrack)
		}

		slog.Debug("Started relaying track to local room", "roomName", msg.RoomName, "kind", remoteTrack.Kind())

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

		slog.Debug("Stopped relaying track to local room", "roomName", msg.RoomName, "kind", remoteTrack.Kind())
	})

	// Handle added DataChannels
	pc.OnDataChannel(func(dc *webrtc.DataChannel) {
		slog.Debug("Received mesh DataChannel connection", "roomName", msg.RoomName, "label", dc.Label())
		relayDC := connections.NewNestriDataChannel(dc)

		relayDC.OnOpen(func() {
			slog.Debug("Mesh DataChannel opened on receiving side", "roomName", msg.RoomName)
			// Store the DataChannel
			relay.MeshManager.Lock()
			relay.MeshManager.relayDCs[msg.RoomName] = relayDC
			relay.MeshManager.Unlock()

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
			slog.Debug("Mesh DataChannel closed on receiving side", "roomName", msg.RoomName)
			relay.MeshManager.Lock()
			delete(relay.MeshManager.relayDCs, msg.RoomName)
			relay.MeshManager.Unlock()
		})

		// TODO: Handle Mesh -> Local relay DataChannel messages?
	})

	// Handle ICE candidates
	pc.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		err := relayWS.SendMeshForwardICE(msg.RoomName, "", candidate.ToJSON())
		if err != nil {
			slog.Error("Failed to send ICE candidate to relay", "roomName", msg.RoomName, "err", err)
		}
	})

	// Set remote description and create answer
	if err := pc.SetRemoteDescription(msg.SDP); err != nil {
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
	err = relayWS.SendMeshForwardSDP(msg.RoomName, "", answer)
	if err != nil {
		_ = pc.Close()
		return err
	}

	// Store the PeerConnection
	relay.MeshManager.Lock()
	relay.MeshManager.relayPCs[msg.RoomName] = pc
	relay.MeshManager.Unlock()

	return nil
}

func (m *MeshManager) handleForwardedSDPRoomAnswer(_ *connections.SafeWebSocket, msg connections.MessageMeshForwardSDP) error {
	relay := GetRelay()
	relay.MeshManager.Lock()
	pc, exists := relay.MeshManager.relayPCs[msg.RoomName]
	relay.MeshManager.Unlock()
	if !exists || pc.ConnectionState() == webrtc.PeerConnectionStateClosed {
		return fmt.Errorf("PeerConnection not found or is closed for room: %s", msg.RoomName)
	}

	if err := pc.SetRemoteDescription(msg.SDP); err != nil {
		_ = pc.Close()
		return err
	}
	slog.Debug("Completed relay-to-relay PeerConnection setup", "roomName", msg.RoomName)

	return nil
}

func (m *MeshManager) handleForwardedSDPParticipant(relayWS *connections.SafeWebSocket, msg connections.MessageMeshForwardSDP) error {
	participantID, err := uuid.Parse(msg.ParticipantID)
	if err != nil {
		return err
	}

	// Check if participant exists
	participant := m.relay.GetParticipantByID(participantID)
	if participant == nil {
		return fmt.Errorf("participant not found: %s", participantID)
	}

	// Set remote SDP and generate an answer
	err = participant.PeerConnection.SetRemoteDescription(msg.SDP)
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
	err = relayWS.SendMeshForwardSDP("", msg.ParticipantID, answer)
	if err != nil {
		return err
	}
	return nil
}

func (m *MeshManager) HandleForwardedICE(relayWS *connections.SafeWebSocket, msg connections.MessageMeshForwardICE) error {
	if len(msg.ParticipantID) > 0 {
		return m.HandleForwardedICEParticipant(relayWS, msg)
	} else if len(msg.RoomName) > 0 {
		return m.HandleForwardedICERoom(relayWS, msg)
	} else {
		return fmt.Errorf("invalid forwarded ICE message: neither room nor participant ID provided")
	}
}

func (m *MeshManager) HandleForwardedICEParticipant(_ *connections.SafeWebSocket, msg connections.MessageMeshForwardICE) error {
	participantID, err := uuid.Parse(msg.ParticipantID)
	if err != nil {
		return err
	}

	participant := m.relay.GetParticipantByID(participantID)
	if participant == nil {
		return fmt.Errorf("participant not found: %s", participantID)
	}

	err = participant.PeerConnection.AddICECandidate(msg.Candidate)
	if err != nil {
		return err
	}
	return nil
}

func (m *MeshManager) HandleForwardedICERoom(_ *connections.SafeWebSocket, msg connections.MessageMeshForwardICE) error {
	relay := GetRelay()
	relay.MeshManager.Lock()
	pc, exists := relay.MeshManager.relayPCs[msg.RoomName]
	relay.MeshManager.Unlock()
	if !exists || pc.ConnectionState() == webrtc.PeerConnectionStateClosed {
		return fmt.Errorf("PeerConnection not found or is closed for room: %s", msg.RoomName)
	}

	if err := pc.AddICECandidate(msg.Candidate); err != nil {
		return err
	}
	return nil
}

func (m *MeshManager) HandleForwardedIngest(relayWS *connections.SafeWebSocket, msg connections.MessageMeshForwardIngest) {
	// Get or create the room
	room := m.relay.GetOrCreateRoom(msg.RoomName)

	// Check if room is already being ingested
	if room.Online {
		if err := relayWS.SendAnswerMessageWS(connections.AnswerInUse); err != nil {
			slog.Error("Failed to send InUse answer for forwarded ingest",
				"room", room.Name,
				"err", err)
		}
		return
	}

	// Assign the WebSocket from the original relay and handle ingest
	room.AssignWebSocket(relayWS)
	go IngestHandler(room)
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

	// Send handshake message
	safeWS := connections.NewSafeWebSocket(conn)
	if err = safeWS.SendMeshHandshake(m.relay.ID.String(), pubKey); err != nil {
		_ = conn.Close()
		return fmt.Errorf("failed to send handshake: %w", err)
	}

	// Store the WebSocket in relayWebSockets
	tempID := uuid.New() // Temporary; actual ID comes from handshake response later in the process
	m.Lock()
	m.relayWebSockets[tempID] = safeWS
	m.Unlock()

	// Register all necessary handlers
	safeWS.RegisterMessageCallback("mesh_handshake_response", func(data []byte) {
		var msg connections.MessageMeshHandshakeResponse
		if err = json.Unmarshal(data, &msg); err != nil {
			slog.Error("Failed to parse handshake response", "address", relayAddress, "err", err)
			return
		}

		peerRelayID, err := uuid.Parse(msg.RelayID)
		if err != nil {
			slog.Error("Invalid relay ID in handshake response", "address", relayAddress, "err", err)
			return
		}

		peerPubKey, err := common.ParsePublicKey(msg.DHPublicKey)
		if err != nil {
			slog.Error("Failed to parse peer DH public key", "err", err)
			return
		}

		sharedSecret, err := common.ComputeSharedSecret(privKey, peerPubKey)
		if err != nil {
			slog.Error("Failed to compute shared secret", "err", err)
			return
		}

		m.RLock()
		relayCount := len(m.relayWebSockets)
		m.RUnlock()

		// Only verify approvals if the mesh is not empty (excluding tempID)
		if relayCount > 1 {
			if !m.verifyApprovals(msg.Approvals, peerRelayID) {
				slog.Warn("Insufficient or invalid approvals", "peerRelayID", peerRelayID)
				m.Lock()
				if ws, exists := m.relayWebSockets[tempID]; exists {
					_ = ws.Close()
					delete(m.relayWebSockets, tempID)
				}
				m.Unlock()
				return
			}
		} else {
			slog.Debug("Skipping approval verification for initial mesh connection", "peerRelayID", peerRelayID)
		}

		m.Lock()
		m.relayWebSockets[peerRelayID] = safeWS
		delete(m.relayWebSockets, tempID)
		m.sharedSecrets[peerRelayID] = sharedSecret
		m.publicKeyStore[peerRelayID] = peerPubKey
		safeWS.SetSharedSecret(sharedSecret)
		m.Unlock()
		slog.Info("Successfully connected to relay", "peerRelayID", peerRelayID, "address", relayAddress)

		safeWS.RegisterOnClose(func() {
			slog.Info("WebSocket closed for relay", "peerRelayID", peerRelayID, "address", relayAddress)
			m.removeRelay(peerRelayID)
		})
	})

	safeWS.RegisterMessageCallback("mesh_state_change", func(data []byte) {
		var msg connections.MessageMeshStateChange
		if err := json.Unmarshal(data, &msg); err != nil {
			slog.Error("Failed to decode state change message", "err", err)
			return
		}
		if msg.Action == "add" {
			m.relay.MeshManager.State.AddRoom(msg.RoomName)
		} else if msg.Action == "remove" {
			m.relay.MeshManager.State.DeleteRoom(msg.RoomName)
		}
	})

	safeWS.RegisterMessageCallback("mesh_forward_sdp", func(data []byte) {
		var msg connections.MessageMeshForwardSDP
		if err := json.Unmarshal(data, &msg); err != nil {
			slog.Error("Failed to decode forwarded SDP message", "err", err)
			return
		}
		if err := m.HandleForwardedSDP(safeWS, msg); err != nil {
			slog.Error("Failed to handle forwarded SDP", "err", err)
		}
	})

	safeWS.RegisterMessageCallback("mesh_forward_ice", func(data []byte) {
		var msg connections.MessageMeshForwardICE
		if err := json.Unmarshal(data, &msg); err != nil {
			slog.Error("Failed to decode forwarded ICE candidate", "err", err)
			return
		}
		if err := m.HandleForwardedICE(safeWS, msg); err != nil {
			slog.Error("Failed to handle forwarded ICE", "err", err)
		}
	})

	safeWS.RegisterMessageCallback("mesh_forward_ingest", func(data []byte) {
		var msg connections.MessageMeshForwardIngest
		if err := json.Unmarshal(data, &msg); err != nil {
			slog.Error("Failed to decode forwarded ingest message", "err", err)
			return
		}
		m.HandleForwardedIngest(safeWS, msg)
	})

	safeWS.RegisterMessageCallback("mesh_stream_request", func(data []byte) {
		var msg connections.MessageMeshStreamRequest
		if err := json.Unmarshal(data, &msg); err != nil {
			slog.Error("Failed to decode stream request", "err", err)
			return
		}
		m.handleStreamRequest(safeWS, msg)
	})

	return nil
}

func (m *MeshManager) decodeState(encodedState string, sharedSecret []byte) ([]byte, error) {
	if sharedSecret != nil {
		return common.DecryptMessage(string(sharedSecret), encodedState)
	}
	return base64.StdEncoding.DecodeString(encodedState)
}

func (m *MeshManager) requestApprovals(peerRelayID uuid.UUID) (map[string]string, error) {
	approvals := make(map[string]string)
	m.RLock()
	for relayID := range m.relayWebSockets {
		sig, err := m.signApproval(peerRelayID)
		if err == nil {
			approvals[relayID.String()] = base64.StdEncoding.EncodeToString(sig)
		}
	}
	m.RUnlock()
	return approvals, nil
}

func (m *MeshManager) signApproval(peerRelayID uuid.UUID) ([]byte, error) {
	hash := sha256.Sum256([]byte(peerRelayID.String()))
	return ecdsa.SignASN1(rand.Reader, m.relayPrivateKey, hash[:])
}

func (m *MeshManager) verifyApprovals(approvals map[string]string, peerRelayID uuid.UUID) bool {
	m.RLock()
	relayCount := len(m.relayWebSockets)
	m.RUnlock()

	// If the mesh is empty, allow the relay to join without approvals
	if relayCount == 0 {
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
		relayID, err := uuid.Parse(relayIDStr)
		if err != nil {
			continue
		}
		pubKey, exists := m.publicKeyStore[relayID]
		if !exists {
			continue
		}
		sigBytes, err := base64.StdEncoding.DecodeString(sig)
		if err != nil {
			continue
		}
		hash := sha256.Sum256([]byte(peerRelayID.String()))
		if ecdsa.VerifyASN1(pubKey, hash[:], sigBytes) {
			validCount++
			if validCount >= requiredApprovals {
				return true
			}
		}
	}

	slog.Debug("Not enough valid approvals", "required", requiredApprovals, "valid", validCount)
	return false
}

func requestStreamFromRelay(targetRelayID uuid.UUID, room *Room) {
	relay := GetRelay()
	relay.MeshManager.RLock()
	peerWS, exists := relay.MeshManager.relayWebSockets[targetRelayID]
	relay.MeshManager.RUnlock()

	if exists {
		err := peerWS.SendMeshStreamRequest(room.Name)
		if err != nil {
			slog.Error("Failed to request stream from relay", "roomName", room.Name, "relayID", targetRelayID, "err", err)
			return
		}
	}
}

func (m *MeshManager) handleIncomingHandshake(ws *connections.SafeWebSocket, data []byte) {
	var msg connections.MessageMeshHandshake
	if err := json.Unmarshal(data, &msg); err != nil {
		slog.Error("Failed to parse handshake", "err", err)
		return
	}

	peerRelayID, err := uuid.Parse(msg.RelayID)
	if err != nil {
		slog.Error("Invalid relay ID", "err", err)
		return
	}

	peerPubKey, err := common.ParsePublicKey(msg.DHPublicKey)
	if err != nil {
		slog.Error("Failed to parse peer DH public key", "err", err)
		return
	}

	privKey, err := common.GenerateECDHKeyPair()
	if err != nil {
		slog.Error("Failed to generate ECDH key pair", "err", err)
		return
	}
	pubKey := common.GetPublicKeyBytes(&privKey.PublicKey)

	sharedSecret, err := common.ComputeSharedSecret(privKey, peerPubKey)
	if err != nil {
		slog.Error("Failed to compute shared secret", "err", err)
		return
	}

	approvals, err := m.requestApprovals(peerRelayID)
	if err != nil {
		slog.Error("Failed to request approvals", "err", err)
		return
	}

	if err := ws.SendMeshHandshakeResponse(m.relay.ID.String(), pubKey, approvals); err != nil {
		slog.Error("Failed to send handshake response", "err", err)
		return
	}

	m.Lock()
	ws.SetSharedSecret(sharedSecret)
	m.relayWebSockets[peerRelayID] = ws
	m.sharedSecrets[peerRelayID] = sharedSecret
	m.publicKeyStore[peerRelayID] = peerPubKey
	m.Unlock()

	slog.Info("Accepted connection", "peerRelayID", peerRelayID)
}

func (m *MeshManager) handleStreamRequest(relayWS *connections.SafeWebSocket, msg connections.MessageMeshStreamRequest) {
	room := m.relay.GetRoomByName(msg.RoomName)
	if room == nil || !room.Online {
		slog.Warn("Stream request for unavailable room", "roomName", msg.RoomName)
		return
	}

	// Check if we already have a PeerConnection for this room
	m.Lock()
	if pc, exists := m.relayPCs[msg.RoomName]; exists && pc.ConnectionState() != webrtc.PeerConnectionStateClosed {
		slog.Debug("Existing PeerConnection for room, skipping setup", "roomName", msg.RoomName)
		m.Unlock()
		return
	}
	m.Unlock()

	// Create a new PeerConnection
	pc, err := common.CreatePeerConnection(func() {
		slog.Debug("Closed PeerConnection of stream request between relays", "roomName", msg.RoomName)
	})
	if err != nil {
		slog.Error("Failed to create relay PeerConnection", "roomName", msg.RoomName, "err", err)
		return
	}

	// Add tracks to the PeerConnection
	if room.AudioTrack != nil {
		if _, err := pc.AddTrack(room.AudioTrack); err != nil {
			slog.Error("Failed to add audio track to relay PC", "roomName", msg.RoomName, "err", err)
			_ = pc.Close()
			return
		}
	}
	if room.VideoTrack != nil {
		if _, err := pc.AddTrack(room.VideoTrack); err != nil {
			slog.Error("Failed to add video track to relay PC", "roomName", msg.RoomName, "err", err)
			_ = pc.Close()
			return
		}
	}

	// Add DataChannel for message forwarding
	settingOrdered := true
	settingMaxRetransmits := uint16(0)
	dc, err := pc.CreateDataChannel(fmt.Sprintf("relay-data-%s", msg.RoomName), &webrtc.DataChannelInit{
		Ordered:        &settingOrdered,
		MaxRetransmits: &settingMaxRetransmits,
	})
	if err != nil {
		slog.Error("Failed to create relay DataChannel", "roomName", msg.RoomName, "err", err)
		_ = pc.Close()
		return
	}

	dc.OnOpen(func() {
		slog.Debug("Relay-to-relay DataChannel opened", "roomName", msg.RoomName)
	})

	dc.OnMessage(func(dcMsg webrtc.DataChannelMessage) {
		// Forward messages from the mesh to the ingress
		if room.DataChannel != nil {
			if err := room.DataChannel.Send(dcMsg.Data); err != nil {
				slog.Error("Failed to forward DataChannel message to ingress", "roomName", msg.RoomName, "err", err)
			}
		} else {
			slog.Warn("No ingress DataChannel to forward message to", "roomName", msg.RoomName)
		}
	})

	dc.OnClose(func() {
		slog.Debug("Relay-to-relay DataChannel closed", "roomName", msg.RoomName)
	})

	// Handle ICE candidates
	pc.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		err := relayWS.SendMeshForwardICE(msg.RoomName, "", candidate.ToJSON())
		if err != nil {
			slog.Error("Failed to send ICE candidate to relay", "roomName", msg.RoomName, "err", err)
		}
	})

	// Create and send SDP offer
	offer, err := pc.CreateOffer(nil)
	if err != nil {
		slog.Error("Failed to create offer for relay PC", "roomName", msg.RoomName, "err", err)
		_ = pc.Close()
		return
	}
	if err := pc.SetLocalDescription(offer); err != nil {
		slog.Error("Failed to set local description for relay PC", "roomName", msg.RoomName, "err", err)
		_ = pc.Close()
		return
	}

	err = relayWS.SendMeshForwardSDP(msg.RoomName, "", offer)
	if err != nil {
		slog.Error("Failed to send stream offer to relay", "roomName", msg.RoomName, "err", err)
		_ = pc.Close()
		return
	}

	// Store the PeerConnection
	m.Lock()
	m.relayPCs[msg.RoomName] = pc
	m.Unlock()

	slog.Debug("Initiated relay-to-relay PeerConnection", "roomName", msg.RoomName)
}

// broadcastStreamRequest sends a stream request to all connected relays
func (m *MeshManager) broadcastStreamRequest(roomName string) {
	m.RLock()
	defer m.RUnlock()
	for relayID, ws := range m.relayWebSockets {
		if err := ws.SendMeshStreamRequest(roomName); err != nil {
			slog.Error("Failed to broadcast stream request", "roomName", roomName, "relayID", relayID, "err", err)
		}
	}
}
