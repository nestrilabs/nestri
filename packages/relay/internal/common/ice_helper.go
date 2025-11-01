package common

import (
	"log/slog"

	"github.com/pion/webrtc/v4"
)

// ICEHelper holds webrtc.ICECandidateInit(s) until remote candidate is set for given webrtc.PeerConnection
// Held candidates should be flushed at the end of negotiation to ensure all are available for connection
type ICEHelper struct {
	candidates []webrtc.ICECandidateInit
	pc         *webrtc.PeerConnection
}

func NewICEHelper(pc *webrtc.PeerConnection) *ICEHelper {
	return &ICEHelper{
		pc:         pc,
		candidates: make([]webrtc.ICECandidateInit, 0),
	}
}

func (ice *ICEHelper) SetPeerConnection(pc *webrtc.PeerConnection) {
	ice.pc = pc
}

func (ice *ICEHelper) AddCandidate(c webrtc.ICECandidateInit) {
	if ice.pc != nil {
		if ice.pc.RemoteDescription() != nil {
			// Add immediately if remote is set
			if err := ice.pc.AddICECandidate(c); err != nil {
				slog.Error("Failed to add ICE candidate", "err", err)
			}
			// Also flush held candidates automatically
			ice.FlushHeldCandidates()
		} else {
			// Hold in slice until remote is set
			ice.candidates = append(ice.candidates, c)
		}
	}
}

func (ice *ICEHelper) FlushHeldCandidates() {
	if ice.pc != nil && len(ice.candidates) > 0 {
		for _, heldCandidate := range ice.candidates {
			if err := ice.pc.AddICECandidate(heldCandidate); err != nil {
				slog.Error("Failed to add held ICE candidate", "err", err)
			}
		}
		// Clear the held candidates
		ice.candidates = make([]webrtc.ICECandidateInit, 0)
	}
}
