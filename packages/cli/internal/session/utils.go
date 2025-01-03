package session

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/docker/docker/api/types/container"
)

// detectGPU checks for available GPU type
func detectGPU() GPUType {
	// First check for NVIDIA
	cmd := exec.Command("nvidia-smi")
	if err := cmd.Run(); err == nil {
		return GPUNvidia
	}

	// Check for Intel/AMD GPU by looking for DRI devices
	if _, err := os.Stat("/dev/dri"); err == nil {
		return GPUIntelAMD
	}

	return GPUNone
}

// getGPUDeviceRequests returns appropriate device configuration based on GPU type
func getGPUDeviceRequests(gpuType GPUType) ([]container.DeviceRequest, error) {
	switch gpuType {
	case GPUNvidia:
		return []container.DeviceRequest{
			{
				Driver:       "nvidia",
				Count:        1,
				DeviceIDs:    []string{"0"},
				Capabilities: [][]string{{"gpu"}},
			},
		}, nil
	case GPUIntelAMD:
		return []container.DeviceRequest{}, nil // Empty as we'll handle this in Devices
	default:
		return nil, fmt.Errorf("no supported GPU detected")
	}
}

// getGPUDevices returns appropriate device mappings based on GPU type
func getGPUDevices(gpuType GPUType) []container.DeviceMapping {
	if gpuType == GPUIntelAMD {
		devices := []container.DeviceMapping{}
		// Only look for card and renderD nodes
		for _, pattern := range []string{"card[0-9]*", "renderD[0-9]*"} {
			matches, err := filepath.Glob(fmt.Sprintf("/dev/dri/%s", pattern))
			if err != nil {
				continue
			}

			for _, match := range matches {
				// Verify it's a device file
				if info, err := os.Stat(match); err == nil && (info.Mode()&os.ModeDevice) != 0 {
					devices = append(devices, container.DeviceMapping{
						PathOnHost:        match,
						PathInContainer:   match,
						CgroupPermissions: "rwm",
					})
				}
			}
		}
		return devices
	}
	return nil
}
