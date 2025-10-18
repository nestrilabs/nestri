package core

import (
	"errors"
	"log/slog"
	"os"
	"relay/internal/common"
	"relay/internal/shared"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
)

// PeerInfo contains information of a peer, in light transmit-friendly format
type PeerInfo struct {
	ID        peer.ID
	Addrs     []multiaddr.Multiaddr                    // Addresses of this peer
	Peers     *common.SafeMap[peer.ID, *PeerInfo]      // Peers connected to this peer
	Latencies *common.SafeMap[peer.ID, time.Duration]  // Latencies to other peers from this peer
	Rooms     *common.SafeMap[string, shared.RoomInfo] // Rooms this peer is part of or owner of
}

func NewPeerInfo(id peer.ID, addrs []multiaddr.Multiaddr) *PeerInfo {
	return &PeerInfo{
		ID:        id,
		Addrs:     addrs,
		Peers:     common.NewSafeMap[peer.ID, *PeerInfo](),
		Latencies: common.NewSafeMap[peer.ID, time.Duration](),
		Rooms:     common.NewSafeMap[string, shared.RoomInfo](),
	}
}

// SaveToFile saves the peer store to a JSON file in persistent path
func (pi *PeerInfo) SaveToFile(filePath string) error {
	if len(filePath) <= 0 {
		return errors.New("filepath is not set")
	}

	// Marshal the peer store to JSON array (we don't need to store IDs..)
	data, err := pi.Peers.MarshalJSON()
	if err != nil {
		return errors.New("failed to marshal peer store data: " + err.Error())
	}

	// Save the data to a file
	if err = os.WriteFile(filePath, data, 0644); err != nil {
		return errors.New("failed to save peer store to file: " + err.Error())
	}

	slog.Info("PeerStore saved to file", "path", filePath)
	return nil
}

// LoadFromFile loads the peer store from a JSON file in persistent path
func (pi *PeerInfo) LoadFromFile(filePath string) error {
	if len(filePath) <= 0 {
		return errors.New("filepath is not set")
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			slog.Info("PeerStore file does not exist, starting with empty store")
			return nil // No peers to load
		}
		return errors.New("failed to read peer store file: " + err.Error())
	}

	// Unmarshal the JSON data into the peer store
	if err = pi.Peers.UnmarshalJSON(data); err != nil {
		return errors.New("failed to unmarshal peer store data: " + err.Error())
	}

	slog.Info("PeerStore loaded from file", "path", filePath)
	return nil
}
