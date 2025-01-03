package session

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/docker/docker/api/types/container"
)

// ExecResult holds the output from a container command
type ExecResult struct {
	ExitCode int
	Stdout   string
	Stderr   string
}

func (s *Session) execInContainer(ctx context.Context, cmd []string) (*ExecResult, error) {
	execConfig := container.ExecOptions{
		Cmd:          cmd,
		AttachStdout: true,
		AttachStderr: true,
	}

	execID, err := s.client.ContainerExecCreate(ctx, s.containerID, execConfig)
	if err != nil {
		return nil, err
	}

	resp, err := s.client.ContainerExecAttach(ctx, execID.ID, container.ExecAttachOptions{})
	if err != nil {
		return nil, err
	}
	defer resp.Close()

	var outBuf bytes.Buffer
	_, err = io.Copy(&outBuf, resp.Reader)
	if err != nil {
		return nil, err
	}

	inspect, err := s.client.ContainerExecInspect(ctx, execID.ID)
	if err != nil {
		return nil, err
	}

	return &ExecResult{
		ExitCode: inspect.ExitCode,
		Stdout:   outBuf.String(),
	}, nil
}

// CheckSteamGames returns the list of installed games in the container
func (s *Session) CheckInstalledSteamGames(ctx context.Context) ([]uint64, error) {
	result, err := s.execInContainer(ctx, []string{
		"sh", "-c",
		"find /home/nestri/.steam/steam/steamapps -name '*.acf' -exec grep -H '\"appid\"' {} \\;",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to check steam games: %v", err)
	}

	var gameIDs []uint64
	for _, line := range strings.Split(result.Stdout, "\n") {
		if strings.Contains(line, "appid") {
			var id uint64
			if _, err := fmt.Sscanf(line, `"appid" "%d"`, &id); err == nil {
				gameIDs = append(gameIDs, id)
			}
		}
	}

	return gameIDs, nil
}
