// ─────────────────────────────────────────────────────────────────────────────
//  encode.rs — Vulkan Video hardware encoding + IPC transmission to neshub
//
//  ┌─────────────────── Zero-copy GPU pipeline ──────────────────────────────┐
//  │                                                                         │
//  │  Game VkDevice (intercepted by nescapture layer)                           │
//  │    vkCmdCopyImage(swapchain → final_image)   ← GPU, no CPU             │
//  │    get_dmabuf_fd(final_memory)               ← export fd               │
//  │                                                                         │
//  │  pixelforge VkDevice (separate, video-encode queue)                     │
//  │    DmaBufImporter::import_or_reuse(fd, ...)  ← import as vk::Image     │
//  │    ColorConverter::convert(bgra_img,          ← GPU compute shader      │
//  │                            encoder.input_image())   BGRA/RGB10/FP16    │
//  │                                                   → NV12/P010/YUV444   │
//  │    Encoder::encode(encoder.input_image())     ← Vulkan Video encode     │
//  │    IPC send to neshub                                                   │
//  └─────────────────────────────────────────────────────────────────────────┘
//
//  Environment variables
//  ──────────────────────
//  NESCAPTURE_CODEC         "h264" | "h265" | "av1"          (default: best available)
//  NESCAPTURE_FORMAT        "yuv420" | "yuv444"              (default: yuv420)
//  NESCAPTURE_DEPTH         "8" | "10"                       (default: auto from VkFormat)
//  NESCAPTURE_BITRATE       CBR target kbps                  (default: 10000)
//  NESCAPTURE_QP            Constant QP (overrides BITRATE)  (default: unset)
//  NESCAPTURE_FPS           Frame rate                       (default: 60)
//  NESCAPTURE_IDR_INTERVAL  Force IDR every N seconds        (default: 4)
//  NESCAPTURE_TUNE          "highquality" | "lowlatency" | "ultralowlatency" | "lossless" (default: unset)
//  NESCAPTURE_IPC_PATH      Unix socket path for hub IPC     (default: /tmp/nestri-video.sock)
// ─────────────────────────────────────────────────────────────────────────────

use anyhow::Result;
use std::os::unix::io::{AsRawFd, RawFd};
use std::os::unix::net::UnixDatagram;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, Ordering};
use std::sync::{Arc, mpsc};
use std::thread;
use std::time::Instant;

use nesprotocol::{
    CODEC_AV1, CODEC_H264, CODEC_H265, CODEC_KEEP, FLAG_KEYFRAME, FLAG_RECONFIG,
    MSG_ENCODE_SETTINGS, MSG_IDR_REQUEST, STREAM_VIDEO, decode_encode_settings, encode_ipc_frame,
};
use pixelforge::{
    Codec, ColorConverter, ColorConverterConfig, ColorDescription, ColorSpace, EncodeBitDepth,
    EncodeConfig, EncodeContentHint, EncodeFuture, EncodeUsageHint, Encoder, EncoderTuningMode,
    InputFormat, OutputFormat, PixelFormat, RateControlMode, VideoContextBuilder,
};

use crate::dmabuf_import::{DmaBufImporter, DmaBufPlane};

// ── VkColorSpaceKHR constants ────────────────────────────────────────────────
//
// Taken from `ash` rather than written out. They were transcribed by hand once
// and two of them were wrong: HDR10 ST2084 was given the value of extended-sRGB
// linear, and extended-sRGB linear the value of Display-P3 linear. Both are HDR
// entry points, so every HDR swapchain fell through to the SDR arm and was
// converted and tagged BT.709 — a silent, total loss of the colour volume the
// workload asked for. Deriving them here means a wrong value cannot be written.
const fn colorspace(c: ash::vk::ColorSpaceKHR) -> u32 {
    c.as_raw() as u32
}
const VK_COLOR_SPACE_SRGB_NONLINEAR_KHR: u32 = colorspace(ash::vk::ColorSpaceKHR::SRGB_NONLINEAR);
const VK_COLOR_SPACE_HDR10_ST2084_EXT: u32 = colorspace(ash::vk::ColorSpaceKHR::HDR10_ST2084_EXT);
const VK_COLOR_SPACE_EXTENDED_SRGB_LINEAR_EXT: u32 =
    colorspace(ash::vk::ColorSpaceKHR::EXTENDED_SRGB_LINEAR_EXT);
const VK_COLOR_SPACE_BT2020_LINEAR_EXT: u32 = colorspace(ash::vk::ColorSpaceKHR::BT2020_LINEAR_EXT);
const VK_COLOR_SPACE_DOLBYVISION_EXT: u32 = colorspace(ash::vk::ColorSpaceKHR::DOLBYVISION_EXT);
const VK_COLOR_SPACE_HDR10_HLG_EXT: u32 = colorspace(ash::vk::ColorSpaceKHR::HDR10_HLG_EXT);

pub fn vk_format_to_input_format(vk_format: u32) -> Option<InputFormat> {
    match vk_format {
        44..=50 => Some(InputFormat::BGRA),
        37..=43 => Some(InputFormat::RGBA),
        64 => Some(InputFormat::ABGR2101010),
        97 => Some(InputFormat::RGBA16F),
        other => {
            log::warn!("unsupported VkFormat {other} for color conversion — defaulting to BGRA");
            Some(InputFormat::BGRA)
        }
    }
}

