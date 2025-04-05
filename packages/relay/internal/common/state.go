package common

import (
	"github.com/oklog/ulid/v2"
	"log/slog"
	gen "relay/internal/proto"
)

type MeshState struct {
	entities           *SafeMap[string, *gen.EntityState]
	onRoomActiveChange func(roomName string, active bool)
}

func NewMeshState() *MeshState {
	return &MeshState{
		entities: NewSafeMap[string, *gen.EntityState](),
	}
}

func (ms *MeshState) SetOnRoomActiveChange(callback func(roomName string, active bool)) {
	ms.onRoomActiveChange = callback
}

func (ms *MeshState) AddRoom(roomName string, ownerRelayID ulid.ULID) {
	wasActive := ms.IsRoomActive(roomName)
	ms.entities.Set(roomName, &gen.EntityState{
		EntityType:   "room",
		EntityId:     roomName,
		Active:       true,
		OwnerRelayId: ownerRelayID.String(),
	})
	if !wasActive && ms.onRoomActiveChange != nil {
		ms.onRoomActiveChange(roomName, true)
	}
	slog.Debug("Added room", "roomName", roomName, "owner", ownerRelayID)
}

func (ms *MeshState) DeleteRoom(roomName string) {
	wasActive := ms.IsRoomActive(roomName)
	if entity, exists := ms.entities.Get(roomName); exists {
		entity.Active = false
	} else {
		ms.entities.Set(roomName, &gen.EntityState{
			EntityType: "room",
			EntityId:   roomName,
			Active:     false,
		})
	}
	if wasActive && ms.onRoomActiveChange != nil {
		ms.onRoomActiveChange(roomName, false)
	}
	slog.Debug("Deleted room", "roomName", roomName)
}

func (ms *MeshState) IsRoomActive(roomName string) bool {
	if entity, exists := ms.entities.Get(roomName); exists {
		return entity.Active
	}
	return false
}

func (ms *MeshState) SerializeEntities() map[string]*gen.EntityState {
	result := make(map[string]*gen.EntityState)
	for k, v := range ms.entities.Copy() {
		result[k] = v
	}
	return result
}

func (ms *MeshState) GetEntities() *SafeMap[string, *gen.EntityState] {
	return ms.entities
}
