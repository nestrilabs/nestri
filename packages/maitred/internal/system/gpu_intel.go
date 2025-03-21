package system

import (
	"bufio"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

// FDInfo holds parsed fdinfo data
type FDInfo struct {
	ClientID    string
	EngineTime  uint64 // i915: "drm-engine-render" in ns
	Cycles      uint64 // Xe: "drm-cycles-rcs"
	TotalCycles uint64 // Xe: "drm-total-cycles-rcs"
	MemoryVRAM  uint64 // i915: "drm-memory-vram", Xe: "drm-total-vram0" in bytes
}

// findCardX maps PCI slot to /dev/dri/cardX
func findCardX(pciSlot string) (string, error) {
	driPath := "/sys/class/drm"
	entries, err := os.ReadDir(driPath)
	if err != nil {
		return "", fmt.Errorf("failed to read /sys/class/drm: %v", err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "card") {
			deviceLink := filepath.Join(driPath, entry.Name(), "device")
			target, err := os.Readlink(deviceLink)
			if err != nil {
				continue
			}
			if strings.Contains(target, pciSlot) {
				return entry.Name(), nil
			}
		}
	}
	return "", fmt.Errorf("no cardX found for PCI slot %s", pciSlot)
}

// getDriver retrieves the driver name
func getDriver(cardX string) (string, error) {
	driverLink := filepath.Join("/sys/class/drm", cardX, "device", "driver")
	target, err := os.Readlink(driverLink)
	if err != nil {
		return "", fmt.Errorf("failed to read driver link for %s: %v", cardX, err)
	}
	return filepath.Base(target), nil
}

// collectFDInfo gathers fdinfo data
func collectFDInfo(cardX string) ([]FDInfo, error) {
	var fdInfos []FDInfo
	clientIDs := make(map[string]struct{})

	procDirs, err := os.ReadDir("/proc")
	if err != nil {
		return nil, fmt.Errorf("failed to read /proc: %v", err)
	}

	for _, procDir := range procDirs {
		if !procDir.IsDir() {
			continue
		}
		pid := procDir.Name()
		if _, err := strconv.Atoi(pid); err != nil {
			continue
		}
		fdDir := filepath.Join("/proc", pid, "fd")
		fdEntries, err := os.ReadDir(fdDir)
		if err != nil {
			continue
		}
		for _, fdEntry := range fdEntries {
			fdPath := filepath.Join(fdDir, fdEntry.Name())
			target, err := os.Readlink(fdPath)
			if err != nil {
				continue
			}
			if target == "/dev/dri/"+cardX {
				fdinfoPath := filepath.Join("/proc", pid, "fdinfo", fdEntry.Name())
				file, err := os.Open(fdinfoPath)
				if err != nil {
					continue
				}

				scanner := bufio.NewScanner(file)
				var clientID, engineTime, cycles, totalCycles, memoryVRAM string
				for scanner.Scan() {
					line := scanner.Text()
					parts := strings.SplitN(line, ":", 2)
					if len(parts) < 2 {
						continue
					}
					key := strings.TrimSpace(parts[0])
					value := strings.TrimSpace(parts[1])
					switch key {
					case "drm-client-id":
						clientID = value
					case "drm-engine-render":
						engineTime = value
					case "drm-cycles-rcs":
						cycles = value
					case "drm-total-cycles-rcs":
						totalCycles = value
					case "drm-memory-vram", "drm-total-vram0": // i915 and Xe keys
						memoryVRAM = value
					}
				}
				if clientID == "" || clientID == "0" {
					continue
				}
				if _, exists := clientIDs[clientID]; exists {
					continue
				}
				clientIDs[clientID] = struct{}{}

				fdInfo := FDInfo{ClientID: clientID}
				if engineTime != "" {
					fdInfo.EngineTime, _ = strconv.ParseUint(engineTime, 10, 64)
				}
				if cycles != "" {
					fdInfo.Cycles, _ = strconv.ParseUint(cycles, 10, 64)
				}
				if totalCycles != "" {
					fdInfo.TotalCycles, _ = strconv.ParseUint(totalCycles, 10, 64)
				}
				if memoryVRAM != "" {
					if strings.HasSuffix(memoryVRAM, " kB") || strings.HasSuffix(memoryVRAM, " KiB") {
						memKB := strings.TrimSuffix(strings.TrimSuffix(memoryVRAM, " kB"), " KiB")
						if mem, err := strconv.ParseUint(memKB, 10, 64); err == nil {
							fdInfo.MemoryVRAM = mem * 1024 // Convert kB to bytes
						}
					} else {
						fdInfo.MemoryVRAM, _ = strconv.ParseUint(memoryVRAM, 10, 64) // Assume bytes if no unit
					}
				}
				fdInfos = append(fdInfos, fdInfo)
				_ = file.Close()
			}
		}
	}
	return fdInfos, nil
}

// drmIoctl wraps the syscall.Syscall for ioctl
func drmIoctl(fd int, request uintptr, data unsafe.Pointer) error {
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), request, uintptr(data))
	if errno != 0 {
		return fmt.Errorf("ioctl failed: %v", errno)
	}
	return nil
}