pub fn vk_colorspace_to_color_space(vk_colorspace: u32) -> ColorSpace {
    match vk_colorspace {
        VK_COLOR_SPACE_HDR10_ST2084_EXT
        | VK_COLOR_SPACE_DOLBYVISION_EXT
        | VK_COLOR_SPACE_HDR10_HLG_EXT => ColorSpace::Bt2020,

        VK_COLOR_SPACE_EXTENDED_SRGB_LINEAR_EXT | VK_COLOR_SPACE_BT2020_LINEAR_EXT => {
            ColorSpace::SrgbToBt2020Pq
        }

        _ => ColorSpace::Bt709,
    }
}

pub fn vk_format_to_bit_depth(vk_format: u32) -> EncodeBitDepth {
    match vk_format {
        64 | 58 | 97 => EncodeBitDepth::Ten,
        _ => EncodeBitDepth::Eight,
    }
}

pub fn vk_colorspace_to_color_description(vk_colorspace: u32) -> Option<ColorDescription> {
    // Full range on every arm, because the converter is unconditionally full-range
    // (`set_full_range(true)` below) and the VUI has to agree with the shader that
    // wrote the samples. pixelforge's constructors default to limited range, so
    // leaving it off tags full-range luma as limited and every compliant decoder
    // expands it again — darkening midtones and clipping both ends.
    match vk_colorspace {
        VK_COLOR_SPACE_HDR10_ST2084_EXT
        | VK_COLOR_SPACE_DOLBYVISION_EXT
        | VK_COLOR_SPACE_HDR10_HLG_EXT => Some(full_range(ColorDescription::bt2020_pq())),
        _ => Some(full_range(ColorDescription::bt709())),
    }
}

/// pixelforge's `ColorDescription` constructors are limited-range; the capture
/// path is always full-range. The pinned revision has no builder for this, so the
/// field is set directly.
fn full_range(desc: ColorDescription) -> ColorDescription {
    ColorDescription {
        full_range: true,
        ..desc
    }
}

pub fn output_format(pixel_fmt: PixelFormat, bit_depth: EncodeBitDepth) -> OutputFormat {
    match (pixel_fmt, bit_depth) {
        (PixelFormat::Yuv420, EncodeBitDepth::Eight) => OutputFormat::NV12,
        (PixelFormat::Yuv420, EncodeBitDepth::Ten) => OutputFormat::P010,
        (PixelFormat::Yuv444, EncodeBitDepth::Eight) => OutputFormat::YUV444,
        (PixelFormat::Yuv444, EncodeBitDepth::Ten) => OutputFormat::YUV444P10,
        _ => OutputFormat::NV12,
    }
}

// ── Captured frame (sent from present.rs to encoder thread) ──────────────────

pub struct CapturedFrame {
    pub source: FrameSource,
    pub width: u32,
    pub height: u32,
    pub vk_format: u32,
    pub vk_colorspace: u32,
}

pub enum FrameSource {
    DmaBuf {
        fd: RawFd,
        stride: u32,
        modifier: u64,
    },
    Pixels(Vec<u8>),
}
impl Drop for FrameSource {
    fn drop(&mut self) {
        if let FrameSource::DmaBuf { fd, .. } = self {
            if *fd >= 0 {
                unsafe { libc::close(*fd) };
            }
        }
    }
}

// ── Codec probing ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HwCodec {
    H264,
    H265,
    AV1,
}

impl HwCodec {
    fn to_pixelforge(self) -> Codec {
        match self {
            Self::H264 => Codec::H264,
            Self::H265 => Codec::H265,
            Self::AV1 => Codec::AV1,
        }
    }

    fn to_protocol_codec(self) -> u8 {
        match self {
            Self::H264 => CODEC_H264,
            Self::H265 => CODEC_H265,
            Self::AV1 => CODEC_AV1,
        }
    }
}

fn probe_any() -> Option<(HwCodec, pixelforge::VideoContext)> {
    probe_specific(HwCodec::AV1)
        .or_else(|| probe_specific(HwCodec::H265))
        .or_else(|| probe_specific(HwCodec::H264))
}

fn probe_specific(codec: HwCodec) -> Option<(HwCodec, pixelforge::VideoContext)> {
    let ctx = VideoContextBuilder::new()
        .app_name("nescapture")
        .enable_validation(false)
        .require_encode(codec.to_pixelforge())
        .build()
        .ok()?;
    if ctx.supports_encode(codec.to_pixelforge()) {
        log::info!("hardware {:?} encode available", codec);
        Some((codec, ctx))
    } else {
        None
    }
}

fn resolve_codec(requested: Option<&str>) -> Option<(HwCodec, pixelforge::VideoContext)> {
    match requested {
        Some("av1") => probe_specific(HwCodec::AV1).or_else(|| {
            log::warn!("AV1 unavailable — falling back to H.264");
            probe_specific(HwCodec::H264)
        }),
        Some("h265" | "hevc") => probe_specific(HwCodec::H265).or_else(|| {
            log::warn!("H.265 unavailable — falling back to H.264");
            probe_specific(HwCodec::H264)
        }),
        Some("h264" | "avc") => probe_specific(HwCodec::H264),
        Some(other) => {
            log::warn!("unknown NESCAPTURE_CODEC={other} — probing best available");
            probe_any()
        }
        None => probe_any(),
    }
}

// ── Pipeline config ───────────────────────────────────────────────────────────

