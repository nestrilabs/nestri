package core

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"relay/internal/common"
	"relay/internal/shared"
	"time"

	gen "relay/internal/proto"

	"google.golang.org/protobuf/proto"

	pubsub "github.com/libp2p/go-libp2p-pubsub"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
)

// --- PubSub Message Handlers ---

// handleRoomStateMessages processes incoming room state updates from peers.
func (r *Relay) handleRoomStateMessages(ctx context.Context, sub *pubsub.Subscription) {
	slog.Debug("Starting room state message handler...")
	for {
		select {
		case <-ctx.Done():
			slog.Info("Stopping room state message handler")
			return
		default:
			msg, err := sub.Next(ctx)
			if err != nil {
				if errors.Is(err, context.Canceled) || errors.Is(err, pubsub.ErrSubscriptionCancelled) || errors.Is(err, context.DeadlineExceeded) {
					slog.Info("Room state subscription ended", "err", err)
					return
				}
				slog.Error("Error receiving room state message", "err", err)
				time.Sleep(1 * time.Second)
				continue
			}
			if msg.GetFrom() == r.Host.ID() {
				continue
			}

			var states []shared.RoomInfo
			if err := json.Unmarshal(msg.Data, &states); err != nil {
				slog.Error("Failed to unmarshal room states", "from", msg.GetFrom(), "data_len", len(msg.Data), "err", err)
				continue
			}

			r.updateMeshRoomStates(msg.GetFrom(), states)
		}
	}
}

// handleRelayMetricsMessages processes incoming status updates from peers.
func (r *Relay) handleRelayMetricsMessages(ctx context.Context, sub *pubsub.Subscription) {
	slog.Debug("Starting relay metrics message handler...")
	for {
		select {
		case <-ctx.Done():
			slog.Info("Stopping relay metrics message handler")
			return
		default:
			msg, err := sub.Next(ctx)
			if err != nil {
				if errors.Is(err, context.Canceled) || errors.Is(err, pubsub.ErrSubscriptionCancelled) || errors.Is(err, context.DeadlineExceeded) {
					slog.Info("Relay metrics subscription ended", "err", err)
					return
				}
				slog.Error("Error receiving relay metrics message", "err", err)
				time.Sleep(1 * time.Second)
				continue
			}
			if msg.GetFrom() == r.Host.ID() {
				continue
			}

			var info PeerInfo
			if err = json.Unmarshal(msg.Data, &info); err != nil {
				slog.Error("Failed to unmarshal relay status", "from", msg.GetFrom(), "data_len", len(msg.Data), "err", err)
				continue
			}
			if info.ID != msg.GetFrom() {
				slog.Error("Peer ID mismatch in relay status", "expected", info.ID, "actual", msg.GetFrom())
				continue
			}
			r.onPeerStatus(info)
		}
	}
}

// --- State Check Functions ---
// hasConnectedPeer checks if peer is in map and has a valid connection
func (r *Relay) hasConnectedPeer(peerID peer.ID) bool {
	if _, ok := r.Peers.Get(peerID); !ok {
		return false
	}
	if r.Host.Network().Connectedness(peerID) != network.Connected {
		slog.Debug("Peer not connected", "peer", peerID)
		return false
	}
	return true
}

// --- State Change Functions ---

// onPeerStatus updates the status of a peer based on received metrics, adding local perspective
func (r *Relay) onPeerStatus(recvInfo PeerInfo) {
	r.Peers.Set(recvInfo.ID, &recvInfo)
}

// onPeerConnected is called when a new peer connects to the relay
func (r *Relay) onPeerConnected(peerID peer.ID) {
	// Add to local peer map
	r.Peers.Set(peerID, &PeerInfo{
		ID: peerID,
	})

	slog.Info("Peer connected", "peer", peerID)

	// Trigger immediate state exchange
	go func() {
		if err := r.publishRelayMetrics(context.Background()); err != nil {
			slog.Error("Failed to publish relay metrics on connect", "err", err)
		} else {
			if err = r.publishRoomStates(context.Background()); err != nil {
				slog.Error("Failed to publish room states on connect", "err", err)
			}
		}
	}()
}

// onPeerDisconnected marks a peer as disconnected in our status view and removes latency info
func (r *Relay) onPeerDisconnected(peerID peer.ID) {
	// Check if this was a client session disconnect
	if session, ok := r.ClientSessions.Get(peerID); ok {
		slog.Info("Client session disconnected",
			"peer", peerID,
			"session", session.SessionID,
			"room", session.RoomName,
			"controller_slots", session.ControllerSlots)

		// Send cleanup message to nestri-server if client had active controllers
		if len(session.ControllerSlots) > 0 {
			room := r.GetRoomByName(session.RoomName)
			if room != nil && room.DataChannel != nil {
				// Create disconnect notification
				disconnectMsg, err := common.CreateMessage(&gen.ProtoClientDisconnected{
					SessionId:       session.SessionID,
					ControllerSlots: session.ControllerSlots,
				}, "client-disconnected", nil)
				if err != nil {
					slog.Error("Failed to create client disconnect message", "err", err)
				}

				disMarshal, err := proto.Marshal(disconnectMsg)
				if err != nil {
					slog.Error("Failed to marshal client disconnect message", "err", err)
				} else {
					if err = room.DataChannel.SendBinary(disMarshal); err != nil {
						slog.Error("Failed to send client disconnect notification", "err", err)
					} else {
						slog.Info("Sent controller cleanup notification to nestri-server",
							"session", session.SessionID,
							"slots", session.ControllerSlots)
					}
				}
			}
		}

		r.ClientSessions.Delete(peerID)
		return
	}

	// Relay peer disconnect handling
	slog.Info("Mesh peer disconnected, deleting from local peer map", "peer", peerID)
	if r.Peers.Has(peerID) {
		r.Peers.Delete(peerID)
	}
	if r.Rooms.Has(peerID.String()) {
		r.Rooms.Delete(peerID.String())
	}

	// TODO: If any rooms were routed through this peer, handle that case
}

// updateMeshRoomStates merges received room states into the MeshRooms map
// TODO: Wrap in another type with timestamp or another mechanism to avoid conflicts
func (r *Relay) updateMeshRoomStates(peerID peer.ID, states []shared.RoomInfo) {
	for _, state := range states {
		if state.OwnerID == r.ID {
			continue
		}

		// If previously did not exist, but does now, request a connection if participants exist for our room
		existed := r.Rooms.Has(state.ID.String())
		if !existed {
			// Request connection to this peer if we have participants in our local room
			if room, ok := r.LocalRooms.Get(state.ID); ok {
				if room.Participants.Len() > 0 {
					slog.Debug("Got new remote room state, we locally have participants for, requesting stream", "room_name", room.Name, "peer", peerID)
					if err := r.StreamProtocol.RequestStream(context.Background(), room, peerID); err != nil {
						slog.Error("Failed to request stream for new remote room state", "room_name", room.Name, "peer", peerID, "err", err)
					}
				}
			}
		}

		r.Rooms.Set(state.ID.String(), state)
	}
}
