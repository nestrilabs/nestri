package main

import (
	"nestrilabs/cli/cmd"

	"github.com/charmbracelet/log"
)

func main() {
	// go func() {
	// 	runMachine()
	// }()

	err := cmd.Execute()
	if err != nil {
		log.Error("Error running the cmd command", "err", err)
	}
}

// func runMachine() {
// 	conn := party.NewParty()
// 	conn.Connect()
// }
