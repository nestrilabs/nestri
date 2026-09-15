// ─────────────────────────────────────────────────────────────────────────────
//  capture.rs — Frame capture helpers
//
//  Each ring slot is allocated with VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT
//  so that after the GPU blit we can export an fd and import it into pixelforge's
//  separate VkDevice for zero-copy hardware encoding via DmaBufImporter.
//
//  The ring is allocated tiled where the driver offers a single-plane DRM
//  format modifier, and linear where it does not. The stride and the chosen
//  modifier come from the image itself, queried once at allocation, and both
//  travel with every frame: the importer creates its side with that exact
//  modifier, and a wrong value there is a correctly sized frame of nonsense.
// ─────────────────────────────────────────────────────────────────────────────

use crate::state::{CB_STATE, CAPTURE_SLOTS, CaptureRing, CaptureSlot, DEVICE_STATE};
use ash::vk::{self, Handle};
use std::os::raw::c_int;

fn make_subresource_range() -> vk::ImageSubresourceRange {
    vk::ImageSubresourceRange {
        aspect_mask: vk::ImageAspectFlags::COLOR,
        base_mip_level: 0,
        level_count: 1,
        base_array_layer: 0,
        layer_count: 1,
    }
}
fn make_subresource_layers() -> vk::ImageSubresourceLayers {
    vk::ImageSubresourceLayers {
        aspect_mask: vk::ImageAspectFlags::COLOR,
        mip_level: 0,
        base_array_layer: 0,
        layer_count: 1,
    }
}

macro_rules! image_barrier {
    ($src:expr, $dst:expr, $old:expr, $new:expr, $img:expr) => {
        vk::ImageMemoryBarrier {
            s_type: vk::StructureType::IMAGE_MEMORY_BARRIER,
            p_next: std::ptr::null(),
            src_access_mask: $src,
            dst_access_mask: $dst,
            old_layout: $old,
            new_layout: $new,
            src_queue_family_index: vk::QUEUE_FAMILY_IGNORED,
            dst_queue_family_index: vk::QUEUE_FAMILY_IGNORED,
            image: $img,
            subresource_range: make_subresource_range(),
            _marker: std::marker::PhantomData,
        }
    };
}

// ── Memory helper ─────────────────────────────────────────────────────────────

unsafe fn find_memory_type(
    ds: &crate::state::DeviceState,
    bits: u32,
    want: crate::memory::Want,
) -> Option<u32> {
    let mut mp = vk::PhysicalDeviceMemoryProperties::default();
    let k = unsafe { crate::dispatch_key(ds.physical_device.as_raw() as *const std::ffi::c_void) };
    if let Some(i) = crate::state::INSTANCE_STATE.get(&k) {
        unsafe { (i.get_physical_device_memory_properties)(ds.physical_device, &mut mp) };
    }
    let types: Vec<crate::memory::MemoryType> = mp.memory_types[..mp.memory_type_count as usize]
        .iter()
        .map(|t| crate::memory::MemoryType {
            flags: t.property_flags,
        })
        .collect();
    crate::memory::pick_memory_type(&types, bits, want)
}

/// Modifiers the device can both receive a transfer into and have sampled from,
/// for `fmt`.
///
/// Both feature bits matter and for different sides: the layer writes the image
/// with `vkCmdCopyImage`, and pixelforge samples it in the colour-conversion
/// compute shader after importing it. A modifier that supports only one of
/// those is no use to this ring.
unsafe fn supported_modifiers(
    ds: &crate::state::DeviceState,
    fmt: vk::Format,
) -> Vec<crate::modifiers::ModifierProps> {
    let k = unsafe { crate::dispatch_key(ds.physical_device.as_raw() as *const std::ffi::c_void) };
    let Some(istate) = crate::state::INSTANCE_STATE.get(&k) else {
        return Vec::new();
    };
    let Some(get_props2) = istate.get_physical_device_format_properties2 else {
        return Vec::new();
    };

    // Two calls: the first to learn the count, the second to fill the list.
    let mut list = vk::DrmFormatModifierPropertiesListEXT::default();
    let mut props2 = vk::FormatProperties2 {
        p_next: &mut list as *mut _ as *mut std::ffi::c_void,
        ..Default::default()
    };
    unsafe { get_props2(ds.physical_device, fmt, &mut props2) };

    let count = list.drm_format_modifier_count as usize;
    if count == 0 {
        return Vec::new();
    }
    let mut entries = vec![vk::DrmFormatModifierPropertiesEXT::default(); count];
    list.p_drm_format_modifier_properties = entries.as_mut_ptr();
    let mut props2 = vk::FormatProperties2 {
        p_next: &mut list as *mut _ as *mut std::ffi::c_void,
        ..Default::default()
    };
    unsafe { get_props2(ds.physical_device, fmt, &mut props2) };

    let needed =
        vk::FormatFeatureFlags::TRANSFER_DST | vk::FormatFeatureFlags::SAMPLED_IMAGE;
    entries
        .iter()
        .filter(|e| e.drm_format_modifier_tiling_features.contains(needed))
        .map(|e| crate::modifiers::ModifierProps {
            modifier: e.drm_format_modifier,
            plane_count: e.drm_format_modifier_plane_count,
        })
        .collect()
}

/// Which modifier the driver actually gave an image.
///
/// The image is created from a list of acceptable modifiers and the driver
/// chooses; the importer needs the one it chose, not the list. `None` when the
/// extension is absent or the call fails, which sends the caller back to the
/// linear path rather than letting it guess.
unsafe fn image_modifier(ds: &crate::state::DeviceState, image: vk::Image) -> Option<u64> {
    let get = ds.fp.get_image_drm_format_modifier_properties_ext?;
    let mut props = vk::ImageDrmFormatModifierPropertiesEXT::default();
    if unsafe { get(ds.raw, image, &mut props) } != vk::Result::SUCCESS {
        return None;
    }
    Some(props.drm_format_modifier)
}

