package shared

import (
	"fmt"
	"log/slog"
	"relay/internal/common"
	"relay/internal/connections"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/oklog/ulid/v2"
	"github.com/pion/rtp"
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
	VideoChan  chan *rtp.Packet
	AudioChan  chan *rtp.Packet
}

func NewParticipant(sessionID string, peerID peer.ID) (*Participant, error) {
	id, err := common.NewULID()
	if err != nil {
		return nil, fmt.Errorf("failed to create ULID for Participant: %w", err)
	}
	return &Participant{
		ID:        id,
		SessionID: sessionID,
		PeerID:    peerID,
		VideoChan: make(chan *rtp.Packet, 500),
		AudioChan: make(chan *rtp.Packet, 100),
	}, nil
}

// Close cleans up participant resources
func (p *Participant) Close() {
	if p.VideoChan != nil {
		close(p.VideoChan)
		p.VideoChan = nil
	}
	if p.AudioChan != nil {
		close(p.AudioChan)
		p.AudioChan = nil
	}
	if p.PeerConnection != nil {
		err := p.PeerConnection.Close()
		if err != nil {
			slog.Error("Failed to close Participant PeerConnection", err)
		}
		p.PeerConnection = nil
	}
}
