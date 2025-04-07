package system

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	pciClassVGA         = 0x0300 // VGA compatible controller
	pciClass3D          = 0x0302 // 3D controller
	pciClassDisplay     = 0x0380 // Display controller
	pciClassCoProcessor = 0x0b40 // Co-processor (e.g., NVIDIA Tesla)
)

type infoPair struct {
	Name string
	ID   int
}

type PCIInfo struct {
	Slot       string
	Class      infoPair
	Vendor     infoPair
	Device     infoPair
	SVendor    infoPair
	SDevice    infoPair
	Rev        string
	ProgIf     string
	Driver     string
	Modules    []string
	IOMMUGroup string
}

const (
	VendorIntel  = 0x8086
	VendorNVIDIA = 0x10de
	VendorAMD    = 0x1002
)

func GetAllGPUInfo() ([]PCIInfo, error) {
	var gpus []PCIInfo

	cmd := exec.Command("lspci", "-mmvvvnnkD")
	output, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	sections := bytes.Split(output, []byte("\n\n"))
	for _, section := range sections {
		var info PCIInfo

		lines := bytes.Split(section, []byte("\n"))
		for _, line := range lines {
			parts := bytes.SplitN(line, []byte(":"), 2)
			if len(parts) < 2 {
				continue
			}

			key := strings.TrimSpace(string(parts[0]))
			value := strings.TrimSpace(string(parts[1]))

			switch key {
			case "Slot":
				info.Slot = value
			case "Class":
				info.Class, err = parseInfoPair(value)
			case "Vendor":
				info.Vendor, err = parseInfoPair(value)
			case "Device":
				info.Device, err = parseInfoPair(value)
			case "SVendor":
				info.SVendor, err = parseInfoPair(value)
			case "SDevice":
				info.SDevice, err = parseInfoPair(value)
			case "Rev":
				info.Rev = value
			case "ProgIf":
				info.ProgIf = value
			case "Driver":
				info.Driver = value
			case "Module":
				info.Modules = append(info.Modules, value)
			case "IOMMUGroup":
				info.IOMMUGroup = value
			}

			if err != nil {
				return nil, err
			}
		}

		// Check if this is a GPU device
		if isGPUClass(info.Class.ID) {
			gpus = append(gpus, info)
		}
	}

	return gpus, nil
}

// gets infoPair from "SomeName [SomeID]"
// example: "DG2 [Arc A770] [56a0]" -> Name: "DG2 [Arc A770]", ID: "56a0"
func parseInfoPair(pair string) (infoPair, error) {
	parts := strings.Split(pair, "[")
	if len(parts) < 2 {
		return infoPair{}, errors.New("invalid info pair")
	}

	id := strings.TrimSuffix(parts[len(parts)-1], "]")
	name := strings.TrimSuffix(pair, "["+id)
	name = strings.TrimSpace(name)
	id = strings.TrimSpace(id)

	// Remove ID including square brackets from name
	name = strings.ReplaceAll(name, "["+id+"]", "")
	name = strings.TrimSpace(name)

	idHex, err := parseHexID(id)
	if err != nil {
		return infoPair{}, err
	}

	return infoPair{
		Name: name,
		ID:   idHex,
	}, nil
}

func parseHexID(id string) (int, error) {
	if strings.HasPrefix(id, "0x") {
		id = id[2:]
	}
	parsed, err := strconv.ParseInt(id, 16, 32)
	if err != nil {
		return 0, err
	}
	return int(parsed), nil
}

func isGPUClass(class int) bool {
	return class == pciClassVGA || class == pciClass3D || class == pciClassDisplay || class == pciClassCoProcessor
}

// GetCardDevices returns the /dev/dri/cardX and /dev/dri/renderDXXX device
func (info PCIInfo) GetCardDevices() (cardPath, renderPath string, err error) {
	busID := strings.ToLower(info.Slot)
	if !strings.HasPrefix(busID, "0000:") || len(busID) != 12 || busID[4] != ':' || busID[7] != ':' || busID[10] != '.' {
		return "", "", fmt.Errorf("invalid PCI Bus ID format: %s (expected 0000:XX:YY.Z)", busID)
	}

	byPathDir := "/dev/dri/by-path/"
	entries, err := os.ReadDir(byPathDir)
	if err != nil {
		return "", "", fmt.Errorf("failed to read %s: %v", byPathDir, err)
	}

	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, "pci-"+busID+"-card") {
			cardPath, err = filepath.EvalSymlinks(filepath.Join(byPathDir, name))
			if err != nil {
				return "", "", fmt.Errorf("failed to resolve card symlink %s: %v", name, err)
			}
		}
		if strings.HasPrefix(name, "pci-"+busID+"-render") {
			renderPath, err = filepath.EvalSymlinks(filepath.Join(byPathDir, name))
			if err != nil {
				return "", "", fmt.Errorf("failed to resolve render symlink %s: %v", name, err)
			}
		}
	}

	if cardPath == "" && renderPath == "" {
		return "", "", fmt.Errorf("no DRM devices found for PCI Bus ID: %s", busID)
	}
	return cardPath, renderPath, nil
}