// ── Image allocators ──────────────────────────────────────────────────────────

/// Plain HOST_VISIBLE image (nescapture capture — no cross-device sharing needed).
unsafe fn allocate_host_image(
    ds: &crate::state::DeviceState,
    w: u32,
    h: u32,
    fmt: vk::Format,
    label: &str,
) -> Option<(vk::Image, vk::DeviceMemory)> {
    let ci = vk::ImageCreateInfo {
        s_type: vk::StructureType::IMAGE_CREATE_INFO,
        p_next: std::ptr::null(),
        flags: vk::ImageCreateFlags::empty(),
        image_type: vk::ImageType::TYPE_2D,
        format: fmt,
        extent: vk::Extent3D {
            width: w,
            height: h,
            depth: 1,
        },
        mip_levels: 1,
        array_layers: 1,
        samples: vk::SampleCountFlags::TYPE_1,
        tiling: vk::ImageTiling::LINEAR,
        usage: vk::ImageUsageFlags::TRANSFER_DST,
        sharing_mode: vk::SharingMode::EXCLUSIVE,
        queue_family_index_count: 0,
        p_queue_family_indices: std::ptr::null(),
        initial_layout: vk::ImageLayout::UNDEFINED,
        _marker: std::marker::PhantomData,
    };
    unsafe { alloc_image(ds, &ci, None, label) }
}

/// DMA-BUF exportable image (final capture — imported into pixelforge for encoding).
///
/// Falls back to a plain host image if the driver rejects external memory.
/// In that case `get_dmabuf_fd` will return `None` and the encoder will use
/// the CPU pixel-readback fallback.
unsafe fn allocate_dmabuf_image(
    ds: &crate::state::DeviceState,
    w: u32,
    h: u32,
    fmt: vk::Format,
    label: &str,
) -> Option<(vk::Image, vk::DeviceMemory, u64)> {
    let export_ai = vk::ExportMemoryAllocateInfo {
        s_type: vk::StructureType::EXPORT_MEMORY_ALLOCATE_INFO,
        p_next: std::ptr::null_mut(),
        handle_types: vk::ExternalMemoryHandleTypeFlags::DMA_BUF_EXT,
        _marker: std::marker::PhantomData,
    };

    // Tiled first. A linear destination means the copy detiles a whole frame on
    // the way in and the encoder samples a linear image on the way out; the
    // importer has always been able to take a tiled buffer, and only this side
    // was ever linear.
    let candidates = unsafe { supported_modifiers(ds, fmt) };
    if let Some(chosen) = crate::modifiers::pick_modifier(&candidates)
        && chosen.modifier != crate::modifiers::LINEAR
    {
        let mut ext_img = vk::ExternalMemoryImageCreateInfo {
            s_type: vk::StructureType::EXTERNAL_MEMORY_IMAGE_CREATE_INFO,
            p_next: std::ptr::null_mut(),
            handle_types: vk::ExternalMemoryHandleTypeFlags::DMA_BUF_EXT,
            _marker: std::marker::PhantomData,
        };
        let modifiers = [chosen.modifier];
        let mut mod_list = vk::ImageDrmFormatModifierListCreateInfoEXT::default()
            .drm_format_modifiers(&modifiers);
        mod_list.p_next = &mut ext_img as *mut _ as *mut std::ffi::c_void;

        let ci = vk::ImageCreateInfo {
            s_type: vk::StructureType::IMAGE_CREATE_INFO,
            p_next: &mod_list as *const _ as *const _,
            flags: vk::ImageCreateFlags::empty(),
            image_type: vk::ImageType::TYPE_2D,
            format: fmt,
            extent: vk::Extent3D {
                width: w,
                height: h,
                depth: 1,
            },
            mip_levels: 1,
            array_layers: 1,
            samples: vk::SampleCountFlags::TYPE_1,
            tiling: vk::ImageTiling::DRM_FORMAT_MODIFIER_EXT,
            usage: vk::ImageUsageFlags::TRANSFER_DST,
            sharing_mode: vk::SharingMode::EXCLUSIVE,
            queue_family_index_count: 0,
            p_queue_family_indices: std::ptr::null(),
            initial_layout: vk::ImageLayout::UNDEFINED,
            _marker: std::marker::PhantomData,
        };
        if let Some((image, memory)) = unsafe { alloc_image(ds, &ci, Some(&export_ai), label) } {
            // Ask which one it took rather than assuming the one offered: the
            // importer is given an explicit modifier and a wrong value there is
            // a correctly sized frame full of nonsense.
            match unsafe { image_modifier(ds, image) } {
                Some(actual) => {
                    log::info!(
                        "capture '{label}': tiled, modifier {actual:#018x} \
                         (offered {:#018x}, {} candidate(s))",
                        chosen.modifier,
                        candidates.len()
                    );
                    return Some((image, memory, actual));
                }
                None => {
                    log::warn!(
                        "capture '{label}': the driver would not report the modifier it \
                         chose — falling back to linear rather than importing a guess"
                    );
                    unsafe {
                        (ds.fp.destroy_image)(ds.raw, image, std::ptr::null());
                        (ds.fp.free_memory)(ds.raw, memory, std::ptr::null());
                    }
                }
            }
        } else {
            log::warn!("capture '{label}': tiled allocation refused — falling back to linear");
        }
    } else {
        log::info!(
            "capture '{label}': no tiled modifier offered ({} candidate(s)) — linear",
            candidates.len()
        );
    }

    let ext_img = vk::ExternalMemoryImageCreateInfo {
        s_type: vk::StructureType::EXTERNAL_MEMORY_IMAGE_CREATE_INFO,
        p_next: std::ptr::null_mut(),
        handle_types: vk::ExternalMemoryHandleTypeFlags::DMA_BUF_EXT,
        _marker: std::marker::PhantomData,
    };
    let ci = vk::ImageCreateInfo {
        s_type: vk::StructureType::IMAGE_CREATE_INFO,
        p_next: &ext_img as *const _ as *const _,
        flags: vk::ImageCreateFlags::empty(),
        image_type: vk::ImageType::TYPE_2D,
        format: fmt,
        extent: vk::Extent3D {
            width: w,
            height: h,
            depth: 1,
        },
        mip_levels: 1,
        array_layers: 1,
        samples: vk::SampleCountFlags::TYPE_1,
        tiling: vk::ImageTiling::LINEAR,
        usage: vk::ImageUsageFlags::TRANSFER_DST,
        sharing_mode: vk::SharingMode::EXCLUSIVE,
        queue_family_index_count: 0,
        p_queue_family_indices: std::ptr::null(),
        initial_layout: vk::ImageLayout::UNDEFINED,
        _marker: std::marker::PhantomData,
    };
    if let Some((image, memory)) = unsafe { alloc_image(ds, &ci, Some(&export_ai), label) } {
        return Some((image, memory, crate::modifiers::LINEAR));
    }
    log::warn!(
        "DMA-BUF alloc failed for '{}' — using plain host image. \
         Zero-copy GPU path will be unavailable; CPU readback fallback active.",
        label
    );
    unsafe { allocate_host_image(ds, w, h, fmt, label) }
        .map(|(i, m)| (i, m, crate::modifiers::LINEAR))
}

