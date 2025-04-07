package internal

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p-pubsub"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/pnet"
	"github.com/libp2p/go-libp2p/p2p/security/noise"
	"github.com/multiformats/go-multiaddr"
	"github.com/oklog/ulid/v2"
	"github.com/pion/webrtc/v4"
	"io"
	"log/slog"
	"relay/internal/common"
	"relay/internal/connections"
)

var globalRelay *Relay

// networkNotifier logs connection events
type networkNotifier struct{}

func (n *networkNotifier) Connected(net network.Network, conn network.Conn) {
	slog.Info("Peer connected", "local", conn.LocalPeer(), "remote", conn.RemotePeer())
}
func (n *networkNotifier) Disconnected(net network.Network, conn network.Conn) {
	slog.Info("Peer disconnected", "local", conn.LocalPeer(), "remote", conn.RemotePeer())
}
func (n *networkNotifier) Listen(net network.Network, addr multiaddr.Multiaddr)      {}
func (n *networkNotifier) ListenClose(net network.Network, addr multiaddr.Multiaddr) {}

type ICEMessage struct {
	PeerID    string
	TargetID  string
	RoomID    ulid.ULID
	Candidate []byte
}

type Relay struct {
	ID                   peer.ID
	Rooms                *common.SafeMap[ulid.ULID, *Room]
	Host                 host.Host                                          // libp2p host for peer-to-peer networking
	PubSub               *pubsub.PubSub                                     // PubSub for state synchronization
	MeshState            *common.SafeMap[ulid.ULID, RoomInfo]               // room ID -> state
	RelayPCs             *common.SafeMap[ulid.ULID, *webrtc.PeerConnection] // room ID -> relay PeerConnection
	pubTopicState        *pubsub.Topic                                      // topic for room states
	pubTopicICECandidate *pubsub.Topic                                      // topic for ICE candidates aimed to this relay
}

func NewRelay(ctx context.Context, port int) (*Relay, error) {
	listenAddrs := []string{
		fmt.Sprintf("/ip4/0.0.0.0/tcp/%d", port), // IPv4
		fmt.Sprintf("/ip6/::/tcp/%d", port),      // IPv6
	}

	// Use "testToken" as the pre-shared token for authentication
	// TODO: Give via flags, before PR commit
	token := "testToken"
	// Generate 32-byte PSK from the token using SHA-256
	shaToken := sha256.Sum256([]byte(token))
	tokenPSK := pnet.PSK(shaToken[:])

	// Initialize libp2p host
	p2pHost, err := libp2p.New(
		libp2p.ListenAddrStrings(listenAddrs...),
		libp2p.Security(noise.ID, noise.New),
		libp2p.EnableRelay(),
		libp2p.EnableHolePunching(),
		libp2p.PrivateNetwork(tokenPSK),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create libp2p host for relay: %w", err)
	}

	// Set up pubsub
	p2pPubsub, err := pubsub.NewGossipSub(ctx, p2pHost)
	if err != nil {
		return nil, fmt.Errorf("failed to create pubsub: %w", err)
	}

	// Add network notifier to log connections
	p2pHost.Network().Notify(&networkNotifier{})

	r := &Relay{
		ID:        p2pHost.ID(),
		Host:      p2pHost,
		PubSub:    p2pPubsub,
		Rooms:     common.NewSafeMap[ulid.ULID, *Room](),
		MeshState: common.NewSafeMap[ulid.ULID, RoomInfo](),
		RelayPCs:  common.NewSafeMap[ulid.ULID, *webrtc.PeerConnection](),
	}

	// Set up state synchronization and stream handling
	r.setupStateSync(ctx)
	r.setupStreamHandler()

	slog.Info("Relay initialized", "id", r.ID, "addrs", p2pHost.Addrs())

	peerInfo := peer.AddrInfo{
		ID:    p2pHost.ID(),
		Addrs: p2pHost.Addrs(),
	}
	addrs, err := peer.AddrInfoToP2pAddrs(&peerInfo)
	if err != nil {
		return nil, fmt.Errorf("failed to convert peer info to addresses: %w", err)
	}

	slog.Debug("Connect with one of the following URLs below:")
	for _, addr := range addrs {
		slog.Debug(fmt.Sprintf("- %s", addr.String()))
	}
	return r, nil
}

func InitRelay(ctx context.Context, ctxCancel context.CancelFunc, port int) error {
	var err error
	globalRelay, err = NewRelay(ctx, port)
	if err != nil {
		return fmt.Errorf("failed to create relay: %w", err)
	}

	if err := common.InitWebRTCAPI(); err != nil {
		return err
	}

	if err := InitHTTPEndpoint(ctx, ctxCancel); err != nil {
		return err
	}

	slog.Info("Relay initialized", "id", globalRelay.ID)
	return nil
}

