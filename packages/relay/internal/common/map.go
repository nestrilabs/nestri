package common

import (
	"errors"
	"reflect"
	"sync"
)

var (
	ErrKeyNotFound     = errors.New("key not found")
	ErrValueNotPointer = errors.New("value is not a pointer")
	ErrFieldNotFound   = errors.New("field not found")
	ErrTypeMismatch    = errors.New("type mismatch")
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

// Update updates a specific field in the value data
func (sm *SafeMap[K, V]) Update(key K, fieldName string, newValue any) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	v, ok := sm.m[key]
	if !ok {
		return ErrKeyNotFound
	}

	// Use reflect to update the field
	rv := reflect.ValueOf(v)
	if rv.Kind() != reflect.Ptr {
		return ErrValueNotPointer
	}

	rv = rv.Elem()
	// Check if the field exists
	field := rv.FieldByName(fieldName)
	if !field.IsValid() || !field.CanSet() {
		return ErrFieldNotFound
	}

	newRV := reflect.ValueOf(newValue)
	if newRV.Type() != field.Type() {
		return ErrTypeMismatch
	}

	field.Set(newRV)
	sm.m[key] = v

	return nil
}
