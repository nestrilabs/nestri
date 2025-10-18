package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"relay/internal/common"
	"relay/internal/core"
	"syscall"
)

func main() {
	// Setup main context and stopper
	mainCtx, mainStopper := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)

	// Get flags and log them
	common.InitFlags()
	common.GetFlags().DebugLog()

	logLevel := slog.LevelInfo
	if common.GetFlags().Verbose {
		logLevel = slog.LevelDebug
	}

	// Create the base handler with debug level
	baseHandler := slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: logLevel,
	})
	customHandler := &common.CustomHandler{Handler: baseHandler}
	logger := slog.New(customHandler)
	slog.SetDefault(logger)

	// Start relay
	relay, err := core.InitRelay(mainCtx, mainStopper)
	if err != nil {
		slog.Error("Failed to initialize relay", "err", err)
		mainStopper()
		return
	}

	// Wait for exit signal
	<-mainCtx.Done()
	slog.Info("Shutting down gracefully by signal..")

	defaultFile := common.GetFlags().PersistDir + "/peerstore.json"
	if err = relay.SaveToFile(defaultFile); err != nil {
		slog.Error("Failed to save peer store", "err", err)
	}
}
