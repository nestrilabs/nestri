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

    // The encoder needs Vulkan 1.1 on the game's instance to run on the game's
    // device. An application asking for 1.0 is raised to 1.1 where the loader
    // has it: 1.1 only adds to 1.0, so nothing the application can do behaves
    // any differently, and without it the encoder needs a device of its own.
    let asked = unsafe {
        let app = (*p_create_info).p_application_info;
        if app.is_null() {
            vk::API_VERSION_1_0
        } else {
            (*app).api_version
        }
    };
    let mut raised_app;
    let mut raised_ci;
    let mut create_info = p_create_info;
    let mut api_version = asked;
    if asked < vk::API_VERSION_1_1 && unsafe { loader_version(next_gipa) } >= vk::API_VERSION_1_1 {
        raised_app = unsafe {
            let app = (*p_create_info).p_application_info;
            if app.is_null() {
                vk::ApplicationInfo::default()
            } else {
                *app
            }
        };
        raised_app.api_version = vk::API_VERSION_1_1;
        raised_ci = unsafe { *p_create_info };
        raised_ci.p_application_info = &raised_app;
        create_info = &raised_ci;
        api_version = vk::API_VERSION_1_1;
        log::info!(
            "instance asked for Vulkan 1.0; created as 1.1 so the encoder can share its devices"
        );
    }

    let result = unsafe { next_create(create_info, p_allocator, p_instance) };
    if result != vk::Result::SUCCESS {
        return result;
    }

    let instance = unsafe { *p_instance };
    let key = unsafe { dispatch_key(instance.as_raw() as *const c_void) };

    // ── Build and store per-instance dispatch table ───────────────────────────
    let istate = Arc::new(NextInstanceFn {
        instance,
        api_version,
        get_instance_proc_addr: next_gipa,
        destroy_instance: unsafe { load_instance_fn(next_gipa, instance, b"vkDestroyInstance\0") },
        get_physical_device_memory_properties: unsafe {
            load_instance_fn(
                next_gipa,
                instance,
                b"vkGetPhysicalDeviceMemoryProperties\0",
            )
        },
        get_physical_device_properties: unsafe {
            crate::try_load_instance_fn(next_gipa, instance, b"vkGetPhysicalDeviceProperties\0")
        },
        get_physical_device_queue_family_properties: unsafe {
            crate::try_load_instance_fn(
                next_gipa,
                instance,
                b"vkGetPhysicalDeviceQueueFamilyProperties\0",
            )
        },
        create_device: unsafe { load_instance_fn(next_gipa, instance, b"vkCreateDevice\0") },
    });

    INSTANCE_STATE.insert(key, istate);
    log::debug!("vkCreateInstance OK (enabled={})", crate::enabled());
    vk::Result::SUCCESS
}

/// The highest instance version the loader below supports; 1.0 when it cannot
/// say, since vkEnumerateInstanceVersion is itself a 1.1 addition.
unsafe fn loader_version(next_gipa: crate::dispatch::PFN_vkGetInstanceProcAddr) -> u32 {
    type Enumerate = unsafe extern "system" fn(*mut u32) -> vk::Result;
    let Some(f) = (unsafe {
        crate::try_load_instance_fn::<Enumerate>(
            next_gipa,
            vk::Instance::null(),
            b"vkEnumerateInstanceVersion\0",
        )
    }) else {
        return vk::API_VERSION_1_0;
    };
    let mut version = vk::API_VERSION_1_0;
    if unsafe { f(&mut version) } != vk::Result::SUCCESS {
        return vk::API_VERSION_1_0;
    }
    version
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
