package internal

import (
	"fmt"
	"github.com/oklog/ulid/v2"
	"github.com/pion/webrtc/v4"
	"log/slog"
	"relay/internal/common"
	"relay/internal/connections"
	"sync"
)

type RoomInfo struct {
	ID     ulid.ULID `json:"id"`
	Name   string    `json:"name"`
	Online bool      `json:"online"`
}

type Room struct {
	RoomInfo
	WebSocket         *connections.SafeWebSocket
	PeerConnection    *webrtc.PeerConnection
	AudioTrack        *webrtc.TrackLocalStaticRTP
	VideoTrack        *webrtc.TrackLocalStaticRTP
	DataChannel       *connections.NestriDataChannel
	Participants      map[ulid.ULID]*Participant
	ParticipantsMutex sync.RWMutex
	Relay             *Relay // Reference to access MeshManager
}

func NewRoom(name string) *Room {
	id, err := common.NewULID()
	if err != nil {
		slog.Error("Failed to generate ULID for room", "name", name, "err", err)
		return nil
	}
	return &Room{
		RoomInfo: RoomInfo{
			ID:     id,
			Name:   name,
			Online: false,
		},
		Participants: make(map[ulid.ULID]*Participant),
	}
}

// AssignWebSocket assigns a WebSocket connection to a Room
func (r *Room) AssignWebSocket(ws *connections.SafeWebSocket) {
	if r.WebSocket != nil {
		slog.Warn("WebSocket already assigned to room", "room", r.Name)
	}
	r.WebSocket = ws
}

// AddParticipant adds a Participant to a Room
func (r *Room) AddParticipant(participant *Participant) {
	slog.Debug("Adding participant to room", "participant", participant.ID, "room", r.Name)
	r.ParticipantsMutex.Lock()
	r.Participants[participant.ID] = participant
	r.ParticipantsMutex.Unlock()
}

// Removes a Participant from a Room by participant's ID
func (r *Room) removeParticipantByID(pID ulid.ULID) {
	r.ParticipantsMutex.Lock()
	if _, ok := r.Participants[pID]; ok {
		delete(r.Participants, pID)
	}
	r.ParticipantsMutex.Unlock()
}

// Removes a Participant from a Room by participant's name
func (r *Room) removeParticipantByName(pName string) {
	r.ParticipantsMutex.Lock()
	for id, participant := range r.Participants {
		if participant.Name == pName {
			if err := r.signalParticipantOffline(participant); err != nil {
				slog.Error("Failed to signal participant offline", "participant", participant.ID, "room", r.Name, "err", err)
			}
			delete(r.Participants, id)
			break
		}
	}
	r.ParticipantsMutex.Unlock()
}

// Removes all participants from a Room
func (r *Room) removeAllParticipants() {
	r.ParticipantsMutex.Lock()
	for id := range r.Participants {
		if err := r.signalParticipantOffline(r.Participants[id]); err != nil {
			slog.Error("Failed to signal participant offline", "participant", r.Participants[id].ID, "room", r.Name, "err", err)
		}
		delete(r.Participants, id)
		slog.Debug("Removed participant from room", "participant", id, "room", r.Name)
	}
	r.ParticipantsMutex.Unlock()
}

func (r *Room) SetTrack(trackType webrtc.RTPCodecType, track *webrtc.TrackLocalStaticRTP) {
	switch trackType {
	case webrtc.RTPCodecTypeAudio:
		r.AudioTrack = track
		slog.Debug("Audio track set", "room", r.Name, "track", track != nil)
	case webrtc.RTPCodecTypeVideo:
		r.VideoTrack = track
		slog.Debug("Video track set", "room", r.Name, "track", track != nil)
	default:
		slog.Warn("Unknown track type", "room", r.Name, "trackType", trackType)
	}

	newOnline := r.AudioTrack != nil && r.VideoTrack != nil
	if r.Online != newOnline {
		r.Online = newOnline
		if r.Online {
			r.Relay.MeshManager.State.AddRoom(r.Name, r.Relay.ID)
			err := r.Relay.MeshManager.broadcastStateUpdate()
			if err != nil {
				slog.Error("Failed to broadcast state update", "room", r.Name, "err", err)
			}
			slog.Debug("Room online and receiving, signaling participants", "room", r.Name)
			r.signalParticipantsWithTracks()
		} else {
			r.Relay.MeshManager.State.DeleteRoom(r.Name)
			err := r.Relay.MeshManager.broadcastStateUpdate()
			if err != nil {
				slog.Error("Failed to broadcast state update", "room", r.Name, "err", err)
			}
			slog.Debug("Room offline and not receiving, signaling participants", "room", r.Name)
			r.signalParticipantsOffline()
		}
	}
}

func (r *Room) signalParticipantsWithTracks() {
	r.ParticipantsMutex.RLock()
	defer r.ParticipantsMutex.RUnlock()
	for _, participant := range r.Participants {
		if err := r.signalParticipantWithTracks(participant); err != nil {
			slog.Error("Failed to signal participant with tracks", "participant", participant.ID, "room", r.Name, "err", err)
		}
	}
}

func (r *Room) signalParticipantWithTracks(participant *Participant) error {
	if r.AudioTrack != nil {
		if err := participant.AddTrack(r.AudioTrack); err != nil {
			return fmt.Errorf("failed to add audio track: %w", err)
		}
	}
	if r.VideoTrack != nil {
		if err := participant.AddTrack(r.VideoTrack); err != nil {
			return fmt.Errorf("failed to add video track: %w", err)
		}
	}
	if err := participant.SignalOffer(); err != nil {
		return fmt.Errorf("failed to signal offer: %w", err)
	}
	return nil
}

func (r *Room) signalParticipantsOffline() {
	r.ParticipantsMutex.RLock()
	defer r.ParticipantsMutex.RUnlock()
	for _, participant := range r.Participants {
		if err := r.signalParticipantOffline(participant); err != nil {
			slog.Error("Failed to signal participant offline", "participant", participant.ID, "room", r.Name, "err", err)
		}
	}
}

// signalParticipantOffline signals a single participant offline
func (r *Room) signalParticipantOffline(participant *Participant) error {
	// Skip if websocket is nil or closed
	if participant.WebSocket == nil || participant.WebSocket.IsClosed() {
		return nil
	}
	if err := participant.WebSocket.SendAnswerMessageWS(connections.AnswerOffline); err != nil {
		return err
	}
	return nil
}
