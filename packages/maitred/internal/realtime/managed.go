package realtime

import (
	"context"
	"fmt"
	"log/slog"
	"nestri/maitred/internal"
	"nestri/maitred/internal/containers"
	"strings"
	"sync"
	"time"
)

var (
	nestriRunnerImage = "ghcr.io/nestrilabs/nestri/runner:nightly"
	nestriRelayImage  = "ghcr.io/nestrilabs/nestri/relay:nightly"
)

type ManagedContainerType int

const (
	// Runner is the nestri runner container
	Runner ManagedContainerType = iota
	// Relay is the nestri relay container
	Relay
)

// ManagedContainer type with extra information fields
type ManagedContainer struct {
	containers.Container
	Type ManagedContainerType
}

// managedContainers is a map of containers that are managed by us (maitred)
var (
	managedContainers      = make(map[string]ManagedContainer)
	managedContainersMutex sync.RWMutex
)

// InitializeManager handles the initialization of the managed containers and pulls their latest images
func InitializeManager(ctx context.Context, ctrEngine containers.ContainerEngine) error {
	// If debug, override the images
	if internal.GetFlags().Debug {
		nestriRunnerImage = "ghcr.io/datcaptainhorse/nestri-cachyos:latest-v3"
		nestriRelayImage = "ghcr.io/datcaptainhorse/nestri-relay:latest"
	}

	// Look for existing stopped runner containers and remove them
	slog.Info("Checking and removing old runner containers")
	oldRunners, err := ctrEngine.ListContainersByImage(ctx, nestriRunnerImage)
	if err != nil {
		return err
	}
	for _, c := range oldRunners {
		// If running, stop first
		if strings.Contains(strings.ToLower(c.State), "running") {
			slog.Info("Stopping old runner container", "id", c.ID)
			if err = ctrEngine.StopContainer(ctx, c.ID); err != nil {
				return err
			}
		}
		slog.Info("Removing old runner container", "id", c.ID)
		if err = ctrEngine.RemoveContainer(ctx, c.ID); err != nil {
			return err
		}
	}

	// Pull the runner image if not in debug mode
	if !internal.GetFlags().Debug {
		slog.Info("Pulling runner image", "image", nestriRunnerImage)
		if err := ctrEngine.PullImage(ctx, nestriRunnerImage); err != nil {
			return fmt.Errorf("failed to pull runner image: %w", err)
		}
	}

	// Look for existing stopped relay containers and remove them
	slog.Info("Checking and removing old relay containers")
	oldRelays, err := ctrEngine.ListContainersByImage(ctx, nestriRelayImage)
	if err != nil {
		return err
	}
	for _, c := range oldRelays {
		// If running, stop first
		if strings.Contains(strings.ToLower(c.State), "running") {
			slog.Info("Stopping old relay container", "id", c.ID)
			if err = ctrEngine.StopContainer(ctx, c.ID); err != nil {
				return err
			}
		}
		slog.Info("Removing old relay container", "id", c.ID)
		if err = ctrEngine.RemoveContainer(ctx, c.ID); err != nil {
			return err
		}
	}

	// Pull the relay image if not in debug mode
	if !internal.GetFlags().Debug {
		slog.Info("Pulling relay image", "image", nestriRelayImage)
		if err := ctrEngine.PullImage(ctx, nestriRelayImage); err != nil {
			return fmt.Errorf("failed to pull relay image: %w", err)
		}
	}

	return nil
}

// CreateRunner creates a new runner image container
func CreateRunner(ctx context.Context, ctrEngine containers.ContainerEngine) (string, error) {
	// For safety, limit to 4 runners
	if CountRunners() >= 4 {
		return "", fmt.Errorf("maximum number of runners reached")
	}

	// Create the container
	containerID, err := ctrEngine.NewContainer(ctx, nestriRunnerImage, nil)
	if err != nil {
		return "", err
	}

	// Add the container to the managed list
	managedContainersMutex.Lock()
	defer managedContainersMutex.Unlock()
	managedContainers[containerID] = ManagedContainer{
		Container: containers.Container{
			ID: containerID,
		},
		Type: Runner,
	}

	return containerID, nil
}

// StartRunner starts a runner container, keeping track of it's state
func StartRunner(ctx context.Context, ctrEngine containers.ContainerEngine, id string) error {
	// Verify the container is part of the managed list
	managedContainersMutex.RLock()
	if _, ok := managedContainers[id]; !ok {
		managedContainersMutex.RUnlock()
		return fmt.Errorf("container %s is not managed", id)
	}
	managedContainersMutex.RUnlock()

	// Start the container
	if err := ctrEngine.StartContainer(ctx, id); err != nil {
		return err
	}

	// Check container status in background at 10 second intervals, if it exits print it's logs
	go func() {
		err := monitorContainer(ctx, ctrEngine, id)
		if err != nil {
			slog.Error("failure while monitoring runner container", "id", id, "err", err)
			return
		}
	}()

	return nil
}

// RemoveRunner removes a runner container
func RemoveRunner(ctx context.Context, ctrEngine containers.ContainerEngine, id string) error {
	// Stop the container if it's running
	if strings.Contains(strings.ToLower(managedContainers[id].State), "running") {
		if err := ctrEngine.StopContainer(ctx, id); err != nil {
			return err
		}
	}

	// Remove the container
	if err := ctrEngine.RemoveContainer(ctx, id); err != nil {
		return err
	}

	// Remove the container from the managed list
	managedContainersMutex.Lock()
	defer managedContainersMutex.Unlock()
	delete(managedContainers, id)

	return nil
}