func GetRelay() *Relay {
	return globalRelay
}

func (r *Relay) GetRoomByID(id ulid.ULID) *Room {
	if room, ok := r.Rooms.Get(id); ok {
		return room
	}
	return nil
}

func (r *Relay) GetOrCreateRoom(name string) *Room {
	if room := r.GetRoomByName(name); room != nil {
		return room
	}

	id, err := common.NewULID()
	if err != nil {
		slog.Error("Failed to generate new ULID for room", "err", err)
		return nil
	}

	room := NewRoom(name, id, r.ID)
	room.Relay = r
	r.Rooms.Set(room.ID, room)

	slog.Debug("Created new room", "name", name, "id", room.ID)
	return room
}

func (r *Relay) DeleteRoomIfEmpty(room *Room) {
	participantCount := room.Participants.Len()
	if participantCount > 0 {
		slog.Debug("Room not empty, not deleting", "name", room.Name, "id", room.ID, "participants", participantCount)
		return
	}

	// Create a "tombstone" state for the room, this allows propagation of the room deletion
	tombstoneState := RoomInfo{
		ID:      room.ID,
		Name:    room.Name,
		Online:  false,
		OwnerID: room.OwnerID,
	}

	// Publish updated state to mesh
	if err := r.publishRoomState(context.Background(), tombstoneState); err != nil {
		slog.Error("Failed to publish room states on change", "room", room.Name, "err", err)
	}

	slog.Info("Deleting room since empty and offline", "name", room.Name, "id", room.ID)
	r.Rooms.Delete(room.ID)
}

func (r *Relay) setupStateSync(ctx context.Context) {
	var err error
	r.pubTopicState, err = r.PubSub.Join("room-states")
	if err != nil {
		slog.Error("Failed to join pubsub topic", "err", err)
		return
	}

	sub, err := r.pubTopicState.Subscribe()
	if err != nil {
		slog.Error("Failed to subscribe to topic", "err", err)
		return
	}

	r.pubTopicICECandidate, err = r.PubSub.Join("ice-candidates")
	if err != nil {
		slog.Error("Failed to join ICE candidates topic", "err", err)
		return
	}

	iceCandidateSub, err := r.pubTopicICECandidate.Subscribe()
	if err != nil {
		slog.Error("Failed to subscribe to ICE candidates topic", "err", err)
		return
	}

	// Handle state updates only from authenticated peers
	go func() {
		for {
			msg, err := sub.Next(ctx)
			if err != nil {
				slog.Error("Error receiving pubsub message", "err", err)
				return
			}
			if msg.GetFrom() == r.Host.ID() {
				continue // Ignore own messages
			}
			var states []RoomInfo
			if err := json.Unmarshal(msg.Data, &states); err != nil {
				slog.Error("Failed to unmarshal room states", "err", err)
				continue
			}
			r.updateMeshState(states)
		}
	}()

	// Handle incoming ICE candidates for given room
	go func() {
		// Map of ICE candidate slices per room ID
		iceHolder := make(map[ulid.ULID][]webrtc.ICECandidateInit)

		for {
			msg, err := iceCandidateSub.Next(ctx)
			if err != nil {
				slog.Error("Error receiving ICE candidate message", "err", err)
				return
			}
			if msg.GetFrom() == r.Host.ID() {
				continue // Ignore own messages
			}

			var iceMsg ICEMessage
			if err := json.Unmarshal(msg.Data, &iceMsg); err != nil {
				slog.Error("Failed to unmarshal ICE candidate message", "err", err)
				continue
			}
			if iceMsg.TargetID != r.ID.String() {
				continue // Ignore messages not meant for this relay
			}

			if iceHolder[iceMsg.RoomID] == nil {
				iceHolder[iceMsg.RoomID] = make([]webrtc.ICECandidateInit, 0)
			}

			if pc, ok := r.RelayPCs.Get(iceMsg.RoomID); ok {
				// Unmarshal ice candidate
				var candidate webrtc.ICECandidateInit
				if err := json.Unmarshal(iceMsg.Candidate, &candidate); err != nil {
					slog.Error("Failed to unmarshal ICE candidate", "err", err)
					continue
				}
				if pc.RemoteDescription() != nil {
					if err := pc.AddICECandidate(candidate); err != nil {
						slog.Error("Failed to add ICE candidate", "err", err)
					}
					// Add any held candidates
					for _, heldCandidate := range iceHolder[iceMsg.RoomID] {
						if err := pc.AddICECandidate(heldCandidate); err != nil {
							slog.Error("Failed to add held ICE candidate", "err", err)
						}
					}
					iceHolder[iceMsg.RoomID] = make([]webrtc.ICECandidateInit, 0)
				} else {
					iceHolder[iceMsg.RoomID] = append(iceHolder[iceMsg.RoomID], candidate)
				}
			} else {
				slog.Error("PeerConnection for room not found when adding ICE candidate", "roomID", iceMsg.RoomID)
			}
		}
	}()
}

