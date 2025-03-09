package system

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

// CPUInfo contains CPU model information
type CPUInfo struct {
	Vendor string `json:"vendor"` // CPU vendor (e.g., "AMD", "Intel")
	Model  string `json:"model"`  // CPU model name
}

// CPUUsage contains CPU usage metrics
type CPUUsage struct {
	Info    CPUInfo   `json:"info"`     // CPU vendor and model information
	Total   float64   `json:"total"`    // Total CPU usage in percentage (0-100)
	PerCore []float64 `json:"per_core"` // CPU usage per core in percentage (0-100)
}

// MemoryUsage contains memory usage metrics
type MemoryUsage struct {
	Total       uint64  `json:"total"`        // Total memory in bytes
	Used        uint64  `json:"used"`         // Used memory in bytes
	Available   uint64  `json:"available"`    // Available memory in bytes
	Free        uint64  `json:"free"`         // Free memory in bytes
	UsedPercent float64 `json:"used_percent"` // Used memory in percentage (0-100)
}

// FilesystemUsage contains usage metrics for a filesystem path
type FilesystemUsage struct {
	Path        string  `json:"path"`         // Filesystem path
	Total       uint64  `json:"total"`        // Total disk space in bytes
	Used        uint64  `json:"used"`         // Used disk space in bytes
	Free        uint64  `json:"free"`         // Free disk space in bytes
	UsedPercent float64 `json:"used_percent"` // Used disk space in percentage (0-100)
}

// GPUUsage contains GPU usage metrics
type GPUUsage struct {
	Info         PCIInfo   `json:"pci_info"`      // GPU PCI information
	UsagePercent float64   `json:"usage_percent"` // GPU usage in percentage (0-100)
	VRAM         VRAMUsage `json:"vram"`          // GPU memory usage metrics
}

// VRAMUsage contains GPU memory usage metrics
type VRAMUsage struct {
	Total       uint64  `json:"total"`        // Total VRAM in bytes
	Used        uint64  `json:"used"`         // Used VRAM in bytes
	Free        uint64  `json:"free"`         // Free VRAM in bytes
	UsedPercent float64 `json:"used_percent"` // Used VRAM in percentage (0-100)
}

// ResourceUsage contains resource usage metrics
type ResourceUsage struct {
	CPU    CPUUsage        `json:"cpu"`    // CPU usage metrics
	Memory MemoryUsage     `json:"memory"` // Memory usage metrics
	Disk   FilesystemUsage `json:"disk"`   // Disk usage metrics
	GPUs   []GPUUsage      `json:"gpus"`   // Per-GPU usage metrics
}

var (
	lastUsage      ResourceUsage
	lastUsageMutex sync.RWMutex
)

// GetSystemUsage returns last known system resource usage metrics
func GetSystemUsage() ResourceUsage {
	lastUsageMutex.RLock()
	defer lastUsageMutex.RUnlock()
	return lastUsage
}

// StartMonitoring begins periodic system usage monitoring with the given interval
func StartMonitoring(ctx context.Context, interval time.Duration) {
	slog.Info("Starting system monitoring")
	go func() {
		// Initial sample immediately
		updateUsage()

		// Ticker for periodic updates
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				slog.Info("Stopping system monitoring")
				return
			case <-ticker.C:
				updateUsage()
			}
		}
	}()
}

// updateUsage collects and updates the lastUsage variable
func updateUsage() {
	// Collect CPU usage
	cpu := GetCPUUsage()

	// Collect memory usage
	memory := GetMemoryUsage()

	// Collect root filesystem usage
	rootfs, err := GetFilesystemUsage("/")
	if err != nil {
		slog.Warn("Failed to get root filesystem usage", "error", err)
	}

	// Collect GPU usage
	gpus := GetGPUUsage()

	// Update shared variable safely
	lastUsageMutex.Lock()
	lastUsage = ResourceUsage{
		CPU:    cpu,
		Memory: memory,
		Disk:   rootfs,
		GPUs:   gpus,
	}
	lastUsageMutex.Unlock()
}

