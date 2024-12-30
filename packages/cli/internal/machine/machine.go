package machine

import (
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
)

type Machine struct{}

func NewMachine() *Machine {
	return &Machine{}
}

func (m *Machine) OS() string {
	output, _ := exec.Command("hostnamectl", "status").Output()
	re := regexp.MustCompile(`Operating System:\s+(.*)`)
	match := re.FindStringSubmatch(string(output))
	if len(match) > 1 {
		return match[1]
	}
	return "unknown"
}

func (m *Machine) Architecture() string {
	output, _ := exec.Command("hostnamectl", "status").Output()
	re := regexp.MustCompile(`Architecture:\s+(\w+)`)
	match := re.FindStringSubmatch(string(output))
	if len(match) > 1 {
		return match[1]
	}
	return "unknown"

}

func (m *Machine) Kernel() string {
	output, _ := exec.Command("hostnamectl", "status").Output()
	re := regexp.MustCompile(`Kernel:\s+(.*)`)
	match := re.FindStringSubmatch(string(output))
	if len(match) > 1 {
		return match[1]
	}
	return "unknown"
}

func (m *Machine) Virtualization() string {
	output, _ := exec.Command("hostnamectl", "status").Output()
	re := regexp.MustCompile(`Virtualization:\s+(\w+)`)
	match := re.FindStringSubmatch(string(output))
	if len(match) > 1 {
		return match[1]
	}
	return "none"
}

func (m *Machine) StaticHostname() (string, error) {
	output, err := exec.Command("hostnamectl", "status").Output()
	if err != nil {
		return "", err
	}
	re := regexp.MustCompile(`Static hostname:\s+(.*)`)
	match := re.FindStringSubmatch(string(output))
	if len(match) > 1 {
		return match[1], nil
	}
	return "", fmt.Errorf("static hostname not found")
}

func (m *Machine) MachineID() (string, error) {
	id, err := os.ReadFile("/etc/machine-id")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(id)), nil
}

func (m *Machine) GPUInfo() (string, string, error) {
	// The command for GPU information varies depending on the system and drivers.
	// lshw is a good general-purpose tool, but might need adjustments for specific hardware.
	output, err := exec.Command("lshw", "-C", "display").Output()
	if err != nil {
		return "", "", fmt.Errorf("failed to get GPU information: %w", err)
	}

	gpuType := ""
	gpuSize := ""

	// Regular expressions for extracting product and size information. These might need to be
	// adapted based on the output of lshw on your specific system.
	typeRegex := regexp.MustCompile(`product:\s+(.*)`)
	sizeRegex := regexp.MustCompile(`size:\s+(\d+MiB)`) // Example: extracts size in MiB

	typeMatch := typeRegex.FindStringSubmatch(string(output))
	if len(typeMatch) > 1 {
		gpuType = typeMatch[1]
	}

	sizeMatch := sizeRegex.FindStringSubmatch(string(output))
	if len(sizeMatch) > 1 {
		gpuSize = sizeMatch[1]
	}

	if gpuType == "" && gpuSize == "" {
		return "", "", fmt.Errorf("could not parse GPU information using lshw")
	}

	return gpuType, gpuSize, nil
}

func (m *Machine) CPUInfo() (string, string, error) {
	output, err := exec.Command("lscpu").Output()
	if err != nil {
		return "", "", fmt.Errorf("failed to get CPU information: %w", err)
	}

	cpuType := ""
	cpuSize := "" // This will store the number of cores

	typeRegex := regexp.MustCompile(`Model name:\s+(.*)`)
	coresRegex := regexp.MustCompile(`CPU\(s\):\s+(\d+)`)

	typeMatch := typeRegex.FindStringSubmatch(string(output))
	if len(typeMatch) > 1 {
		cpuType = typeMatch[1]
	}

	coresMatch := coresRegex.FindStringSubmatch(string(output))
	if len(coresMatch) > 1 {
		cpuSize = coresMatch[1]
	}

	if cpuType == "" && cpuSize == "" {
		return "", "", fmt.Errorf("could not parse CPU information using lscpu")
	}

	return cpuType, cpuSize, nil

}

func (m *Machine) RAMSize() (string, error) {
	output, err := exec.Command("free", "-h", "--si").Output() // Using -h for human-readable and --si for base-10 units
	if err != nil {
		return "", fmt.Errorf("failed to get RAM information: %w", err)
	}

	ramSize := ""

	ramRegex := regexp.MustCompile(`Mem:\s+(\S+)`) // Matches the total memory size

	ramMatch := ramRegex.FindStringSubmatch(string(output))
	if len(ramMatch) > 1 {
		ramSize = ramMatch[1]
	} else {
		return "", fmt.Errorf("could not parse RAM information from free command")
	}

	return ramSize, nil
}
