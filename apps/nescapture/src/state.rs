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
    pub command_buffer: vk::CommandBuffer,
    /// Signalled when this slot's blit has finished reading the swapchain and
    /// writing the slot. The capture worker waits on it before handing the
    /// DMA-BUF to the encoder, which reads it from a different VkDevice and so
    /// cannot be synchronised with a semaphore.
    pub fence: vk::Fence,
}

pub struct CaptureRing {
    pub command_pool: vk::CommandPool,
    pub slots: Vec<CaptureSlot>,
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
    pub largest_extent: std::sync::Mutex<vk::Extent2D>,

    // Phase 3/4: per-frame HUD detection flags
    pub hud_detected_frame: std::sync::atomic::AtomicBool,
    pub pending_capture_frame: std::sync::atomic::AtomicBool,
    pub capture_injected_frame: std::sync::atomic::AtomicBool,
    pub skipped_draws_frame: std::sync::atomic::AtomicU32,

    // Phase 7: encode + IPC pipeline (lazy-init on first frame)
    pub encoder: std::sync::Mutex<Option<PipelineHandle>>,

    /// Dedicated queue for capture submissions (separate from game rendering).
    pub capture_queue: std::sync::Mutex<vk::Queue>,
    // Fake swapchain pool (headless — no real present)
    pub fake_images: std::sync::Mutex<Vec<vk::Image>>,
    pub fake_memories: std::sync::Mutex<Vec<vk::DeviceMemory>>,
    pub fake_fds: std::sync::Mutex<Vec<std::os::raw::c_int>>,
    pub fake_strides: std::sync::Mutex<Vec<u32>>,
    pub fake_available: std::sync::Mutex<Vec<bool>>,
    pub fake_image_count: std::sync::atomic::AtomicU32,
    pub fake_swapchain: std::sync::Mutex<Option<vk::SwapchainKHR>>,
    pub signal_queue: std::sync::Mutex<vk::Queue>,
    pub next_acquire: std::sync::atomic::AtomicU32,
    pub memory_properties: std::sync::Mutex<vk::PhysicalDeviceMemoryProperties>,
    pub acquire_dummy_pool: std::sync::Mutex<vk::CommandPool>,
    pub acquire_dummy_cb: std::sync::Mutex<vk::CommandBuffer>,

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
