package main

import (
	"context"
	"log/slog"
	"nestri/maitred/internal"
	"nestri/maitred/internal/containers"
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

	// Get flags and log them
	internal.InitFlags()
	internal.GetFlags().DebugLog()

	logLevel := slog.LevelInfo
	if internal.GetFlags().Verbose {
		logLevel = slog.LevelDebug
	}

	// Create the base handler with debug level
	baseHandler := slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: logLevel,
	})
	customHandler := &internal.CustomHandler{Handler: baseHandler}
	logger := slog.New(customHandler)
	slog.SetDefault(logger)

	if !internal.GetFlags().NoMonitor {
		// Start system monitoring, fetch every 5 seconds
		system.StartMonitoring(mainCtx, 5*time.Second)
	}

	// Get machine ID
	machineID, err := system.GetID()
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
		err = realtime.CleanupManaged(cleanupCtx, ctrEngine)
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

	if err = realtime.InitializeManager(mainCtx, ctrEngine); err != nil {
		slog.Error("failed initializing container manager", "err", err)
		mainStop()
		return
	}

	// If in debug mode, skip running SST - MQTT connections
	if !internal.GetFlags().Debug {
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
	}

	// Create relay container
	slog.Info("Creating default relay container")
	relayID, err := realtime.CreateRelay(mainCtx, ctrEngine)
	if err != nil {
		slog.Error("failed creating relay container", "err", err)
		mainStop()
		return
	}
	// Start relay container
	slog.Info("Starting default relay container", "id", relayID)
	if err = realtime.StartRelay(mainCtx, ctrEngine, relayID); err != nil {
		slog.Error("failed starting relay container", "err", err)
		mainStop()
		return
	}

	// Wait for signal
	<-mainCtx.Done()
	slog.Info("Shutting down gracefully by signal..")
}
