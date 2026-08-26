// ─────────────────────────────────────────────────────────────────────────────
//  lib.rs — nescapture Vulkan implicit layer
//
//  Entry points:
//    vkNegotiateLoaderLayerInterfaceVersion
//    vkGetInstanceProcAddr
//    vkGetDeviceProcAddr
//
//  To add a new hook:
//    1. Implement it in the relevant module.
//    2. Add it to `match_device_fn` below.
//    3. Export it with #[unsafe(no_mangle)] in the module.
// ─────────────────────────────────────────────────────────────────────────────

#![allow(
    non_snake_case,
    non_camel_case_types,
    dead_code,
    unused_variables,
    clippy::missing_safety_doc,
    clippy::too_many_arguments
)]

mod capture;
mod commands;
mod config;
mod device;
mod discovery;
mod dispatch;
mod dmabuf_import;
mod encode;
mod framebuffer;
mod instance;
mod pipeline;
mod present;
mod shader;
mod state;
mod swapchain;

use commands::{
    vkCmdBeginRenderPass, vkCmdBeginRenderingKHR, vkCmdBindPipeline, vkCmdDraw, vkCmdDrawIndexed,
    vkCmdDrawIndexedIndirect, vkCmdDrawIndexedIndirectCount, vkCmdDrawIndexedIndirectCountKHR,
    vkCmdDrawIndirect, vkCmdDrawIndirectCount, vkCmdDrawIndirectCountKHR, vkCmdEndRenderPass,
    vkCmdEndRenderingKHR,
};
use device::{vkCreateDevice, vkDestroyDevice, vkGetDeviceQueue};
use framebuffer::{
    vkAllocateCommandBuffers, vkCreateFramebuffer, vkCreateImageView, vkDestroyFramebuffer,
    vkDestroyImageView, vkFreeCommandBuffers,
};
use instance::{vkCreateInstance, vkDestroyInstance};
use pipeline::{vkCreateGraphicsPipelines, vkDestroyPipeline};
use present::vkQueuePresentKHR;
use shader::{vkCreateShaderModule, vkDestroyShaderModule};
use swapchain::{vkCreateSwapchainKHR, vkDestroySwapchainKHR, vkGetSwapchainImagesKHR};

use dispatch::{PFN_vkGetDeviceProcAddr, PFN_vkGetInstanceProcAddr, RawFn};
use state::{DEVICE_STATE, INSTANCE_STATE};

use ash::vk::{self, Handle};
use once_cell::sync::OnceCell;
use std::ffi::CStr;
use std::os::raw::{c_char, c_void};

const ENABLE_ENV: &str = "NESCAPTURE_ENABLE";

pub(crate) fn enabled() -> bool {
    std::env::var(ENABLE_ENV).map(|v| v == "1").unwrap_or(false)
}

static LOGGER: OnceCell<()> = OnceCell::new();

pub(crate) fn init_logger() {
    LOGGER.get_or_init(|| {
        env_logger::Builder::from_default_env().init();
    });
}

// ── Vulkan loader structs (not in ash) ────────────────────────────────────────

#[repr(C)]
pub(crate) struct VkLayerInstanceLink {
    pNext: *mut VkLayerInstanceLink,
    pfnNextGetInstanceProcAddr: Option<PFN_vkGetInstanceProcAddr>,
    pfnNextGetPhysicalDeviceProcAddr: Option<RawFn>,
}

#[repr(C)]
pub(crate) struct VkLayerDeviceLink {
    pNext: *mut VkLayerDeviceLink,
    pfnNextGetInstanceProcAddr: Option<PFN_vkGetInstanceProcAddr>,
    pfnNextGetDeviceProcAddr: Option<PFN_vkGetDeviceProcAddr>,
}

#[repr(C)]
pub(crate) union VkLayerCreateInfoU {
    pub pLayerInfo: *mut VkLayerInstanceLink,
    pub pDeviceLayerInfo: *mut VkLayerDeviceLink,
}

const VK_STRUCTURE_TYPE_LOADER_INSTANCE_CREATE_INFO: i32 = 47;
const VK_STRUCTURE_TYPE_LOADER_DEVICE_CREATE_INFO: i32 = 48;

#[repr(C)]
pub(crate) struct VkLayerInstanceCreateInfo {
    pub sType: i32,
    pub pNext: *const c_void,
    pub function: u32,
    pub u: VkLayerCreateInfoU,
}

pub(crate) type VkLayerDeviceCreateInfo = VkLayerInstanceCreateInfo;

pub(crate) unsafe fn dispatch_key(handle: *const c_void) -> usize {
    unsafe { *(handle as *const usize) }
}

