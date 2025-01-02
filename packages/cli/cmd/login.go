package cmd

import (
	"errors"
	"fmt"
	"nestrilabs/cli/internal/api"
	"nestrilabs/cli/internal/auth"
	"os"
	"regexp"
	"time"

	"github.com/briandowns/spinner"
	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/log"
	"github.com/spf13/cobra"
)

// Define your message type
type GameStart struct {
	Type  string `json:"type"`
	Code  string `json:"code"`
	State string `json:"state"`
}

type Action int

const (
	Cancel Action = iota
	Continue
)

var signUpCmd = &cobra.Command{
	Use:   "login",
	Short: "Authenticate this device to Nestri",
	Long:  "Authenticate this device to Nestri right from your terminal",
	Args:  cobra.NoArgs,
	RunE: func(_ *cobra.Command, _ []string) error {
		var action bool
		var emailAddress string
		theme := huh.ThemeBase16()
		theme.FieldSeparator = lipgloss.NewStyle().SetString("\n")
		theme.Help.FullKey.MarginTop(1)

		form := huh.NewForm(
			huh.NewGroup(
				huh.NewConfirm().
					Description("Welcome to _Nestri_.\n\nBy pressing 'continue'  you agree to\n\nNestri's Terms of Service and Privacy Policy\n").
					Title("\nNestri login\n").
					Affirmative("Continue").
					Negative("Cancel.").
					Value(&action),
			),
		).WithTheme(theme)

		err := form.Run()
		if err != nil {
			log.Error("Error requesting for the email address", "err", err)
			os.Exit(1)
		}

		if !action {
			os.Exit(0)
		}

		fmt.Printf("\n")

		f := huh.NewForm(
			huh.NewGroup(
				huh.NewInput().
					Title("Please enter your email address ").
					Prompt("").
					Validate(func(s string) error {
						if s == "" {
							return errors.New("please enter a valid email address")
						}
						if len(s) < 3 {
							return errors.New("please enter a valid email address")
						}

						validEmail := isValidEmail(s)
						if !validEmail {
							return errors.New("please enter a valid email address")
						}
						return nil
					}).
					Value(&emailAddress).
					Inline(true),
			),
		).WithTheme(theme)

		err = f.Run()
		if err != nil {
			log.Error("Error requesting for the email address", "err", err)
			os.Exit(1)
		}

		s := spinner.New(spinner.CharSets[14], 100*time.Millisecond)
		s.Suffix = " Registering machine..."
		s.Start()

		// Simulate link generation (replace with actual implementation)
		time.Sleep(2 * time.Second)
		authTokens, err := auth.FetchUserToken()
		s.Stop()
		if err != nil {
			log.Error("Error while requesting for tokens", "err", err)
		}

		api.RegisterMachine(authTokens.AccessToken)

		// log.Info("Got auth tokens", "access_token", authTokens.AccessToken)
		// log.Info("Got auth tokens", "refresh_token", authTokens.RefreshToken)
		fmt.Printf("✅ Successfully logged in!\n")
		return nil
	},
}

func isValidEmail(email string) bool {
	// Regular expression pattern for validating email addresses
	// This is a simple pattern and may not cover all edge cases
	pattern := `^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`

	regex := regexp.MustCompile(pattern)

	return regex.MatchString(email)
}
