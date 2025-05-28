package shared

import (
	"fmt"
	"relay/internal/common"
	"relay/internal/connections"

	"github.com/oklog/ulid/v2"
	"github.com/pion/webrtc/v4"
)

type Participant struct {
	ID             ulid.ULID
	PeerConnection *webrtc.PeerConnection
	DataChannel    *connections.NestriDataChannel
}

func NewParticipant() (*Participant, error) {
	id, err := common.NewULID()
	if err != nil {
		return nil, fmt.Errorf("failed to create ULID for Participant: %w", err)
	}
	return &Participant{
		ID: id,
	}, nil
}

func (p *Participant) addTrack(trackLocal *webrtc.TrackLocalStaticRTP) error {
	rtpSender, err := p.PeerConnection.AddTrack(trackLocal)
	if err != nil {
		return err
	}

	go func() {
		rtcpBuffer := make([]byte, 1400)
		for {
			if _, _, rtcpErr := rtpSender.Read(rtcpBuffer); rtcpErr != nil {
				break
			}
		}
	}()

	return nil
}
