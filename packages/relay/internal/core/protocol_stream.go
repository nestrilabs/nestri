package core

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"relay/internal/common"
	"relay/internal/connections"
	"relay/internal/shared"

	gen "relay/internal/proto"

	"google.golang.org/protobuf/proto"

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
	iceHelper := common.NewICEHelper(nil)
	for {
		var msgWrapper gen.ProtoMessage
		err := safeBRW.ReceiveProto(&msgWrapper)
		if err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, network.ErrReset) {
				slog.Debug("Stream request connection closed by peer", "peer", stream.Conn().RemotePeer())
				return
			}

			slog.Error("Failed to receive data", "err", err)
			_ = stream.Reset()

			return
		}

		if msgWrapper.MessageBase == nil {
			slog.Error("No MessageBase in stream request")
			_ = stream.Reset()
			return
		}

		switch msgWrapper.MessageBase.PayloadType {
		case "request-stream-room":
			reqMsg := msgWrapper.GetClientRequestRoomStream()
			if reqMsg != nil {
				currentRoomName = reqMsg.RoomName

				// Generate session ID if not provided (first connection)
				sessionID := reqMsg.SessionId
				if sessionID == "" {
					ulid, err := common.NewULID()
					if err != nil {
						slog.Error("Failed to generate session ID", "err", err)
						continue
					}
					sessionID = ulid.String()
				}

				slog.Info("Client session requested room stream", "session", sessionID, "room", reqMsg.RoomName)

				// Send session ID back to client
				sesMsg, err := common.CreateMessage(
					&gen.ProtoClientRequestRoomStream{SessionId: sessionID, RoomName: reqMsg.RoomName},
					"session-assigned", nil,
				)
				if err != nil {
					slog.Error("Failed to create proto message", "err", err)
					continue
				}
				if err = safeBRW.SendProto(sesMsg); err != nil {
					slog.Error("Failed to send session assignment", "err", err)
				}

				slog.Info("Received stream request for room", "room", reqMsg.RoomName)

				room := sp.relay.GetRoomByName(reqMsg.RoomName)
				if room == nil || !room.IsOnline() || room.OwnerID != sp.relay.ID {
					// TODO: Allow forward requests to other relays from here?
					slog.Debug("Cannot provide stream for nil, offline or non-owned room", "room", reqMsg.RoomName, "is_online", room != nil && room.IsOnline(), "is_owner", room != nil && room.OwnerID == sp.relay.ID)
					// Respond with "request-stream-offline" message with room name
					// TODO: Store the peer and send "online" message when the room comes online
					rawMsg, err := common.CreateMessage(
						&gen.ProtoRaw{
							Data: reqMsg.RoomName,
						},
						"request-stream-offline", nil,
					)
					if err != nil {
						slog.Error("Failed to create proto message", "err", err)
						continue
					}
					if err = safeBRW.SendProto(rawMsg); err != nil {
						slog.Error("Failed to send request stream offline message", "room", reqMsg.RoomName, "err", err)
					}
					continue
				}

				pc, err := common.CreatePeerConnection(func() {
					slog.Info("PeerConnection closed for requested stream", "room", reqMsg.RoomName)
					// Cleanup the stream connection
					if roomMap, ok := sp.servedConns.Get(reqMsg.RoomName); ok {
						roomMap.Delete(stream.Conn().RemotePeer())
						// If the room map is empty, delete it
						if roomMap.Len() == 0 {
							sp.servedConns.Delete(reqMsg.RoomName)
						}
					}
				})
				if err != nil {
					slog.Error("Failed to create PeerConnection for requested stream", "room", reqMsg.RoomName, "err", err)
					continue
				}

				// Create participant for this viewer
				participant, err := shared.NewParticipant(
					sessionID,
					stream.Conn().RemotePeer(),
				)
				if err != nil {
					slog.Error("Failed to create participant", "room", reqMsg.RoomName, "err", err)
					continue
				}

				// Assign peer connection
				participant.PeerConnection = pc
				iceHelper.SetPeerConnection(pc)

				// Add audio/video tracks
				{
					localTrack, err := webrtc.NewTrackLocalStaticRTP(
						room.AudioCodec,
						"participant-"+participant.ID.String(),
						"participant-"+participant.ID.String()+"-audio",
					)
					if err != nil {
						slog.Error("Failed to create track for stream request", "err", err)
						return
					}
					participant.SetTrack(webrtc.RTPCodecTypeAudio, localTrack)
					slog.Debug("Set audio track for requested stream", "room", room.Name)
				}
				{
					localTrack, err := webrtc.NewTrackLocalStaticRTP(
						room.VideoCodec,
						"participant-"+participant.ID.String(),
						"participant-"+participant.ID.String()+"-video",
					)
					if err != nil {
						slog.Error("Failed to create track for stream request", "err", err)
						return
					}
					participant.SetTrack(webrtc.RTPCodecTypeVideo, localTrack)
					slog.Debug("Set video track for requested stream", "room", room.Name)
				}

				// Cleanup on disconnect
				cleanupParticipantID := participant.ID
				pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
					if state == webrtc.PeerConnectionStateClosed ||
						state == webrtc.PeerConnectionStateFailed ||
						state == webrtc.PeerConnectionStateDisconnected {
						slog.Info("Participant disconnected from room", "room", reqMsg.RoomName, "participant", cleanupParticipantID)
						room.RemoveParticipantByID(cleanupParticipantID)
						participant.Close()
					} else if state == webrtc.PeerConnectionStateConnected {
						// Add participant to room when connection is established
						room.AddParticipant(participant)
					}
				})

				// DataChannel setup
				settingOrdered := true
				settingMaxRetransmits := uint16(2)
				dc, err := pc.CreateDataChannel("relay-data", &webrtc.DataChannelInit{
					Ordered:        &settingOrdered,
					MaxRetransmits: &settingMaxRetransmits,
				})
				if err != nil {
					slog.Error("Failed to create DataChannel for requested stream", "room", reqMsg.RoomName, "err", err)
					continue
				}
				ndc := connections.NewNestriDataChannel(dc)

				ndc.RegisterOnOpen(func() {
					slog.Debug("Relay DataChannel opened for requested stream", "room", reqMsg.RoomName)
				})
				ndc.RegisterOnClose(func() {
					slog.Debug("Relay DataChannel closed for requested stream", "room", reqMsg.RoomName)
				})
				ndc.RegisterMessageCallback("input", func(data []byte) {
					if room.DataChannel != nil {
						if err = room.DataChannel.SendBinary(data); err != nil {
							slog.Error("Failed to forward input message from mesh to upstream room", "room", reqMsg.RoomName, "err", err)
						}
					}
				})
				// Track controller input separately
				ndc.RegisterMessageCallback("controllerInput", func(data []byte) {
					// Parse the message to track controller slots for client sessions
					var controllerMsgWrapper gen.ProtoMessage
					if err = proto.Unmarshal(data, &controllerMsgWrapper); err != nil {
						slog.Error("Failed to unmarshal controller input", "err", err)
					}

					// Forward to upstream room
					if room.DataChannel != nil {
						if err = room.DataChannel.SendBinary(data); err != nil {
							slog.Error("Failed to forward controller input from mesh to upstream room", "room", reqMsg.RoomName, "err", err)
						}
					}
				})

				// ICE Candidate handling
				pc.OnICECandidate(func(candidate *webrtc.ICECandidate) {
					if candidate == nil {
						return
					}

					candInit := candidate.ToJSON()
					var sdpMLineIndex *uint32
					if candInit.SDPMLineIndex != nil {
						idx := uint32(*candInit.SDPMLineIndex)
						sdpMLineIndex = &idx
					}
					iceMsg, err := common.CreateMessage(
						&gen.ProtoICE{
							Candidate: &gen.RTCIceCandidateInit{
								Candidate:     candInit.Candidate,
								SdpMLineIndex: sdpMLineIndex,
								SdpMid:        candInit.SDPMid,
							},
						},
						"ice-candidate", nil,
					)
					if err != nil {
						slog.Error("Failed to create proto message", "err", err)
						return
					}
					if err = safeBRW.SendProto(iceMsg); err != nil {
						slog.Error("Failed to send ICE candidate message for requested stream", "room", reqMsg.RoomName, "err", err)
						return
					}
				})

				// Create offer
				offer, err := pc.CreateOffer(nil)
				if err != nil {
					slog.Error("Failed to create offer for requested stream", "room", reqMsg.RoomName, "err", err)
					continue
				}
				if err = pc.SetLocalDescription(offer); err != nil {
					slog.Error("Failed to set local description for requested stream", "room", reqMsg.RoomName, "err", err)
					continue
				}
				offerMsg, err := common.CreateMessage(
					&gen.ProtoSDP{
						Sdp: &gen.RTCSessionDescriptionInit{
							Sdp:  offer.SDP,
							Type: offer.Type.String(),
						},
					},
					"offer", nil,
				)
				if err != nil {
					slog.Error("Failed to create proto message", "err", err)
					continue
				}
				if err = safeBRW.SendProto(offerMsg); err != nil {
					slog.Error("Failed to send offer for requested stream", "room", reqMsg.RoomName, "err", err)
					continue
				}

				// Store the connection
				roomMap, ok := sp.servedConns.Get(reqMsg.RoomName)
				if !ok {
					roomMap = common.NewSafeMap[peer.ID, *StreamConnection]()
					sp.servedConns.Set(reqMsg.RoomName, roomMap)
				}
				roomMap.Set(stream.Conn().RemotePeer(), &StreamConnection{
					pc:  pc,
					ndc: ndc,
				})

				slog.Debug("Sent offer for requested stream")
			} else {
				slog.Error("Could not get ClientRequestRoomStream for stream request")
			}
		case "ice-candidate":
			iceMsg := msgWrapper.GetIce()
			if iceMsg != nil {
				cand := webrtc.ICECandidateInit{
					Candidate:        iceMsg.Candidate.Candidate,
					SDPMid:           iceMsg.Candidate.SdpMid,
					UsernameFragment: iceMsg.Candidate.UsernameFragment,
				}
				if iceMsg.Candidate.SdpMLineIndex != nil {
					smollified := uint16(*iceMsg.Candidate.SdpMLineIndex)
					cand.SDPMLineIndex = &smollified
				}
				iceHelper.AddCandidate(cand)
			} else {
				slog.Error("Could not GetIce from ice-candidate")
			}
		case "answer":
			answerMsg := msgWrapper.GetSdp()
			if answerMsg != nil {
				ansSdp := webrtc.SessionDescription{
					SDP:  answerMsg.Sdp.Sdp,
					Type: webrtc.NewSDPType(answerMsg.Sdp.Type),
				}
				// Use currentRoomName to get the connection from nested map
				if len(currentRoomName) > 0 {
					if roomMap, ok := sp.servedConns.Get(currentRoomName); ok {
						if conn, ok := roomMap.Get(stream.Conn().RemotePeer()); ok {
							if err = conn.pc.SetRemoteDescription(ansSdp); err != nil {
								slog.Error("Failed to set remote description for answer", "err", err)
								continue
							}
							slog.Debug("Set remote description for answer")
							// Flush held candidates now if missed before (race-condition)
							iceHelper.FlushHeldCandidates()
						} else {
							slog.Warn("Received answer without active PeerConnection")
						}
					}
				} else {
					slog.Warn("Received answer without active PeerConnection")
				}
			} else {
				slog.Warn("Could not GetSdp from answer")
			}
		}
	}
}

