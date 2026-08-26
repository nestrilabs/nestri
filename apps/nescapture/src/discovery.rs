// ─────────────────────────────────────────────────────────────────────────────
//  discovery.rs — Phase 6: per-draw logging for shader hash discovery
//
//  When HUDLESS_DISCOVER=1 is set, every vkCmdDraw* call is logged to:
//    /tmp/hudless_discover_$EXE.log
//
//  Log format:
//    frame=0001 draw=00042 vert=0x1a2b3c4d5e6f7890 frag=0xaabbccddeeff0011 verts=6   blend=true depth=false
//
//  HUD suspect heuristics:
//    - blend=true && depth_test=false → strong suspect (UI quads)
//    - verts <= 6 → two triangles = one quad
//    - Same pipeline reused many times per frame at low vertex count
// ─────────────────────────────────────────────────────────────────────────────

use crate::state::{CB_STATE, DEVICE_STATE};
use ash::vk::{self, Handle};
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Mutex;

static LOG_FILE: Mutex<Option<std::fs::File>> = Mutex::new(None);

pub fn is_discovery_mode() -> bool {
    std::env::var("NESCAPTURE_DISCOVER")
        .map(|v| v == "1")
        .unwrap_or(false)
}

fn ensure_log_file() -> bool {
    let mut guard = LOG_FILE.lock().unwrap();
    if guard.is_some() {
        return true;
    }

    let exe_name = std::env::var("NESCAPTURE_GAME_NAME").unwrap_or_else(|_| {
        std::fs::read_link("/proc/self/exe")
            .ok()
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
            .unwrap_or_else(|| "unknown".to_string())
    });

    let path = format!("/tmp/hudless_discover_{}.log", exe_name);
    match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(f) => {
            log::info!("discovery logging to {}", path);
            *guard = Some(f);
            true
        }
        Err(e) => {
            log::warn!("failed to open discovery log {}: {}", path, e);
            false
        }
    }
}

pub fn log_draw(
    frame: u64,
    draw: u32,
    vert_hash: Option<u64>,
    frag_hash: Option<u64>,
    vert_count: u32,
    blend_enabled: bool,
    depth_test_enabled: bool,
) {
    if !ensure_log_file() {
        return;
    }

    let mut guard = match LOG_FILE.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    let file = match guard.as_mut() {
        Some(f) => f,
        None => return,
    };

    let vert_str = vert_hash
        .map(|h| format!("{:#018x}", h))
        .unwrap_or_else(|| "none".to_string());
    let frag_str = frag_hash
        .map(|h| format!("{:#018x}", h))
        .unwrap_or_else(|| "none".to_string());

    let is_hud_suspect = blend_enabled && !depth_test_enabled && vert_count <= 6;

    let suspect_marker = if is_hud_suspect { " [SUSPECT]" } else { "" };

    let line = format!(
        "frame={:04} draw={:05} vert={} frag={} verts={:<5} blend={:<5} depth={}{}\n",
        frame,
        draw,
        vert_str,
        frag_str,
        vert_count,
        blend_enabled,
        depth_test_enabled,
        suspect_marker
    );

    let _ = file.write_all(line.as_bytes());
    let _ = file.flush();
}

pub unsafe fn record_draw(cb: vk::CommandBuffer, vert_count: u32) {
    if !is_discovery_mode() {
        return;
    }

    let cb_key = cb.as_raw();
    let device_key = match CB_STATE.get(&cb_key) {
        Some(r) => r.device_key,
        None => return,
    };

    let ds = match DEVICE_STATE.get(&device_key) {
        Some(s) => s,
        None => return,
    };

    let frame = ds.frame_counter.load(std::sync::atomic::Ordering::Relaxed);

    let (vert_hash, frag_hash, blend_enabled, depth_test_enabled) = {
        let state = match CB_STATE.get_mut(&cb_key) {
            Some(s) => s,
            None => return,
        };
        let draw = state.draw_counter + 1;

        let vert_hash = state.active_vert_hash;
        let frag_hash = state.active_frag_hash;

        let (blend_enabled, depth_test_enabled) = if let Some(active_frag) = frag_hash {
            let mut blend = false;
            let mut depth = false;
            for entry in ds.pipeline_state.iter() {
                if let Some(ph) = ds.pipeline_registry.get(entry.key()) {
                    if ph.frag_hash == Some(active_frag) {
                        blend = entry.value().blend_enabled;
                        depth = entry.value().depth_test_enabled;
                        break;
                    }
                }
            }
            (blend, depth)
        } else {
            (false, false)
        };

        drop(state);

        log_draw(
            frame,
            draw,
            vert_hash,
            frag_hash,
            vert_count,
            blend_enabled,
            depth_test_enabled,
        );

        (vert_hash, frag_hash, blend_enabled, depth_test_enabled)
    };
}
