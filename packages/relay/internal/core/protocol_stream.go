package core

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"relay/internal/common"
	"relay/internal/connections"
	"relay/internal/shared"

	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

// TODO:s
// TODO: When disconnecting with stream open, causes crash on requester
// TODO: Need to trigger stream request if remote room is online and there are participants in local waiting
// TODO: Cleanup local room state when stream is closed upstream

// --- Protocol IDs ---
const (
	protocolStreamRequest = "/nestri-relay/stream-request/1.0.0" // For requesting a stream from relay
	protocolStreamPush    = "/nestri-relay/stream-push/1.0.0"    // For pushing a stream to relay
)

// --- Protocol Types ---

// StreamConnection is a connection between two relays for stream protocol
type StreamConnection struct {
	pc  *webrtc.PeerConnection
	ndc *connections.NestriDataChannel
}

// StreamProtocol deals with meshed stream forwarding
type StreamProtocol struct {
	relay          *Relay
	servedConns    *common.SafeMap[string, *common.SafeMap[peer.ID, *StreamConnection]] // room name -> (peer ID -> StreamConnection) (for served streams)
	incomingConns  *common.SafeMap[string, *StreamConnection]                           // room name -> StreamConnection (for incoming pushed streams)
	requestedConns *common.SafeMap[string, *StreamConnection]                           // room name -> StreamConnection (for requested streams from other relays)
}

func NewStreamProtocol(relay *Relay) *StreamProtocol {
	protocol := &StreamProtocol{
		relay:          relay,
		servedConns:    common.NewSafeMap[string, *common.SafeMap[peer.ID, *StreamConnection]](),
		incomingConns:  common.NewSafeMap[string, *StreamConnection](),
		requestedConns: common.NewSafeMap[string, *StreamConnection](),
	}

	protocol.relay.Host.SetStreamHandler(protocolStreamRequest, protocol.handleStreamRequest)
	protocol.relay.Host.SetStreamHandler(protocolStreamPush, protocol.handleStreamPush)

	return protocol
}

// --- Protocol Stream Handlers ---

