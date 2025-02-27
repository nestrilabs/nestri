package main

import (
	"nestri/maitred/internal/realtime"
	"os"

	"github.com/charmbracelet/log"
)

func main() {
	var secretToken string //FIXME: Switch to team-slug as they are more memorable but still unique

	if len(os.Args) > 1 {
		secretToken = os.Args[1]
	} else {
		log.Fatal("Nestri needs a team slug to register this container to")
	}
	realtime.Run(secretToken)

	//TODO: On stop here, set the API as the instance is not running (stopped)
}
