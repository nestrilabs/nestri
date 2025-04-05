package internal

import (
	"fmt"
	"github.com/google/uuid"
	"github.com/pion/webrtc/v4"
	"math/rand"
	"relay/internal/connections"
)

type Participant struct {
	ID             uuid.UUID //< Internal IDs are useful to keeping unique internal track and not have conflicts later
	Name           string
	WebSocket      *connections.SafeWebSocket
	PeerConnection *webrtc.PeerConnection
	DataChannel    *connections.NestriDataChannel
}

func NewParticipant(ws *connections.SafeWebSocket) *Participant {
	return &Participant{
		ID:        uuid.New(),
		Name:      createRandomName(),
		WebSocket: ws,
	}
}

func (p *Participant) AddTrack(trackLocal *webrtc.TrackLocalStaticRTP) error {
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

func (p *Participant) SignalOffer() error {
	if p.PeerConnection == nil {
		return fmt.Errorf("peer connection is nil for participant: '%s' - cannot signal offer", p.ID)
	}

	offer, err := p.PeerConnection.CreateOffer(nil)
	if err != nil {
		return err
	}

	err = p.PeerConnection.SetLocalDescription(offer)
	if err != nil {
		return err
	}

	return p.WebSocket.SendSDPMessageWS(offer)
}

var namesFirst = []string{"Happy", "Sad", "Angry", "Calm", "Excited", "Bored", "Confused", "Confident", "Curious", "Depressed", "Disappointed", "Embarrassed", "Energetic", "Fearful", "Frustrated", "Glad", "Guilty", "Hopeful", "Impatient", "Jealous", "Lonely", "Motivated", "Nervous", "Optimistic", "Pessimistic", "Proud", "Relaxed", "Shy", "Stressed", "Surprised", "Tired", "Worried"}
var namesSecond = []string{"Dragon", "Unicorn", "Troll", "Goblin", "Elf", "Dwarf", "Ogre", "Gnome", "Mermaid", "Siren", "Vampire", "Ghoul", "Werewolf", "Minotaur", "Centaur", "Griffin", "Phoenix", "Wyvern", "Hydra", "Kraken"}

func createRandomName() string {
	randomFirst := namesFirst[rand.Intn(len(namesFirst))]
	randomSecond := namesSecond[rand.Intn(len(namesSecond))]
	return randomFirst + " " + randomSecond
}
