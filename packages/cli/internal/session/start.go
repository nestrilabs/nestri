package session

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/client"
)

// GPUType represents the type of GPU available
type GPUType int

const (
	GPUNone GPUType = iota
	GPUNvidia
	GPUIntelAMD
)

// Session represents a Docker container session
type Session struct {
	client      *client.Client
	containerID string
	imageName   string
	config      *SessionConfig
	mu          sync.RWMutex
	isRunning   bool
}

// SessionConfig holds the configuration for the session
type SessionConfig struct {
	Room       string
	Resolution string
	Framerate  string
	RelayURL   string
	Params     string
	GamePath   string
}

// NewSession creates a new Docker session
func NewSession(config *SessionConfig) (*Session, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv)
	if err != nil {
		return nil, fmt.Errorf("failed to create Docker client: %v", err)
	}

	return &Session{
		client:    cli,
		imageName: "archlinux", //"ghcr.io/datcaptainhorse/nestri-cachyos:latest-noavx2",
		config:    config,
	}, nil
}

// Start initiates the Docker container session
func (s *Session) Start(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.isRunning {
		return fmt.Errorf("session is already running")
	}

	// Detect GPU type
	gpuType := detectGPU()
	if gpuType == GPUNone {
		return fmt.Errorf("no supported GPU detected")
	}

	// Get GPU-specific configurations
	deviceRequests, err := getGPUDeviceRequests(gpuType)
	if err != nil {
		return err
	}

	devices := getGPUDevices(gpuType)

	// Check if image exists locally
	_, _, err = s.client.ImageInspectWithRaw(ctx, s.imageName)
	if err != nil {
		// Pull the image if it doesn't exist
		reader, err := s.client.ImagePull(ctx, s.imageName, image.PullOptions{})
		if err != nil {
			return fmt.Errorf("failed to pull image: %v", err)
		}
		defer reader.Close()

		// Copy pull output to stdout
		io.Copy(os.Stdout, reader)
	}

	// Create container
	resp, err := s.client.ContainerCreate(ctx, &container.Config{
		Image: s.imageName,
		Env: []string{
			fmt.Sprintf("NESTRI_ROOM=%s", s.config.Room),
			fmt.Sprintf("RESOLUTION=%s", s.config.Resolution),
			fmt.Sprintf("FRAMERATE=%s", s.config.Framerate),
			fmt.Sprintf("RELAY_URL=%s", s.config.RelayURL),
			fmt.Sprintf("NESTRI_PARAMS=%s", s.config.Params),
		},
	}, &container.HostConfig{
		Binds: []string{
			fmt.Sprintf("%s:/mnt/game/", s.config.GamePath),
		},
		Resources: container.Resources{
			DeviceRequests: deviceRequests,
			Devices:        devices,
		},
		// Resources: container.Resources{
		// 	DeviceRequests: []container.DeviceRequest{
		// 		{
		// 			Driver:       "nvidia",
		// 			Count:        1,
		// 			DeviceIDs:    []string{"0"},
		// 			Capabilities: [][]string{{"gpu"}},
		// 		},
		// 	},
		// },
		SecurityOpt: []string{"label=disable"},
		ShmSize:     1073741824, // 1GB
	}, nil, nil, "")
	if err != nil {
		return fmt.Errorf("failed to create container: %v", err)
	}

	// Start container
	if err := s.client.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
		return fmt.Errorf("failed to start container: %v", err)
	}

	// Store container ID and update state
	s.containerID = resp.ID
	s.isRunning = true

	// Start logging in a goroutine
	go s.streamLogs(ctx)

	return nil
}

// Stop stops the Docker container session
func (s *Session) Stop(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.isRunning {
		return fmt.Errorf("session is not running")
	}

	timeout := 30 // seconds
	if err := s.client.ContainerStop(ctx, s.containerID, container.StopOptions{Timeout: &timeout}); err != nil {
		return fmt.Errorf("failed to stop container: %v", err)
	}

	if err := s.client.ContainerRemove(ctx, s.containerID, container.RemoveOptions{}); err != nil {
		return fmt.Errorf("failed to remove container: %v", err)
	}

	s.isRunning = false
	s.containerID = ""
	return nil
}

// IsRunning returns the current state of the session
func (s *Session) IsRunning() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.isRunning
}

// GetContainerID returns the current container ID
func (s *Session) GetContainerID() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.containerID
}

// streamLogs streams container logs to stdout
func (s *Session) streamLogs(ctx context.Context) {
	opts := container.LogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Follow:     true,
	}

	logs, err := s.client.ContainerLogs(ctx, s.containerID, opts)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error getting container logs: %v\n", err)
		return
	}
	defer logs.Close()

	_, err = io.Copy(os.Stdout, logs)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error streaming logs: %v\n", err)
	}
}

// VerifyEnvironment checks if all expected environment variables are set correctly in the container
func (s *Session) VerifyEnvironment(ctx context.Context) error {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if !s.isRunning {
		return fmt.Errorf("session is not running")
	}

	// Get container info to verify it's actually running
	inspect, err := s.client.ContainerInspect(ctx, s.containerID)
	if err != nil {
		return fmt.Errorf("failed to inspect container: %v", err)
	}

	if !inspect.State.Running {
		return fmt.Errorf("container is not in running state")
	}

	// Expected environment variables
	expectedEnv := map[string]string{
		"NESTRI_ROOM":   s.config.Room,
		"RESOLUTION":    s.config.Resolution,
		"FRAMERATE":     s.config.Framerate,
		"RELAY_URL":     s.config.RelayURL,
		"NESTRI_PARAMS": s.config.Params,
	}

	// Get actual environment variables from container
	containerEnv := make(map[string]string)
	for _, env := range inspect.Config.Env {
		parts := strings.SplitN(env, "=", 2)
		if len(parts) == 2 {
			containerEnv[parts[0]] = parts[1]
		}
	}

	// Check each expected variable
	var missingVars []string
	var mismatchedVars []string

	for key, expectedValue := range expectedEnv {
		actualValue, exists := containerEnv[key]
		if !exists {
			missingVars = append(missingVars, key)
		} else if actualValue != expectedValue {
			mismatchedVars = append(mismatchedVars, fmt.Sprintf("%s (expected: %s, got: %s)",
				key, expectedValue, actualValue))
		}
	}

	// Build error message if there are any issues
	if len(missingVars) > 0 || len(mismatchedVars) > 0 {
		var errorMsg strings.Builder
		if len(missingVars) > 0 {
			errorMsg.WriteString(fmt.Sprintf("Missing environment variables: %s\n",
				strings.Join(missingVars, ", ")))
		}
		if len(mismatchedVars) > 0 {
			errorMsg.WriteString(fmt.Sprintf("Mismatched environment variables: %s",
				strings.Join(mismatchedVars, ", ")))
		}
		return fmt.Errorf(errorMsg.String())
	}

	return nil
}

// GetEnvironment returns all environment variables in the container
func (s *Session) GetEnvironment(ctx context.Context) (map[string]string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if !s.isRunning {
		return nil, fmt.Errorf("session is not running")
	}

	inspect, err := s.client.ContainerInspect(ctx, s.containerID)
	if err != nil {
		return nil, fmt.Errorf("failed to inspect container: %v", err)
	}

	env := make(map[string]string)
	for _, e := range inspect.Config.Env {
		parts := strings.SplitN(e, "=", 2)
		if len(parts) == 2 {
			env[parts[0]] = parts[1]
		}
	}

	return env, nil
}
