package core

import (
	"context"
	"crypto/ed25519"
	"fmt"
	"log/slog"
	"os"
	"relay/internal/common"
	"relay/internal/shared"
	"time"

	"github.com/libp2p/go-libp2p"
	pubsub "github.com/libp2p/go-libp2p-pubsub"
	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/p2p/protocol/ping"
	"github.com/libp2p/go-libp2p/p2p/security/noise"
	"github.com/libp2p/go-libp2p/p2p/transport/tcp"
	ws "github.com/libp2p/go-libp2p/p2p/transport/websocket"
	"github.com/multiformats/go-multiaddr"
	"github.com/oklog/ulid/v2"
	"github.com/pion/webrtc/v4"
)

// -- Variables --

var globalRelay *Relay

// -- Structs --

// RelayInfo contains light information of Relay, in mesh-friendly format
type RelayInfo struct {
	ID            peer.ID
	MeshAddrs     []string                                 // Addresses of this relay
	MeshRooms     *common.SafeMap[string, shared.RoomInfo] // Rooms hosted by this relay
	MeshLatencies *common.SafeMap[string, time.Duration]   // Latencies to other peers from this relay
}

// Relay structure enhanced with metrics and state
type Relay struct {
	RelayInfo

	Host        host.Host      // libp2p host for peer-to-peer networking
	PubSub      *pubsub.PubSub // PubSub for state synchronization
	PingService *ping.PingService

	// Local
	LocalRooms           *common.SafeMap[ulid.ULID, *shared.Room]         // room ID -> local Room struct (hosted by this relay)
	LocalMeshPeers       *common.SafeMap[peer.ID, *RelayInfo]             // peer ID -> mesh peer relay info (connected to this relay)
	LocalMeshConnections *common.SafeMap[peer.ID, *webrtc.PeerConnection] // peer ID -> PeerConnection (connected to this relay)

	// Protocols
	ProtocolRegistry

	// PubSub Topics
	pubTopicState        *pubsub.Topic // topic for room states
	pubTopicRelayMetrics *pubsub.Topic // topic for relay metrics/status
}

func NewRelay(ctx context.Context, port int, identityKey crypto.PrivKey) (*Relay, error) {
	listenAddrs := []string{
		fmt.Sprintf("/ip4/0.0.0.0/tcp/%d", port),    // IPv4 - Raw TCP
		fmt.Sprintf("/ip6/::/tcp/%d", port),         // IPv6 - Raw TCP
		fmt.Sprintf("/ip4/0.0.0.0/tcp/%d/ws", port), // IPv4 - TCP WebSocket
		fmt.Sprintf("/ip6/::/tcp/%d/ws", port),      // IPv6 - TCP WebSocket
	}

	var muAddrs []multiaddr.Multiaddr
	for _, addr := range listenAddrs {
		multiAddr, err := multiaddr.NewMultiaddr(addr)
		if err != nil {
			return nil, fmt.Errorf("failed to parse multiaddr '%s': %w", addr, err)
		}
		muAddrs = append(muAddrs, multiAddr)
	}

	// Initialize libp2p host
	p2pHost, err := libp2p.New(
		// TODO: Currently static identity
		libp2p.Identity(identityKey),
		// Enable required transports
		libp2p.Transport(tcp.NewTCPTransport),
		libp2p.Transport(ws.New),
		// Other options
		libp2p.ListenAddrs(muAddrs...),
		libp2p.Security(noise.ID, noise.New),
		libp2p.EnableRelay(),
		libp2p.EnableHolePunching(),
		libp2p.EnableNATService(),
		libp2p.EnableAutoNATv2(),
		libp2p.ShareTCPListener(),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create libp2p host for relay: %w", err)
	}

	// Set up pubsub
	p2pPubsub, err := pubsub.NewGossipSub(ctx, p2pHost)
	if err != nil {
		return nil, fmt.Errorf("failed to create pubsub: %w, addrs: %v", err, p2pHost.Addrs())
	}

	// Initialize Ping Service
	pingSvc := ping.NewPingService(p2pHost)

	var addresses []string
	for _, addr := range p2pHost.Addrs() {
		addresses = append(addresses, addr.String())
	}

	r := &Relay{
		RelayInfo: RelayInfo{
			ID:            p2pHost.ID(),
			MeshAddrs:     addresses,
			MeshRooms:     common.NewSafeMap[string, shared.RoomInfo](),
			MeshLatencies: common.NewSafeMap[string, time.Duration](),
		},
		Host:           p2pHost,
		PubSub:         p2pPubsub,
		PingService:    pingSvc,
		LocalRooms:     common.NewSafeMap[ulid.ULID, *shared.Room](),
		LocalMeshPeers: common.NewSafeMap[peer.ID, *RelayInfo](),
	}

	// Add network notifier after relay is initialized
	p2pHost.Network().Notify(&networkNotifier{relay: r})

	// Set up PubSub topics and handlers
	if err = r.setupPubSub(ctx); err != nil {
		err = p2pHost.Close()
		if err != nil {
			slog.Error("Failed to close host after PubSub setup failure", "err", err)
		}
		return nil, fmt.Errorf("failed to setup PubSub: %w", err)
	}

	// Initialize Protocol Registry
	r.ProtocolRegistry = NewProtocolRegistry(r)

	// Start discovery features
	if err = startMDNSDiscovery(r); err != nil {
		slog.Warn("Failed to initialize mDNS discovery, continuing without..", "error", err)
	}

	// Start background tasks
	go r.periodicMetricsPublisher(ctx)

	printConnectInstructions(p2pHost)

	return r, nil
}