func (r *Relay) publishRoomState(ctx context.Context, state RoomInfo) error {
	data, err := json.Marshal([]RoomInfo{state})
	if err != nil {
		return err
	}
	return r.pubTopicState.Publish(ctx, data)
}

func (r *Relay) publishRoomStates(ctx context.Context) error {
	var states []RoomInfo
	for _, room := range r.Rooms.Copy() {
		states = append(states, RoomInfo{
			ID:      room.ID,
			Name:    room.Name,
			Online:  room.Online,
			OwnerID: r.ID,
		})
	}
	data, err := json.Marshal(states)
	if err != nil {
		return err
	}
	return r.pubTopicState.Publish(ctx, data)
}

func (r *Relay) updateMeshState(states []RoomInfo) {
	for _, state := range states {
		if state.OwnerID == r.ID {
			continue // Skip own state
		}
		existing, exists := r.MeshState.Get(state.ID)
		r.MeshState.Set(state.ID, state)
		slog.Debug("Updated mesh state", "room", state.Name, "online", state.Online, "owner", state.OwnerID)

		// React to state changes
		if !exists || existing.Online != state.Online {
			room := r.GetRoomByName(state.Name)
			if state.Online {
				if room == nil || !room.Online {
					slog.Info("Room became active remotely, requesting stream", "room", state.Name, "owner", state.OwnerID)
					go func() {
						if _, err := r.requestStream(context.Background(), state.Name, state.ID, state.OwnerID); err != nil {
							slog.Error("Failed to request stream", "room", state.Name, "err", err)
						} else {
							slog.Info("Successfully requested stream", "room", state.Name, "owner", state.OwnerID)
						}
					}()
				}
			} else if room != nil && room.Online {
				slog.Info("Room became inactive remotely, stopping local stream", "room", state.Name)
				if pc, ok := r.RelayPCs.Get(state.ID); ok {
					_ = pc.Close()
					r.RelayPCs.Delete(state.ID)
				}
				room.Online = false
				room.signalParticipantsOffline()
			} else if room == nil && !exists {
				slog.Info("Received tombstone state for room", "name", state.Name, "id", state.ID)
				if pc, ok := r.RelayPCs.Get(state.ID); ok {
					_ = pc.Close()
					r.RelayPCs.Delete(state.ID)
				}
			}
		}
	}
}

func (r *Relay) IsRoomActive(roomID ulid.ULID) (bool, peer.ID) {
	if state, exists := r.MeshState.Get(roomID); exists && state.Online {
		return true, state.OwnerID
	}
	return false, ""
}

func (r *Relay) GetRoomByName(name string) *Room {
	for _, room := range r.Rooms.Copy() {
		if room.Name == name {
			return room
		}
	}
	return nil
}

func writeMessage(stream network.Stream, data []byte) error {
	length := uint32(len(data))
	if err := binary.Write(stream, binary.BigEndian, length); err != nil {
		return err
	}
	_, err := stream.Write(data)
	return err
}

func readMessage(stream network.Stream) ([]byte, error) {
	var length uint32
	if err := binary.Read(stream, binary.BigEndian, &length); err != nil {
		return nil, err
	}
	data := make([]byte, length)
	_, err := io.ReadFull(stream, data)
	return data, err
}

