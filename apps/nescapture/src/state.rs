// ─────────────────────────────────────────────────────────────────────────────
//  state.rs — global state shared across all hooks
// ─────────────────────────────────────────────────────────────────────────────

use crate::config::ShaderHashSet;
use crate::dispatch::NextDeviceFn;
use crate::encode::PipelineHandle;
use ash::vk;
use dashmap::DashMap;
use once_cell::sync::Lazy;
use std::sync::Arc;

/// How many frames may be in flight between the present hook and the encoder.
///
/// The path holds at most three at once — two queued for the encoder plus the
/// one it is working on — so four leaves a slot spare and the present hook
/// practically never finds the ring empty.
pub const CAPTURE_SLOTS: usize = 4;

/// One destination for the swapchain blit, with everything that belongs to it.
///
/// Every slot owns its image: the previous version rotated four command buffers
/// over a single shared destination, so a capture overwrote the frame the
/// encoder was still reading.
pub struct CaptureSlot {
    pub image: vk::Image,
    pub memory: vk::DeviceMemory,
    /// Exported once at allocation and duplicated per frame. -1 if the export
    /// failed, which sends that frame down the CPU readback path instead.
    pub dmabuf_fd: std::os::raw::c_int,
    pub stride: u32,
    /// Signalled when this slot's blit has finished reading the swapchain and
    /// writing the slot. The capture worker waits on it before handing the
    /// DMA-BUF to the encoder, which reads it from a different VkDevice and so
    /// cannot be synchronised with a semaphore.
    pub fence: vk::Fence,
}

pub struct CaptureRing {
    pub command_pool: vk::CommandPool,
    pub slots: Vec<CaptureSlot>,
    /// One command buffer per (swapchain image, slot) pair, recorded on first
    /// use and re-submitted from then on.
    ///
    /// The blit's contents depend on the source image, the destination image
    /// and the extent, and on nothing else — so recording it again every frame
    /// was work done on the game's own present thread for a result that never
    /// changed. Indexed by [`blit_index`].
    pub blits: Vec<vk::CommandBuffer>,
    /// Which entries of `blits` hold a valid recording.
    ///
    /// Cleared wholesale when the swapchain is recreated and when the extent
    /// changes: a recorded buffer names specific `VkImage` handles and bakes in
    /// the copy region, and a recreated swapchain's images are different
    /// objects at a possibly different size. Submitting a stale one reads freed
    /// memory.
    pub blits_recorded: Vec<bool>,
    /// How many swapchain images the ring allocated command buffers for.
    pub image_count: usize,
    /// The extent `blits` were recorded for.
    ///
    /// The ring is kept when the swapchain shrinks — `ensure_capture_ring`
    /// accepts a ring at least as large as the request — so the extent can
    /// change under a ring that is not rebuilt, and the recordings have to
    /// follow it even though the images do not.
    pub blit_extent: vk::Extent2D,
    pub size: (u32, u32, vk::Format),
    /// Queue family the command pool was created for. Command buffers may only
    /// be submitted to a queue of the family their pool belongs to, so a
    /// present arriving on a different family rebuilds the ring rather than
    /// submitting invalid work.
    pub queue_family: u32,
    /// Semaphores that were handed to a present which then failed.
    ///
    /// Whether such a present waited on the semaphore is unknowable, so it can
    /// neither be signalled again nor safely destroyed while it might still be
    /// pending. They are set aside here and destroyed with the device. A
    /// swapchain recreation retires at most one per image.
    pub retired: Vec<vk::Semaphore>,
    /// Signalled by the capture blit, waited on by the present that follows it.
    ///
    /// Indexed by *swapchain image index*, not by ring slot. A binary semaphore
    /// may not be re-signalled until its previous wait has completed, and the
    /// only guarantee of that available here is the application's own acquire:
    /// it cannot present image N again until it has reacquired it, and it
    /// cannot reacquire it until the present that waited on this semaphore is
    /// done.
    pub present_wait: Vec<vk::Semaphore>,
}

/// Index into [`CaptureRing::blits`] for one (swapchain image, slot) pair.
///
/// Flat rather than nested so the ring holds one `Vec` and takes one allocation
/// from the command pool. `None` when either index is out of range, which means
/// a swapchain that gained images under a ring built for fewer — a frame
/// skipped rather than a blit from an image the ring never saw.
pub fn blit_index(image_index: usize, slot: usize, image_count: usize) -> Option<usize> {
    if image_index >= image_count || slot >= CAPTURE_SLOTS {
        return None;
    }
    Some(image_index * CAPTURE_SLOTS + slot)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_image_and_slot_pair_has_its_own_index() {
        let mut seen = std::collections::HashSet::new();
        for image in 0..3 {
            for slot in 0..CAPTURE_SLOTS {
                let i = blit_index(image, slot, 3).expect("in range");
                assert!(seen.insert(i), "image {image} slot {slot} collided at {i}");
            }
        }
        assert_eq!(seen.len(), 3 * CAPTURE_SLOTS);
    }

    /// Every index must land inside a `Vec` of `image_count * CAPTURE_SLOTS`,
    /// which is what the ring allocates.
    #[test]
    fn indices_stay_inside_the_allocation() {
        let count = 4;
        for image in 0..count {
            for slot in 0..CAPTURE_SLOTS {
                let i = blit_index(image, slot, count).expect("in range");
                assert!(i < count * CAPTURE_SLOTS, "{i} is outside the allocation");
            }
        }
    }

    /// A swapchain recreated with more images than the ring was built for.
    /// Blitting from an image the ring never allocated a buffer for would
    /// submit whatever that slot happened to hold.
    #[test]
    fn an_out_of_range_image_or_slot_has_no_index() {
        assert_eq!(blit_index(3, 0, 3), None);
        assert_eq!(blit_index(0, CAPTURE_SLOTS, 3), None);
    }
}

