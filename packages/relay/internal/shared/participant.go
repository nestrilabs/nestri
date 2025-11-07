package shared

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"relay/internal/common"
	"relay/internal/connections"
	"sync"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/oklog/ulid/v2"
	"github.com/pion/webrtc/v4"
)

type Participant struct {
	ID             ulid.ULID
	SessionID      string  // Track session for reconnection
	PeerID         peer.ID // libp2p peer ID
	PeerConnection *webrtc.PeerConnection
	DataChannel    *connections.NestriDataChannel

	// Per-viewer tracks and channels
	VideoTrack *webrtc.TrackLocalStaticRTP
	AudioTrack *webrtc.TrackLocalStaticRTP

	// Per-viewer RTP state for retiming
	VideoSequenceNumber uint16
	VideoTimestamp      uint32
	AudioSequenceNumber uint16
	AudioTimestamp      uint32

	packetQueue chan *participantPacket
	closeOnce   sync.Once
}

func NewParticipant(sessionID string, peerID peer.ID) (*Participant, error) {
	id, err := common.NewULID()
	if err != nil {
		return nil, fmt.Errorf("failed to create ULID for Participant: %w", err)
	}
	p := &Participant{
		ID:                  id,
		SessionID:           sessionID,
		PeerID:              peerID,
		VideoSequenceNumber: 0,
		VideoTimestamp:      0,
		AudioSequenceNumber: 0,
		AudioTimestamp:      0,
		packetQueue:         make(chan *participantPacket, 1000),
	}

	go p.packetWriter()

	return p, nil
}

// SetTrack sets audio/video track for Participant
func (p *Participant) SetTrack(trackType webrtc.RTPCodecType, track *webrtc.TrackLocalStaticRTP) {
	switch trackType {
	case webrtc.RTPCodecTypeAudio:
		p.AudioTrack = track
		_, err := p.PeerConnection.AddTrack(track)
		if err != nil {
			slog.Error("Failed to add audio track", "participant", p.ID, "err", err)
		}
	case webrtc.RTPCodecTypeVideo:
		p.VideoTrack = track
		_, err := p.PeerConnection.AddTrack(track)
		if err != nil {
			slog.Error("Failed to add video track", "participant", p.ID, "err", err)
		}
	default:
		slog.Warn("Unknown track type", "participant", p.ID, "trackType", trackType)
	}
}

// Close cleans up participant resources
func (p *Participant) Close() {
	p.closeOnce.Do(func() {
		close(p.packetQueue)
	})
	if p.DataChannel != nil {
		err := p.DataChannel.Close()
		if err != nil {
			slog.Error("Failed to close DataChannel", "participant", p.ID, "err", err)
		}
		p.DataChannel = nil
	}
	if p.PeerConnection != nil {
		err := p.PeerConnection.Close()
		if err != nil {
			slog.Error("Failed to close PeerConnection", "participant", p.ID, "err", err)
		}
		p.PeerConnection = nil
	}
	if p.VideoTrack != nil {
		p.VideoTrack = nil
	}
	if p.AudioTrack != nil {
		p.AudioTrack = nil
	}
}

func (p *Participant) packetWriter() {
	for pkt := range p.packetQueue {
		var track *webrtc.TrackLocalStaticRTP
		var sequenceNumber uint16
		var timestamp uint32

		// No mutex needed - only this goroutine modifies these
		if pkt.kind == webrtc.RTPCodecTypeAudio {
			track = p.AudioTrack
			p.AudioSequenceNumber = uint16(int(p.AudioSequenceNumber) + pkt.sequenceDiff)
			p.AudioTimestamp = uint32(int64(p.AudioTimestamp) + pkt.timeDiff)
			sequenceNumber = p.AudioSequenceNumber
			timestamp = p.AudioTimestamp
		} else {
			track = p.VideoTrack
			p.VideoSequenceNumber = uint16(int(p.VideoSequenceNumber) + pkt.sequenceDiff)
			p.VideoTimestamp = uint32(int64(p.VideoTimestamp) + pkt.timeDiff)
			sequenceNumber = p.VideoSequenceNumber
			timestamp = p.VideoTimestamp
		}

		if track != nil {
			pkt.packet.SequenceNumber = sequenceNumber
			pkt.packet.Timestamp = timestamp

			if err := track.WriteRTP(pkt.packet); err != nil && !errors.Is(err, io.ErrClosedPipe) {
				slog.Error("WriteRTP failed", "participant", p.ID, "kind", pkt.kind, "err", err)
			}
		}

		// Return packet struct to pool
		participantPacketPool.Put(pkt)
	}
}
