package relay

import (
	"flag"
	"log"
	"os"
	"strconv"

	"github.com/pion/webrtc/v4"
)

var globalFlags *Flags

type Flags struct {
	Verbose        bool
	Debug          bool
	EndpointPort   int
	WebRTCUDPStart int
	WebRTCUDPEnd   int
	STUNServer     string
	UDPMuxPort     int
	NAT11IP        string
}

func (flags *Flags) DebugLog() {
	log.Println("Relay Flags:")
	log.Println("> Verbose: ", flags.Verbose)
	log.Println("> Debug: ", flags.Debug)
	log.Println("> Endpoint Port: ", flags.EndpointPort)
	log.Println("> WebRTC UDP Range Start: ", flags.WebRTCUDPStart)
	log.Println("> WebRTC UDP Range End: ", flags.WebRTCUDPEnd)
	log.Println("> WebRTC STUN Server: ", flags.STUNServer)
	log.Println("> WebRTC UDP Mux Port: ", flags.UDPMuxPort)
	log.Println("> WebRTC NAT 1-1 IP: ", flags.NAT11IP)
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

func InitFlags() {
	// Create Flags struct
	globalFlags = &Flags{}
	// Get flags
	flag.BoolVar(&globalFlags.Verbose, "verbose", getEnvAsBool("VERBOSE", false), "Verbose mode")
	flag.BoolVar(&globalFlags.Debug, "debug", getEnvAsBool("DEBUG", false), "Debug mode")
	flag.IntVar(&globalFlags.EndpointPort, "endpointPort", getEnvAsInt("ENDPOINT_PORT", 8088), "HTTP endpoint port")
	flag.IntVar(&globalFlags.WebRTCUDPStart, "webrtcUDPStart", getEnvAsInt("WEBRTC_UDP_START", 10000), "WebRTC UDP port range start")
	flag.IntVar(&globalFlags.WebRTCUDPEnd, "webrtcUDPEnd", getEnvAsInt("WEBRTC_UDP_END", 20000), "WebRTC UDP port range end")
	flag.StringVar(&globalFlags.STUNServer, "stunServer", getEnvAsString("STUN_SERVER", "stun.l.google.com:19302"), "WebRTC STUN server")
	flag.IntVar(&globalFlags.UDPMuxPort, "webrtcUDPMux", getEnvAsInt("WEBRTC_UDP_MUX", 0), "WebRTC UDP mux port")
	flag.StringVar(&globalFlags.NAT11IP, "webrtcNAT11IP", getEnvAsString("WEBRTC_NAT_IP", ""), "WebRTC NAT 1 to 1 IP")
	// Parse flags
	flag.Parse()

	// ICE STUN servers
	globalWebRTCConfig.ICEServers = []webrtc.ICEServer{
		{
			URLs: []string{"stun:" + globalFlags.STUNServer},
		},
	}
}

func GetFlags() *Flags {
	return globalFlags
}
