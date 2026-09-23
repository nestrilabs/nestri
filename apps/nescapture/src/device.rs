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
    // Lets the capture ring be allocated tiled. The importer has always created
    // its side with DRM_FORMAT_MODIFIER_EXT tiling; without this the producer
    // can only offer it a linear buffer.
    const EXT_IMAGE_DRM_FORMAT_MODIFIER: &[u8] = b"VK_EXT_image_drm_format_modifier\0";

    let needed: &[&[u8]] = &[
        EXT_EXTERNAL_MEMORY,
        EXT_EXTERNAL_MEMORY_FD,
        EXT_EXTERNAL_MEMORY_DMABUF,
        EXT_IMAGE_DRM_FORMAT_MODIFIER,
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

    // Try with injected extensions first.
    //
    // The device's queue create info is passed through unchanged. An earlier
    // version bumped the first family's queue count by one to get a dedicated
    // capture queue, which was then never used — and could not be: the capture
    // blit has to be submitted to the queue the game presents on, or it gains
    // no ordering against the present. All the bump did was risk exceeding the
    // family's available queue count on the way in.
    let mut modified_ci = *ci;
    modified_ci.enabled_extension_count = extended.len() as u32;
    modified_ci.pp_enabled_extension_names = extended.as_ptr();

    // Where it can, the encoder runs on this very device, so the device is
    // first created with what that needs. Anything refused falls back to the
    // device as it would otherwise have been.
    let mut shared = None;
    if let Some(prepared) =
        unsafe {
        crate::shared::prepare(&istate, next_gdpa, physical_device, &modified_ci, &extended)
    }
    {
        let shared_ci = prepared.create_info(&modified_ci);
        let result =
            unsafe { (istate.create_device)(physical_device, &shared_ci, p_allocator, p_device) };
        let (additions, entry, instance) = unsafe { prepared.finish() };
        if result == vk::Result::SUCCESS {
            shared = Some((additions, entry, instance));
        } else {
            log::warn!(
                "vkCreateDevice with the encoder's additions failed ({result:?}), \
                 retrying without them"
            );
        }
    }

    let mut dmabuf_available = true;
    let result = if shared.is_some() {
        vk::Result::SUCCESS
    } else {
        unsafe { (istate.create_device)(physical_device, &modified_ci, p_allocator, p_device) }
    };

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
        get_device_queue2: try_load!(b"vkGetDeviceQueue2\0"),
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
        get_image_drm_format_modifier_properties_ext: try_load!(
            b"vkGetImageDrmFormatModifierPropertiesEXT\0"
        ),
        create_query_pool: try_load!(b"vkCreateQueryPool\0"),
        destroy_query_pool: try_load!(b"vkDestroyQueryPool\0"),
        cmd_reset_query_pool: try_load!(b"vkCmdResetQueryPool\0"),
        cmd_write_timestamp: try_load!(b"vkCmdWriteTimestamp\0"),
        get_query_pool_results: try_load!(b"vkGetQueryPoolResults\0"),

        // Phase 4 — synchronisation
        create_fence: load!(b"vkCreateFence\0"),
        create_semaphore: try_load!(b"vkCreateSemaphore\0"),
        destroy_semaphore: try_load!(b"vkDestroySemaphore\0"),
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
        acquire_next_image_khr: try_load!(b"vkAcquireNextImageKHR\0"),
        acquire_next_image2_khr: try_load!(b"vkAcquireNextImage2KHR\0"),

        // Phase 6 — draw commands
        cmd_draw: load!(b"vkCmdDraw\0"),
        cmd_draw_indexed: load!(b"vkCmdDrawIndexed\0"),
        cmd_draw_indirect: load!(b"vkCmdDrawIndirect\0"),
        cmd_draw_indexed_indirect: load!(b"vkCmdDrawIndexedIndirect\0"),
        cmd_draw_indirect_count: try_load!(b"vkCmdDrawIndirectCount\0"),
        cmd_draw_indexed_indirect_count: try_load!(b"vkCmdDrawIndexedIndirectCount\0"),
    };

    let key = unsafe { dispatch_key(device.as_raw() as *const c_void) };

    let shared = shared.map(|(additions, entry, instance)| unsafe {
        crate::shared::SharedDevice::adopt(
            additions,
            entry,
            instance,
            physical_device,
            device,
            next_gdpa,
        )
    });

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
        shared,
        shared_active: std::sync::atomic::AtomicBool::new(false),

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
        capture_ring: std::sync::Mutex::new(None),
        capture_slots: crate::slots::SlotPool::new(crate::state::CAPTURE_SLOTS),
        swapchain: std::sync::Mutex::new(None),
        swapchain_images: std::sync::Mutex::new(Vec::new()),
        swapchain_format: std::sync::Mutex::new(vk::Format::UNDEFINED),
        swapchain_transfer_src: std::sync::atomic::AtomicBool::new(false),
        swapchain_extent: std::sync::Mutex::new(vk::Extent2D {
            width: 0,
            height: 0,
        }),
        swapchain_colorspace: std::sync::atomic::AtomicU32::new(0),
        frame_counter: std::sync::atomic::AtomicU64::new(0),
        ring_generation: std::sync::atomic::AtomicU64::new(0),

        hud_detected_frame: std::sync::atomic::AtomicBool::new(false),
        pending_capture_frame: std::sync::atomic::AtomicBool::new(false),
        capture_injected_frame: std::sync::atomic::AtomicBool::new(false),
        skipped_draws_frame: std::sync::atomic::AtomicU32::new(0),

        encoder: std::sync::Mutex::new(None),

        frame_gate: std::sync::Mutex::new(crate::pacing::FrameGate::from_env()),
        frame_pacer: std::sync::Mutex::new(crate::pacing::FramePacer::from_env()),
        last_present_return: std::sync::Mutex::new(None),
        encoder_starting: std::sync::atomic::AtomicBool::new(false),
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

    // ── 1. Shut down the encode pipeline ──────────────────────────────────
    //
    // Waited for, not just signalled. On a shared device the encoder, its
    // converter and their images are objects on this very device, and
    // destroying the device under them is a use-after-free. The receive
    // timeout bounds how long the thread takes to notice.
    let handle = ds.encoder.lock().ok().and_then(|mut g| g.take());
    if let Some(handle) = handle {
        if handle.finish(std::time::Duration::from_secs(2)) {
            log::info!("encoder pipeline stopped");
        } else {
            log::error!("encoder thread did not stop in time; destroying the device anyway");
        }
    }

    // ── 2. Tear down the capture ring ─────────────────────────────────────
    //
    // Images, memory, fences, exported fds and the per-swapchain-image
    // semaphores all belong to the ring now, so one teardown covers what used
    // to be three separate steps.
    {
        let ring = ds.capture_ring.lock().unwrap().take();
        if let Some(ring) = ring {
            if !ds.capture_slots.all_free() {
                log::warn!(
                    "device destroyed with {} capture slot(s) still in flight",
                    crate::state::CAPTURE_SLOTS - ds.capture_slots.available()
                );
            }
            unsafe { crate::capture::destroy_capture_ring(&ds, ring) };
            log::debug!("capture ring destroyed");
        }
    }

    // ── 3. Free hudless_image / hudless_memory ────────────────────────────
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

    // ── 4. Clean up queue → device key mappings for this device ───────────
    let stale: Vec<u64> = QUEUE_TO_DEVICE_KEY
        .iter()
        .filter(|e| *e.value() == key)
        .map(|e| *e.key())
        .collect();
    for q in stale {
        crate::state::QUEUE_TO_FAMILY.remove(&q);
    }
    QUEUE_TO_DEVICE_KEY.retain(|_, dk| *dk != key);

    // ── 5. Call the real vkDestroyDevice ──────────────────────────────────
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
        // A queue created internally synchronized, so the encoder can share
        // it, is invisible to vkGetDeviceQueue: only vkGetDeviceQueue2 with the
        // matching flags returns it. The game asked for a plain queue and gets
        // this one.
        match (
            shares_family(&ds, queue_family_index),
            ds.fp.get_device_queue2,
        ) {
            (true, Some(get2)) => {
                let info = vk::DeviceQueueInfo2::default()
                    .flags(vk::DeviceQueueCreateFlags::INTERNALLY_SYNCHRONIZED_KHR)
                    .queue_family_index(queue_family_index)
                    .queue_index(queue_index);
                unsafe { get2(device, &info, p_queue) };
            }
            _ => unsafe {
                (ds.fp.get_device_queue)(device, queue_family_index, queue_index, p_queue)
            },
        }
        let queue = unsafe { *p_queue };
        QUEUE_TO_DEVICE_KEY.insert(queue.as_raw(), key);
        crate::state::QUEUE_TO_FAMILY.insert(queue.as_raw(), queue_family_index);
    }
}

