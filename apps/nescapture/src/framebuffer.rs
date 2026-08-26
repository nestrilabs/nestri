// ─────────────────────────────────────────────────────────────────────────────
//  framebuffer.rs — Phase 2: image view and framebuffer tracking
//
//  We need to know which VkImage is bound as a color attachment at draw time.
//  The chain is: VkFramebuffer → VkImageView → VkImage + VkFormat.
//
//  vkCreateImageView    → view_to_image[view] = image, view_format[view] = fmt
//  vkCreateFramebuffer  → framebuffer_to_views[fb] = views, framebuffer_extent[fb] = extent
//  vkAllocateCommandBuffers → cmd_buf_to_device_key[cmd_buf] = device_key
//  vkFreeCommandBuffers     → remove from CB_STATE and cmd_buf_to_device_key
// ─────────────────────────────────────────────────────────────────────────────

use crate::dispatch_key;
use crate::state::{CB_STATE, CMD_BUF_TO_DEVICE_KEY, DEVICE_STATE};
use ash::vk::{self, Handle};
use std::os::raw::c_void;

// ─────────────────────────────────────────────────────────────────────────────
//  vkCreateImageView — map view → image and view → format
// ─────────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkCreateImageView(
    device: vk::Device,
    p_create_info: *const vk::ImageViewCreateInfo,
    p_allocator: *const vk::AllocationCallbacks,
    p_view: *mut vk::ImageView,
) -> vk::Result {
    let key = unsafe { dispatch_key(device.as_raw() as *const c_void) };
    let ds = match DEVICE_STATE.get(&key) {
        Some(s) => s.clone(),
        None => return vk::Result::ERROR_DEVICE_LOST,
    };

    let result = unsafe { (ds.fp.create_image_view)(device, p_create_info, p_allocator, p_view) };
    if result != vk::Result::SUCCESS {
        return result;
    }

    let ci = unsafe { &*p_create_info };
    let view = unsafe { *p_view };
    let image = ci.image;

    ds.view_to_image.insert(view.as_raw(), image.as_raw());
    ds.view_format.insert(view.as_raw(), ci.format);

    /*log::trace!(
        "image view {:#010x} → image {:#010x} format={}",
        view.as_raw(),
        image.as_raw(),
        ci.format.as_raw(),
    );*/

    vk::Result::SUCCESS
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkDestroyImageView(
    device: vk::Device,
    image_view: vk::ImageView,
    p_allocator: *const vk::AllocationCallbacks,
) {
    let key = unsafe { dispatch_key(device.as_raw() as *const c_void) };
    if let Some(ds) = DEVICE_STATE.get(&key) {
        ds.view_to_image.remove(&image_view.as_raw());
        ds.view_format.remove(&image_view.as_raw());
        unsafe { (ds.fp.destroy_image_view)(device, image_view, p_allocator) };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  vkCreateFramebuffer — map framebuffer → views and framebuffer → extent
// ─────────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkCreateFramebuffer(
    device: vk::Device,
    p_create_info: *const vk::FramebufferCreateInfo,
    p_allocator: *const vk::AllocationCallbacks,
    p_framebuffer: *mut vk::Framebuffer,
) -> vk::Result {
    let key = unsafe { dispatch_key(device.as_raw() as *const c_void) };
    let ds = match DEVICE_STATE.get(&key) {
        Some(s) => s.clone(),
        None => return vk::Result::ERROR_DEVICE_LOST,
    };

    let result =
        unsafe { (ds.fp.create_framebuffer)(device, p_create_info, p_allocator, p_framebuffer) };
    if result != vk::Result::SUCCESS {
        return result;
    }

    let ci = unsafe { &*p_create_info };
    let fb = unsafe { *p_framebuffer };
    let views: Vec<u64> =
        unsafe { std::slice::from_raw_parts(ci.p_attachments, ci.attachment_count as usize) }
            .iter()
            .map(|v| v.as_raw())
            .collect();

    ds.framebuffer_to_views.insert(fb.as_raw(), views.clone());
    ds.framebuffer_extent.insert(
        fb.as_raw(),
        vk::Extent2D {
            width: ci.width,
            height: ci.height,
        },
    );

    log::trace!(
        "framebuffer {:#010x} → {} views, extent {}x{}",
        fb.as_raw(),
        ci.attachment_count,
        ci.width,
        ci.height,
    );

    vk::Result::SUCCESS
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkDestroyFramebuffer(
    device: vk::Device,
    framebuffer: vk::Framebuffer,
    p_allocator: *const vk::AllocationCallbacks,
) {
    let key = unsafe { dispatch_key(device.as_raw() as *const c_void) };
    if let Some(ds) = DEVICE_STATE.get(&key) {
        ds.framebuffer_to_views.remove(&framebuffer.as_raw());
        ds.framebuffer_extent.remove(&framebuffer.as_raw());
        unsafe { (ds.fp.destroy_framebuffer)(device, framebuffer, p_allocator) };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  vkAllocateCommandBuffers — register command buffer → device key mapping
// ─────────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkAllocateCommandBuffers(
    device: vk::Device,
    p_allocate_info: *const vk::CommandBufferAllocateInfo,
    p_command_buffers: *mut vk::CommandBuffer,
) -> vk::Result {
    let key = unsafe { dispatch_key(device.as_raw() as *const c_void) };
    let ds = match DEVICE_STATE.get(&key) {
        Some(s) => s.clone(),
        None => return vk::Result::ERROR_DEVICE_LOST,
    };

    let result =
        unsafe { (ds.fp.allocate_command_buffers)(device, p_allocate_info, p_command_buffers) };
    if result != vk::Result::SUCCESS {
        return result;
    }

    let ai = unsafe { &*p_allocate_info };
    let count = ai.command_buffer_count;
    let buffers = unsafe { std::slice::from_raw_parts(p_command_buffers, count as usize) };

    for &cb in buffers {
        CMD_BUF_TO_DEVICE_KEY.insert(cb.as_raw(), key);
    }

    vk::Result::SUCCESS
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkFreeCommandBuffers(
    device: vk::Device,
    command_pool: vk::CommandPool,
    command_buffer_count: u32,
    p_command_buffers: *const vk::CommandBuffer,
) {
    let key = unsafe { dispatch_key(device.as_raw() as *const c_void) };
    if let Some(ds) = DEVICE_STATE.get(&key) {
        let buffers =
            unsafe { std::slice::from_raw_parts(p_command_buffers, command_buffer_count as usize) };
        for &cb in buffers {
            CMD_BUF_TO_DEVICE_KEY.remove(&cb.as_raw());
            CB_STATE.remove(&cb.as_raw());
        }
        unsafe {
            (ds.fp.free_command_buffers)(
                device,
                command_pool,
                command_buffer_count,
                p_command_buffers,
            )
        };
    }
}
