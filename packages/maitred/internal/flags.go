package internal

import (
	"flag"
	"log/slog"
	"os"
	"strconv"
)

var globalFlags *Flags

type Flags struct {
	Verbose   bool // Log everything to console
	Debug     bool // Enable debug mode, implies Verbose - disables SST and MQTT connections
	NoMonitor bool // Disable system monitoring
}

func (flags *Flags) DebugLog() {
	slog.Info("Maitred flags",
		"verbose", flags.Verbose,
		"debug", flags.Debug,
		"no-monitor", flags.NoMonitor,
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
	flag.BoolVar(&globalFlags.NoMonitor, "no-monitor", getEnvAsBool("NO_MONITOR", false), "Disable system monitoring")
	// Parse flags
	flag.Parse()

	// If debug is enabled, verbose is also enabled
	if globalFlags.Debug {
		globalFlags.Verbose = true
	}
}

func GetFlags() *Flags {
	return globalFlags
}
