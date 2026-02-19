package shared

import (
	"errors"
	"fmt"
	"github.com/pion/rtp"
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
	flags := common.GetFlags()
	playoutExt := &rtp.PlayoutDelayExtension{
		MinDelay: uint16(flags.PlayoutDelayMin),
		MaxDelay: uint16(flags.PlayoutDelayMax),
	}
	playoutPayload, err := playoutExt.Marshal()
	if err != nil {
		slog.Error("Failed to marshal PlayoutDelayExtension for participant", "participant", p.ID, "err", err)
		return
	}

	for pkt := range p.packetQueue {
		var track *webrtc.TrackLocalStaticRTP

		// No mutex needed - only this goroutine modifies these
		if pkt.kind == webrtc.RTPCodecTypeAudio {
			track = p.AudioTrack
		} else {
			track = p.VideoTrack
		}

		// Use PlayoutDelayExtension for low latency, if set for this track kind
		if extID, ok := common.GetExtension(track.Kind(), common.ExtensionPlayoutDelay); ok {
			if err = pkt.packet.SetExtension(extID, playoutPayload); err != nil {
				slog.Error("Failed to set PlayoutDelayExtension for participant", "participant", p.ID, "err", err)
				continue
			}
		}

		if track != nil {
			if err := track.WriteRTP(pkt.packet); err != nil && !errors.Is(err, io.ErrClosedPipe) {
				slog.Error("WriteRTP failed", "participant", p.ID, "kind", pkt.kind, "err", err)
			}
		}

		// Return packet struct to pool
		participantPacketPool.Put(pkt)
	}
}
