package common

import "github.com/pion/webrtc/v4"

const (
	ExtensionPlayoutDelay string = "http://www.webrtc.org/experiments/rtp-hdrext/playout-delay"
)

// ExtensionMap maps audio/video extension URIs to their IDs based on registration order
var ExtensionMap = map[webrtc.RTPCodecType]map[string]uint8{}

func RegisterExtensions(mediaEngine *webrtc.MediaEngine) error {
	// Register additional header extensions to reduce latency
	// Playout Delay (Video)
	if err := mediaEngine.RegisterHeaderExtension(webrtc.RTPHeaderExtensionCapability{
		URI: ExtensionPlayoutDelay,
	}, webrtc.RTPCodecTypeVideo); err != nil {
		return err
	}
	// Playout Delay (Audio)
	if err := mediaEngine.RegisterHeaderExtension(webrtc.RTPHeaderExtensionCapability{
		URI: ExtensionPlayoutDelay,
	}, webrtc.RTPCodecTypeAudio); err != nil {
		return err
	}

	// Register the extension IDs for both audio and video
	ExtensionMap[webrtc.RTPCodecTypeAudio] = map[string]uint8{
		ExtensionPlayoutDelay: 1,
	}
	ExtensionMap[webrtc.RTPCodecTypeVideo] = map[string]uint8{
		ExtensionPlayoutDelay: 1,
	}

	return nil
}

func GetExtension(codecType webrtc.RTPCodecType, extURI string) (uint8, bool) {
	cType, ok := ExtensionMap[codecType]
	if !ok {
		return 0, false
	}
	extID, ok := cType[extURI]
	return extID, ok
}