pub struct PipelineConfig {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate_kbps: Option<u32>,
    pub qp: Option<u32>,
    pub idr_interval: u32,
    pub encoder_tuning_mode: EncoderTuningMode,
    pub pixel_format: PixelFormat,
    pub codec_request: Option<String>,
    pub ipc_path: std::path::PathBuf,
    pub physical_device: Option<ash::vk::PhysicalDevice>,
}
impl PipelineConfig {
    pub fn from_env(width: u32, height: u32) -> Option<Self> {
        let pixel_format = match std::env::var("NESCAPTURE_FORMAT").as_deref() {
            Ok("yuv444") => PixelFormat::Yuv444,
            _ => PixelFormat::Yuv420,
        };

        let ipc_path = std::env::var("NESCAPTURE_IPC_PATH")
            .unwrap_or_else(|_| "/tmp/nestri-video.sock".to_string())
            .into();

        let mut bitrate: Option<u32> = None;
        if std::env::var("NESCAPTURE_QP").is_err() {
            bitrate = Some(env_u64("NESCAPTURE_BITRATE", 10_000) as u32);
        }

        let encoder_tuning_mode = match std::env::var("NESCAPTURE_TUNE").as_deref() {
            Ok("highquality") => EncoderTuningMode::HighQuality,
            Ok("lowlatency") => EncoderTuningMode::LowLatency,
            Ok("ultralowlatency") => EncoderTuningMode::UltraLowLatency,
            Ok("lossless") => EncoderTuningMode::Lossless,
            _ => EncoderTuningMode::Default,
        };

        Some(Self {
            width,
            height,
            fps: env_u64("NESCAPTURE_FPS", 60) as u32,
            bitrate_kbps: bitrate,
            qp: std::env::var("NESCAPTURE_QP")
                .ok()
                .and_then(|s| s.parse().ok()),
            idr_interval: (env_u64("NESCAPTURE_FPS", 60) * env_u64("NESCAPTURE_IDR_INTERVAL", 4))
                as u32,
            encoder_tuning_mode,
            pixel_format,
            codec_request: std::env::var("NESCAPTURE_CODEC").ok(),
            ipc_path,
            physical_device: None,
        })
    }
}

fn env_u64(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(default)
}

// ── Pipeline handle ───────────────────────────────────────────────────────────

pub struct PipelineHandle {
    frame_tx: mpsc::SyncSender<CapturedFrame>,
    idr_requested: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
    pub codec: HwCodec,
    pub capture_fps: Arc<AtomicU32>,
    pub encode_avg_ms: Arc<AtomicU32>,
    pub capture_ms: Arc<AtomicU32>,
    pub dropped_frames: Arc<AtomicU32>,
    pub present_attempts: Arc<AtomicU32>,
    pub capture_attempts: Arc<AtomicU32>,
}