unsafe fn alloc_image(
    ds: &crate::state::DeviceState,
    ci: &vk::ImageCreateInfo,
    export: Option<&vk::ExportMemoryAllocateInfo>,
    label: &str,
) -> Option<(vk::Image, vk::DeviceMemory)> {
    let mut image = vk::Image::null();
    if unsafe { (ds.fp.create_image)(ds.raw, ci, std::ptr::null(), &mut image) }
        != vk::Result::SUCCESS
    {
        return None;
    }
    let mut mr = vk::MemoryRequirements {
        size: 0,
        alignment: 0,
        memory_type_bits: 0,
    };
    unsafe { (ds.fp.get_image_memory_requirements)(ds.raw, image, &mut mr) };
    // An exported image is written by this device and read by pixelforge's,
    // both on the same GPU. Nothing maps it, so host-visible memory buys
    // nothing and on a discrete card costs a full frame across the bus each
    // way. Only the readback fallback has to be mappable.
    let want = match export {
        Some(_) => crate::memory::Want::DeviceLocal,
        None => crate::memory::Want::HostCoherent,
    };
    let mt = match unsafe { find_memory_type(ds, mr.memory_type_bits, want) } {
        Some(mt) => mt,
        None => {
            // Index zero used to be the fallback here, which binds the image
            // to a memory type its own requirements may forbid.
            log::warn!("no {want:?} memory type for '{label}' - not allocating");
            unsafe { (ds.fp.destroy_image)(ds.raw, image, std::ptr::null()) };
            return None;
        }
    };
    let p_next: *const _ = match export {
        Some(e) => e as *const _ as *const _,
        None => std::ptr::null(),
    };
    let ai = vk::MemoryAllocateInfo {
        s_type: vk::StructureType::MEMORY_ALLOCATE_INFO,
        p_next,
        allocation_size: mr.size,
        memory_type_index: mt,
        _marker: std::marker::PhantomData,
    };
    let mut mem = vk::DeviceMemory::null();
    if unsafe { (ds.fp.allocate_memory)(ds.raw, &ai, std::ptr::null(), &mut mem) }
        != vk::Result::SUCCESS
    {
        unsafe { (ds.fp.destroy_image)(ds.raw, image, std::ptr::null()) };
        return None;
    }
    if unsafe { (ds.fp.bind_image_memory)(ds.raw, image, mem, 0) } != vk::Result::SUCCESS {
        unsafe { (ds.fp.free_memory)(ds.raw, mem, std::ptr::null()) };
        unsafe { (ds.fp.destroy_image)(ds.raw, image, std::ptr::null()) };
        return None;
    }
    log::info!(
        "alloc {} {}x{} fmt={} ({} bytes)",
        label,
        ci.extent.width,
        ci.extent.height,
        ci.format.as_raw(),
        mr.size
    );
    Some((image, mem))
}

// ── Stride query ──────────────────────────────────────────────────────────────

/// Row stride in bytes of a LINEAR image, or 0 on failure.
pub unsafe fn query_stride(ds: &crate::state::DeviceState, image: vk::Image, modifier: u64) -> u32 {
    // A DRM_FORMAT_MODIFIER image is laid out in memory planes, not colour
    // planes, and asking it for COLOR is invalid — the aspect has to name the
    // memory plane. Single-plane is all `pick_modifier` will accept, so plane
    // zero is the whole image.
    let aspect_mask = if modifier == crate::modifiers::LINEAR {
        vk::ImageAspectFlags::COLOR
    } else {
        vk::ImageAspectFlags::MEMORY_PLANE_0_EXT
    };
    let sub = vk::ImageSubresource {
        aspect_mask,
        mip_level: 0,
        array_layer: 0,
    };
    let mut layout = vk::SubresourceLayout::default();
    unsafe { (ds.fp.get_image_subresource_layout)(ds.raw, image, &sub, &mut layout) };
    layout.row_pitch as u32
}

