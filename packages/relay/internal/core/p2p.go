package core

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
)

// --- Structs ---

// networkNotifier logs connection events and updates relay state
type networkNotifier struct {
	relay *Relay
}

// Connected is called when a connection is established
func (n *networkNotifier) Connected(net network.Network, conn network.Conn) {
	if n.relay != nil {
		n.relay.onPeerConnected(conn.RemotePeer())
	}
}

// Disconnected is called when a connection is terminated
func (n *networkNotifier) Disconnected(net network.Network, conn network.Conn) {
	// Update the status of the disconnected peer
	if n.relay != nil {
		n.relay.onPeerDisconnected(conn.RemotePeer())
	}
}

// Listen is called when the node starts listening on an address
func (n *networkNotifier) Listen(net network.Network, addr multiaddr.Multiaddr) {}

// ListenClose is called when the node stops listening on an address
func (n *networkNotifier) ListenClose(net network.Network, addr multiaddr.Multiaddr) {}

// --- PubSub Setup ---

// setupPubSub initializes PubSub topics and subscriptions.
func (r *Relay) setupPubSub(ctx context.Context) error {
	var err error

	// Room State Topic
	r.pubTopicState, err = r.PubSub.Join(roomStateTopicName)
	if err != nil {
		return fmt.Errorf("failed to join room state topic '%s': %w", roomStateTopicName, err)
	}
	stateSub, err := r.pubTopicState.Subscribe()
	if err != nil {
		return fmt.Errorf("failed to subscribe to room state topic '%s': %w", roomStateTopicName, err)
	}
	go r.handleRoomStateMessages(ctx, stateSub) // Handler in relay_state.go

	// Relay Metrics Topic
	r.pubTopicRelayMetrics, err = r.PubSub.Join(relayMetricsTopicName)
	if err != nil {
		return fmt.Errorf("failed to join relay metrics topic '%s': %w", relayMetricsTopicName, err)
	}
	metricsSub, err := r.pubTopicRelayMetrics.Subscribe()
	if err != nil {
		return fmt.Errorf("failed to subscribe to relay metrics topic '%s': %w", relayMetricsTopicName, err)
	}
	go r.handleRelayMetricsMessages(ctx, metricsSub) // Handler in relay_state.go

	slog.Info("PubSub topics joined and subscriptions started")
	return nil
}

// --- Connection Management ---

// connectToPeer is internal method to connect to a peer using multiaddresses
func (r *Relay) connectToPeer(ctx context.Context, peerInfo *peer.AddrInfo) error {
	if peerInfo.ID == r.ID {
		return errors.New("cannot connect to self")
	}

	// Use a timeout for the connection attempt
	connectCtx, cancel := context.WithTimeout(ctx, 15*time.Second) // 15s timeout
	defer cancel()

	slog.Info("Attempting to connect to peer", "peer", peerInfo.ID, "addrs", peerInfo.Addrs)
	if err := r.Host.Connect(connectCtx, *peerInfo); err != nil {
		return fmt.Errorf("failed to connect to %s: %w", peerInfo.ID, err)
	}

	slog.Info("Successfully connected to peer", "peer", peerInfo.ID, "addrs", peerInfo.Addrs)
	return nil
}

// ConnectToPeer connects to another peer by its multiaddress.
func (r *Relay) ConnectToPeer(ctx context.Context, addr multiaddr.Multiaddr) error {
	peerInfo, err := peer.AddrInfoFromP2pAddr(addr)
	if err != nil {
		return fmt.Errorf("failed to extract peer info: %w", err)
	}

	return r.connectToPeer(ctx, peerInfo)
}

// printConnectInstructions logs the multiaddresses for connecting to this relay.
func printConnectInstructions(p2pHost host.Host) {
	peerInfo := peer.AddrInfo{
		ID:    p2pHost.ID(),
		Addrs: p2pHost.Addrs(),
	}
	addrs, err := peer.AddrInfoToP2pAddrs(&peerInfo)
	if err != nil {
		slog.Error("Failed to convert peer info to addresses", "err", err)
		return
	}

	slog.Info("Mesh connection addresses:")
	for _, addr := range addrs {
		slog.Info(fmt.Sprintf("> %s", addr.String()))
	}
}
