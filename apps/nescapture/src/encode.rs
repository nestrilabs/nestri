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
    Codec, ColorConverter, ColorConverterConfig, ColorRange, ColorSpec, EncodeBitDepth,
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
const VK_COLOR_SPACE_HDR10_HLG_EXT: u32 = colorspace(ash::vk::ColorSpaceKHR::HDR10_HLG_EXT);

/// The converter input format for a swapchain's `VkFormat`, or `None` when
/// there is no correct one.
///
/// `None` rather than a default on purpose. This used to fall back to BGRA,
/// which reads a packed 10-bit or FP16 buffer as eight-bit channels and
/// produces a stream that arrives at the right size and frame rate carrying
/// nonsense — the failure nobody notices. Refusing the frame is louder.
///
/// `A2R10G10B10_UNORM_PACK32` (58) is the notable absence, and it is reachable:
/// a WSI layer offers it as one of its HDR pairs and the compositor's dmabuf
/// list advertises it too. The converter has no red-first 10-bit input, so
/// there is nothing correct to map it to.
pub fn vk_format_to_input_format(vk_format: u32) -> Option<InputFormat> {
    match vk_format {
        44..=50 => Some(InputFormat::BGRA),
        37..=43 => Some(InputFormat::RGBA),
        // VK_FORMAT_A2B10G10R10_UNORM_PACK32
        64 => Some(InputFormat::ABGR2101010),
        // VK_FORMAT_R16G16B16A16_SFLOAT
        97 => Some(InputFormat::RGBA16F),
        _ => None,
    }
}

/// What a swapchain's pixels already are, from its `VkColorSpaceKHR`.
///
/// Only the source. What the stream should be is a separate decision --
/// [`stream_spec`] -- and keeping them apart is what fixed `BT2020_LINEAR_EXT`:
/// with one fused source-to-target enum there was no arm for linear light on
/// BT.2020 primaries, so it borrowed scRGB's and took a gamut error to avoid a
/// gamma one. Now it says what it is.
pub fn vk_colorspace_to_source_spec(vk_colorspace: u32) -> ColorSpec {
    match vk_colorspace {
        VK_COLOR_SPACE_HDR10_ST2084_EXT | VK_COLOR_SPACE_HDR10_HLG_EXT => ColorSpec::Bt2020Pq,
        // Linear, so no inverse sRGB EOTF on the way out -- applying one would
        // decode data that was never encoded.
        VK_COLOR_SPACE_EXTENDED_SRGB_LINEAR_EXT => ColorSpec::Bt709Linear,
        VK_COLOR_SPACE_BT2020_LINEAR_EXT => ColorSpec::Bt2020Linear,
        _ => ColorSpec::Srgb,
    }
}

/// What to encode a given source as.
///
/// Video has no way to record that it holds linear light, so neither linear
/// space can be a target -- [`ColorSpec::is_encodable`] says as much. Anything
/// wide or linear goes out as HDR10; everything else stays SDR.
pub fn stream_spec(source: ColorSpec) -> ColorSpec {
    match source {
        ColorSpec::Srgb => ColorSpec::Srgb,
        ColorSpec::Bt709Linear | ColorSpec::Bt2020Linear | ColorSpec::Bt2020Pq => {
            ColorSpec::Bt2020Pq
        }
    }
}

/// The converter configuration for one capture.
///
/// One place decides source, target and range, and the colour description the
/// encoder declares is then derived from this same value rather than matched
/// separately -- so the matrix the shader applies and the one the VUI announces
/// cannot disagree.
pub fn converter_config(
    width: u32,
    height: u32,
    input_fmt: InputFormat,
    out_fmt: OutputFormat,
    vk_colorspace: u32,
) -> ColorConverterConfig {
    let source = vk_colorspace_to_source_spec(vk_colorspace);
    ColorConverterConfig::new(
        width,
        height,
        input_fmt,
        out_fmt,
        source,
        stream_spec(source),
        // Capture is always full-range, and the description derived from this
        // config says so. A limited-range tag over full-range samples is
        // expanded again by the decoder.
        ColorRange::Full,
    )
}