/// Whether the game's queues in `family` were created internally synchronized
/// for the encoder to share.
fn shares_family(ds: &DeviceState, family: u32) -> bool {
    ds.shared
        .as_ref()
        .is_some_and(|s| s.queues.internally_synchronized.contains(&family))
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkGetDeviceQueue2(
    device: vk::Device,
    p_queue_info: *const vk::DeviceQueueInfo2,
    p_queue: *mut vk::Queue,
) {
    let key = unsafe { dispatch_key(device.as_raw() as *const c_void) };
    let Some(ds) = DEVICE_STATE.get(&key) else {
        return;
    };
    let Some(get2) = ds.fp.get_device_queue2 else {
        return;
    };
    // The flags have to match the ones the queue was created with, and for a
    // shared family the layer added one the game does not know about.
    let mut info = unsafe { *p_queue_info };
    if shares_family(&ds, info.queue_family_index) {
        info.flags |= vk::DeviceQueueCreateFlags::INTERNALLY_SYNCHRONIZED_KHR;
    }
    unsafe { get2(device, &info, p_queue) };
    let queue = unsafe { *p_queue };
    QUEUE_TO_DEVICE_KEY.insert(queue.as_raw(), key);
    crate::state::QUEUE_TO_FAMILY.insert(queue.as_raw(), info.queue_family_index);
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
