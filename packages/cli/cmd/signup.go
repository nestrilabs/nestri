package cmd

import (
	"errors"
	"fmt"
	"os"
	"regexp"
	"strconv"

	"nestrilabs/cli/internal/auth"
	"nestrilabs/cli/internal/ui"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/log"
	"github.com/spf13/cobra"
)

type Onboarding struct {
	Name  string
	Email string
}

var signUpCmd = &cobra.Command{
	Use:   "signup",
	Short: "Sign up to Nestri",
	Long:  "Sign Up to Nestri right from your terminal",
	Args:  cobra.NoArgs,
	RunE: func(_ *cobra.Command, _ []string) error {
		//Should we run in accessible mode?
		accessible, _ := strconv.ParseBool(os.Getenv("ACCESSIBLE"))
		var onboarding = Onboarding{}
		spinner := ui.NewSpinner()
		// mch := machine.NewMachine()

		form := huh.NewForm(
			huh.NewGroup(
				huh.NewNote().
					Title("Nestri").
					Description("Welcome to _Nestri_.\n\nYour first gameplay is just a sign up away.\n\nShould we get started?\n\n").
					Next(true).
					NextLabel("Sure"),
			),
			huh.NewGroup(
				huh.NewInput().
					Value(&onboarding.Name).
					Title("Name").
					Description("This is your public display name. It can be your real name or a pseudonym.").
					Placeholder("John Doe").
					Validate(func(s string) error {
						if s == "" {
							return errors.New("please enter a valid name")
						}
						if len(s) < 3 {
							return errors.New("please enter a valid name with 3 characters or more")
						}
						return nil
					}),
				huh.NewInput().
					Value(&onboarding.Email).
					Title("Email Address").
					Description("Note: You will not be able to change this later").
					Placeholder("me@example.com").
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
					}),
			),
		).WithAccessible(accessible)

		err := form.Run()
		if err != nil {
			log.Error("Failed to create form", "err", err)
			os.Exit(1)
		}

		spinner.RunSpinner(func() tea.Msg {
			// arch := mch.Architecture()
			// machineID, err := mch.MachineID()
			// if err != nil {
			// 	fmt.Println("Error getting the machine id", err)
			// 	os.Exit(1)
			// }

			credentials, err := auth.FetchUserToken()
			if err != nil {
				fmt.Println("Error logging you in", err)
			}

			fmt.Println("credentials", credentials)

			return "✅ Finished successfully"
		}, "Working on it...")
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
