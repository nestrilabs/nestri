package common

import (
	"fmt"
	"github.com/libp2p/go-reuseport"
	"github.com/pion/ice/v4"
	"github.com/pion/interceptor"
	"github.com/pion/webrtc/v4"
	"log/slog"
	"strconv"
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

	// Register additional header extensions to reduce latency
	// Playout Delay
	if err := mediaEngine.RegisterHeaderExtension(webrtc.RTPHeaderExtensionCapability{
		URI: ExtensionPlayoutDelay,
	}, webrtc.RTPCodecTypeVideo); err != nil {
		return err
	}
	if err := mediaEngine.RegisterHeaderExtension(webrtc.RTPHeaderExtensionCapability{
		URI: ExtensionPlayoutDelay,
	}, webrtc.RTPCodecTypeAudio); err != nil {
		return err
	}

	// Default codecs cover most of our needs
	err = mediaEngine.RegisterDefaultCodecs()
	if err != nil {
		return err
	}

	// Add H.265 for special cases
	videoRTCPFeedback := []webrtc.RTCPFeedback{{"goog-remb", ""}, {"ccm", "fir"}, {"nack", ""}, {"nack", "pli"}}
	for _, codec := range []webrtc.RTPCodecParameters{
		{
			RTPCodecCapability: webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeH265, ClockRate: 90000, RTCPFeedback: videoRTCPFeedback},
			PayloadType:        48,
		},
		{
			RTPCodecCapability: webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeRTX, ClockRate: 90000, SDPFmtpLine: "apt=48"},
			PayloadType:        49,
		},
	} {
		if err = mediaEngine.RegisterCodec(codec, webrtc.RTPCodecTypeVideo); err != nil {
			return err
		}
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

	nat11IPs := GetFlags().NAT11IPs
	if len(nat11IPs) > 0 {
		settingEngine.SetNAT1To1IPs(nat11IPs, webrtc.ICECandidateTypeHost)
	}

	muxPort := GetFlags().UDPMuxPort
	if muxPort > 0 {
		// Use reuseport to allow multiple listeners on the same port
		pktListener, err := reuseport.ListenPacket("udp", ":"+strconv.Itoa(muxPort))
		if err != nil {
			return fmt.Errorf("failed to create UDP listener: %w", err)
		}

		mux := ice.NewMultiUDPMuxDefault(ice.NewUDPMuxDefault(ice.UDPMuxParams{
			UDPConn: pktListener,
		}))
		slog.Info("Using UDP Mux for WebRTC", "port", muxPort)
		settingEngine.SetICEUDPMux(mux)
	}

	// Set the UDP port range used by WebRTC
	err = settingEngine.SetEphemeralUDPPortRange(uint16(flags.WebRTCUDPStart), uint16(flags.WebRTCUDPEnd))
	if err != nil {
		return err
	}

	settingEngine.SetIncludeLoopbackCandidate(true) // Just in case

	// Create a new API object with our customized settings
	globalWebRTCAPI = webrtc.NewAPI(webrtc.WithMediaEngine(mediaEngine), webrtc.WithSettingEngine(settingEngine), webrtc.WithInterceptorRegistry(interceptorRegistry))

	return nil
}

// GetWebRTCAPI returns the global WebRTC API
func GetWebRTCAPI() *webrtc.API {
	return globalWebRTCAPI
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
