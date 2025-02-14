package flags

import (
	"flag"
	"log"
	"os"
	"strconv"
)

var globalFlags *Flags

type Flags struct {
	Verbose      bool
	EndpointPort int
	TeamSlug     string
}

func (flags *Flags) DebugLog() {
	log.Println("Maitred Flags:")
	log.Println("> Verbose: ", flags.Verbose)
	log.Println("> Endpoint Port: ", flags.EndpointPort)
	log.Println("> Team slug: ", flags.TeamSlug)
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
	flag.IntVar(&globalFlags.EndpointPort, "endpointPort", getEnvAsInt("ENDPOINT_PORT", 8088), "MQTT endpoint port")
	flag.StringVar(&globalFlags.TeamSlug, "teamSlug", getEnvAsString("TEAM_SLUG", ""), "Team Slug")
	// Parse flags
	flag.Parse()
}

func GetFlags() *Flags {
	return globalFlags
}