// PrettyString returns resource usage metrics in a human-readable format string
func (r ResourceUsage) PrettyString() string {
	res := "Resource Usage:\n"
	res += fmt.Sprintf("  CPU:\n")
	res += fmt.Sprintf("    Vendor: %s\n", r.CPU.Info.Vendor)
	res += fmt.Sprintf("    Model: %s\n", r.CPU.Info.Model)
	res += fmt.Sprintf("    Total Usage: %.2f%%\n", r.CPU.Total)
	res += fmt.Sprintf("    Per-Core Usage:\n")
	res += fmt.Sprintf("      [")
	for i, coreUsage := range r.CPU.PerCore {
		res += fmt.Sprintf("%.2f%%", coreUsage)
		if i < len(r.CPU.PerCore)-1 {
			res += ", "
		}
	}
	res += "]\n"

	res += fmt.Sprintf("  Memory:\n")
	res += fmt.Sprintf("    Total: %d bytes\n", r.Memory.Total)
	res += fmt.Sprintf("    Used: %d bytes\n", r.Memory.Used)
	res += fmt.Sprintf("    Available: %d bytes\n", r.Memory.Available)
	res += fmt.Sprintf("    Free: %d bytes\n", r.Memory.Free)
	res += fmt.Sprintf("    Used Percent: %.2f%%\n", r.Memory.UsedPercent)

	res += fmt.Sprintf("  Filesystem:\n")
	res += fmt.Sprintf("    Path: %s\n", r.Disk.Path)
	res += fmt.Sprintf("    Total: %d bytes\n", r.Disk.Total)
	res += fmt.Sprintf("    Used: %d bytes\n", r.Disk.Used)
	res += fmt.Sprintf("    Free: %d bytes\n", r.Disk.Free)
	res += fmt.Sprintf("    Used Percent: %.2f%%\n", r.Disk.UsedPercent)

	res += fmt.Sprintf("  GPUs:\n")
	for i, gpu := range r.GPUs {
		cardDev, renderDev, err := gpu.Info.GetCardDevices()
		if err != nil {
			slog.Warn("Failed to get card and render devices", "error", err)
		}

		res += fmt.Sprintf("    GPU %d:\n", i)
		res += fmt.Sprintf("      Vendor: %s\n", gpu.Info.Vendor.Name)
		res += fmt.Sprintf("      Model: %s\n", gpu.Info.Device.Name)
		res += fmt.Sprintf("      Driver: %s\n", gpu.Info.Driver)
		res += fmt.Sprintf("      Card Device: %s\n", cardDev)
		res += fmt.Sprintf("      Render Device: %s\n", renderDev)
		res += fmt.Sprintf("      Usage Percent: %.2f%%\n", gpu.UsagePercent)
		res += fmt.Sprintf("      VRAM:\n")
		res += fmt.Sprintf("        Total: %d bytes\n", gpu.VRAM.Total)
		res += fmt.Sprintf("        Used: %d bytes\n", gpu.VRAM.Used)
		res += fmt.Sprintf("        Free: %d bytes\n", gpu.VRAM.Free)
		res += fmt.Sprintf("        Used Percent: %.2f%%\n", gpu.VRAM.UsedPercent)
	}

	return res
}

// GetCPUUsage gathers CPU usage
func GetCPUUsage() CPUUsage {
	// Helper to read /proc/stat
	readStat := func() (uint64, uint64, []uint64, []uint64) {
		statBytes, err := os.ReadFile("/proc/stat")
		if err != nil {
			slog.Warn("Failed to read /proc/stat", "error", err)
			return 0, 0, nil, nil
		}
		statScanner := bufio.NewScanner(bytes.NewReader(statBytes))
		statScanner.Scan() // Total CPU line
		fields := strings.Fields(statScanner.Text())[1:]
		var total, idle uint64
		for i, field := range fields {
			val, _ := strconv.ParseUint(field, 10, 64)
			total += val
			if i == 3 { // Idle time
				idle = val
			}
		}

		var perCoreTotals, perCoreIdles []uint64
		for statScanner.Scan() {
			line := statScanner.Text()
			if !strings.HasPrefix(line, "cpu") {
				break
			}
			coreFields := strings.Fields(line)[1:]
			var coreTotal, coreIdle uint64
			for i, field := range coreFields {
				val, _ := strconv.ParseUint(field, 10, 64)
				coreTotal += val
				if i == 3 { // Idle time
					coreIdle = val
				}
			}
			perCoreTotals = append(perCoreTotals, coreTotal)
			perCoreIdles = append(perCoreIdles, coreIdle)
		}
		return total, idle, perCoreTotals, perCoreIdles
	}

	// First sample
	prevTotal, prevIdle, prevPerCoreTotals, prevPerCoreIdles := readStat()
	time.Sleep(1 * time.Second) // Delay for accurate delta
	// Second sample
	currTotal, currIdle, currPerCoreTotals, currPerCoreIdles := readStat()

	// Calculate total CPU usage
	totalDiff := float64(currTotal - prevTotal)
	idleDiff := float64(currIdle - prevIdle)
	var totalUsage float64
	if totalDiff > 0 {
		totalUsage = ((totalDiff - idleDiff) / totalDiff) * 100
	}

	// Calculate per-core usage
	var perCore []float64
	for i := range currPerCoreTotals {
		coreTotalDiff := float64(currPerCoreTotals[i] - prevPerCoreTotals[i])
		coreIdleDiff := float64(currPerCoreIdles[i] - prevPerCoreIdles[i])
		if coreTotalDiff > 0 {
			perCoreUsage := ((coreTotalDiff - coreIdleDiff) / coreTotalDiff) * 100
			perCore = append(perCore, perCoreUsage)
		} else {
			perCore = append(perCore, 0)
		}
	}

	// Get CPU info
	cpuInfoBytes, err := os.ReadFile("/proc/cpuinfo")
	if err != nil {
		slog.Warn("Failed to read /proc/cpuinfo", "error", err)
		return CPUUsage{}
	}
	cpuInfo := string(cpuInfoBytes)
	scanner := bufio.NewScanner(strings.NewReader(cpuInfo))
	var vendor, model string
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "vendor_id") {
			vendor = strings.TrimSpace(strings.Split(line, ":")[1])
		} else if strings.HasPrefix(line, "model name") {
			model = strings.TrimSpace(strings.Split(line, ":")[1])
		}
		if vendor != "" && model != "" {
			break
		}
	}

	return CPUUsage{
		Info: CPUInfo{
			Vendor: vendor,
			Model:  model,
		},
		Total:   totalUsage,
		PerCore: perCore,
	}
}