impl PipelineHandle {
    pub fn new(config: PipelineConfig) -> Result<Self, String> {
        let (codec, ctx) = resolve_codec(config.codec_request.as_deref())
            .ok_or_else(|| "no hardware video encoder found on this GPU".to_string())?;

        let (frame_tx, frame_rx) = mpsc::sync_channel::<CapturedFrame>(2);
        let (encoded_tx, encoded_rx) = mpsc::sync_channel::<EncodeFuture>(2);
        let (reconfig_tx, reconfig_rx) = mpsc::channel::<EncodeSettingsChange>();
        let shutdown = Arc::new(AtomicBool::new(false));
        let idr_requested = Arc::new(AtomicBool::new(false));
        let capture_fps = Arc::new(AtomicU32::new(0));
        let encode_avg_ms = Arc::new(AtomicU32::new(0));
        let capture_ms = Arc::new(AtomicU32::new(0));
        let dropped_frames = Arc::new(AtomicU32::new(0));
        let present_attempts = Arc::new(AtomicU32::new(0));
        let capture_attempts = Arc::new(AtomicU32::new(0));
        let current_codec = Arc::new(AtomicU8::new(codec.to_protocol_codec()));
        let needs_reconfig_flag = Arc::new(AtomicBool::new(false));

        let enc_shutdown = shutdown.clone();
        let ipc_shutdown = shutdown.clone();

        let enc_cfg = EncoderConfig {
            width: config.width,
            height: config.height,
            fps: config.fps,
            bitrate_kbps: config.bitrate_kbps,
            qp: config.qp,
            idr_interval: config.idr_interval,
            encoder_tuning_mode: config.encoder_tuning_mode,
            pixel_format: config.pixel_format,
            codec,
            ctx,
            idr_requested: idr_requested.clone(),
            reconfig_rx,
            current_codec: current_codec.clone(),
            wanted_depth_override: None,
            needs_reconfig_flag: needs_reconfig_flag.clone(),
        };
        thread::Builder::new()
            .name("nescapture-encoder".into())
            .spawn(move || encoder_thread(enc_cfg, frame_rx, encoded_tx, enc_shutdown))
            .map_err(|e| format!("spawn encoder: {e}"))?;

        let ipc_path = config.ipc_path.clone();
        let ipc_cfg = IpcConfig {
            ipc_path: config.ipc_path,
            current_codec: current_codec.clone(),
            needs_reconfig_flag: needs_reconfig_flag,
            width: config.width as u16,
            height: config.height as u16,
            encode_ms: encode_avg_ms.clone(),
        };
        thread::Builder::new()
            .name("nescapture-ipc".into())
            .spawn(move || ipc_send_thread(ipc_cfg, encoded_rx, ipc_shutdown))
            .map_err(|e| format!("spawn ipc: {e}"))?;

        // Spawn periodic stats sender
        let stats_ipc = ipc_path.with_file_name("nestri-stats.sock");
        let stats_cap_fps = capture_fps.clone();
        let stats_enc_ms = encode_avg_ms.clone();
        let stats_cap_ms = capture_ms.clone();
        let stats_drop = dropped_frames.clone();
        let stats_shutdown = shutdown.clone();
        let pa = present_attempts.clone();
        let ca = capture_attempts.clone();
        thread::Builder::new()
            .name("nescapture-stats".into())
            .spawn(move || {
                stats_sender_thread(
                    stats_cap_fps,
                    stats_enc_ms,
                    stats_cap_ms,
                    stats_drop,
                    pa,
                    ca,
                    stats_ipc,
                    stats_shutdown,
                )
            })
            .map_err(|e| format!("spawn stats: {e}"))?;

        // Spawn IDR command listener (separate thread, blocks on recv)
        let idr_thread = idr_requested.clone();
        thread::Builder::new()
            .name("nescapture-idr".into())
            .spawn(move || {
                let cmd_path = std::path::PathBuf::from("/tmp/nescapture-cmd.sock");
                let _ = std::fs::remove_file(&cmd_path);
                let sock = match std::os::unix::net::UnixDatagram::bind(&cmd_path) {
                    Ok(s) => {
                        let _ = std::fs::set_permissions(
                            &cmd_path,
                            std::os::unix::fs::PermissionsExt::from_mode(0o666),
                        );
                        log::info!("cmd listener on {}", cmd_path.display());
                        s
                    }
                    Err(e) => {
                        log::warn!("cmd socket bind failed: {e}");
                        return;
                    }
                };
                let mut buf = [0u8; 128];
                loop {
                    match sock.recv(&mut buf) {
                        Ok(1) if buf[0] == MSG_IDR_REQUEST => {
                            log::info!("IDR requested by client");
                            idr_thread.store(true, Ordering::Relaxed);
                        }
                        Ok(n) if n >= 2 && buf[0] == MSG_ENCODE_SETTINGS => {
                            if let Some((codec_id, rc, value, depth)) =
                                decode_encode_settings(&buf[1..n])
                            {
                                let codec = match codec_id {
                                    CODEC_KEEP => None,
                                    CODEC_H264 => Some(HwCodec::H264),
                                    CODEC_H265 => Some(HwCodec::H265),
                                    CODEC_AV1 => Some(HwCodec::AV1),
                                    _ => {
                                        log::warn!(
                                            "unknown codec id {codec_id} in encode settings"
                                        );
                                        continue;
                                    }
                                };
                                let rate_control = match rc {
                                    0 => RateControlMode::Cbr,
                                    _ => RateControlMode::Cqp,
                                };
                                let bit_depth = depth.and_then(|d| match d {
                                    0 => Some(EncodeBitDepth::Eight),
                                    1 => Some(EncodeBitDepth::Ten),
                                    _ => None,
                                });
                                let change = EncodeSettingsChange {
                                    codec,
                                    rate_control_mode: rate_control,
                                    value,
                                    bit_depth,
                                };
                                if reconfig_tx.send(change).is_err() {
                                    log::warn!("reconfig channel closed, stopping cmd listener");
                                    break;
                                }
                            }
                        }
                        Err(e) => {
                            log::warn!("cmd listener error: {e}");
                            break;
                        }
                        _ => {}
                    }
                }
            })
            .map_err(|e| format!("spawn idr: {e}"))?;

        log::info!(
            "pipeline ready — {:?} {}x{} @ {}FPS {} -> {}",
            codec,
            config.width,
            config.height,
            config.fps,
            (if config.bitrate_kbps.is_some() {
                std::format!("- CBR: {}kbps", config.bitrate_kbps.unwrap())
            } else if config.qp.is_some() {
                std::format!("- QP: {}", config.qp.unwrap())
            } else {
                "".to_string()
            }),
            ipc_path.display(),
        );
        Ok(Self {
            frame_tx,
            idr_requested,
            shutdown,
            codec,
            capture_fps,
            encode_avg_ms,
            capture_ms,
            dropped_frames,
            present_attempts,
            capture_attempts,
        })
    }

    pub fn push_frame(&self, frame: CapturedFrame) -> bool {
        self.capture_fps.fetch_add(1, Ordering::Relaxed);
        let ok = self.frame_tx.try_send(frame).is_ok();
        if !ok {
            self.dropped_frames.fetch_add(1, Ordering::Relaxed);
        }
        ok
    }

    pub fn shutdown(&self) {
        self.shutdown.store(true, Ordering::SeqCst);
    }