// ── Per-pipeline records ──────────────────────────────────────────────────────

#[derive(Clone, Debug, Default)]
pub struct PipelineHashes {
    pub vert_hash: Option<u64>,
    pub frag_hash: Option<u64>,
}

#[derive(Clone, Debug, Default)]
pub struct PipelineState {
    pub blend_enabled: bool,
    pub depth_test_enabled: bool,
    pub depth_write_enabled: bool,
}

// ── Per-device state ──────────────────────────────────────────────────────────

pub struct DeviceState {
    pub raw: vk::Device,
    pub physical_device: vk::PhysicalDevice,
    pub fp: NextDeviceFn,

    // Phase 1: shader / pipeline
    pub shader_registry: DashMap<u64, u64>,
    pub pipeline_registry: DashMap<u64, PipelineHashes>,
    pub pipeline_state: DashMap<u64, PipelineState>,

    // Phase 2: view / framebuffer tracking
    pub view_to_image: DashMap<u64, u64>,
    pub view_format: DashMap<u64, vk::Format>,
    pub framebuffer_to_views: DashMap<u64, Vec<u64>>,
    pub framebuffer_extent: DashMap<u64, vk::Extent2D>,

    // Phase 3: shader hash config
    pub shader_hashes: Option<ShaderHashSet>,

    // Phase 4: HUDless capture (optional — HUDLESS_CAPTURE_HUDLESS=1)
    pub hudless_image: std::sync::Mutex<Option<vk::Image>>,
    pub hudless_memory: std::sync::Mutex<Option<vk::DeviceMemory>>,
    pub hudless_size: std::sync::Mutex<(u32, u32, vk::Format)>,

    // Phase 4: final-frame capture (DMA-BUF exportable)
    pub capture_ring: std::sync::Mutex<Option<CaptureRing>>,
    /// Which ring slots are free. Held separately from the ring itself so a
    /// slot can be returned from the encoder thread without taking the lock
    /// the present hook needs.
    pub capture_slots: Arc<crate::slots::SlotPool>,

    // Phase 4: swapchain tracking
    pub swapchain: std::sync::Mutex<Option<vk::SwapchainKHR>>,
    pub swapchain_images: std::sync::Mutex<Vec<vk::Image>>,
    pub swapchain_format: std::sync::Mutex<vk::Format>,
    /// Raw `VkColorSpaceKHR` value, captured from vkCreateSwapchainKHR.
    /// Used to derive color space for the encoder (SDR vs HDR10 etc.).
    pub swapchain_colorspace: std::sync::atomic::AtomicU32,
    pub swapchain_extent: std::sync::Mutex<vk::Extent2D>,
    /// Whether the swapchain was created with TRANSFER_SRC usage. When the
    /// driver refuses it the layer falls back to the application's own usage
    /// flags, and blitting from those images would be undefined — so capture
    /// stays off for the life of that swapchain.
    pub swapchain_transfer_src: std::sync::atomic::AtomicBool,

    pub frame_counter: std::sync::atomic::AtomicU64,

    // Phase 3/4: per-frame HUD detection flags
    pub hud_detected_frame: std::sync::atomic::AtomicBool,
    pub pending_capture_frame: std::sync::atomic::AtomicBool,
    pub capture_injected_frame: std::sync::atomic::AtomicBool,
    pub skipped_draws_frame: std::sync::atomic::AtomicU32,

    // Phase 7: encode + IPC pipeline (lazy-init on first frame)
    pub encoder: std::sync::Mutex<Option<PipelineHandle>>,


    // ── Frame-rate throttle ───────────────────────────────────────────
    /// Decides which presented frames are worth capturing. Consulted in the
    /// present hook, before any GPU work is queued, so a dropped frame costs
    /// nothing beyond the comparison.
    pub frame_gate: std::sync::Mutex<crate::pacing::FrameGate>,
    /// Channel for threaded capture worker (present → worker).
    pub capture_tx: std::sync::Mutex<Option<std::sync::mpsc::Sender<crate::present::CaptureJob>>>,
}

// ── Per-command-buffer state ──────────────────────────────────────────────────

#[derive(Default, Clone)]
pub struct CbState {
    pub device_key: usize,

    pub current_color_image: Option<vk::Image>,
    pub current_image_format: Option<vk::Format>,
    pub current_image_extent: Option<vk::Extent2D>,

    pub active_vert_hash: Option<u64>,
    pub active_frag_hash: Option<u64>,
    pub hud_captured: bool,

    pub pending_capture: bool,
    pub capture_injected: bool,
    pub hud_detected: bool,

    pub draw_counter: u32,
}

// ── Global state ──────────────────────────────────────────────────────────────

pub static INSTANCE_STATE: Lazy<DashMap<usize, Arc<crate::dispatch::NextInstanceFn>>> =
    Lazy::new(DashMap::new);

pub static DEVICE_STATE: Lazy<DashMap<usize, Arc<DeviceState>>> = Lazy::new(DashMap::new);

pub static CB_STATE: Lazy<DashMap<u64, CbState>> = Lazy::new(DashMap::new);

/// VkQueue → device dispatch key
pub static QUEUE_TO_DEVICE_KEY: Lazy<DashMap<u64, usize>> = Lazy::new(DashMap::new);

/// VkQueue → queue family index, recorded at vkGetDeviceQueue.
pub static QUEUE_TO_FAMILY: Lazy<DashMap<u64, u32>> = Lazy::new(DashMap::new);

/// VkCommandBuffer → device dispatch key
pub static CMD_BUF_TO_DEVICE_KEY: Lazy<DashMap<u64, usize>> = Lazy::new(DashMap::new);
