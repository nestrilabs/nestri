package main

import (
	"context"
	"io"
	"os"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
)

func main() {
	ctx := context.Background()

	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		panic(err)
	}
	defer cli.Close()

	// Try to get the Docker version
	_, err = cli.ServerVersion(ctx)
	if err != nil {
		// If an error occurs (e.g., Docker is not running), return false
		panic(err)
	}

	// Download the image
	containerName := "hello-world"

	reader, err := cli.ImagePull(ctx, containerName, image.PullOptions{})
	if err != nil {
		panic(err)
	}

	defer reader.Close()

	// cli.ImagePull is asynchronous.
	// The reader needs to be read completely for the pull operation to complete.
	// If stdout is not required, consider using io.Discard instead of os.Stdout.
	io.Copy(os.Stdout, reader)

	resp, err := cli.ContainerCreate(ctx, &container.Config{
		Image: "hello-world",
	},
		nil, nil, nil, containerName)
	if err != nil {
		panic(err)
	}

	// Start the container
	if err := cli.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
		panic(err)
	}

	// Wait for the container to finish and get its logs
	statusCh, errCh := cli.ContainerWait(ctx, resp.ID, container.WaitConditionNotRunning)
	select {
	case err := <-errCh:
		if err != nil {
			panic(err)
		}
	case <-statusCh:
	}

	out, err := cli.ContainerLogs(ctx, resp.ID, container.LogsOptions{ShowStdout: true})
	if err != nil {
		panic(err)
	}

	stdcopy.StdCopy(os.Stdout, os.Stderr, out)

	// Remove the container
	if err := cli.ContainerRemove(ctx, resp.ID, container.RemoveOptions{}); err != nil {
		panic(err)
	}

}
