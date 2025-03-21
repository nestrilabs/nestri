package relay

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
	"log/slog"
	"sync"
	"time"
)

// MeshManager manages the mesh network and gossip protocol
type MeshManager struct {
	relay           *Relay
	mutex           sync.RWMutex
	relayWebSockets map[uuid.UUID]*SafeWebSocket
	state           *MeshState
	syncInterval    time.Duration
}

// NewMeshManager initializes a MeshManager with a sync interval
func NewMeshManager(relay *Relay, syncInterval time.Duration) *MeshManager {
	return &MeshManager{
		relay:           relay,
		relayWebSockets: make(map[uuid.UUID]*SafeWebSocket),
		state:           NewMeshState(),
		syncInterval:    syncInterval,
	}
}

// StartSync begins the periodic state synchronization
func (m *MeshManager) StartSync(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(m.syncInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				m.broadcastState()
			}
		}
	}()
}

// broadcastState sends the current state to all peers
func (m *MeshManager) broadcastState() {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	for u, ws := range m.relayWebSockets {
		if err := ws.SendStateSyncMessageWS(m.state.Rooms); err != nil {
			slog.Error("Failed to broadcast state, removing as invalid connection", "err", err)
			// Remove invalid connection from our list
			m.mutex.Lock()
			delete(m.relayWebSockets, u)
			m.mutex.Unlock()
		}
	}
}

// GetRoomInfo returns the current state of a room
func (m *MeshManager) GetRoomInfo(roomName string) (RoomState, bool) {
	m.state.mutex.RLock()
	defer m.state.mutex.RUnlock()
	state, exists := m.state.Rooms[roomName]
	return state, exists
}

func (m *MeshManager) HandleForwardedSDP(relayWS *SafeWebSocket, msg MessageForwardSDP) {
	participantID, err := uuid.Parse(msg.ParticipantID)
	if err != nil {
		slog.Error("Invalid participant UUID in forwarded SDP", "participantID", msg.ParticipantID)
		return
	}

	// Check if participant exists
	participant := m.relay.GetParticipantByID(participantID)
	if participant == nil {
		slog.Error("Participant not found for forwarded SDP", "participantID", participantID)
		return
	}

	// Set remote SDP and generate an answer
	err = participant.PeerConnection.SetRemoteDescription(msg.SDP)
	if err != nil {
		slog.Error("Failed to set remote SDP", "participantID", participantID, "err", err)
		return
	}

	answer, err := participant.PeerConnection.CreateAnswer(nil)
	if err != nil {
		slog.Error("Failed to create SDP answer", "participantID", participantID, "err", err)
		return
	}

	err = participant.PeerConnection.SetLocalDescription(answer)
	if err != nil {
		slog.Error("Failed to set local SDP answer", "participantID", participantID, "err", err)
		return
	}

	// Send the answer back to the originating relay
	err = relayWS.SendForwardSDPMessageWS(msg.ParticipantID, answer)
	if err != nil {
		slog.Error("Failed to send forwarded SDP answer", "participantID", participantID, "err", err)
	}
}

func (m *MeshManager) HandleForwardedICE(_ *SafeWebSocket, msg MessageForwardICE) {
	participantID, err := uuid.Parse(msg.ParticipantID)
	if err != nil {
		slog.Error("Invalid participant UUID in forwarded ICE message", "participantID", msg.ParticipantID)
		return
	}

	participant := m.relay.GetParticipantByID(participantID)
	if participant == nil {
		slog.Error("Participant not found for forwarded ICE message", "participantID", participantID)
		return
	}

	err = participant.PeerConnection.AddICECandidate(msg.Candidate)
	if err != nil {
		slog.Error("Failed to add forwarded ICE candidate", "participantID", participantID, "err", err)
	} else {
		slog.Info("Successfully added forwarded ICE candidate", "participantID", participantID)
	}
}

func (m *MeshManager) HandleForwardedIngest(relayWS *SafeWebSocket, msg MessageForwardIngest) {
	// Get or create the room
	room := GetOrCreateRoom(msg.RoomName)

	// Check if room is already being ingested
	if room.Online {
		if err := relayWS.SendAnswerMessageWS(AnswerInUse); err != nil {
			slog.Error("Failed to send InUse answer for forwarded ingest",
				"room", room.Name,
				"err", err)
		}
		return
	}

	// Assign the WebSocket from the original relay and handle ingest
	room.assignWebSocket(relayWS)
	go ingestHandler(room)
}

