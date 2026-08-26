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

// Holds capture-specific resources instead of re-creating them *each frame*
pub struct CaptureResources {
    pub command_pool: vk::CommandPool,
    pub command_buffers: [vk::CommandBuffer; 4],
    pub fences: [vk::Fence; 4],
    pub current: usize,
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
    pub final_image: std::sync::Mutex<Option<vk::Image>>,
    pub final_memory: std::sync::Mutex<Option<vk::DeviceMemory>>,
    pub final_size: std::sync::Mutex<(u32, u32, vk::Format)>,
    /// Row stride in bytes of `final_image`, queried once after allocation.
    /// Zero until the first frame is captured.
    pub final_stride: std::sync::atomic::AtomicU32,

    // Phase 4: swapchain tracking
    pub swapchain: std::sync::Mutex<Option<vk::SwapchainKHR>>,
    pub swapchain_images: std::sync::Mutex<Vec<vk::Image>>,
    pub swapchain_format: std::sync::Mutex<vk::Format>,
    /// Raw `VkColorSpaceKHR` value, captured from vkCreateSwapchainKHR.
    /// Used to derive color space for the encoder (SDR vs HDR10 etc.).
    pub swapchain_colorspace: std::sync::atomic::AtomicU32,
    pub swapchain_extent: std::sync::Mutex<vk::Extent2D>,

    pub frame_counter: std::sync::atomic::AtomicU64,
    pub largest_extent: std::sync::Mutex<vk::Extent2D>,

    // Phase 3/4: per-frame HUD detection flags
    pub hud_detected_frame: std::sync::atomic::AtomicBool,
    pub pending_capture_frame: std::sync::atomic::AtomicBool,
    pub capture_injected_frame: std::sync::atomic::AtomicBool,
    pub skipped_draws_frame: std::sync::atomic::AtomicU32,

    // Phase 7: encode + IPC pipeline (lazy-init on first frame)
    pub encoder: std::sync::Mutex<Option<PipelineHandle>>,

    // Re-usable capture resources (double-buffered)
    pub capture_resources: std::sync::Mutex<Option<CaptureResources>>,
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
    /// Cached DMA-BUF fd for final_memory (-1 = not cached).
    /// Avoids a kernel ioctl per frame.
    pub cached_dmabuf_fd: std::sync::atomic::AtomicI32,

    // ── Frame-rate throttle ───────────────────────────────────────────
    /// Target FPS for capture throttling (set from HUDLESS_FPS on pipeline init).
    pub target_fps: std::sync::atomic::AtomicU32,
    /// Timestamp of last captured frame (for rate limiting).
    pub last_capture_time: std::sync::Mutex<Option<std::time::Instant>>,
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

/// VkCommandBuffer → device dispatch key
pub static CMD_BUF_TO_DEVICE_KEY: Lazy<DashMap<u64, usize>> = Lazy::new(DashMap::new);