func monitorIntelGPU(device PCIInfo) GPUUsage {
	// Map PCI slot to cardX
	cardX, err := findCardX(device.Slot)
	if err != nil {
		slog.Warn("failed to find cardX for Intel GPU", "slot", device.Slot, "error", err)
		return GPUUsage{}
	}

	// Determine driver
	driver, err := getDriver(cardX)
	if err != nil {
		slog.Warn("failed to get driver", "card", cardX, "error", err)
		return GPUUsage{}
	}
	if driver != "i915" && driver != "xe" {
		slog.Warn("unsupported Intel driver", "driver", driver, "card", cardX)
		return GPUUsage{}
	}

	// PCIInfo also has the driver, let's warn if they don't match
	if device.Driver != driver {
		slog.Warn("driver mismatch", "card", cardX, "lspci driver", device.Driver, "sysfs driver", driver)
	}

	// Open DRM device
	cardPath := "/dev/dri/" + cardX
	fd, err := syscall.Open(cardPath, syscall.O_RDWR, 0)
	if err != nil {
		slog.Error("failed to open DRM device", "path", cardPath, "error", err)
		return GPUUsage{}
	}
	defer func(fd int) {
		_ = syscall.Close(fd)
	}(fd)

	// Get total and used VRAM via ioctl
	var totalVRAM, usedVRAMFromIOCTL uint64
	if driver == "i915" {
		totalVRAM, usedVRAMFromIOCTL, err = getMemoryRegionsI915(fd)
	} else { // xe
		totalVRAM, usedVRAMFromIOCTL, err = queryMemoryRegionsXE(fd)
	}
	if err != nil {
		//slog.Debug("failed to get memory regions", "card", cardX, "error", err)
		// Proceed with totalVRAM = 0 if ioctl fails
	}

	// Collect samples for usage percentage
	firstFDInfos, err := collectFDInfo(cardX)
	if err != nil {
		slog.Warn("failed to collect first FDInfo", "card", cardX, "error", err)
		return GPUUsage{}
	}
	time.Sleep(1 * time.Second)
	secondFDInfos, err := collectFDInfo(cardX)
	if err != nil {
		slog.Warn("failed to collect second FDInfo", "card", cardX, "error", err)
		return GPUUsage{}
	}

	// Calculate usage percentage
	var usagePercent float64
	if driver == "i915" {
		var totalDeltaTime uint64
		for _, second := range secondFDInfos {
			for _, first := range firstFDInfos {
				if second.ClientID == first.ClientID {
					totalDeltaTime += second.EngineTime - first.EngineTime
					break
				}
			}
		}
		if totalDeltaTime > 0 {
			usagePercent = float64(totalDeltaTime) / 1e9 * 100 // ns to percent
		}
	} else { // xe
		var totalDeltaCycles, deltaTotalCycles uint64
		for i, second := range secondFDInfos {
			for _, first := range firstFDInfos {
				if second.ClientID == first.ClientID {
					deltaCycles := second.Cycles - first.Cycles
					totalDeltaCycles += deltaCycles
					if i == 0 {
						deltaTotalCycles = second.TotalCycles - first.TotalCycles
					}
					break
				}
			}
		}
		if deltaTotalCycles > 0 {
			usagePercent = float64(totalDeltaCycles) / float64(deltaTotalCycles) * 100
		}
	}
	if usagePercent > 100 {
		usagePercent = 100
	}

	// Sum per-process VRAM usage as fallback
	var usedVRAM uint64
	for _, fdInfo := range secondFDInfos {
		usedVRAM += fdInfo.MemoryVRAM
	}

	// Prefer ioctl used VRAM if available and non-zero
	if usedVRAMFromIOCTL != 0 {
		usedVRAM = usedVRAMFromIOCTL
	}

	// Compute VRAM metrics
	var freeVRAM uint64
	var usedPercent float64
	if totalVRAM > 0 {
		if usedVRAM > totalVRAM {
			usedVRAM = totalVRAM
		}
		freeVRAM = totalVRAM - usedVRAM
		usedPercent = float64(usedVRAM) / float64(totalVRAM) * 100
	}

	return GPUUsage{
		Info:         device,
		UsagePercent: usagePercent,
		VRAM: VRAMUsage{
			Total:       totalVRAM,
			Used:        usedVRAM,
			Free:        freeVRAM,
			UsedPercent: usedPercent,
		},
	}
}