func InitRelay(ctx context.Context, ctxCancel context.CancelFunc) error {
	var err error
	persistentDir := common.GetFlags().PersistDir

	// Load or generate identity key
	var identityKey crypto.PrivKey
	var privKey ed25519.PrivateKey
	// First check if we need to generate identity
	hasIdentity := len(persistentDir) > 0 && common.GetFlags().RegenIdentity == false
	if hasIdentity {
		_, err = os.Stat(persistentDir + "/identity.key")
		if err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("failed to check identity key file: %w", err)
		} else if os.IsNotExist(err) {
			hasIdentity = false
		}
	}
	if !hasIdentity {
		// Make sure the persistent directory exists
		if err = os.MkdirAll(persistentDir, 0700); err != nil {
			return fmt.Errorf("failed to create persistent data directory: %w", err)
		}
		// Generate
		slog.Info("Generating new identity for relay")
		privKey, err = common.GenerateED25519Key()
		if err != nil {
			return fmt.Errorf("failed to generate new identity: %w", err)
		}
		// Save the key
		if err = common.SaveED25519Key(privKey, persistentDir+"/identity.key"); err != nil {
			return fmt.Errorf("failed to save identity key: %w", err)
		}
		slog.Info("New identity generated and saved", "path", persistentDir+"/identity.key")
	} else {
		slog.Info("Loading existing identity for relay", "path", persistentDir+"/identity.key")
		// Load the key
		privKey, err = common.LoadED25519Key(persistentDir + "/identity.key")
		if err != nil {
			return fmt.Errorf("failed to load identity key: %w", err)
		}
	}

	// Convert to libp2p crypto.PrivKey
	identityKey, err = crypto.UnmarshalEd25519PrivateKey(privKey)
	if err != nil {
		return fmt.Errorf("failed to unmarshal ED25519 private key: %w", err)
	}

	globalRelay, err = NewRelay(ctx, common.GetFlags().EndpointPort, identityKey)
	if err != nil {
		return fmt.Errorf("failed to create relay: %w", err)
	}

	if err = common.InitWebRTCAPI(); err != nil {
		return err
	}

	slog.Info("Relay initialized", "id", globalRelay.ID)
	return nil
}
