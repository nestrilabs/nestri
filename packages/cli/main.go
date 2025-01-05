package main

import (
	"nestrilabs/cli/internal/party"
)

func main() {
	// err := cmd.Execute()
	// if err != nil {
	// 	log.Error("Error running the cmd command", "err", err)
	// }

	// ctx := context.Background()

	// config := &session.SessionConfig{
	// 	Room:       "victortest",
	// 	Resolution: "1920x1080",
	// 	Framerate:  "60",
	// 	RelayURL:   "https://relay.dathorse.com",
	// 	Params:     "--verbose=true --video-codec=h264 --video-bitrate=4000 --video-bitrate-max=6000 --gpu-card-path=/dev/dri/card1",
	// 	GamePath:   "/path/to/your/game",
	// }

	// sess, err := session.NewSession(config)
	// if err != nil {
	// 	log.Error("Failed to create session", "err", err)
	// }

	// // Start the session
	// if err := sess.Start(ctx); err != nil {
	// 	log.Error("Failed to start session", "err", err)
	// }

	// // Check if it's running
	// if sess.IsRunning() {
	// 	log.Info("Session is running with container ID", "containerId", sess.GetContainerID())
	// }

	// env, err := sess.GetEnvironment(ctx)
	// if err != nil {
	// 	log.Printf("Failed to get environment: %v", err)
	// } else {
	// 	for key, value := range env {
	// 		log.Info("Found this environment variables", key, value)
	// 	}
	// }

	// // Let it run for a while
	// // time.Sleep(time.Second * 50)

	// // Stop the session
	// if err := sess.Stop(ctx); err != nil {
	// 	log.Error("Failed to stop session", "err", err)
	// }

	party := party.NewParty()
	party.Connect()
}