// handleStreamPush manages a stream push from a node (nestri-server)
func (sp *StreamProtocol) handleStreamPush(stream network.Stream) {
	brw := bufio.NewReadWriter(bufio.NewReader(stream), bufio.NewWriter(stream))
	safeBRW := common.NewSafeBufioRW(brw)

	var room *shared.Room
	iceHelper := common.NewICEHelper(nil)
	for {
		var msgWrapper gen.ProtoMessage
		err := safeBRW.ReceiveProto(&msgWrapper)
		if err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, network.ErrReset) {
				slog.Debug("Stream push connection closed by peer", "peer", stream.Conn().RemotePeer(), "error", err)
				if room != nil {
					room.Close()
					sp.incomingConns.Delete(room.Name)
				}
				return
			}

			slog.Error("Failed to receive data for stream push", "err", err)
			_ = stream.Reset()
			if room != nil {
				room.Close()
				sp.incomingConns.Delete(room.Name)
			}
			return
		}

		if msgWrapper.MessageBase == nil {
			slog.Error("No MessageBase in stream push")
			continue
		}

		switch msgWrapper.MessageBase.PayloadType {
		case "push-stream-room":
			pushMsg := msgWrapper.GetServerPushStream()
			if pushMsg != nil {
				slog.Info("Received stream push request for room", "room", pushMsg.RoomName)

				room = sp.relay.GetRoomByName(pushMsg.RoomName)
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
					room = sp.relay.CreateRoom(pushMsg.RoomName)
				}

				// Respond with an OK with the room name
				resMsg, err := common.CreateMessage(
					&gen.ProtoServerPushStream{
						RoomName: pushMsg.RoomName,
					},
					"push-stream-ok", nil,
				)
				if err != nil {
					slog.Error("Failed to create proto message", "err", err)
					continue
				}
				if err = safeBRW.SendProto(resMsg); err != nil {
					slog.Error("Failed to send push stream OK response", "room", room.Name, "err", err)
					continue
				}
			} else {
				slog.Error("Failed to GetServerPushStream in push-stream-room")
			}
		case "ice-candidate":
			iceMsg := msgWrapper.GetIce()
			if iceMsg != nil {
				smollified := uint16(*iceMsg.Candidate.SdpMLineIndex)
				cand := webrtc.ICECandidateInit{
					Candidate:        iceMsg.Candidate.Candidate,
					SDPMid:           iceMsg.Candidate.SdpMid,
					SDPMLineIndex:    &smollified,
					UsernameFragment: iceMsg.Candidate.UsernameFragment,
				}
				iceHelper.AddCandidate(cand)
			} else {
				slog.Error("Failed to GetIce in pushed stream ice-candidate")
			}
		case "offer":
			// Make sure we have room set to push to (set by "push-stream-room")
			if room == nil {
				slog.Error("Received offer without room set for stream push")
				continue
			}

			offerMsg := msgWrapper.GetSdp()
			if offerMsg != nil {
				offSdp := webrtc.SessionDescription{
					SDP:  offerMsg.Sdp.Sdp,
					Type: webrtc.NewSDPType(offerMsg.Sdp.Type),
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

				// Assign room peer connection
				room.PeerConnection = pc
				iceHelper.SetPeerConnection(pc)

				pc.OnDataChannel(func(dc *webrtc.DataChannel) {
					// TODO: Is this the best way to handle DataChannel? Should we just use the map directly?
					room.DataChannel = connections.NewNestriDataChannel(dc)
					room.DataChannel.RegisterOnOpen(func() {
						slog.Debug("DataChannel opened for pushed stream", "room", room.Name)
					})
					room.DataChannel.RegisterOnClose(func() {
						slog.Debug("DataChannel closed for pushed stream", "room", room.Name)
					})
					// Handle controller feedback reverse-flow (like rumble events coming from game to client)
					room.DataChannel.RegisterMessageCallback("controllerInput", func(data []byte) {
						// Forward controller input to all viewers
						if roomMap, ok := sp.servedConns.Get(room.Name); ok {
							roomMap.Range(func(peerID peer.ID, conn *StreamConnection) bool {
								if conn.ndc != nil {
									if err = conn.ndc.SendBinary(data); err != nil {
										if errors.Is(err, io.ErrClosedPipe) {
											slog.Warn("Failed to forward controller input to viewer, treating as disconnected", "err", err)
											sp.relay.onPeerDisconnected(peerID)
										} else {
											slog.Error("Failed to forward controller input from pushed stream to viewer", "room", room.Name, "peer", peerID, "err", err)
										}
									}
								}
								return true
							})
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

					candInit := candidate.ToJSON()
					biggified := uint32(*candInit.SDPMLineIndex)
					iceMsg, err := common.CreateMessage(
						&gen.ProtoICE{
							Candidate: &gen.RTCIceCandidateInit{
								Candidate:     candInit.Candidate,
								SdpMLineIndex: &biggified,
								SdpMid:        candInit.SDPMid,
							},
						},
						"ice-candidate", nil,
					)
					if err != nil {
						slog.Error("Failed to create proto message", "err", err)
						return
					}
					if err = safeBRW.SendProto(iceMsg); err != nil {
						slog.Error("Failed to send ICE candidate message for pushed stream", "room", room.Name, "err", err)
						return
					}
				})

				pc.OnTrack(func(remoteTrack *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
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

					if remoteTrack.Kind() == webrtc.RTPCodecTypeAudio {
						room.AudioCodec = remoteTrack.Codec().RTPCodecCapability
					} else if remoteTrack.Kind() == webrtc.RTPCodecTypeVideo {
						room.VideoCodec = remoteTrack.Codec().RTPCodecCapability
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
							if err = rtpPacket.SetExtension(extID, playoutPayload); err != nil {
								slog.Error("Failed to set PlayoutDelayExtension for room", "room", room.Name, "err", err)
								continue
							}
						}

						// Calculate differences
						var timeDiff int64
						var sequenceDiff int

						if remoteTrack.Kind() == webrtc.RTPCodecTypeVideo {
							timeDiff = int64(rtpPacket.Timestamp) - int64(room.LastVideoTimestamp)
							if !room.VideoTimestampSet {
								timeDiff = 0
								room.VideoTimestampSet = true
							} else if timeDiff < -(math.MaxUint32 / 10) {
								timeDiff += math.MaxUint32 + 1
							}

							sequenceDiff = int(rtpPacket.SequenceNumber) - int(room.LastVideoSequenceNumber)
							if !room.VideoSequenceSet {
								sequenceDiff = 0
								room.VideoSequenceSet = true
							} else if sequenceDiff < -(math.MaxUint16 / 10) {
								sequenceDiff += math.MaxUint16 + 1
							}

							room.LastVideoTimestamp = rtpPacket.Timestamp
							room.LastVideoSequenceNumber = rtpPacket.SequenceNumber
						} else { // Audio
							timeDiff = int64(rtpPacket.Timestamp) - int64(room.LastAudioTimestamp)
							if !room.AudioTimestampSet {
								timeDiff = 0
								room.AudioTimestampSet = true
							} else if timeDiff < -(math.MaxUint32 / 10) {
								timeDiff += math.MaxUint32 + 1
							}

							sequenceDiff = int(rtpPacket.SequenceNumber) - int(room.LastAudioSequenceNumber)
							if !room.AudioSequenceSet {
								sequenceDiff = 0
								room.AudioSequenceSet = true
							} else if sequenceDiff < -(math.MaxUint16 / 10) {
								sequenceDiff += math.MaxUint16 + 1
							}

							room.LastAudioTimestamp = rtpPacket.Timestamp
							room.LastAudioSequenceNumber = rtpPacket.SequenceNumber
						}

						// Broadcast with differences
						room.BroadcastPacketRetimed(remoteTrack.Kind(), rtpPacket, timeDiff, sequenceDiff)
					}

					slog.Debug("Track closed for room", "room", room.Name, "track_kind", remoteTrack.Kind().String())
				})

				// Set the remote description
				if err = pc.SetRemoteDescription(offSdp); err != nil {
					slog.Error("Failed to set remote description for pushed stream", "room", room.Name, "err", err)
					continue
				}
				slog.Debug("Set remote description for pushed stream", "room", room.Name)
				// Flush candidates now if they weren't before (race-condition)
				iceHelper.FlushHeldCandidates()

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
				answerMsg, err := common.CreateMessage(
					&gen.ProtoSDP{
						Sdp: &gen.RTCSessionDescriptionInit{
							Sdp:  answer.SDP,
							Type: answer.Type.String(),
						},
					},
					"answer", nil,
				)
				if err != nil {
					slog.Error("Failed to create proto message", "err", err)
					continue
				}
				if err = safeBRW.SendProto(answerMsg); err != nil {
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
}

// --- Public Usable Methods ---

// RequestStream sends a request to get room stream from another relay
func (sp *StreamProtocol) RequestStream(ctx context.Context, room *shared.Room, peerID peer.ID) error {
	_, err := sp.relay.Host.NewStream(ctx, peerID, protocolStreamRequest)
	if err != nil {
		return fmt.Errorf("failed to create stream: %w", err)
	}

	return nil /* TODO: This? */
}
