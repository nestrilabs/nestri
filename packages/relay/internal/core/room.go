package core

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"relay/internal/shared"

	"github.com/libp2p/go-libp2p/core/network"
	"github.com/oklog/ulid/v2"
)

// --- Room Management ---

// GetRoomByID retrieves a local Room struct by its ULID
func (r *Relay) GetRoomByID(id ulid.ULID) *shared.Room {
	if room, ok := r.LocalRooms.Get(id); ok {
		return room
	}
	return nil
}

// GetRoomByName retrieves a local Room struct by its name
func (r *Relay) GetRoomByName(name string) *shared.Room {
	for _, room := range r.LocalRooms.Copy() {
		if room.Name == name {
			return room
		}
	}
	return nil
}

// CreateRoom creates a new local Room struct with the given name
func (r *Relay) CreateRoom(name string) *shared.Room {
	roomID := ulid.Make()
	room := shared.NewRoom(name, roomID, r.ID)
	r.LocalRooms.Set(room.ID, room)
	slog.Debug("Created new local room", "room", name, "id", room.ID)
	return room
}

// DeleteRoomIfEmpty checks if a local room struct is inactive and can be removed
func (r *Relay) DeleteRoomIfEmpty(room *shared.Room) {
	if room == nil {
		return
	}
	if len(room.Participants) <= 0 && r.LocalRooms.Has(room.ID) {
		slog.Debug("Deleting empty room without participants", "room", room.Name)
		r.LocalRooms.Delete(room.ID)
		err := room.PeerConnection.Close()
		if err != nil {
			slog.Error("Failed to close Room PeerConnection", "room", room.Name, "err", err)
		}
	}
}

// GetRemoteRoomByName returns room from mesh by name
func (r *Relay) GetRemoteRoomByName(roomName string) *shared.RoomInfo {
	for _, room := range r.Rooms.Copy() {
		if room.Name == roomName && room.OwnerID != r.ID {
			// Make sure connection is alive
			if r.Host.Network().Connectedness(room.OwnerID) == network.Connected {
				return &room
			}

			slog.Debug("Removing stale peer, owns a room without connection", "room", roomName, "peer", room.OwnerID)
			r.onPeerDisconnected(room.OwnerID)
		}
	}
	return nil
}

// --- State Publishing ---

// publishRoomStates publishes the state of all rooms currently owned by *this* relay
func (r *Relay) publishRoomStates(ctx context.Context) error {
	if r.pubTopicState == nil {
		slog.Warn("Cannot publish room states: topic is nil")
		return nil
	}

	var statesToPublish []shared.RoomInfo
	r.LocalRooms.Range(func(id ulid.ULID, room *shared.Room) bool {
		// Only publish state for rooms owned by this relay
		if room.OwnerID == r.ID {
			statesToPublish = append(statesToPublish, shared.RoomInfo{
				ID:      room.ID,
				Name:    room.Name,
				OwnerID: r.ID,
			})
		}
		return true // Continue iteration
	})

	if len(statesToPublish) == 0 {
		return nil
	}

	data, err := json.Marshal(statesToPublish)
	if err != nil {
		return fmt.Errorf("failed to marshal local room states: %w", err)
	}
	if pubErr := r.pubTopicState.Publish(ctx, data); pubErr != nil {
		slog.Error("Failed to publish room states message", "err", pubErr)
	}
	return nil
}
