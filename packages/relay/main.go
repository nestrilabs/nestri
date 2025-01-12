package main

import (
	"fmt"
	relay "relay/internal"
)

func main() {
	// var err error
	// stopCh := make(chan os.Signal, 1)
	// signal.Notify(stopCh, os.Interrupt, syscall.SIGTERM)

	// // Get flags and log them
	// relay.InitFlags()
	// relay.GetFlags().DebugLog()

	// // Init WebRTC API
	// err = relay.InitWebRTCAPI()
	// if err != nil {
	// 	log.Fatal("Failed to initialize WebRTC API: ", err)
	// }

	// // Start our HTTP endpoints
	// relay.InitHTTPEndpoint()

	// // Wait for exit signal
	// <-stopCh
	// log.Println("Shutting down gracefully by signal...")
	party, err := relay.NewParty("party-1", "localhost", nil)
	if err != nil {
		fmt.Println("Error running the party", err)
	}

	party.Connect()
}
