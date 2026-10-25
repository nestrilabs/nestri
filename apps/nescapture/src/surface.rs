//! Which native window each surface draws to.
//!
//! A layer sees swapchains, and a swapchain names only a `VkSurfaceKHR`. The
//! compositor names windows. Recording the X11 window behind each surface is
//! what lets a capture say which window its frames belong to, so a process
//! drawing several windows -- a browser, a launcher with dialogs -- streams each
//! one on its own instead of all of them through one picture.
//!
//! Wayland surfaces are not recorded: a `wl_surface` is a client-side pointer
//! with no id the compositor would recognise. They keep the process as their
//! name, as every surface did before.

use crate::dispatch_key;
use crate::state::{INSTANCE_STATE, SURFACE_WINDOW};
use ash::vk::{self, Handle};
use std::ffi::CStr;
use std::os::raw::c_void;

/// The next layer's entry point for `name` on `instance`.
unsafe fn next<F>(instance: vk::Instance, name: &CStr) -> Option<F> {
    let key = unsafe { dispatch_key(instance.as_raw() as *const c_void) };
    let istate = INSTANCE_STATE.get(&key)?;
    let f = unsafe { (istate.get_instance_proc_addr)(instance, name.as_ptr()) }?;
    Some(unsafe { std::mem::transmute_copy::<_, F>(&f) })
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkCreateXcbSurfaceKHR(
    instance: vk::Instance,
    p_create_info: *const vk::XcbSurfaceCreateInfoKHR,
    p_allocator: *const vk::AllocationCallbacks,
    p_surface: *mut vk::SurfaceKHR,
) -> vk::Result {
    let Some(create) =
        (unsafe { next::<vk::PFN_vkCreateXcbSurfaceKHR>(instance, c"vkCreateXcbSurfaceKHR") })
    else {
        return vk::Result::ERROR_EXTENSION_NOT_PRESENT;
    };
    let result = unsafe { create(instance, p_create_info, p_allocator, p_surface) };
    if result == vk::Result::SUCCESS {
        let window = unsafe { (*p_create_info).window };
        SURFACE_WINDOW.insert(unsafe { (*p_surface).as_raw() }, window);
    }
    result
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkCreateXlibSurfaceKHR(
    instance: vk::Instance,
    p_create_info: *const vk::XlibSurfaceCreateInfoKHR,
    p_allocator: *const vk::AllocationCallbacks,
    p_surface: *mut vk::SurfaceKHR,
) -> vk::Result {
    let Some(create) =
        (unsafe { next::<vk::PFN_vkCreateXlibSurfaceKHR>(instance, c"vkCreateXlibSurfaceKHR") })
    else {
        return vk::Result::ERROR_EXTENSION_NOT_PRESENT;
    };
    let result = unsafe { create(instance, p_create_info, p_allocator, p_surface) };
    if result == vk::Result::SUCCESS {
        // An X11 window id is 29 bits wide whatever `Window`'s C type is.
        let window = unsafe { (*p_create_info).window } as u32;
        SURFACE_WINDOW.insert(unsafe { (*p_surface).as_raw() }, window);
    }
    result
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkDestroySurfaceKHR(
    instance: vk::Instance,
    surface: vk::SurfaceKHR,
    p_allocator: *const vk::AllocationCallbacks,
) {
    // Before the call down: a handle can be reused the moment it is freed.
    SURFACE_WINDOW.remove(&surface.as_raw());
    if let Some(destroy) =
        unsafe { next::<vk::PFN_vkDestroySurfaceKHR>(instance, c"vkDestroySurfaceKHR") }
    {
        unsafe { destroy(instance, surface, p_allocator) };
    }
}
