use crate::capture;
use crate::encode::{CapturedFrame, FrameSource, PipelineConfig, PipelineHandle};
use crate::state::{DEVICE_STATE, QUEUE_TO_DEVICE_KEY};
use ash::vk::{self, Handle};
use std::os::raw::c_void;
use std::sync::atomic::Ordering;
use std::sync::mpsc;

pub struct CaptureJob {
    pub queue: vk::Queue,
    pub sc_image: vk::Image,
    pub sc_fmt: vk::Format,
    pub sc_ext: vk::Extent2D,
    pub frame: u64,
    pub ds_key: usize,
}

#[unsafe(no_mangle)]
pub unsafe extern "system" fn vkQueuePresentKHR(
    queue: vk::Queue,
    p_present_info: *const vk::PresentInfoKHR,
) -> vk::Result {
    let ds = {
        let dk = unsafe { crate::dispatch_key(queue.as_raw() as *const c_void) };
        DEVICE_STATE
            .get(&dk)
            .map(|r| r.clone())
            .or_else(|| {
                QUEUE_TO_DEVICE_KEY
                    .get(&queue.as_raw())
                    .and_then(|dk| DEVICE_STATE.get(dk.value()).map(|r| r.clone()))
            })
            .or_else(|| DEVICE_STATE.iter().next().map(|e| e.value().clone()))
    };
    let ds = match ds {
        Some(d) => d,
        None => return vk::Result::ERROR_DEVICE_LOST,
    };

    let frame = ds.frame_counter.fetch_add(1, Ordering::Relaxed);
    ds.hud_detected_frame.store(false, Ordering::Relaxed);
    ds.pending_capture_frame.store(false, Ordering::Relaxed);
    ds.capture_injected_frame.store(false, Ordering::Relaxed);
    ds.skipped_draws_frame.store(0, Ordering::Relaxed);

    if let Ok(enc) = ds.encoder.lock() {
        if let Some(ref h) = *enc {
            h.present_attempts.fetch_add(1, Ordering::Relaxed);
        }
    }

    let pi = unsafe { &*p_present_info };
    if pi.swapchain_count > 0 && !pi.p_swapchains.is_null() && !pi.p_image_indices.is_null() {
        let idx = unsafe { *pi.p_image_indices as usize };
        let (sc_image, sc_fmt, sc_ext) = {
            let images = ds.swapchain_images.lock().unwrap();
            let fmt = *ds.swapchain_format.lock().unwrap();
            let ext = *ds.swapchain_extent.lock().unwrap();
            if idx < images.len() && ext.width > 0 && ext.height > 0 {
                (Some(images[idx]), fmt, ext)
            } else {
                (None, fmt, ext)
            }
        };

        if let Some(sc_image) = sc_image {
            // No time-based throttle — let the encoder channel provide natural backpressure
            let should = true;

            if should {
                if let Ok(enc) = ds.encoder.lock() {
                    if let Some(ref h) = *enc {
                        h.capture_attempts.fetch_add(1, Ordering::Relaxed);
                    }
                }
                // Ensure capture worker is running
                {
                    let mut ctx = ds.capture_tx.lock().unwrap();
                    if ctx.is_none() {
                        let (tx, rx) = mpsc::channel();
                        let key = unsafe { crate::dispatch_key(ds.raw.as_raw() as *const c_void) };
                        start_capture_worker(key, rx);
                        *ctx = Some(tx);
                    }
                }
                // Queue job to worker thread — don't block present
                let job = CaptureJob {
                    queue,
                    sc_image,
                    sc_fmt,
                    sc_ext,
                    frame,
                    ds_key: unsafe { crate::dispatch_key(ds.raw.as_raw() as *const c_void) },
                };
                if let Ok(capture_tx) = ds.capture_tx.lock() {
                    let _ = capture_tx.as_ref().unwrap().send(job);
                }
            }
        }
    }

    match ds.fp.queue_present_khr {
        Some(f) => unsafe { f(queue, p_present_info) },
        None => vk::Result::ERROR_EXTENSION_NOT_PRESENT,
    }
}

