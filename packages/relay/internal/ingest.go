package relay

import (
	"errors"
	"fmt"
	"github.com/pion/webrtc/v4"
	"io"
	"log"
	"strings"
)

func ingestHandler(room *Room) {
	// Callback for closing PeerConnection
	onPCClose := func() {
		if GetFlags().Verbose {
			log.Printf("Closed PeerConnection for room: '%s'\n", room.Name)
		}
		room.Online = false
		DeleteRoomIfEmpty(room)
	}

	var err error
	room.PeerConnection, err = CreatePeerConnection(onPCClose)
	if err != nil {
		log.Printf("Failed to create PeerConnection for room: '%s' - reason: %s\n", room.Name, err)
		return
	}

	room.PeerConnection.OnTrack(func(remoteTrack *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		var localTrack *webrtc.TrackLocalStaticRTP
		if remoteTrack.Kind() == webrtc.RTPCodecTypeVideo {
			if GetFlags().Verbose {
				log.Printf("Received video track for room: '%s'\n", room.Name)
			}
			localTrack, err = webrtc.NewTrackLocalStaticRTP(remoteTrack.Codec().RTPCodecCapability, "video", fmt.Sprint("nestri-", room.Name))
			if err != nil {
				log.Printf("Failed to create local video track for room: '%s' - reason: %s\n", room.Name, err)
				return
			}
			room.VideoTrack = localTrack
		} else if remoteTrack.Kind() == webrtc.RTPCodecTypeAudio {
			if GetFlags().Verbose {
				log.Printf("Received audio track for room: '%s'\n", room.Name)
			}
			localTrack, err = webrtc.NewTrackLocalStaticRTP(remoteTrack.Codec().RTPCodecCapability, "audio", fmt.Sprint("nestri-", room.Name))
			if err != nil {
				log.Printf("Failed to create local audio track for room: '%s' - reason: %s\n", room.Name, err)
				return
			}
			room.AudioTrack = localTrack
		}

		// If both audio and video tracks are set, set online state
		if room.AudioTrack != nil && room.VideoTrack != nil {
			room.Online = true
			if GetFlags().Verbose {
				log.Printf("Room online and receiving: '%s' - signaling participants\n", room.Name)
			}
			room.signalParticipantsWithTracks()
		}

		rtpBuffer := make([]byte, 1400)
		for {
			read, _, err := remoteTrack.Read(rtpBuffer)
			if err != nil {
				// EOF is expected when stopping room
				if !errors.Is(err, io.EOF) {
					log.Printf("RTP read error from room: '%s' - reason: %s\n", room.Name, err)
				}
				break
			}

			_, err = localTrack.Write(rtpBuffer[:read])
			if err != nil && !errors.Is(err, io.ErrClosedPipe) {
				log.Printf("Failed to write RTP to local track for room: '%s' - reason: %s\n", room.Name, err)
				break
			}
		}

		if remoteTrack.Kind() == webrtc.RTPCodecTypeVideo {
			room.VideoTrack = nil
		} else if remoteTrack.Kind() == webrtc.RTPCodecTypeAudio {
			room.AudioTrack = nil
		}

		if room.VideoTrack == nil && room.AudioTrack == nil {
			room.Online = false
			if GetFlags().Verbose {
				log.Printf("Room offline and not receiving: '%s'\n", room.Name)
			}
			// Signal participants of room offline
			room.signalParticipantsOffline()
			DeleteRoomIfEmpty(room)
		}
	})

	room.PeerConnection.OnDataChannel(func(dc *webrtc.DataChannel) {
		room.DataChannel = NewNestriDataChannel(dc)
		if GetFlags().Verbose {
			log.Printf("New DataChannel for room: '%s' - '%s'\n", room.Name, room.DataChannel.Label())
		}

		// Register channel opening handling
		room.DataChannel.RegisterOnOpen(func() {
			if GetFlags().Verbose {
				log.Printf("DataChannel for room: '%s' - '%s' open\n", room.Name, room.DataChannel.Label())
			}
		})

		room.DataChannel.OnClose(func() {
			if GetFlags().Verbose {
				log.Printf("DataChannel for room: '%s' - '%s' closed\n", room.Name, room.DataChannel.Label())
			}
		})

		// We do not handle any messages from ingest via DataChannel yet
	})

	room.PeerConnection.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		if GetFlags().Verbose {
			log.Printf("ICE candidate for room: '%s'\n", room.Name)
		}
		err = room.WebSocket.SendICECandidateMessageWS(candidate.ToJSON())
		if err != nil {
			log.Printf("Failed to send ICE candidate for room: '%s' - reason: %s\n", room.Name, err)
		}
	})

	iceHolder := make([]webrtc.ICECandidateInit, 0)

	// ICE callback
	room.WebSocket.RegisterMessageCallback("ice", func(data []byte) {
		var iceMsg MessageICECandidate
		if err = DecodeMessage(data, &iceMsg); err != nil {
			log.Printf("Failed to decode ICE candidate message from ingest for room: '%s' - reason: %s\n", room.Name, err)
			return
		}
		candidate := webrtc.ICECandidateInit{
			Candidate: iceMsg.Candidate.Candidate,
		}
		if room.PeerConnection != nil {
			// If remote isn't set yet, store ICE candidates
			if room.PeerConnection.RemoteDescription() != nil {
				if err = room.PeerConnection.AddICECandidate(candidate); err != nil {
					log.Printf("Failed to add ICE candidate for room: '%s' - reason: %s\n", room.Name, err)
				}
				// Add any held ICE candidates
				for _, heldCandidate := range iceHolder {
					if err = room.PeerConnection.AddICECandidate(heldCandidate); err != nil {
						log.Printf("Failed to add held ICE candidate for room: '%s' - reason: %s\n", room.Name, err)
					}
				}
				iceHolder = nil
			} else {
				iceHolder = append(iceHolder, candidate)
			}
		} else {
			log.Printf("ICE candidate received before PeerConnection for room: '%s'\n", room.Name)
		}
	})

	// SDP offer callback
	room.WebSocket.RegisterMessageCallback("sdp", func(data []byte) {
		var sdpMsg MessageSDP
		if err = DecodeMessage(data, &sdpMsg); err != nil {
			log.Printf("Failed to decode SDP message from ingest for room: '%s' - reason: %s\n", room.Name, err)
			return
		}
		answer := handleIngestSDP(room, sdpMsg)
		if answer != nil {
			if err = room.WebSocket.SendSDPMessageWS(*answer); err != nil {
				log.Printf("Failed to send SDP answer to ingest for room: '%s' - reason: %s\n", room.Name, err)
			}
		} else {
			log.Printf("Failed to handle SDP message from ingest for room: '%s'\n", room.Name)
		}
	})

	// Log callback
	room.WebSocket.RegisterMessageCallback("log", func(data []byte) {
		var logMsg MessageLog
		if err = DecodeMessage(data, &logMsg); err != nil {
			log.Printf("Failed to decode log message from ingest for room: '%s' - reason: %s\n", room.Name, err)
			return
		}
		// TODO: Handle log message sending to metrics server
	})

	// Metrics callback
	room.WebSocket.RegisterMessageCallback("metrics", func(data []byte) {
		var metricsMsg MessageMetrics
		if err = DecodeMessage(data, &metricsMsg); err != nil {
			log.Printf("Failed to decode metrics message from ingest for room: '%s' - reason: %s\n", room.Name, err)
			return
		}
		// TODO: Handle metrics message sending to metrics server
	})

	room.WebSocket.RegisterOnClose(func() {
		// If PeerConnection is still open, close it
		if room.PeerConnection != nil {
			if err = room.PeerConnection.Close(); err != nil {
				log.Printf("Failed to close PeerConnection for room: '%s' - reason: %s\n", room.Name, err)
			}
			room.PeerConnection = nil
		}
		room.Online = false
		DeleteRoomIfEmpty(room)
	})

	log.Printf("Room: '%s' is ready, sending an OK\n", room.Name)
	if err = room.WebSocket.SendAnswerMessageWS(AnswerOK); err != nil {
		log.Printf("Failed to send OK answer for room: '%s' - reason: %s\n", room.Name, err)
	}
}

