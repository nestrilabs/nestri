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
    let transfer_src = result == vk::Result::SUCCESS;
    let result = if transfer_src {
        result
    } else {
        unsafe { create_fn(device, ci, p_allocator, p_swapchain) }
    };
    if result != vk::Result::SUCCESS {
        return result;
    }
    if !transfer_src {
        log::warn!(
            "swapchain refused TRANSFER_SRC — capture disabled for this swapchain. \
             Blitting from images the driver did not grant transfer usage is undefined."
        );
    }
    // One window per native window: a swapchain recreated for the same X11
    // window keeps the window it had, and with it the stream.
    let swapchain = unsafe { *p_swapchain };
    let native = crate::state::SURFACE_WINDOW
        .get(&ci.surface.as_raw())
        .map(|w| *w)
        .unwrap_or(0);
    let window = match ds.windows.get(&native).map(|w| w.clone()) {
        Some(window) => window,
        None => {
            let window =
                std::sync::Arc::new(crate::state::Window::new(ds.clone(), native, swapchain));
            ds.windows.insert(native, window.clone());
            window
        }
    };
    window
        .swapchain_transfer_src
        .store(transfer_src, Ordering::Relaxed);

    // A fresh swapchain means fresh images behind the same indices. The
    // per-image capture semaphores may still be pending on presents from the
    // outgoing swapchain, so they are set aside rather than reused.
    crate::capture::retire_all_present_semaphores(&window);

    // Those fresh images also make every recorded blit invalid: a recording
    // names its source image by handle, and the handles behind these indices
    // now belong to a destroyed swapchain. The extent check in
    // `capture_present_frame` catches a resize on its own, but a swapchain
    // recreated at the same size — which is the common case, on a format or
    // present-mode change — looks identical to it.
    crate::capture::invalidate_recorded_blits(&window);

    *window.swapchain.lock().unwrap() = Some(swapchain);
    *window.swapchain_format.lock().unwrap() = ci.image_format;
    *window.swapchain_extent.lock().unwrap() = ci.image_extent;
    // The colour space the layer below us was asked for, which is the one the
    // game asked for in every configuration we ship.
    //
    // The exception is worth knowing about, because it is silent. A WSI layer
    // of the gamescope kind rewrites `imageColorSpace` to SRGB_NONLINEAR before
    // calling down -- deliberately, since it carries the real colour space to
    // the compositor out of band instead. We sit below such a layer, so we
    // would read the rewrite. Measured, all three lines from one run of a
    // client requesting HDR10 PQ:
    //
    //     [Gamescope WSI] ... colorspace: VK_COLOR_SPACE_HDR10_ST2084_EXT
    //     swapchain created — format=A2B10G10R10 colorspace=SRGB_NONLINEAR
    //     (re)init encoder: H265 Yuv420 Ten Bt709 → P010
    //
    // Ten-bit right, BT.709 wrong: PQ samples encoded and tagged as SDR, at
    // full frame rate, decoding cleanly.
    //
    // This is not a bug to fix here. That route predates Wayland colour
    // management and the compositor no longer enables it -- HDR comes from
    // `wp_color_manager_v1` on a Wayland surface, where this value is correct
    // and the same client yields Bt2020 and an smpte2084 stream. It is recorded
    // because it is the reason the route stays off: enabling it would trade no
    // HDR for wrong HDR. Anyone re-enabling it has to give this process a
    // channel to the compositor first, since the true colour space exists only
    // there.
    window
        .swapchain_colorspace
        .store(ci.image_color_space.as_raw() as u32, Ordering::Relaxed);
    *ds.newest_window.lock().unwrap() = Some(window.clone());

    // `info`, not `debug`, and the present mode is why. It decides whether the
    // compositor paces this game at all: a FIFO swapchain waits on
    // `wl_surface.frame`, so the game's rate is the compositor's callback
    // cadence no matter what the gate here is set to, while MAILBOX and
    // IMMEDIATE ignore those callbacks entirely and leave the pacing to this
    // layer. The two cases need opposite fixes and nothing else in a log
    // distinguishes them — "the game runs at 60" reads identically either way.
    //
    // An application's in-game V-Sync setting is not the answer either: DXVK
    // and VKD3D choose the Vulkan present mode themselves, and what they pick
    // from a given setting is theirs to decide.
    log::info!(
        "swapchain created — window={:#x} format={:?} colorspace={:?} extent={}x{} \
         present_mode={:?} min_images={}",
        native,
        ci.image_format,
        ci.image_color_space,
        ci.image_extent.width,
        ci.image_extent.height,
        ci.present_mode,
        ci.min_image_count,
    );

    vk::Result::SUCCESS
}