pub fn start_capture_worker(ds_key: usize, capture_rx: mpsc::Receiver<CaptureJob>) {
    std::thread::Builder::new()
        .name("nescapture-capture".into())
        .spawn(move || {
            while let Ok(job) = capture_rx.recv() {
                let t0 = std::time::Instant::now();
                let ds = match DEVICE_STATE.get(&job.ds_key) {
                    Some(s) => s.clone(),
                    None => {
                        log::error!("capture worker: device state gone");
                        break;
                    }
                };
                // Do the blit on the worker's own time
                unsafe {
                    capture::capture_final_frame(
                        &ds,
                        job.queue,
                        job.sc_image,
                        job.sc_fmt,
                        job.sc_ext,
                        job.frame,
                    )
                };

                // Export DMA-BUF and push to encoder
                let source = {
                    let mem_guard = ds.final_memory.lock().unwrap();
                    let stride = ds.final_stride.load(Ordering::Relaxed);
                    if let Some(mem) = *mem_guard {
                        unsafe { try_make_dmabuf_source(&ds, mem, stride) }.unwrap_or_else(|| {
                            let (w, h, _) = *ds.final_size.lock().unwrap();
                            let img = ds.final_image.lock().unwrap().unwrap();
                            unsafe { capture::read_frame_pixels(&ds, img, mem, w, h) }
                                .map(FrameSource::Pixels)
                                .unwrap_or(FrameSource::Pixels(Vec::new()))
                        })
                    } else {
                        continue;
                    }
                };

                let (w, h, _) = *ds.final_size.lock().unwrap();
                if !matches!(&source, FrameSource::Pixels(p) if p.is_empty()) {
                    // Lazy-init encoder
                    {
                        let mut enc = ds.encoder.lock().unwrap();
                        if enc.is_none() {
                            if let Some(cfg) = PipelineConfig::from_env(w, h) {
                                ds.target_fps.store(cfg.fps, Ordering::Relaxed);
                                match PipelineHandle::new(cfg) {
                                    Ok(h) => *enc = Some(h),
                                    Err(e) => panic!("{e}"),
                                }
                            }
                        }
                    }
                    let enc_guard = ds.encoder.lock().unwrap();
                    if let Some(ref encoder) = *enc_guard {
                        let capture_elapsed = t0.elapsed().as_secs_f32() * 1000.0;
                        encoder
                            .capture_ms
                            .store(capture_elapsed.to_bits(), Ordering::Relaxed);
                        encoder.push_frame(CapturedFrame {
                            source,
                            width: w,
                            height: h,
                            vk_format: job.sc_fmt.as_raw() as u32,
                            vk_colorspace: ds.swapchain_colorspace.load(Ordering::Relaxed),
                        });
                    }
                }
            }
            log::info!("capture worker exiting");
        })
        .ok();
}

unsafe fn try_make_dmabuf_source(
    ds: &crate::state::DeviceState,
    mem: vk::DeviceMemory,
    stride: u32,
) -> Option<FrameSource> {
    let cached = ds.cached_dmabuf_fd.load(Ordering::Relaxed);
    let fd = if cached >= 0 {
        let duped = unsafe { libc::dup(cached) };
        if duped >= 0 {
            duped
        } else {
            let fresh = unsafe { capture::get_dmabuf_fd(ds, mem)? };
            ds.cached_dmabuf_fd.store(fresh, Ordering::Relaxed);
            unsafe { libc::dup(fresh) }
        }
    } else {
        let fresh = unsafe { capture::get_dmabuf_fd(ds, mem)? };
        ds.cached_dmabuf_fd.store(fresh, Ordering::Relaxed);
        unsafe { libc::dup(fresh) }
    };
    if fd < 0 {
        return None;
    }
    Some(FrameSource::DmaBuf {
        fd,
        stride,
        modifier: 0,
    })
}
