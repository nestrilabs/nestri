use crate::capture;
use crate::encode::{CapturedFrame, FrameSource, PipelineConfig, PipelineHandle};
use crate::slots::SlotGuard;
use crate::state::{DEVICE_STATE, QUEUE_TO_DEVICE_KEY};
use ash::vk::{self, Handle};
use std::os::raw::c_void;
use std::sync::atomic::Ordering;
use std::sync::mpsc;

/// A frame already blitted into a ring slot, waiting to be handed to the
/// encoder. The GPU work is submitted before this is queued, so the worker's
/// only job is to wait for it and export the buffer.
pub struct CaptureJob {
    pub ds_key: usize,
    /// Holds the ring slot until the encoder is finished with it.
    pub slot: SlotGuard,
    pub width: u32,
    pub height: u32,
    pub sc_fmt: vk::Format,
    /// When the game handed this frame to `vkQueuePresentKHR`. The only honest
    /// capture time — everything downstream is queued behind something.
    pub present_time: std::time::Instant,
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

    ds.frame_counter.fetch_add(1, Ordering::Relaxed);
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

    // Rewriting the wait semaphores is only well defined for a single
    // swapchain. A multi-swapchain present is rare enough that passing it
    // through untouched beats getting the interposition subtly wrong.
    let single_swapchain = pi.swapchain_count == 1
        && !pi.p_swapchains.is_null()
        && !pi.p_image_indices.is_null();

    let submission = if single_swapchain {
        unsafe { try_capture(&ds, queue, pi) }
    } else {
        None
    };

    let call_down = |info: *const vk::PresentInfoKHR| match ds.fp.queue_present_khr {
        Some(f) => unsafe { f(queue, info) },
        None => vk::Result::ERROR_EXTENSION_NOT_PRESENT,
    };

    let Some(submission) = submission else {
        return call_down(p_present_info);
    };

    // The blit consumed the application's wait semaphores, so the present waits
    // on ours instead. Presenting on the originals as well would be a second
    // wait on an already-consumed signal.
    let wait = submission.present_wait;
    let rewritten = vk::PresentInfoKHR {
        s_type: pi.s_type,
        p_next: pi.p_next,
        wait_semaphore_count: 1,
        p_wait_semaphores: &wait,
        swapchain_count: pi.swapchain_count,
        p_swapchains: pi.p_swapchains,
        p_image_indices: pi.p_image_indices,
        p_results: pi.p_results,
        _marker: std::marker::PhantomData,
    };

    let image_index = unsafe { *pi.p_image_indices } as usize;
    let result = call_down(&rewritten);

    // Only hand the frame on once the present has been accepted. A failed
    // present drops the job, which returns the slot.
    if matches!(result, vk::Result::SUCCESS | vk::Result::SUBOPTIMAL_KHR) {
        queue_for_encode(&ds, submission);
    } else {
        // The blit signalled this semaphore; whether the failed present waited
        // on it is undefined. Set it aside rather than signal it twice.
        capture::retire_present_semaphore(&ds, image_index);
    }

    result
}

/// Everything the present hook needs to carry from the blit to the worker.
struct Submission {
    slot: SlotGuard,
    present_wait: vk::Semaphore,
    width: u32,
    height: u32,
    sc_fmt: vk::Format,
    present_time: std::time::Instant,
}

unsafe fn try_capture(
    ds: &crate::state::DeviceState,
    queue: vk::Queue,
    pi: &vk::PresentInfoKHR,
) -> Option<Submission> {
    let image_index = unsafe { *pi.p_image_indices } as usize;
    let (sc_image, sc_fmt, sc_ext) = {
        let images = ds.swapchain_images.lock().ok()?;
        let fmt = *ds.swapchain_format.lock().ok()?;
        let ext = *ds.swapchain_extent.lock().ok()?;
        if image_index >= images.len() || ext.width == 0 || ext.height == 0 {
            return None;
        }
        (images[image_index], fmt, ext)
    };

    // Gate before any GPU work is queued. A game presenting faster than the
    // target would otherwise pay a full blit and DMA-BUF export for frames the
    // encoder throws away moments later.
    let present_time = std::time::Instant::now();
    let admitted = match ds.frame_gate.lock() {
        Ok(mut gate) => gate.admit(present_time),
        // A poisoned gate must not stop the stream; capture everything.
        Err(_) => true,
    };
    if !admitted {
        return None;
    }

    if let Ok(enc) = ds.encoder.lock() {
        if let Some(ref h) = *enc {
            h.capture_attempts.fetch_add(1, Ordering::Relaxed);
        }
    }

    let app_waits: &[vk::Semaphore] = if pi.wait_semaphore_count == 0 || pi.p_wait_semaphores.is_null()
    {
        &[]
    } else {
        unsafe {
            std::slice::from_raw_parts(pi.p_wait_semaphores, pi.wait_semaphore_count as usize)
        }
    };

    let submission = unsafe {
        capture::capture_present_frame(ds, queue, sc_image, sc_fmt, sc_ext, image_index, app_waits)
    }?;

    Some(Submission {
        slot: submission.slot,
        present_wait: submission.present_wait,
        width: sc_ext.width,
        height: sc_ext.height,
        sc_fmt,
        present_time,
    })
}

