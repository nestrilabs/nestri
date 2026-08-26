// ─────────────────────────────────────────────────────────────────────────────
//  device.rs — vkCreateDevice, vkDestroyDevice, vkGetDeviceQueue
// ─────────────────────────────────────────────────────────────────────────────

use crate::config;
use crate::dispatch::{NextDeviceFn, PFN_vkCreateDevice, PFN_vkGetInstanceProcAddr};
use crate::state::{DEVICE_STATE, DeviceState, INSTANCE_STATE, QUEUE_TO_DEVICE_KEY};
use crate::{
    VkLayerDeviceCreateInfo, dispatch_key, find_layer_link, load_device_fn, try_load_device_fn,
};
use ash::vk::{self, Handle};
use dashmap::DashMap;
use std::os::raw::c_void;
use std::sync::Arc;
use std::sync::atomic::Ordering;

const VK_LAYER_LINK_INFO: u32 = 0;

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkCreateDevice(
    physical_device: vk::PhysicalDevice,
    p_create_info: *const vk::DeviceCreateInfo,
    p_allocator: *const vk::AllocationCallbacks,
    p_device: *mut vk::Device,
) -> vk::Result {
    let layer_info: *mut VkLayerDeviceCreateInfo = match unsafe {
        find_layer_link((*p_create_info).p_next as *const c_void, VK_LAYER_LINK_INFO)
    } {
        Some(p) => p,
        None => return vk::Result::ERROR_INITIALIZATION_FAILED,
    };

    let dev_link = unsafe { (*layer_info).u.pDeviceLayerInfo };
    let next_gipa: PFN_vkGetInstanceProcAddr =
        match unsafe { (*dev_link).pfnNextGetInstanceProcAddr } {
            Some(f) => f,
            None => return vk::Result::ERROR_INITIALIZATION_FAILED,
        };
    let next_gdpa = unsafe {
        match (*dev_link).pfnNextGetDeviceProcAddr {
            Some(f) => f,
            None => return vk::Result::ERROR_INITIALIZATION_FAILED,
        }
    };
    unsafe { (*layer_info).u.pDeviceLayerInfo = (*dev_link).pNext };

    let inst_key = unsafe { dispatch_key(physical_device.as_raw() as *const c_void) };
    let istate = match INSTANCE_STATE.get(&inst_key) {
        Some(s) => s.clone(),
        None => {
            let next_create: PFN_vkCreateDevice = unsafe {
                crate::load_instance_fn(next_gipa, vk::Instance::null(), b"vkCreateDevice\0")
            };
            return unsafe { next_create(physical_device, p_create_info, p_allocator, p_device) };
        }
    };

    // ── Inject DMA-BUF extensions for zero-copy capture ──────────────────
    let ci = unsafe { &*p_create_info };

    // Collect the game's original extensions.
    let original_extensions: Vec<*const libc::c_char> =
        if ci.enabled_extension_count > 0 && !ci.pp_enabled_extension_names.is_null() {
            unsafe {
                std::slice::from_raw_parts(
                    ci.pp_enabled_extension_names,
                    ci.enabled_extension_count as usize,
                )
            }
            .to_vec()
        } else {
            Vec::new()
        };

    // Extensions we need — static byte strings so pointers stay valid.
    const EXT_EXTERNAL_MEMORY: &[u8] = b"VK_KHR_external_memory\0";
    const EXT_EXTERNAL_MEMORY_FD: &[u8] = b"VK_KHR_external_memory_fd\0";
    const EXT_EXTERNAL_MEMORY_DMABUF: &[u8] = b"VK_EXT_external_memory_dma_buf\0";

    let needed: &[&[u8]] = &[
        EXT_EXTERNAL_MEMORY,
        EXT_EXTERNAL_MEMORY_FD,
        EXT_EXTERNAL_MEMORY_DMABUF,
    ];

    // Build extended list: original + any of ours not already present.
    let mut extended = original_extensions.clone();
    for &ext in needed {
        let name_cstr = unsafe { std::ffi::CStr::from_bytes_with_nul_unchecked(ext) };
        let already = extended
            .iter()
            .any(|&ptr| unsafe { std::ffi::CStr::from_ptr(ptr) == name_cstr });
        if !already {
            extended.push(ext.as_ptr() as *const libc::c_char);
        }
    }

    // ── Bump queue count for dedicated capture queue ──────────────────
    // Add one extra queue to the first queue family so capture
    // submissions don't compete with game rendering.
    let mut capture_queue_index = 0u32;
    let queue_infos: Vec<vk::DeviceQueueCreateInfo> = if ci.queue_create_info_count > 0
        && !ci.p_queue_create_infos.is_null()
    {
        let slice = unsafe {
            std::slice::from_raw_parts(ci.p_queue_create_infos, ci.queue_create_info_count as usize)
        };
        let mut qis = slice.to_vec();
        if let Some(first) = qis.first_mut() {
            capture_queue_index = first.queue_count; // use the NEXT index
            first.queue_count += 1;
        }
        qis
    } else {
        Vec::new()
    };

    // Try with injected extensions first.
    let mut modified_ci = *ci;
    modified_ci.enabled_extension_count = extended.len() as u32;
    modified_ci.pp_enabled_extension_names = extended.as_ptr();
    modified_ci.queue_create_info_count = queue_infos.len() as u32;
    modified_ci.p_queue_create_infos = queue_infos.as_ptr();

    let mut dmabuf_available = true;
    let result =
        unsafe { (istate.create_device)(physical_device, &modified_ci, p_allocator, p_device) };

    let result = if result != vk::Result::SUCCESS {
        // Driver rejected our extensions — retry with original create info.
        log::warn!(
            "vkCreateDevice with DMA-BUF extensions failed ({:?}), \
             retrying without — CPU readback fallback will be used",
            result
        );
        dmabuf_available = false;
        unsafe { (istate.create_device)(physical_device, p_create_info, p_allocator, p_device) }
    } else {
        log::info!("DMA-BUF extensions injected successfully");
        result
    };
    if result != vk::Result::SUCCESS {
        return result;
    }

    if !dmabuf_available {
        log::warn!("DMA-BUF extensions missing — will use CPU readback fallback (expensive!)");
    }

    let device = unsafe { *p_device };

    // Cache physical device memory properties
    let mut mem_props = vk::PhysicalDeviceMemoryProperties::default();
    unsafe { (istate.get_physical_device_memory_properties)(physical_device, &mut mem_props) };

    macro_rules! load {
        ($name:literal) => {
            unsafe { load_device_fn(next_gdpa, device, $name) }
        };
    }
    macro_rules! try_load {
        ($name:literal) => {
            unsafe { try_load_device_fn(next_gdpa, device, $name) }
        };
    }

    let fp = NextDeviceFn {
        // Infrastructure
        get_device_proc_addr: next_gdpa,
        destroy_device: load!(b"vkDestroyDevice\0"),
        get_device_queue: load!(b"vkGetDeviceQueue\0"),
        queue_present_khr: try_load!(b"vkQueuePresentKHR\0"),

        // Phase 1
        create_shader_module: load!(b"vkCreateShaderModule\0"),
        destroy_shader_module: load!(b"vkDestroyShaderModule\0"),
        create_graphics_pipelines: load!(b"vkCreateGraphicsPipelines\0"),
        destroy_pipeline: load!(b"vkDestroyPipeline\0"),

        // Phase 2
        create_image_view: load!(b"vkCreateImageView\0"),
        destroy_image_view: load!(b"vkDestroyImageView\0"),
        create_framebuffer: load!(b"vkCreateFramebuffer\0"),
        destroy_framebuffer: load!(b"vkDestroyFramebuffer\0"),
        allocate_command_buffers: load!(b"vkAllocateCommandBuffers\0"),
        free_command_buffers: load!(b"vkFreeCommandBuffers\0"),
        cmd_bind_pipeline: load!(b"vkCmdBindPipeline\0"),
        cmd_begin_render_pass: load!(b"vkCmdBeginRenderPass\0"),
        cmd_end_render_pass: load!(b"vkCmdEndRenderPass\0"),
        cmd_begin_rendering_khr: try_load!(b"vkCmdBeginRenderingKHR\0"),
        cmd_end_rendering_khr: try_load!(b"vkCmdEndRenderingKHR\0"),

        // Phase 4 — capture images
        create_image: load!(b"vkCreateImage\0"),
        destroy_image: load!(b"vkDestroyImage\0"),
        allocate_memory: load!(b"vkAllocateMemory\0"),
        free_memory: load!(b"vkFreeMemory\0"),
        bind_image_memory: load!(b"vkBindImageMemory\0"),
        get_image_memory_requirements: load!(b"vkGetImageMemoryRequirements\0"),
        map_memory: load!(b"vkMapMemory\0"),
        unmap_memory: load!(b"vkUnmapMemory\0"),
        cmd_pipeline_barrier: load!(b"vkCmdPipelineBarrier\0"),
        cmd_copy_image: load!(b"vkCmdCopyImage\0"),
        get_image_subresource_layout: load!(b"vkGetImageSubresourceLayout\0"),
        get_memory_fd_khr: try_load!(b"vkGetMemoryFdKHR\0"),

        // Phase 4 — synchronisation
        create_fence: load!(b"vkCreateFence\0"),
        destroy_fence: load!(b"vkDestroyFence\0"),
        create_command_pool: load!(b"vkCreateCommandPool\0"),
        destroy_command_pool: load!(b"vkDestroyCommandPool\0"),
        reset_command_pool: load!(b"vkResetCommandPool\0"),
        begin_command_buffer: load!(b"vkBeginCommandBuffer\0"),
        end_command_buffer: load!(b"vkEndCommandBuffer\0"),
        reset_command_buffer: load!(b"vkResetCommandBuffer\0"), // needed for double-buffered capture
        queue_submit: load!(b"vkQueueSubmit\0"),
        wait_for_fences: load!(b"vkWaitForFences\0"),
        reset_fences: load!(b"vkResetFences\0"),

        // Phase 4 — swapchain
        create_swapchain_khr: try_load!(b"vkCreateSwapchainKHR\0"),
        destroy_swapchain_khr: try_load!(b"vkDestroySwapchainKHR\0"),
        get_swapchain_images_khr: try_load!(b"vkGetSwapchainImagesKHR\0"),

        // Phase 6 — draw commands
        cmd_draw: load!(b"vkCmdDraw\0"),
        cmd_draw_indexed: load!(b"vkCmdDrawIndexed\0"),
        cmd_draw_indirect: load!(b"vkCmdDrawIndirect\0"),
        cmd_draw_indexed_indirect: load!(b"vkCmdDrawIndexedIndirect\0"),
        cmd_draw_indirect_count: try_load!(b"vkCmdDrawIndirectCount\0"),
        cmd_draw_indexed_indirect_count: try_load!(b"vkCmdDrawIndexedIndirectCount\0"),
    };

    // ── Retrieve capture queue from the bumped slot ───────────────────
    let mut capture_queue = vk::Queue::null();
    if queue_infos
        .first()
        .map(|q| q.queue_count > 1)
        .unwrap_or(false)
    {
        let qi = &queue_infos[0];
        unsafe {
            (fp.get_device_queue)(
                device,
                qi.queue_family_index,
                capture_queue_index,
                &mut capture_queue,
            );
        }
        log::info!(
            "capture queue: family={} index={capture_queue_index}",
            qi.queue_family_index
        );
    }

    let key = unsafe { dispatch_key(device.as_raw() as *const c_void) };

    // Phase 3: load shader hash config
    let shader_hashes = config::resolve_config_path()
        .as_ref()
        .and_then(|p| config::load_config(p));

    if let Some(ref set) = shader_hashes {
        log::info!(
            "config loaded — {} hud_frag, {} hud_vert, {} skip_frag",
            set.hud_fragment_shaders.len(),
            set.hud_vertex_shaders.len(),
            set.skip_fragment_shaders.len(),
        );
    } else {
        log::warn!("no config — draw suppression disabled");
    }

    let dev_state = Arc::new(DeviceState {
        raw: device,
        physical_device,
        fp,

        shader_registry: DashMap::new(),
        pipeline_registry: DashMap::new(),
        pipeline_state: DashMap::new(),

        view_to_image: DashMap::new(),
        view_format: DashMap::new(),
        framebuffer_to_views: DashMap::new(),
        framebuffer_extent: DashMap::new(),

        shader_hashes,

        hudless_image: std::sync::Mutex::new(None),
        hudless_memory: std::sync::Mutex::new(None),
        hudless_size: std::sync::Mutex::new((0, 0, vk::Format::UNDEFINED)),
        final_image: std::sync::Mutex::new(None),
        final_memory: std::sync::Mutex::new(None),
        final_size: std::sync::Mutex::new((0, 0, vk::Format::UNDEFINED)),
        final_stride: std::sync::atomic::AtomicU32::new(0),
        swapchain: std::sync::Mutex::new(None),
        swapchain_images: std::sync::Mutex::new(Vec::new()),
        swapchain_format: std::sync::Mutex::new(vk::Format::UNDEFINED),
        swapchain_extent: std::sync::Mutex::new(vk::Extent2D {
            width: 0,
            height: 0,
        }),
        swapchain_colorspace: std::sync::atomic::AtomicU32::new(0),
        frame_counter: std::sync::atomic::AtomicU64::new(0),
        largest_extent: std::sync::Mutex::new(vk::Extent2D {
            width: 0,
            height: 0,
        }),

        hud_detected_frame: std::sync::atomic::AtomicBool::new(false),
        pending_capture_frame: std::sync::atomic::AtomicBool::new(false),
        capture_injected_frame: std::sync::atomic::AtomicBool::new(false),
        skipped_draws_frame: std::sync::atomic::AtomicU32::new(0),

        encoder: std::sync::Mutex::new(None),

        capture_resources: std::sync::Mutex::new(None),
        capture_queue: std::sync::Mutex::new(capture_queue),
        fake_images: std::sync::Mutex::new(Vec::new()),
        fake_memories: std::sync::Mutex::new(Vec::new()),
        fake_fds: std::sync::Mutex::new(Vec::new()),
        fake_strides: std::sync::Mutex::new(Vec::new()),
        fake_available: std::sync::Mutex::new(Vec::new()),
        fake_image_count: std::sync::atomic::AtomicU32::new(0),
        fake_swapchain: std::sync::Mutex::new(None),
        signal_queue: std::sync::Mutex::new(vk::Queue::null()),
        next_acquire: std::sync::atomic::AtomicU32::new(0),
        memory_properties: std::sync::Mutex::new(mem_props),
        acquire_dummy_pool: std::sync::Mutex::new(vk::CommandPool::null()),
        acquire_dummy_cb: std::sync::Mutex::new(vk::CommandBuffer::null()),
        cached_dmabuf_fd: std::sync::atomic::AtomicI32::new(-1),

        target_fps: std::sync::atomic::AtomicU32::new(0),
        last_capture_time: std::sync::Mutex::new(None),
        capture_tx: std::sync::Mutex::new(None),
    });

    DEVICE_STATE.insert(key, dev_state);

    log::info!("vkCreateDevice OK — key {:#x}", key);
    vk::Result::SUCCESS
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkDestroyDevice(
    device: vk::Device,
    p_allocator: *const vk::AllocationCallbacks,
) {
    let key = unsafe { dispatch_key(device.as_raw() as *const c_void) };
    let ds = match DEVICE_STATE.remove(&key) {
        Some((_, ds)) => ds,
        None => return,
    };

    log::info!(
        "vkDestroyDevice — {} shaders, {} pipelines evicted",
        ds.shader_registry.len(),
        ds.pipeline_registry.len(),
    );

    // ── 1. Shut down encoder pipeline (unblocks encoder + RTP threads) ───
    {
        let mut enc_guard = ds.encoder.lock().unwrap();
        if let Some(handle) = enc_guard.take() {
            handle.shutdown();
            // `handle` is dropped here → drops `frame_tx` → encoder thread's
            // recv_timeout returns Disconnected → encoder thread drops
            // `encoded_tx` → RTP thread exits too.
            //
            // Give threads a moment to drain.  In production you'd join the
            // JoinHandles, but since we don't store them, a short sleep +
            // the AtomicBool shutdown flag is sufficient.
            log::info!("encoder pipeline shutdown signaled");
        }
    }
    // Brief yield to let threads notice the disconnect.
    std::thread::sleep(std::time::Duration::from_millis(50));

    // ── 2. Clean up capture resources (double-buffered cmd pool + fences) ─
    {
        let mut res_guard = ds.capture_resources.lock().unwrap();
        if let Some(res) = res_guard.take() {
            unsafe {
                // Wait for any in-flight capture commands to finish before
                // destroying the fences / command pool.
                let _ = (ds.fp.wait_for_fences)(
                    ds.raw,
                    res.fences.len() as u32,
                    res.fences.as_ptr(),
                    vk::TRUE,
                    5_000_000_000, // 5 seconds — should be instant
                );
                for &f in &res.fences {
                    (ds.fp.destroy_fence)(ds.raw, f, std::ptr::null());
                }
                (ds.fp.destroy_command_pool)(ds.raw, res.command_pool, std::ptr::null());
            }
            log::debug!("capture resources destroyed");
        }
    }

    // ── 3. Free final_image / final_memory ────────────────────────────────
    {
        let img = ds.final_image.lock().unwrap().take();
        let mem = ds.final_memory.lock().unwrap().take();
        if let Some(i) = img {
            unsafe { (ds.fp.destroy_image)(ds.raw, i, std::ptr::null()) };
        }
        if let Some(m) = mem {
            unsafe { (ds.fp.free_memory)(ds.raw, m, std::ptr::null()) };
        }
    }

    // ── 4. Free hudless_image / hudless_memory ────────────────────────────
    {
        let img = ds.hudless_image.lock().unwrap().take();
        let mem = ds.hudless_memory.lock().unwrap().take();
        if let Some(i) = img {
            unsafe { (ds.fp.destroy_image)(ds.raw, i, std::ptr::null()) };
        }
        if let Some(m) = mem {
            unsafe { (ds.fp.free_memory)(ds.raw, m, std::ptr::null()) };
        }
    }

    // ── 5. Close cached DMA-BUF fd ────────────────────────────────────────
    {
        let fd = ds.cached_dmabuf_fd.load(Ordering::Relaxed);
        if fd >= 0 {
            unsafe { libc::close(fd) };
            log::debug!("cached DMA-BUF fd {} closed", fd);
        }
    }

    // ── 6. Clean up queue → device key mappings for this device ───────────
    QUEUE_TO_DEVICE_KEY.retain(|_, dk| *dk != key);

    // ── 7. Call the real vkDestroyDevice ──────────────────────────────────
    unsafe { (ds.fp.destroy_device)(device, p_allocator) };

    log::info!("vkDestroyDevice complete");
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkGetDeviceQueue(
    device: vk::Device,
    queue_family_index: u32,
    queue_index: u32,
    p_queue: *mut vk::Queue,
) {
    let key = unsafe { dispatch_key(device.as_raw() as *const c_void) };
    if let Some(ds) = DEVICE_STATE.get(&key) {
        unsafe { (ds.fp.get_device_queue)(device, queue_family_index, queue_index, p_queue) };
        let queue = unsafe { *p_queue };
        QUEUE_TO_DEVICE_KEY.insert(queue.as_raw(), key);
        // Store first queue for acquire semaphore signaling
        let mut sq = ds.signal_queue.lock().unwrap();
        if *sq == vk::Queue::null() {
            *sq = queue;
        }
    }
}

/// Enumerate device extensions supported by the physical device.
unsafe fn enumerate_device_extensions(
    istate: &crate::dispatch::NextInstanceFn,
    physical_device: vk::PhysicalDevice,
) -> Vec<std::ffi::CString> {
    // We need vkEnumerateDeviceExtensionProperties.  Load it from the
    // instance dispatch since it's a physical-device-level function.
    // For simplicity, use ash's raw function signature.
    type PFN_vkEnumerateDeviceExtensionProperties = unsafe extern "system" fn(
        vk::PhysicalDevice,
        *const libc::c_char,
        *mut u32,
        *mut vk::ExtensionProperties,
    ) -> vk::Result;

    let func: Option<PFN_vkEnumerateDeviceExtensionProperties> = {
        let raw = unsafe {
            (istate.get_instance_proc_addr)(
                vk::Instance::null(),
                b"vkEnumerateDeviceExtensionProperties\0".as_ptr() as *const libc::c_char,
            )
        };
        raw.map(|f| unsafe { std::mem::transmute(f) })
    };

    let Some(enumerate) = func else {
        log::warn!("could not load vkEnumerateDeviceExtensionProperties");
        return Vec::new();
    };

    let mut count = 0u32;
    if unsafe {
        enumerate(
            physical_device,
            std::ptr::null(),
            &mut count,
            std::ptr::null_mut(),
        )
    } != vk::Result::SUCCESS
    {
        return Vec::new();
    }

    let mut props = vec![vk::ExtensionProperties::default(); count as usize];
    if unsafe {
        enumerate(
            physical_device,
            std::ptr::null(),
            &mut count,
            props.as_mut_ptr(),
        )
    } != vk::Result::SUCCESS
    {
        return Vec::new();
    }

    props
        .iter()
        .filter_map(|p| {
            let cstr = unsafe { std::ffi::CStr::from_ptr(p.extension_name.as_ptr()) };
            Some(cstr.to_owned())
        })
        .collect()
}