// ── DMA-BUF fd export ─────────────────────────────────────────────────────────

/// Export `memory` as a DMA-BUF fd via vkGetMemoryFdKHR.
/// Callers own the fd and must close it when done.
/// Returns `None` if VK_KHR_external_memory_fd is unavailable.
pub unsafe fn get_dmabuf_fd(
    ds: &crate::state::DeviceState,
    memory: vk::DeviceMemory,
) -> Option<c_int> {
    let f = match ds.fp.get_memory_fd_khr {
        Some(f) => f,
        None => {
            log::warn!("get_dmabuf_fd: vkGetMemoryFdKHR not available");
            return None;
        }
    };
    let fi = vk::MemoryGetFdInfoKHR {
        s_type: vk::StructureType::MEMORY_GET_FD_INFO_KHR,
        p_next: std::ptr::null(),
        memory,
        handle_type: vk::ExternalMemoryHandleTypeFlags::DMA_BUF_EXT,
        _marker: std::marker::PhantomData,
    };
    let mut fd: c_int = -1;
    let result = unsafe { f(ds.raw, &fi, &mut fd) };
    if result == vk::Result::SUCCESS && fd >= 0 {
        Some(fd)
    } else {
        log::warn!("get_dmabuf_fd failed: result={:?} fd={}", result, fd);
        None
    }
}

// ── ensure helpers ────────────────────────────────────────────────────────────

pub unsafe fn ensure_hudless_image(ds: &crate::state::DeviceState, w: u32, h: u32, f: vk::Format) {
    let mut ig = ds.hudless_image.lock().unwrap();
    let mut mg = ds.hudless_memory.lock().unwrap();
    let mut sg = ds.hudless_size.lock().unwrap();
    if let (Some(i), Some(m)) = (*ig, *mg) {
        let (ew, eh, ef) = *sg;
        if ew >= w && eh >= h && ef == f {
            return;
        }
        unsafe { (ds.fp.destroy_image)(ds.raw, i, std::ptr::null()) };
        unsafe { (ds.fp.free_memory)(ds.raw, m, std::ptr::null()) };
        *ig = None;
        *mg = None;
    }
    if let Some((i, m)) = unsafe { allocate_host_image(ds, w, h, f, "nescapture") } {
        *ig = Some(i);
        *mg = Some(m);
        *sg = (w, h, f);
    }
}

// ── Capture ring lifecycle ────────────────────────────────────────────────────

/// Bring `ring` up to a ring able to hold `w`x`h` `f` frames, building or
/// rebuilding it as needed. Returns false when the caller should skip this
/// frame.
///
/// A rebuild destroys images the encoder may still be reading, so it only
/// happens when every slot has come back. Resolution changes are rare and one
/// dropped frame at a resize is not worth a use-after-free.
unsafe fn ensure_capture_ring(
    ds: &crate::state::DeviceState,
    ring: &mut Option<CaptureRing>,
    w: u32,
    h: u32,
    f: vk::Format,
    queue_family: u32,
    image_count: usize,
) -> bool {
    if let Some(existing) = ring.as_ref() {
        let (ew, eh, ef) = existing.size;
        // `image_count` joins the identity because the blit buffers are
        // allocated one per (image, slot) pair. A swapchain that gained an
        // image needs more of them, and a ring that kept the old count would
        // silently stop capturing whenever that image came round.
        if ew >= w
            && eh >= h
            && ef == f
            && existing.queue_family == queue_family
            && existing.image_count == image_count
        {
            return true;
        }
        if !ds.capture_slots.all_free() {
            return false;
        }
        if let Some(old) = ring.take() {
            unsafe { destroy_capture_ring(ds, old) };
        }
    }
    match unsafe { create_capture_ring(ds, w, h, f, queue_family, image_count) } {
        Some(fresh) => {
            *ring = Some(fresh);
            true
        }
        None => false,
    }
}

