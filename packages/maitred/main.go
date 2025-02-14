package main

import (
	"context"
	"fmt"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
	"nestri/maitred/internal"
	"nestri/maitred/internal/containerapi"
	"os"
	"os/signal"
	"syscall"

	"github.com/charmbracelet/log"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Get flags and log them
	flags.InitFlags()
	flags.GetFlags().DebugLog()

	cl, err := containerapi.NewContainerClient()
	if err != nil {
		panic(err)
	}
	defer func(cl *client.Client) {
		err = cl.Close()
		if err != nil {
			log.Warn("failed to close container client", "err", err)
		}
	}(cl)

	// SAMPLE CODE, lists containers in system
	containers, err := cl.ContainerList(context.Background(), container.ListOptions{All: true})
	if err != nil {
		panic(err)
	}

	for _, ctr := range containers {
		fmt.Printf("%s %s (status: %s)\n", ctr.ID, ctr.Image, ctr.Status)
	}

	// Uncomment when ready
	//go party.Run(flags.GetFlags().TeamSlug, ctx)

	<-ctx.Done()

	//TODO: On stop here, set the API as the instance is not running (stopped)

	log.Info("Shutting down gracefully by signal...")
}
