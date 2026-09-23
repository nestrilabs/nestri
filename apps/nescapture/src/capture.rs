// ─────────────────────────────────────────────────────────────────────────────
//  capture.rs — Frame capture helpers
//
//  Each ring slot is a destination for the blit out of the presented swapchain
//  image. Where the encoder shares the game's device, a slot is an image on
//  that device which the encoder reads in place, ordered by a timeline
//  semaphore the blit signals. Where it has a device of its own, a slot is a
//  host-visible image the encoder thread reads back on the CPU.
// ─────────────────────────────────────────────────────────────────────────────

use crate::state::{CB_STATE, CAPTURE_SLOTS, CaptureRing, CaptureSlot, DEVICE_STATE};
use ash::vk::{self, Handle};

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

// ── Image allocators ──────────────────────────────────────────────────────────

/// Plain HOST_VISIBLE image, read back on the CPU when the encoder has a
/// device of its own.
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

/// A capture slot on a device the encoder shares: device-local, optimally
/// tiled, and readable by the encoder's queues as well as the presenting one.
///
/// Created in the converter's input format rather than the swapchain's, which
/// differ for an sRGB swapchain: the copy between the two is legal, since they
/// have the same texel size, and the converter then needs no mutable-format
/// view to read it.
unsafe fn allocate_shared_image(
    ds: &crate::state::DeviceState,
    w: u32,
    h: u32,
    fmt: vk::Format,
    families: &[u32],
    label: &str,
) -> Option<(vk::Image, vk::DeviceMemory)> {
    let (sharing_mode, count, indices) = if families.len() > 1 {
        (
            vk::SharingMode::CONCURRENT,
            families.len() as u32,
            families.as_ptr(),
        )
    } else {
        (vk::SharingMode::EXCLUSIVE, 0, std::ptr::null())
    };
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
        tiling: vk::ImageTiling::OPTIMAL,
        // Written by the blit, sampled by the converter, and copied from when
        // the encoder takes RGB input and converts it itself.
        usage: vk::ImageUsageFlags::TRANSFER_DST
            | vk::ImageUsageFlags::SAMPLED
            | vk::ImageUsageFlags::TRANSFER_SRC,
        sharing_mode,
        queue_family_index_count: count,
        p_queue_family_indices: indices,
        initial_layout: vk::ImageLayout::UNDEFINED,
        _marker: std::marker::PhantomData,
    };
    let mut image = vk::Image::null();
    if unsafe { (ds.fp.create_image)(ds.raw, &ci, std::ptr::null(), &mut image) }
        != vk::Result::SUCCESS
    {
        return None;
    }
    let mut mr = vk::MemoryRequirements::default();
    unsafe { (ds.fp.get_image_memory_requirements)(ds.raw, image, &mut mr) };
    let Some(mt) =
        (unsafe { find_memory_type(ds, mr.memory_type_bits, crate::memory::Want::DeviceLocal) })
    else {
        log::warn!("no device-local memory type for '{label}' - not allocating");
        unsafe { (ds.fp.destroy_image)(ds.raw, image, std::ptr::null()) };
        return None;
    };
    let ai = vk::MemoryAllocateInfo {
        s_type: vk::StructureType::MEMORY_ALLOCATE_INFO,
        p_next: std::ptr::null(),
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
    Some((image, mem))
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
/// Whether an existing ring can serve a request, or has to be rebuilt.
///
/// **The extent must match exactly.** This used to accept any ring at least as
/// large as the request, which sounds like a saving and is a corruption: the
/// blit follows the new, smaller extent while the slot image stays the old
/// size, so everything outside the copied region keeps whatever the previous
/// resolution left there. The encoder then sends the whole image, stale margins
/// and all -- a band of the old picture down the right edge and along the
/// bottom. A resolution change is rare enough that rebuilding is the cheaper
/// mistake.
///
/// `image_count` is part of the identity because the blit buffers are allocated
/// one per (image, slot) pair. A swapchain that gained an image needs more of
/// them, and a ring that kept the old count would silently stop capturing
/// whenever that image came round.
fn ring_still_serves(
    existing: (u32, u32, vk::Format),
    existing_family: u32,
    existing_image_count: usize,
    wanted: (u32, u32, vk::Format),
    wanted_family: u32,
    wanted_image_count: usize,
) -> bool {
    existing == wanted
        && existing_family == wanted_family
        && existing_image_count == wanted_image_count
}

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
        //
        if ring_still_serves(
            (ew, eh, ef),
            existing.queue_family,
            existing.image_count,
            (w, h, f),
            queue_family,
            image_count,
        ) {
            return true;
        }
        if !ds.capture_slots.all_free() {
            return false;
        }
        if let Some(old) = ring.take() {
            unsafe { destroy_capture_ring(ds, old) };
        }
    }
    let generation = ds
        .ring_generation
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        + 1;
    match unsafe { create_capture_ring(ds, w, h, f, queue_family, image_count, generation) } {
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
    generation: u64,
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
    for &cb in &blits {
        unsafe { crate::device::stamp(ds, cb.as_raw() as *mut std::ffi::c_void) };
    }

    // Pre-signalled: the first wait on a fresh slot must return immediately.
    let fci = vk::FenceCreateInfo {
        s_type: vk::StructureType::FENCE_CREATE_INFO,
        p_next: std::ptr::null(),
        flags: vk::FenceCreateFlags::SIGNALED,
        _marker: std::marker::PhantomData,
    };

    let (timestamp_pool, timestamp_period) =
        unsafe { create_timestamp_pool(ds, queue_family) };

    // On a device the encoder shares, the slots are images the encoder reads
    // in place, in the format its converter reads, and every blit advances a
    // timeline the encoder waits on.
    let shared = ds.shared_encoder();
    let slot_format = match shared {
        Some(_) => match crate::encode::vk_format_to_input_format(f.as_raw() as u32) {
            Some(input) => input.vk_format(),
            None => {
                log::warn!(
                    "swapchain format {} has no converter input format; not capturing",
                    f.as_raw()
                );
                unsafe { (ds.fp.destroy_command_pool)(ds.raw, command_pool, std::ptr::null()) };
                return None;
            }
        },
        None => f,
    };
    let blit_timeline = match shared {
        Some(s) => match s.create_timeline() {
            Some(t) => t,
            None => {
                log::warn!("could not create the capture timeline; not capturing");
                unsafe { (ds.fp.destroy_command_pool)(ds.raw, command_pool, std::ptr::null()) };
                return None;
            }
        },
        None => vk::Semaphore::null(),
    };

    let mut slots = Vec::with_capacity(CAPTURE_SLOTS);
    for _ in 0..CAPTURE_SLOTS {
        let allocated = match shared {
            Some(s) => unsafe {
                allocate_shared_image(
                    ds,
                    w,
                    h,
                    slot_format,
                    &s.image_families(queue_family),
                    "capture",
                )
            },
            None => unsafe { allocate_host_image(ds, w, h, f, "capture") },
        };
        let Some((image, memory)) = allocated else {
            if let Some(s) = shared {
                s.destroy_timeline(blit_timeline);
            }
            unsafe { destroy_partial_ring(ds, command_pool, slots) };
            return None;
        };
        let mut fence = vk::Fence::null();
        if unsafe { (ds.fp.create_fence)(ds.raw, &fci, std::ptr::null(), &mut fence) }
            != vk::Result::SUCCESS
        {
            unsafe { (ds.fp.destroy_image)(ds.raw, image, std::ptr::null()) };
            unsafe { (ds.fp.free_memory)(ds.raw, memory, std::ptr::null()) };
            if let Some(s) = shared {
                s.destroy_timeline(blit_timeline);
            }
            unsafe { destroy_partial_ring(ds, command_pool, slots) };
            return None;
        }
        slots.push(CaptureSlot {
            image,
            memory,
            fence,
        });
    }

    log::info!(
        "capture ring {generation}: {CAPTURE_SLOTS} slots of {w}x{h} fmt={} on queue family {queue_family}{}",
        slot_format.as_raw(),
        if shared.is_some() {
            ", read in place by the encoder"
        } else {
            ""
        }
    );
    Some(CaptureRing {
        command_pool,
        slots,
        blits,
        blits_recorded: vec![false; blit_count],
        image_count: image_count.max(1),
        timestamp_pool,
        timestamp_period,
        size: (w, h, f),
        generation,
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
        blit_timeline,
        blit_value: 0,
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
    unsafe {
        if !ring.timestamp_pool.is_null()
            && let Some(destroy) = ds.fp.destroy_query_pool
        {
            destroy(ds.raw, ring.timestamp_pool, std::ptr::null());
        }
    }
    // The fences above cover the blits that signal it, and every slot being
    // back covers the encoder work that waits on it: a slot returns only once
    // its conversion has finished.
    if !ring.blit_timeline.is_null()
        && let Some(s) = ds.shared.as_ref()
    {
        s.destroy_timeline(ring.blit_timeline);
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
    /// The point this blit's timeline signal reaches, on a device the encoder
    /// shares. The encoder waits on it on the GPU instead of on the slot's
    /// fence on the CPU.
    pub blit: Option<pixelforge::TimelinePoint>,
}

/// Create the blit timestamp pool, or a null handle where it cannot be used.
///
/// Null is the normal, expected outcome on some hardware — RADV's video-encode
/// family reports `timestampValidBits == 0`, and a graphics family could too —
/// and it costs nothing but the measurement. `vkCmdWriteTimestamp` on a family
/// reporting zero is a validation error
/// (VUID-vkCmdWriteTimestamp-timestampValidBits-00829), so it has to be asked
/// rather than assumed.
unsafe fn create_timestamp_pool(
    ds: &crate::state::DeviceState,
    queue_family: u32,
) -> (vk::QueryPool, f32) {
    let none = (vk::QueryPool::null(), 0.0);

    let (Some(create), Some(_), Some(_), Some(_)) = (
        ds.fp.create_query_pool,
        ds.fp.cmd_reset_query_pool,
        ds.fp.cmd_write_timestamp,
        ds.fp.get_query_pool_results,
    ) else {
        return none;
    };

    let k = unsafe { crate::dispatch_key(ds.physical_device.as_raw() as *const std::ffi::c_void) };
    let Some(istate) = crate::state::INSTANCE_STATE.get(&k) else {
        return none;
    };
    let (Some(get_props), Some(get_families)) = (
        istate.get_physical_device_properties,
        istate.get_physical_device_queue_family_properties,
    ) else {
        return none;
    };

    let mut props = vk::PhysicalDeviceProperties::default();
    unsafe { get_props(ds.physical_device, &mut props) };
    let period = props.limits.timestamp_period;
    if period <= 0.0 {
        return none;
    }

    let mut count = 0u32;
    unsafe { get_families(ds.physical_device, &mut count, std::ptr::null_mut()) };
    let mut families = vec![vk::QueueFamilyProperties::default(); count as usize];
    unsafe { get_families(ds.physical_device, &mut count, families.as_mut_ptr()) };
    match families.get(queue_family as usize) {
        Some(f) if f.timestamp_valid_bits > 0 => {}
        _ => {
            log::info!(
                "queue family {queue_family} reports timestampValidBits=0; \
                 blit GPU timing disabled"
            );
            return none;
        }
    }

    let ci = vk::QueryPoolCreateInfo {
        s_type: vk::StructureType::QUERY_POOL_CREATE_INFO,
        p_next: std::ptr::null(),
        flags: vk::QueryPoolCreateFlags::empty(),
        query_type: vk::QueryType::TIMESTAMP,
        // Two per slot. Per slot and not per (image, slot) pair because only
        // one blit per slot is ever in flight.
        query_count: (CAPTURE_SLOTS * 2) as u32,
        pipeline_statistics: vk::QueryPipelineStatisticFlags::empty(),
        _marker: std::marker::PhantomData,
    };
    let mut pool = vk::QueryPool::null();
    if unsafe { create(ds.raw, &ci, std::ptr::null(), &mut pool) } != vk::Result::SUCCESS {
        log::warn!("blit timestamp pool could not be created; GPU timing disabled");
        return none;
    }
    (pool, period)
}

/// GPU nanoseconds the last blit into `slot` took.
///
/// Call only once that blit has finished, so `wait` returns immediately: after
/// the slot's fence has signalled, or after work that waited on the blit has
/// itself finished. `None` when timing is off, when the driver refuses the
/// results, when they are not there yet and `wait` is false, or when the
/// counter wrapped between the pair.
pub unsafe fn blit_gpu_time_ns(
    ds: &crate::state::DeviceState,
    slot: usize,
    wait: bool,
) -> Option<u64> {
    let ring_guard = ds.capture_ring.lock().ok()?;
    let ring = ring_guard.as_ref()?;
    if ring.timestamp_pool.is_null() {
        return None;
    }
    let get = ds.fp.get_query_pool_results?;
    let mut ticks = [0u64; 2];
    let result = unsafe {
        get(
            ds.raw,
            ring.timestamp_pool,
            (slot * 2) as u32,
            2,
            std::mem::size_of_val(&ticks),
            ticks.as_mut_ptr() as *mut std::ffi::c_void,
            std::mem::size_of::<u64>() as vk::DeviceSize,
            if wait {
                vk::QueryResultFlags::WAIT | vk::QueryResultFlags::TYPE_64
            } else {
                vk::QueryResultFlags::TYPE_64
            },
        )
    };
    if result != vk::Result::SUCCESS {
        return None;
    }
    let elapsed = ticks[1].checked_sub(ticks[0])?;
    Some((elapsed as f64 * f64::from(ring.timestamp_period)) as u64)
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
    timestamp_pool: vk::QueryPool,
    slot_index: usize,
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

    // Bracket the barriers as well as the copy: the layout transitions on the
    // swapchain image are part of what this costs the GPU, and the first of
    // them is a full flush. Recorded once with the rest of the buffer; the
    // reset runs on every submission, which is what makes the pair reusable.
    let timed = !timestamp_pool.is_null()
        && ds.fp.cmd_reset_query_pool.is_some()
        && ds.fp.cmd_write_timestamp.is_some();
    if timed {
        let first = (slot_index * 2) as u32;
        unsafe {
            (ds.fp.cmd_reset_query_pool.unwrap())(cb, timestamp_pool, first, 2);
            (ds.fp.cmd_write_timestamp.unwrap())(
                cb,
                vk::PipelineStageFlags::TOP_OF_PIPE,
                timestamp_pool,
                first,
            );
        }
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
    // The slot goes to GENERAL, which every reader accepts: the converter, the
    // encoder's own copy when it takes RGB input, and the CPU readback, which
    // maps the memory and may only do so in GENERAL.
    let b4 = image_barrier!(
        vk::AccessFlags::TRANSFER_WRITE,
        vk::AccessFlags::MEMORY_READ | vk::AccessFlags::HOST_READ,
        vk::ImageLayout::TRANSFER_DST_OPTIMAL,
        vk::ImageLayout::GENERAL,
        fi
    );
    let after = [b3, b4];
    unsafe {
        (ds.fp.cmd_pipeline_barrier)(
            cb,
            vk::PipelineStageFlags::TRANSFER,
            vk::PipelineStageFlags::BOTTOM_OF_PIPE | vk::PipelineStageFlags::HOST,
            vk::DependencyFlags::empty(),
            0,
            std::ptr::null(),
            0,
            std::ptr::null(),
            after.len() as u32,
            after.as_ptr(),
        );
    }

    if timed {
        unsafe {
            (ds.fp.cmd_write_timestamp.unwrap())(
                cb,
                vk::PipelineStageFlags::BOTTOM_OF_PIPE,
                timestamp_pool,
                (slot_index * 2 + 1) as u32,
            );
        }
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
    // extent. A swapchain recreated at the same extent keeps the ring but
    // replaces the source images, so invalidate here rather than trusting every
    // caller to have noticed.
    if ring.blit_extent != ext {
        ring.blits_recorded.iter_mut().for_each(|r| *r = false);
        ring.blit_extent = ext;
    }
    let blit = crate::state::blit_index(image_index, slot_index, ring.image_count)?;
    let cb = *ring.blits.get(blit)?;
    if !ring.blits_recorded[blit] {
        let pool = ring.timestamp_pool;
        if !unsafe { record_blit(ds, cb, si, fi, ext, pool, slot_index) } {
            return None;
        }
        ring.blits_recorded[blit] = true;
    }

    let wait_stages = vec![vk::PipelineStageFlags::TRANSFER; app_waits.len()];

    // On a shared device the blit also advances the ring's timeline. A
    // timeline signal needs its value given alongside, and the binary
    // semaphore next to it a placeholder the driver ignores.
    let blit_point = (!ring.blit_timeline.is_null()).then(|| {
        pixelforge::TimelinePoint::new(ring.blit_timeline, ring.blit_value + 1)
    });
    let signals = [present_wait, ring.blit_timeline];
    let signal_values = [0, blit_point.map_or(0, |p| p.value)];
    let timeline_info = vk::TimelineSemaphoreSubmitInfo {
        signal_semaphore_value_count: 2,
        p_signal_semaphore_values: signal_values.as_ptr(),
        ..Default::default()
    };
    let subi = vk::SubmitInfo {
        s_type: vk::StructureType::SUBMIT_INFO,
        p_next: if blit_point.is_some() {
            (&raw const timeline_info).cast()
        } else {
            std::ptr::null()
        },
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
        signal_semaphore_count: if blit_point.is_some() { 2 } else { 1 },
        p_signal_semaphores: signals.as_ptr(),
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

    if let Some(p) = blit_point {
        ring.blit_value = p.value;
    }

    Some(CaptureSubmission {
        slot: guard,
        present_wait,
        blit: blit_point,
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

// ── CPU pixel readback (when the encoder has a device of its own) ───────────

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

#[cfg(test)]
mod ring_identity_tests {
    use super::ring_still_serves;
    use ash::vk;

    const FMT: vk::Format = vk::Format::B8G8R8A8_UNORM;
    const OTHER: vk::Format = vk::Format::R8G8B8A8_UNORM;

    fn serves(existing: (u32, u32, vk::Format), wanted: (u32, u32, vk::Format)) -> bool {
        ring_still_serves(existing, 0, 3, wanted, 0, 3)
    }

    #[test]
    fn an_identical_request_reuses_the_ring() {
        assert!(serves((1920, 1080, FMT), (1920, 1080, FMT)));
    }

    #[test]
    fn a_smaller_request_rebuilds() {
        // The regression this guards. A ring that is merely large enough leaves
        // the area outside the new extent holding the old resolution's picture,
        // and the encoder sends it.
        assert!(!serves((1920, 1080, FMT), (1280, 720, FMT)));
        assert!(!serves((1920, 1080, FMT), (1920, 720, FMT)));
        assert!(!serves((1920, 1080, FMT), (1280, 1080, FMT)));
    }

    #[test]
    fn a_larger_request_rebuilds() {
        assert!(!serves((1280, 720, FMT), (1920, 1080, FMT)));
    }

    #[test]
    fn a_different_format_rebuilds() {
        assert!(!serves((1920, 1080, FMT), (1920, 1080, OTHER)));
    }

    #[test]
    fn a_different_queue_family_or_image_count_rebuilds() {
        let g = (1920, 1080, FMT);
        assert!(!ring_still_serves(g, 0, 3, g, 1, 3));
        assert!(!ring_still_serves(g, 0, 3, g, 0, 4));
    }
}
