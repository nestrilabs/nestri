package core

import (
	"context"
	"crypto/ed25519"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"os"
	"relay/internal/common"
	"relay/internal/shared"

	"github.com/libp2p/go-libp2p"
	pubsub "github.com/libp2p/go-libp2p-pubsub"
	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	rcmgr "github.com/libp2p/go-libp2p/p2p/host/resource-manager"
	"github.com/libp2p/go-libp2p/p2p/protocol/ping"
	"github.com/libp2p/go-libp2p/p2p/security/noise"
	"github.com/libp2p/go-libp2p/p2p/transport/quicreuse"
	"github.com/libp2p/go-libp2p/p2p/transport/tcp"
	ws "github.com/libp2p/go-libp2p/p2p/transport/websocket"
	webtransport "github.com/libp2p/go-libp2p/p2p/transport/webtransport"
	"github.com/multiformats/go-multiaddr"
	"github.com/oklog/ulid/v2"
	"github.com/pion/webrtc/v4"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// -- Variables --

var globalRelay *Relay

// -- Structs --

// Relay structure enhanced with metrics and state
type Relay struct {
	*PeerInfo

	Host        host.Host      // libp2p host for peer-to-peer networking
	PubSub      *pubsub.PubSub // PubSub for state synchronization
	PingService *ping.PingService

	// Local
	LocalRooms           *common.SafeMap[ulid.ULID, *shared.Room]         // room ID -> local Room struct (hosted by this relay)
	LocalMeshConnections *common.SafeMap[peer.ID, *webrtc.PeerConnection] // peer ID -> PeerConnection (connected to this relay)

	// Protocols
	ProtocolRegistry

	// PubSub Topics
	pubTopicState        *pubsub.Topic // topic for room states
	pubTopicRelayMetrics *pubsub.Topic // topic for relay metrics/status
}

func NewRelay(ctx context.Context, port int, identityKey crypto.PrivKey) (*Relay, error) {
	// If metrics are enabled, start the metrics server first
	metricsOpts := make([]libp2p.Option, 0)
	var rmgr network.ResourceManager
	if common.GetFlags().Metrics {
		go func() {
			slog.Info("Starting prometheus metrics server at '/debug/metrics/prometheus'", "port", common.GetFlags().MetricsPort)
			http.Handle("/debug/metrics/prometheus", promhttp.Handler())
			if err := http.ListenAndServe(fmt.Sprintf(":%d", common.GetFlags().MetricsPort), nil); err != nil {
				slog.Error("Failed to start metrics server", "err", err)
			}
		}()

		rcmgr.MustRegisterWith(prometheus.DefaultRegisterer)

		str, err := rcmgr.NewStatsTraceReporter()
		if err != nil {
			log.Fatal(err)
		}

		rmgr, err = rcmgr.NewResourceManager(rcmgr.NewFixedLimiter(rcmgr.DefaultLimits.AutoScale()), rcmgr.WithTraceReporter(str))
		if err != nil {
			log.Fatal(err)
		}

		metricsOpts = append(metricsOpts, libp2p.ResourceManager(rmgr))
		metricsOpts = append(metricsOpts, libp2p.PrometheusRegisterer(prometheus.DefaultRegisterer))
	} else {
		rmgr = nil
	}

	listenAddrs := []string{
		fmt.Sprintf("/ip4/0.0.0.0/tcp/%d", port),                      // IPv4 - Raw TCP
		fmt.Sprintf("/ip6/::/tcp/%d", port),                           // IPv6 - Raw TCP
		fmt.Sprintf("/ip4/0.0.0.0/tcp/%d/ws", port),                   // IPv4 - TCP WebSocket
		fmt.Sprintf("/ip6/::/tcp/%d/ws", port),                        // IPv6 - TCP WebSocket
		fmt.Sprintf("/ip4/0.0.0.0/udp/%d/quic-v1/webtransport", port), // IPv4 - UDP QUIC WebTransport
		fmt.Sprintf("/ip6/::/udp/%d/quic-v1/webtransport", port),      // IPv6 - UDP QUIC WebTransport
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
		libp2p.ChainOptions(metricsOpts...),
		libp2p.Identity(identityKey),
		// Enable required transports
		libp2p.Transport(tcp.NewTCPTransport),
		libp2p.Transport(ws.New),
		libp2p.Transport(webtransport.New),
		// Other options
		libp2p.ListenAddrs(muAddrs...),
		libp2p.Security(noise.ID, noise.New),
		libp2p.EnableRelay(),
		libp2p.EnableHolePunching(),
		libp2p.EnableNATService(),
		libp2p.EnableAutoNATv2(),
		libp2p.ShareTCPListener(),
		libp2p.QUICReuse(quicreuse.NewConnManager),
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

	r := &Relay{
		PeerInfo:             NewPeerInfo(p2pHost.ID(), p2pHost.Addrs()),
		Host:                 p2pHost,
		PubSub:               p2pPubsub,
		PingService:          pingSvc,
		LocalRooms:           common.NewSafeMap[ulid.ULID, *shared.Room](),
		LocalMeshConnections: common.NewSafeMap[peer.ID, *webrtc.PeerConnection](),
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

func InitRelay(ctx context.Context, ctxCancel context.CancelFunc) (*Relay, error) {
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
			return nil, fmt.Errorf("failed to check identity key file: %w", err)
		} else if os.IsNotExist(err) {
			hasIdentity = false
		}
	}
	if !hasIdentity {
		// Make sure the persistent directory exists
		if err = os.MkdirAll(persistentDir, 0700); err != nil {
			return nil, fmt.Errorf("failed to create persistent data directory: %w", err)
		}
		// Generate
		slog.Info("Generating new identity for relay")
		privKey, err = common.GenerateED25519Key()
		if err != nil {
			return nil, fmt.Errorf("failed to generate new identity: %w", err)
		}
		// Save the key
		if err = common.SaveED25519Key(privKey, persistentDir+"/identity.key"); err != nil {
			return nil, fmt.Errorf("failed to save identity key: %w", err)
		}
		slog.Info("New identity generated and saved", "path", persistentDir+"/identity.key")
	} else {
		slog.Info("Loading existing identity for relay", "path", persistentDir+"/identity.key")
		// Load the key
		privKey, err = common.LoadED25519Key(persistentDir + "/identity.key")
		if err != nil {
			return nil, fmt.Errorf("failed to load identity key: %w", err)
		}
	}

	// Convert to libp2p crypto.PrivKey
	identityKey, err = crypto.UnmarshalEd25519PrivateKey(privKey)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal ED25519 private key: %w", err)
	}

	globalRelay, err = NewRelay(ctx, common.GetFlags().EndpointPort, identityKey)
	if err != nil {
		return nil, fmt.Errorf("failed to create relay: %w", err)
	}

	if err = common.InitWebRTCAPI(); err != nil {
		return nil, err
	}

	slog.Info("Relay initialized", "id", globalRelay.ID)

	// Load previous peers on startup
	defaultFile := common.GetFlags().PersistDir + "/peerstore.json"
	if err = globalRelay.LoadFromFile(defaultFile); err != nil {
		slog.Warn("Failed to load previous peer store", "error", err)
	} else {
		globalRelay.Peers.Range(func(id peer.ID, pi *PeerInfo) bool {
			if len(pi.Addrs) <= 0 {
				slog.Warn("Peer from peer store has no addresses", "peer", id)
				return true
			}

			// Connect to first address only
			if err = globalRelay.ConnectToPeer(context.Background(), pi.Addrs[0]); err != nil {
				slog.Error("Failed to connect to peer from peer store", "peer", id, "error", err)
			}
			return true
		})
	}

	return globalRelay, nil
}
