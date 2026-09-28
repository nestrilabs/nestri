// ─────────────────────────────────────────────────────────────────────────────
//  memory.rs — choosing a memory type for a capture slot
//
//  Split out and made pure so the choice can be tested. It used to be a single
//  "first type with HOST_VISIBLE | HOST_COHERENT" inside capture.rs, applied to
//  every allocation including the exported ones — which on a discrete GPU put
//  the capture ring in system RAM. The blit then wrote a full frame across the
//  bus and the encoder read it back across the bus, sixty times a second, for
//  a buffer neither side ever maps.
//
//  Measured on the target (RX 9060 XT, RADV): memoryTypes[2] is the first
//  HOST_VISIBLE|HOST_COHERENT type and sits on heapIndex 0, the 31 GiB heap
//  with no DEVICE_LOCAL bit. memoryTypes[0] is DEVICE_LOCAL on heapIndex 1,
//  the 16 GiB one. The old rule picked [2] every time.
// ─────────────────────────────────────────────────────────────────────────────

use ash::vk;

/// One entry of `VkPhysicalDeviceMemoryProperties::memoryTypes`.
#[derive(Clone, Copy, Debug)]
pub struct MemoryType {
    pub flags: vk::MemoryPropertyFlags,
}

/// What the caller intends to do with the allocation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Want {
    /// The GPU writes it and another device imports it. Nothing maps it.
    DeviceLocal,
    /// The CPU reads it back. `read_frame_pixels` needs this.
    HostCoherent,
}

/// Pick a memory type index from `types`, restricted to those set in `bits`.
///
/// `DeviceLocal` is a preference: a device with no device-local type the image
/// can use must still get an allocation, so it falls back to anything allowed.
/// `HostCoherent` is a requirement: memory that cannot be mapped cannot serve
/// the readback path at all, and handing it over would fault on the first
/// `vkMapMemory` rather than degrade.
pub fn pick_memory_type(types: &[MemoryType], bits: u32, want: Want) -> Option<u32> {
    let allowed = |i: usize| bits & (1u32 << i) != 0;

    match want {
        Want::DeviceLocal => (0..types.len())
            .find(|&i| {
                allowed(i)
                    && types[i]
                        .flags
                        .contains(vk::MemoryPropertyFlags::DEVICE_LOCAL)
            })
            .or_else(|| (0..types.len()).find(|&i| allowed(i)))
            .map(|i| i as u32),
        Want::HostCoherent => (0..types.len())
            .find(|&i| {
                allowed(i)
                    && types[i].flags.contains(
                        vk::MemoryPropertyFlags::HOST_VISIBLE
                            | vk::MemoryPropertyFlags::HOST_COHERENT,
                    )
            })
            .map(|i| i as u32),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ash::vk::MemoryPropertyFlags as F;

    fn t(flags: F) -> MemoryType {
        MemoryType { flags }
    }

    /// The target's actual layout, trimmed to the types that matter: a
    /// device-local type first, a host-coherent one on the system heap after
    /// it. The old rule scanned for host-coherent and took the second.
    #[test]
    fn device_local_is_preferred_over_a_host_type() {
        let types = [t(F::DEVICE_LOCAL), t(F::HOST_VISIBLE | F::HOST_COHERENT)];
        assert_eq!(pick_memory_type(&types, 0b11, Want::DeviceLocal), Some(0));
    }

    /// Order must not decide it. Same two types, host-coherent first.
    #[test]
    fn device_local_is_preferred_even_when_it_comes_second() {
        let types = [t(F::HOST_VISIBLE | F::HOST_COHERENT), t(F::DEVICE_LOCAL)];
        assert_eq!(pick_memory_type(&types, 0b11, Want::DeviceLocal), Some(1));
    }

    /// A type the image's `memoryTypeBits` excludes may not be chosen, however
    /// well it matches. Binding an image to a type it forbids is invalid.
    #[test]
    fn a_type_the_image_forbids_is_never_chosen() {
        let types = [t(F::HOST_VISIBLE | F::HOST_COHERENT), t(F::DEVICE_LOCAL)];
        assert_eq!(pick_memory_type(&types, 0b01, Want::DeviceLocal), Some(0));
    }

    /// No device-local type the image can use is not a failure: the allocation
    /// still has to happen, just without the preference.
    #[test]
    fn device_local_falls_back_to_whatever_is_allowed() {
        let types = [t(F::HOST_VISIBLE | F::HOST_COHERENT)];
        assert_eq!(pick_memory_type(&types, 0b1, Want::DeviceLocal), Some(0));
    }

    /// Readback has no fallback.
    #[test]
    fn host_coherent_has_no_fallback() {
        let types = [t(F::DEVICE_LOCAL)];
        assert_eq!(pick_memory_type(&types, 0b1, Want::HostCoherent), None);
    }

    /// A device-local *and* host-visible type still satisfies readback. RADV
    /// offers one (the ReBAR window) and refusing it would be wrong.
    #[test]
    fn host_coherent_accepts_a_device_local_type_that_is_also_mappable() {
        let types = [
            t(F::DEVICE_LOCAL),
            t(F::DEVICE_LOCAL | F::HOST_VISIBLE | F::HOST_COHERENT),
        ];
        assert_eq!(pick_memory_type(&types, 0b11, Want::HostCoherent), Some(1));
    }

    /// Nothing allowed at all is None rather than index zero. Falling back to
    /// zero was the old behaviour and it binds to a type the image forbids.
    #[test]
    fn no_allowed_type_is_none() {
        let types = [t(F::DEVICE_LOCAL), t(F::HOST_VISIBLE | F::HOST_COHERENT)];
        assert_eq!(pick_memory_type(&types, 0, Want::DeviceLocal), None);
        assert_eq!(pick_memory_type(&types, 0, Want::HostCoherent), None);
    }
}
