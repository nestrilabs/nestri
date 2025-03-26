package system

import (
	"fmt"
	"unsafe"
)

// Constants for i915
const (
	DRM_COMMAND_BASE              = 0x40
	DRM_I915_QUERY                = 0x39
	DRM_IOCTL_I915_QUERY          = 0x80106479 // _IOWR('d', 0x79, 16)
	DRM_I915_QUERY_MEMORY_REGIONS = 4
	I915_MEMORY_CLASS_DEVICE      = 1
)

// drmI915QueryItem mirrors struct drm_i915_query_item
type drmI915QueryItem struct {
	QueryID uintptr
	Length  int32
	Flags   uint32
	DataPtr uintptr
}

// drmI915Query mirrors struct drm_i915_query
type drmI915Query struct {
	NumItems uint32
	Flags    uint32
	ItemsPtr uintptr
}

// drmI915MemoryRegionInfo mirrors struct drm_i915_memory_region_info
type drmI915MemoryRegionInfo struct {
	Region struct {
		MemoryClass    uint16
		MemoryInstance uint16
	}
	Rsvd0           uint32
	ProbedSize      uint64
	UnallocatedSize uint64
	Rsvd1           [8]uint64
}

func getMemoryRegionsI915(fd int) (totalVRAM, usedVRAM uint64, err error) {
	// Step 1: Get the required buffer size
	item := drmI915QueryItem{
		QueryID: DRM_I915_QUERY_MEMORY_REGIONS,
		Length:  0,
	}
	query := drmI915Query{
		NumItems: 1,
		ItemsPtr: uintptr(unsafe.Pointer(&item)),
	}
	if err = drmIoctl(fd, DRM_IOCTL_I915_QUERY, unsafe.Pointer(&query)); err != nil {
		return 0, 0, fmt.Errorf("initial i915 query failed: %v", err)
	}
	if item.Length <= 0 {
		return 0, 0, fmt.Errorf("i915 query returned invalid length: %d", item.Length)
	}

	// Step 2: Allocate buffer and perform the query
	data := make([]byte, item.Length)
	item.DataPtr = uintptr(unsafe.Pointer(&data[0]))
	if err = drmIoctl(fd, DRM_IOCTL_I915_QUERY, unsafe.Pointer(&query)); err != nil {
		return 0, 0, fmt.Errorf("second i915 query failed: %v", err)
	}

	// Step 3: Parse the memory regions
	numRegions := *(*uint32)(unsafe.Pointer(&data[0]))
	headerSize := uint32(16) // num_regions (4) + rsvd[3] (12) = 16 bytes
	regionSize := uint32(88) // Size of drm_i915_memory_region_info (calculated: 4+4+8+8+64)

	for i := uint32(0); i < numRegions; i++ {
		offset := headerSize + i*regionSize
		if offset+regionSize > uint32(len(data)) {
			return 0, 0, fmt.Errorf("data buffer too small for i915 region %d", i)
		}
		mr := (*drmI915MemoryRegionInfo)(unsafe.Pointer(&data[offset]))
		if mr.Region.MemoryClass == I915_MEMORY_CLASS_DEVICE {
			totalVRAM += mr.ProbedSize
			usedVRAM += mr.ProbedSize - mr.UnallocatedSize
		}
	}

	return totalVRAM, usedVRAM, nil
}
