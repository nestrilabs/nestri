package system

import (
	"log/slog"
	"os/exec"
	"strconv"
	"strings"
)

// monitorNVIDIAGPU monitors an NVIDIA GPU using nvidia-smi
func monitorNVIDIAGPU(device PCIInfo) GPUUsage {
	// Query nvidia-smi for GPU metrics
	cmd := exec.Command("nvidia-smi", "--query-gpu=pci.bus_id,utilization.gpu,memory.total,memory.used,memory.free", "--format=csv,noheader,nounits")
	output, err := cmd.Output()
	if err != nil {
		slog.Warn("failed to run nvidia-smi", "error", err)
		return GPUUsage{}
	}

	// Parse output and find matching GPU
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	for _, line := range lines {
		fields := strings.Split(line, ", ")
		if len(fields) != 5 {
			continue
		}
		busID := fields[0] // e.g., "0000:01:00.0"
		if strings.Contains(busID, device.Slot) || strings.Contains(device.Slot, busID) {
			usagePercent, _ := strconv.ParseFloat(fields[1], 64)
			totalMiB, _ := strconv.ParseUint(fields[2], 10, 64)
			usedMiB, _ := strconv.ParseUint(fields[3], 10, 64)
			freeMiB, _ := strconv.ParseUint(fields[4], 10, 64)

			// Convert MiB to bytes
			total := totalMiB * 1024 * 1024
			used := usedMiB * 1024 * 1024
			free := freeMiB * 1024 * 1024
			usedPercent := float64(0)
			if total > 0 {
				usedPercent = float64(used) / float64(total) * 100
			}

			return GPUUsage{
				Info:         device,
				UsagePercent: usagePercent,
				VRAM: VRAMUsage{
					Total:       total,
					Used:        used,
					Free:        free,
					UsedPercent: usedPercent,
				},
			}
		}
	}
	slog.Warn("No NVIDIA GPU found matching PCI slot", "slot", device.Slot)
	return GPUUsage{}
}
