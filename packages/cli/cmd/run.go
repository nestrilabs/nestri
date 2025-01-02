package cmd

import (
	"nestrilabs/cli/internal/auth"

	"github.com/charmbracelet/log"
	"github.com/spf13/cobra"
)

var runCmd = &cobra.Command{
	Use:   "run",
	Short: "Run a new Nestri node",
	Long:  "Create and run a new Nestri node from this machine",
	Args:  cobra.NoArgs,
	RunE: func(_ *cobra.Command, _ []string) error {
		credentials, err := auth.FetchUserCredentials()
		if err != nil {
			return err
		}

		log.Info("Credentials", "access_token", credentials.AccessToken)
		log.Info("Credentials", "refresh_token", credentials.RefreshToken)

		return nil
	},
}