unsafe fn create_capture_ring(
    ds: &crate::state::DeviceState,
    w: u32,
    h: u32,
    f: vk::Format,
    queue_family: u32,
    image_count: usize,
) -> Option<CaptureRing> {
    let pci = vk::CommandPoolCreateInfo {
        s_type: vk::StructureType::COMMAND_POOL_CREATE_INFO,
        p_next: std::ptr::null(),
        flags: vk::CommandPoolCreateFlags::RESET_COMMAND_BUFFER,
        // Was hard-coded to family 0, which is only correct when the game
        // happens to present on family 0.
        queue_family_index: queue_family,
        _marker: std::marker::PhantomData,
    };
    let mut command_pool = vk::CommandPool::null();
    if unsafe { (ds.fp.create_command_pool)(ds.raw, &pci, std::ptr::null(), &mut command_pool) }
        != vk::Result::SUCCESS
    {
        return None;
    }

    // One per (swapchain image, slot) pair, so each can be recorded once and
    // re-submitted. Typically twelve to sixteen buffers; they hold a barrier
    // pair and a copy each and are never re-recorded in steady state.
    let blit_count = image_count.max(1) * CAPTURE_SLOTS;
    let ai = vk::CommandBufferAllocateInfo {
        s_type: vk::StructureType::COMMAND_BUFFER_ALLOCATE_INFO,
        p_next: std::ptr::null(),
        command_pool,
        level: vk::CommandBufferLevel::PRIMARY,
        command_buffer_count: blit_count as u32,
        _marker: std::marker::PhantomData,
    };
    let mut blits = vec![vk::CommandBuffer::null(); blit_count];
    if unsafe { (ds.fp.allocate_command_buffers)(ds.raw, &ai, blits.as_mut_ptr()) }
        != vk::Result::SUCCESS
    {
        unsafe { (ds.fp.destroy_command_pool)(ds.raw, command_pool, std::ptr::null()) };
        return None;
    }

    // Pre-signalled: the first wait on a fresh slot must return immediately.
    let fci = vk::FenceCreateInfo {
        s_type: vk::StructureType::FENCE_CREATE_INFO,
        p_next: std::ptr::null(),
        flags: vk::FenceCreateFlags::SIGNALED,
        _marker: std::marker::PhantomData,
    };

    let mut slots = Vec::with_capacity(CAPTURE_SLOTS);
    for i in 0..CAPTURE_SLOTS {
        let Some((image, memory, modifier)) =
            (unsafe { allocate_dmabuf_image(ds, w, h, f, "capture") })
        else {
            unsafe { destroy_partial_ring(ds, command_pool, slots) };
            return None;
        };
        let mut fence = vk::Fence::null();
        if unsafe { (ds.fp.create_fence)(ds.raw, &fci, std::ptr::null(), &mut fence) }
            != vk::Result::SUCCESS
        {
            unsafe { (ds.fp.destroy_image)(ds.raw, image, std::ptr::null()) };
            unsafe { (ds.fp.free_memory)(ds.raw, memory, std::ptr::null()) };
            unsafe { destroy_partial_ring(ds, command_pool, slots) };
            return None;
        }
        let stride = unsafe { query_stride(ds, image, modifier) };
        // Export once. Each frame hands the encoder a dup of this fd, which
        // costs a file-descriptor clone instead of a kernel export per frame.
        let dmabuf_fd = unsafe { get_dmabuf_fd(ds, memory) }.unwrap_or(-1);
        if dmabuf_fd < 0 {
            log::warn!("capture slot {i}: no DMA-BUF export, falling back to CPU readback");
        }
        slots.push(CaptureSlot {
            image,
            memory,
            dmabuf_fd,
            stride,
            modifier,
            fence,
        });
    }

    log::info!(
        "capture ring: {CAPTURE_SLOTS} slots of {w}x{h} fmt={} on queue family {queue_family}",
        f.as_raw()
    );
    Some(CaptureRing {
        command_pool,
        slots,
        blits,
        blits_recorded: vec![false; blit_count],
        image_count: image_count.max(1),
        size: (w, h, f),
        queue_family,
        // Zero so the first frame always records: no real extent equals it, so
        // the invalidation check in `capture_present_frame` fires once and then
        // never again until something actually changes.
        blit_extent: vk::Extent2D {
            width: 0,
            height: 0,
        },
        present_wait: Vec::new(),
        retired: Vec::new(),
    })
}

unsafe fn destroy_partial_ring(
    ds: &crate::state::DeviceState,
    command_pool: vk::CommandPool,
    slots: Vec<CaptureSlot>,
) {
    unsafe {
        for slot in slots {
            (ds.fp.destroy_fence)(ds.raw, slot.fence, std::ptr::null());
            (ds.fp.destroy_image)(ds.raw, slot.image, std::ptr::null());
            (ds.fp.free_memory)(ds.raw, slot.memory, std::ptr::null());
            if slot.dmabuf_fd >= 0 {
                libc::close(slot.dmabuf_fd);
            }
        }
        (ds.fp.destroy_command_pool)(ds.raw, command_pool, std::ptr::null());
    }
}

/// Tear a ring down. The caller must have established that no slot is in
/// flight; the fence wait here only covers work already submitted.
pub unsafe fn destroy_capture_ring(ds: &crate::state::DeviceState, ring: CaptureRing) {
    let fences: Vec<vk::Fence> = ring.slots.iter().map(|s| s.fence).collect();
    if !fences.is_empty() {
        unsafe {
            let _ = (ds.fp.wait_for_fences)(
                ds.raw,
                fences.len() as u32,
                fences.as_ptr(),
                vk::TRUE,
                5_000_000_000,
            );
        }
    }
    unsafe {
        if let Some(destroy) = ds.fp.destroy_semaphore {
            for &sem in ring.present_wait.iter().chain(ring.retired.iter()) {
                if sem != vk::Semaphore::null() {
                    destroy(ds.raw, sem, std::ptr::null());
                }
            }
        }
    }
    unsafe { destroy_partial_ring(ds, ring.command_pool, ring.slots) };
}

// ── HUDless command injection ─────────────────────────────────────────────────

