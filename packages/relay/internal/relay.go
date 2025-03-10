package relay

import (
	"context"
	"github.com/google/uuid"
	"log/slog"
	"sync"
	"time"
)

var globalRelay *Relay

type Relay struct {
	ID          uuid.UUID
	MeshID      uuid.UUID
	Rooms       map[uuid.UUID]*Room
	RoomsMutex  sync.RWMutex
	MeshManager *MeshManager
	MeshMutex   sync.RWMutex
}

func NewRelay(ctx context.Context) *Relay {
	r := &Relay{
		ID:     uuid.New(),
		MeshID: uuid.New(),
		Rooms:  make(map[uuid.UUID]*Room),
	}
	r.MeshManager = NewMeshManager(r, 5*time.Second) // Sync every 5 seconds
	r.MeshManager.StartSync(ctx)
	return r
}

func InitRelay(ctx context.Context, ctxCancel context.CancelFunc) error {
	globalRelay = NewRelay(ctx)

	if err := InitWebRTCAPI(); err != nil {
		return err
	}

	if err := InitHTTPEndpoint(ctx, ctxCancel); err != nil {
		return err
	}

	slog.Info("Relay initialized", "id", globalRelay.ID, "meshID", globalRelay.MeshID)
	return nil
}

func GetRelay() *Relay {
	return globalRelay
}

func GetRoomByID(id uuid.UUID) *Room {
	return globalRelay.GetRoomByID(id)
}

func GetRoomByName(name string) *Room {
	return globalRelay.GetRoomByName(name)
}

func GetOrCreateRoom(name string) *Room {
	return globalRelay.GetOrCreateRoom(name)
}

func DeleteRoomIfEmpty(room *Room) {
	globalRelay.DeleteRoomIfEmpty(room)
}

func (r *Relay) GetRoomByID(id uuid.UUID) *Room {
	r.RoomsMutex.RLock()
	defer r.RoomsMutex.RUnlock()
	if room, ok := r.Rooms[id]; ok {
		return room
	}
	return nil
}

func (r *Relay) GetRoomByName(name string) *Room {
	r.RoomsMutex.RLock()
	defer r.RoomsMutex.RUnlock()
	for _, room := range r.Rooms {
		if room.Name == name {
			return room
		}
	}
	return nil
}

func (r *Relay) GetOrCreateRoom(name string) *Room {
	if room := r.GetRoomByName(name); room != nil {
		return room
	}

	// Check MeshState before creating
	if r.MeshManager != nil {
		remoteState, exists := r.MeshManager.GetRoomInfo(name)
		if exists && remoteState.Online && remoteState.HostingRelayID != r.ID {
			slog.Debug("Room exists remotely and is online, not creating locally", "name", name, "hostingRelayID", remoteState.HostingRelayID)
			room := NewRoom(name)
			room.Relay = r
			r.RoomsMutex.Lock()
			r.Rooms[room.ID] = room
			r.RoomsMutex.Unlock()
			return room // Don’t update MeshState, let participantHandler request the stream
		}
	}

	room := NewRoom(name)
	room.Relay = r
	r.RoomsMutex.Lock()
	r.Rooms[room.ID] = room
	r.RoomsMutex.Unlock()

	slog.Debug("Created new room", "name", name, "id", room.ID)
	if r.MeshManager != nil {
		r.MeshManager.state.UpdateRoom(name, r.ID, false, r.ID)
	}
	return room
}

func (r *Relay) DeleteRoomIfEmpty(room *Room) {
	room.ParticipantsMutex.RLock()
	participantCount := len(room.Participants)
	room.ParticipantsMutex.RUnlock()
	if participantCount > 0 {
		slog.Debug("Room not empty, not deleting", "name", room.Name, "id", room.ID, "participants", participantCount)
		return
	}

	slog.Debug("Deleting room since it's empty", "name", room.Name, "id", room.ID)
	r.RoomsMutex.Lock()
	delete(r.Rooms, room.ID)
	r.RoomsMutex.Unlock()
	r.MeshManager.state.DeleteRoom(room.Name, r.ID)
}

func (r *Relay) GetParticipantByID(participantID uuid.UUID) *Participant {
	r.RoomsMutex.RLock()
	defer r.RoomsMutex.RUnlock()

	for _, room := range r.Rooms {
		if participant, ok := room.Participants[participantID]; ok {
			return participant
		}
	}
	return nil
}