// SDP offer handler, returns SDP answer
func handleIngestSDP(room *Room, offerMsg MessageSDP) *webrtc.SessionDescription {
	var err error

	// Get SDP offer
	sdpOffer := offerMsg.SDP.SDP

	// Modify SDP offer to remove opus "sprop-maxcapturerate=24000" (fixes opus bad quality issue, present in GStreamer)
	sdpOffer = strings.Replace(sdpOffer, ";sprop-maxcapturerate=24000", "", -1)

	// Set new remote description
	err = room.PeerConnection.SetRemoteDescription(webrtc.SessionDescription{
		Type: webrtc.SDPTypeOffer,
		SDP:  sdpOffer,
	})
	if err != nil {
		log.Printf("Failed to set remote description for room: '%s' - reason: %s\n", room.Name, err)
		return nil
	}

	// Create SDP answer
	answer, err := room.PeerConnection.CreateAnswer(nil)
	if err != nil {
		log.Printf("Failed to create SDP answer for room: '%s' - reason: %s\n", room.Name, err)
		return nil
	}

	// Set local description
	err = room.PeerConnection.SetLocalDescription(answer)
	if err != nil {
		log.Printf("Failed to set local description for room: '%s' - reason: %s\n", room.Name, err)
		return nil
	}

	return &answer
}