// GetMemoryUsage gathers memory usage from /proc/meminfo
func GetMemoryUsage() MemoryUsage {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		panic(err)
	}

	scanner := bufio.NewScanner(bytes.NewReader(data))
	var total, free, available uint64

	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "MemTotal:") {
			total = parseMemInfoLine(line)
		} else if strings.HasPrefix(line, "MemFree:") {
			free = parseMemInfoLine(line)
		} else if strings.HasPrefix(line, "MemAvailable:") {
			available = parseMemInfoLine(line)
		}
	}

	used := total - available
	usedPercent := (float64(used) / float64(total)) * 100

	return MemoryUsage{
		Total:       total * 1024, // Convert from KB to bytes
		Used:        used * 1024,
		Available:   available * 1024,
		Free:        free * 1024,
		UsedPercent: usedPercent,
	}
}

// parseMemInfoLine parses a line from /proc/meminfo
func parseMemInfoLine(line string) uint64 {
	fields := strings.Fields(line)
	val, _ := strconv.ParseUint(fields[1], 10, 64)
	return val
}

// GetFilesystemUsage gathers usage statistics for the specified path
func GetFilesystemUsage(path string) (FilesystemUsage, error) {
	cmd := exec.Command("df", path)
	output, err := cmd.Output()
	if err != nil {
		return FilesystemUsage{}, err
	}

	lines := strings.Split(string(output), "\n")
	if len(lines) < 2 {
		return FilesystemUsage{}, fmt.Errorf("unexpected `df` output format for path: %s", path)
	}

	fields := strings.Fields(lines[1])
	if len(fields) < 5 {
		return FilesystemUsage{}, fmt.Errorf("insufficient fields in `df` output for path: %s", path)
	}

	total, err := strconv.ParseUint(fields[1], 10, 64)
	if err != nil {
		return FilesystemUsage{}, fmt.Errorf("failed to parse total space: %v", err)
	}

	used, err := strconv.ParseUint(fields[2], 10, 64)
	if err != nil {
		return FilesystemUsage{}, fmt.Errorf("failed to parse used space: %v", err)
	}

	free, err := strconv.ParseUint(fields[3], 10, 64)
	if err != nil {
		return FilesystemUsage{}, fmt.Errorf("failed to parse free space: %v", err)
	}

	usedPercent, err := strconv.ParseFloat(strings.TrimSuffix(fields[4], "%"), 64)
	if err != nil {
		return FilesystemUsage{}, fmt.Errorf("failed to parse used percentage: %v", err)
	}

	return FilesystemUsage{
		Path:        path,
		Total:       total * 1024,
		Used:        used * 1024,
		Free:        free * 1024,
		UsedPercent: usedPercent,
	}, nil
}

// GetGPUUsage gathers GPU usage for all detected GPUs
func GetGPUUsage() []GPUUsage {
	var gpus []GPUUsage

	// Detect all GPUs
	pciInfos, err := GetAllGPUInfo()
	if err != nil {
		slog.Warn("Failed to get GPU info", "error", err)
		return nil
	}

	// Monitor each GPU
	for _, gpu := range pciInfos {
		var gpuUsage GPUUsage
		switch gpu.Vendor.ID {
		case VendorIntel:
			gpuUsage = monitorIntelGPU(gpu)
		case VendorNVIDIA:
			gpuUsage = monitorNVIDIAGPU(gpu)
		case VendorAMD:
			// TODO: Implement if needed
			continue
		default:
			continue
		}
		gpus = append(gpus, gpuUsage)
	}

	return gpus
}
