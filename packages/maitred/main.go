package main

import (
	"nestri/maitred/pkg/party"
	"os"

	"github.com/charmbracelet/log"
)

func main() {
	var teamID string

	if len(os.Args) > 1 {
		teamID = os.Args[1]
	} else {
		log.Fatal("Nestri needs a team ID to register this container to")
	}
	party.Run(teamID)
}