    pub fn request_idr(&self) {
        self.idr_requested.store(true, Ordering::Relaxed);
    }
}
impl Drop for PipelineHandle {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Encoder thread
// ─────────────────────────────────────────────────────────────────────────────

struct EncoderConfig {
    width: u32,
    height: u32,
    fps: u32,
    bitrate_kbps: Option<u32>,
    qp: Option<u32>,
    idr_interval: u32,
    encoder_tuning_mode: EncoderTuningMode,
    pixel_format: PixelFormat,
    codec: HwCodec,
    ctx: pixelforge::VideoContext,
    idr_requested: Arc<AtomicBool>,
    reconfig_rx: mpsc::Receiver<EncodeSettingsChange>,
    current_codec: Arc<AtomicU8>,
    wanted_depth_override: Option<EncodeBitDepth>,
    needs_reconfig_flag: Arc<AtomicBool>,
}

struct EncodedPacket {
    data: Vec<u8>,
    is_key_frame: bool,
    frame_number: u32,
}

#[derive(Debug, Clone)]
pub struct EncodeSettingsChange {
    pub codec: Option<HwCodec>,
    pub rate_control_mode: RateControlMode,
    pub value: u32,
    pub bit_depth: Option<EncodeBitDepth>,
}

fn encoder_thread(
    mut cfg: EncoderConfig,
    frame_rx: mpsc::Receiver<CapturedFrame>,
    encoded_tx: mpsc::SyncSender<EncodeFuture>,
    shutdown: Arc<AtomicBool>,
) {
    let ctx = cfg.ctx;

    let mut encoder_state: Option<PerFrameEncoder> = None;

    let mut dmabuf_importer = match DmaBufImporter::new(ctx.clone()) {
        Ok(i) => Some(i),
        Err(e) => {
            log::warn!("DmaBufImporter init failed: {e} — GPU path unavailable");
            None
        }
    };

    let mut frame_number = 0u32;

    let wanted_depth = std::env::var("NESCAPTURE_DEPTH");

    loop {
        if shutdown.load(Ordering::Relaxed) {
            break;
        }

        // Check for dynamic encode settings changes
        if let Ok(change) = cfg.reconfig_rx.try_recv() {
            log::info!(
                "reconfig: codec={:?}, rc={:?}, value={}",
                change.codec,
                change.rate_control_mode,
                change.value,
            );
            match change.rate_control_mode {
                RateControlMode::Cbr => {
                    cfg.bitrate_kbps = Some(change.value);
                    cfg.qp = None;
                }
                RateControlMode::Cqp => {
                    cfg.bitrate_kbps = None;
                    cfg.qp = Some(change.value);
                }
                _ => {
                    log::warn!(
                        "unsupported rate control mode {:?}, keeping current",
                        change.rate_control_mode
                    );
                }
            }
            if let Some(codec) = change.codec {
                cfg.codec = codec;
            }
            if let Some(depth) = change.bit_depth {
                cfg.wanted_depth_override = Some(depth);
            }
            // Drop old encoder state to force re-creation with new settings
            encoder_state = None;
            // Signal IPC thread to set FLAG_RECONFIG on next frame
            cfg.needs_reconfig_flag.store(true, Ordering::Relaxed);
            // Update IPC thread with new codec
            cfg.current_codec
                .store(cfg.codec.to_protocol_codec(), Ordering::Relaxed);
            // Request IDR so first frame after reconfig has new SPS/PPS
            cfg.idr_requested.store(true, Ordering::Relaxed);
        }

        let mut raw = match frame_rx.recv_timeout(std::time::Duration::from_millis(100)) {
            Ok(frame) => frame,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };

        let bit_depth = if let Some(ov) = cfg.wanted_depth_override {
            ov
        } else {
            match wanted_depth.as_deref() {
                Ok("10") => EncodeBitDepth::Ten,
                Ok("8") => EncodeBitDepth::Eight,
                _ => vk_format_to_bit_depth(raw.vk_format),
            }
        };
        let input_fmt = vk_format_to_input_format(raw.vk_format).unwrap_or(InputFormat::BGRA);
        let color_space = vk_colorspace_to_color_space(raw.vk_colorspace);
        let out_fmt = output_format(cfg.pixel_format, bit_depth);

        let state = match encoder_state.as_mut() {
            Some(s) if s.bit_depth == bit_depth && s.pixel_format == cfg.pixel_format => s,
            _ => {
                let color_desc = vk_colorspace_to_color_description(raw.vk_colorspace);
                match PerFrameEncoder::new(
                    &ctx,
                    cfg.codec.to_pixelforge(),
                    cfg.width,
                    cfg.height,
                    cfg.fps,
                    cfg.bitrate_kbps,
                    cfg.qp,
                    cfg.idr_interval,
                    cfg.encoder_tuning_mode,
                    cfg.pixel_format,
                    bit_depth,
                    color_desc,
                    input_fmt,
                    out_fmt,
                    color_space,
                ) {
                    Ok(s) => {
                        encoder_state = Some(s);
                        encoder_state.as_mut().unwrap()
                    }
                    Err(e) => {
                        log::error!("encoder (re)init: {e}");
                        frame_number += 1;
                        continue;
                    }
                }
            }
        };

        let mut force_idr = cfg.idr_requested.swap(false, Ordering::Relaxed);
        if cfg.idr_interval > 0 {
            force_idr = force_idr || frame_number % cfg.idr_interval == 0;
        }
        if force_idr {
            state.encoder.request_idr();
        }

        let result = match &mut raw.source {
            FrameSource::DmaBuf {
                fd,
                stride,
                modifier,
            } => {
                let owned_fd = *fd;
                *fd = -1;
                match dmabuf_importer.as_mut() {
                    Some(importer) => gpu_encode_frame(
                        importer,
                        &mut state.converter,
                        &mut state.encoder,
                        owned_fd,
                        *stride,
                        *modifier,
                        raw.width,
                        raw.height,
                        raw.vk_format,
                        frame_number,
                    ),
                    None => {
                        unsafe { libc::close(owned_fd) };
                        log::warn!(
                            "DmaBuf fd available but importer is gone — skipping frame {frame_number}"
                        );
                        frame_number += 1;
                        continue;
                    }
                }
            }
            FrameSource::Pixels(pixels) => cpu_encode_frame(
                &ctx,
                &mut state.encoder,
                pixels,
                raw.width,
                raw.height,
                raw.vk_format,
            ),
        };

        match result {
            Err(e) => log::warn!("encode frame {frame_number}: {e}"),
            Ok(future) => {
                let _ = encoded_tx.try_send(future);
            }
        }

        frame_number += 1;
    }

    // Flush
    if let Some(state) = encoder_state.as_mut() {
        let _ = state.encoder.flush();
    }

    log::info!("encoder thread exited");
}

struct PerFrameEncoder {
    encoder: Encoder,
    converter: ColorConverter,
    bit_depth: EncodeBitDepth,
    pixel_format: PixelFormat,
}

impl PerFrameEncoder {
    #[allow(clippy::too_many_arguments)]
    fn new(
        ctx: &pixelforge::VideoContext,
        codec: Codec,
        width: u32,
        height: u32,
        fps: u32,
        bitrate_kbps: Option<u32>,
        qp: Option<u32>,
        idr_interval: u32,
        encoder_tuning_mode: EncoderTuningMode,
        pixel_format: PixelFormat,
        bit_depth: EncodeBitDepth,
        color_desc: Option<ColorDescription>,
        input_fmt: InputFormat,
        out_fmt: OutputFormat,
        color_space: ColorSpace,
    ) -> Result<Self, String> {
        log::info!(
            "(re)init encoder: {:?} {:?} {:?} {:?} → {:?}",
            codec,
            pixel_format,
            bit_depth,
            color_space,
            out_fmt
        );

        let mut enc_cfg = match codec {
            Codec::H264 => EncodeConfig::h264(width, height),
            Codec::H265 => EncodeConfig::h265(width, height),
            Codec::AV1 => EncodeConfig::av1(width, height),
        };
        enc_cfg = enc_cfg
            .with_frame_rate(fps, 1)
            .with_gop_size(idr_interval)
            .with_b_frames(0)
            .with_pixel_format(pixel_format)
            .with_bit_depth(bit_depth)
            .with_encode_usage_hint(EncodeUsageHint::Streaming)
            .with_encode_content_hint(EncodeContentHint::Rendered)
            .with_encoder_tuning_mode(encoder_tuning_mode);
        if let Some(desc) = color_desc {
            enc_cfg = enc_cfg.with_color_description(desc);
        } else {
            // GPU framebuffer captures are always full-range — use BT.709 full-range
            // so the decoder doesn't apply limited‑range expansion.
            enc_cfg = enc_cfg.with_color_description(full_range(ColorDescription::bt709()));
        }
        enc_cfg = if let Some(q) = qp {
            enc_cfg
                .with_rate_control(RateControlMode::Cqp)
                .with_quality_level(q)
        } else {
            if let Some(bitrate) = bitrate_kbps {
                enc_cfg
                    .with_rate_control(RateControlMode::Cbr)
                    .with_target_bitrate(bitrate * 1_000)
            } else {
                enc_cfg
                    .with_rate_control(RateControlMode::Cbr)
                    .with_target_bitrate(1000 * 1_000)
            }
        };

        let encoder =
            Encoder::new(ctx.clone(), enc_cfg).map_err(|e| format!("Encoder::new: {e}"))?;

        let conv_cfg =
            ColorConverterConfig::new(width, height, /*color_space,*/ input_fmt, out_fmt);

        let mut converter = ColorConverter::new(ctx.clone(), conv_cfg)
            .map_err(|e| format!("ColorConverter::new: {e}"))?;

        converter.set_full_range(true);

        Ok(Self {
            encoder,
            converter,
            bit_depth,
            pixel_format,
        })
    }
}

fn gpu_encode_frame(
    importer: &mut DmaBufImporter,
    converter: &mut ColorConverter,
    encoder: &mut Encoder,
    fd: RawFd,
    stride: u32,
    modifier: u64,
    width: u32,
    height: u32,
    vk_format: u32,
    frame_number: u32,
) -> Result<EncodeFuture> {
    use ash::vk;

    let bgra_vk_fmt = map_vk_format_raw(vk_format);

    let plane = DmaBufPlane {
        fd,
        offset: 0,
        stride,
        modifier,
    };

    let (imported_image, needs_layout_transition) = importer
        .import_or_reuse(0, width, height, bgra_vk_fmt, &[plane])
        .map_err(|e| anyhow::anyhow!("DmaBufImporter: {e}"))?;

    unsafe { libc::close(fd) };

    let src_layout = if needs_layout_transition {
        vk::ImageLayout::UNDEFINED
    } else {
        vk::ImageLayout::GENERAL
    };

    converter
        .convert(imported_image, src_layout, encoder.input_image())
        .map_err(|e| anyhow::anyhow!("ColorConverter::convert frame {frame_number}: {e}"))?;

    encoder
        .encode(encoder.input_image())
        .map_err(|e| anyhow::anyhow!("Encoder::encode frame {frame_number}: {e}"))
}

fn map_vk_format_raw(vk_format: u32) -> ash::vk::Format {
    ash::vk::Format::from_raw(vk_format as i32)
}

fn cpu_encode_frame(
    ctx: &pixelforge::VideoContext,
    encoder: &mut Encoder,
    pixels: &[u8],
    width: u32,
    height: u32,
    vk_format: u32,
) -> Result<EncodeFuture> {
    use pixelforge::{EncodeBitDepth, InputImage};

    let yuv = bgra_to_yuv420(pixels, width, height, vk_format);

    let mut input_image = InputImage::new(
        ctx.clone(),
        Codec::H264,
        width,
        height,
        EncodeBitDepth::Eight,
        PixelFormat::Yuv420,
    )
    .map_err(|e| anyhow::anyhow!("InputImage::new: {e}"))?;

    input_image
        .upload_yuv420_to(encoder.input_image(), &yuv)
        .map_err(|e| anyhow::anyhow!("upload_yuv420_to: {e}"))?;

    encoder
        .encode(encoder.input_image())
        .map_err(|e| anyhow::anyhow!("Encoder::encode (CPU path): {e}"))
}

fn bgra_to_yuv420(pixels: &[u8], width: u32, height: u32, vk_format: u32) -> Vec<u8> {
    let w = width as usize;
    let h = height as usize;
    let bgra = (44..=50).contains(&vk_format);
    let luma = w * h;
    let chroma = (w / 2) * (h / 2);
    let mut yuv = vec![0u8; luma + 2 * chroma];
    let (y, uv) = yuv.split_at_mut(luma);
    let (u, v) = uv.split_at_mut(chroma);
    for row in 0..h {
        for col in 0..w {
            let i = (row * w + col) * 4;
            if i + 2 >= pixels.len() {
                break;
            }
            let (r, g, b) = if bgra {
                (pixels[i + 2] as i32, pixels[i + 1] as i32, pixels[i] as i32)
            } else {
                (pixels[i] as i32, pixels[i + 1] as i32, pixels[i + 2] as i32)
            };
            y[row * w + col] = (((66 * r + 129 * g + 25 * b + 128) >> 8) + 16).clamp(16, 235) as u8;
            if row % 2 == 0 && col % 2 == 0 {
                let ci = (row / 2) * (w / 2) + col / 2;
                u[ci] = (((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128).clamp(16, 240) as u8;
                v[ci] = (((112 * r - 94 * g - 18 * b + 128) >> 8) + 128).clamp(16, 240) as u8;
            }
        }
    }
    yuv
}

// ─────────────────────────────────────────────────────────────────────────────
//  IPC send thread
// ─────────────────────────────────────────────────────────────────────────────

struct IpcConfig {
    ipc_path: std::path::PathBuf,
    current_codec: Arc<AtomicU8>,
    needs_reconfig_flag: Arc<AtomicBool>,
    width: u16,
    height: u16,
    encode_ms: Arc<AtomicU32>,
}

fn ipc_send_thread(
    cfg: IpcConfig,
    encoded_rx: mpsc::Receiver<EncodeFuture>,
    shutdown: Arc<AtomicBool>,
) {
    let socket = match UnixDatagram::unbound() {
        Ok(s) => {
            let so_sndbuf: libc::c_int = 4 * 1024 * 1024;
            unsafe {
                libc::setsockopt(
                    s.as_raw_fd(),
                    libc::SOL_SOCKET,
                    libc::SO_SNDBUF,
                    &so_sndbuf as *const _ as *const libc::c_void,
                    std::mem::size_of::<libc::c_int>() as libc::socklen_t,
                );
            }
            s
        }
        Err(e) => {
            log::error!("IPC socket create: {e}");
            return;
        }
    };

    let start_time = Instant::now();
    let mut frame_count: u64 = 0;

    'outer: loop {
        if shutdown.load(Ordering::Relaxed) {
            break;
        }

        // Connect to hub with retry
        loop {
            if shutdown.load(Ordering::Relaxed) {
                break 'outer;
            }
            match socket.connect(&cfg.ipc_path) {
                Ok(()) => {
                    log::info!("IPC connected → {}", cfg.ipc_path.display(),);
                    break;
                }
                Err(e) => {
                    log::warn!(
                        "IPC connect to {} failed (retrying in 2s): {e}",
                        cfg.ipc_path.display()
                    );
                    std::thread::sleep(std::time::Duration::from_secs(2));
                }
            }
        }

        // Send loop
        let mut last_warn = Instant::now();
        let mut error_count: u64 = 0;

        loop {
            if shutdown.load(Ordering::Relaxed) {
                break 'outer;
            }
            let result = match encoded_rx.recv_timeout(std::time::Duration::from_millis(100)) {
                Ok(p) => pollster::block_on(p),
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break 'outer,
            };
            let pkt = match result {
                Ok(p) => p,
                Err(e) => {
                    log::warn!("encoder future receive: {e}");
                    continue;
                }
            };

            if let Some(stats) = &pkt.stats {
                let enc_ms: f32 = (std::time::Duration::from_nanos(stats.gpu_time_ns).as_secs_f64()
                    * 1000.0) as f32;
                cfg.encode_ms.store(enc_ms.to_bits(), Ordering::Relaxed);
            }

            let timestamp_ms = start_time.elapsed().as_millis() as u32;
            let mut flags = if pkt.is_key_frame { FLAG_KEYFRAME } else { 0 };
            // Set FLAG_RECONFIG on the first frame after an encoder reconfig.
            // Clear it after setting so only the first frame is marked.
            if cfg.needs_reconfig_flag.swap(false, Ordering::Relaxed) {
                flags |= FLAG_RECONFIG;
            }
            let protocol_codec = cfg.current_codec.load(Ordering::Relaxed);

            let ipc_frame = encode_ipc_frame(
                STREAM_VIDEO,
                protocol_codec,
                flags,
                timestamp_ms,
                cfg.width,
                cfg.height,
                &pkt.data,
            );

            if let Err(e) = socket.send(&ipc_frame) {
                error_count += 1;
                if last_warn.elapsed() > std::time::Duration::from_secs(5) {
                    log::warn!("IPC send failed ({} frames dropped): {e}", error_count);
                    last_warn = Instant::now();
                }
                // Socket disconnected — reconnect
                log::warn!("IPC disconnected, reconnecting...");
                break;
            }

            frame_count += 1;
            if frame_count % 300 == 0 {
                log::trace!("IPC sent {frame_count} frames");
            }
        }
    }

    log::info!("IPC thread exited ({frame_count} frames)");
}

fn stats_sender_thread(
    capture_fps: Arc<AtomicU32>,
    encode_avg_ms: Arc<AtomicU32>,
    capture_ms: Arc<AtomicU32>,
    dropped_frames: Arc<AtomicU32>,
    present_attempts: Arc<AtomicU32>,
    capture_attempts: Arc<AtomicU32>,
    ipc_path: std::path::PathBuf,
    shutdown: Arc<AtomicBool>,
) {
    let socket = match std::os::unix::net::UnixDatagram::unbound() {
        Ok(s) => s,
        Err(e) => {
            log::error!("stats socket create: {e}");
            return;
        }
    };
    if socket.connect(&ipc_path).is_err() {
        log::warn!("stats socket connect failed, stats unavailable");
        return;
    }

    log::info!("stats sender → {}", ipc_path.display());

    loop {
        if shutdown.load(Ordering::Relaxed) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_secs(1));

        let raw_fps = capture_fps.load(Ordering::Relaxed);
        let fps = raw_fps.min(255) as u8;
        capture_fps.store(0, Ordering::Relaxed);
        let enc_bits = encode_avg_ms.swap(0, Ordering::Relaxed);
        let enc_ms = f32::from_bits(enc_bits);
        let cap_ms = f32::from_bits(capture_ms.swap(0, Ordering::Relaxed));
        let dropped = dropped_frames.swap(0, Ordering::Relaxed);
        let pa = present_attempts.swap(0, Ordering::Relaxed);
        let ca = capture_attempts.swap(0, Ordering::Relaxed);

        let mut buf = Vec::with_capacity(22);
        nesprotocol::stats::encode_hudless_stats(&mut buf, fps, enc_ms, dropped, pa, ca, cap_ms);
        let _ = socket.send(&buf);
    }

    log::info!("stats sender exited");
}

#[cfg(test)]
mod tests {
    use super::*;
    use ash::vk::ColorSpaceKHR as Cs;

