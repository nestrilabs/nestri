package system

import (
	"fmt"
	"unsafe"
)

// Constants from xe_drm.h
const (
	DRM_XE_DEVICE_QUERY_MEM_REGIONS         = 1
	DRM_XE_MEM_REGION_CLASS_VRAM            = 1
	DRM_XE_DEVICE_QUERY                     = 0x00
	DRM_IOCTL_XE_DEVICE_QUERY       uintptr = 0xC0286440 // Precomputed as above
)

// drmXEDeviceQuery mirrors struct drm_xe_device_query
type drmXEDeviceQuery struct {
	Extensions uint64
	Query      uint32
	Size       uint32
	Data       uint64
	Reserved   [2]uint64
}

// drmXEQueryMemRegions mirrors struct drm_xe_query_mem_regions header
type drmXEQueryMemRegions struct {
	NumMemRegions uint32
	Pad           uint32
	// mem_regions[] follows
}

// drmXEMemRegion mirrors struct drm_xe_mem_region
type drmXEMemRegion struct {
	MemClass       uint16
	Instance       uint16
	MinPageSize    uint32
	TotalSize      uint64
	Used           uint64
	CPUVisibleSize uint64
	CPUVisibleUsed uint64
	Reserved       [6]uint64
}

func queryMemoryRegionsXE(fd int) (totalVRAM, usedVRAM uint64, err error) {
	// Step 1: Get the required size
	query := drmXEDeviceQuery{
		Query: DRM_XE_DEVICE_QUERY_MEM_REGIONS,
		Size:  0,
	}
	if err = drmIoctl(fd, DRM_IOCTL_XE_DEVICE_QUERY, unsafe.Pointer(&query)); err != nil {
		return 0, 0, fmt.Errorf("initial xe query failed: %v", err)
	}
	if query.Size == 0 {
		return 0, 0, fmt.Errorf("xe query returned zero size")
	}

	// Step 2: Allocate buffer and perform the query
	data := make([]byte, query.Size)
	query.Data = uint64(uintptr(unsafe.Pointer(&data[0])))
	query.Size = uint32(len(data))
	if err = drmIoctl(fd, DRM_IOCTL_XE_DEVICE_QUERY, unsafe.Pointer(&query)); err != nil {
		return 0, 0, fmt.Errorf("second xe query failed: %v", err)
	}

	// Step 3: Parse the memory regions
	header := (*drmXEQueryMemRegions)(unsafe.Pointer(&data[0]))
	numRegions := header.NumMemRegions
	headerSize := unsafe.Sizeof(drmXEQueryMemRegions{})
	regionSize := unsafe.Sizeof(drmXEMemRegion{})

	for i := uint32(0); i < numRegions; i++ {
		offset := headerSize + uintptr(i)*regionSize
		if offset+regionSize > uintptr(len(data)) {
			return 0, 0, fmt.Errorf("data buffer too small for xe region %d", i)
		}
		mr := (*drmXEMemRegion)(unsafe.Pointer(&data[offset]))
		if mr.MemClass == DRM_XE_MEM_REGION_CLASS_VRAM {
			totalVRAM += mr.TotalSize
			usedVRAM += mr.Used
		}
	}

	return totalVRAM, usedVRAM, nil
}
