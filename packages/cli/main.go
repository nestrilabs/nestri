package main

import (
	"nestrilabs/cli/internal/session"
)

func main() {
	// err := cmd.Execute()
	// if err != nil {
	// 	log.Error("Error running the cmd command", "err", err)
	// }
	session.ContainerStart()
}
