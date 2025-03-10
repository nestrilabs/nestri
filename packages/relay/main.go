package main

import (
	"context"
	"log"
	"log/slog"
	"os"
	"os/signal"
	relay "relay/internal"
	"syscall"
)

func main() {
	// Setup main context and stopper
	mainCtx, mainStopper := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)

	// Get flags and log them
	relay.InitFlags()
	relay.GetFlags().DebugLog()

	logLevel := slog.LevelInfo
	if relay.GetFlags().Verbose {
		logLevel = slog.LevelDebug
	}

	// Create the base handler with debug level
	baseHandler := slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: logLevel,
	})
	customHandler := &relay.CustomHandler{Handler: baseHandler}
	logger := slog.New(customHandler)
	slog.SetDefault(logger)

	// Start relay
	err := relay.InitRelay(mainCtx, mainStopper)
	if err != nil {
		slog.Error("Failed to initialize relay", "err", err)
		mainStopper()
		return
	}

	// Wait for exit signal
	<-mainCtx.Done()
	log.Println("Shutting down gracefully by signal...")
}