// handleStreamRequest manages a request from another relay for a stream hosted locally
func (sp *StreamProtocol) handleStreamRequest(stream network.Stream) {
	brw := bufio.NewReadWriter(bufio.NewReader(stream), bufio.NewWriter(stream))
	safeBRW := common.NewSafeBufioRW(brw)

	var currentRoomName string // Track the current room for this stream
	iceHolder := make([]webrtc.ICECandidateInit, 0)
	for {
		data, err := safeBRW.Receive()
		if err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, network.ErrReset) {
				slog.Debug("Stream request connection closed by peer", "peer", stream.Conn().RemotePeer())
				return
			}

			slog.Error("Failed to receive data", "err", err)
			_ = stream.Reset()

			return
		}

		var baseMsg connections.MessageBase
		if err = json.Unmarshal(data, &baseMsg); err != nil {
			slog.Error("Failed to unmarshal base message", "err", err)
			continue
		}

		switch baseMsg.Type {
		case "request-stream-room":
			var rawMsg connections.MessageRaw
			if err = json.Unmarshal(data, &rawMsg); err != nil {
				slog.Error("Failed to unmarshal raw message for room stream request", "err", err)
				continue
			}

			var roomName string
			if err = json.Unmarshal(rawMsg.Data, &roomName); err != nil {
				slog.Error("Failed to unmarshal room name from raw message", "err", err)
				continue
			}

			currentRoomName = roomName // Store the room name
			slog.Info("Received stream request for room", "room", roomName)

			room := sp.relay.GetRoomByName(roomName)
			if room == nil || !room.IsOnline() || room.OwnerID != sp.relay.ID {
				// TODO: Allow forward requests to other relays from here?
				slog.Debug("Cannot provide stream for nil, offline or non-owned room", "room", roomName, "is_online", room != nil && room.IsOnline(), "is_owner", room != nil && room.OwnerID == sp.relay.ID)
				// Respond with "request-stream-offline" message with room name
				// TODO: Store the peer and send "online" message when the room comes online
				roomNameData, err := json.Marshal(roomName)
				if err != nil {
					slog.Error("Failed to marshal room name for request stream offline", "room", roomName, "err", err)
					continue
				} else {
					if err = safeBRW.SendJSON(connections.NewMessageRaw(
						"request-stream-offline",
						roomNameData,
					)); err != nil {
						slog.Error("Failed to send request stream offline message", "room", roomName, "err", err)
					}
				}
				continue
			}

			pc, err := common.CreatePeerConnection(func() {
				slog.Info("PeerConnection closed for requested stream", "room", roomName)
				// Cleanup the stream connection
				if roomMap, ok := sp.servedConns.Get(roomName); ok {
					roomMap.Delete(stream.Conn().RemotePeer())
					// If the room map is empty, delete it
					if roomMap.Len() == 0 {
						sp.servedConns.Delete(roomName)
					}
				}
			})
			if err != nil {
				slog.Error("Failed to create PeerConnection for requested stream", "room", roomName, "err", err)
				continue
			}

			// Add tracks
			if room.AudioTrack != nil {
				if _, err = pc.AddTrack(room.AudioTrack); err != nil {
					slog.Error("Failed to add audio track for requested stream", "room", roomName, "err", err)
					continue
				}
			}
			if room.VideoTrack != nil {
				if _, err = pc.AddTrack(room.VideoTrack); err != nil {
					slog.Error("Failed to add video track for requested stream", "room", roomName, "err", err)
					continue
				}
			}

			// DataChannel setup
			settingOrdered := true
			settingMaxRetransmits := uint16(2)
			dc, err := pc.CreateDataChannel("relay-data", &webrtc.DataChannelInit{
				Ordered:        &settingOrdered,
				MaxRetransmits: &settingMaxRetransmits,
			})
			if err != nil {
				slog.Error("Failed to create DataChannel for requested stream", "room", roomName, "err", err)
				continue
			}
			ndc := connections.NewNestriDataChannel(dc)

			ndc.RegisterOnOpen(func() {
				slog.Debug("Relay DataChannel opened for requested stream", "room", roomName)
			})
			ndc.RegisterOnClose(func() {
				slog.Debug("Relay DataChannel closed for requested stream", "room", roomName)
			})
			ndc.RegisterMessageCallback("input", func(data []byte) {
				if room.DataChannel != nil {
					if err = room.DataChannel.SendBinary(data); err != nil {
						slog.Error("Failed to forward input message from mesh to upstream room", "room", roomName, "err", err)
					}
				}
			})

			// ICE Candidate handling
			pc.OnICECandidate(func(candidate *webrtc.ICECandidate) {
				if candidate == nil {
					return
				}

				if err = safeBRW.SendJSON(connections.NewMessageICE("ice-candidate", candidate.ToJSON())); err != nil {
					slog.Error("Failed to send ICE candidate message for requested stream", "room", roomName, "err", err)
					return
				}
			})

			// Create offer
			offer, err := pc.CreateOffer(nil)
			if err != nil {
				slog.Error("Failed to create offer for requested stream", "room", roomName, "err", err)
				continue
			}
			if err = pc.SetLocalDescription(offer); err != nil {
				slog.Error("Failed to set local description for requested stream", "room", roomName, "err", err)
				continue
			}
			if err = safeBRW.SendJSON(connections.NewMessageSDP("offer", offer)); err != nil {
				slog.Error("Failed to send offer for requested stream", "room", roomName, "err", err)
				continue
			}

			// Store the connection
			roomMap, ok := sp.servedConns.Get(roomName)
			if !ok {
				roomMap = common.NewSafeMap[peer.ID, *StreamConnection]()
				sp.servedConns.Set(roomName, roomMap)
			}
			roomMap.Set(stream.Conn().RemotePeer(), &StreamConnection{
				pc:  pc,
				ndc: ndc,
			})

			slog.Debug("Sent offer for requested stream")
		case "ice-candidate":
			var iceMsg connections.MessageICE
			if err := json.Unmarshal(data, &iceMsg); err != nil {
				slog.Error("Failed to unmarshal ICE message", "err", err)
				continue
			}
			// Use currentRoomName to get the connection from nested map
			if len(currentRoomName) > 0 {
				if roomMap, ok := sp.servedConns.Get(currentRoomName); ok {
					if conn, ok := roomMap.Get(stream.Conn().RemotePeer()); ok && conn.pc.RemoteDescription() != nil {
						if err := conn.pc.AddICECandidate(iceMsg.Candidate); err != nil {
							slog.Error("Failed to add ICE candidate", "err", err)
						}
						for _, heldIce := range iceHolder {
							if err := conn.pc.AddICECandidate(heldIce); err != nil {
								slog.Error("Failed to add held ICE candidate", "err", err)
							}
						}
						// Clear the held candidates
						iceHolder = make([]webrtc.ICECandidateInit, 0)
					} else {
						// Hold the candidate until remote description is set
						iceHolder = append(iceHolder, iceMsg.Candidate)
					}
				}
			} else {
				// Hold the candidate until remote description is set
				iceHolder = append(iceHolder, iceMsg.Candidate)
			}
		case "answer":
			var answerMsg connections.MessageSDP
			if err := json.Unmarshal(data, &answerMsg); err != nil {
				slog.Error("Failed to unmarshal answer from signaling message", "err", err)
				continue
			}
			// Use currentRoomName to get the connection from nested map
			if len(currentRoomName) > 0 {
				if roomMap, ok := sp.servedConns.Get(currentRoomName); ok {
					if conn, ok := roomMap.Get(stream.Conn().RemotePeer()); ok {
						if err := conn.pc.SetRemoteDescription(answerMsg.SDP); err != nil {
							slog.Error("Failed to set remote description for answer", "err", err)
							continue
						}
						slog.Debug("Set remote description for answer")
					} else {
						slog.Warn("Received answer without active PeerConnection")
					}
				}
			} else {
				slog.Warn("Received answer without active PeerConnection")
			}
		}
	}
}