pub unsafe fn inject_hudless_copy(cb: vk::CommandBuffer, dk: usize) {
    let ds = match DEVICE_STATE.get(&dk) {
        Some(s) => s.clone(),
        None => return,
    };
    let cbk = cb.as_raw();
    let cs = match CB_STATE.get(&cbk) {
        Some(e) => e.value().clone(),
        None => return,
    };
    let ci = match cs.current_color_image {
        Some(i) => i,
        None => return,
    };
    let fmt = match cs.current_image_format {
        Some(f) => f,
        None => return,
    };
    let ext = match cs.current_image_extent {
        Some(e) => e,
        None => return,
    };
    let sc = *ds.swapchain_extent.lock().unwrap();
    if sc.width > 0 && sc.height > 0 && (ext.width != sc.width || ext.height != sc.height) {
        return;
    }
    unsafe { ensure_hudless_image(&ds, ext.width, ext.height, fmt) };
    let (hi, _) = {
        let a = ds.hudless_image.lock().unwrap();
        let b = ds.hudless_memory.lock().unwrap();
        match (*a, *b) {
            (Some(i), Some(m)) => (i, m),
            _ => return,
        }
    };
    // src → TRANSFER_SRC
    let b1 = image_barrier!(
        vk::AccessFlags::COLOR_ATTACHMENT_WRITE,
        vk::AccessFlags::TRANSFER_READ,
        vk::ImageLayout::COLOR_ATTACHMENT_OPTIMAL,
        vk::ImageLayout::TRANSFER_SRC_OPTIMAL,
        ci
    );
    unsafe {
        (ds.fp.cmd_pipeline_barrier)(
            cb,
            vk::PipelineStageFlags::COLOR_ATTACHMENT_OUTPUT,
            vk::PipelineStageFlags::TRANSFER,
            vk::DependencyFlags::empty(),
            0,
            std::ptr::null(),
            0,
            std::ptr::null(),
            1,
            &b1,
        );
    }
    // dst → TRANSFER_DST
    let b2 = image_barrier!(
        vk::AccessFlags::empty(),
        vk::AccessFlags::TRANSFER_WRITE,
        vk::ImageLayout::UNDEFINED,
        vk::ImageLayout::TRANSFER_DST_OPTIMAL,
        hi
    );
    unsafe {
        (ds.fp.cmd_pipeline_barrier)(
            cb,
            vk::PipelineStageFlags::TOP_OF_PIPE,
            vk::PipelineStageFlags::TRANSFER,
            vk::DependencyFlags::empty(),
            0,
            std::ptr::null(),
            0,
            std::ptr::null(),
            1,
            &b2,
        );
    }
    let cr = vk::ImageCopy {
        src_subresource: make_subresource_layers(),
        src_offset: vk::Offset3D { x: 0, y: 0, z: 0 },
        dst_subresource: make_subresource_layers(),
        dst_offset: vk::Offset3D { x: 0, y: 0, z: 0 },
        extent: vk::Extent3D {
            width: ext.width,
            height: ext.height,
            depth: 1,
        },
    };
    unsafe {
        (ds.fp.cmd_copy_image)(
            cb,
            ci,
            vk::ImageLayout::TRANSFER_SRC_OPTIMAL,
            hi,
            vk::ImageLayout::TRANSFER_DST_OPTIMAL,
            1,
            &cr,
        );
    }
    // restore src
    let b3 = image_barrier!(
        vk::AccessFlags::TRANSFER_READ,
        vk::AccessFlags::COLOR_ATTACHMENT_WRITE,
        vk::ImageLayout::TRANSFER_SRC_OPTIMAL,
        vk::ImageLayout::COLOR_ATTACHMENT_OPTIMAL,
        ci
    );
    unsafe {
        (ds.fp.cmd_pipeline_barrier)(
            cb,
            vk::PipelineStageFlags::TRANSFER,
            vk::PipelineStageFlags::COLOR_ATTACHMENT_OUTPUT,
            vk::DependencyFlags::empty(),
            0,
            std::ptr::null(),
            0,
            std::ptr::null(),
            1,
            &b3,
        );
    }
    if let Some(mut s) = CB_STATE.get_mut(&cb.as_raw()) {
        s.pending_capture = false;
        s.capture_injected = true;
    }
}

// ── Final frame GPU blit (swapchain → capture slot) ──────────────────────────

/// What a successful capture hands back to the present hook.
pub struct CaptureSubmission {
    /// Keeps the ring slot reserved until the encoder is finished with it.
    pub slot: crate::slots::SlotGuard,
    /// The semaphore the present must now wait on. The application's own wait
    /// semaphores were consumed by the blit submission, so presenting on them
    /// again would be a double wait.
    pub present_wait: vk::Semaphore,
}

/// Record the blit from one swapchain image into one ring slot.
///
/// Called once per (image, slot) pair and then never again while the swapchain
/// and the extent hold. No `ONE_TIME_SUBMIT`: this buffer is submitted many
/// times. It is never submitted twice concurrently, because the slot it writes
/// is held by a `SlotGuard` for the whole life of the frame, so the previous
/// submission has completed before that slot is handed out again.
unsafe fn record_blit(
    ds: &crate::state::DeviceState,
    cb: vk::CommandBuffer,
    si: vk::Image,
    fi: vk::Image,
    ext: vk::Extent2D,
) -> bool {
    let begin = vk::CommandBufferBeginInfo {
        s_type: vk::StructureType::COMMAND_BUFFER_BEGIN_INFO,
        p_next: std::ptr::null(),
        // The pool carries RESET_COMMAND_BUFFER, so beginning an already
        // recorded buffer implicitly resets it. That is the re-record path,
        // taken after a swapchain recreation or an extent change.
        flags: vk::CommandBufferUsageFlags::empty(),
        p_inheritance_info: std::ptr::null(),
        _marker: std::marker::PhantomData,
    };
    if unsafe { (ds.fp.begin_command_buffer)(cb, &begin) } != vk::Result::SUCCESS {
        return false;
    }

    let b1 = image_barrier!(
        vk::AccessFlags::MEMORY_READ,
        vk::AccessFlags::TRANSFER_READ,
        vk::ImageLayout::PRESENT_SRC_KHR,
        vk::ImageLayout::TRANSFER_SRC_OPTIMAL,
        si
    );
    unsafe {
        (ds.fp.cmd_pipeline_barrier)(
            cb,
            vk::PipelineStageFlags::BOTTOM_OF_PIPE,
            vk::PipelineStageFlags::TRANSFER,
            vk::DependencyFlags::empty(),
            0,
            std::ptr::null(),
            0,
            std::ptr::null(),
            1,
            &b1,
        );
    }
    let b2 = image_barrier!(
        vk::AccessFlags::empty(),
        vk::AccessFlags::TRANSFER_WRITE,
        vk::ImageLayout::UNDEFINED,
        vk::ImageLayout::TRANSFER_DST_OPTIMAL,
        fi
    );
    unsafe {
        (ds.fp.cmd_pipeline_barrier)(
            cb,
            vk::PipelineStageFlags::TOP_OF_PIPE,
            vk::PipelineStageFlags::TRANSFER,
            vk::DependencyFlags::empty(),
            0,
            std::ptr::null(),
            0,
            std::ptr::null(),
            1,
            &b2,
        );
    }
    let cr = vk::ImageCopy {
        src_subresource: make_subresource_layers(),
        src_offset: vk::Offset3D { x: 0, y: 0, z: 0 },
        dst_subresource: make_subresource_layers(),
        dst_offset: vk::Offset3D { x: 0, y: 0, z: 0 },
        extent: vk::Extent3D {
            width: ext.width,
            height: ext.height,
            depth: 1,
        },
    };
    unsafe {
        (ds.fp.cmd_copy_image)(
            cb,
            si,
            vk::ImageLayout::TRANSFER_SRC_OPTIMAL,
            fi,
            vk::ImageLayout::TRANSFER_DST_OPTIMAL,
            1,
            &cr,
        );
    }
    let b3 = image_barrier!(
        vk::AccessFlags::TRANSFER_READ,
        vk::AccessFlags::MEMORY_READ,
        vk::ImageLayout::TRANSFER_SRC_OPTIMAL,
        vk::ImageLayout::PRESENT_SRC_KHR,
        si
    );
    unsafe {
        (ds.fp.cmd_pipeline_barrier)(
            cb,
            vk::PipelineStageFlags::TRANSFER,
            vk::PipelineStageFlags::BOTTOM_OF_PIPE,
            vk::DependencyFlags::empty(),
            0,
            std::ptr::null(),
            0,
            std::ptr::null(),
            1,
            &b3,
        );
    }

    if unsafe { (ds.fp.end_command_buffer)(cb) } != vk::Result::SUCCESS {
        return false;
    }

    true
}

