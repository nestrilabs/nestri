// ─────────────────────────────────────────────────────────────────────────────
//  swapchain.rs — Phase 4: swapchain tracking
//
//  Captures format, extent AND color space from vkCreateSwapchainKHR so the
//  encoder can automatically determine the correct color space pipeline
//  (SDR/BT.709 vs HDR10/BT.2020-PQ vs FP16) without any manual configuration.
// ─────────────────────────────────────────────────────────────────────────────

use crate::dispatch_key;
use crate::state::DEVICE_STATE;
use ash::vk::{self, Handle};
use std::os::raw::c_void;
use std::sync::atomic::Ordering;

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkCreateSwapchainKHR(
    device: vk::Device,
    p_create_info: *const vk::SwapchainCreateInfoKHR,
    p_allocator: *const vk::AllocationCallbacks,
    p_swapchain: *mut vk::SwapchainKHR,
) -> vk::Result {
    let key = unsafe { dispatch_key(device.as_raw() as *const c_void) };
    let ds = match DEVICE_STATE.get(&key) {
        Some(s) => s.clone(),
        None => return vk::Result::ERROR_DEVICE_LOST,
    };

    let create_fn = match ds.fp.create_swapchain_khr {
        Some(f) => f,
        None => return vk::Result::ERROR_EXTENSION_NOT_PRESENT,
    };

    let ci = unsafe { &*p_create_info };

    // Add TRANSFER_SRC so we can blit from swapchain images.
    let mut modified_ci = *ci;
    modified_ci.image_usage = ci.image_usage | vk::ImageUsageFlags::TRANSFER_SRC;

    let result = unsafe { create_fn(device, &modified_ci, p_allocator, p_swapchain) };
    // If the driver rejects TRANSFER_SRC (e.g. composited window), try without.
    let result = if result != vk::Result::SUCCESS {
        unsafe { create_fn(device, ci, p_allocator, p_swapchain) }
    } else {
        result
    };
    if result != vk::Result::SUCCESS {
        return result;
    }

    *ds.swapchain.lock().unwrap() = Some(unsafe { *p_swapchain });
    *ds.swapchain_format.lock().unwrap() = ci.image_format;
    *ds.swapchain_extent.lock().unwrap() = ci.image_extent;
    ds.swapchain_colorspace
        .store(ci.image_color_space.as_raw() as u32, Ordering::Relaxed);

    log::debug!(
        "swapchain created — format={:?} colorspace={:?} extent={}x{}",
        ci.image_format,
        ci.image_color_space,
        ci.image_extent.width,
        ci.image_extent.height,
    );

    vk::Result::SUCCESS
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkDestroySwapchainKHR(
    device: vk::Device,
    swapchain: vk::SwapchainKHR,
    p_allocator: *const vk::AllocationCallbacks,
) {
    let key = unsafe { dispatch_key(device.as_raw() as *const c_void) };
    if let Some(ds) = DEVICE_STATE.get(&key) {
        *ds.swapchain.lock().unwrap() = None;
        *ds.swapchain_images.lock().unwrap() = Vec::new();
        if let Some(destroy_fn) = ds.fp.destroy_swapchain_khr {
            unsafe { destroy_fn(device, swapchain, p_allocator) };
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkGetSwapchainImagesKHR(
    device: vk::Device,
    swapchain: vk::SwapchainKHR,
    p_swapchain_image_count: *mut u32,
    p_swapchain_images: *mut vk::Image,
) -> vk::Result {
    let key = unsafe { dispatch_key(device.as_raw() as *const c_void) };
    let ds = match DEVICE_STATE.get(&key) {
        Some(s) => s.clone(),
        None => return vk::Result::ERROR_DEVICE_LOST,
    };

    let get_fn = match ds.fp.get_swapchain_images_khr {
        Some(f) => f,
        None => return vk::Result::ERROR_EXTENSION_NOT_PRESENT,
    };

    let result = unsafe {
        get_fn(
            device,
            swapchain,
            p_swapchain_image_count,
            p_swapchain_images,
        )
    };
    if result != vk::Result::SUCCESS {
        return result;
    }

    if !p_swapchain_images.is_null() {
        let count = unsafe { *p_swapchain_image_count as usize };
        let images = unsafe { std::slice::from_raw_parts(p_swapchain_images, count) };
        *ds.swapchain_images.lock().unwrap() = images.to_vec();
        log::debug!("swapchain images — {} images", count);
    }

    vk::Result::SUCCESS
}
