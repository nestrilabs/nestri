package containers

import (
	"context"
	"fmt"
)

// Container represents a container instance
type Container struct {
	ID    string
	Name  string
	State string
	Image string
}

// ContainerEngine defines the common interface for differing container engines
type ContainerEngine interface {
	Close() error
	ListContainers(ctx context.Context) ([]Container, error)
	ListContainersByImage(ctx context.Context, img string) ([]Container, error)
	NewContainer(ctx context.Context, img string, envs []string) (string, error)
	StartContainer(ctx context.Context, id string) error
	StopContainer(ctx context.Context, id string) error
	RemoveContainer(ctx context.Context, id string) error
	InspectContainer(ctx context.Context, id string) (*Container, error)
	PullImage(ctx context.Context, img string) error
	Info(ctx context.Context) (string, error)
	LogsContainer(ctx context.Context, id string) (string, error)
}

func NewContainerEngine() (ContainerEngine, error) {
	dockerEngine, err := NewDockerEngine()
	if err == nil {
		return dockerEngine, nil
	}

	return nil, fmt.Errorf("failed to create container engine: %w", err)
}
