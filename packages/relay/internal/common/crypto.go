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

// Helper function to generate PSK from token
func GeneratePSKFromToken(token string) ([]byte, error) {
	// Simple hash-based PSK generation (32 bytes for libp2p)
	hash := sha256.Sum256([]byte(token))
	return hash[:], nil
}