func (r *Relay) setupStreamHandler() {
	r.Host.SetStreamHandler("/nestri-relay/stream/1.0.0", func(stream network.Stream) {
		defer func(stream network.Stream) {
			err := stream.Close()
			if err != nil {
				slog.Error("Failed to close stream", "err", err)
			}
		}(stream)
		remotePeer := stream.Conn().RemotePeer()

		roomNameData, err := readMessage(stream)
		if err != nil && err != io.EOF {
			slog.Error("Failed to read room name", "peer", remotePeer, "err", err)
			return
		}
		roomName := string(roomNameData)

		slog.Info("Stream request from peer", "peer", remotePeer, "room", roomName)

		room := r.GetRoomByName(roomName)
		if room == nil || !room.Online {
			slog.Error("Cannot provide stream for inactive room", "room", roomName)
			return
		}

		pc, err := common.CreatePeerConnection(func() {
			r.RelayPCs.Delete(room.ID)
		})
		if err != nil {
			slog.Error("Failed to create relay PeerConnection", "err", err)
			return
		}

		r.RelayPCs.Set(room.ID, pc)

		if room.AudioTrack != nil {
			_, err := pc.AddTrack(room.AudioTrack)
			if err != nil {
				slog.Error("Failed to add audio track", "err", err)
				return
			}
		}
		if room.VideoTrack != nil {
			_, err := pc.AddTrack(room.VideoTrack)
			if err != nil {
				slog.Error("Failed to add video track", "err", err)
				return
			}
		}

		settingOrdered := true
		settingMaxRetransmits := uint16(0)
		dc, err := pc.CreateDataChannel("relay-data", &webrtc.DataChannelInit{
			Ordered:        &settingOrdered,
			MaxRetransmits: &settingMaxRetransmits,
		})
		if err != nil {
			slog.Error("Failed to create relay DataChannel", "err", err)
			return
		}
		relayDC := connections.NewNestriDataChannel(dc)

		relayDC.RegisterOnOpen(func() {
			slog.Debug("Relay DataChannel opened", "room", roomName)
		})

		relayDC.RegisterOnClose(func() {
			slog.Debug("Relay DataChannel closed", "room", roomName)
		})

		relayDC.RegisterMessageCallback("input", func(data []byte) {
			if room.DataChannel != nil {
				// Forward message to the room's data channel
				if err := room.DataChannel.SendBinary(data); err != nil {
					slog.Error("Failed to send DataChannel message", "room", roomName, "err", err)
				}
			}
		})

		offer, err := pc.CreateOffer(nil)
		if err != nil {
			slog.Error("Failed to create offer", "err", err)
			return
		}
		if err := pc.SetLocalDescription(offer); err != nil {
			slog.Error("Failed to set local description", "err", err)
			return
		}
		offerData, err := json.Marshal(offer)
		if err != nil {
			slog.Error("Failed to marshal offer", "err", err)
			return
		}
		if err := writeMessage(stream, offerData); err != nil {
			slog.Error("Failed to send offer", "peer", remotePeer, "err", err)
			return
		}

		// Handle our generated ICE candidates
		pc.OnICECandidate(func(candidate *webrtc.ICECandidate) {
			if candidate == nil {
				return
			}
			candidateData, err := json.Marshal(candidate.ToJSON())
			if err != nil {
				slog.Error("Failed to marshal ICE candidate", "err", err)
				return
			}
			iceMsg := ICEMessage{
				PeerID:    r.Host.ID().String(),
				TargetID:  remotePeer.String(),
				RoomID:    room.ID,
				Candidate: candidateData,
			}
			data, err := json.Marshal(iceMsg)
			if err != nil {
				slog.Error("Failed to marshal ICE message", "err", err)
				return
			}
			if err := r.pubTopicICECandidate.Publish(context.Background(), data); err != nil {
				slog.Error("Failed to publish ICE candidate message", "err", err)
			}
		})

		answerData, err := readMessage(stream)
		if err != nil && err != io.EOF {
			slog.Error("Failed to read answer", "peer", remotePeer, "err", err)
			return
		}
		var answer webrtc.SessionDescription
		if err := json.Unmarshal(answerData, &answer); err != nil {
			slog.Error("Failed to unmarshal answer", "err", err)
			return
		}
		if err := pc.SetRemoteDescription(answer); err != nil {
			slog.Error("Failed to set remote description", "err", err)
			return
		}
	})
}

