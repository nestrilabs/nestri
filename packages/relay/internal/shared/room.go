package shared

import (
	"log/slog"
	"relay/internal/connections"
	"sync"
	"sync/atomic"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/oklog/ulid/v2"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

var participantPacketPool = sync.Pool{
	New: func() interface{} {
		return &participantPacket{}
	},
}

type participantPacket struct {
	kind   webrtc.RTPCodecType
	packet *rtp.Packet
}

type RoomInfo struct {
	ID      ulid.ULID `json:"id"`
	Name    string    `json:"name"`
	OwnerID peer.ID   `json:"owner_id"`
}

type Room struct {
	RoomInfo
	PeerConnection *webrtc.PeerConnection
	DataChannel    *connections.NestriDataChannel

	codecMu        sync.RWMutex
	audioCodec     webrtc.RTPCodecCapability
	videoCodec     webrtc.RTPCodecCapability

	// Atomic pointer to slice of participant channels
	participantChannels atomic.Pointer[[]chan<- *participantPacket]
	participantsMtx     sync.Mutex // Use only for add/remove

	Participants map[ulid.ULID]*Participant // Keep general track of Participant(s)

	// Track last seen values to calculate diffs
	LastVideoTimestamp      uint32
	LastVideoSequenceNumber uint16
	LastAudioTimestamp      uint32
	LastAudioSequenceNumber uint16

	VideoTimestampSet bool
	VideoSequenceSet  bool
	AudioTimestampSet bool
	AudioSequenceSet  bool
}

func NewRoom(name string, roomID ulid.ULID, ownerID peer.ID) *Room {
	r := &Room{
		RoomInfo: RoomInfo{
			ID:      roomID,
			Name:    name,
			OwnerID: ownerID,
		},
		PeerConnection: nil,
		DataChannel:    nil,
		Participants:   make(map[ulid.ULID]*Participant),
	}

	emptyChannels := make([]chan<- *participantPacket, 0)
	r.participantChannels.Store(&emptyChannels)

	return r
}

// Close closes up Room (stream ended)
func (r *Room) Close() {
	if r.DataChannel != nil {
		err := r.DataChannel.Close()
		if err != nil {
			slog.Error("Failed to close Room DataChannel", err)
		}
		r.DataChannel = nil
	}
	if r.PeerConnection != nil {
		err := r.PeerConnection.Close()
		if err != nil {
			slog.Error("Failed to close Room PeerConnection", err)
		}
		r.PeerConnection = nil
	}
}

func (r *Room) AddParticipant(participant *Participant) {
	r.participantsMtx.Lock()
	defer r.participantsMtx.Unlock()

	r.Participants[participant.ID] = participant

	// Update channel slice atomically
	current := r.participantChannels.Load()
	newChannels := make([]chan<- *participantPacket, len(*current)+1)
	copy(newChannels, *current)
	newChannels[len(*current)] = participant.packetQueue

	r.participantChannels.Store(&newChannels)

	slog.Debug("Added participant", "participant", participant.ID, "room", r.Name)
}

func (r *Room) RemoveParticipantByID(pID ulid.ULID) {
	r.participantsMtx.Lock()
	defer r.participantsMtx.Unlock()

	participant, ok := r.Participants[pID]
	if !ok {
		return
	}

	delete(r.Participants, pID)

	// Update channel slice
	current := r.participantChannels.Load()
	newChannels := make([]chan<- *participantPacket, 0, len(*current)-1)
	for _, ch := range *current {
		if ch != participant.packetQueue {
			newChannels = append(newChannels, ch)
		}
	}

	r.participantChannels.Store(&newChannels)

	slog.Debug("Removed participant", "participant", pID, "room", r.Name)
}

func (r *Room) IsOnline() bool {
	return r.PeerConnection != nil
}

func (r *Room) BroadcastPacket(kind webrtc.RTPCodecType, pkt *rtp.Packet) {
	// Lock-free load of channel slice
	channels := r.participantChannels.Load()

	// no participants..
	if len(*channels) == 0 {
		return
	}

	// Send to each participant channel (non-blocking)
	for i, ch := range *channels {
		// Get packet struct from pool
		pp := participantPacketPool.Get().(*participantPacket)
		pp.kind = kind
		pp.packet = pkt.Clone()

		select {
		case ch <- pp:
			// Sent successfully
		default:
			// Channel full, drop packet, log?
			slog.Warn("Channel full, dropping packet", "channel_index", i)
			participantPacketPool.Put(pp)
		}
	}
}

func (r *Room) SetAudioCodec(c webrtc.RTPCodecCapability) {
	r.codecMu.Lock()
	defer r.codecMu.Unlock()
	r.audioCodec = c
}

func (r *Room) GetAudioCodec() webrtc.RTPCodecCapability {
	r.codecMu.RLock()
	defer r.codecMu.RUnlock()
	return r.audioCodec
}

func (r *Room) SetVideoCodec(c webrtc.RTPCodecCapability) {
	r.codecMu.Lock()
	defer r.codecMu.Unlock()
	r.videoCodec = c
}

func (r *Room) GetVideoCodec() webrtc.RTPCodecCapability {
	r.codecMu.RLock()
	defer r.codecMu.RUnlock()
	return r.videoCodec
}
