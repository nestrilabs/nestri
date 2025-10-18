package core

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/p2p/discovery/mdns"
)

const (
	mdnsDiscoveryRendezvous = "/nestri-relay/mdns-discovery/1.0.0" // Shared string for mDNS discovery
)

type discoveryNotifee struct {
	relay *Relay
}

func (d *discoveryNotifee) HandlePeerFound(pi peer.AddrInfo) {
	if d.relay != nil {
		if err := d.relay.connectToPeer(context.Background(), &pi); err != nil {
			slog.Error("failed to connect to discovered relay", "peer", pi.ID, "error", err)
		}
	}
}

func startMDNSDiscovery(relay *Relay) error {
	d := &discoveryNotifee{
		relay: relay,
	}

	service := mdns.NewMdnsService(relay.Host, mdnsDiscoveryRendezvous, d)
	if err := service.Start(); err != nil {
		return fmt.Errorf("failed to start mDNS discovery: %w", err)
	}
	return nil
}
