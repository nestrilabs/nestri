package webrtcrelay

import (
	"flag"
	"github.com/pion/webrtc/v4"
	"log"
	"os"
	"strconv"
)

var globalFlags *RelayFlags

type RelayFlags struct {
	Verbose        bool
	EndpointPort   int
	WebRTCUDPStart int
	WebRTCUDPEnd   int
	STUNServer     string
}

func (flags *RelayFlags) DebugLog() {
	log.Println("Relay Flags:")
	log.Println("> Verbose: ", flags.Verbose)
	log.Println("> Endpoint Port: ", flags.EndpointPort)
	log.Println("> WebRTC UDP Range Start: ", flags.WebRTCUDPStart)
	log.Println("> WebRTC UDP Range End: ", flags.WebRTCUDPEnd)
	log.Println("> WebRTC STUN Server: ", flags.STUNServer)
}

func getEnvAsInt(name string, defaultVal int) int {
	valueStr := os.Getenv(name)
	if value, err := strconv.Atoi(valueStr); err != nil {
		return defaultVal
	} else {
		return value
	}
}

func getEnvAsBool(name string, defaultVal bool) bool {
	valueStr := os.Getenv(name)
	val, err := strconv.ParseBool(valueStr)
	if err != nil {
		return defaultVal
	}
	return val
}

func getEnvAsString(name string, defaultVal string) string {
	valueStr := os.Getenv(name)
	if len(valueStr) == 0 {
		return defaultVal
	}
	return valueStr
}

func InitRelayFlags() {
	// Create Flags struct
	globalFlags = &RelayFlags{}
	// Get flags
	flag.BoolVar(&globalFlags.Verbose, "verbose", getEnvAsBool("VERBOSE", false), "Verbose mode")
	flag.IntVar(&globalFlags.EndpointPort, "endpointPort", getEnvAsInt("ENDPOINT_PORT", 8088), "HTTP endpoint port")
	flag.IntVar(&globalFlags.WebRTCUDPStart, "webrtcUDPStart", getEnvAsInt("WEBRTC_UDP_START", 10000), "WebRTC UDP port range start")
	flag.IntVar(&globalFlags.WebRTCUDPEnd, "webrtcUDPEnd", getEnvAsInt("WEBRTC_UDP_END", 20000), "WebRTC UDP port range end")
	flag.StringVar(&globalFlags.STUNServer, "stunServer", getEnvAsString("STUN_SERVER", "stun.l.google.com:19302"), "WebRTC STUN server")
	// Parse flags
	flag.Parse()

	// ICE STUN servers
	globalWebRTCConfig.ICEServers = []webrtc.ICEServer{
		{
			URLs: []string{"stun:" + globalFlags.STUNServer},
		},
	}
}

func GetRelayFlags() *RelayFlags {
	return globalFlags
}
