package main

import (
	"nestrilabs/cli/cmd"
	"os"

	"github.com/charmbracelet/log"
)

func main() {
	// m := machine.NewMachine()

	// hostname, err := m.StaticHostname()
	// if err != nil {
	// 	log.Error("Failed to start the cmd", "err", err)
	// 	os.Exit(1)
	// }
	// kernel := m.Kernel()
	// operatingSystem := m.OS()
	// virtualization := m.Virtualization()
	// arch := m.Architecture()
	// fingerprint, err := m.MachineID()
	// if err != nil {
	// 	log.Error("Failed to start the cmd", "err", err)
	// 	os.Exit(1)
	// }

	// log.Info("Machine", "hostname", hostname)
	// log.Info("Machine", "kernel", kernel)
	// log.Info("Machine", "operatingSystem", operatingSystem)
	// log.Info("Machine", "virtualization", virtualization)
	// log.Info("Machine", "architecture", arch)
	// log.Info("Machine", "fingerprint", fingerprint)
	// ram, _ := m.RAMSize()
	// cpuType, cpuSize, _ := m.CPUInfo()
	// gpuType, gpuSize, _ := m.GPUInfo()
	// log.Info("Machine", "ram", ram)
	// fmt.Println("Machine", "cpu", cpuSize, cpuType)
	// fmt.Println("Machine", "gpu", gpuSize, gpuType)

	err := cmd.Execute()
	if err != nil {
		log.Error("Failed to start the cmd", "err", err)
		os.Exit(1)
	}
}