// requestStream manages the internals of the stream request
func (sp *StreamProtocol) requestStream(stream network.Stream, room *shared.Room) error {
	brw := bufio.NewReadWriter(bufio.NewReader(stream), bufio.NewWriter(stream))
	safeBRW := common.NewSafeBufioRW(brw)

	slog.Debug("Requesting room stream from peer", "room", room.Name, "peer", stream.Conn().RemotePeer())

	// Send room name to the remote peer
	roomData, err := json.Marshal(room.Name)
	if err != nil {
		_ = stream.Close()
		return fmt.Errorf("failed to marshal room name: %w", err)
	}
	if err = safeBRW.SendJSON(connections.NewMessageRaw(
		"request-stream-room",
		roomData,
	)); err != nil {
		_ = stream.Close()
		return fmt.Errorf("failed to send room request: %w", err)
	}

	pc, err := common.CreatePeerConnection(func() {
		slog.Info("Relay PeerConnection closed for requested stream", "room", room.Name)
		_ = stream.Close() // ignore error as may be closed already
		// Cleanup the stream connection
		if ok := sp.requestedConns.Has(room.Name); ok {
			sp.requestedConns.Delete(room.Name)
		}
	})
	if err != nil {
		_ = stream.Close()
		return fmt.Errorf("failed to create PeerConnection: %w", err)
	}

	pc.OnTrack(func(track *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		localTrack, _ := webrtc.NewTrackLocalStaticRTP(track.Codec().RTPCodecCapability, track.ID(), "relay-"+room.Name+"-"+track.Kind().String())
		slog.Debug("Received track for requested stream", "room", room.Name, "track_kind", track.Kind().String())

		room.SetTrack(track.Kind(), localTrack)

		go func() {
			for {
				rtpPacket, _, err := track.ReadRTP()
				if err != nil {
					if !errors.Is(err, io.EOF) {
						slog.Error("Failed to read RTP packet for requested stream room", "room", room.Name, "err", err)
					}
					break
				}

				err = localTrack.WriteRTP(rtpPacket)
				if err != nil && !errors.Is(err, io.ErrClosedPipe) {
					slog.Error("Failed to write RTP to local track for requested stream room", "room", room.Name, "err", err)
					break
				}
			}
		}()
	})

	pc.OnDataChannel(func(dc *webrtc.DataChannel) {
		ndc := connections.NewNestriDataChannel(dc)
		ndc.RegisterOnOpen(func() {
			slog.Debug("Relay DataChannel opened for requested stream", "room", room.Name)
		})
		ndc.RegisterOnClose(func() {
			slog.Debug("Relay DataChannel closed for requested stream", "room", room.Name)
		})

		// Set the DataChannel in the requestedConns map
		if conn, ok := sp.requestedConns.Get(room.Name); ok {
			conn.ndc = ndc
		} else {
			sp.requestedConns.Set(room.Name, &StreamConnection{
				pc:  pc,
				ndc: ndc,
			})
		}

		// We do not handle any messages from upstream here
	})

	pc.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}

		if err = safeBRW.SendJSON(connections.NewMessageICE(
			"ice-candidate",
			candidate.ToJSON(),
		)); err != nil {
			slog.Error("Failed to send ICE candidate message for requested stream", "room", room.Name, "err", err)
			return
		}
	})

	// Handle incoming messages (offer and candidates)
	go func() {
		iceHolder := make([]webrtc.ICECandidateInit, 0)

		for {
			data, err := safeBRW.Receive()
			if err != nil {
				if errors.Is(err, io.EOF) || errors.Is(err, network.ErrReset) {
					slog.Debug("Connection for requested stream closed by peer", "room", room.Name)
					return
				}

				slog.Error("Failed to receive data for requested stream", "room", room.Name, "err", err)
				_ = stream.Reset()

				return
			}

			var baseMsg connections.MessageBase
			if err = json.Unmarshal(data, &baseMsg); err != nil {
				slog.Error("Failed to unmarshal base message for requested stream", "room", room.Name, "err", err)
				return
			}

			switch baseMsg.Type {
			case "ice-candidate":
				var iceMsg connections.MessageICE
				if err = json.Unmarshal(data, &iceMsg); err != nil {
					slog.Error("Failed to unmarshal ICE candidate for requested stream", "room", room.Name, "err", err)
					continue
				}
				if conn, ok := sp.requestedConns.Get(room.Name); ok && conn.pc.RemoteDescription() != nil {
					if err = conn.pc.AddICECandidate(iceMsg.Candidate); err != nil {
						slog.Error("Failed to add ICE candidate for requested stream", "room", room.Name, "err", err)
					}
					// Add held candidates
					for _, heldCandidate := range iceHolder {
						if err = conn.pc.AddICECandidate(heldCandidate); err != nil {
							slog.Error("Failed to add held ICE candidate for requested stream", "room", room.Name, "err", err)
						}
					}
					// Clear the held candidates
					iceHolder = make([]webrtc.ICECandidateInit, 0)
				} else {
					// Hold the candidate until remote description is set
					iceHolder = append(iceHolder, iceMsg.Candidate)
				}
			case "offer":
				var offerMsg connections.MessageSDP
				if err = json.Unmarshal(data, &offerMsg); err != nil {
					slog.Error("Failed to unmarshal offer for requested stream", "room", room.Name, "err", err)
					continue
				}
				if err = pc.SetRemoteDescription(offerMsg.SDP); err != nil {
					slog.Error("Failed to set remote description for requested stream", "room", room.Name, "err", err)
					continue
				}
				answer, err := pc.CreateAnswer(nil)
				if err != nil {
					slog.Error("Failed to create answer for requested stream", "room", room.Name, "err", err)
					if err = stream.Reset(); err != nil {
						slog.Error("Failed to reset stream for requested stream", "err", err)
					}
					return
				}
				if err = pc.SetLocalDescription(answer); err != nil {
					slog.Error("Failed to set local description for requested stream", "room", room.Name, "err", err)
					if err = stream.Reset(); err != nil {
						slog.Error("Failed to reset stream for requested stream", "err", err)
					}
					return
				}
				if err = safeBRW.SendJSON(connections.NewMessageSDP(
					"answer",
					answer,
				)); err != nil {
					slog.Error("Failed to send answer for requested stream", "room", room.Name, "err", err)
					continue
				}

				// Store the connection
				sp.requestedConns.Set(room.Name, &StreamConnection{
					pc:  pc,
					ndc: nil,
				})

				slog.Debug("Sent answer for requested stream", "room", room.Name)
			default:
				slog.Warn("Unknown signaling message type", "room", room.Name, "type", baseMsg.Type)
			}
		}
	}()

	return nil
}

