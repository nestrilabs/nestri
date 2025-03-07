package main

import (
	"context"
	"log/slog"
	"nestri/maitred/internal/containers"
	"nestri/maitred/internal/machine"
	"nestri/maitred/internal/realtime"
	"nestri/maitred/internal/resource"
	"nestri/maitred/internal/system"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	// Setup main context and stopper
	mainCtx, mainStop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)

	// Start system monitoring, fetch new stats every 5 seconds
	system.StartMonitoring(mainCtx, 5*time.Second)

	// Get machine ID
	machineID, err := machine.GetID()
	if err != nil {
		slog.Error("failed getting machine id", "err", machineID)
	}

	slog.Info("Machine ID", "id", machineID)

	// Initialize container engine
	ctrEngine, err := containers.NewContainerEngine()
	if err != nil {
		slog.Error("failed initializing container engine", "err", err)
		mainStop()
		return
	}
	defer func(ctrEngine containers.ContainerEngine) {
		// Stop our managed containers first, with a 30 second timeout
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		err = containers.Cleanup(cleanupCtx, ctrEngine)
		if err != nil {
			slog.Error("failed cleaning up managed containers", "err", err)
		}

		err = ctrEngine.Close()
		if err != nil {
			slog.Error("failed closing container engine", "err", err)
		}
	}(ctrEngine)

	// Print engine info
	info, err := ctrEngine.Info(mainCtx)
	if err != nil {
		slog.Error("failed getting engine info", "err", err)
		mainStop()
		return
	}
	slog.Info("Container engine", "info", info)

	// Initialize SST resource
	res, err := resource.NewResource()
	if err != nil {
		slog.Error("failed getting resource", "err", err)
		mainStop()
		return
	}

	// Run realtime
	err = realtime.Run(mainCtx, machineID, ctrEngine, res)
	if err != nil {
		slog.Error("failed running realtime", "err", err)
		mainStop()
		return
	}

	<-mainCtx.Done()
	slog.Info("Shutting down gracefully by signal..")
}
