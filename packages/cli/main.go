package main

import (
	"nestrilabs/cli/internal/machine"
	"nestrilabs/cli/internal/party"
	"os"

	"github.com/charmbracelet/log"
)

func main() {
	// auth.FetchUserToken()
	runMachine()
}

func runMachine() {
	m := machine.NewMachine()

	hostname, err := m.StaticHostname()
	if err != nil {
		log.Error("Failed to start the cmd", "err", err)
		os.Exit(1)
	}

	fingerprint, err := m.MachineID()
	if err != nil {
		log.Error("Failed to start the cmd", "err", err)
		os.Exit(1)
	}
	conn := party.NewParty()
	conn.Connect(fingerprint, hostname)
}