// handleStreamPush manages a stream push from a node (nestri-server)
func (sp *StreamProtocol) handleStreamPush(stream network.Stream) {
	brw := bufio.NewReadWriter(bufio.NewReader(stream), bufio.NewWriter(stream))
	safeBRW := common.NewSafeBufioRW(brw)

	var room *shared.Room
	iceHolder := make([]webrtc.ICECandidateInit, 0)
	for {
		data, err := safeBRW.Receive()
		if err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, network.ErrReset) {
				slog.Debug("Stream push connection closed by peer", "peer", stream.Conn().RemotePeer(), "error", err)
				return
			}

			slog.Error("Failed to receive data for stream push", "err", err)
			_ = stream.Reset()

			return
		}

		var baseMsg connections.MessageBase
		if err = json.Unmarshal(data, &baseMsg); err != nil {
			slog.Error("Failed to unmarshal base message from base message", "err", err)
			continue
		}

		switch baseMsg.Type {
		case "push-stream-room":
			var rawMsg connections.MessageRaw
			if err = json.Unmarshal(data, &rawMsg); err != nil {
				slog.Error("Failed to unmarshal room name from data", "err", err)
				continue
			}

			var roomName string
			if err = json.Unmarshal(rawMsg.Data, &roomName); err != nil {
				slog.Error("Failed to unmarshal room name from raw message", "err", err)
				continue
			}

			slog.Info("Received stream push request for room", "room", roomName)

			room = sp.relay.GetRoomByName(roomName)
			if room != nil {
				if room.OwnerID != sp.relay.ID {
					slog.Error("Cannot push a stream to non-owned room", "room", room.Name, "owner_id", room.OwnerID)
					continue
				}
				if room.IsOnline() {
					slog.Error("Cannot push a stream to already online room", "room", room.Name)
					continue
				}
			} else {
				// Create a new room if it doesn't exist
				room = sp.relay.CreateRoom(roomName)
			}

			// Respond with an OK with the room name
			roomData, err := json.Marshal(room.Name)
			if err != nil {
				slog.Error("Failed to marshal room name for push stream response", "err", err)
				continue
			}
			if err = safeBRW.SendJSON(connections.NewMessageRaw(
				"push-stream-ok",
				roomData,
			)); err != nil {
				slog.Error("Failed to send push stream OK response", "room", room.Name, "err", err)
				continue
			}
		case "ice-candidate":
			var iceMsg connections.MessageICE
			if err = json.Unmarshal(data, &iceMsg); err != nil {
				slog.Error("Failed to unmarshal ICE candidate from data", "err", err)
				continue
			}
			if conn, ok := sp.incomingConns.Get(room.Name); ok && conn.pc.RemoteDescription() != nil {
				if err = conn.pc.AddICECandidate(iceMsg.Candidate); err != nil {
					slog.Error("Failed to add ICE candidate for pushed stream", "err", err)
				}
				for _, heldIce := range iceHolder {
					if err := conn.pc.AddICECandidate(heldIce); err != nil {
						slog.Error("Failed to add held ICE candidate for pushed stream", "err", err)
					}
				}
				// Clear the held candidates
				iceHolder = make([]webrtc.ICECandidateInit, 0)
			} else {
				// Hold the candidate until remote description is set
				iceHolder = append(iceHolder, iceMsg.Candidate)
			}
		case "offer":
			// Make sure we have room set to push to (set by "push-stream-room")
			if room == nil {
				slog.Error("Received offer without room set for stream push")
				continue
			}

			var offerMsg connections.MessageSDP
			if err = json.Unmarshal(data, &offerMsg); err != nil {
				slog.Error("Failed to unmarshal offer from data", "err", err)
				continue
			}

			// Create PeerConnection for the incoming stream
			pc, err := common.CreatePeerConnection(func() {
				slog.Info("PeerConnection closed for pushed stream", "room", room.Name)
				// Cleanup the stream connection
				if ok := sp.incomingConns.Has(room.Name); ok {
					sp.incomingConns.Delete(room.Name)
				}
			})
			if err != nil {
				slog.Error("Failed to create PeerConnection for pushed stream", "room", room.Name, "err", err)
				continue
			}

			pc.OnDataChannel(func(dc *webrtc.DataChannel) {
				// TODO: Is this the best way to handle DataChannel? Should we just use the map directly?
				room.DataChannel = connections.NewNestriDataChannel(dc)
				room.DataChannel.RegisterOnOpen(func() {
					slog.Debug("DataChannel opened for pushed stream", "room", room.Name)
				})
				room.DataChannel.RegisterOnClose(func() {
					slog.Debug("DataChannel closed for pushed stream", "room", room.Name)
				})
				room.DataChannel.RegisterMessageCallback("input", func(data []byte) {
					if room.DataChannel != nil {
						// Pass to servedConns DataChannels for this specific room
						if roomMap, ok := sp.servedConns.Get(room.Name); ok {
							roomMap.Range(func(peerID peer.ID, conn *StreamConnection) bool {
								if conn.ndc != nil {
									if err = conn.ndc.SendBinary(data); err != nil {
										slog.Error("Failed to forward input message from pushed stream to viewer", "room", room.Name, "peer", peerID, "err", err)
									}
								}
								return true // Continue iteration
							})
						}
					}
				})

				// Set the DataChannel in the incomingConns map
				if conn, ok := sp.incomingConns.Get(room.Name); ok {
					conn.ndc = room.DataChannel
				} else {
					sp.incomingConns.Set(room.Name, &StreamConnection{
						pc:  pc,
						ndc: room.DataChannel,
					})
				}
			})

			pc.OnICECandidate(func(candidate *webrtc.ICECandidate) {
				if candidate == nil {
					return
				}

				if err = safeBRW.SendJSON(connections.NewMessageICE(
					"ice-candidate",
					candidate.ToJSON(),
				)); err != nil {
					slog.Error("Failed to send ICE candidate message for pushed stream", "room", room.Name, "err", err)
					return
				}
			})

			pc.OnTrack(func(remoteTrack *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
				localTrack, err := webrtc.NewTrackLocalStaticRTP(remoteTrack.Codec().RTPCodecCapability, remoteTrack.Kind().String(), fmt.Sprintf("nestri-%s-%s", room.Name, remoteTrack.Kind().String()))
				if err != nil {
					slog.Error("Failed to create local track for pushed stream", "room", room.Name, "track_kind", remoteTrack.Kind().String(), "err", err)
					return
				}

				slog.Debug("Received track for pushed stream", "room", room.Name, "track_kind", remoteTrack.Kind().String())

				// Set track for Room
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

					// Use PlayoutDelayExtension for low latency, if set for this track kind
					if extID, ok := common.GetExtension(remoteTrack.Kind(), common.ExtensionPlayoutDelay); ok {
						if err := rtpPacket.SetExtension(extID, playoutPayload); err != nil {
							slog.Error("Failed to set PlayoutDelayExtension for room", "room", room.Name, "err", err)
							continue
						}
					}

					err = localTrack.WriteRTP(rtpPacket)
					if err != nil && !errors.Is(err, io.ErrClosedPipe) {
						slog.Error("Failed to write RTP to local track for room", "room", room.Name, "err", err)
						break
					}
				}

				slog.Debug("Track closed for room", "room", room.Name, "track_kind", remoteTrack.Kind().String())

				// Cleanup the track from the room
				room.SetTrack(remoteTrack.Kind(), nil)
			})

			// Set the remote description
			if err = pc.SetRemoteDescription(offerMsg.SDP); err != nil {
				slog.Error("Failed to set remote description for pushed stream", "room", room.Name, "err", err)
				continue
			}
			slog.Debug("Set remote description for pushed stream", "room", room.Name)

			// Create an answer
			answer, err := pc.CreateAnswer(nil)
			if err != nil {
				slog.Error("Failed to create answer for pushed stream", "room", room.Name, "err", err)
				continue
			}
			if err = pc.SetLocalDescription(answer); err != nil {
				slog.Error("Failed to set local description for pushed stream", "room", room.Name, "err", err)
				continue
			}
			if err = safeBRW.SendJSON(connections.NewMessageSDP(
				"answer",
				answer,
			)); err != nil {
				slog.Error("Failed to send answer for pushed stream", "room", room.Name, "err", err)
			}

			// Store the connection
			sp.incomingConns.Set(room.Name, &StreamConnection{
				pc:  pc,
				ndc: room.DataChannel, // if it exists, if not it will be set later
			})
			slog.Debug("Sent answer for pushed stream", "room", room.Name)
		}
	}
}

// --- Public Usable Methods ---

// RequestStream sends a request to get room stream from another relay
func (sp *StreamProtocol) RequestStream(ctx context.Context, room *shared.Room, peerID peer.ID) error {
	stream, err := sp.relay.Host.NewStream(ctx, peerID, protocolStreamRequest)
	if err != nil {
		return fmt.Errorf("failed to create stream: %w", err)
	}

	return sp.requestStream(stream, room)
}