/// Blit the presented swapchain image into a ring slot, ahead of the present.
///
/// Two orderings have to hold and neither did before.
///
/// The blit must not read the swapchain image before the game has finished
/// rendering into it. The game signals that with the semaphores it attached to
/// `VkPresentInfoKHR`, so the blit waits on exactly those.
///
/// The game must not render into that image again before the blit has read it.
/// Presentation is what releases the image back to the application, so the
/// present is made to wait on a semaphore the blit signals. The old code
/// submitted the blit from a worker thread after `vkQueuePresentKHR` had
/// already returned, which guaranteed neither.
///
/// Returns `None` when the frame cannot be captured, in which case the caller
/// must present unmodified — the application's semaphores have not been touched.
pub unsafe fn capture_present_frame(
    ds: &crate::state::DeviceState,
    queue: vk::Queue,
    si: vk::Image,
    fmt: vk::Format,
    ext: vk::Extent2D,
    image_index: usize,
    image_count: usize,
    app_waits: &[vk::Semaphore],
) -> Option<CaptureSubmission> {
    if ext.width == 0 || ext.height == 0 {
        return None;
    }
    if !ds
        .swapchain_transfer_src
        .load(std::sync::atomic::Ordering::Relaxed)
    {
        return None;
    }

    // A command buffer may only be submitted to the family its pool was created
    // for. An unknown queue means one the layer never saw through
    // vkGetDeviceQueue, so there is nothing safe to assume about it.
    let queue_family = *crate::state::QUEUE_TO_FAMILY.get(&queue.as_raw())?;

    let mut ring_guard = ds.capture_ring.lock().ok()?;
    if !unsafe {
        ensure_capture_ring(
            ds,
            &mut ring_guard,
            ext.width,
            ext.height,
            fmt,
            queue_family,
            image_count,
        )
    } {
        return None;
    }
    let ring = ring_guard.as_mut()?;

    let present_wait = unsafe { ensure_present_semaphore(ds, ring, image_index) }?;

    // Never blocks: a frame with no free slot is one the encoder has not caught
    // up with, and stalling the game's present to wait for it would be worse
    // than skipping it.
    let guard = ds.capture_slots.try_acquire()?;
    let slot_index = guard.index();
    let slot = ring.slots.get(slot_index)?;
    let fence = slot.fence;
    let fi = slot.image;

    // A free slot's fence is already signalled — the encoder side waits on it
    // before it ever reads the slot. This covers the paths that abandon a frame
    // and return the slot without that wait.
    unsafe {
        if (ds.fp.wait_for_fences)(ds.raw, 1, &fence, vk::TRUE, 2_000_000) != vk::Result::SUCCESS {
            return None;
        }
        let _ = (ds.fp.reset_fences)(ds.raw, 1, &fence);
    }

    // The recording depends on the source image, the destination image and the
    // extent. A ring survives the swapchain shrinking, so the extent can move
    // under recordings whose images are still valid — invalidate on it here
    // rather than trusting every caller to have noticed.
    if ring.blit_extent != ext {
        ring.blits_recorded.iter_mut().for_each(|r| *r = false);
        ring.blit_extent = ext;
    }
    let blit = crate::state::blit_index(image_index, slot_index, ring.image_count)?;
    let cb = *ring.blits.get(blit)?;
    if !ring.blits_recorded[blit] {
        if !unsafe { record_blit(ds, cb, si, fi, ext) } {
            return None;
        }
        ring.blits_recorded[blit] = true;
    }


    let wait_stages = vec![vk::PipelineStageFlags::TRANSFER; app_waits.len()];
    let subi = vk::SubmitInfo {
        s_type: vk::StructureType::SUBMIT_INFO,
        p_next: std::ptr::null(),
        wait_semaphore_count: app_waits.len() as u32,
        p_wait_semaphores: if app_waits.is_empty() {
            std::ptr::null()
        } else {
            app_waits.as_ptr()
        },
        p_wait_dst_stage_mask: if wait_stages.is_empty() {
            std::ptr::null()
        } else {
            wait_stages.as_ptr()
        },
        command_buffer_count: 1,
        p_command_buffers: &cb,
        signal_semaphore_count: 1,
        p_signal_semaphores: &present_wait,
        _marker: std::marker::PhantomData,
    };

    unsafe {
        if (ds.fp.queue_submit)(queue, 1, &subi, fence) != vk::Result::SUCCESS {
            log::warn!("capture queue_submit failed — frame skipped");
            // The submit never happened, so nothing waited on the application's
            // semaphores and nothing will signal ours. Re-signal the fence by
            // hand so the slot is reusable, and let the caller present as the
            // application intended.
            let _ = (ds.fp.reset_fences)(ds.raw, 1, &fence);
            return None;
        }
    }

    Some(CaptureSubmission {
        slot: guard,
        present_wait,
    })
}

