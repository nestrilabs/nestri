package relay

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/pion/webrtc/v4"
	"io"
	"log/slog"
	"strings"
)

func ingestHandler(room *Room) {
	relay := GetRelay()
	if relay == nil || relay.MeshManager == nil {
		slog.Error("Mesh system not initialized, defaulting to local ingest", "room", room.Name)
	} else {
		remoteState, exists := relay.MeshManager.GetRoomInfo(room.Name)
		if exists && remoteState.HostingRelayID != relay.ID {
			slog.Info("Redirecting ingest request to remote room", "room", room.Name, "relayID", remoteState.HostingRelayID)

			relay.MeshManager.mutex.RLock()
			peerWS, wsExists := relay.MeshManager.relayWebSockets[remoteState.HostingRelayID]
			relay.MeshManager.mutex.RUnlock()

			if wsExists {
				err := peerWS.SendForwardIngestMessageWS(room.Name)
				if err != nil {
					slog.Error("Failed to forward ingest request", "room", room.Name, "relayID", remoteState.HostingRelayID, "err", err)
				} else {
					slog.Info("Successfully forwarded ingest request", "room", room.Name, "relayID", remoteState.HostingRelayID)
					if room.WebSocket != nil {
						room.WebSocket.Close()
					}
				}
			} else {
				slog.Error("Relay WebSocket not found for forwarding", "relayID", remoteState.HostingRelayID)
			}
			return
		}
	}

	// Callback for closing PeerConnection
	onPCClose := func() {
		slog.Debug("ingest PeerConnection closed", "room", room.Name)
		room.Online = false
		DeleteRoomIfEmpty(room)
	}

	var err error
	room.PeerConnection, err = CreatePeerConnection(onPCClose)
	if err != nil {
		slog.Error("Failed to create ingest PeerConnection", "room", room.Name, "err", err)
		return
	}

	room.PeerConnection.OnTrack(func(remoteTrack *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		localTrack, err := webrtc.NewTrackLocalStaticRTP(remoteTrack.Codec().RTPCodecCapability, remoteTrack.Kind().String(), fmt.Sprint("nestri-", room.Name))
		if err != nil {
			slog.Error("Failed to create local track for room", "room", room.Name, "kind", remoteTrack.Kind(), "err", err)
			return
		}
		slog.Debug("Received track for room", "room", room.Name, "kind", remoteTrack.Kind())

		// Set track and let Room handle state
		room.SetTrack(remoteTrack.Kind(), localTrack)

		// Update the mesh state about room streaming
		if relay != nil && relay.MeshManager != nil {
			relay.MeshManager.state.UpdateRoom(room.Name, relay.ID, true, relay.ID)
			slog.Debug("Updated mesh state for room streaming", "room", room.Name, "relayID", relay.ID)
		}

		rtpBuffer := make([]byte, 1400)
		for {
			read, _, err := remoteTrack.Read(rtpBuffer)
			if err != nil {
				if !errors.Is(err, io.EOF) {
					slog.Error("Failed to read RTP from remote track for room", "room", room.Name, "err", err)
				}
				break
			}
			_, err = localTrack.Write(rtpBuffer[:read])
			if err != nil && !errors.Is(err, io.ErrClosedPipe) {
				slog.Error("Failed to write RTP to local track for room", "room", room.Name, "err", err)
				break
			}
		}

		slog.Debug("Track closed for room", "room", room.Name, "kind", remoteTrack.Kind())

		// Clear track when done
		room.SetTrack(remoteTrack.Kind(), nil)
	})

	room.PeerConnection.OnDataChannel(func(dc *webrtc.DataChannel) {
		room.DataChannel = NewNestriDataChannel(dc)
		slog.Debug("ingest received data channel for room", "room", room.Name)

		room.DataChannel.RegisterOnOpen(func() {
			slog.Debug("ingest DataChannel opened for room", "room", room.Name)
		})

		room.DataChannel.OnClose(func() {
			slog.Debug("ingest DataChannel closed for room", "room", room.Name)
		})

		// We do not handle any messages from ingest via DataChannel yet
	})

	room.PeerConnection.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		slog.Debug("ingest received ICECandidate for room", "room", room.Name)
		err = room.WebSocket.SendICECandidateMessageWS(candidate.ToJSON())
		if err != nil {
			slog.Error("Failed to send ICE candidate message to ingest for room", "room", room.Name, "err", err)
		}
	})

	iceHolder := make([]webrtc.ICECandidateInit, 0)

	// ICE callback
	room.WebSocket.RegisterMessageCallback("ice", func(data []byte) {
		var iceMsg MessageICECandidate
		if err = json.Unmarshal(data, &iceMsg); err != nil {
			slog.Error("Failed to decode ICE candidate message from ingest for room", "room", room.Name, "err", err)
			return
		}
		if room.PeerConnection != nil {
			if room.PeerConnection.RemoteDescription() != nil {
				if err = room.PeerConnection.AddICECandidate(iceMsg.Candidate); err != nil {
					slog.Error("Failed to add ICE candidate for room", "room", room.Name, "err", err)
				}
				for _, heldCandidate := range iceHolder {
					if err = room.PeerConnection.AddICECandidate(heldCandidate); err != nil {
						slog.Error("Failed to add held ICE candidate for room", "room", room.Name, "err", err)
					}
				}
				iceHolder = nil
			} else {
				iceHolder = append(iceHolder, iceMsg.Candidate)
			}
		} else {
			slog.Error("ICE candidate received but PeerConnection is nil for room", "room", room.Name)
		}
	})

	// SDP offer callback
	room.WebSocket.RegisterMessageCallback("sdp", func(data []byte) {
		var sdpMsg MessageSDP
		if err = json.Unmarshal(data, &sdpMsg); err != nil {
			slog.Error("Failed to decode SDP message from ingest for room", "room", room.Name, "err", err)
			return
		}
		answer := handleIngestSDP(room, sdpMsg)
		if answer != nil {
			if err = room.WebSocket.SendSDPMessageWS(*answer); err != nil {
				slog.Error("Failed to send SDP answer message to ingest for room", "room", room.Name, "err", err)
			}
		} else {
			slog.Error("Failed to handle ingest SDP message for room", "room", room.Name)
		}
	})

	// Log callback
	room.WebSocket.RegisterMessageCallback("log", func(data []byte) {
		var logMsg MessageLog
		if err = json.Unmarshal(data, &logMsg); err != nil {
			slog.Error("Failed to decode log message from ingest for room", "room", room.Name, "err", err)
			return
		}
		// TODO: Handle log message sending to metrics server
	})

	// Metrics callback
	room.WebSocket.RegisterMessageCallback("metrics", func(data []byte) {
		var metricsMsg MessageMetrics
		if err = json.Unmarshal(data, &metricsMsg); err != nil {
			slog.Error("Failed to decode metrics message from ingest for room", "room", room.Name, "err", err)
			return
		}
		// TODO: Handle metrics message sending to metrics server
	})

	room.WebSocket.RegisterOnClose(func() {
		slog.Debug("ingest WebSocket closed for room", "room", room.Name)
	})

	slog.Info("Room is ready, sending OK answer to ingest", "room", room.Name)
	if err = room.WebSocket.SendAnswerMessageWS(AnswerOK); err != nil {
		slog.Error("Failed to send OK answer message to ingest for room", "room", room.Name, "err", err)
	}
}

// SDP offer handler, returns SDP answer
func handleIngestSDP(room *Room, offerMsg MessageSDP) *webrtc.SessionDescription {
	var err error

	sdpOffer := offerMsg.SDP.SDP
	sdpOffer = strings.Replace(sdpOffer, ";sprop-maxcapturerate=24000", "", -1)

	err = room.PeerConnection.SetRemoteDescription(webrtc.SessionDescription{
		Type: webrtc.SDPTypeOffer,
		SDP:  sdpOffer,
	})
	if err != nil {
		slog.Error("Failed to set remote description for room", "room", room.Name, "err", err)
		return nil
	}

	answer, err := room.PeerConnection.CreateAnswer(nil)
	if err != nil {
		slog.Error("Failed to create SDP answer for room", "room", room.Name, "err", err)
		return nil
	}

	err = room.PeerConnection.SetLocalDescription(answer)
	if err != nil {
		slog.Error("Failed to set local description for room", "room", room.Name, "err", err)
		return nil
	}

	return &answer
}
