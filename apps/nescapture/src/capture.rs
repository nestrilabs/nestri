// ─────────────────────────────────────────────────────────────────────────────
//  capture.rs — Frame capture helpers
//
//  final_image is allocated with VK_EXTERNAL_MEMORY_HANDLE_TYPE_DMA_BUF_BIT_EXT
//  so that after the GPU blit we can export an fd and import it into pixelforge's
//  separate VkDevice for zero-copy hardware encoding via DmaBufImporter.
//
//  After ensure_final_image allocates (or re-allocates) the image, we query
//  its SubresourceLayout and cache the row stride in DeviceState::final_stride.
//  The stride is needed by the encoder to correctly import the LINEAR image.
// ─────────────────────────────────────────────────────────────────────────────

use crate::state::{CB_STATE, CaptureResources, DEVICE_STATE};
use ash::vk::{self, Handle};
use std::os::raw::c_int;
use std::sync::atomic::Ordering;

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

unsafe fn find_host_coherent_mt(ds: &crate::state::DeviceState, bits: u32) -> u32 {
    let mut mp = vk::PhysicalDeviceMemoryProperties::default();
    let k = unsafe { crate::dispatch_key(ds.physical_device.as_raw() as *const std::ffi::c_void) };
    if let Some(i) = crate::state::INSTANCE_STATE.get(&k) {
        unsafe { (i.get_physical_device_memory_properties)(ds.physical_device, &mut mp) };
    }
    (0..mp.memory_type_count)
        .find(|&i| {
            (bits & (1 << i)) != 0
                && mp.memory_types[i as usize].property_flags.contains(
                    vk::MemoryPropertyFlags::HOST_VISIBLE | vk::MemoryPropertyFlags::HOST_COHERENT,
                )
        })
        .unwrap_or(0)
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
) -> Option<(vk::Image, vk::DeviceMemory)> {
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
    let export_ai = vk::ExportMemoryAllocateInfo {
        s_type: vk::StructureType::EXPORT_MEMORY_ALLOCATE_INFO,
        p_next: std::ptr::null_mut(),
        handle_types: vk::ExternalMemoryHandleTypeFlags::DMA_BUF_EXT,
        _marker: std::marker::PhantomData,
    };
    if let Some(r) = unsafe { alloc_image(ds, &ci, Some(&export_ai), label) } {
        return Some(r);
    }
    log::warn!(
        "DMA-BUF alloc failed for '{}' — using plain host image. \
         Zero-copy GPU path will be unavailable; CPU readback fallback active.",
        label
    );
    unsafe { allocate_host_image(ds, w, h, fmt, label) }
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
    let mt = unsafe { find_host_coherent_mt(ds, mr.memory_type_bits) };
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

/// Query and cache the row stride of final_image.
/// Returns stride in bytes; 0 on failure.
pub unsafe fn query_and_cache_final_stride(
    ds: &crate::state::DeviceState,
    image: vk::Image,
) -> u32 {
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
    let stride = layout.row_pitch as u32;
    ds.final_stride.store(stride, Ordering::Relaxed);
    stride
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

pub unsafe fn ensure_final_image(ds: &crate::state::DeviceState, w: u32, h: u32, f: vk::Format) {
    let mut ig = ds.final_image.lock().unwrap();
    let mut mg = ds.final_memory.lock().unwrap();
    let mut sg = ds.final_size.lock().unwrap();
    if let (Some(i), Some(m)) = (*ig, *mg) {
        let (ew, eh, ef) = *sg;
        if ew >= w && eh >= h && ef == f {
            return;
        }
        unsafe { (ds.fp.destroy_image)(ds.raw, i, std::ptr::null()) };
        unsafe { (ds.fp.free_memory)(ds.raw, m, std::ptr::null()) };
        *ig = None;
        *mg = None;
        ds.final_stride.store(0, Ordering::Relaxed);
    }
    if let Some((i, m)) = unsafe { allocate_dmabuf_image(ds, w, h, f, "final") } {
        // Query stride immediately after allocation so it's available on first frame.
        unsafe { query_and_cache_final_stride(ds, i) };
        *ig = Some(i);
        *mg = Some(m);
        *sg = (w, h, f);
    }
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

// ── Final frame GPU blit (swapchain → final_image) ────────────────────────────

pub unsafe fn capture_final_frame(
    ds: &crate::state::DeviceState,
    queue: vk::Queue,
    si: vk::Image,
    fmt: vk::Format,
    ext: vk::Extent2D,
    _frame: u64,
) {
    if ext.width == 0 || ext.height == 0 {
        return;
    }
    unsafe { ensure_final_image(ds, ext.width, ext.height, fmt) };
    let fi = match *ds.final_image.lock().unwrap() {
        Some(i) => i,
        None => return,
    };

    // ── Lazy-init reusable capture resources ──────────────────────
    let mut res_guard = ds.capture_resources.lock().unwrap();
    let res = match res_guard.as_mut() {
        Some(r) => r,
        None => match unsafe { create_capture_resources(ds) } {
            Some(r) => {
                *res_guard = Some(r);
                res_guard.as_mut().unwrap()
            }
            None => return,
        },
    };

    let idx = res.current;
    let cb = res.command_buffers[idx];
    let fence = res.fences[idx];

    // Wait for THIS slot's previous use to finish (not the other slot).
    // Use a short timeout — if the GPU is busy with game rendering, skip
    // this capture instead of stalling the game's render loop.
    unsafe {
        let result = (ds.fp.wait_for_fences)(ds.raw, 1, &fence, vk::TRUE, 1_000_000); // 1ms timeout
        if result != vk::Result::SUCCESS {
            // GPU not ready — skip this capture, try next slot
            res.current = (idx + 1) % 4;
            return;
        }
        let _ = (ds.fp.reset_fences)(ds.raw, 1, &fence);
    }

    // Reset and re-record
    unsafe {
        let _ = (ds.fp.reset_command_buffer)(cb, vk::CommandBufferResetFlags::empty());
    }

    let bi = vk::CommandBufferBeginInfo {
        s_type: vk::StructureType::COMMAND_BUFFER_BEGIN_INFO,
        p_next: std::ptr::null(),
        flags: vk::CommandBufferUsageFlags::ONE_TIME_SUBMIT,
        p_inheritance_info: std::ptr::null(),
        _marker: std::marker::PhantomData,
    };
    if unsafe { (ds.fp.begin_command_buffer)(cb, &bi) } != vk::Result::SUCCESS {
        return;
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
            vk::PipelineStageFlags::TOP_OF_PIPE,
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
        return;
    }

    let subi = vk::SubmitInfo {
        s_type: vk::StructureType::SUBMIT_INFO,
        p_next: std::ptr::null(),
        wait_semaphore_count: 0,
        p_wait_semaphores: std::ptr::null(),
        p_wait_dst_stage_mask: std::ptr::null(),
        command_buffer_count: 1,
        p_command_buffers: &cb,
        signal_semaphore_count: 0,
        p_signal_semaphores: std::ptr::null(),
        _marker: std::marker::PhantomData,
    };

    unsafe {
        if (ds.fp.queue_submit)(queue, 1, &subi, fence) != vk::Result::SUCCESS {
            log::warn!("capture queue_submit failed — frame skipped");
            let _ = (ds.fp.reset_fences)(ds.raw, 1, &fence);
            return;
        }
    }

    // Toggle to the next slot
    res.current = (idx + 1) % 4;
}

unsafe fn create_capture_resources(ds: &crate::state::DeviceState) -> Option<CaptureResources> {
    let pci = vk::CommandPoolCreateInfo {
        s_type: vk::StructureType::COMMAND_POOL_CREATE_INFO,
        p_next: std::ptr::null(),
        flags: vk::CommandPoolCreateFlags::RESET_COMMAND_BUFFER, // allow per-cb reset
        queue_family_index: 0,
        _marker: std::marker::PhantomData,
    };
    let mut cp = vk::CommandPool::null();
    if unsafe { (ds.fp.create_command_pool)(ds.raw, &pci, std::ptr::null(), &mut cp) }
        != vk::Result::SUCCESS
    {
        return None;
    }

    let ai = vk::CommandBufferAllocateInfo {
        s_type: vk::StructureType::COMMAND_BUFFER_ALLOCATE_INFO,
        p_next: std::ptr::null(),
        command_pool: cp,
        level: vk::CommandBufferLevel::PRIMARY,
        command_buffer_count: 4,
        _marker: std::marker::PhantomData,
    };
    let mut cbs = [vk::CommandBuffer::null(); 4];
    if unsafe { (ds.fp.allocate_command_buffers)(ds.raw, &ai, cbs.as_mut_ptr()) }
        != vk::Result::SUCCESS
    {
        unsafe { (ds.fp.destroy_command_pool)(ds.raw, cp, std::ptr::null()) };
        return None;
    }

    // Create fences PRE-SIGNALED so the first wait_for_fences returns immediately
    let fci = vk::FenceCreateInfo {
        s_type: vk::StructureType::FENCE_CREATE_INFO,
        p_next: std::ptr::null(),
        flags: vk::FenceCreateFlags::SIGNALED,
        _marker: std::marker::PhantomData,
    };
    let mut fences = [vk::Fence::null(); 4];
    for f in &mut fences {
        if unsafe { (ds.fp.create_fence)(ds.raw, &fci, std::ptr::null(), f) } != vk::Result::SUCCESS
        {
            unsafe { (ds.fp.destroy_command_pool)(ds.raw, cp, std::ptr::null()) };
            return None;
        }
    }

    Some(CaptureResources {
        command_pool: cp,
        command_buffers: cbs,
        fences,
        current: 0,
    })
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
