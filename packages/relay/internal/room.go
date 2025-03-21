package relay

import (
	"github.com/google/uuid"
	"github.com/pion/webrtc/v4"
	"log/slog"
	"sync"
)

type RoomInfo struct {
	ID     uuid.UUID `json:"id"`
	Name   string    `json:"name"`
	Online bool      `json:"online"`
}

type Room struct {
	RoomInfo
	WebSocket         *SafeWebSocket
	PeerConnection    *webrtc.PeerConnection
	AudioTrack        *webrtc.TrackLocalStaticRTP
	VideoTrack        *webrtc.TrackLocalStaticRTP
	DataChannel       *NestriDataChannel
	Participants      map[uuid.UUID]*Participant
	ParticipantsMutex sync.RWMutex
	Relay             *Relay // Reference to access MeshManager
}

func NewRoom(name string) *Room {
	return &Room{
		RoomInfo: RoomInfo{
			ID:     uuid.New(),
			Name:   name,
			Online: false,
		},
		Participants: make(map[uuid.UUID]*Participant),
	}
}

// Assigns a WebSocket connection to a Room
func (r *Room) assignWebSocket(ws *SafeWebSocket) {
	if r.WebSocket != nil {
		slog.Warn("WebSocket already assigned to room", "room", r.Name)
	}
	r.WebSocket = ws
}

// Adds a Participant to a Room
func (r *Room) addParticipant(participant *Participant) {
	slog.Debug("Adding participant to room", "participant", participant.ID, "room", r.Name)
	r.ParticipantsMutex.Lock()
	r.Participants[participant.ID] = participant
	r.ParticipantsMutex.Unlock()
}

// Removes a Participant from a Room by participant's ID
func (r *Room) removeParticipantByID(pID uuid.UUID) {
	r.ParticipantsMutex.Lock()
	if _, ok := r.Participants[pID]; ok {
		delete(r.Participants, pID)
	} else {
		slog.Warn("Participant not found in room", "participant", pID, "room", r.Name)
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

	newOnline := r.AudioTrack != nil || r.VideoTrack != nil
	if r.Online != newOnline {
		r.Online = newOnline
		r.Relay.MeshManager.state.UpdateRoom(r.Name, r.Relay.ID, r.Online, r.Relay.ID)
		if r.Online {
			slog.Debug("Room online and receiving, signaling participants", "room", r.Name)
			r.signalParticipantsWithTracks()
		} else {
			slog.Debug("Room offline and not receiving, signaling participants", "room", r.Name)
			r.signalParticipantsOffline()
		}
	}
}

func (r *Room) GetActiveTracks() []*webrtc.TrackLocalStaticRTP {
	var tracks []*webrtc.TrackLocalStaticRTP
	if r.AudioTrack != nil {
		tracks = append(tracks, r.AudioTrack)
	}
	if r.VideoTrack != nil {
		tracks = append(tracks, r.VideoTrack)
	}
	return tracks
}

func (r *Room) signalParticipantsWithTracks() {
	r.ParticipantsMutex.RLock()
	defer r.ParticipantsMutex.RUnlock()
	for _, participant := range r.Participants {
		if r.AudioTrack != nil {
			if err := participant.addTrack(r.AudioTrack); err != nil {
				slog.Error("Failed to add audio track", "participant", participant.ID, "room", r.Name, "err", err)
			}
		}
		if r.VideoTrack != nil {
			if err := participant.addTrack(r.VideoTrack); err != nil {
				slog.Error("Failed to add video track", "participant", participant.ID, "room", r.Name, "err", err)
			}
		}
		if err := participant.signalOffer(); err != nil {
			slog.Error("Failed to signal offer", "participant", participant.ID, "room", r.Name, "err", err)
		}
	}
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
	if err := participant.WebSocket.SendAnswerMessageWS(AnswerOffline); err != nil {
		return err
	}
	return nil
}

// Broadcasts a message to Room's Participants - excluding one given ID
func (r *Room) broadcastMessage(msg webrtc.DataChannelMessage, excludeID uuid.UUID) {
	r.ParticipantsMutex.RLock()
	for d, participant := range r.Participants {
		if participant.DataChannel != nil {
			if d != excludeID { // Don't send back to the sender
				if err := participant.DataChannel.SendText(string(msg.Data)); err != nil {
					slog.Error("Error broadcasting to participant", "participant", participant.ID, "room", r.Name, "err", err)
				}
			}
		}
	}
	if r.DataChannel != nil {
		if err := r.DataChannel.SendText(string(msg.Data)); err != nil {
			slog.Error("Error broadcasting to Room", "room", r.Name, "err", err)
		}
	}
	r.ParticipantsMutex.RUnlock()
}

// Sends message to Room (nestri-server)
func (r *Room) sendToRoom(msg webrtc.DataChannelMessage) {
	if r.DataChannel != nil {
		if err := r.DataChannel.SendText(string(msg.Data)); err != nil {
			slog.Error("Error sending to Room", "room", r.Name, "err", err)
		}
	}
}
