package common

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/oklog/ulid/v2"
)

func NewULID() (ulid.ULID, error) {
	return ulid.New(ulid.Timestamp(time.Now()), ulid.Monotonic(rand.Reader, 0))
}

// GenerateED25519Key generates a new ED25519 key
func GenerateED25519Key() (ed25519.PrivateKey, error) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("failed to generate ED25519 key pair: %w", err)
	}
	return priv, nil
}

// SaveED25519Key saves an ED25519 private key to a path as a binary file
func SaveED25519Key(privateKey ed25519.PrivateKey, filePath string) error {
	if privateKey == nil {
		return errors.New("private key cannot be nil")
	}
	if len(privateKey) != ed25519.PrivateKeySize {
		return errors.New("private key must be exactly 64 bytes for ED25519")
	}
	if err := os.WriteFile(filePath, privateKey, 0600); err != nil {
		return fmt.Errorf("failed to save ED25519 key to %s: %w", filePath, err)
	}
	return nil
}

// LoadED25519Key loads an ED25519 private key binary file from a path
func LoadED25519Key(filePath string) (ed25519.PrivateKey, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read ED25519 key from %s: %w", filePath, err)
	}
	if len(data) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("ED25519 key must be exactly %d bytes, got %d", ed25519.PrivateKeySize, len(data))
	}
	return data, nil
}
