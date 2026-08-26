// ─────────────────────────────────────────────────────────────────────────────
//  shader.rs — Phase 1: shader module interception and SPIR-V fingerprinting
//
//  When the game (or DXVK/VKD3D) calls vkCreateShaderModule, we:
//    1. Let the call through to the next layer / driver.
//    2. Hash the raw SPIR-V bytecode with SHA-256, truncated to 64 bits.
//    3. Store (VkShaderModule → hash) in DeviceState::shader_registry.
//
//  vkDestroyShaderModule removes the entry to keep the map bounded.
//
//  The hash is stable for a fixed (game version, DXVK version) pair.
//  It is looked up in vkCreateGraphicsPipelines (pipeline.rs) to tag each
//  pipeline with the hashes of its vertex and fragment shaders.
// ─────────────────────────────────────────────────────────────────────────────

use crate::dispatch_key;
use crate::state::DEVICE_STATE;
use ash::vk::{self, Handle};
use sha2::{Digest, Sha256};
use std::os::raw::c_void;

/// Compute a stable 64-bit fingerprint of a SPIR-V module.
///
/// SPIR-V is a sequence of u32 words. We hash the raw bytes in native endian —
/// endianness consistency is all that matters since the hash is only compared
/// on the same machine within the same session.
///
/// SHA-256 is collision-resistant. Truncating to 64 bits is safe because any
/// single game has hundreds of shaders at most, making collisions astronomically
/// unlikely.
fn hash_spirv(words: &[u32]) -> u64 {
    let bytes: &[u8] = bytemuck::cast_slice(words);
    let digest = Sha256::digest(bytes);
    // Take the first 8 bytes as a little-endian u64.
    u64::from_le_bytes(digest[..8].try_into().unwrap())
}

// ─────────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkCreateShaderModule(
    device: vk::Device,
    p_create_info: *const vk::ShaderModuleCreateInfo,
    p_allocator: *const vk::AllocationCallbacks,
    p_shader_module: *mut vk::ShaderModule,
) -> vk::Result {
    let key = unsafe { dispatch_key(device.as_raw() as *const c_void) };
    let ds = match DEVICE_STATE.get(&key) {
        Some(s) => s.clone(),
        None => return vk::Result::ERROR_DEVICE_LOST,
    };

    // Call through first so the driver creates the real object.
    let result = unsafe {
        (ds.fp.create_shader_module)(device, p_create_info, p_allocator, p_shader_module)
    };
    if result != vk::Result::SUCCESS {
        return result;
    }

    // Hash the SPIR-V bytecode.
    let ci = unsafe { &*p_create_info };
    // code_size is in bytes; p_code points to u32 words.
    let word_count = ci.code_size / std::mem::size_of::<u32>();
    let words = unsafe { std::slice::from_raw_parts(ci.p_code, word_count) };
    let hash = hash_spirv(words);

    let module = unsafe { *p_shader_module };
    ds.shader_registry.insert(module.as_raw(), hash);

    /*log::trace!(
        "shader module {:#010x} → spir-v hash {:#018x} ({} words)",
        module.as_raw(),
        hash,
        word_count,
    );*/

    vk::Result::SUCCESS
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkDestroyShaderModule(
    device: vk::Device,
    shader_module: vk::ShaderModule,
    p_allocator: *const vk::AllocationCallbacks,
) {
    let key = unsafe { dispatch_key(device.as_raw() as *const c_void) };
    if let Some(ds) = DEVICE_STATE.get(&key) {
        ds.shader_registry.remove(&shader_module.as_raw());
        unsafe { (ds.fp.destroy_shader_module)(device, shader_module, p_allocator) };
    }
}