fn queue_for_encode(ds: &crate::state::DeviceState, submission: Submission) {
    let ds_key = unsafe { crate::dispatch_key(ds.raw.as_raw() as *const c_void) };

    {
        let mut ctx = match ds.capture_tx.lock() {
            Ok(c) => c,
            Err(_) => return,
        };
        if ctx.is_none() {
            let (tx, rx) = mpsc::channel();
            start_capture_worker(ds_key, rx);
            *ctx = Some(tx);
        }
        if let Some(tx) = ctx.as_ref() {
            // Unbounded, but bounded in practice: the ring hands out a fixed
            // number of slots and a job holds one for its whole life, so the
            // queue can never exceed the slot count.
            let _ = tx.send(CaptureJob {
                ds_key,
                slot: submission.slot,
                width: submission.width,
                height: submission.height,
                sc_fmt: submission.sc_fmt,
                present_time: submission.present_time,
            });
        }
    }
}

pub fn start_capture_worker(ds_key: usize, capture_rx: mpsc::Receiver<CaptureJob>) {
    std::thread::Builder::new()
        .name("nescapture-capture".into())
        .spawn(move || {
            while let Ok(job) = capture_rx.recv() {
                let ds = match DEVICE_STATE.get(&job.ds_key) {
                    Some(s) => s.clone(),
                    None => {
                        log::error!("capture worker: device state gone");
                        break;
                    }
                };

                // Copy the slot's handles out and release the ring lock before
                // waiting: the present hook needs that lock every frame and
                // must not queue behind a GPU wait.
                let Some((fence, dmabuf_fd, stride, image, memory)) = ({
                    let ring = ds.capture_ring.lock().unwrap();
                    ring.as_ref()
                        .and_then(|r| r.slots.get(job.slot.index()))
                        .map(|s| (s.fence, s.dmabuf_fd, s.stride, s.image, s.memory))
                }) else {
                    continue;
                };

                // The encoder reads this buffer from pixelforge's own VkDevice,
                // which shares no timeline with ours, so the handover has to be
                // on the CPU. Waiting here rather than in the present hook is
                // the whole point of the worker thread.
                let waited = unsafe {
                    (ds.fp.wait_for_fences)(ds.raw, 1, &fence, vk::TRUE, 1_000_000_000)
                };
                if waited != vk::Result::SUCCESS {
                    log::warn!("capture blit did not complete — frame dropped");
                    continue;
                }

                let source = if dmabuf_fd >= 0 {
                    let duped = unsafe { libc::dup(dmabuf_fd) };
                    if duped < 0 {
                        log::warn!("dup of capture DMA-BUF failed — frame dropped");
                        continue;
                    }
                    FrameSource::DmaBuf {
                        fd: duped,
                        stride,
                        modifier: 0,
                    }
                } else {
                    match unsafe {
                        capture::read_frame_pixels(&ds, image, memory, job.width, job.height)
                    } {
                        Some(p) if !p.is_empty() => FrameSource::Pixels(p),
                        _ => continue,
                    }
                };

                // Lazy-init encoder
                {
                    let mut enc = ds.encoder.lock().unwrap();
                    if enc.is_none() {
                        if let Some(cfg) = PipelineConfig::from_env(job.width, job.height) {
                            match PipelineHandle::new(cfg) {
                                Ok(h) => *enc = Some(h),
                                Err(e) => panic!("{e}"),
                            }
                        }
                    }
                }
                let enc_guard = ds.encoder.lock().unwrap();
                if let Some(ref encoder) = *enc_guard {
                    // Measured from the game's present, not from the start of
                    // this iteration: the wait above is part of what capture
                    // costs, and timing only the parts after it hid that.
                    let capture_elapsed = job.present_time.elapsed().as_secs_f32() * 1000.0;
                    encoder
                        .capture_ms
                        .store(capture_elapsed.to_bits(), Ordering::Relaxed);
                    encoder.push_frame(CapturedFrame {
                        source,
                        width: job.width,
                        height: job.height,
                        vk_format: job.sc_fmt.as_raw() as u32,
                        vk_colorspace: ds.swapchain_colorspace.load(Ordering::Relaxed),
                        present_time: job.present_time,
                        slot: Some(job.slot),
                    });
                }
            }
            log::info!("capture worker exiting");
        })
        .ok();
}
