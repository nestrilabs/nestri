package common

const (
	ExtensionPlayoutDelay string = "http://www.webrtc.org/experiments/rtp-hdrext/playout-delay"
)

// ExtensionMap maps URIs to their IDs based on registration order
// IMPORTANT: This must match the order in which extensions are registered in common.go!
var ExtensionMap = map[string]uint8{
	ExtensionPlayoutDelay: 1,
}
