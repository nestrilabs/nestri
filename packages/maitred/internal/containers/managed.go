package containers

import (
	"context"
	"fmt"
	"log/slog"
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
	Container
	Type ManagedContainerType
}

// ManagedContainers is a map of containers that are managed by us (maitred)
var ManagedContainers = make(map[string]ManagedContainer)

// CreateRunner creates a new runner image container
func CreateRunner(ctx context.Context, ctrEngine ContainerEngine) (string, error) {
	// For safety, limit to 4 runners
	if CountRunners() >= 4 {
		return "", fmt.Errorf("maximum number of runners reached")
	}

	// Create the container
	containerID, err := ctrEngine.NewContainer(ctx, "ghcr.io/nestrilabs/nestri/runner:nightly")
	if err != nil {
		return "", err
	}

	// Add the container to the managed list
	ManagedContainers[containerID] = ManagedContainer{
		Container: Container{
			ID: containerID,
		},
		Type: Runner,
	}

	return containerID, nil
}

// RemoveRunner removes a runner container
func RemoveRunner(ctx context.Context, ctrEngine ContainerEngine, id string) error {
	// Remove the container from the managed list
	delete(ManagedContainers, id)

	// Stop the container
	if err := ctrEngine.StopContainer(ctx, id); err != nil {
		return err
	}

	// Remove the container
	if err := ctrEngine.RemoveContainer(ctx, id); err != nil {
		return err
	}

	return nil
}

// ListRunners returns a list of all runner containers
func ListRunners() []ManagedContainer {
	var runners []ManagedContainer
	for _, v := range ManagedContainers {
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

// Cleanup stops and removes all managed containers
func Cleanup(ctx context.Context, ctrEngine ContainerEngine) error {
	slog.Info("Cleaning up managed containers")
	for id := range ManagedContainers {
		if err := ctrEngine.StopContainer(ctx, id); err != nil {
			slog.Error("failed to stop container", "id", id, "err", err)
		} else {
			if err = ctrEngine.RemoveContainer(ctx, id); err != nil {
				slog.Error("failed to remove container", "id", id, "err", err)
			} else {
				delete(ManagedContainers, id)
			}
		}
	}
	return nil
}
