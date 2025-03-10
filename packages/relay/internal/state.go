package relay

import (
	"github.com/google/uuid"
	"log/slog"
	"sync"
	"time"
)

// VectorClock tracks causality for state updates
type VectorClock map[uuid.UUID]int64

// RoomState represents the state of a room with versioning
type RoomState struct {
	HostingRelayID uuid.UUID
	Online         bool
	Timestamp      time.Time // For LWW conflict resolution
	Version        VectorClock
}

// MeshState holds the shared state of all rooms
type MeshState struct {
	Rooms map[string]RoomState
	mutex sync.RWMutex
}

// NewMeshState initializes a new MeshState
func NewMeshState() *MeshState {
	return &MeshState{
		Rooms: make(map[string]RoomState),
	}
}

// Merge combines another state into this one, resolving conflicts
func (ms *MeshState) Merge(other *MeshState) {
	ms.mutex.Lock()
	defer ms.mutex.Unlock()
	other.mutex.RLock()
	defer other.mutex.RUnlock()

	for roomName, otherState := range other.Rooms {
		localState, exists := ms.Rooms[roomName]
		if !exists {
			ms.Rooms[roomName] = otherState
			slog.Debug("Added new room from merge", "roomName", roomName)
			continue
		}

		// Compare vector clocks
		comparison := ms.compareVectorClocks(localState.Version, otherState.Version)
		if comparison == -1 {
			// Other state is newer
			ms.Rooms[roomName] = otherState
			slog.Debug("Updated room with newer state", "roomName", roomName)
		} else if comparison == 0 {
			// Equal or incomparable, prefer Online=true or later timestamp
			if otherState.Online && !localState.Online {
				ms.Rooms[roomName] = otherState
				slog.Debug("Preferred online state", "roomName", roomName)
			} else if !otherState.Online && localState.Online {
				// Keep local state
				slog.Debug("Kept local online state", "roomName", roomName)
			} else if otherState.Timestamp.After(localState.Timestamp) {
				ms.Rooms[roomName] = otherState
				slog.Debug("Updated room with later timestamp", "roomName", roomName)
			}
		}
		// If local is newer (comparison == 1), keep local state
	}
}

// compareVectorClocks returns:
//
//	1 if local > other
//
// -1 if local < other
//
//	0 if local == other or incomparable
func (ms *MeshState) compareVectorClocks(local, other VectorClock) int {
	localGreater := false
	otherGreater := false

	for relayID, localVal := range local {
		otherVal, exists := other[relayID]
		if !exists {
			otherVal = 0
		}
		if localVal > otherVal {
			localGreater = true
		} else if localVal < otherVal {
			otherGreater = true
		}
	}

	for relayID, otherVal := range other {
		if _, exists := local[relayID]; !exists && otherVal > 0 {
			otherGreater = true
		}
	}

	if localGreater && !otherGreater {
		return 1
	} else if otherGreater && !localGreater {
		return -1
	}
	return 0
}

// UpdateRoom updates the state of a room with a new version
func (ms *MeshState) UpdateRoom(roomName string, hostingRelayID uuid.UUID, online bool, relayID uuid.UUID) {
	ms.mutex.Lock()
	defer ms.mutex.Unlock()

	state, exists := ms.Rooms[roomName]
	if !exists {
		state = RoomState{
			HostingRelayID: hostingRelayID,
			Online:         online,
			Timestamp:      time.Now(),
			Version:        make(VectorClock),
		}
	}
	// Increment the relay's clock
	state.Version[relayID]++
	state.HostingRelayID = hostingRelayID
	state.Online = online
	state.Timestamp = time.Now()
	ms.Rooms[roomName] = state
}

// DeleteRoom removes a room from the state
func (ms *MeshState) DeleteRoom(roomName string, relayID uuid.UUID) {
	ms.mutex.Lock()
	defer ms.mutex.Unlock()

	if state, exists := ms.Rooms[roomName]; exists {
		state.Version[relayID]++
		delete(ms.Rooms, roomName)
	}
}
