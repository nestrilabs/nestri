package internal

import (
	"context"
	"fmt"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/oklog/ulid/v2"
	"github.com/pion/webrtc/v4"
	"log/slog"
	"relay/internal/common"
	"relay/internal/connections"
)

type RoomInfo struct {
	ID      ulid.ULID `json:"id"`
	Name    string    `json:"name"`
	Online  bool      `json:"online"`
	OwnerID peer.ID   `json:"owner_id"`
}

type Room struct {
	RoomInfo
	WebSocket      *connections.SafeWebSocket
	PeerConnection *webrtc.PeerConnection
	AudioTrack     *webrtc.TrackLocalStaticRTP
	VideoTrack     *webrtc.TrackLocalStaticRTP
	DataChannel    *connections.NestriDataChannel
	Participants   *common.SafeMap[ulid.ULID, *Participant]
	Relay          *Relay
}

func NewRoom(name string, roomID ulid.ULID, ownerID peer.ID) *Room {
	return &Room{
		RoomInfo: RoomInfo{
			ID:      roomID,
			Name:    name,
			Online:  false,
			OwnerID: ownerID,
		},
		Participants: common.NewSafeMap[ulid.ULID, *Participant](),
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
	r.Participants.Set(participant.ID, participant)
}

// Removes a Participant from a Room by participant's ID
func (r *Room) removeParticipantByID(pID ulid.ULID) {
	if _, ok := r.Participants.Get(pID); ok {
		r.Participants.Delete(pID)
	}
}

// Removes a Participant from a Room by participant's name
func (r *Room) removeParticipantByName(pName string) {
	for id, participant := range r.Participants.Copy() {
		if participant.Name == pName {
			if err := r.signalParticipantOffline(participant); err != nil {
				slog.Error("Failed to signal participant offline", "participant", participant.ID, "room", r.Name, "err", err)
			}
			r.Participants.Delete(id)
			break
		}
	}
}

// Removes all participants from a Room
func (r *Room) removeAllParticipants() {
	for id, participant := range r.Participants.Copy() {
		if err := r.signalParticipantOffline(participant); err != nil {
			slog.Error("Failed to signal participant offline", "participant", participant.ID, "room", r.Name, "err", err)
		}
		r.Participants.Delete(id)
		slog.Debug("Removed participant from room", "participant", id, "room", r.Name)
	}
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
			slog.Debug("Room online, participants will be signaled", "room", r.Name)
			r.signalParticipantsWithTracks()
		} else {
			slog.Debug("Room offline, signaling participants", "room", r.Name)
			r.signalParticipantsOffline()
		}

		// Publish updated state to mesh
		go func() {
			if err := r.Relay.publishRoomStates(context.Background()); err != nil {
				slog.Error("Failed to publish room states on change", "room", r.Name, "err", err)
			}
		}()
	}
}

func (r *Room) signalParticipantsWithTracks() {
	for _, participant := range r.Participants.Copy() {
		if err := r.signalParticipantWithTracks(participant); err != nil {
			slog.Error("Failed to signal participant with tracks", "participant", participant.ID, "room", r.Name, "err", err)
		}
	}
}

func (r *Room) signalParticipantWithTracks(participant *Participant) error {
	if r.AudioTrack != nil {
		if err := participant.addTrack(r.AudioTrack); err != nil {
			return fmt.Errorf("failed to add audio track: %w", err)
		}
	}
	if r.VideoTrack != nil {
		if err := participant.addTrack(r.VideoTrack); err != nil {
			return fmt.Errorf("failed to add video track: %w", err)
		}
	}
	if err := participant.signalOffer(); err != nil {
		return fmt.Errorf("failed to signal offer: %w", err)
	}
	return nil
}

func (r *Room) signalParticipantsOffline() {
	for _, participant := range r.Participants.Copy() {
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
