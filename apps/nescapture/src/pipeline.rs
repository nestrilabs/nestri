// ─────────────────────────────────────────────────────────────────────────────
//  pipeline.rs — Phase 1: graphics pipeline tracking
//
//  When the game calls vkCreateGraphicsPipelines, we:
//    1. Let the call through to the next layer / driver.
//    2. For each created pipeline, walk its shader stages.
//    3. Look up each stage's VkShaderModule in shader_registry to get its hash.
//    4. Store (VkPipeline → PipelineHashes{vert_hash, frag_hash}) in
//       DeviceState::pipeline_registry.
//
//  vkDestroyPipeline removes the entry to keep the map bounded.
//
//  Phases 3+ use pipeline_registry in vkCmdBindPipeline to know which
//  shader hashes are active when draw calls are issued.
// ─────────────────────────────────────────────────────────────────────────────

use crate::dispatch_key;
use crate::state::{DEVICE_STATE, PipelineHashes, PipelineState};
use ash::vk::{self, Handle};
use std::os::raw::c_void;

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkCreateGraphicsPipelines(
    device: vk::Device,
    pipeline_cache: vk::PipelineCache,
    create_info_count: u32,
    p_create_infos: *const vk::GraphicsPipelineCreateInfo,
    p_allocator: *const vk::AllocationCallbacks,
    p_pipelines: *mut vk::Pipeline,
) -> vk::Result {
    let key = unsafe { dispatch_key(device.as_raw() as *const c_void) };
    let ds = match DEVICE_STATE.get(&key) {
        Some(s) => s.clone(),
        None => return vk::Result::ERROR_DEVICE_LOST,
    };

    // Call through first. On success, p_pipelines is populated.
    let result = unsafe {
        (ds.fp.create_graphics_pipelines)(
            device,
            pipeline_cache,
            create_info_count,
            p_create_infos,
            p_allocator,
            p_pipelines,
        )
    };
    if result != vk::Result::SUCCESS {
        return result;
    }

    let infos = unsafe { std::slice::from_raw_parts(p_create_infos, create_info_count as usize) };
    let pipelines = unsafe { std::slice::from_raw_parts(p_pipelines, create_info_count as usize) };

    for (ci, &pipeline) in infos.iter().zip(pipelines.iter()) {
        if pipeline == vk::Pipeline::null() {
            // Can happen when VK_PIPELINE_CREATE_FAIL_ON_PIPELINE_COMPILE_REQUIRED_BIT is set.
            continue;
        }

        let stages = unsafe { std::slice::from_raw_parts(ci.p_stages, ci.stage_count as usize) };

        let mut vert_hash: Option<u64> = None;
        let mut frag_hash: Option<u64> = None;

        for stage in stages {
            let module_hash = ds.shader_registry.get(&stage.module.as_raw()).map(|r| *r);

            match stage.stage {
                vk::ShaderStageFlags::VERTEX => vert_hash = module_hash,
                vk::ShaderStageFlags::FRAGMENT => frag_hash = module_hash,
                _ => {}
            }
        }

        // Phase 6: extract blend and depth state for discovery mode
        let mut blend_enabled = false;
        if !ci.p_color_blend_state.is_null() {
            let blend = unsafe { &*ci.p_color_blend_state };
            for i in 0..blend.attachment_count as usize {
                let attachment = unsafe { &*blend.p_attachments.add(i) };
                if attachment.blend_enable != vk::FALSE {
                    blend_enabled = true;
                    break;
                }
            }
        }

        let mut depth_test_enabled = false;
        let mut depth_write_enabled = false;
        if !ci.p_depth_stencil_state.is_null() {
            let ds_state = unsafe { &*ci.p_depth_stencil_state };
            depth_test_enabled = ds_state.depth_test_enable != vk::FALSE;
            depth_write_enabled = ds_state.depth_write_enable != vk::FALSE;
        }

        /*log::trace!(
            "pipeline {:#010x} → vert={} frag={} blend={} depth_test={} depth_write={}",
            pipeline.as_raw(),
            vert_hash
                .map(|h| format!("{:#018x}", h))
                .unwrap_or_else(|| "none".to_string()),
            frag_hash
                .map(|h| format!("{:#018x}", h))
                .unwrap_or_else(|| "none".to_string()),
            blend_enabled,
            depth_test_enabled,
            depth_write_enabled,
        );*/

        ds.pipeline_registry.insert(
            pipeline.as_raw(),
            PipelineHashes {
                vert_hash,
                frag_hash,
            },
        );

        ds.pipeline_state.insert(
            pipeline.as_raw(),
            PipelineState {
                blend_enabled,
                depth_test_enabled,
                depth_write_enabled,
            },
        );
    }

    vk::Result::SUCCESS
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkDestroyPipeline(
    device: vk::Device,
    pipeline: vk::Pipeline,
    p_allocator: *const vk::AllocationCallbacks,
) {
    let key = unsafe { dispatch_key(device.as_raw() as *const c_void) };
    if let Some(ds) = DEVICE_STATE.get(&key) {
        ds.pipeline_registry.remove(&pipeline.as_raw());
        ds.pipeline_state.remove(&pipeline.as_raw());
        unsafe { (ds.fp.destroy_pipeline)(device, pipeline, p_allocator) };
    }
}