pub(crate) unsafe fn find_layer_link<T>(p_next: *const c_void, function: u32) -> Option<*mut T> {
    let mut current = p_next;
    while !current.is_null() {
        let header = current as *const VkLayerInstanceCreateInfo;
        let s = unsafe { (*header).sType };
        if (s == VK_STRUCTURE_TYPE_LOADER_INSTANCE_CREATE_INFO
            || s == VK_STRUCTURE_TYPE_LOADER_DEVICE_CREATE_INFO)
            && unsafe { (*header).function } == function
        {
            return Some(header as *mut T);
        }
        current = unsafe { (*header).pNext };
    }
    None
}

pub(crate) unsafe fn load_device_fn<T>(
    get: PFN_vkGetDeviceProcAddr,
    device: vk::Device,
    name: &[u8],
) -> T {
    let raw = unsafe {
        get(device, name.as_ptr() as *const c_char)
            .unwrap_or_else(|| panic!("missing device fn: {}", core::str::from_utf8(name).unwrap()))
    };
    unsafe { std::mem::transmute_copy(&raw) }
}

pub(crate) unsafe fn try_load_device_fn<T>(
    get: PFN_vkGetDeviceProcAddr,
    device: vk::Device,
    name: &[u8],
) -> Option<T> {
    let raw = unsafe { get(device, name.as_ptr() as *const c_char) }?;
    Some(unsafe { std::mem::transmute_copy(&raw) })
}

pub(crate) unsafe fn load_instance_fn<T>(
    get: PFN_vkGetInstanceProcAddr,
    instance: vk::Instance,
    name: &[u8],
) -> T {
    let raw = unsafe {
        get(instance, name.as_ptr() as *const c_char).unwrap_or_else(|| {
            panic!(
                "missing instance fn: {}",
                core::str::from_utf8(name).unwrap()
            )
        })
    };
    unsafe { std::mem::transmute_copy(&raw) }
}

#[inline]
pub(crate) unsafe fn to_raw(addr: usize) -> RawFn {
    unsafe { std::mem::transmute(addr) }
}

macro_rules! layer_fn {
    ($f:ident) => {
        return Some(unsafe { to_raw($f as *const () as usize) })
    };
}

// ─────────────────────────────────────────────────────────────────────────────
//  vkGetInstanceProcAddr
// ─────────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkGetInstanceProcAddr(
    instance: vk::Instance,
    p_name: *const c_char,
) -> Option<RawFn> {
    let name = unsafe { CStr::from_ptr(p_name).to_bytes() };

    match name {
        b"vkGetInstanceProcAddr" => layer_fn!(vkGetInstanceProcAddr),
        b"vkCreateInstance" => layer_fn!(vkCreateInstance),
        b"vkDestroyInstance" => layer_fn!(vkDestroyInstance),
        b"vkCreateDevice" => layer_fn!(vkCreateDevice),
        _ => {}
    }

    if let Some(f) = unsafe { match_device_fn(name) } {
        return Some(f);
    }

    if instance.as_raw() == 0 {
        return None;
    }

    let ikey = unsafe { dispatch_key(instance.as_raw() as *const c_void) };
    if let Some(istate) = INSTANCE_STATE.get(&ikey) {
        return unsafe { (istate.get_instance_proc_addr)(instance, p_name) };
    }
    None
}

// ─────────────────────────────────────────────────────────────────────────────
//  vkGetDeviceProcAddr
// ─────────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkGetDeviceProcAddr(
    device: vk::Device,
    p_name: *const c_char,
) -> Option<RawFn> {
    let name = unsafe { CStr::from_ptr(p_name).to_bytes() };

    if let Some(f) = unsafe { match_device_fn(name) } {
        return Some(f);
    }

    let key = unsafe { dispatch_key(device.as_raw() as *const c_void) };
    if let Some(ds) = DEVICE_STATE.get(&key) {
        return unsafe { (ds.fp.get_device_proc_addr)(device, p_name) };
    }
    None
}

