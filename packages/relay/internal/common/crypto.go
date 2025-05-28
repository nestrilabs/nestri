package common

import (
	"crypto/rand"
	"crypto/sha256"
	"github.com/oklog/ulid/v2"
	"time"
)

func NewULID() (ulid.ULID, error) {
	return ulid.New(ulid.Timestamp(time.Now()), ulid.Monotonic(rand.Reader, 0))
}

// GeneratePSKFromToken creates a 32-byte pre-shared key from a token using SHA-256
// for secure WebRTC/libp2p connections between maitred and relay components.
func GeneratePSKFromToken(token string) ([]byte, error) {
	// Simple hash-based PSK generation (32 bytes for libp2p)
	hash := sha256.Sum256([]byte(token))
	return hash[:], nil
}
