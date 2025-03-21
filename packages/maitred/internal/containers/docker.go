package containers

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/client"
	"io"
	"log/slog"
	"strings"
	"time"
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
	containerList, err := d.cli.ContainerList(ctx, container.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list containers: %w", err)
	}

	var result []Container
	for _, c := range containerList {
		result = append(result, Container{
			ID:    c.ID,
			Name:  strings.TrimPrefix(strings.Join(c.Names, ","), "/"),
			State: c.State,
			Image: c.Image,
		})
	}
	return result, nil
}

func (d *DockerEngine) ListContainersByImage(ctx context.Context, img string) ([]Container, error) {
	if len(img) <= 0 {
		return nil, fmt.Errorf("image name cannot be empty")
	}

	containerList, err := d.cli.ContainerList(ctx, container.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list containers: %w", err)
	}

	var result []Container
	for _, c := range containerList {
		if c.Image == img {
			result = append(result, Container{
				ID:    c.ID,
				Name:  strings.TrimPrefix(strings.Join(c.Names, ","), "/"),
				State: c.State,
				Image: c.Image,
			})
		}
	}
	return result, nil
}

func (d *DockerEngine) NewContainer(ctx context.Context, img string, envs []string) (string, error) {
	// Create a new container with the given image and environment variables
	resp, err := d.cli.ContainerCreate(ctx, &container.Config{
		Image: img,
		Env:   envs,
	}, &container.HostConfig{
		NetworkMode: "host",
	}, nil, nil, "")
	if err != nil {
		return "", fmt.Errorf("failed to create container: %w", err)
	}

	if len(resp.ID) <= 0 {
		return "", fmt.Errorf("failed to create container, no ID returned")
	}

	return resp.ID, nil
}

func (d *DockerEngine) StartContainer(ctx context.Context, id string) error {
	err := d.cli.ContainerStart(ctx, id, container.StartOptions{})
	if err != nil {
		return fmt.Errorf("failed to start container: %w", err)
	}

	// Wait for the container to start
	if err = d.waitForContainer(ctx, id, "running"); err != nil {
		return fmt.Errorf("container failed to reach running state: %w", err)
	}

	return nil
}

func (d *DockerEngine) StopContainer(ctx context.Context, id string) error {
	// Waiter for the container to stop
	respChan, errChan := d.cli.ContainerWait(ctx, id, container.WaitConditionNotRunning)

	// Stop the container
	err := d.cli.ContainerStop(ctx, id, container.StopOptions{})
	if err != nil {
		return fmt.Errorf("failed to stop container: %w", err)
	}

	select {
	case <-respChan:
		// Container stopped successfully
		break
	case err = <-errChan:
		if err != nil {
			return fmt.Errorf("failed to wait for container to stop: %w", err)
		}
	case <-ctx.Done():
		return fmt.Errorf("context canceled while waiting for container to stop")
	}
	return nil
}

func (d *DockerEngine) RemoveContainer(ctx context.Context, id string) error {
	// Waiter for the container to be removed
	respChan, errChan := d.cli.ContainerWait(ctx, id, container.WaitConditionRemoved)

	err := d.cli.ContainerRemove(ctx, id, container.RemoveOptions{})
	if err != nil {
		return fmt.Errorf("failed to remove container: %w", err)
	}

	select {
	case <-respChan:
		// Container removed successfully
		break
	case err = <-errChan:
		if err != nil {
			return fmt.Errorf("failed to wait for container to be removed: %w", err)
		}
	case <-ctx.Done():
		return fmt.Errorf("context canceled while waiting for container to stop")
	}
	return nil
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
		Image: info.Config.Image,
	}, nil
}

func (d *DockerEngine) PullImage(ctx context.Context, img string) error {
	if len(img) <= 0 {
		return fmt.Errorf("image name cannot be empty")
	}

	slog.Info("Starting image pull", "image", img)

	reader, err := d.cli.ImagePull(ctx, img, image.PullOptions{})
	if err != nil {
		return fmt.Errorf("failed to start image pull for %s: %w", img, err)
	}
	defer func(reader io.ReadCloser) {
		err = reader.Close()
		if err != nil {
			slog.Warn("Failed to close reader", "err", err)
		}
	}(reader)

	// Parse the JSON stream for progress
	decoder := json.NewDecoder(reader)
	lastDownloadPercent := 0
	downloadTotals := make(map[string]int64)
	downloadCurrents := make(map[string]int64)

	var msg struct {
		ID             string `json:"id"`
		Status         string `json:"status"`
		ProgressDetail struct {
			Current int64 `json:"current"`
			Total   int64 `json:"total"`
		} `json:"progressDetail"`
	}

	for {
		err = decoder.Decode(&msg)
		if err == io.EOF {
			break // Pull completed
		}
		if err != nil {
			return fmt.Errorf("error decoding pull response for %s: %w", img, err)
		}

		// Skip if no progress details or ID
		if msg.ID == "" || msg.ProgressDetail.Total == 0 {
			continue
		}

		if strings.Contains(strings.ToLower(msg.Status), "downloading") {
			downloadTotals[msg.ID] = msg.ProgressDetail.Total
			downloadCurrents[msg.ID] = msg.ProgressDetail.Current
			var total, current int64
			for _, t := range downloadTotals {
				total += t
			}
			for _, c := range downloadCurrents {
				current += c
			}
			percent := int((float64(current) / float64(total)) * 100)
			if percent >= lastDownloadPercent+10 && percent <= 100 {
				slog.Info("Download progress", "image", img, "percent", percent)
				lastDownloadPercent = percent - (percent % 10)
			}
		}
	}

	slog.Info("Pulled image", "image", img)

	return nil
}

func (d *DockerEngine) Info(ctx context.Context) (string, error) {
	info, err := d.cli.Info(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to get Docker info: %w", err)
	}

	return fmt.Sprintf("Docker Engine Version: %s", info.ServerVersion), nil
}

func (d *DockerEngine) LogsContainer(ctx context.Context, id string) (string, error) {
	reader, err := d.cli.ContainerLogs(ctx, id, container.LogsOptions{ShowStdout: true, ShowStderr: true})
	if err != nil {
		return "", fmt.Errorf("failed to get container logs: %w", err)
	}
	defer func(reader io.ReadCloser) {
		err = reader.Close()
		if err != nil {
			slog.Warn("Failed to close reader", "err", err)
		}
	}(reader)

	logs, err := io.ReadAll(reader)
	if err != nil {
		return "", fmt.Errorf("failed to read container logs: %w", err)
	}

	return string(logs), nil
}

func (d *DockerEngine) waitForContainer(ctx context.Context, id, desiredState string) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	for {
		// Inspect the container to get its current state
		inspection, err := d.cli.ContainerInspect(ctx, id)
		if err != nil {
			return fmt.Errorf("failed to inspect container: %w", err)
		}

		// Check the container's state
		currentState := strings.ToLower(inspection.State.Status)
		switch currentState {
		case desiredState:
			// Container is in the desired state (e.g., "running")
			return nil
		case "exited", "dead", "removing":
			// Container failed or stopped unexpectedly, get logs and return error
			logs, _ := d.LogsContainer(ctx, id)
			return fmt.Errorf("container failed to reach %s state, logs: %s", desiredState, logs)
		}

		// Wait before polling again
		select {
		case <-ctx.Done():
			return fmt.Errorf("timed out after 10s waiting for container to reach %s state", desiredState)
		case <-time.After(1 * time.Second):
			// Continue polling
		}
	}
}