/// Set aside the semaphore a failed present was given.
///
/// A present that returns an error may or may not have waited on it, so it can
/// neither be signalled again nor destroyed while it might still be pending.
/// The next capture for that image index creates a fresh one.
pub fn retire_present_semaphore(ds: &crate::state::DeviceState, image_index: usize) {
    let Ok(mut ring_guard) = ds.capture_ring.lock() else {
        return;
    };
    let Some(ring) = ring_guard.as_mut() else {
        return;
    };
    if let Some(slot) = ring.present_wait.get_mut(image_index) {
        let sem = std::mem::replace(slot, vk::Semaphore::null());
        if sem != vk::Semaphore::null() {
            ring.retired.push(sem);
        }
    }
}

/// Set aside every per-image semaphore, for a swapchain that is going away.
/// Mark every recorded blit as needing re-recording.
///
/// Called when the swapchain is recreated. Each recording names a specific
/// source `VkImage`, and a recreated swapchain's images are new objects even
/// when the indices and the extent are unchanged — so submitting a recording
/// made against the old ones reads destroyed images.
pub fn invalidate_recorded_blits(ds: &crate::state::DeviceState) {
    let Ok(mut ring_guard) = ds.capture_ring.lock() else {
        return;
    };
    if let Some(ring) = ring_guard.as_mut() {
        ring.blits_recorded.iter_mut().for_each(|r| *r = false);
    }
}

pub fn retire_all_present_semaphores(ds: &crate::state::DeviceState) {
    let Ok(mut ring_guard) = ds.capture_ring.lock() else {
        return;
    };
    let Some(ring) = ring_guard.as_mut() else {
        return;
    };
    for sem in std::mem::take(&mut ring.present_wait) {
        if sem != vk::Semaphore::null() {
            ring.retired.push(sem);
        }
    }
}

/// The semaphore for `image_index`, created on first use.
///
/// One per swapchain image rather than one per ring slot: a binary semaphore
/// cannot be signalled again until its previous wait has completed, and the
/// application reacquiring the image is the only evidence of that available
/// from inside the layer.
unsafe fn ensure_present_semaphore(
    ds: &crate::state::DeviceState,
    ring: &mut CaptureRing,
    image_index: usize,
) -> Option<vk::Semaphore> {
    let create = ds.fp.create_semaphore?;
    if ring.present_wait.len() <= image_index {
        ring.present_wait.resize(image_index + 1, vk::Semaphore::null());
    }
    if ring.present_wait[image_index] == vk::Semaphore::null() {
        let ci = vk::SemaphoreCreateInfo {
            s_type: vk::StructureType::SEMAPHORE_CREATE_INFO,
            p_next: std::ptr::null(),
            flags: vk::SemaphoreCreateFlags::empty(),
            _marker: std::marker::PhantomData,
        };
        let mut sem = vk::Semaphore::null();
        if unsafe { create(ds.raw, &ci, std::ptr::null(), &mut sem) } != vk::Result::SUCCESS {
            return None;
        }
        ring.present_wait[image_index] = sem;
    }
    Some(ring.present_wait[image_index])
}

// ── CPU pixel readback (fallback when DMA-BUF unavailable) ───────────────────

pub unsafe fn read_frame_pixels(
    ds: &crate::state::DeviceState,
    image: vk::Image,
    mem: vk::DeviceMemory,
    w: u32,
    h: u32,
) -> Option<Vec<u8>> {
    if w == 0 || h == 0 {
        return None;
    }
    let subresource = vk::ImageSubresource {
        aspect_mask: vk::ImageAspectFlags::COLOR,
        mip_level: 0,
        array_layer: 0,
    };
    let mut layout = vk::SubresourceLayout {
        offset: 0,
        size: 0,
        row_pitch: 0,
        array_pitch: 0,
        depth_pitch: 0,
    };
    unsafe { (ds.fp.get_image_subresource_layout)(ds.raw, image, &subresource, &mut layout) };
    let row_pitch = layout.row_pitch as usize;
    let bpr = w as usize * 4;
    let mut mp: *mut std::os::raw::c_void = std::ptr::null_mut();
    if unsafe {
        (ds.fp.map_memory)(
            ds.raw,
            mem,
            0,
            vk::WHOLE_SIZE,
            vk::MemoryMapFlags::empty(),
            &mut mp,
        ) != vk::Result::SUCCESS
    } {
        return None;
    }
    let mut pixels = vec![0u8; bpr * h as usize];
    let base = mp as *const u8;
    for row in 0..h as usize {
        let src = unsafe { std::slice::from_raw_parts(base.add(row * row_pitch), bpr) };
        pixels[row * bpr..row * bpr + bpr].copy_from_slice(src);
    }
    unsafe { (ds.fp.unmap_memory)(ds.raw, mem) };
    Some(pixels)
}
