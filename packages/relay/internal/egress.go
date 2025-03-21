package relay

import (
	"encoding/json"
	"github.com/google/uuid"
	"github.com/pion/webrtc/v4"
	"google.golang.org/protobuf/proto"
	"log/slog"
	gen "relay/internal/proto"
)

func participantHandler(participant *Participant, room *Room) {
	relay := GetRelay()
	if relay == nil || relay.MeshManager == nil {
		slog.Debug("Mesh system not initialized, defaulting to local room handling", "room", room.Name)
	} else {
		remoteState, exists := relay.MeshManager.GetRoomInfo(room.Name)
		slog.Debug("Participant checking room state", "room", room.Name, "exists", exists, "remoteState", remoteState)
		if exists {
			if remoteState.HostingRelayID != relay.ID && remoteState.Online {
				// Room is hosted remotely and streaming, request the stream
				slog.Debug("Requesting stream from remote relay", "room", room.Name, "relayID", remoteState.HostingRelayID)
				requestStreamFromRelay(remoteState.HostingRelayID, room)
				// Continue to allow participant setup while stream is requested
			} else if remoteState.HostingRelayID == relay.ID && remoteState.Online != room.Online {
				// Local state mismatch, log a warning only if it’s unexpected
				slog.Warn("Local room state mismatch with MeshState",
					"room", room.Name,
					"localOnline", room.Online,
					"meshOnline", remoteState.Online)
			}
			// No else needed: if hosted locally and not online, or not hosted remotely, proceed normally
		}
	}

	onPCClose := func() {
		slog.Debug("participant PeerConnection closed", "participant", participant.ID, "room", room.Name)
		room.removeParticipantByID(participant.ID)
	}

	var err error
	participant.PeerConnection, err = CreatePeerConnection(onPCClose)
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
	participant.DataChannel = NewNestriDataChannel(dc)

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
		// Send to room if it has a DataChannel
		if room.DataChannel != nil {
			// If debug mode, decode and add our timestamp, otherwise just send to room
			if GetFlags().Debug {
				var inputMsg gen.ProtoMessageInput
				if err = proto.Unmarshal(data, &inputMsg); err != nil {
					slog.Error("Failed to decode input message from participant", "participant", participant.ID, "room", room.Name, "err", err)
					return
				}

				protoLat := inputMsg.GetMessageBase().GetLatency()
				if protoLat != nil {
					lat := LatencyTrackerFromProto(protoLat)
					lat.AddTimestamp("relay_to_node")
					protoLat = lat.ToProto()
				}

				// Marshal and send
				if data, err = proto.Marshal(&inputMsg); err != nil {
					slog.Error("Failed to marshal input message from participant", "participant", participant.ID, "room", room.Name, "err", err)
					return
				}
			}

			if err = room.DataChannel.SendBinary(data); err != nil {
				slog.Error("Failed to send input message to room", "participant", participant.ID, "room", room.Name, "err", err)
				return
			}
		}
	})

	participant.PeerConnection.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}

		if relay != nil && relay.MeshManager != nil {
			remoteState, exists := relay.MeshManager.GetRoomInfo(room.Name)
			if exists && remoteState.HostingRelayID != relay.ID {
				slog.Debug("Forwarding ICE candidate to remote relay", "participant", participant.ID, "relayID", remoteState.HostingRelayID)

				relay.MeshManager.mutex.RLock()
				peerWS, wsExists := relay.MeshManager.relayWebSockets[remoteState.HostingRelayID]
				relay.MeshManager.mutex.RUnlock()

				if wsExists {
					err := peerWS.SendForwardICEMessageWS(participant.ID.String(), candidate.ToJSON())
					if err != nil {
						slog.Error("Failed to forward ICE candidate", "participant", participant.ID, "relayID", remoteState.HostingRelayID, "err", err)
					}
				} else {
					slog.Error("Relay WebSocket not found for ICE forwarding", "relayID", remoteState.HostingRelayID)
				}
			} else {
				slog.Debug("Handling ICE candidate locally", "participant", participant.ID)
				err := participant.WebSocket.SendICECandidateMessageWS(candidate.ToJSON())
				if err != nil {
					slog.Error("Failed to send ICE candidate to local participant", "participant", participant.ID, "err", err)
				}
			}
		}
	})

	iceHolder := make([]webrtc.ICECandidateInit, 0)

	// ICE callback
	participant.WebSocket.RegisterMessageCallback("ice", func(data []byte) {
		var iceMsg MessageICECandidate
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
		var sdpMsg MessageSDP
		if err = json.Unmarshal(data, &sdpMsg); err != nil {
			slog.Error("Failed to decode SDP message from participant", "participant", participant.ID, "room", room.Name, "err", err)
			return
		}
		handleParticipantSDP(participant, sdpMsg)
	})

	// Log callback
	participant.WebSocket.RegisterMessageCallback("log", func(data []byte) {
		var logMsg MessageLog
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
	if err := participant.WebSocket.SendAnswerMessageWS(AnswerOK); err != nil {
		slog.Error("Failed to send OK answer", "participant", participant.ID, "room", room.Name, "err", err)
	}

	// If room is online, also send offer
	if room.Online {
		if room.AudioTrack != nil {
			if err := participant.addTrack(room.AudioTrack); err != nil {
				slog.Error("Failed to add audio track", "participant", participant.ID, "room", room.Name, "err", err)
			}
		}
		if room.VideoTrack != nil {
			if err := participant.addTrack(room.VideoTrack); err != nil {
				slog.Error("Failed to add video track", "participant", participant.ID, "room", room.Name, "err", err)
			}
		}
		if err := participant.signalOffer(); err != nil {
			slog.Error("Failed to signal offer", "participant", participant.ID, "room", room.Name, "err", err)
		}
	}
}

// SDP answer handler for participants
func handleParticipantSDP(participant *Participant, answerMsg MessageSDP) {
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

func forwardParticipantToRelay(participant *Participant, targetRelay uuid.UUID) {
	relay := GetRelay()
	if relay == nil {
		slog.Error("Relay instance is nil, cannot forward participant")
		return
	}

	// Find WebSocket connection for target relay
	relay.MeshManager.mutex.RLock()
	peerWS, exists := relay.MeshManager.relayWebSockets[targetRelay]
	relay.MeshManager.mutex.RUnlock()

	if !exists {
		slog.Error("Target relay not found in mesh network", "relayID", targetRelay)
		return
	}

	// Create an SDP offer
	offer, err := participant.PeerConnection.CreateOffer(nil)
	if err != nil {
		slog.Error("Failed to create SDP offer for participant", "participant", participant.ID, "err", err)
		return
	}

	err = participant.PeerConnection.SetLocalDescription(offer)
	if err != nil {
		slog.Error("Failed to set local SDP description", "participant", participant.ID, "err", err)
		return
	}

	// Send the SDP offer to the target relay
	message := map[string]interface{}{
		"type":          "forward_sdp",
		"participantID": participant.ID,
		"sdp":           offer.SDP,
	}

	err = peerWS.SendJSON(message)
	if err != nil {
		slog.Error("Failed to send SDP offer to relay", "relayID", targetRelay, "err", err)
		return
	}

	slog.Info("Forwarded SDP offer to remote relay", "participant", participant.ID, "targetRelay", targetRelay)
}
