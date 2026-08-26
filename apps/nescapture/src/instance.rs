// ─────────────────────────────────────────────────────────────────────────────
//  instance.rs — vkCreateInstance and vkDestroyInstance
// ─────────────────────────────────────────────────────────────────────────────

use crate::dispatch::NextInstanceFn;
use crate::state::INSTANCE_STATE;
use crate::{VkLayerInstanceCreateInfo, dispatch_key, find_layer_link, load_instance_fn};
use ash::vk::{self, Handle};
use std::os::raw::c_void;
use std::sync::Arc;

use crate::dispatch::PFN_vkCreateInstance;

const VK_LAYER_LINK_INFO: u32 = 0;

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkCreateInstance(
    p_create_info: *const vk::InstanceCreateInfo,
    p_allocator: *const vk::AllocationCallbacks,
    p_instance: *mut vk::Instance,
) -> vk::Result {
    crate::init_logger();

    // ── Walk the pNext chain to find the loader's layer link ─────────────────
    let layer_info: *mut VkLayerInstanceCreateInfo = match unsafe {
        find_layer_link((*p_create_info).p_next as *const c_void, VK_LAYER_LINK_INFO)
    } {
        Some(p) => p,
        None => return vk::Result::ERROR_INITIALIZATION_FAILED,
    };

    let layer_link = unsafe { (*layer_info).u.pLayerInfo };
    let next_gipa = match unsafe { (*layer_link).pfnNextGetInstanceProcAddr } {
        Some(f) => f,
        None => return vk::Result::ERROR_INITIALIZATION_FAILED,
    };
    // Advance the chain before calling through so the next layer gets its link.
    unsafe { (*layer_info).u.pLayerInfo = (*layer_link).pNext };

    // ── Call the next layer / loader's vkCreateInstance ──────────────────────
    let next_create: PFN_vkCreateInstance =
        unsafe { load_instance_fn(next_gipa, vk::Instance::null(), b"vkCreateInstance\0") };

    let result = unsafe { next_create(p_create_info, p_allocator, p_instance) };
    if result != vk::Result::SUCCESS {
        return result;
    }

    let instance = unsafe { *p_instance };
    let key = unsafe { dispatch_key(instance.as_raw() as *const c_void) };

    // ── Build and store per-instance dispatch table ───────────────────────────
    let istate = Arc::new(NextInstanceFn {
        get_instance_proc_addr: next_gipa,
        destroy_instance: unsafe { load_instance_fn(next_gipa, instance, b"vkDestroyInstance\0") },
        get_physical_device_memory_properties: unsafe {
            load_instance_fn(
                next_gipa,
                instance,
                b"vkGetPhysicalDeviceMemoryProperties\0",
            )
        },
        create_device: unsafe { load_instance_fn(next_gipa, instance, b"vkCreateDevice\0") },
    });

    INSTANCE_STATE.insert(key, istate);
    log::debug!("vkCreateInstance OK (enabled={})", crate::enabled());
    vk::Result::SUCCESS
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkDestroyInstance(
    instance: vk::Instance,
    p_allocator: *const vk::AllocationCallbacks,
) {
    let key = unsafe { dispatch_key(instance.as_raw() as *const c_void) };
    if let Some((_, state)) = INSTANCE_STATE.remove(&key) {
        unsafe { (state.destroy_instance)(instance, p_allocator) };
    }
}
