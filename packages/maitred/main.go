package main

import (
	"nestri/maitred/pkg/party"
	"os"

	"github.com/charmbracelet/log"
)

func main() {
	var teamSlug string //FIXME: Switch to team-slug as they are more memorable but still unique

	if len(os.Args) > 1 {
		teamSlug = os.Args[1]
	} else {
		log.Fatal("Nestri needs a team slug to register this container to")
	}
	party.Run(teamSlug)
	//TODO: On stop here, set the API as the instance is not running (stopped)
}
