package common

import (
	"encoding/json"
	"log/slog"
	"sync"
)

type MeshState struct {
	AddSet             map[string]struct{}
	RemoveSet          map[string]struct{}
	onRoomActiveChange func(roomName string, active bool)
	sync.RWMutex
}

// NewMeshState initializes a new MeshState
func NewMeshState() *MeshState {
	return &MeshState{
		AddSet:    make(map[string]struct{}),
		RemoveSet: make(map[string]struct{}),
	}
}

func (ms *MeshState) SetOnRoomActiveChange(callback func(roomName string, active bool)) {
	ms.onRoomActiveChange = callback
}

// AddRoom adds a room to the AddSet
func (ms *MeshState) AddRoom(roomName string) {
	ms.Lock()
	defer ms.Unlock()
	wasActive := ms.IsRoomActive(roomName)
	ms.AddSet[roomName] = struct{}{}
	// Remove it from RemoveSet if it exists to allow re-adding
	if _, exists := ms.RemoveSet[roomName]; exists {
		delete(ms.RemoveSet, roomName)
	}
	if !wasActive && ms.onRoomActiveChange != nil {
		ms.onRoomActiveChange(roomName, true)
	}
	slog.Debug("Added room to state", "roomName", roomName)
}

// DeleteRoom adds a room to the RemoveSet, marking it as deleted
func (ms *MeshState) DeleteRoom(roomName string) {
	ms.Lock()
	defer ms.Unlock()
	wasActive := ms.IsRoomActive(roomName)
	ms.RemoveSet[roomName] = struct{}{}
	if wasActive && ms.onRoomActiveChange != nil {
		ms.onRoomActiveChange(roomName, false)
	}
	slog.Debug("Deleted room from state", "roomName", roomName)
}

// IsRoomActive checks if a room is active (in AddSet and not in RemoveSet)
func (ms *MeshState) IsRoomActive(roomName string) bool {
	ms.RLock()
	defer ms.RUnlock()
	_, inAdd := ms.AddSet[roomName]
	_, inRemove := ms.RemoveSet[roomName]
	return inAdd && !inRemove
}

// GetActiveRooms returns all active rooms
func (ms *MeshState) GetActiveRooms() []string {
	ms.RLock()
	defer ms.RUnlock()
	var activeRooms []string
	for roomName := range ms.AddSet {
		if _, inRemove := ms.RemoveSet[roomName]; !inRemove {
			activeRooms = append(activeRooms, roomName)
		}
	}
	return activeRooms
}

// GetStateForSync returns the AddSet and RemoveSet as a serializable struct
func (ms *MeshState) GetStateForSync() map[string][]string {
	ms.RLock()
	defer ms.RUnlock()
	addList := make([]string, 0, len(ms.AddSet))
	for roomName := range ms.AddSet {
		addList = append(addList, roomName)
	}
	removeList := make([]string, 0, len(ms.RemoveSet))
	for roomName := range ms.RemoveSet {
		removeList = append(removeList, roomName)
	}
	return map[string][]string{
		"add":    addList,
		"remove": removeList,
	}
}

// Merge combines another MeshState into this one
func (ms *MeshState) Merge(other *MeshState) {
	ms.Lock()
	defer ms.Unlock()
	other.RLock()
	defer other.RUnlock()

	for roomName := range other.AddSet {
		ms.AddSet[roomName] = struct{}{}
	}
	for roomName := range other.RemoveSet {
		ms.RemoveSet[roomName] = struct{}{}
	}
	slog.Debug("Merged state", "addCount", len(ms.AddSet), "removeCount", len(ms.RemoveSet))
}

// MarshalJSON customizes JSON serialization
func (ms *MeshState) MarshalJSON() ([]byte, error) {
	return json.Marshal(ms.GetStateForSync())
}

// UnmarshalJSON customizes JSON deserialization
func (ms *MeshState) UnmarshalJSON(data []byte) error {
	var state struct {
		Add    []string `json:"add"`
		Remove []string `json:"remove"`
	}
	if err := json.Unmarshal(data, &state); err != nil {
		return err
	}
	ms.Lock()
	defer ms.Unlock()
	ms.AddSet = make(map[string]struct{})
	ms.RemoveSet = make(map[string]struct{})
	for _, roomName := range state.Add {
		ms.AddSet[roomName] = struct{}{}
	}
	for _, roomName := range state.Remove {
		ms.RemoveSet[roomName] = struct{}{}
	}
	return nil
}
