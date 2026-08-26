// ─────────────────────────────────────────────────────────────────────────────
//  commands.rs — Phase 2: command buffer hooks
//
//  vkCmdBindPipeline     → update CbState.active_vert_hash/active_frag_hash
//  vkCmdBeginRenderPass  → resolve framebuffer → views → image, populate CbState
//  vkCmdEndRenderPass    → clear CbState attachment fields
//  vkCmdBeginRenderingKHR → resolve views → image from VkRenderingInfoKHR
//  vkCmdEndRenderingKHR  → clear CbState attachment fields
// ─────────────────────────────────────────────────────────────────────────────

use crate::capture;
use crate::discovery;
use crate::state::{CB_STATE, CMD_BUF_TO_DEVICE_KEY, DEVICE_STATE};
use ash::vk::{self, Handle};

// ─────────────────────────────────────────────────────────────────────────────
//  vkCmdBindPipeline — track which pipeline (and thus which shader hashes)
//  is currently bound for draw calls.
// ─────────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkCmdBindPipeline(
    command_buffer: vk::CommandBuffer,
    pipeline_bind_point: vk::PipelineBindPoint,
    pipeline: vk::Pipeline,
) {
    let cb_key = command_buffer.as_raw();
    let device_key = match CMD_BUF_TO_DEVICE_KEY.get(&cb_key) {
        Some(r) => *r,
        None => return,
    };
    let ds = match DEVICE_STATE.get(&device_key) {
        Some(s) => s.clone(),
        None => return,
    };

    unsafe {
        (ds.fp.cmd_bind_pipeline)(command_buffer, pipeline_bind_point, pipeline);
    }

    if pipeline_bind_point == vk::PipelineBindPoint::GRAPHICS {
        let hashes = ds
            .pipeline_registry
            .get(&pipeline.as_raw())
            .map(|r| r.clone());
        if let Some(hashes) = hashes {
            if let Some(mut state) = CB_STATE.get_mut(&cb_key) {
                state.active_vert_hash = hashes.vert_hash;
                state.active_frag_hash = hashes.frag_hash;
            } else {
                CB_STATE.insert(
                    cb_key,
                    crate::state::CbState {
                        device_key,
                        active_vert_hash: hashes.vert_hash,
                        active_frag_hash: hashes.frag_hash,
                        ..Default::default()
                    },
                );
            }

            // Phase 3: Check against loaded shader hash config
            if let Some(ref shader_set) = ds.shader_hashes {
                let is_hud = shader_set.is_hud_shader(hashes.vert_hash, hashes.frag_hash);
                let is_skip = shader_set.is_skip_shader(hashes.frag_hash);

                if is_hud {
                    log::debug!(
                        "HUD pipeline detected → vert={} frag={}",
                        hashes
                            .vert_hash
                            .map(|h| format!("{:#018x}", h))
                            .unwrap_or_else(|| "none".to_string()),
                        hashes
                            .frag_hash
                            .map(|h| format!("{:#018x}", h))
                            .unwrap_or_else(|| "none".to_string()),
                    );
                    // Device-level HUD detection (shared across all command buffers)
                    if !ds
                        .hud_detected_frame
                        .load(std::sync::atomic::Ordering::Relaxed)
                    {
                        ds.hud_detected_frame
                            .store(true, std::sync::atomic::Ordering::Relaxed);
                        ds.pending_capture_frame
                            .store(true, std::sync::atomic::Ordering::Relaxed);
                    }
                }

                if is_skip {
                    log::debug!(
                        "Skip pipeline detected → frag={}",
                        hashes
                            .frag_hash
                            .map(|h| format!("{:#018x}", h))
                            .unwrap_or_else(|| "none".to_string()),
                    );
                }
            }

            /*log::trace!(
                "pipeline bound → vert={} frag={}",
                hashes
                    .vert_hash
                    .map(|h| format!("{:#018x}", h))
                    .unwrap_or_else(|| "none".to_string()),
                hashes
                    .frag_hash
                    .map(|h| format!("{:#018x}", h))
                    .unwrap_or_else(|| "none".to_string()),
            );*/
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  vkCmdBeginRenderPass — resolve the current color attachment image.
//
//  The framebuffer contains VkImageViews. We look up each view in the
//  view_to_image map to get the VkImage, and use view_format for the format.
// ─────────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkCmdBeginRenderPass(
    command_buffer: vk::CommandBuffer,
    p_render_pass_begin: *const vk::RenderPassBeginInfo,
    contents: vk::SubpassContents,
) {
    let cb_key = command_buffer.as_raw();
    let device_key = match CMD_BUF_TO_DEVICE_KEY.get(&cb_key) {
        Some(r) => *r,
        None => return,
    };
    let ds = match DEVICE_STATE.get(&device_key) {
        Some(s) => s.clone(),
        None => return,
    };

    let rpb = unsafe { &*p_render_pass_begin };
    let framebuffer = rpb.framebuffer;

    let (color_image, format, extent) = if let Some(views) =
        ds.framebuffer_to_views.get(&framebuffer.as_raw())
    {
        let view_keys: Vec<u64> = views.iter().copied().collect();
        let extent = ds
            .framebuffer_extent
            .get(&framebuffer.as_raw())
            .map(|r| *r)
            .unwrap_or(vk::Extent2D {
                width: rpb.render_area.extent.width,
                height: rpb.render_area.extent.height,
            });

        if !view_keys.is_empty() {
            let first_view = view_keys[0];
            let image = ds
                .view_to_image
                .get(&first_view)
                .map(|r| vk::Image::from_raw(*r));
            let fmt = ds.view_format.get(&first_view).map(|r| *r);
            log::debug!(
                "vkCmdBeginRenderPass → fb={:#010x} view={:#010x} image={:?} format={} extent={}x{}",
                framebuffer.as_raw(),
                first_view,
                image.map(|i| i.as_raw()),
                fmt.map(|f| f.as_raw()).unwrap_or(0),
                extent.width,
                extent.height,
            );
            (image, fmt, Some(extent))
        } else {
            log::debug!(
                "vkCmdBeginRenderPass → fb={:#010x} no views",
                framebuffer.as_raw(),
            );
            (None, None, Some(extent))
        }
    } else {
        log::debug!(
            "vkCmdBeginRenderPass → fb={:#010x} NOT FOUND in framebuffer_to_views",
            framebuffer.as_raw(),
        );
        (None, None, None)
    };

    unsafe {
        (ds.fp.cmd_begin_render_pass)(command_buffer, p_render_pass_begin, contents);
    }

    if let Some(mut state) = CB_STATE.get_mut(&cb_key) {
        state.current_color_image = color_image;
        state.current_image_format = format;
        state.current_image_extent = extent;
    } else {
        CB_STATE.insert(
            cb_key,
            crate::state::CbState {
                device_key,
                current_color_image: color_image,
                current_image_format: format,
                current_image_extent: extent,
                ..Default::default()
            },
        );
    }

    if let (Some(img), Some(ext)) = (color_image, extent) {
        log::debug!(
            "render pass begin → color attachment image {:#010x} extent {}x{}",
            img.as_raw(),
            ext.width,
            ext.height,
        );
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkCmdEndRenderPass(command_buffer: vk::CommandBuffer) {
    let cb_key = command_buffer.as_raw();
    let device_key = match CMD_BUF_TO_DEVICE_KEY.get(&cb_key) {
        Some(r) => *r,
        None => return,
    };
    let ds = match DEVICE_STATE.get(&device_key) {
        Some(s) => s.clone(),
        None => return,
    };

    // Phase 4: track the largest extent we've seen (main framebuffer)
    let current_extent = CB_STATE
        .get(&cb_key)
        .map(|r| r.current_image_extent)
        .unwrap_or(None);
    if let Some(ext) = current_extent {
        let mut largest = ds.largest_extent.lock().unwrap();
        if ext.width * ext.height > largest.width * largest.height {
            *largest = ext;
        }
    }

    // Phase 4: check if we need to inject a HUDless capture copy (device-level)
    let needs_hudless_capture = ds
        .pending_capture_frame
        .load(std::sync::atomic::Ordering::Relaxed)
        && !ds
            .capture_injected_frame
            .load(std::sync::atomic::Ordering::Relaxed);

    unsafe {
        (ds.fp.cmd_end_render_pass)(command_buffer);
    }

    // Inject HUDless capture if HUD was detected this frame
    if needs_hudless_capture {
        log::info!("injecting HUDless capture copy for cb {:#010x}", cb_key);
        unsafe {
            capture::inject_hudless_copy(command_buffer, device_key);
        }
        ds.pending_capture_frame
            .store(false, std::sync::atomic::Ordering::Relaxed);
        ds.capture_injected_frame
            .store(true, std::sync::atomic::Ordering::Relaxed);
    }

    let skipped = ds
        .skipped_draws_frame
        .swap(0, std::sync::atomic::Ordering::Relaxed);
    if skipped > 0 {
        log::info!("render pass end → {} draws skipped", skipped);
    }

    if let Some(mut state) = CB_STATE.get_mut(&cb_key) {
        state.current_color_image = None;
        state.current_image_format = None;
        state.current_image_extent = None;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  vkCmdBeginRenderingKHR — dynamic rendering path (DXVK 1.10+).
//
//  Unlike the framebuffer path, VkRenderingInfoKHR gives VkImageViews directly
//  in VkRenderingAttachmentInfoKHR. No framebuffer object is involved.
// ─────────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkCmdBeginRenderingKHR(
    command_buffer: vk::CommandBuffer,
    p_rendering_info: *const vk::RenderingInfo,
) {
    let cb_key = command_buffer.as_raw();
    let device_key = match CMD_BUF_TO_DEVICE_KEY.get(&cb_key) {
        Some(r) => *r,
        None => return,
    };
    let ds = match DEVICE_STATE.get(&device_key) {
        Some(s) => s.clone(),
        None => return,
    };

    let ri = unsafe { &*p_rendering_info };
    let extent = ri.render_area.extent;

    let (color_image, format) =
        if ri.color_attachment_count > 0 && !ri.p_color_attachments.is_null() {
            let first = unsafe { &*ri.p_color_attachments };
            if first.image_view != vk::ImageView::null() {
                let image = ds
                    .view_to_image
                    .get(&first.image_view.as_raw())
                    .map(|r| vk::Image::from_raw(*r));
                let fmt = ds.view_format.get(&first.image_view.as_raw()).map(|r| *r);
                (image, fmt)
            } else {
                (None, None)
            }
        } else {
            (None, None)
        };

    unsafe {
        (ds.fp.cmd_begin_rendering_khr.unwrap())(command_buffer, p_rendering_info);
    }

    if let Some(mut state) = CB_STATE.get_mut(&cb_key) {
        state.current_color_image = color_image;
        state.current_image_format = format;
        state.current_image_extent = Some(extent);
    } else {
        CB_STATE.insert(
            cb_key,
            crate::state::CbState {
                device_key,
                current_color_image: color_image,
                current_image_format: format,
                current_image_extent: Some(extent),
                ..Default::default()
            },
        );
    }

    log::info!(
        "vkCmdBeginRenderingKHR → color_image={:?} format={:?} extent={}x{}",
        color_image.map(|i| i.as_raw()),
        format.map(|f| f.as_raw()),
        extent.width,
        extent.height,
    );
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkCmdEndRenderingKHR(command_buffer: vk::CommandBuffer) {
    let cb_key = command_buffer.as_raw();
    let device_key = match CMD_BUF_TO_DEVICE_KEY.get(&cb_key) {
        Some(r) => *r,
        None => return,
    };
    let ds = match DEVICE_STATE.get(&device_key) {
        Some(s) => s.clone(),
        None => return,
    };

    // Phase 4: check if we need to inject a HUDless capture copy (device-level)
    let needs_hudless_capture = ds
        .pending_capture_frame
        .load(std::sync::atomic::Ordering::Relaxed)
        && !ds
            .capture_injected_frame
            .load(std::sync::atomic::Ordering::Relaxed);

    unsafe {
        (ds.fp.cmd_end_rendering_khr.unwrap())(command_buffer);
    }

    // Inject HUDless capture if HUD was detected this frame
    if needs_hudless_capture {
        log::info!("injecting HUDless capture copy for cb {:#010x}", cb_key);
        unsafe {
            capture::inject_hudless_copy(command_buffer, device_key);
        }
        ds.pending_capture_frame
            .store(false, std::sync::atomic::Ordering::Relaxed);
        ds.capture_injected_frame
            .store(true, std::sync::atomic::Ordering::Relaxed);
    }

    let skipped = ds
        .skipped_draws_frame
        .swap(0, std::sync::atomic::Ordering::Relaxed);
    if skipped > 0 {
        log::info!("rendering end → {} draws skipped", skipped);
    }

    if let Some(mut state) = CB_STATE.get_mut(&cb_key) {
        state.current_color_image = None;
        state.current_image_format = None;
        state.current_image_extent = None;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Phase 6: vkCmdDraw* hooks — skip HUD/skip shaders, log for discovery
//
//  When a config is loaded and the active pipeline matches a HUD or skip shader,
//  the draw call is NOT forwarded to the driver. This prevents the HUD from
//  being rendered to the color attachment. The nescapture capture at
//  vkCmdEndRenderPass then copies the clean (HUD-free) attachment.
//
//  In discovery mode (HUDLESS_DISCOVER=1), draws are never skipped.
// ─────────────────────────────────────────────────────────────────────────────

/// Check if the currently bound pipeline should be suppressed.
/// Returns (should_skip, vert_hash, frag_hash) so the caller doesn't need
/// to re-acquire the CB_STATE lock.
unsafe fn should_skip_draw(
    cb_key: u64,
    ds: &std::sync::Arc<crate::state::DeviceState>,
) -> (bool, Option<u64>, Option<u64>) {
    if discovery::is_discovery_mode() {
        return (false, None, None);
    }
    let shader_set = match &ds.shader_hashes {
        Some(s) => s,
        None => return (false, None, None),
    };
    let state = match CB_STATE.get(&cb_key) {
        Some(s) => s,
        None => return (false, None, None),
    };
    let vh = state.active_vert_hash;
    let fh = state.active_frag_hash;
    let skip = shader_set.is_hud_shader(vh, fh) || shader_set.is_skip_shader(fh);
    (skip, vh, fh)
}

/// Record that a draw was skipped (for diagnostics).
unsafe fn record_skipped_draw(
    ds: &crate::state::DeviceState,
    vert_hash: Option<u64>,
    frag_hash: Option<u64>,
) {
    ds.skipped_draws_frame
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    log::info!(
        "SKIPPING draw → vert={} frag={}",
        vert_hash
            .map(|h| format!("{:#018x}", h))
            .unwrap_or_else(|| "none".to_string()),
        frag_hash
            .map(|h| format!("{:#018x}", h))
            .unwrap_or_else(|| "none".to_string()),
    );
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkCmdDraw(
    command_buffer: vk::CommandBuffer,
    vertex_count: u32,
    instance_count: u32,
    first_vertex: u32,
    first_instance: u32,
) {
    let cb_key = command_buffer.as_raw();
    let device_key = match CMD_BUF_TO_DEVICE_KEY.get(&cb_key) {
        Some(r) => *r,
        None => return,
    };
    let ds = match DEVICE_STATE.get(&device_key) {
        Some(s) => s.clone(),
        None => return,
    };

    unsafe {
        let (skip, vh, fh) = should_skip_draw(cb_key, &ds);
        if skip {
            record_skipped_draw(&ds, vh, fh);
            discovery::record_draw(command_buffer, vertex_count);
            return;
        }

        (ds.fp.cmd_draw)(
            command_buffer,
            vertex_count,
            instance_count,
            first_vertex,
            first_instance,
        );

        discovery::record_draw(command_buffer, vertex_count);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkCmdDrawIndexed(
    command_buffer: vk::CommandBuffer,
    index_count: u32,
    instance_count: u32,
    first_index: u32,
    vertex_offset: i32,
    first_instance: u32,
) {
    let cb_key = command_buffer.as_raw();
    let device_key = match CMD_BUF_TO_DEVICE_KEY.get(&cb_key) {
        Some(r) => *r,
        None => return,
    };
    let ds = match DEVICE_STATE.get(&device_key) {
        Some(s) => s.clone(),
        None => return,
    };

    unsafe {
        let (skip, vh, fh) = should_skip_draw(cb_key, &ds);
        if skip {
            record_skipped_draw(&ds, vh, fh);
            discovery::record_draw(command_buffer, index_count);
            return;
        }

        (ds.fp.cmd_draw_indexed)(
            command_buffer,
            index_count,
            instance_count,
            first_index,
            vertex_offset,
            first_instance,
        );

        discovery::record_draw(command_buffer, index_count);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkCmdDrawIndirect(
    command_buffer: vk::CommandBuffer,
    buffer: vk::Buffer,
    offset: vk::DeviceSize,
    draw_count: u32,
    stride: u32,
) {
    let cb_key = command_buffer.as_raw();
    let device_key = match CMD_BUF_TO_DEVICE_KEY.get(&cb_key) {
        Some(r) => *r,
        None => return,
    };
    let ds = match DEVICE_STATE.get(&device_key) {
        Some(s) => s.clone(),
        None => return,
    };

    unsafe {
        let (skip, vh, fh) = should_skip_draw(cb_key, &ds);
        if skip {
            record_skipped_draw(&ds, vh, fh);
            discovery::record_draw(command_buffer, draw_count);
            return;
        }

        (ds.fp.cmd_draw_indirect)(command_buffer, buffer, offset, draw_count, stride);

        discovery::record_draw(command_buffer, draw_count);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkCmdDrawIndexedIndirect(
    command_buffer: vk::CommandBuffer,
    buffer: vk::Buffer,
    offset: vk::DeviceSize,
    draw_count: u32,
    stride: u32,
) {
    let cb_key = command_buffer.as_raw();
    let device_key = match CMD_BUF_TO_DEVICE_KEY.get(&cb_key) {
        Some(r) => *r,
        None => return,
    };
    let ds = match DEVICE_STATE.get(&device_key) {
        Some(s) => s.clone(),
        None => return,
    };

    unsafe {
        let (skip, vh, fh) = should_skip_draw(cb_key, &ds);
        if skip {
            record_skipped_draw(&ds, vh, fh);
            discovery::record_draw(command_buffer, draw_count);
            return;
        }

        (ds.fp.cmd_draw_indexed_indirect)(command_buffer, buffer, offset, draw_count, stride);

        discovery::record_draw(command_buffer, draw_count);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkCmdDrawIndirectCount(
    command_buffer: vk::CommandBuffer,
    buffer: vk::Buffer,
    offset: vk::DeviceSize,
    count_buffer: vk::Buffer,
    count_buffer_offset: vk::DeviceSize,
    max_draw_count: u32,
    stride: u32,
) {
    let cb_key = command_buffer.as_raw();
    let device_key = match CMD_BUF_TO_DEVICE_KEY.get(&cb_key) {
        Some(r) => *r,
        None => return,
    };
    let ds = match DEVICE_STATE.get(&device_key) {
        Some(s) => s.clone(),
        None => return,
    };

    unsafe {
        let (skip, vh, fh) = should_skip_draw(cb_key, &ds);
        if skip {
            record_skipped_draw(&ds, vh, fh);
            discovery::record_draw(command_buffer, max_draw_count);
            return;
        }

        if let Some(f) = ds.fp.cmd_draw_indirect_count {
            f(
                command_buffer,
                buffer,
                offset,
                count_buffer,
                count_buffer_offset,
                max_draw_count,
                stride,
            );
        }

        discovery::record_draw(command_buffer, max_draw_count);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkCmdDrawIndexedIndirectCount(
    command_buffer: vk::CommandBuffer,
    buffer: vk::Buffer,
    offset: vk::DeviceSize,
    count_buffer: vk::Buffer,
    count_buffer_offset: vk::DeviceSize,
    max_draw_count: u32,
    stride: u32,
) {
    let cb_key = command_buffer.as_raw();
    let device_key = match CMD_BUF_TO_DEVICE_KEY.get(&cb_key) {
        Some(r) => *r,
        None => return,
    };
    let ds = match DEVICE_STATE.get(&device_key) {
        Some(s) => s.clone(),
        None => return,
    };

    unsafe {
        let (skip, vh, fh) = should_skip_draw(cb_key, &ds);
        if skip {
            record_skipped_draw(&ds, vh, fh);
            discovery::record_draw(command_buffer, max_draw_count);
            return;
        }

        if let Some(f) = ds.fp.cmd_draw_indexed_indirect_count {
            f(
                command_buffer,
                buffer,
                offset,
                count_buffer,
                count_buffer_offset,
                max_draw_count,
                stride,
            );
        }

        discovery::record_draw(command_buffer, max_draw_count);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkCmdDrawIndirectCountKHR(
    command_buffer: vk::CommandBuffer,
    buffer: vk::Buffer,
    offset: vk::DeviceSize,
    count_buffer: vk::Buffer,
    count_buffer_offset: vk::DeviceSize,
    max_draw_count: u32,
    stride: u32,
) {
    unsafe {
        vkCmdDrawIndirectCount(
            command_buffer,
            buffer,
            offset,
            count_buffer,
            count_buffer_offset,
            max_draw_count,
            stride,
        );
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkCmdDrawIndexedIndirectCountKHR(
    command_buffer: vk::CommandBuffer,
    buffer: vk::Buffer,
    offset: vk::DeviceSize,
    count_buffer: vk::Buffer,
    count_buffer_offset: vk::DeviceSize,
    max_draw_count: u32,
    stride: u32,
) {
    unsafe {
        vkCmdDrawIndexedIndirectCount(
            command_buffer,
            buffer,
            offset,
            count_buffer,
            count_buffer_offset,
            max_draw_count,
            stride,
        );
    }
}
