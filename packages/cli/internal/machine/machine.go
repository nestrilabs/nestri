package machine

import (
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"

	"github.com/charmbracelet/log"
)

type Machine struct {
	OperatingSystem string
	Arch            string
	Kernel          string
	Virtualization  string
	Hostname        string
}

func NewMachine() *Machine {
	var OS string
	var architecture string
	var kernel string
	var virtualisation string
	var hostname string

	output, _ := exec.Command("hostnamectl", "status").Output()
	os := regexp.MustCompile(`Operating System:\s+(.*)`)
	matchingOS := os.FindStringSubmatch(string(output))
	if len(matchingOS) > 1 {
		OS = matchingOS[1]
	}

	arch := regexp.MustCompile(`Architecture:\s+(\w+)`)
	matchingArch := arch.FindStringSubmatch(string(output))
	if len(matchingArch) > 1 {
		architecture = matchingArch[1]
	}

	kern := regexp.MustCompile(`Kernel:\s+(.*)`)
	matchingKernel := kern.FindStringSubmatch(string(output))
	if len(matchingKernel) > 1 {
		kernel = matchingKernel[1]
	}

	virt := regexp.MustCompile(`Virtualization:\s+(\w+)`)
	matchingVirt := virt.FindStringSubmatch(string(output))
	if len(matchingVirt) > 1 {
		virtualisation = matchingVirt[1]
	}

	host := regexp.MustCompile(`Static hostname:\s+(.*)`)
	matchingHost := host.FindStringSubmatch(string(output))
	if len(matchingHost) > 1 {
		hostname = cleanString(matchingHost[1])
	}

	return &Machine{
		OperatingSystem: OS,
		Arch:            architecture,
		Kernel:          kernel,
		Virtualization:  virtualisation,
		Hostname:        hostname,
	}
}

func (m *Machine) GetOS() string {
	if m.OperatingSystem != "" {
		return m.OperatingSystem
	}
	return "unknown"
}

func (m *Machine) GetArchitecture() string {

	if m.Arch != "" {
		return m.Arch
	}
	return "unknown"

}

func (m *Machine) GetKernel() string {
	if m.Kernel != "" {
		return m.Kernel
	}
	return "unknown"
}

func (m *Machine) GetVirtualization() string {
	if m.Virtualization != "" {
		return m.Virtualization
	}
	return "none"
}

func (m *Machine) GetHostname() string {
	if m.Hostname != "" {
		return m.Hostname
	}
	return "unknown"
}

func (m *Machine) GetMachineID() string {
	id, err := os.ReadFile("/etc/machine-id")
	if err != nil {
		log.Error("Error getting your machine's ID", "err", err)
		os.Exit(1)
	}
	return strings.TrimSpace(string(id))
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

func (m *Machine) GetCPUInfo() (string, string, error) {
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

func (m *Machine) GetRAMSize() (string, error) {
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

func cleanString(s string) string {
	s = strings.ToLower(s)

	reg := regexp.MustCompile("[^a-z0-9]+") // Matches one or more non-alphanumeric characters
	return reg.ReplaceAllString(s, "")
}
