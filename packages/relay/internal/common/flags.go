package common

import (
	"flag"
	"github.com/pion/webrtc/v4"
	"log/slog"
	"net"
	"os"
	"strconv"
	"strings"
)

var globalFlags *Flags

type Flags struct {
	Verbose        bool     // Log everything to console
	Debug          bool     // Enable debug mode, implies Verbose
	EndpointPort   int      // Port for HTTP/S and WS/S endpoint (TCP)
	MeshPort       int      // Port for Mesh connections (TCP)
	WebRTCUDPStart int      // WebRTC UDP port range start - ignored if UDPMuxPort is set
	WebRTCUDPEnd   int      // WebRTC UDP port range end - ignored if UDPMuxPort is set
	STUNServer     string   // WebRTC STUN server
	UDPMuxPort     int      // WebRTC UDP mux port - if set, overrides UDP port range
	AutoAddLocalIP bool     // Automatically add local IP to NAT 1 to 1 IPs
	NAT11IPs       []string // WebRTC NAT 1 to 1 IP(s) - allows specifying host IP(s) if behind NAT
	TLSCert        string   // Path to TLS certificate
	TLSKey         string   // Path to TLS key
	ControlSecret  string   // Shared secret for this relay's control endpoint
}

func (flags *Flags) DebugLog() {
	slog.Info("Relay flags",
		"verbose", flags.Verbose,
		"debug", flags.Debug,
		"endpointPort", flags.EndpointPort,
		"meshPort", flags.MeshPort,
		"webrtcUDPStart", flags.WebRTCUDPStart,
		"webrtcUDPEnd", flags.WebRTCUDPEnd,
		"stunServer", flags.STUNServer,
		"webrtcUDPMux", flags.UDPMuxPort,
		"autoAddLocalIP", flags.AutoAddLocalIP,
		"webrtcNAT11IPs", strings.Join(flags.NAT11IPs, ","),
		"tlsCert", flags.TLSCert,
		"tlsKey", flags.TLSKey,
		"controlSecret", flags.ControlSecret,
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
	flag.BoolVar(&globalFlags.Verbose, "verbose", getEnvAsBool("VERBOSE", false), "Verbose mode")
	flag.BoolVar(&globalFlags.Debug, "debug", getEnvAsBool("DEBUG", false), "Debug mode")
	flag.IntVar(&globalFlags.EndpointPort, "endpointPort", getEnvAsInt("ENDPOINT_PORT", 8088), "HTTP endpoint port")
	flag.IntVar(&globalFlags.MeshPort, "meshPort", getEnvAsInt("MESH_PORT", 8089), "Mesh connections TCP port")
	flag.IntVar(&globalFlags.WebRTCUDPStart, "webrtcUDPStart", getEnvAsInt("WEBRTC_UDP_START", 10000), "WebRTC UDP port range start")
	flag.IntVar(&globalFlags.WebRTCUDPEnd, "webrtcUDPEnd", getEnvAsInt("WEBRTC_UDP_END", 20000), "WebRTC UDP port range end")
	flag.StringVar(&globalFlags.STUNServer, "stunServer", getEnvAsString("STUN_SERVER", "stun.l.google.com:19302"), "WebRTC STUN server")
	flag.IntVar(&globalFlags.UDPMuxPort, "webrtcUDPMux", getEnvAsInt("WEBRTC_UDP_MUX", 8088), "WebRTC UDP mux port")
	flag.BoolVar(&globalFlags.AutoAddLocalIP, "autoAddLocalIP", getEnvAsBool("AUTO_ADD_LOCAL_IP", true), "Automatically add local IP to NAT 1 to 1 IPs")
	// String with comma separated IPs
	nat11IPs := ""
	flag.StringVar(&nat11IPs, "webrtcNAT11IPs", getEnvAsString("WEBRTC_NAT_IPS", ""), "WebRTC NAT 1 to 1 IP(s), comma delimited")
	flag.StringVar(&globalFlags.TLSCert, "tlsCert", getEnvAsString("TLS_CERT", ""), "Path to TLS certificate")
	flag.StringVar(&globalFlags.TLSKey, "tlsKey", getEnvAsString("TLS_KEY", ""), "Path to TLS key")
	flag.StringVar(&globalFlags.ControlSecret, "controlSecret", getEnvAsString("CONTROL_SECRET", ""), "Shared secret for control endpoint")
	// Parse flags
	flag.Parse()

	// If debug is enabled, verbose is also enabled
	if globalFlags.Debug {
		globalFlags.Verbose = true
		// If Debug is enabled, set ControlSecret to 1234
		globalFlags.ControlSecret = "1234"
	}

	// ICE STUN servers
	globalWebRTCConfig.ICEServers = []webrtc.ICEServer{
		{
			URLs: []string{"stun:" + globalFlags.STUNServer},
		},
	}

	// Initialize NAT 1 to 1 IPs
	globalFlags.NAT11IPs = []string{}

	// Get local IP
	if globalFlags.AutoAddLocalIP {
		globalFlags.NAT11IPs = append(globalFlags.NAT11IPs, getLocalIP())
	}

	// Parse NAT 1 to 1 IPs from string
	if len(nat11IPs) > 0 {
		split := strings.Split(nat11IPs, ",")
		if len(split) > 0 {
			for _, ip := range split {
				globalFlags.NAT11IPs = append(globalFlags.NAT11IPs, ip)
			}
		} else {
			globalFlags.NAT11IPs = append(globalFlags.NAT11IPs, nat11IPs)
		}
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
