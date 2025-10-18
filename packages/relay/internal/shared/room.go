package shared

import (
	"log/slog"
	"relay/internal/common"
	"relay/internal/connections"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/oklog/ulid/v2"
	"github.com/pion/webrtc/v4"
)

type RoomInfo struct {
	ID      ulid.ULID `json:"id"`
	Name    string    `json:"name"`
	OwnerID peer.ID   `json:"owner_id"`
}

type Room struct {
	RoomInfo
	PeerConnection *webrtc.PeerConnection
	AudioTrack     *webrtc.TrackLocalStaticRTP
	VideoTrack     *webrtc.TrackLocalStaticRTP
	DataChannel    *connections.NestriDataChannel
	Participants   *common.SafeMap[ulid.ULID, *Participant]
}

func NewRoom(name string, roomID ulid.ULID, ownerID peer.ID) *Room {
	return &Room{
		RoomInfo: RoomInfo{
			ID:      roomID,
			Name:    name,
			OwnerID: ownerID,
		},
		Participants: common.NewSafeMap[ulid.ULID, *Participant](),
	}
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

// IsOnline checks if the room is online (has both audio and video tracks)
func (r *Room) IsOnline() bool {
	return r.AudioTrack != nil && r.VideoTrack != nil
}

func (r *Room) SetTrack(trackType webrtc.RTPCodecType, track *webrtc.TrackLocalStaticRTP) {
	switch trackType {
	case webrtc.RTPCodecTypeAudio:
		r.AudioTrack = track
	case webrtc.RTPCodecTypeVideo:
		r.VideoTrack = track
	default:
		slog.Warn("Unknown track type", "room", r.Name, "trackType", trackType)
	}
}