// ListRunners returns a list of all runner containers
func ListRunners() []ManagedContainer {
	managedContainersMutex.Lock()
	defer managedContainersMutex.Unlock()
	var runners []ManagedContainer
	for _, v := range managedContainers {
		if v.Type == Runner {
			runners = append(runners, v)
		}
	}
	return runners
}

// CountRunners returns the number of runner containers
func CountRunners() int {
	return len(ListRunners())
}

// CreateRelay creates a new relay image container
func CreateRelay(ctx context.Context, ctrEngine containers.ContainerEngine) (string, error) {
	// Limit to 1 relay
	if CountRelays() >= 1 {
		return "", fmt.Errorf("maximum number of relays reached")
	}

	// TODO: Placeholder for control secret, should be generated at runtime
	secretEnv := fmt.Sprintf("CONTROL_SECRET=%s", "1234")

	// Create the container
	containerID, err := ctrEngine.NewContainer(ctx, nestriRelayImage, []string{secretEnv})
	if err != nil {
		return "", err
	}

	// Add the container to the managed list
	managedContainersMutex.Lock()
	defer managedContainersMutex.Unlock()
	managedContainers[containerID] = ManagedContainer{
		Container: containers.Container{
			ID: containerID,
		},
		Type: Relay,
	}

	return containerID, nil
}

// StartRelay starts a relay container, keeping track of it's state
func StartRelay(ctx context.Context, ctrEngine containers.ContainerEngine, id string) error {
	// Verify the container is part of the managed list
	managedContainersMutex.RLock()
	if _, ok := managedContainers[id]; !ok {
		managedContainersMutex.RUnlock()
		return fmt.Errorf("container %s is not managed", id)
	}
	managedContainersMutex.RUnlock()

	// Start the container
	if err := ctrEngine.StartContainer(ctx, id); err != nil {
		return err
	}

	// Check container status in background at 10 second intervals, if it exits print it's logs
	go func() {
		err := monitorContainer(ctx, ctrEngine, id)
		if err != nil {
			slog.Error("failure while monitoring relay container", "id", id, "err", err)
			return
		}
	}()

	return nil
}

// RemoveRelay removes a relay container
func RemoveRelay(ctx context.Context, ctrEngine containers.ContainerEngine, id string) error {
	// Stop the container if it's running
	if strings.Contains(strings.ToLower(managedContainers[id].State), "running") {
		if err := ctrEngine.StopContainer(ctx, id); err != nil {
			return err
		}
	}

	// Remove the container
	if err := ctrEngine.RemoveContainer(ctx, id); err != nil {
		return err
	}

	// Remove the container from the managed list
	managedContainersMutex.Lock()
	defer managedContainersMutex.Unlock()
	delete(managedContainers, id)

	return nil
}

// ListRelays returns a list of all relay containers
func ListRelays() []ManagedContainer {
	managedContainersMutex.Lock()
	defer managedContainersMutex.Unlock()
	var relays []ManagedContainer
	for _, v := range managedContainers {
		if v.Type == Relay {
			relays = append(relays, v)
		}
	}
	return relays
}

// CountRelays returns the number of relay containers
func CountRelays() int {
	return len(ListRelays())
}

// CleanupManaged stops and removes all managed containers
func CleanupManaged(ctx context.Context, ctrEngine containers.ContainerEngine) error {
	if len(managedContainers) <= 0 {
		return nil
	}

	slog.Info("Cleaning up managed containers")
	managedContainersMutex.Lock()
	defer managedContainersMutex.Unlock()
	for id := range managedContainers {
		// If running, stop first
		if strings.Contains(strings.ToLower(managedContainers[id].State), "running") {
			slog.Info("Stopping managed container", "id", id)
			if err := ctrEngine.StopContainer(ctx, id); err != nil {
				return err
			}
		}

		// Remove the container
		slog.Info("Removing managed container", "id", id)
		if err := ctrEngine.RemoveContainer(ctx, id); err != nil {
			return err
		}
		// Remove from the managed list
		delete(managedContainers, id)
	}
	return nil
}

func monitorContainer(ctx context.Context, ctrEngine containers.ContainerEngine, id string) error {
	for {
		select {
		case <-ctx.Done():
			return nil
		default:
			// Check the container status
			ctr, err := ctrEngine.InspectContainer(ctx, id)
			if err != nil {
				return fmt.Errorf("failed to inspect container: %w", err)
			}

			// Update the container state in the managed list
			managedContainersMutex.Lock()
			managedContainers[id] = ManagedContainer{
				Container: containers.Container{
					ID:    ctr.ID,
					Name:  ctr.Name,
					State: ctr.State,
					Image: ctr.Image,
				},
				Type: Relay,
			}
			managedContainersMutex.Unlock()

			if !strings.Contains(strings.ToLower(ctr.State), "running") {
				// Container is not running, print logs
				logs, err := ctrEngine.LogsContainer(ctx, id)
				if err != nil {
					return fmt.Errorf("failed to get container logs: %w", err)
				}
				return fmt.Errorf("container %s stopped running: %s", id, logs)
			}
		}
		// Sleep for 10 seconds
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(10 * time.Second):
		}
	}
}
