package internal

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
	"io"
	"log/slog"
	"relay/internal/common"
	"relay/internal/connections"
	"strings"
)

func IngestHandler(room *Room) {
	relay := GetRelay()

	// Callback for closing PeerConnection
	onPCClose := func() {
		slog.Debug("ingest PeerConnection closed", "room", room.Name)
		room.Online = false
		room.signalParticipantsOffline()
		relay.DeleteRoomIfEmpty(room)
	}

	var err error
	room.PeerConnection, err = common.CreatePeerConnection(onPCClose)
	if err != nil {
		slog.Error("Failed to create ingest PeerConnection", "room", room.Name, "err", err)
		return
	}

	room.PeerConnection.OnTrack(func(remoteTrack *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		localTrack, err := webrtc.NewTrackLocalStaticRTP(remoteTrack.Codec().RTPCodecCapability, remoteTrack.Kind().String(), fmt.Sprintf("nestri-%s-%s", room.Name, remoteTrack.Kind().String()))
		if err != nil {
			slog.Error("Failed to create local track for room", "room", room.Name, "kind", remoteTrack.Kind(), "err", err)
			return
		}
		slog.Debug("Received track for room", "room", room.Name, "kind", remoteTrack.Kind())

		// Set track and let Room handle state
		room.SetTrack(remoteTrack.Kind(), localTrack)

		// Prepare PlayoutDelayExtension so we don't need to recreate it for each packet
		playoutExt := &rtp.PlayoutDelayExtension{
			MinDelay: 0,
			MaxDelay: 0,
		}
		playoutPayload, err := playoutExt.Marshal()
		if err != nil {
			slog.Error("Failed to marshal PlayoutDelayExtension for room", "room", room.Name, "err", err)
			return
		}

		for {
			rtpPacket, _, err := remoteTrack.ReadRTP()
			if err != nil {
				if !errors.Is(err, io.EOF) {
					slog.Error("Failed to read RTP from remote track for room", "room", room.Name, "err", err)
				}
				break
			}

			// Use PlayoutDelayExtension for low latency, only for video tracks
			if err := rtpPacket.SetExtension(common.ExtensionMap[common.ExtensionPlayoutDelay], playoutPayload); err != nil {
				slog.Error("Failed to set PlayoutDelayExtension for room", "room", room.Name, "err", err)
				continue
			}

			err = localTrack.WriteRTP(rtpPacket)
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
		room.DataChannel = connections.NewNestriDataChannel(dc)
		slog.Debug("Ingest received DataChannel for room", "room", room.Name)

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
		var iceMsg connections.MessageICECandidate
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
				iceHolder = make([]webrtc.ICECandidateInit, 0)
			} else {
				iceHolder = append(iceHolder, iceMsg.Candidate)
			}
		} else {
			slog.Error("ICE candidate received but PeerConnection is nil for room", "room", room.Name)
		}
	})

	// SDP offer callback
	room.WebSocket.RegisterMessageCallback("sdp", func(data []byte) {
		var sdpMsg connections.MessageSDP
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
		var logMsg connections.MessageLog
		if err = json.Unmarshal(data, &logMsg); err != nil {
			slog.Error("Failed to decode log message from ingest for room", "room", room.Name, "err", err)
			return
		}
		// TODO: Handle log message sending to metrics server
	})

	// Metrics callback
	room.WebSocket.RegisterMessageCallback("metrics", func(data []byte) {
		var metricsMsg connections.MessageMetrics
		if err = json.Unmarshal(data, &metricsMsg); err != nil {
			slog.Error("Failed to decode metrics message from ingest for room", "room", room.Name, "err", err)
			return
		}
		// TODO: Handle metrics message sending to metrics server
	})

	room.WebSocket.RegisterOnClose(func() {
		slog.Debug("ingest WebSocket closed for room", "room", room.Name)
		room.Online = false
		room.signalParticipantsOffline()
		relay.DeleteRoomIfEmpty(room)
	})

	slog.Info("Room is ready, sending OK answer to ingest", "room", room.Name)
	if err = room.WebSocket.SendAnswerMessageWS(connections.AnswerOK); err != nil {
		slog.Error("Failed to send OK answer message to ingest for room", "room", room.Name, "err", err)
	}
}

// SDP offer handler, returns SDP answer
func handleIngestSDP(room *Room, offerMsg connections.MessageSDP) *webrtc.SessionDescription {
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
