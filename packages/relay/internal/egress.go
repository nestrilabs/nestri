package internal

import (
	"context"
	"encoding/json"
	"github.com/pion/webrtc/v4"
	"google.golang.org/protobuf/proto"
	"log/slog"
	"relay/internal/common"
	"relay/internal/connections"
	gen "relay/internal/proto"
)

func ParticipantHandler(participant *Participant, room *Room, relay *Relay) {
	onPCClose := func() {
		slog.Debug("Participant PeerConnection closed", "participant", participant.ID, "room", room.Name)
		room.removeParticipantByID(participant.ID)
	}

	var err error
	participant.PeerConnection, err = common.CreatePeerConnection(onPCClose)
	if err != nil {
		slog.Error("Failed to create participant PeerConnection", "participant", participant.ID, "room", room.Name, "err", err)
		return
	}

	// Data channel settings
	settingOrdered := true
	settingMaxRetransmits := uint16(0)
	dc, err := participant.PeerConnection.CreateDataChannel("data", &webrtc.DataChannelInit{
		Ordered:        &settingOrdered,
		MaxRetransmits: &settingMaxRetransmits,
	})
	if err != nil {
		slog.Error("Failed to create data channel for participant", "participant", participant.ID, "room", room.Name, "err", err)
		return
	}
	participant.DataChannel = connections.NewNestriDataChannel(dc)

	// Register channel opening handling
	participant.DataChannel.RegisterOnOpen(func() {
		slog.Debug("DataChannel opened for participant", "participant", participant.ID, "room", room.Name)
	})

	// Register channel closing handling
	participant.DataChannel.RegisterOnClose(func() {
		slog.Debug("DataChannel closed for participant", "participant", participant.ID, "room", room.Name)
	})

	// Register text message handling
	participant.DataChannel.RegisterMessageCallback("input", func(data []byte) {
		ForwardParticipantDataChannelMessage(participant, room, data)
	})

	participant.PeerConnection.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		if err := participant.WebSocket.SendICECandidateMessageWS(candidate.ToJSON()); err != nil {
			slog.Error("Failed to send ICE candidate to participant", "participant", participant.ID, "room", room.Name, "err", err)
		}
	})

	iceHolder := make([]webrtc.ICECandidateInit, 0)

	// ICE callback
	participant.WebSocket.RegisterMessageCallback("ice", func(data []byte) {
		var iceMsg connections.MessageICECandidate
		if err = json.Unmarshal(data, &iceMsg); err != nil {
			slog.Error("Failed to decode ICE candidate message from participant", "participant", participant.ID, "room", room.Name, "err", err)
			return
		}
		if participant.PeerConnection.RemoteDescription() != nil {
			if err = participant.PeerConnection.AddICECandidate(iceMsg.Candidate); err != nil {
				slog.Error("Failed to add ICE candidate for participant", "participant", participant.ID, "room", room.Name, "err", err)
			}
			// Add held ICE candidates
			for _, heldCandidate := range iceHolder {
				if err = participant.PeerConnection.AddICECandidate(heldCandidate); err != nil {
					slog.Error("Failed to add held ICE candidate for participant", "participant", participant.ID, "room", room.Name, "err", err)
				}
			}
			iceHolder = nil
		} else {
			iceHolder = append(iceHolder, iceMsg.Candidate)
		}
	})

	// SDP answer callback
	participant.WebSocket.RegisterMessageCallback("sdp", func(data []byte) {
		var sdpMsg connections.MessageSDP
		if err = json.Unmarshal(data, &sdpMsg); err != nil {
			slog.Error("Failed to decode SDP message from participant", "participant", participant.ID, "room", room.Name, "err", err)
			return
		}
		handleParticipantSDP(participant, sdpMsg)
	})

	// Log callback
	participant.WebSocket.RegisterMessageCallback("log", func(data []byte) {
		var logMsg connections.MessageLog
		if err = json.Unmarshal(data, &logMsg); err != nil {
			slog.Error("Failed to decode log message from participant", "participant", participant.ID, "room", room.Name, "err", err)
			return
		}
		// TODO: Handle log message sending to metrics server
	})

	// Metrics callback
	participant.WebSocket.RegisterMessageCallback("metrics", func(data []byte) {
		// Ignore for now
	})

	participant.WebSocket.RegisterOnClose(func() {
		slog.Debug("WebSocket closed for participant", "participant", participant.ID, "room", room.Name)
		// Remove from Room
		room.removeParticipantByID(participant.ID)
	})

	slog.Info("Participant ready, sending OK answer", "participant", participant.ID, "room", room.Name)
	if err := participant.WebSocket.SendAnswerMessageWS(connections.AnswerOK); err != nil {
		slog.Error("Failed to send OK answer", "participant", participant.ID, "room", room.Name, "err", err)
	}

	// If room is online, also send offer
	if room.Online {
		if err = room.signalParticipantWithTracks(participant); err != nil {
			slog.Error("Failed to signal participant with tracks", "participant", participant.ID, "room", room.Name, "err", err)
		}
	} else {
		active, provider := relay.IsRoomActive(room.ID)
		if active {
			slog.Debug("Room active remotely, requesting stream", "room", room.Name, "provider", provider)
			if _, err := relay.requestStream(context.Background(), room.Name, room.ID, provider); err != nil {
				slog.Error("Failed to request stream", "room", room.Name, "err", err)
			} else {
				slog.Debug("Stream requested successfully", "room", room.Name, "provider", provider)
			}
		}
	}
}

// SDP answer handler for participants
func handleParticipantSDP(participant *Participant, answerMsg connections.MessageSDP) {
	// Get SDP offer
	sdpAnswer := answerMsg.SDP.SDP

	// Set remote description
	err := participant.PeerConnection.SetRemoteDescription(webrtc.SessionDescription{
		Type: webrtc.SDPTypeAnswer,
		SDP:  sdpAnswer,
	})
	if err != nil {
		slog.Error("Failed to set remote SDP answer for participant", "participant", participant.ID, "err", err)
	}
}

func ForwardParticipantDataChannelMessage(participant *Participant, room *Room, data []byte) {
	// Debug mode: Add latency timestamp
	if common.GetFlags().Debug {
		var inputMsg gen.ProtoMessageInput
		if err := proto.Unmarshal(data, &inputMsg); err != nil {
			slog.Error("Failed to decode input message from participant", "participant", participant.ID, "room", room.Name, "err", err)
			return
		}
		protoLat := inputMsg.GetMessageBase().GetLatency()
		if protoLat != nil {
			lat := common.LatencyTrackerFromProto(protoLat)
			lat.AddTimestamp("relay_to_node")
			protoLat = lat.ToProto()
		}
		if newData, err := proto.Marshal(&inputMsg); err != nil {
			slog.Error("Failed to marshal input message from participant", "participant", participant.ID, "room", room.Name, "err", err)
			return
		} else {
			// Update data with the modified message
			data = newData
		}
	}

	// Forward to local room DataChannel if it exists (e.g., local ingest)
	if room.DataChannel != nil {
		if err := room.DataChannel.SendBinary(data); err != nil {
			slog.Error("Failed to send input message to room", "participant", participant.ID, "room", room.Name, "err", err)
		}
	}
}