/// Bit depth implied by a converter input format.
///
/// Taken from the input format rather than matched against the `VkFormat` a
/// second time. The two matches had drifted: `A2R10G10B10` counted as ten-bit
/// here while the input-format mapping above had no entry for it and fell back
/// to eight-bit BGRA, so the encoder was configured for ten-bit while the
/// converter read the buffer as eight. Deriving one from the other makes that
/// particular disagreement unrepresentable.
pub fn input_format_bit_depth(input_fmt: InputFormat) -> EncodeBitDepth {
    match input_fmt {
        InputFormat::ABGR2101010 | InputFormat::RGBA16F => EncodeBitDepth::Ten,
        _ => EncodeBitDepth::Eight,
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
    /// Which device this frame's slot belongs to.
    ///
    /// The encoder thread needs it to reach the fence and the exported fd: it
    /// now does the waiting that a separate capture thread used to do, and that
    /// work is per-device.
    pub ds_key: usize,
    /// Which capture ring the slot belongs to.
    ///
    /// Carried so the encoder's DMA-BUF import cache can tell one ring's slot
    /// from the next one's. Both are slot 0; only one of them still exists.
    pub ring_generation: u64,
    pub width: u32,
    pub height: u32,
    pub vk_format: u32,
    pub vk_colorspace: u32,
    /// When the game presented this frame. Carried all the way to the wire so
    /// the timestamp describes the frame rather than the encoder's backlog.
    pub present_time: Instant,
    /// Reserves the capture ring slot this frame's DMA-BUF lives in. Dropping
    /// the frame — encoded, skipped, or abandoned — returns the slot, so the
    /// present hook can never blit over a buffer the encoder is still reading.
    pub slot: Option<crate::slots::SlotGuard>,
}

/// An encode in flight, with the time of the present it came from.
struct EncodedFrame {
    future: EncodeFuture,
    present_time: Instant,
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
    /// Where each present's time went, split three ways. Diagnostic.
    pub timing: Arc<crate::timing::PresentTiming>,
}

impl PipelineHandle {
    pub fn new(config: PipelineConfig) -> Result<Self, String> {
        let (codec, ctx) = resolve_codec(config.codec_request.as_deref())
            .ok_or_else(|| "no hardware video encoder found on this GPU".to_string())?;

        // One deep. The frame in it is now an unwaited blit rather than an
        // exported buffer, and the ring's four slots are already the
        // backpressure — a second layer of queue only adds latency.
        let (frame_tx, frame_rx) = mpsc::sync_channel::<CapturedFrame>(1);
        let (encoded_tx, encoded_rx) = mpsc::sync_channel::<EncodedFrame>(2);
        let (reconfig_tx, reconfig_rx) = mpsc::channel::<EncodeSettingsChange>();
        let shutdown = Arc::new(AtomicBool::new(false));
        let idr_requested = Arc::new(AtomicBool::new(false));
        let capture_fps = Arc::new(AtomicU32::new(0));
        let encode_avg_ms = Arc::new(AtomicU32::new(0));
        let capture_ms = Arc::new(AtomicU32::new(0));
        let dropped_frames = Arc::new(AtomicU32::new(0));
        let present_attempts = Arc::new(AtomicU32::new(0));
        let capture_attempts = Arc::new(AtomicU32::new(0));
        let timing = Arc::new(crate::timing::PresentTiming::default());
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
            capture_ms: capture_ms.clone(),
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
            idr_requested: idr_requested.clone(),
            epoch: Instant::now(),
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
        let stats_timing = timing.clone();
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
                    stats_timing,
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
            timing,
        })
    }

    pub fn push_frame(&self, frame: CapturedFrame) -> bool {
        // Counted on success only. It used to be incremented before the send,
        // so a frame the channel refused was reported both as captured and as
        // dropped, and the capture rate read as the rate the ring offered
        // rather than the rate the encoder accepted — which is the number
        // anyone reading it wants.
        match self.frame_tx.try_send(frame) {
            Ok(()) => {
                self.capture_fps.fetch_add(1, Ordering::Relaxed);
                true
            }
            Err(_) => {
                self.dropped_frames.fetch_add(1, Ordering::Relaxed);
                false
            }
        }
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
    /// Present-to-encoder latency in milliseconds, as `f32` bits. Written here
    /// now that this thread is the one doing the waiting.
    capture_ms: Arc<AtomicU32>,
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
    encoded_tx: mpsc::SyncSender<EncodedFrame>,
    shutdown: Arc<AtomicBool>,
) {
    let ctx = cfg.ctx;

    let mut encoder_state: Option<PerFrameEncoder> = None;
    // Last VkFormat we refused, so the error is logged on change rather than
    // once per frame.
    let mut unsupported_format: Option<u32> = None;

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
            // A bitrate is the one setting that can move without rebuilding
            // anything, and it is the one that moves most often -- a congestion
            // controller adjusts it continuously, and every rebuild costs an IDR.
            // An IDR is the largest frame there is, so paying one per adjustment
            // would spend the most on the path least able to afford it, at the
            // exact moment it is struggling. Everything else here -- a codec, a
            // bit depth, a rate-control *mode* -- changes the video session
            // itself and cannot avoid the rebuild.
            if let Some(kbps) = bitrate_only_change(
                &change,
                cfg.bitrate_kbps,
                cfg.codec,
                cfg.wanted_depth_override,
            ) && let Some(state) = encoder_state.as_mut()
            {
                match state.encoder.set_target_bitrate(kbps * 1_000) {
                    Ok(()) => {
                        cfg.bitrate_kbps = Some(kbps);
                        // Same reasoning as the hub's own line: a controller
                        // tracking a moving path retunes every second.
                        log::trace!("bitrate → {kbps} kbps (no rebuild, no IDR)");
                        continue;
                    }
                    // Refused means this encode has no bitrate to retarget, so
                    // fall through and rebuild it as one that does.
                    Err(e) => log::info!("live retune refused ({e}), rebuilding"),
                }
            }
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

        let raw = match frame_rx.recv_timeout(std::time::Duration::from_millis(100)) {
            Ok(frame) => frame,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };

        // Wait for the blit and export the buffer. This used to be a thread of
        // its own between the present hook and here; it is cheaper on this one,
        // because the blit it waits for was submitted a frame earlier and has
        // already completed, and every frame saves a channel and a wakeup.
        let Some(ds) = crate::state::DEVICE_STATE
            .get(&raw.ds_key)
            .map(|s| s.clone())
        else {
            log::error!("encoder: device state gone");
            break;
        };
        let Some(mut source) = crate::present::resolve_source(&ds, &raw) else {
            continue;
        };

        // Measured from the game's present, not from the top of this iteration:
        // the wait above is part of what capture costs.
        let capture_elapsed = raw.present_time.elapsed().as_secs_f32() * 1000.0;
        cfg.capture_ms
            .store(capture_elapsed.to_bits(), Ordering::Relaxed);

        let Some(input_fmt) = vk_format_to_input_format(raw.vk_format) else {
            // Drop the frame rather than encode it wrongly. Logged once per
            // format so a persistent mismatch says so without filling the log
            // sixty times a second.
            if unsupported_format.replace(raw.vk_format) != Some(raw.vk_format) {
                log::error!(
                    "VkFormat {} has no colour-conversion input format — dropping frames. \
                     The stream will stall rather than carry wrong colour.",
                    raw.vk_format
                );
            }
            continue;
        };

        let bit_depth = if let Some(ov) = cfg.wanted_depth_override {
            ov
        } else {
            match wanted_depth.as_deref() {
                Ok("10") => EncodeBitDepth::Ten,
                Ok("8") => EncodeBitDepth::Eight,
                _ => input_format_bit_depth(input_fmt),
            }
        };
        let out_fmt = output_format(cfg.pixel_format, bit_depth);

        // The geometry joins the guard. It used to be absent, and `cfg.width` /
        // `cfg.height` were whatever the *first* frame happened to be, so a game
        // that changed resolution kept being encoded at the old one: shrinking
        // left a band of the previous picture down the right edge and along the
        // bottom, and growing had no surface large enough to hold the frame.
        let state = match encoder_state.as_mut() {
            Some(s)
                if encoder_still_serves(
                    (s.width, s.height, s.bit_depth, s.pixel_format),
                    (raw.width, raw.height, bit_depth, cfg.pixel_format),
                ) =>
            {
                s
            }
            _ => {
                if let Some(old) = encoder_state.as_ref()
                    && (old.width != raw.width || old.height != raw.height)
                {
                    log::info!(
                        "resolution changed {}x{} -> {}x{}, rebuilding the encoder",
                        old.width,
                        old.height,
                        raw.width,
                        raw.height,
                    );
                }
                match PerFrameEncoder::new(
                    &ctx,
                    cfg.codec.to_pixelforge(),
                    raw.width,
                    raw.height,
                    cfg.fps,
                    cfg.bitrate_kbps,
                    cfg.qp,
                    cfg.idr_interval,
                    cfg.encoder_tuning_mode,
                    cfg.pixel_format,
                    bit_depth,
                    input_fmt,
                    out_fmt,
                    raw.vk_colorspace,
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

        // Each ring slot is a distinct DMA-BUF, so the importer caches an
        // imported image per slot. Importing every frame under index 0 would
        // have handed the encoder whichever buffer happened to be imported
        // first, for every frame after it.
        let buffer_index = raw.slot.as_ref().map(|s| s.index()).unwrap_or(0);

        let result = match &mut source {
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
                        buffer_index,
                        raw.ring_generation,
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
                pixels.as_slice(),
                raw.width,
                raw.height,
                raw.vk_format,
            ),
        };

        match result {
            Err(e) => log::warn!("encode frame {frame_number}: {e}"),
            Ok(future) => {
                // Blocking, deliberately. Dropping an encoded frame does not
                // just waste the encode — it breaks the reference chain. The
                // encoder's DPB believes the frame exists and codes later
                // frames against it, so a decoder that never receives it shows
                // corruption until the next IDR. Blocking here pushes back
                // through `frame_rx` to `push_frame`, where a drop is free:
                // that frame never entered the encoder and no later frame
                // refers to it.
                let pending = EncodedFrame {
                    future,
                    present_time: raw.present_time,
                };
                if encoded_tx.send(pending).is_err() {
                    break;
                }
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
    /// The geometry this encoder and its converter were built for.
    ///
    /// A Vulkan video session pins its coded extent at creation and the
    /// converter is sized to match, so a frame of a different size cannot be
    /// encoded by either -- it has to be rebuilt.
    width: u32,
    height: u32,
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
        input_fmt: InputFormat,
        out_fmt: OutputFormat,
        vk_colorspace: u32,
    ) -> Result<Self, String> {
        let source = vk_colorspace_to_source_spec(vk_colorspace);
        log::info!(
            "(re)init encoder: {codec:?} {width}x{height} {pixel_format:?} {bit_depth:?} \
             {source:?} → {:?} {out_fmt:?}",
            stream_spec(source),
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
        // Derived from the conversion rather than matched separately: the VUI
        // has to describe what the shader actually wrote, and two independent
        // matches on the same input drift the moment one gains an arm the other
        // does not. `color_description` answers from the same source, target and
        // range the converter is about to be built with.
        let conv_cfg = converter_config(width, height, input_fmt, out_fmt, vk_colorspace);
        enc_cfg =
            enc_cfg.with_color_description(conv_cfg.color_description().ok_or_else(|| {
                format!("colour space {vk_colorspace} has no encodable stream description")
            })?);
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

        let converter = ColorConverter::new(ctx.clone(), conv_cfg)
            .map_err(|e| format!("ColorConverter::new: {e}"))?;

        Ok(Self {
            encoder,
            converter,
            bit_depth,
            pixel_format,
            width,
            height,
        })
    }
}

/// The new target in kbps when a settings change is nothing but a bitrate.
///
/// `None` when anything else moved, in which case the session has to be rebuilt.
/// The comparisons against the running configuration matter: the debug overlay
/// sends every field on every apply, so a change that only moved the slider
/// still arrives carrying a codec and a bit depth. Treating those as changes
/// would rebuild the encoder -- and emit an IDR -- every time somebody nudged
/// the bitrate.
fn bitrate_only_change(
    change: &EncodeSettingsChange,
    current_bitrate_kbps: Option<u32>,
    current_codec: HwCodec,
    current_depth_override: Option<EncodeBitDepth>,
) -> Option<u32> {
    if change.rate_control_mode != RateControlMode::Cbr {
        return None;
    }
    // Already under a bitrate. Coming *from* constant QP is a mode change, and
    // the session was built for the other one.
    current_bitrate_kbps?;
    if change.codec.is_some_and(|c| c != current_codec) {
        return None;
    }
    if change
        .bit_depth
        .is_some_and(|d| Some(d) != current_depth_override)
    {
        return None;
    }
    Some(change.value)
}

/// Whether an existing encoder can take this frame, or has to be rebuilt.
///
/// **The geometry is part of the answer**, and it used to be missing. A Vulkan
/// video session pins its coded extent when it is created and the colour
/// converter is sized to match, so neither can take a frame of another size --
/// but the guard only compared bit depth and pixel format, and the dimensions
/// it built with came from whatever the *first* frame happened to be. A game
/// that changed resolution went on being encoded at the old one.
fn encoder_still_serves(
    existing: (u32, u32, EncodeBitDepth, PixelFormat),
    wanted: (u32, u32, EncodeBitDepth, PixelFormat),
) -> bool {
    existing == wanted
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
    buffer_index: usize,
    ring_generation: u64,
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
        .import_or_reuse(
            ring_generation,
            buffer_index,
            width,
            height,
            bgra_vk_fmt,
            &[plane],
        )
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

    // This path reads four bytes per pixel and encodes eight-bit, so it can
    // only handle the eight-bit formats. A packed 10-bit buffer would be read
    // as eight-bit channels and an FP16 one is twice the size with float
    // samples; both produce a plausible-looking stream of nonsense. Refuse
    // instead -- an error here is recoverable, a corrupt stream is not
    // noticeable.
    if !matches!(
        vk_format_to_input_format(vk_format),
        Some(InputFormat::BGRA | InputFormat::RGBA | InputFormat::BGRx | InputFormat::RGBx)
    ) {
        anyhow::bail!(
            "CPU encode fallback cannot read VkFormat {vk_format}; it handles \
             eight-bit RGBA/BGRA only"
        );
    }

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
                (pixels[i + 2] as f32, pixels[i + 1] as f32, pixels[i] as f32)
            } else {
                (pixels[i] as f32, pixels[i + 1] as f32, pixels[i + 2] as f32)
            };
            // BT.709, full range — the same thing the GPU converter is configured
            // to produce and the same thing the stream's colour description
            // declares. This used to be BT.601 limited range, which disagreed with
            // the declaration on both counts: a decoder expanded 16-235 that was
            // never compressed, using the wrong matrix to do it. The fallback is
            // rare enough that nobody would have noticed it looking different
            // from the GPU path.
            let yf = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            y[row * w + col] = yf.round().clamp(0.0, 255.0) as u8;
            if row % 2 == 0 && col % 2 == 0 {
                let ci = (row / 2) * (w / 2) + col / 2;
                // Cb, Cr from the same primaries: (B-Y)/(2(1-Kb)), (R-Y)/(2(1-Kr)).
                u[ci] = ((b - yf) / 1.8556 + 128.0).round().clamp(0.0, 255.0) as u8;
                v[ci] = ((r - yf) / 1.5748 + 128.0).round().clamp(0.0, 255.0) as u8;
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
    /// Shared with the encoder thread, which honours it on the next frame.
    idr_requested: Arc<AtomicBool>,
    /// Zero point for wire timestamps.
    epoch: Instant,
}

fn ipc_send_thread(
    cfg: IpcConfig,
    encoded_rx: mpsc::Receiver<EncodedFrame>,
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

    // Fixed before the first frame arrives, so every timestamp shares an epoch
    // even though frames are stamped from their own present.
    let start_time = cfg.epoch;
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

        // Where this loop's time goes, per second.
        //
        // `encode` in the rate line is the encoder's own GPU time for whichever
        // frame happened to be last, which is not the same thing as how long a
        // frame took to get out of here. This loop is serial — wait for the
        // encoder, build the IPC frame, write the socket — so a spike in any of
        // the three delays every frame behind it. A client measured video
        // datagrams stopping for 43 ms at a time while the present path stayed
        // under 30 ms and audio was untouched, which puts the missing 13 ms
        // somewhere in here, and averages cannot show which part.
        let mut last_out = Instant::now();
        let mut worst_out_gap = std::time::Duration::ZERO;
        let mut worst_queued = std::time::Duration::ZERO;
        let mut worst_awaited = std::time::Duration::ZERO;
        let mut worst_send = std::time::Duration::ZERO;
        let mut worst_key_wait = std::time::Duration::ZERO;
        let mut keyframes: u32 = 0;
        let mut last_pace = Instant::now();

        loop {
            if shutdown.load(Ordering::Relaxed) {
                break 'outer;
            }
            // Timed apart, because they are different faults with different
            // fixes and one number cannot tell them apart. `queued` is this
            // loop waiting for the capture side to submit anything at all;
            // `awaited` is the encoder finishing work already submitted. A
            // single timer around both reported 40 ms and named neither.
            let recv_start = Instant::now();
            let pending = match encoded_rx.recv_timeout(std::time::Duration::from_millis(100)) {
                Ok(p) => p,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break 'outer,
            };
            let queued = recv_start.elapsed();
            let present_time = pending.present_time;
            let encode_start = Instant::now();
            let result = pollster::block_on(pending.future);
            let awaited = encode_start.elapsed();
            let waited = queued + awaited;
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

            // From the present, not from here. Stamping at send time folded
            // however long the frame spent queued for the encoder into the
            // timestamp, so the receiver could not tell capture time from
            // backlog and had nothing honest to pace on.
            let timestamp_ms = present_time
                .saturating_duration_since(start_time)
                .as_millis() as u32;
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

            if pkt.is_key_frame {
                keyframes += 1;
                worst_key_wait = worst_key_wait.max(waited);
            }
            worst_queued = worst_queued.max(queued);
            worst_awaited = worst_awaited.max(awaited);

            let send_start = Instant::now();
            if let Err(e) = socket.send(&ipc_frame) {
                error_count += 1;
                if last_warn.elapsed() > std::time::Duration::from_secs(5) {
                    log::warn!("IPC send failed ({} frames dropped): {e}", error_count);
                    last_warn = Instant::now();
                }
                // Socket disconnected — reconnect. The frames lost while it
                // was down are gone from the reference chain, so ask for an
                // IDR rather than resuming into a stream the receiver cannot
                // reconstruct.
                cfg.idr_requested.store(true, Ordering::Relaxed);
                log::warn!("IPC disconnected, reconnecting...");
                break;
            }

            worst_send = worst_send.max(send_start.elapsed());
            let out = Instant::now();
            worst_out_gap = worst_out_gap.max(out.duration_since(last_out));
            last_out = out;

            if last_pace.elapsed() >= std::time::Duration::from_secs(1) {
                last_pace = Instant::now();
                log::trace!(
                    "ipc: worst gap between frames out {:.1}ms = worst wait for a \
                     submission {:.1}ms + worst wait for the encoder {:.1}ms, worst \
                     socket send {:.1}ms, {keyframes} keyframe(s) (worst wait on one \
                     {:.1}ms)",
                    worst_out_gap.as_secs_f64() * 1000.0,
                    worst_queued.as_secs_f64() * 1000.0,
                    worst_awaited.as_secs_f64() * 1000.0,
                    worst_send.as_secs_f64() * 1000.0,
                    worst_key_wait.as_secs_f64() * 1000.0,
                );
                worst_out_gap = std::time::Duration::ZERO;
                worst_queued = std::time::Duration::ZERO;
                worst_awaited = std::time::Duration::ZERO;
                worst_send = std::time::Duration::ZERO;
                worst_key_wait = std::time::Duration::ZERO;
                keyframes = 0;
            }

            frame_count += 1;
            if frame_count % 300 == 0 {
                log::trace!("IPC sent {frame_count} frames");
            }
        }
    }

    log::info!("IPC thread exited ({frame_count} frames)");
}

/// Microseconds this box spent stalled on one resource, cumulative since boot.
///
/// `/proc/pressure/<kind>` reports two totals: `some` is time at least one task
/// was blocked on the resource, `full` is time *every* runnable task was. For a
/// stall a player sees, `some` is the one that matters -- the render thread is
/// one task, and it being blocked is enough.
///
/// Returns `None` when the kernel was built without `CONFIG_PSI` or it is off,
/// which is a thing to say once rather than to retry every second.
fn pressure_total_us(kind: &str) -> Option<(u64, u64)> {
    let text = std::fs::read_to_string(format!("/proc/pressure/{kind}")).ok()?;
    let mut some = None;
    let mut full = None;
    for line in text.lines() {
        let total = line
            .split_whitespace()
            .find_map(|f| f.strip_prefix("total="))
            .and_then(|v| v.parse::<u64>().ok());
        if line.starts_with("some") {
            some = total;
        } else if line.starts_with("full") {
            full = total;
        }
    }
    // `cpu` has no `full` line on most kernels, so its absence is not a failure.
    Some((some?, full.unwrap_or(0)))
}

fn stats_sender_thread(
    capture_fps: Arc<AtomicU32>,
    encode_avg_ms: Arc<AtomicU32>,
    capture_ms: Arc<AtomicU32>,
    dropped_frames: Arc<AtomicU32>,
    present_attempts: Arc<AtomicU32>,
    capture_attempts: Arc<AtomicU32>,
    timing: Arc<crate::timing::PresentTiming>,
    ipc_path: std::path::PathBuf,
    shutdown: Arc<AtomicBool>,
) {
    // Optional, where it used to end the thread. The socket only exists when a
    // hub is listening, and this thread now also writes the per-second rate line
    // that says where frames are going — which is wanted most in exactly the
    // bare runs that have no hub.
    let socket = match std::os::unix::net::UnixDatagram::unbound() {
        Ok(s) if s.connect(&ipc_path).is_ok() => {
            log::info!("stats sender → {}", ipc_path.display());
            Some(s)
        }
        Ok(_) => {
            log::warn!("stats socket connect failed; rates are logged but not sent to the hub");
            None
        }
        Err(e) => {
            log::error!("stats socket create: {e}; rates are logged only");
            None
        }
    };

    // What the box itself was stalled on, second by second.
    //
    // Every stage of the pipeline has now been measured and is clean; what is
    // left is the game's own frame time, which spikes to 29 ms about once a
    // second in one title and never in another on the identical path. That is
    // no longer a question about this code, and guessing at it from outside is
    // how a week goes. The kernel already knows: PSI attributes a stall to cpu,
    // io or memory, and the answer decides whether to look at the host's
    // scheduling, the guest's storage, or its memory sizing.
    let mut prev_pressure: Option<[(u64, u64); 3]> = None;
    let mut pressure_said_missing = false;

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

        let starved = crate::slots::SLOT_STARVED.swap(0, Ordering::Relaxed);

        // Logged as well as sent, because the socket goes to the desktop app
        // and the question this answers is asked from inside the container.
        // The three rates are the whole diagnosis: `present` is what the game
        // produced, `admitted` is what the gate let through, and `encoded` is
        // what reached the encoder. `present` below target means the game is
        // the bottleneck and nothing here can help it; `admitted` above
        // `encoded` with `starved` non-zero means the encoder is not returning
        // slots fast enough and the capture rate follows it down.
        // Where the present path's time went, for the second just ended. A
        // hitch lands in exactly one of these three and that names its owner:
        // `gap` is the game's own frame time with this layer excluded, `layer`
        // is this layer's code on both sides of the down-call, `down` is the
        // driver, WSI and compositor.
        let (gap_avg, gap_max) = timing.gap.take();
        let (layer_avg, layer_max) = timing.layer.take();
        let (down_avg, down_max) = timing.down.take();
        let (blit_avg, blit_max) = timing.blit.take();
        let (acq_avg, acq_max) = timing.acquire.take();
        let (hold_avg, hold_max) = timing.hold.take();
        let long_gaps = timing.take_long_gaps();

        log::trace!(
            "present {pa}/s, admitted {ca}/s, encoded {raw_fps}/s, \
             starved {starved}, dropped {dropped}, capture {cap_ms:.1}ms, \
             encode {enc_ms:.1}ms"
        );
        log::trace!(
            "gap {gap_avg:.1}/{gap_max:.1}ms, layer {layer_avg:.2}/{layer_max:.2}ms, \
             down {down_avg:.2}/{down_max:.2}ms, acquire {acq_avg:.1}/{acq_max:.1}ms, \
             hold {hold_avg:.2}/{hold_max:.2}ms, blit-gpu {blit_avg:.3}/{blit_max:.3}ms \
             (avg/max), hitches {long_gaps}"
        );

        match ["cpu", "io", "memory"]
            .iter()
            .map(|k| pressure_total_us(k))
            .collect::<Option<Vec<_>>>()
            .and_then(|v| <[(u64, u64); 3]>::try_from(v.as_slice()).ok())
        {
            Some(now) => {
                if let Some(before) = prev_pressure {
                    // Printed as milliseconds stalled in the second just ended,
                    // which is the same unit as everything else on these lines
                    // and directly comparable with `gap`.
                    let ms = |i: usize, full: bool| {
                        let (s_now, f_now) = now[i];
                        let (s_before, f_before) = before[i];
                        let (a, b) = if full {
                            (f_now, f_before)
                        } else {
                            (s_now, s_before)
                        };
                        a.saturating_sub(b) as f64 / 1000.0
                    };
                    log::trace!(
                        "pressure: cpu {:.1}ms, io {:.1}/{:.1}ms, memory {:.1}/{:.1}ms \
                         (some/full, stalled in the last second)",
                        ms(0, false),
                        ms(1, false),
                        ms(1, true),
                        ms(2, false),
                        ms(2, true),
                    );
                }
                prev_pressure = Some(now);
            }
            None if !pressure_said_missing => {
                log::trace!(
                    "pressure: /proc/pressure is unreadable, so this guest cannot say \
                     whether a stall was cpu, io or memory (CONFIG_PSI off, or psi=0)"
                );
                pressure_said_missing = true;
            }
            None => {}
        }

        if let Some(ref socket) = socket {
            let mut buf = Vec::with_capacity(22);
            nesprotocol::stats::encode_hudless_stats(
                &mut buf, fps, enc_ms, dropped, pa, ca, cap_ms,
            );
            let _ = socket.send(&buf);
        }
    }

    log::info!("stats sender exited");
}

#[cfg(test)]
mod tests {
    use super::*;
    use ash::vk::ColorSpaceKHR as Cs;
    use pixelforge::ColorDescription;

    /// The colour space values were once written out by hand and two were wrong,
    /// which routed every HDR swapchain into the SDR arm silently. Deriving them
    /// from `ash` is the fix; this pins the behaviour that depended on them.
    #[test]
    fn a2r10g10b10_has_no_input_format() {
        // 58 is offered by a WSI layer's HDR pairs and by the compositor's
        // dmabuf list, and the converter has no red-first 10-bit input. It has
        // to come back None: the old fallback read it as eight-bit BGRA.
        assert_eq!(vk_format_to_input_format(58), None);
    }

    #[test]
    fn unmapped_formats_are_refused_rather_than_defaulted() {
        // A format nobody has taught the converter about must not quietly
        // become BGRA. Picked from the depth/stencil range, which no swapchain
        // uses, so this stays true as colour formats get added.
        for vk_format in [124u32, 125, 126, 129] {
            assert_eq!(
                vk_format_to_input_format(vk_format),
                None,
                "VkFormat {vk_format} should be refused, not defaulted"
            );
        }
    }

    #[test]
    fn bit_depth_agrees_with_the_input_format() {
        // The two used to be separate matches on VkFormat and had drifted.
        // Ten-bit in means ten-bit out, eight means eight, for every format
        // the converter accepts.
        let ten = [64u32, 97];
        let eight = [37u32, 43, 44, 50];
        for f in ten {
            let fmt = vk_format_to_input_format(f).expect("mapped");
            assert_eq!(
                input_format_bit_depth(fmt),
                EncodeBitDepth::Ten,
                "VkFormat {f} is a ten-bit format"
            );
        }
        for f in eight {
            let fmt = vk_format_to_input_format(f).expect("mapped");
            assert_eq!(
                input_format_bit_depth(fmt),
                EncodeBitDepth::Eight,
                "VkFormat {f} is an eight-bit format"
            );
        }
    }

    #[test]
    fn hdr_formats_map_to_their_converter_inputs() {
        // The two pairs a WSI layer injects that we can actually consume.
        assert_eq!(
            vk_format_to_input_format(64),
            Some(InputFormat::ABGR2101010),
            "A2B10G10R10_UNORM_PACK32 carries HDR10 PQ"
        );
        assert_eq!(
            vk_format_to_input_format(97),
            Some(InputFormat::RGBA16F),
            "R16G16B16A16_SFLOAT carries scRGB linear"
        );
    }

    /// A description for one colour space, through the same path the encoder
    /// uses. The geometry and formats are irrelevant to the answer.
    fn description(vk_colorspace: u32) -> ColorDescription {
        converter_config(
            1920,
            1080,
            InputFormat::BGRA,
            OutputFormat::NV12,
            vk_colorspace,
        )
        .color_description()
        .expect("every source we accept has an encodable stream")
    }

    #[test]
    fn hdr_colour_spaces_are_already_pq() {
        for cs in [Cs::HDR10_ST2084_EXT, Cs::HDR10_HLG_EXT] {
            let raw = cs.as_raw() as u32;
            assert_eq!(
                vk_colorspace_to_source_spec(raw),
                ColorSpec::Bt2020Pq,
                "{cs:?} must convert as BT.2020 PQ, not BT.709"
            );
            assert_eq!(
                description(raw),
                ColorDescription::bt2020_pq().with_full_range(true),
                "{cs:?}"
            );
        }
    }

    /// Linear swapchains must not be run through an inverse sRGB EOTF on the way
    /// to PQ, and they are not the same linear space as each other.
    #[test]
    fn the_two_linear_spaces_are_told_apart() {
        // They used to share an arm: there was no source for linear light on
        // BT.2020 primaries, so BT2020_LINEAR borrowed scRGB's and took a gamut
        // error to avoid a gamma one. Splitting source from target gives it one.
        assert_eq!(
            vk_colorspace_to_source_spec(Cs::EXTENDED_SRGB_LINEAR_EXT.as_raw() as u32),
            ColorSpec::Bt709Linear,
        );
        assert_eq!(
            vk_colorspace_to_source_spec(Cs::BT2020_LINEAR_EXT.as_raw() as u32),
            ColorSpec::Bt2020Linear,
        );
        // Both still leave as HDR10: video cannot carry linear light.
        for cs in [Cs::EXTENDED_SRGB_LINEAR_EXT, Cs::BT2020_LINEAR_EXT] {
            let raw = cs.as_raw() as u32;
            assert_eq!(
                stream_spec(vk_colorspace_to_source_spec(raw)),
                ColorSpec::Bt2020Pq,
                "{cs:?}"
            );
            assert!(
                stream_spec(vk_colorspace_to_source_spec(raw)).is_encodable(),
                "{cs:?}"
            );
        }
    }

    /// scRGB is linear with 1.0 at 80 nits; gamma-encoded sRGB puts white at the
    /// BT.2408 reference of 203.
    #[test]
    fn scrgb_white_is_not_the_srgb_reference() {
        assert_eq!(ColorSpec::Bt709Linear.reference_white_nits(), Some(80.0));
        assert_eq!(ColorSpec::Srgb.reference_white_nits(), Some(203.0));
        assert_eq!(
            vk_colorspace_to_source_spec(Cs::EXTENDED_SRGB_LINEAR_EXT.as_raw() as u32)
                .reference_white_nits(),
            Some(80.0),
        );
        // BT.2020 linear now answers 203 rather than scRGB's 80, because it is
        // no longer pretending to be scRGB. That is a deliberate change of
        // behaviour: 80 was a side effect of the borrowed arm, not a decision
        // about this space.
        assert_eq!(
            vk_colorspace_to_source_spec(Cs::BT2020_LINEAR_EXT.as_raw() as u32)
                .reference_white_nits(),
            Some(203.0),
        );
        // PQ already carries absolute brightness, so there is nothing to map.
        assert_eq!(ColorSpec::Bt2020Pq.reference_white_nits(), None);
    }

    /// The matrix and transfer the shader applies and the ones the VUI declares
    /// come from one config, so they cannot disagree.
    #[test]
    fn conversion_and_declaration_agree() {
        for cs in [
            Cs::SRGB_NONLINEAR,
            Cs::PASS_THROUGH_EXT,
            Cs::HDR10_ST2084_EXT,
            Cs::HDR10_HLG_EXT,
            Cs::EXTENDED_SRGB_LINEAR_EXT,
            Cs::BT2020_LINEAR_EXT,
        ] {
            let raw = cs.as_raw() as u32;
            let desc = description(raw);
            let writes_bt2020 = stream_spec(vk_colorspace_to_source_spec(raw)) != ColorSpec::Srgb;
            assert_eq!(desc.is_hdr(), writes_bt2020, "{cs:?}");
            assert_eq!(
                desc,
                if writes_bt2020 {
                    ColorDescription::bt2020_pq().with_full_range(true)
                } else {
                    ColorDescription::bt709().with_full_range(true)
                },
                "{cs:?}"
            );
        }
    }

    #[test]
    fn sdr_colour_spaces_stay_on_bt709() {
        for cs in [Cs::SRGB_NONLINEAR, Cs::PASS_THROUGH_EXT] {
            let raw = cs.as_raw() as u32;
            assert_eq!(vk_colorspace_to_source_spec(raw), ColorSpec::Srgb, "{cs:?}");
            assert_eq!(stream_spec(ColorSpec::Srgb), ColorSpec::Srgb);
        }
    }

    /// The CPU fallback has to agree with the declaration too. A flat grey of 51
    /// is the value that exposed the GPU path's range bug on real hardware: full
    /// range encodes it as Y=51, limited range as Y=60. The stream says full.
    #[test]
    fn cpu_fallback_is_full_range_bt709() {
        // 4x2 of solid RGB(51,51,51); vk_format 44 selects the BGRA branch.
        let px = vec![51u8; 4 * 2 * 4];
        let yuv = bgra_to_yuv420(&px, 4, 2, 44);
        for (i, &y) in yuv[..8].iter().enumerate() {
            assert_eq!(
                y, 51,
                "luma[{i}] should be 51 full-range, not 60 limited-range"
            );
        }
        // Achromatic input must sit at the chroma centre.
        for &c in &yuv[8..] {
            assert!((c as i32 - 128).abs() <= 1, "grey must be neutral, got {c}");
        }
    }

    /// Saturated primaries must not be clamped into the limited-range box.
    #[test]
    fn cpu_fallback_uses_the_full_code_range() {
        let white = vec![255u8; 4 * 2 * 4];
        assert_eq!(
            bgra_to_yuv420(&white, 4, 2, 44)[0],
            255,
            "white must reach 255"
        );
        let black = vec![0u8; 4 * 2 * 4];
        assert_eq!(bgra_to_yuv420(&black, 4, 2, 44)[0], 0, "black must reach 0");
    }

    /// The converter is configured full-range unconditionally, so every colour
    /// description handed to the encoder has to say so. A limited-range tag over
    /// full-range samples is expanded again by the decoder.
    #[test]
    fn every_colour_description_is_full_range() {
        for cs in [
            Cs::SRGB_NONLINEAR,
            Cs::HDR10_ST2084_EXT,
            Cs::HDR10_HLG_EXT,
            Cs::EXTENDED_SRGB_LINEAR_EXT,
            Cs::PASS_THROUGH_EXT,
        ] {
            assert!(
                description(cs.as_raw() as u32).full_range,
                "{cs:?} produced a limited-range description"
            );
        }
    }
}

#[cfg(test)]
mod encoder_identity_tests {
    use super::encoder_still_serves;
    use pixelforge::{EncodeBitDepth, PixelFormat};

    const HD: (u32, u32, EncodeBitDepth, PixelFormat) =
        (1920, 1080, EncodeBitDepth::Eight, PixelFormat::Yuv420);

    #[test]
    fn an_unchanged_frame_reuses_the_encoder() {
        assert!(encoder_still_serves(HD, HD));
    }

    #[test]
    fn a_resolution_change_rebuilds_in_either_direction() {
        // The regression. Shrinking left the encoder sending the old geometry
        // with stale margins; growing had no surface big enough for the frame.
        let smaller = (1280, 720, EncodeBitDepth::Eight, PixelFormat::Yuv420);
        assert!(!encoder_still_serves(HD, smaller));
        assert!(!encoder_still_serves(smaller, HD));
    }

    #[test]
    fn one_axis_moving_is_still_a_change() {
        assert!(!encoder_still_serves(
            HD,
            (1920, 720, EncodeBitDepth::Eight, PixelFormat::Yuv420)
        ));
        assert!(!encoder_still_serves(
            HD,
            (1280, 1080, EncodeBitDepth::Eight, PixelFormat::Yuv420)
        ));
    }

    #[test]
    fn depth_and_pixel_format_still_rebuild() {
        assert!(!encoder_still_serves(
            HD,
            (1920, 1080, EncodeBitDepth::Ten, PixelFormat::Yuv420)
        ));
        assert!(!encoder_still_serves(
            HD,
            (1920, 1080, EncodeBitDepth::Eight, PixelFormat::Yuv444)
        ));
    }
}

#[cfg(test)]
mod bitrate_only_tests {
    use super::{HwCodec, bitrate_only_change};
    use crate::encode::EncodeSettingsChange;
    use pixelforge::{EncodeBitDepth, RateControlMode};

    fn change(
        mode: RateControlMode,
        value: u32,
        codec: Option<HwCodec>,
        bit_depth: Option<EncodeBitDepth>,
    ) -> EncodeSettingsChange {
        EncodeSettingsChange {
            codec,
            rate_control_mode: mode,
            value,
            bit_depth,
        }
    }

    /// The running encode for these: CBR at 8 Mbps, H.264, no depth override.
    fn running(c: &EncodeSettingsChange) -> Option<u32> {
        bitrate_only_change(c, Some(8_000), HwCodec::H264, None)
    }

    #[test]
    fn a_bare_bitrate_change_is_taken() {
        let c = change(RateControlMode::Cbr, 2_000, None, None);
        assert_eq!(running(&c), Some(2_000));
    }

    #[test]
    fn restating_the_current_codec_and_depth_is_not_a_change() {
        // The debug overlay sends every field on every apply, so a change that
        // only moved the slider still arrives carrying a codec. Treating that as
        // a codec change would rebuild the encoder, and an IDR with it, every
        // time somebody nudged the bitrate.
        let c = change(RateControlMode::Cbr, 2_000, Some(HwCodec::H264), None);
        assert_eq!(running(&c), Some(2_000));

        // Same, with the depth restated as what is already in force.
        let c = change(
            RateControlMode::Cbr,
            2_000,
            Some(HwCodec::H264),
            Some(EncodeBitDepth::Eight),
        );
        assert_eq!(
            bitrate_only_change(&c, Some(8_000), HwCodec::H264, Some(EncodeBitDepth::Eight)),
            Some(2_000),
        );
    }

    #[test]
    fn a_stated_depth_against_no_override_rebuilds() {
        // Deliberately conservative. With no override in force the running depth
        // came from the input format or the environment, and this cannot tell
        // whether the stated value matches it -- so it rebuilds rather than
        // assume. The cost is one rebuild on the first manual apply; the cost of
        // assuming wrongly is a stream whose depth silently disagrees with the
        // encoder's.
        let c = change(
            RateControlMode::Cbr,
            2_000,
            None,
            Some(EncodeBitDepth::Eight),
        );
        assert_eq!(
            bitrate_only_change(&c, Some(8_000), HwCodec::H264, None),
            None
        );
    }

    #[test]
    fn a_different_codec_rebuilds() {
        // A codec is the video session's profile; there is no retuning it.
        for codec in [HwCodec::H265, HwCodec::AV1] {
            let c = change(RateControlMode::Cbr, 2_000, Some(codec), None);
            assert_eq!(running(&c), None, "{codec:?}");
        }
    }

    #[test]
    fn a_different_bit_depth_rebuilds() {
        let c = change(RateControlMode::Cbr, 2_000, None, Some(EncodeBitDepth::Ten));
        assert_eq!(running(&c), None);
    }

    #[test]
    fn switching_to_constant_qp_rebuilds() {
        let c = change(RateControlMode::Cqp, 28, None, None);
        assert_eq!(running(&c), None);
    }

    #[test]
    fn coming_back_from_constant_qp_rebuilds() {
        // The session was built without a bitrate, so there is nothing to
        // retarget -- it has to become an encode that has one.
        let c = change(RateControlMode::Cbr, 2_000, None, None);
        assert_eq!(bitrate_only_change(&c, None, HwCodec::H264, None), None);
    }
}
