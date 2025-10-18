package common

import (
	"fmt"
	"log/slog"
	"strconv"

	"github.com/libp2p/go-reuseport"
	"github.com/pion/ice/v4"
	"github.com/pion/interceptor"
	"github.com/pion/webrtc/v4"
)

var globalWebRTCAPI *webrtc.API
var globalWebRTCConfig = webrtc.Configuration{
	ICETransportPolicy: webrtc.ICETransportPolicyAll,
	BundlePolicy:       webrtc.BundlePolicyBalanced,
	SDPSemantics:       webrtc.SDPSemanticsUnifiedPlan,
}

func InitWebRTCAPI() error {
	var err error
	flags := GetFlags()

	// Media engine
	mediaEngine := &webrtc.MediaEngine{}

	// Register our extensions
	if err := RegisterExtensions(mediaEngine); err != nil {
		return fmt.Errorf("failed to register extensions: %w", err)
	}

	// Default codecs cover our needs
	err = mediaEngine.RegisterDefaultCodecs()
	if err != nil {
		return err
	}

	// Interceptor registry
	interceptorRegistry := &interceptor.Registry{}

	// Use default set
	err = webrtc.RegisterDefaultInterceptors(mediaEngine, interceptorRegistry)
	if err != nil {
		return err
	}

	// Setting engine
	settingEngine := webrtc.SettingEngine{}

	// New in v4, reduces CPU usage and latency when enabled
	settingEngine.EnableSCTPZeroChecksum(true)

	nat11IP := GetFlags().NAT11IP
	if len(nat11IP) > 0 {
		settingEngine.SetNAT1To1IPs([]string{nat11IP}, webrtc.ICECandidateTypeSrflx)
		slog.Info("Using NAT 1:1 IP for WebRTC", "nat11_ip", nat11IP)
	}

	muxPort := GetFlags().UDPMuxPort
	if muxPort > 0 {
		// Use reuseport to allow multiple listeners on the same port
		pktListener, err := reuseport.ListenPacket("udp", ":"+strconv.Itoa(muxPort))
		if err != nil {
			return fmt.Errorf("failed to create WebRTC muxed UDP listener: %w", err)
		}

		mux := ice.NewMultiUDPMuxDefault(ice.NewUDPMuxDefault(ice.UDPMuxParams{
			UDPConn: pktListener,
		}))
		slog.Info("Using UDP Mux for WebRTC", "port", muxPort)
		settingEngine.SetICEUDPMux(mux)
	}

	if flags.WebRTCUDPStart > 0 && flags.WebRTCUDPEnd > 0 && flags.WebRTCUDPStart < flags.WebRTCUDPEnd {
		// Set the UDP port range used by WebRTC
		err = settingEngine.SetEphemeralUDPPortRange(uint16(flags.WebRTCUDPStart), uint16(flags.WebRTCUDPEnd))
		if err != nil {
			return err
		}
		slog.Info("Using WebRTC UDP Port Range", "start", flags.WebRTCUDPStart, "end", flags.WebRTCUDPEnd)
	}

	// Improves speed when sending offers to browsers (https://github.com/pion/webrtc/issues/3174)
	settingEngine.SetIncludeLoopbackCandidate(true)

	// Create a new API object with our customized settings
	globalWebRTCAPI = webrtc.NewAPI(webrtc.WithMediaEngine(mediaEngine), webrtc.WithSettingEngine(settingEngine), webrtc.WithInterceptorRegistry(interceptorRegistry))

	return nil
}

// CreatePeerConnection sets up a new peer connection
func CreatePeerConnection(onClose func()) (*webrtc.PeerConnection, error) {
	pc, err := globalWebRTCAPI.NewPeerConnection(globalWebRTCConfig)
	if err != nil {
		return nil, err
	}

	// Log connection state changes and handle failed/disconnected connections
	pc.OnConnectionStateChange(func(connectionState webrtc.PeerConnectionState) {
		// Close PeerConnection in cases
		if connectionState == webrtc.PeerConnectionStateFailed ||
			connectionState == webrtc.PeerConnectionStateDisconnected ||
			connectionState == webrtc.PeerConnectionStateClosed {
			err = pc.Close()
			if err != nil {
				slog.Error("Failed to close PeerConnection", "err", err)
			}
			onClose()
		}
	})

	return pc, nil
}
