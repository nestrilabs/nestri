package cmd

import (
	"runtime/debug"

	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "nestri",
	Short: "A CLI tool to run and manage your self-hosted cloud gaming service",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		return cmd.Help()
	},
}

// Execute adds all child commands to the root command and sets flags appropriately.
// This is called by main.main(). It only needs to happen once to the rootCmd.
func Execute() error {
	err := rootCmd.Execute()
	return err
}

var (
	// Version stores the build version of VHS at the time of package through
	// -ldflags.
	//
	// go build -ldflags "-s -w -X=main.Version=$(VERSION)"
	Version string

	// CommitSHA stores the git commit SHA at the time of package through -ldflags.
	CommitSHA string
)

func init() {
	rootCmd.AddCommand(signUpCmd)
	if len(CommitSHA) >= 7 { //nolint:gomnd
		vt := rootCmd.VersionTemplate()
		rootCmd.SetVersionTemplate(vt[:len(vt)-1] + " (" + CommitSHA[0:7] + ")\n")
	}
	if Version == "" {
		if info, ok := debug.ReadBuildInfo(); ok && info.Main.Sum != "" {
			Version = info.Main.Version
		} else {
			Version = "unknown (built from source)"
		}
	}
	rootCmd.Version = Version
}