    /// The colour space values were once written out by hand and two were wrong,
    /// which routed every HDR swapchain into the SDR arm silently. Deriving them
    /// from `ash` is the fix; this pins the behaviour that depended on them.
    #[test]
    fn hdr_colour_spaces_select_the_hdr_arm() {
        for cs in [
            Cs::HDR10_ST2084_EXT,
            Cs::DOLBYVISION_EXT,
            Cs::HDR10_HLG_EXT,
        ] {
            let raw = cs.as_raw() as u32;
            assert_eq!(
                vk_colorspace_to_color_space(raw),
                ColorSpace::Bt2020,
                "{cs:?} must convert as BT.2020, not BT.709"
            );
            let desc = vk_colorspace_to_color_description(raw).expect("a description");
            assert_eq!(desc, full_range(ColorDescription::bt2020_pq()), "{cs:?}");
        }
    }

    #[test]
    fn scrgb_and_bt2020_linear_select_the_pq_conversion() {
        for cs in [Cs::EXTENDED_SRGB_LINEAR_EXT, Cs::BT2020_LINEAR_EXT] {
            assert_eq!(
                vk_colorspace_to_color_space(cs.as_raw() as u32),
                ColorSpace::SrgbToBt2020Pq,
                "{cs:?}"
            );
        }
    }

    #[test]
    fn sdr_colour_spaces_stay_on_bt709() {
        for cs in [Cs::SRGB_NONLINEAR, Cs::PASS_THROUGH_EXT] {
            assert_eq!(
                vk_colorspace_to_color_space(cs.as_raw() as u32),
                ColorSpace::Bt709,
                "{cs:?}"
            );
        }
    }

    /// The converter is configured full-range unconditionally, so every colour
    /// description handed to the encoder has to say so. A limited-range tag over
    /// full-range samples is expanded again by the decoder.
    #[test]
    fn every_colour_description_is_full_range() {
        for cs in [
            Cs::SRGB_NONLINEAR,
            Cs::HDR10_ST2084_EXT,
            Cs::DOLBYVISION_EXT,
            Cs::HDR10_HLG_EXT,
            Cs::EXTENDED_SRGB_LINEAR_EXT,
            Cs::PASS_THROUGH_EXT,
        ] {
            let desc = vk_colorspace_to_color_description(cs.as_raw() as u32).expect("a description");
            assert!(desc.full_range, "{cs:?} produced a limited-range description");
        }
    }
}
