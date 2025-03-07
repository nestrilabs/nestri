package containers

import (
	"context"
	"fmt"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/client"
)

// DockerEngine implements the ContainerEngine interface for Docker / Docker compatible engines
type DockerEngine struct {
	cli *client.Client
}

func NewDockerEngine() (*DockerEngine, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, fmt.Errorf("failed to create Docker client: %w", err)
	}
	return &DockerEngine{cli: cli}, nil
}

func (d *DockerEngine) Close() error {
	return d.cli.Close()
}

func (d *DockerEngine) ListContainers(ctx context.Context) ([]Container, error) {
	containerList, err := d.cli.ContainerList(ctx, container.ListOptions{All: true})
	if err != nil {
		return nil, fmt.Errorf("failed to list containers: %w", err)
	}

	var result []Container
	for _, c := range containerList {
		result = append(result, Container{
			ID:    c.ID,
			Name:  c.Names[0],
			State: c.State,
		})
	}
	return result, nil
}

func (d *DockerEngine) NewContainer(ctx context.Context, img string) (string, error) {
	resp, err := d.cli.ContainerCreate(ctx, &container.Config{
		Image: img,
	}, nil, nil, nil, "")
	if err != nil {
		return "", fmt.Errorf("failed to create container: %w", err)
	}

	return resp.ID, nil
}

func (d *DockerEngine) StartContainer(ctx context.Context, id string) error {
	return d.cli.ContainerStart(ctx, id, container.StartOptions{})
}

func (d *DockerEngine) StopContainer(ctx context.Context, id string) error {
	return d.cli.ContainerStop(ctx, id, container.StopOptions{})
}

func (d *DockerEngine) RemoveContainer(ctx context.Context, id string) error {
	return d.cli.ContainerRemove(ctx, id, container.RemoveOptions{})
}

func (d *DockerEngine) InspectContainer(ctx context.Context, id string) (*Container, error) {
	info, err := d.cli.ContainerInspect(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("failed to inspect container: %w", err)
	}

	return &Container{
		ID:    info.ID,
		Name:  info.Name,
		State: info.State.Status,
	}, nil
}

func (d *DockerEngine) PullImage(ctx context.Context, img string) error {
	_, err := d.cli.ImagePull(ctx, img, image.PullOptions{})
	return err
}

func (d *DockerEngine) Info(ctx context.Context) (string, error) {
	info, err := d.cli.Info(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to get Docker info: %w", err)
	}

	return fmt.Sprintf("Docker Engine Version: %s", info.ServerVersion), nil
}
