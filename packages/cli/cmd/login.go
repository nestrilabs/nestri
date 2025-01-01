package cmd

import (
	"fmt"
	"nestrilabs/cli/internal/auth"
	"nestrilabs/cli/internal/party"
	"time"

	"github.com/briandowns/spinner"
	"github.com/charmbracelet/log"
	"github.com/spf13/cobra"
)

// Define your message type
type GameStart struct {
	Type  string `json:"type"`
	Code  string `json:"code"`
	State string `json:"state"`
}

var signUpCmd = &cobra.Command{
	Use:   "login",
	Short: "Authenticate this device to Nestri",
	Long:  "Authenticate this device to Nestri right from your terminal",
	Args:  cobra.NoArgs,
	RunE: func(_ *cobra.Command, _ []string) error {
		s := spinner.New(spinner.CharSets[14], 100*time.Millisecond)
		s.Suffix = " Generating login link..."
		s.Start()

		// Simulate link generation (replace with actual implementation)
		time.Sleep(2 * time.Second)
		authLink := auth.FetchUserUrl()
		s.Stop()

		fmt.Printf("\n🔐 Your authentication link is ready:\n%s\n\n", authLink)
		fmt.Printf("Open this link in your default browser...\n\n")

		s.Suffix = " Waiting for authentication..."
		s.Start()
		// Create a handler that checks for the message you want
		handler := func(msg GameStart) bool {
			return msg.Type == "auth"
		}

		// Create the listener
		listener := party.NewTypeListener(handler)

		// Optionally customize retry behavior
		listener.SetRetryConfig(party.RetryConfig{
			InitialDelay:  2 * time.Second,
			MaxDelay:      1 * time.Minute,
			BackoffFactor: 1.5,
			MaxAttempts:   0, // Set to 0 for infinite retries
		})

		result, err := listener.ConnectUntilMessage()
		if err != nil {
			log.Fatal("Error in connection", "err", err)
		}
		s.Stop()

		// Use the result
		log.Info("Auth codes found!", "access_token", result.Code)

		fmt.Println("\n✅ Successfully logged in!")
		return nil
	},
}