func (m *MeshManager) ConnectToRelay(relayAddress string) error {
	slog.Info("Attempting to connect to relay", "address", relayAddress)

	// Establish WebSocket connection
	wsURL := fmt.Sprintf("wss://%s/api/mesh", relayAddress)
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		return fmt.Errorf("failed to connect to relay: %w", err)
	}

	// Wrap WebSocket in SafeWebSocket
	safeWS := NewSafeWebSocket(conn)

	// Send handshake
	if err := safeWS.SendMeshHandshake(m.relay.ID.String()); err != nil {
		_ = conn.Close()
		return fmt.Errorf("failed to send handshake: %w", err)
	}

	// Store the WebSocket in relayWebSockets
	relayID := uuid.New() // Temporary; actual ID comes from handshake response later in the process
	m.mutex.Lock()
	m.relayWebSockets[relayID] = safeWS
	m.mutex.Unlock()

	// Register all necessary handlers
	safeWS.RegisterMessageCallback("mesh_handshake_response", func(data []byte) {
		var msg MessageMeshHandshakeResponse
		if err := json.Unmarshal(data, &msg); err != nil {
			slog.Error("Failed to parse handshake response", "address", relayAddress, "err", err)
			return
		}
		peerRelayID, err := uuid.Parse(msg.RelayID)
		if err != nil {
			slog.Error("Invalid relay ID in handshake response", "address", relayAddress, "err", err)
			return
		}
		m.mutex.Lock()
		m.relayWebSockets[peerRelayID] = safeWS
		delete(m.relayWebSockets, relayID)
		m.mutex.Unlock()
		slog.Info("Successfully connected to relay", "peerRelayID", peerRelayID, "address", relayAddress)

		safeWS.RegisterOnClose(func() {
			slog.Info("WebSocket closed for relay", "peerRelayID", peerRelayID, "address", relayAddress)
			m.mutex.Lock()
			delete(m.relayWebSockets, peerRelayID)
			m.mutex.Unlock()
		})
	})

	safeWS.RegisterMessageCallback("state_sync", func(data []byte) {
		var msg MessageStateSync
		if err := json.Unmarshal(data, &msg); err != nil {
			slog.Error("Failed to decode state sync message", "err", err)
			return
		}
		remoteState := NewMeshState()
		remoteState.Rooms = msg.State
		m.state.Merge(remoteState)
	})

	safeWS.RegisterMessageCallback("forward_sdp", func(data []byte) {
		var msg MessageForwardSDP
		if err := json.Unmarshal(data, &msg); err != nil {
			slog.Error("Failed to decode forwarded SDP message", "err", err)
			return
		}
		m.HandleForwardedSDP(safeWS, msg)
	})

	safeWS.RegisterMessageCallback("forward_ice", func(data []byte) {
		var msg MessageForwardICE
		if err := json.Unmarshal(data, &msg); err != nil {
			slog.Error("Failed to decode forwarded ICE candidate", "err", err)
			return
		}
		m.HandleForwardedICE(safeWS, msg)
	})

	safeWS.RegisterMessageCallback("forward_ingest", func(data []byte) {
		var msg MessageForwardIngest
		if err := json.Unmarshal(data, &msg); err != nil {
			slog.Error("Failed to decode forwarded ingest message", "err", err)
			return
		}
		m.HandleForwardedIngest(safeWS, msg)
	})

	safeWS.RegisterMessageCallback("stream_request", func(data []byte) {
		var msg MessageStreamRequest
		if err := json.Unmarshal(data, &msg); err != nil {
			slog.Error("Failed to decode stream request", "err", err)
			return
		}
		m.HandleStreamRequest(safeWS, msg)
	})

	return nil
}

func requestStreamFromRelay(targetRelayID uuid.UUID, room *Room) {
	relay := GetRelay()

	relay.MeshManager.mutex.RLock()
	peerWS, exists := relay.MeshManager.relayWebSockets[targetRelayID]
	relay.MeshManager.mutex.RUnlock()

	if exists {
		msg := MessageStreamRequest{
			MessageBase: MessageBase{PayloadType: "stream_request"},
			RoomName:    room.Name,
		}
		err := peerWS.SendJSON(msg)
		if err != nil {
			slog.Error("Failed to request stream from relay", "roomName", room.Name, "relayID", targetRelayID, "err", err)
			return
		}
	}
}

func (m *MeshManager) HandleStreamRequest(relayWS *SafeWebSocket, msg MessageStreamRequest) {
	room := GetRoomByName(msg.RoomName)
	if room == nil || !room.Online {
		slog.Warn("Room not found or not online for stream request", "roomName", msg.RoomName)
		return
	}

	for _, track := range room.GetActiveTracks() {
		forwardTrackToRelay(relayWS, track, room.Name)
	}
}

func forwardTrackToRelay(relayWS *SafeWebSocket, track *webrtc.TrackLocalStaticRTP, roomName string) {
	msg := MessageStreamForward{
		MessageBase: MessageBase{PayloadType: "stream_forward"},
		RoomName:    roomName,
		TrackID:     track.ID(),
	}
	err := relayWS.SendJSON(msg)
	if err != nil {
		slog.Error("Failed to forward track to relay", "roomName", roomName, "trackID", track.ID(), "err", err)
		return
	}
}