/// Whether `swapchain` is the one this layer tracks, which is the one most
/// recently created. A swapchain retired through `oldSwapchain` stays valid
/// until destroyed, and calls on it must not touch the tracked state.
pub fn is_current(tracked: Option<vk::SwapchainKHR>, swapchain: vk::SwapchainKHR) -> bool {
    swapchain != vk::SwapchainKHR::null() && tracked == Some(swapchain)
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkDestroySwapchainKHR(
    device: vk::Device,
    swapchain: vk::SwapchainKHR,
    p_allocator: *const vk::AllocationCallbacks,
) {
    let key = unsafe { dispatch_key(device.as_raw() as *const c_void) };
    if let Some(ds) = DEVICE_STATE.get(&key) {
        // Only the swapchain being tracked. A game recreating through
        // `oldSwapchain` destroys the retired one after its replacement is
        // created and its images fetched, and clearing then would leave the
        // live swapchain with no images: every present after would skip
        // capture, silently, until the next recreation.
        if let Some(window) = window_of(&ds, swapchain) {
            *window.swapchain.lock().unwrap() = None;
            *window.swapchain_images.lock().unwrap() = Vec::new();
        }
        if let Some(destroy_fn) = ds.fp.destroy_swapchain_khr {
            unsafe { destroy_fn(device, swapchain, p_allocator) };
        }
    }
}

/// The window whose current swapchain is `swapchain`, if any.
pub fn window_of(
    ds: &crate::state::DeviceState,
    swapchain: vk::SwapchainKHR,
) -> Option<std::sync::Arc<crate::state::Window>> {
    ds.windows
        .iter()
        .find(|w| is_current(*w.swapchain.lock().unwrap(), swapchain))
        .map(|w| w.value().clone())
}

/// Stop a window's encoder and free its capture ring.
///
/// The encoder is waited for, not just signalled: on a shared device the
/// encoder, its converter and their images are objects on the device, and
/// destroying the device under them is a use-after-free. Its receive timeout
/// bounds how long the thread takes to notice.
pub fn retire_window(window: &crate::state::Window) {
    let handle = window.encoder.lock().ok().and_then(|mut g| g.take());
    if let Some(handle) = handle {
        if handle.finish(std::time::Duration::from_secs(2)) {
            log::info!("encoder pipeline stopped (window {:#x})", window.native);
        } else {
            log::error!("encoder thread did not stop in time; destroying the device anyway");
        }
    }
    let ring = window.capture_ring.lock().unwrap().take();
    if let Some(ring) = ring {
        if !window.capture_slots.all_free() {
            log::warn!(
                "window destroyed with {} capture slot(s) still in flight",
                crate::state::CAPTURE_SLOTS - window.capture_slots.available()
            );
        }
        unsafe { crate::capture::destroy_capture_ring(window, ring) };
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

    // Images of a retired swapchain are not the ones capture reads.
    if !p_swapchain_images.is_null()
        && let Some(window) = window_of(&ds, swapchain)
    {
        let count = unsafe { *p_swapchain_image_count as usize };
        let images = unsafe { std::slice::from_raw_parts(p_swapchain_images, count) };
        *window.swapchain_images.lock().unwrap() = images.to_vec();
        log::debug!("swapchain images — {} images", count);
    }

    vk::Result::SUCCESS
}

/// Time the game's wait for a swapchain image.
///
/// Hooked for the measurement alone — the image index, the semaphore and the
/// fence are the application's business and nothing here touches them.
///
/// It is the one part of a frame the present hook cannot see. `gap` runs from
/// one present returning to the next arriving and the acquire sits inside it,
/// so a game blocked waiting for the compositor to release a buffer and a game
/// busy rendering are the same number. Under a FIFO swapchain that wait is the
/// compositor's frame pacing, which is a different problem in a different
/// process from anything this layer can fix.
/// The device state for an acquire, with the present hook's fallback.
///
/// These hooks exist only to time the call, but hooking replaces the
/// application's function pointer — so there is no passing through if the
/// lookup misses, and returning an error would break a game for the sake of a
/// measurement. The last resort is the same one `vkQueuePresentKHR` uses: with
/// one device in the process, the only entry is the right one.
fn device_for(device: vk::Device) -> Option<std::sync::Arc<crate::state::DeviceState>> {
    let key = unsafe { dispatch_key(device.as_raw() as *const c_void) };
    DEVICE_STATE
        .get(&key)
        .map(|s| s.clone())
        .or_else(|| DEVICE_STATE.iter().next().map(|e| e.value().clone()))
}

fn record_acquire(ds: &crate::state::DeviceState, waited: std::time::Duration) {
    let Some(window) = ds.newest_window.lock().ok().and_then(|w| w.clone()) else {
        return;
    };
    if let Ok(enc) = window.encoder.lock()
        && let Some(ref h) = *enc
    {
        h.timing.acquire.record(waited);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkAcquireNextImageKHR(
    device: vk::Device,
    swapchain: vk::SwapchainKHR,
    timeout: u64,
    semaphore: vk::Semaphore,
    fence: vk::Fence,
    p_image_index: *mut u32,
) -> vk::Result {
    let Some(ds) = device_for(device) else {
        return vk::Result::ERROR_DEVICE_LOST;
    };
    let Some(acquire) = ds.fp.acquire_next_image_khr else {
        return vk::Result::ERROR_EXTENSION_NOT_PRESENT;
    };

    crate::present::note_present(&ds, crate::encode::PresentStep::Acquiring);
    let started = std::time::Instant::now();
    let result = unsafe { acquire(device, swapchain, timeout, semaphore, fence, p_image_index) };
    record_acquire(&ds, started.elapsed());
    crate::present::note_present(&ds, crate::encode::PresentStep::InGame);
    result
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkAcquireNextImage2KHR(
    device: vk::Device,
    p_acquire_info: *const vk::AcquireNextImageInfoKHR,
    p_image_index: *mut u32,
) -> vk::Result {
    let Some(ds) = device_for(device) else {
        return vk::Result::ERROR_DEVICE_LOST;
    };
    let Some(acquire) = ds.fp.acquire_next_image2_khr else {
        return vk::Result::ERROR_EXTENSION_NOT_PRESENT;
    };

    crate::present::note_present(&ds, crate::encode::PresentStep::Acquiring);
    let started = std::time::Instant::now();
    let result = unsafe { acquire(device, p_acquire_info, p_image_index) };
    record_acquire(&ds, started.elapsed());
    crate::present::note_present(&ds, crate::encode::PresentStep::InGame);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sc(raw: u64) -> vk::SwapchainKHR {
        vk::SwapchainKHR::from_raw(raw)
    }

    #[test]
    fn the_tracked_swapchain_is_current() {
        assert!(is_current(Some(sc(2)), sc(2)));
    }

    #[test]
    fn a_retired_swapchain_is_not() {
        // Created 2 with oldSwapchain = 1; destroying 1 afterwards must leave
        // 2's state alone.
        assert!(!is_current(Some(sc(2)), sc(1)));
    }

    #[test]
    fn nothing_is_current_once_the_tracked_one_is_gone() {
        assert!(!is_current(None, sc(1)));
        assert!(!is_current(None, vk::SwapchainKHR::null()));
    }
}