unsafe fn match_device_fn(name: &[u8]) -> Option<RawFn> {
    let name_str = std::str::from_utf8(name).unwrap_or("<non-utf8>");
    // Only log swapchain/acquire/present functions to keep noise down
    let log_this = name_str.contains("Swapchain")
        || name_str.contains("AcquireNextImage")
        || name_str.contains("QueuePresent")
        || name_str.contains("CreateDevice")
        || name_str.contains("GetSwapchain");
    if log_this {
        log::debug!("gdpa: {}", name_str);
    }
    unsafe {
        match name {
            b"vkGetDeviceProcAddr" => Some(to_raw(vkGetDeviceProcAddr as *const () as usize)),
            b"vkCreateDevice" => Some(to_raw(vkCreateDevice as *const () as usize)),
            b"vkDestroyDevice" => Some(to_raw(vkDestroyDevice as *const () as usize)),
            b"vkGetDeviceQueue" => Some(to_raw(vkGetDeviceQueue as *const () as usize)),
            b"vkQueuePresentKHR" => Some(to_raw(vkQueuePresentKHR as *const () as usize)),

            b"vkCreateShaderModule" => Some(to_raw(vkCreateShaderModule as *const () as usize)),
            b"vkDestroyShaderModule" => Some(to_raw(vkDestroyShaderModule as *const () as usize)),
            b"vkCreateGraphicsPipelines" => {
                Some(to_raw(vkCreateGraphicsPipelines as *const () as usize))
            }
            b"vkDestroyPipeline" => Some(to_raw(vkDestroyPipeline as *const () as usize)),

            b"vkCreateImageView" => Some(to_raw(vkCreateImageView as *const () as usize)),
            b"vkDestroyImageView" => Some(to_raw(vkDestroyImageView as *const () as usize)),
            b"vkCreateFramebuffer" => Some(to_raw(vkCreateFramebuffer as *const () as usize)),
            b"vkDestroyFramebuffer" => Some(to_raw(vkDestroyFramebuffer as *const () as usize)),
            b"vkAllocateCommandBuffers" => {
                Some(to_raw(vkAllocateCommandBuffers as *const () as usize))
            }
            b"vkFreeCommandBuffers" => Some(to_raw(vkFreeCommandBuffers as *const () as usize)),

            b"vkCmdBindPipeline" => Some(to_raw(vkCmdBindPipeline as *const () as usize)),
            b"vkCmdBeginRenderPass" => Some(to_raw(vkCmdBeginRenderPass as *const () as usize)),
            b"vkCmdEndRenderPass" => Some(to_raw(vkCmdEndRenderPass as *const () as usize)),
            b"vkCmdBeginRenderingKHR" => Some(to_raw(vkCmdBeginRenderingKHR as *const () as usize)),
            b"vkCmdEndRenderingKHR" => Some(to_raw(vkCmdEndRenderingKHR as *const () as usize)),

            b"vkCmdDraw" => Some(to_raw(vkCmdDraw as *const () as usize)),
            b"vkCmdDrawIndexed" => Some(to_raw(vkCmdDrawIndexed as *const () as usize)),
            b"vkCmdDrawIndirect" => Some(to_raw(vkCmdDrawIndirect as *const () as usize)),
            b"vkCmdDrawIndexedIndirect" => {
                Some(to_raw(vkCmdDrawIndexedIndirect as *const () as usize))
            }
            b"vkCmdDrawIndirectCount" => Some(to_raw(vkCmdDrawIndirectCount as *const () as usize)),
            b"vkCmdDrawIndexedIndirectCount" => {
                Some(to_raw(vkCmdDrawIndexedIndirectCount as *const () as usize))
            }
            b"vkCmdDrawIndirectCountKHR" => {
                Some(to_raw(vkCmdDrawIndirectCountKHR as *const () as usize))
            }
            b"vkCmdDrawIndexedIndirectCountKHR" => Some(to_raw(
                vkCmdDrawIndexedIndirectCountKHR as *const () as usize,
            )),

            b"vkCreateSwapchainKHR" => {
                if log_this {
                    log::debug!("gdpa: → our vkCreateSwapchainKHR");
                }
                Some(to_raw(vkCreateSwapchainKHR as *const () as usize))
            }
            b"vkDestroySwapchainKHR" => {
                if log_this {
                    log::debug!("gdpa: → our vkDestroySwapchainKHR");
                }
                Some(to_raw(vkDestroySwapchainKHR as *const () as usize))
            }
            b"vkGetSwapchainImagesKHR" => {
                if log_this {
                    log::debug!("gdpa: → our vkGetSwapchainImagesKHR");
                }
                Some(to_raw(vkGetSwapchainImagesKHR as *const () as usize))
            }

            _ => {
                if log_this {
                    log::debug!("gdpa: → passthrough (not intercepted)");
                }
                None
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  vkNegotiateLoaderLayerInterfaceVersion
// ─────────────────────────────────────────────────────────────────────────────

#[repr(C)]
pub struct VkNegotiateLayerInterface {
    pub sType: u32,
    pub pNext: *mut c_void,
    pub loaderLayerInterfaceVersion: u32,
    pub pfnGetInstanceProcAddr: Option<PFN_vkGetInstanceProcAddr>,
    pub pfnGetDeviceProcAddr: Option<PFN_vkGetDeviceProcAddr>,
    pub pfnGetPhysicalDeviceProcAddr:
        Option<unsafe extern "system" fn(vk::Instance, *const c_char) -> Option<RawFn>>,
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkNegotiateLoaderLayerInterfaceVersion(
    p_version_struct: *mut VkNegotiateLayerInterface,
) -> vk::Result {
    init_logger();
    let s = unsafe { &mut *p_version_struct };
    if s.loaderLayerInterfaceVersion > 2 {
        s.loaderLayerInterfaceVersion = 2;
    }
    s.pfnGetInstanceProcAddr = Some(vkGetInstanceProcAddr);
    s.pfnGetDeviceProcAddr = Some(vkGetDeviceProcAddr);
    s.pfnGetPhysicalDeviceProcAddr = None;
    vk::Result::SUCCESS
}
