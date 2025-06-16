package common

import (
	"encoding/json"
	"fmt"
	"sync"
)

// SafeMap is a generic thread-safe map with its own mutex
type SafeMap[K comparable, V any] struct {
	mu sync.RWMutex
	m  map[K]V
}

// NewSafeMap creates a new SafeMap instance
func NewSafeMap[K comparable, V any]() *SafeMap[K, V] {
	return &SafeMap[K, V]{
		m: make(map[K]V),
	}
}

// Get retrieves a value from the map
func (sm *SafeMap[K, V]) Get(key K) (V, bool) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	v, ok := sm.m[key]
	return v, ok
}

// Has checks if a key exists in the map
func (sm *SafeMap[K, V]) Has(key K) bool {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	_, ok := sm.m[key]
	return ok
}

// Set adds or updates a value in the map
func (sm *SafeMap[K, V]) Set(key K, value V) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.m[key] = value
}

// Delete removes a key from the map
func (sm *SafeMap[K, V]) Delete(key K) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	delete(sm.m, key)
}

// Len returns the number of items in the map
func (sm *SafeMap[K, V]) Len() int {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return len(sm.m)
}

// Copy creates a shallow copy of the map and returns it
func (sm *SafeMap[K, V]) Copy() map[K]V {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	copied := make(map[K]V, len(sm.m))
	for k, v := range sm.m {
		copied[k] = v
	}
	return copied
}

// Range iterates over the map and applies a function to each key-value pair
func (sm *SafeMap[K, V]) Range(f func(K, V) bool) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	for k, v := range sm.m {
		if !f(k, v) {
			break
		}
	}
}

func (sm *SafeMap[K, V]) MarshalJSON() ([]byte, error) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return json.Marshal(sm.m)
}

func (sm *SafeMap[K, V]) UnmarshalJSON(data []byte) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	return json.Unmarshal(data, &sm.m)
}

func (sm *SafeMap[K, V]) String() string {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return fmt.Sprintf("%+v", sm.m)
}
