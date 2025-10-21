package shared

import (
	"log/slog"
	"relay/internal/common"
	"relay/internal/connections"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/oklog/ulid/v2"
	"github.com/pion/rtp"
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

	// Broadcast queues (unbuffered, fan-out happens async)
	videoBroadcastChan chan *rtp.Packet
	audioBroadcastChan chan *rtp.Packet
	broadcastStop      chan struct{}
}

func NewRoom(name string, roomID ulid.ULID, ownerID peer.ID) *Room {
	r := &Room{
		RoomInfo: RoomInfo{
			ID:      roomID,
			Name:    name,
			OwnerID: ownerID,
		},
		Participants:       common.NewSafeMap[ulid.ULID, *Participant](),
		videoBroadcastChan: make(chan *rtp.Packet, 1000), // Large buffer for incoming packets
		audioBroadcastChan: make(chan *rtp.Packet, 500),
		broadcastStop:      make(chan struct{}),
	}

	// Start async broadcasters
	go r.videoBroadcaster()
	go r.audioBroadcaster()

	return r
}

// AddParticipant adds a Participant to a Room
func (r *Room) AddParticipant(participant *Participant) {
	slog.Debug("Adding participant to room", "participant", participant.ID, "room", r.Name)
	r.Participants.Set(participant.ID, participant)
}

// RemoveParticipantByID removes a Participant from a Room by participant's ID
func (r *Room) RemoveParticipantByID(pID ulid.ULID) {
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

// BroadcastPacket enqueues packet for async broadcast (non-blocking)
func (r *Room) BroadcastPacket(kind webrtc.RTPCodecType, pkt *rtp.Packet) {
	start := time.Now()
	if kind == webrtc.RTPCodecTypeVideo {
		select {
		case r.videoBroadcastChan <- pkt:
			duration := time.Since(start)
			if duration > 10*time.Millisecond {
				slog.Warn("Slow video broadcast enqueue", "duration", duration, "room", r.Name)
			}
		default:
			// Broadcast queue full - system overload, drop packet globally
			slog.Warn("Video broadcast queue full, dropping packet", "room", r.Name)
		}
	} else {
		select {
		case r.audioBroadcastChan <- pkt:
			duration := time.Since(start)
			if duration > 10*time.Millisecond {
				slog.Warn("Slow audio broadcast enqueue", "duration", duration, "room", r.Name)
			}
		default:
			slog.Warn("Audio broadcast queue full, dropping packet", "room", r.Name)
		}
	}
}

// Close stops the broadcasters
func (r *Room) Close() {
	close(r.broadcastStop)
	close(r.videoBroadcastChan)
	close(r.audioBroadcastChan)
}

// videoBroadcaster runs async fan-out for video packets
func (r *Room) videoBroadcaster() {
	for {
		select {
		case pkt := <-r.videoBroadcastChan:
			// Fan out to all participants without blocking
			r.Participants.Range(func(_ ulid.ULID, participant *Participant) bool {
				if participant.VideoChan != nil {
					// Clone packet for each participant to avoid shared pointer issues
					clonedPkt := pkt.Clone()
					select {
					case participant.VideoChan <- clonedPkt:
						// Sent
					default:
						// Participant slow, drop packet
						slog.Debug("Dropped video packet for slow participant",
							"room", r.Name,
							"participant", participant.ID)
					}
				}
				return true
			})
		case <-r.broadcastStop:
			return
		}
	}
}

// audioBroadcaster runs async fan-out for audio packets
func (r *Room) audioBroadcaster() {
	for {
		select {
		case pkt := <-r.audioBroadcastChan:
			r.Participants.Range(func(_ ulid.ULID, participant *Participant) bool {
				if participant.AudioChan != nil {
					// Clone packet for each participant to avoid shared pointer issues
					clonedPkt := pkt.Clone()
					select {
					case participant.AudioChan <- clonedPkt:
						// Sent
					default:
						// Participant slow, drop packet
						slog.Debug("Dropped audio packet for slow participant",
							"room", r.Name,
							"participant", participant.ID)
					}
				}
				return true
			})
		case <-r.broadcastStop:
			return
		}
	}
}