func (r *Relay) requestStream(ctx context.Context, roomName string, roomID ulid.ULID, providerPeer peer.ID) (*webrtc.PeerConnection, error) {
	stream, err := r.Host.NewStream(ctx, providerPeer, "/nestri-relay/stream/1.0.0")
	if err != nil {
		return nil, fmt.Errorf("failed to create stream: %w", err)
	}
	defer func(stream network.Stream) {
		err := stream.Close()
		if err != nil {
			slog.Error("Failed to close stream", "err", err)
		}
	}(stream)

	if err := writeMessage(stream, []byte(roomName)); err != nil {
		return nil, fmt.Errorf("failed to send room name: %w", err)
	}

	room := r.GetRoomByName(roomName)
	if room == nil {
		room = NewRoom(roomName, roomID, providerPeer)
		r.Rooms.Set(roomID, room)
	} else if room.ID != roomID {
		// Mismatch, prefer the one from the provider
		// TODO: When mesh is created, if there are mismatches, we should have relays negotiate common room IDs
		room.ID = roomID
		room.OwnerID = providerPeer
		r.Rooms.Set(roomID, room)
	}

	pc, err := common.CreatePeerConnection(func() {
		r.RelayPCs.Delete(roomID)
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create PeerConnection: %w", err)
	}

	r.RelayPCs.Set(roomID, pc)

	offerData, err := readMessage(stream)
	if err != nil && err != io.EOF {
		return nil, fmt.Errorf("failed to read offer: %w", err)
	}
	var offer webrtc.SessionDescription
	if err := json.Unmarshal(offerData, &offer); err != nil {
		return nil, fmt.Errorf("failed to unmarshal offer: %w", err)
	}
	if err := pc.SetRemoteDescription(offer); err != nil {
		return nil, fmt.Errorf("failed to set remote description: %w", err)
	}

	pc.OnTrack(func(track *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		localTrack, _ := webrtc.NewTrackLocalStaticRTP(track.Codec().RTPCodecCapability, track.ID(), "relay-"+roomName+"-"+track.Kind().String())
		slog.Debug("Received track for mesh relay room", "room", roomName, "kind", track.Kind())

		room.SetTrack(track.Kind(), localTrack)

		go func() {
			for {
				rtpPacket, _, err := track.ReadRTP()
				if err != nil {
					if !errors.Is(err, io.EOF) {
						slog.Error("Failed to read RTP packet from remote track for room", "room", roomName, "err", err)
					}
					break
				}

				err = localTrack.WriteRTP(rtpPacket)
				if err != nil && !errors.Is(err, io.ErrClosedPipe) {
					slog.Error("Failed to write RTP to local track for room", "room", room.Name, "err", err)
					break
				}
			}
		}()
	})

	// ICE candidate handling
	pc.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		candidateData, err := json.Marshal(candidate.ToJSON())
		if err != nil {
			slog.Error("Failed to marshal ICE candidate", "err", err)
			return
		}
		iceMsg := ICEMessage{
			PeerID:    r.Host.ID().String(),
			TargetID:  providerPeer.String(),
			RoomID:    roomID,
			Candidate: candidateData,
		}
		data, err := json.Marshal(iceMsg)
		if err != nil {
			slog.Error("Failed to marshal ICE message", "err", err)
			return
		}
		if err := r.pubTopicICECandidate.Publish(ctx, data); err != nil {
			slog.Error("Failed to publish ICE candidate message", "err", err)
		}
	})

	pc.OnDataChannel(func(dc *webrtc.DataChannel) {
		relayDC := connections.NewNestriDataChannel(dc)
		slog.Debug("Received DataChannel from peer", "room", roomName)

		relayDC.RegisterOnOpen(func() {
			slog.Debug("Relay DataChannel opened", "room", roomName)
		})

		relayDC.OnClose(func() {
			slog.Debug("Relay DataChannel closed", "room", roomName)
		})

		// Override room DataChannel with the mesh-relay one to forward messages
		room.DataChannel = relayDC
	})

	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create answer: %w", err)
	}
	if err := pc.SetLocalDescription(answer); err != nil {
		return nil, fmt.Errorf("failed to set local description: %w", err)
	}
	answerData, err := json.Marshal(answer)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal answer: %w", err)
	}
	if err := writeMessage(stream, answerData); err != nil {
		return nil, fmt.Errorf("failed to send answer: %w", err)
	}

	return pc, nil
}

// ConnectToRelay manually connects to another relay by its multiaddress
func (r *Relay) ConnectToRelay(ctx context.Context, addr string) error {
	// Parse the multiaddress
	ma, err := multiaddr.NewMultiaddr(addr)
	if err != nil {
		slog.Error("Invalid multiaddress", "addr", addr, "err", err)
		return fmt.Errorf("invalid multiaddress: %w", err)
	}

	// Extract peer ID from multiaddress
	peerInfo, err := peer.AddrInfoFromP2pAddr(ma)
	if err != nil {
		slog.Error("Failed to extract peer info", "addr", addr, "err", err)
		return fmt.Errorf("failed to extract peer info: %w", err)
	}

	// Connect to the peer
	if err := r.Host.Connect(ctx, *peerInfo); err != nil {
		slog.Error("Failed to connect to peer", "peer", peerInfo.ID, "addr", addr, "err", err)
		return fmt.Errorf("failed to connect: %w", err)
	}

	// Publish challenge on join
	//go r.sendAuthChallenge(ctx)

	slog.Info("Successfully connected to peer", "peer", peerInfo.ID, "addr", addr)
	return nil
}
