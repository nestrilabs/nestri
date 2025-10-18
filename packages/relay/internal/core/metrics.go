package core

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
)

// --- Metrics Collection and Publishing ---

// periodicMetricsPublisher periodically gathers local metrics and publishes them.
func (r *Relay) periodicMetricsPublisher(ctx context.Context) {
	ticker := time.NewTicker(metricsPublishInterval)
	defer ticker.Stop()

	// Publish immediately on start
	if err := r.publishRelayMetrics(ctx); err != nil {
		slog.Error("Failed to publish initial relay metrics", "err", err)
	}

	for {
		select {
		case <-ctx.Done():
			slog.Info("Stopping metrics publisher")
			return
		case <-ticker.C:
			if err := r.publishRelayMetrics(ctx); err != nil {
				slog.Error("Failed to publish relay metrics", "err", err)
			}
		}
	}
}

// publishRelayMetrics sends the current relay status to the mesh.
func (r *Relay) publishRelayMetrics(ctx context.Context) error {
	if r.pubTopicRelayMetrics == nil {
		slog.Warn("Cannot publish relay metrics: topic is nil")
		return nil
	}

	// Check all peer latencies
	r.checkAllPeerLatencies(ctx)

	data, err := json.Marshal(r.PeerInfo)
	if err != nil {
		return fmt.Errorf("failed to marshal relay status: %w", err)
	}

	if pubErr := r.pubTopicRelayMetrics.Publish(ctx, data); pubErr != nil {
		// Don't return error on publish failure, just log
		slog.Error("Failed to publish relay metrics message", "err", pubErr)
	}
	return nil
}

// checkAllPeerLatencies measures latency to all currently connected peers.
func (r *Relay) checkAllPeerLatencies(ctx context.Context) {
	var wg sync.WaitGroup
	for _, p := range r.Host.Network().Peers() {
		if p == r.ID {
			continue // Skip self
		}
		wg.Add(1)
		// Run checks concurrently
		go func(peerID peer.ID) {
			defer wg.Done()
			go r.measureLatencyToPeer(ctx, peerID)
		}(p)
	}
	wg.Wait() // Wait for all latency checks to complete
}

// measureLatencyToPeer pings a specific peer and updates the local latency map.
func (r *Relay) measureLatencyToPeer(ctx context.Context, peerID peer.ID) {
	// Check peer status first
	if !r.hasConnectedPeer(peerID) {
		return
	}

	// Create a context for the ping operation
	pingCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	// Use the PingService instance stored in the Relay struct
	if r.PingService == nil {
		slog.Error("PingService is nil, cannot measure latency", "peer", peerID)
		return
	}
	resultsCh := r.PingService.Ping(pingCtx, peerID)

	// Wait for the result (or timeout)
	select {
	case <-pingCtx.Done():
		// Ping timed out
		slog.Warn("Latency check canceled", "peer", peerID, "err", pingCtx.Err())
	case result, ok := <-resultsCh:
		if !ok {
			// Channel closed unexpectedly
			slog.Warn("Ping service channel closed unexpectedly", "peer", peerID)
			return
		}

		// Received ping result
		if result.Error != nil {
			slog.Warn("Latency check failed, removing peer from local peers map", "peer", peerID, "err", result.Error)
			// Remove from MeshPeers if ping failed
			if r.Peers.Has(peerID) {
				r.Peers.Delete(peerID)
			}
			return
		}

		// Ping successful, update latency
		latency := result.RTT
		// Ensure latency is not zero if successful, assign a minimal value if so.
		// Sometimes RTT can be reported as 0 for very fast local connections.
		if latency <= 0 {
			latency = 1 * time.Microsecond
		}

		r.PeerInfo.Latencies.Set(peerID, latency)
	}
}
