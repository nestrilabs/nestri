package common

import (
	"flag"
	"log/slog"
	"net"
	"os"
	"strconv"

	"github.com/pion/webrtc/v4"
)

var globalFlags *Flags

type Flags struct {
	RegenIdentity  bool   // Remove old identity on startup and regenerate it
	Verbose        bool   // Log everything to console
	Debug          bool   // Enable debug mode, implies Verbose
	EndpointPort   int    // Port for HTTP/S and WS/S endpoint (TCP)
	WebRTCUDPStart int    // WebRTC UDP port range start - ignored if UDPMuxPort is set
	WebRTCUDPEnd   int    // WebRTC UDP port range end - ignored if UDPMuxPort is set
	STUNServer     string // WebRTC STUN server
	UDPMuxPort     int    // WebRTC UDP mux port - if set, overrides UDP port range
	AutoAddLocalIP bool   // Automatically add local IP to NAT 1 to 1 IPs
	NAT11IP        string // WebRTC NAT 1 to 1 IP - allows specifying IP of relay if behind NAT
	PersistDir     string // Directory to save persistent data to
	Metrics        bool   // Enable metrics endpoint
	MetricsPort    int    // Port for metrics endpoint
}

func (flags *Flags) DebugLog() {
	slog.Debug("Relay flags",
		"regenIdentity", flags.RegenIdentity,
		"verbose", flags.Verbose,
		"debug", flags.Debug,
		"endpointPort", flags.EndpointPort,
		"webrtcUDPStart", flags.WebRTCUDPStart,
		"webrtcUDPEnd", flags.WebRTCUDPEnd,
		"stunServer", flags.STUNServer,
		"webrtcUDPMux", flags.UDPMuxPort,
		"autoAddLocalIP", flags.AutoAddLocalIP,
		"webrtcNAT11IPs", flags.NAT11IP,
		"persistDir", flags.PersistDir,
		"metrics", flags.Metrics,
		"metricsPort", flags.MetricsPort,
	)
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
	flag.BoolVar(&globalFlags.RegenIdentity, "regenIdentity", getEnvAsBool("REGEN_IDENTITY", false), "Regenerate identity on startup")
	flag.BoolVar(&globalFlags.Verbose, "verbose", getEnvAsBool("VERBOSE", false), "Verbose mode")
	flag.BoolVar(&globalFlags.Debug, "debug", getEnvAsBool("DEBUG", false), "Debug mode")
	flag.IntVar(&globalFlags.EndpointPort, "endpointPort", getEnvAsInt("ENDPOINT_PORT", 8088), "HTTP endpoint port")
	flag.IntVar(&globalFlags.WebRTCUDPStart, "webrtcUDPStart", getEnvAsInt("WEBRTC_UDP_START", 0), "WebRTC UDP port range start")
	flag.IntVar(&globalFlags.WebRTCUDPEnd, "webrtcUDPEnd", getEnvAsInt("WEBRTC_UDP_END", 0), "WebRTC UDP port range end")
	flag.StringVar(&globalFlags.STUNServer, "stunServer", getEnvAsString("STUN_SERVER", "stun.l.google.com:19302"), "WebRTC STUN server")
	flag.IntVar(&globalFlags.UDPMuxPort, "webrtcUDPMux", getEnvAsInt("WEBRTC_UDP_MUX", 9099), "WebRTC UDP mux port")
	flag.BoolVar(&globalFlags.AutoAddLocalIP, "autoAddLocalIP", getEnvAsBool("AUTO_ADD_LOCAL_IP", false), "Automatically add local IP to NAT 1 to 1 IPs")
	// String with comma separated IPs
	nat11IP := ""
	flag.StringVar(&nat11IP, "webrtcNAT11IP", getEnvAsString("WEBRTC_NAT_IP", ""), "WebRTC NAT 1 to 1 IP")
	flag.StringVar(&globalFlags.PersistDir, "persistDir", getEnvAsString("PERSIST_DIR", "./persist-data"), "Directory to save persistent data to")
	flag.BoolVar(&globalFlags.Metrics, "metrics", getEnvAsBool("METRICS", false), "Enable metrics endpoint")
	flag.IntVar(&globalFlags.MetricsPort, "metricsPort", getEnvAsInt("METRICS_PORT", 3030), "Port for metrics endpoint")
	// Parse flags
	flag.Parse()

	// If debug is enabled, verbose is also enabled
	if globalFlags.Debug {
		globalFlags.Verbose = true
	}

	// ICE STUN servers
	globalWebRTCConfig.ICEServers = []webrtc.ICEServer{
		{
			URLs: []string{"stun:" + globalFlags.STUNServer},
		},
	}

	// Parse NAT 1 to 1 IPs from string
	if len(nat11IP) > 0 {
		globalFlags.NAT11IP = nat11IP
	} else if globalFlags.AutoAddLocalIP {
		globalFlags.NAT11IP = getLocalIP()
	}
}

func GetFlags() *Flags {
	return globalFlags
}

// getLocalIP returns local IP, be it either IPv4 or IPv6, skips loopback addresses
func getLocalIP() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return ""
	}
	for _, address := range addrs {
		if ipnet, ok := address.(*net.IPNet); ok && !ipnet.IP.IsLoopback() {
			if ipnet.IP.To4() != nil || ipnet.IP != nil {
				return ipnet.IP.String()
			}
		}
	}
	return ""
}
