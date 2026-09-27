//! The encoder: an RGB image in, a packetized frame out.
//!
//! Shaped like pixelforge's encoder so the capture layer drives both the same
//! way: [`Encoder::encode_after`] waits on the caller's timeline points,
//! submits the whole frame as one submission, and returns a future a
//! completion thread resolves once the frame is read back and packetized.
//!
//! PyroWave is intra only, so there is no GOP, no IDR and no reference to
//! invalidate: every frame decodes alone.

use std::future::Future;
use std::pin::Pin;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::task::{Context as TaskContext, Poll};
use std::thread::JoinHandle;

use ash::vk;
use futures_channel::oneshot;

use crate::bitstream::{
    Chroma, ColourDescription, DECOMPOSITION_LEVELS, GpuPacket, Layout, NUM_COMPONENTS,
    SEQUENCE_MASK, SequenceHeader, packetize,
};
use crate::device::Context;
use crate::error::{Error, Result};
use crate::gpu::{
    Buffer, Commands, Image, ImageDesc, Location, OwnedView, Timeline, Timestamps, compute_barrier,
    memory_barrier, to_general,
};
use crate::pipeline::{Bind, Pipeline, PipelineDesc, SubgroupSize, entry};
use crate::rate;
use crate::shaders;
use crate::sync::TimelinePoint;
use crate::wavelet::Wavelet;

/// What the RGB input already is. Mirrors pixelforge's `ColorSpec`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    /// Ordinary SDR content, sRGB encoded.
    Srgb = 0,
    /// scRGB: sRGB primaries in linear light, values above 1.0 brighter than
    /// SDR white.
    Bt709Linear = 1,
    /// Like `Bt709Linear` with BT.2020 primaries.
    Bt2020Linear = 2,
    /// Already HDR10: BT.2020 primaries, PQ encoded.
    Bt2020Pq = 3,
}

/// Bits per sample of the YCbCr planes the codec reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Depth {
    /// `R8_UNORM` planes, for SDR.
    Eight,
    /// `R16_UNORM` planes, for HDR.
    Sixteen,
}

impl Depth {
    pub(crate) fn format(self) -> vk::Format {
        match self {
            Depth::Eight => vk::Format::R8_UNORM,
            Depth::Sixteen => vk::Format::R16_UNORM,
        }
    }
}

/// RGB formats the encoder samples directly.
const INPUT_FORMATS: &[vk::Format] = &[
    vk::Format::B8G8R8A8_UNORM,
    vk::Format::R8G8B8A8_UNORM,
    vk::Format::A2B10G10R10_UNORM_PACK32,
    vk::Format::A2R10G10B10_UNORM_PACK32,
    vk::Format::R16G16B16A16_SFLOAT,
];

#[derive(Debug, Clone)]
pub struct EncodeConfig {
    pub width: u32,
    pub height: u32,
    pub chroma: Chroma,
    pub depth: Depth,
    /// What the stream is, and what its header says it is.
    pub colour: ColourDescription,
    /// What the input is.
    pub source: Source,
    /// Luminance of a linear source's 1.0, in nits. Unused for PQ sources and
    /// SDR targets.
    pub reference_white_nits: f32,
    pub frame_rate: (u32, u32),
    pub target_bitrate: u64,
    /// Largest packet the packetizer cuts, in bytes.
    pub packet_size: usize,
}

impl EncodeConfig {
    /// 4:2:0 SDR at 60 fps and 200 Mbit/s, cut for 1200-byte packets.
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            chroma: Chroma::Yuv420,
            depth: Depth::Eight,
            colour: ColourDescription::bt709(),
            source: Source::Srgb,
            reference_white_nits: 203.0,
            frame_rate: (60, 1),
            target_bitrate: 200_000_000,
            packet_size: 1200,
        }
    }

    pub fn with_chroma(mut self, chroma: Chroma) -> Self {
        self.chroma = chroma;
        self
    }

    pub fn with_depth(mut self, depth: Depth) -> Self {
        self.depth = depth;
        self
    }

    pub fn with_colour(mut self, colour: ColourDescription, source: Source) -> Self {
        self.colour = colour;
        self.source = source;
        self
    }

    pub fn with_reference_white(mut self, nits: f32) -> Self {
        self.reference_white_nits = nits;
        self
    }

    pub fn with_frame_rate(mut self, numerator: u32, denominator: u32) -> Self {
        self.frame_rate = (numerator, denominator);
        self
    }

    pub fn with_target_bitrate(mut self, bits_per_second: u64) -> Self {
        self.target_bitrate = bits_per_second;
        self
    }

    pub fn with_packet_size(mut self, bytes: usize) -> Self {
        self.packet_size = bytes;
        self
    }

    fn validate(&self) -> Result<()> {
        if self.colour != ColourDescription::bt709()
            && self.colour != ColourDescription::bt2020_pq()
        {
            return Err(Error::Config(format!(
                "the encoder produces BT.709 or BT.2020 PQ, full range, centre sited; not {:?}",
                self.colour
            )));
        }
        if !self.colour.is_hdr() && self.source != Source::Srgb {
            return Err(Error::Config(format!(
                "an SDR stream needs an sRGB source; {:?} needs tone mapping this encoder does not do",
                self.source
            )));
        }
        if self.frame_rate.0 == 0 || self.frame_rate.1 == 0 {
            return Err(Error::Config("frame rate must be positive".into()));
        }
        if self.packet_size < 64 {
            return Err(Error::Config(format!(
                "packet size {} is below 64 bytes",
                self.packet_size
            )));
        }
        Ok(())
    }

    /// Bytes rate control aims each frame at, a whole number of words.
    fn target_bytes(&self) -> u64 {
        let bits =
            self.target_bitrate * u64::from(self.frame_rate.1) / u64::from(self.frame_rate.0);
        (bits / 8) & !3
    }
}

/// GPU time spent in each pass of one frame, in nanoseconds.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct EncodeStats {
    pub convert_ns: f64,
    pub dwt_ns: f64,
    /// Includes clearing the buffers rate control accumulates into.
    pub quant_ns: f64,
    pub analyze_ns: f64,
    pub resolve_ns: f64,
    pub packing_ns: f64,
    /// Bytes rate control aimed at.
    pub target_bytes: u64,
    /// Words of block data the GPU produced, including any it could not keep.
    pub produced_words: u32,
    /// Blocks dropped because rate control overshot what was read back.
    /// Zero unless something is wrong.
    pub dropped_blocks: u32,
    /// Bytes the quantizer asked of its scratch payload, and what it has.
    /// Asking for more means 8×8 blocks were dropped as all zero before rate
    /// control ever saw them.
    pub scratch_bytes: u32,
    pub scratch_capacity: u32,
}

impl EncodeStats {
    /// Whether the quantizer ran out of scratch payload.
    pub fn scratch_overflowed(&self) -> bool {
        self.scratch_bytes > self.scratch_capacity
    }
}

impl EncodeStats {
    pub fn gpu_ns(&self) -> f64 {
        self.convert_ns
            + self.dwt_ns
            + self.quant_ns
            + self.analyze_ns
            + self.resolve_ns
            + self.packing_ns
    }
}

/// One frame, ready for the network.
#[derive(Debug, Clone)]
pub struct EncodedFrame {
    /// The start-of-frame header, then every non-empty block in index order.
    pub data: Vec<u8>,
    /// `data` cut into packets that each parse on their own.
    pub packets: Vec<std::ops::Range<usize>>,
    /// Leading packets that carry the coarsest bands, whose loss cannot be
    /// masked. Worth the most reliable delivery.
    pub critical_packets: usize,
    /// Frames encoded before this one.
    pub index: u64,
    /// The 3-bit frame counter in its headers.
    pub sequence: u8,
    pub stats: EncodeStats,
}

/// Resolves to the frame once it is read back. Futures resolve in submission
/// order; dropping one is harmless.
pub struct EncodeFuture {
    rx: oneshot::Receiver<Result<EncodedFrame>>,
}

impl Future for EncodeFuture {
    type Output = Result<EncodedFrame>;

    fn poll(mut self: Pin<&mut Self>, cx: &mut TaskContext<'_>) -> Poll<Self::Output> {
        match Pin::new(&mut self.rx).poll(cx) {
            Poll::Ready(Ok(result)) => Poll::Ready(result),
            Poll::Ready(Err(oneshot::Canceled)) => Poll::Ready(Err(Error::Cancelled)),
            Poll::Pending => Poll::Pending,
        }
    }
}

/// Submissions allowed in flight: one on the GPU while the previous one is
/// packetized, as in pixelforge.
const DEPTH: usize = 2;

/// Timestamps around the six passes.
const TIMESTAMPS: u32 = 7;

#[repr(C)]
#[derive(Clone, Copy)]
struct RgbPush {
    width: u32,
    height: u32,
    source: u32,
    hdr: u32,
    reference_white_nits: f32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct DwtPush {
    resolution: [i32; 2],
    inv_resolution: [f32; 2],
    aligned_resolution: [i32; 2],
}

#[repr(C)]
#[derive(Clone, Copy)]
struct QuantPush {
    block_meta: u64,
    block_stats: u64,
    payload_counter: u64,
    payload_data: u64,
    resolution: [i32; 2],
    resolution_8x8_blocks: [i32; 2],
    inv_resolution: [f32; 2],
    input_layer: f32,
    quant_resolution: f32,
    block_offset: i32,
    block_stride: i32,
    rdo_distortion_scale: f32,
    payload_capacity: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct AnalyzePush {
    buckets: u64,
    total_savings_per_bucket: u64,
    rdo_operations: u64,
    block_stats: u64,
    resolution: [i32; 2],
    resolution_8x8_blocks: [i32; 2],
    block_offset_8x8: i32,
    block_stride_8x8: i32,
    block_offset_32x32: i32,
    block_stride_32x32: i32,
    total_wg_count: u32,
    num_blocks_aligned: u32,
    block_index_shamt: u32,
    _pad: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct FinalizePush {
    total_savings_per_bucket: u64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct ResolvePush {
    buckets: u64,
    total_savings_per_bucket: u64,
    rdo_operations: u64,
    quant_data: u64,
    frame_params: u64,
    num_blocks_per_subdivision: u32,
    _pad: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct PackingPush {
    bitstream_data: u64,
    bitstream_data_16b: u64,
    bitstream_data_8b: u64,
    bitstream_meta: u64,
    block_meta: u64,
    payload_counter: u64,
    payload_data: u64,
    block_stats: u64,
    quant_data: u64,
    frame_params: u64,
    resolution: [i32; 2],
    resolution_32x32_blocks: [i32; 2],
    resolution_8x8_blocks: [i32; 2],
    quant_resolution_code: u32,
    block_offset_32x32: i32,
    block_stride_32x32: i32,
    block_offset_8x8: i32,
    block_stride_8x8: i32,
    bitstream_capacity_words: u32,
}

// Vulkan guarantees 128 bytes of push constants and no more.
const _: () = assert!(std::mem::size_of::<PackingPush>() <= 128);

struct Pipelines {
    rgb: Pipeline,
    /// Without and with the DC shift of a plane's first transform.
    dwt: [Pipeline; 2],
    quant: Pipeline,
    analyze: Pipeline,
    finalize: Pipeline,
    resolve: Pipeline,
    packing: Pipeline,
}

impl Pipelines {
    fn new(ctx: &Context, chroma: Chroma) -> Result<Self> {
        let s = ctx.inner().subgroups;
        let no = || Error::Unsupported(vec!["a usable subgroup size".into()]);
        let sampled = vk::DescriptorType::COMBINED_IMAGE_SAMPLER;
        let storage = vk::DescriptorType::STORAGE_IMAGE;
        let size = |n: usize| n as u32;

        let rgb = Pipeline::new(
            ctx,
            &PipelineDesc {
                spirv: shaders::RGB_TO_YCBCR,
                entry: entry::RGB_TO_YCBCR,
                bindings: &[vk::DescriptorType::SAMPLED_IMAGE, storage, storage, storage],
                push_size: size(std::mem::size_of::<RgbPush>()),
                specialization: &[(0, u32::from(chroma == Chroma::Yuv420))],
                subgroup: SubgroupSize::Any,
            },
        )?;
        let dwt_size = s.pick(4, 128).ok_or_else(no)?;
        let dwt = [0, 1].map(|shift| {
            Pipeline::new(
                ctx,
                &PipelineDesc {
                    spirv: shaders::DWT,
                    entry: entry::DWT,
                    bindings: &[sampled, storage],
                    push_size: size(std::mem::size_of::<DwtPush>()),
                    specialization: &[(0, shift)],
                    subgroup: dwt_size,
                },
            )
        });
        let [dwt0, dwt1] = dwt;
        let quant = Pipeline::new(
            ctx,
            &PipelineDesc {
                spirv: shaders::WAVELET_QUANT,
                entry: entry::WAVELET_QUANT,
                bindings: &[sampled],
                push_size: size(std::mem::size_of::<QuantPush>()),
                specialization: &[(1, 0)],
                subgroup: s.pick(8, 128).ok_or_else(no)?,
            },
        )?;
        let analyze = Pipeline::new(
            ctx,
            &PipelineDesc {
                spirv: shaders::ANALYZE_RATE_CONTROL,
                entry: entry::ANALYZE_RATE_CONTROL,
                bindings: &[],
                push_size: size(std::mem::size_of::<AnalyzePush>()),
                specialization: &[],
                subgroup: s.pick(16, 64).ok_or_else(no)?,
            },
        )?;
        let finalize = Pipeline::new(
            ctx,
            &PipelineDesc {
                spirv: shaders::ANALYZE_RATE_CONTROL_FINALIZE,
                entry: entry::ANALYZE_RATE_CONTROL_FINALIZE,
                bindings: &[],
                push_size: size(std::mem::size_of::<FinalizePush>()),
                specialization: &[],
                subgroup: SubgroupSize::Any,
            },
        )?;
        // Upstream's preference order.
        let resolve_size = s.pick_exact(&[64, 16, 32]).ok_or_else(no)?;
        let resolve_spirv = match resolve_size {
            16 => shaders::RESOLVE_RATE_CONTROL_16,
            32 => shaders::RESOLVE_RATE_CONTROL_32,
            _ => shaders::RESOLVE_RATE_CONTROL_64,
        };
        let resolve = Pipeline::new(
            ctx,
            &PipelineDesc {
                spirv: resolve_spirv,
                entry: entry::RESOLVE_RATE_CONTROL,
                bindings: &[],
                push_size: size(std::mem::size_of::<ResolvePush>()),
                specialization: &[],
                subgroup: SubgroupSize::Full(resolve_size),
            },
        )?;
        let packing = Pipeline::new(
            ctx,
            &PipelineDesc {
                spirv: shaders::BLOCK_PACKING,
                entry: entry::BLOCK_PACKING,
                bindings: &[],
                push_size: size(std::mem::size_of::<PackingPush>()),
                specialization: &[],
                subgroup: s.pick(16, 64).ok_or_else(no)?,
            },
        )?;
        Ok(Self {
            rgb,
            dwt: [dwt0?, dwt1?],
            quant,
            analyze,
            finalize,
            resolve,
            packing,
        })
    }
}

/// What a slot's read-back holds, in order.
struct ReadbackLayout {
    /// The GPU's block table.
    table: u64,
    /// The payload buffer's two counters.
    counters: u64,
    /// The bitstream words.
    bitstream: u64,
}

struct Slot {
    /// Sized for the current target plus headroom, and replaced with a
    /// larger one when the target grows. Only touched by the thread that
    /// holds the slot.
    readback: Mutex<Buffer>,
    timestamps: Option<Timestamps>,
}

fn readback_buffer(ctx: &Context, layout: &ReadbackLayout, bitstream_bytes: u64) -> Result<Buffer> {
    Buffer::new(
        ctx,
        layout.bitstream + bitstream_bytes,
        vk::BufferUsageFlags::TRANSFER_DST,
        Location::Readback,
    )
}

/// What a frame is encoded from. The views are kept alive until the GPU is
/// done with the frame.
enum Input {
    /// The caller's RGB image, converted by the encoder.
    Rgb {
        view: OwnedView,
        layout: vk::ImageLayout,
    },
    /// The caller's own Y, Cb and Cr planes.
    Planes {
        views: [OwnedView; 3],
        layout: vk::ImageLayout,
    },
}

/// Handed to the completion thread per frame.
struct Work {
    slot: usize,
    value: u64,
    _input: Input,
    header: SequenceHeader,
    index: u64,
    copied_words: u32,
    target_bytes: u64,
    scratch_capacity: u32,
    tx: oneshot::Sender<Result<EncodedFrame>>,
}

pub struct Encoder {
    ctx: Context,
    layout: Arc<Layout>,
    config: EncodeConfig,
    pipelines: Pipelines,
    wavelet: Wavelet,
    planes: [Image; 3],
    plane_views: [vk::ImageView; 3],
    block_meta: Buffer,
    block_stats: Buffer,
    payload: Buffer,
    quant: Buffer,
    buckets: Buffer,
    bitstream: Buffer,
    table: Buffer,
    readback_layout: Arc<ReadbackLayout>,
    /// What changes per frame: the sequence number and the target size.
    frame_params: Buffer,
    commands: Commands,
    /// Which bodies each slot has recorded.
    recorded: [[bool; 2]; DEPTH],
    timeline: Arc<Timeline>,
    submitted: u64,
    sequence: u8,
    frames: u64,
    slots: Arc<[Slot; DEPTH]>,
    free_slots: mpsc::Receiver<usize>,
    work: Option<mpsc::Sender<Work>>,
    worker: Option<JoinHandle<()>>,
}

impl Encoder {
    pub fn new(ctx: Context, config: EncodeConfig) -> Result<Self> {
        config.validate()?;
        if !ctx.supports_encode() {
            return Err(Error::Config(
                "the context's device was not created for encoding (Roles::ENCODE)".into(),
            ));
        }
        let layout = Arc::new(Layout::new(config.width, config.height, config.chroma)?);
        if layout.blocks_32x32() > u32::from(u16::MAX) {
            // Rate control packs a block index into 16 bits.
            return Err(Error::Config(format!(
                "{}x{} has {} blocks; rate control addresses at most 65535",
                config.width,
                config.height,
                layout.blocks_32x32()
            )));
        }

        let pipelines = Pipelines::new(&ctx, config.chroma)?;
        let wavelet = Wavelet::new(&ctx, &layout)?;

        let (cw, ch) = match config.chroma {
            Chroma::Yuv420 => (config.width / 2, config.height / 2),
            Chroma::Yuv444 => (config.width, config.height),
        };
        let plane = |w, h| {
            Image::new(
                &ctx,
                &ImageDesc {
                    format: config.depth.format(),
                    width: w,
                    height: h,
                    layers: 1,
                    mips: 1,
                    usage: vk::ImageUsageFlags::SAMPLED | vk::ImageUsageFlags::STORAGE,
                    families: &[],
                },
            )
        };
        let mut planes = [
            plane(config.width, config.height)?,
            plane(cw, ch)?,
            plane(cw, ch)?,
        ];
        let mut plane_views = [vk::ImageView::null(); 3];
        for (view, image) in plane_views.iter_mut().zip(planes.iter_mut()) {
            *view = image.view(vk::ImageViewType::TYPE_2D, 0, 0, 1)?;
        }

        let storage = vk::BufferUsageFlags::STORAGE_BUFFER;
        let transfer = vk::BufferUsageFlags::TRANSFER_DST | vk::BufferUsageFlags::TRANSFER_SRC;
        let blocks_8x8 = u64::from(layout.blocks_8x8());
        let blocks_32x32 = u64::from(layout.blocks_32x32());
        let per_sub = u64::from(rate::blocks_per_subdivision(layout.blocks_32x32()));
        // The quantizer's scratch holds, per 8×8 block, eight 4×2 subblocks of
        // a sign byte and at most 16 bit planes; the block statistics' 15
        // entries already assume fewer. Upstream sizes this by estimate,
        // aligned width × height × 2, which high-entropy 4:4:4 content
        // exceeds: its encoder then packs blocks from bytes it never wrote.
        // The quantizer still refuses to write past this, as a backstop.
        let scratch_bytes = blocks_8x8 * 8 * (1 + 16);
        // No frame's blocks can exceed this, whatever rate control does.
        let bitstream_bytes = blocks_32x32 * u64::from(crate::bitstream::LARGEST_BLOCK_WORDS) * 4;

        let block_meta = Buffer::new(&ctx, blocks_8x8 * 8, storage, Location::Device)?;
        let block_stats = Buffer::new(&ctx, blocks_8x8 * 64, storage, Location::Device)?;
        let payload = Buffer::new(
            &ctx,
            8 + scratch_bytes,
            storage | transfer,
            Location::Device,
        )?;
        let quant = Buffer::new(&ctx, blocks_32x32 * 4, storage | transfer, Location::Device)?;
        let buckets = Buffer::new(
            &ctx,
            rate::RDO_BUCKET_OFFSET
                + u64::from(rate::NUM_RDO_BUCKETS * rate::BLOCK_SPACE_SUBDIVISION) * 4
                + u64::from(rate::NUM_RDO_BUCKETS)
                    * per_sub
                    * u64::from(rate::BLOCK_SPACE_SUBDIVISION)
                    * 8,
            storage | transfer,
            Location::Device,
        )?;
        // Block packing may never write past this; the read-back copies only
        // the part rate control aimed at, plus headroom.
        let bitstream = Buffer::new(&ctx, bitstream_bytes, storage | transfer, Location::Device)?;
        let table = Buffer::new(&ctx, blocks_32x32 * 8, storage | transfer, Location::Device)?;

        let readback_layout = Arc::new(ReadbackLayout {
            table: 0,
            counters: blocks_32x32 * 8,
            bitstream: blocks_32x32 * 8 + 8,
        });
        let make_slot = || -> Result<Slot> {
            Ok(Slot {
                readback: Mutex::new(readback_buffer(
                    &ctx,
                    &readback_layout,
                    config.target_bytes() + blocks_32x32 * 8,
                )?),
                timestamps: if ctx.inner().timestamps {
                    Some(Timestamps::new(&ctx, TIMESTAMPS)?)
                } else {
                    None
                },
            })
        };
        let slots = Arc::new([make_slot()?, make_slot()?]);

        let commands = Commands::new(&ctx, (DEPTH * COMMANDS_PER_SLOT) as u32)?;
        let frame_params = Buffer::new(
            &ctx,
            16,
            storage | vk::BufferUsageFlags::TRANSFER_DST,
            Location::Device,
        )?;
        let timeline = Arc::new(Timeline::new(&ctx)?);

        let (free_tx, free_slots) = mpsc::channel();
        for i in 0..DEPTH {
            free_tx.send(i).unwrap();
        }
        let (work, work_rx) = mpsc::channel::<Work>();
        let worker = {
            let layout = layout.clone();
            let slots = slots.clone();
            let timeline = timeline.clone();
            let readback_layout = readback_layout.clone();
            let packet_size = config.packet_size;
            std::thread::Builder::new()
                .name("nespyro-encode".into())
                .spawn(move || {
                    for w in work_rx {
                        let slot = w.slot;
                        let result = complete(
                            &layout,
                            &slots[slot],
                            &timeline,
                            &readback_layout,
                            packet_size,
                            &w,
                        );
                        let _ = w.tx.send(result);
                        drop(w._input);
                        // The receiver only goes away with the encoder.
                        let _ = free_tx.send(slot);
                    }
                })
                .map_err(|e| Error::Config(format!("could not start the completion thread: {e}")))?
        };

        Ok(Self {
            ctx,
            layout,
            config,
            pipelines,
            wavelet,
            planes,
            plane_views,
            block_meta,
            block_stats,
            payload,
            quant,
            buckets,
            bitstream,
            table,
            readback_layout,
            frame_params,
            commands,
            recorded: [[false; 2]; DEPTH],
            timeline,
            submitted: 0,
            sequence: 0,
            frames: 0,
            slots,
            free_slots,
            work: Some(work),
            worker: Some(worker),
        })
    }

    pub fn config(&self) -> &EncodeConfig {
        &self.config
    }

    /// Takes effect on the next frame. Nothing is rebuilt.
    pub fn set_target_bitrate(&mut self, bits_per_second: u64) {
        self.config.target_bitrate = bits_per_second;
    }

    /// Takes effect on the next frame: the conversion and the header's colour
    /// fields change, the planes' depth does not.
    pub fn set_colour_description(
        &mut self,
        colour: ColourDescription,
        source: Source,
    ) -> Result<()> {
        let next = EncodeConfig {
            colour,
            source,
            ..self.config.clone()
        };
        next.validate()?;
        self.config = next;
        Ok(())
    }

    /// Encodes `image` once every point in `wait` is reached.
    ///
    /// `image` is sampled in `layout` through a view of `format`, which must
    /// be one of the UNORM or SFLOAT formats the encoder reads; the caller
    /// keeps it in that layout until the returned future resolves, and must
    /// not write it until then.
    pub fn encode_after(
        &mut self,
        image: vk::Image,
        format: vk::Format,
        layout: vk::ImageLayout,
        wait: &[TimelinePoint],
    ) -> Result<EncodeFuture> {
        if !INPUT_FORMATS.contains(&format) {
            return Err(Error::Config(format!(
                "cannot sample {format:?}; use one of {INPUT_FORMATS:?} (an sRGB format would \
                 be linearized by the sampler)"
            )));
        }

        let input = Input::Rgb {
            view: OwnedView::new(&self.ctx, image, format)?,
            layout,
        };
        self.submit(input, wait)
    }

    /// Encodes the caller's own full-range YCbCr planes once every point in
    /// `wait` is reached, skipping the encoder's colour conversion.
    ///
    /// The planes are sampled in `layout`, and must be single-level images of
    /// the configured depth's format (`R8_UNORM` or `R16_UNORM`) and sizes:
    /// the configured width and height for Y, and for Cb and Cr the same, or
    /// half of each for 4:2:0. The header still carries the configured
    /// colour description; the planes must be what it says.
    pub fn encode_planes_after(
        &mut self,
        planes: [vk::Image; 3],
        layout: vk::ImageLayout,
        wait: &[TimelinePoint],
    ) -> Result<EncodeFuture> {
        let format = self.config.depth.format();
        let [y, cb, cr] = planes;
        let input = Input::Planes {
            views: [
                OwnedView::new(&self.ctx, y, format)?,
                OwnedView::new(&self.ctx, cb, format)?,
                OwnedView::new(&self.ctx, cr, format)?,
            ],
            layout,
        };
        self.submit(input, wait)
    }

    fn submit(&mut self, input: Input, wait: &[TimelinePoint]) -> Result<EncodeFuture> {
        // A free slot means its previous frame has been read back, so its
        // command buffers and read-back buffer are no longer in use.
        let slot = self.free_slots.recv().map_err(|_| Error::Cancelled)?;

        self.sequence = (self.sequence + 1) & SEQUENCE_MASK;
        let target_bytes = self.config.target_bytes();
        // Rate control aims at the target less the start-of-frame header, and
        // the read-back takes the same headroom upstream gives its bitstream
        // buffer: one table entry's worth per block.
        let headroom = u64::from(self.layout.blocks_32x32()) * 8;
        let copy_bytes = (target_bytes + headroom).min(self.bitstream.size);
        let copied_words = (copy_bytes / 4) as u32;
        {
            // The slot is ours until it is handed to the completion thread.
            let mut readback = self.slots[slot].readback.lock().unwrap();
            if readback.size < self.readback_layout.bitstream + copy_bytes {
                *readback = readback_buffer(&self.ctx, &self.readback_layout, copy_bytes)?;
            }
        }

        // Only what changes per frame is recorded per frame: the prologue
        // (the frame's parameters, and whatever reads the caller's images)
        // and the epilogue (the read-back, sized to the target). The body,
        // tens of dispatches, is recorded once per slot.
        let kind = match input {
            Input::Rgb { .. } => MainKind::Rgb,
            Input::Planes { .. } => MainKind::Planes,
        };
        let prologue = self.commands.buffers[slot * COMMANDS_PER_SLOT];
        let epilogue = self.commands.buffers[slot * COMMANDS_PER_SLOT + 1];
        let main = self.commands.buffers[slot * COMMANDS_PER_SLOT + 2 + kind as usize];
        self.record_prologue(prologue, slot, &input, target_bytes)?;
        if !self.recorded[slot][kind as usize] {
            self.record_main(main, slot, kind)?;
            self.recorded[slot][kind as usize] = true;
        }
        self.record_epilogue(epilogue, slot, copy_bytes)?;

        let value = self.submitted + 1;
        // The previous frame shares every scratch resource with this one, so
        // this frame starts after it ends.
        let mut waits: Vec<_> = wait.iter().map(TimelinePoint::wait_info).collect();
        waits.push(TimelinePoint::new(self.timeline.semaphore, self.submitted).wait_info());
        let signals = [vk::SemaphoreSubmitInfo::default()
            .semaphore(self.timeline.semaphore)
            .value(value)
            .stage_mask(vk::PipelineStageFlags2::ALL_COMMANDS)];
        let cmds = [prologue, main, epilogue]
            .map(|c| vk::CommandBufferSubmitInfo::default().command_buffer(c));
        let submit = vk::SubmitInfo2::default()
            .wait_semaphore_infos(&waits)
            .command_buffer_infos(&cmds)
            .signal_semaphore_infos(&signals);
        {
            let inner = self.ctx.inner();
            let _guard = inner.queue_lock.lock();
            unsafe {
                inner
                    .device
                    .queue_submit2(inner.queue, &[submit], vk::Fence::null())?
            };
        }
        self.submitted = value;

        let (tx, rx) = oneshot::channel();
        let header = SequenceHeader {
            width: self.config.width,
            height: self.config.height,
            sequence: self.sequence,
            total_blocks: 0,
            chroma: self.config.chroma,
            colour: self.config.colour,
        };
        let work = Work {
            slot,
            value,
            _input: input,
            header,
            index: self.frames,
            copied_words,
            target_bytes,
            scratch_capacity: (self.payload.size - 8) as u32,
            tx,
        };
        self.frames += 1;
        self.work
            .as_ref()
            .expect("the work channel lives as long as the encoder")
            .send(work)
            .map_err(|_| Error::Cancelled)?;
        Ok(EncodeFuture { rx })
    }

    /// The point the most recent submission signals. Waiting on it on the GPU
    /// orders work after the encoder is done reading the source image.
    pub fn last_submission(&self) -> TimelinePoint {
        TimelinePoint::new(self.timeline.semaphore, self.submitted)
    }

    fn begin(&self, cmd: vk::CommandBuffer, once: bool) -> Result<()> {
        let device = self.ctx.device();
        unsafe {
            device.reset_command_buffer(cmd, vk::CommandBufferResetFlags::empty())?;
            device.begin_command_buffer(
                cmd,
                &vk::CommandBufferBeginInfo::default().flags(if once {
                    vk::CommandBufferUsageFlags::ONE_TIME_SUBMIT
                } else {
                    vk::CommandBufferUsageFlags::empty()
                }),
            )?;
        }
        Ok(())
    }

    fn stamp(&self, cmd: vk::CommandBuffer, slot: usize, i: u32) {
        if let Some(t) = &self.slots[slot].timestamps {
            unsafe {
                self.ctx.device().cmd_write_timestamp2(
                    cmd,
                    vk::PipelineStageFlags2::ALL_COMMANDS,
                    t.pool,
                    i,
                )
            };
        }
    }

    /// Per frame: fresh scratch, the frame's parameters, and every pass that
    /// reads the caller's images, since those change from frame to frame.
    fn record_prologue(
        &self,
        cmd: vk::CommandBuffer,
        slot: usize,
        input: &Input,
        target_bytes: u64,
    ) -> Result<()> {
        let ctx = &self.ctx;
        let device = ctx.device();
        let config = &self.config;
        self.begin(cmd, true)?;
        if let Some(t) = &self.slots[slot].timestamps {
            unsafe { device.cmd_reset_query_pool(cmd, t.pool, 0, t.count) };
        }

        // Every scratch image starts undefined: a frame never reads what the
        // one before it left.
        let mut fresh: Vec<_> = self
            .wavelet
            .images()
            .into_iter()
            .map(|i| (i, vk::ImageLayout::UNDEFINED))
            .collect();
        fresh.extend(
            self.planes
                .iter()
                .map(|p| (p.image, vk::ImageLayout::UNDEFINED)),
        );
        to_general(
            ctx,
            cmd,
            &fresh,
            vk::AccessFlags2::SHADER_READ | vk::AccessFlags2::SHADER_WRITE,
        );

        let params = [
            u32::from(self.sequence),
            (target_bytes.saturating_sub(8) / 4) as u32,
            0,
            0,
        ];
        let params: Vec<u8> = params.iter().flat_map(|v| v.to_le_bytes()).collect();
        unsafe { device.cmd_update_buffer(cmd, self.frame_params.buffer, 0, &params) };
        memory_barrier(
            ctx,
            cmd,
            vk::PipelineStageFlags2::ALL_TRANSFER,
            vk::AccessFlags2::TRANSFER_WRITE,
            vk::PipelineStageFlags2::COMPUTE_SHADER,
            vk::AccessFlags2::SHADER_READ | vk::AccessFlags2::SHADER_WRITE,
        );

        self.stamp(cmd, slot, 0);
        match input {
            Input::Rgb { view, layout } => {
                self.pipelines.rgb.dispatch(
                    cmd,
                    &[
                        Bind::texture(view.view, *layout),
                        Bind::storage(self.plane_views[0]),
                        Bind::storage(self.plane_views[1]),
                        Bind::storage(self.plane_views[2]),
                    ],
                    &RgbPush {
                        width: config.width,
                        height: config.height,
                        source: config.source as u32,
                        hdr: u32::from(config.colour.is_hdr()),
                        reference_white_nits: config.reference_white_nits,
                    },
                    (
                        config.width.div_ceil(2).div_ceil(8),
                        config.height.div_ceil(2).div_ceil(8),
                        1,
                    ),
                );
                compute_barrier(ctx, cmd);
                self.stamp(cmd, slot, 1);
            }
            Input::Planes { views, layout } => {
                self.stamp(cmd, slot, 1);
                let views = views.each_ref().map(|v| v.view);
                self.record_dwt(cmd, &views, *layout, |level, component| {
                    reads_plane(config.chroma, level, component)
                });
            }
        }

        unsafe { device.end_command_buffer(cmd)? };
        Ok(())
    }

    /// Once per slot and input kind: every pass after the first transforms
    /// of the planes. Nothing in it changes between frames; what does is
    /// read from `frame_params`.
    fn record_main(&self, cmd: vk::CommandBuffer, slot: usize, kind: MainKind) -> Result<()> {
        let ctx = &self.ctx;
        let device = ctx.device();
        let layout = &*self.layout;
        let config = &self.config;
        let p = &self.pipelines;
        self.begin(cmd, false)?;

        // Forward transforms. From the encoder's own planes they all run
        // here; from the caller's, the ones reading its planes ran in the
        // prologue.
        match kind {
            MainKind::Rgb => {
                self.record_dwt(cmd, &self.plane_views, vk::ImageLayout::GENERAL, |_, _| {
                    true
                })
            }
            MainKind::Planes => self.record_dwt(
                cmd,
                &self.plane_views,
                vk::ImageLayout::GENERAL,
                |level, component| !reads_plane(config.chroma, level, component),
            ),
        }
        self.stamp(cmd, slot, 2);

        // Clear what the quantizer and rate control accumulate into. Here,
        // recorded once, rather than per frame: Mesa's ANV spends 12 ms of CPU
        // recording a fill of the 8 MB bucket buffer 1080p 4:4:4 has, though
        // not the 16 MB one at 4K.
        unsafe {
            device.cmd_fill_buffer(cmd, self.payload.buffer, 0, 8, 0);
            device.cmd_fill_buffer(cmd, self.buckets.buffer, 0, vk::WHOLE_SIZE, 0);
            device.cmd_fill_buffer(cmd, self.quant.buffer, 0, vk::WHOLE_SIZE, 0);
        }
        memory_barrier(
            ctx,
            cmd,
            vk::PipelineStageFlags2::CLEAR,
            vk::AccessFlags2::TRANSFER_WRITE,
            vk::PipelineStageFlags2::COMPUTE_SHADER,
            vk::AccessFlags2::SHADER_READ | vk::AccessFlags2::SHADER_WRITE,
        );

        // Quantize every band.
        let border = self.wavelet.border.sampler;
        let payload_capacity = (self.payload.size - 8) as u32;
        for (component, level, band, b) in layout.bands() {
            let res = rate::quant_resolution(level, component, band);
            p.quant.dispatch(
                cmd,
                &[Bind::sampled(self.wavelet.bands[component][level], border)],
                &QuantPush {
                    block_meta: self.block_meta.address,
                    block_stats: self.block_stats.address,
                    payload_counter: self.payload.address,
                    payload_data: self.payload.address + 8,
                    resolution: [b.width as i32, b.height as i32],
                    resolution_8x8_blocks: [
                        b.width.div_ceil(8) as i32,
                        b.height.div_ceil(8) as i32,
                    ],
                    inv_resolution: [1.0 / b.width as f32, 1.0 / b.height as f32],
                    input_layer: band as f32,
                    quant_resolution: 1.0 / rate::decode_quant(rate::encode_quant(1.0 / res)),
                    block_offset: b.offset_8x8 as i32,
                    block_stride: b.stride_8x8 as i32,
                    rdo_distortion_scale: rate::rdo_distortion_scale(
                        level,
                        component,
                        band,
                        config.chroma,
                    ) / 256.0,
                    payload_capacity,
                },
                (b.width.div_ceil(32), b.height.div_ceil(32), 1),
            );
        }
        compute_barrier(ctx, cmd);
        self.stamp(cmd, slot, 3);

        // Rate control: sort every possible saving into buckets.
        let per_sub = rate::blocks_per_subdivision(layout.blocks_32x32());
        let savings = self.buckets.address + rate::RDO_BUCKET_OFFSET;
        let operations =
            savings + u64::from(rate::NUM_RDO_BUCKETS * rate::BLOCK_SPACE_SUBDIVISION) * 4;
        for (_, _, _, b) in layout.bands() {
            p.analyze.dispatch(
                cmd,
                &[],
                &AnalyzePush {
                    buckets: self.buckets.address,
                    total_savings_per_bucket: savings,
                    rdo_operations: operations,
                    block_stats: self.block_stats.address,
                    resolution: [b.width as i32, b.height as i32],
                    resolution_8x8_blocks: [
                        b.width.div_ceil(8) as i32,
                        b.height.div_ceil(8) as i32,
                    ],
                    block_offset_8x8: b.offset_8x8 as i32,
                    block_stride_8x8: b.stride_8x8 as i32,
                    block_offset_32x32: b.offset_32x32 as i32,
                    block_stride_32x32: b.stride_32x32 as i32,
                    total_wg_count: layout.blocks_32x32(),
                    num_blocks_aligned: per_sub * rate::BLOCK_SPACE_SUBDIVISION,
                    block_index_shamt: per_sub.trailing_zeros(),
                    _pad: 0,
                },
                (b.width.div_ceil(32), b.height.div_ceil(32), 1),
            );
        }
        compute_barrier(ctx, cmd);
        p.finalize.dispatch(
            cmd,
            &[],
            &FinalizePush {
                total_savings_per_bucket: savings,
            },
            (1, 1, 1),
        );
        compute_barrier(ctx, cmd);
        self.stamp(cmd, slot, 4);

        // Rate control: spend buckets until the frame fits.
        p.resolve.dispatch(
            cmd,
            &[],
            &ResolvePush {
                buckets: self.buckets.address,
                total_savings_per_bucket: savings,
                rdo_operations: operations,
                quant_data: self.quant.address,
                frame_params: self.frame_params.address,
                num_blocks_per_subdivision: per_sub,
                _pad: 0,
            },
            (rate::NUM_RDO_BUCKETS * rate::BLOCK_SPACE_SUBDIVISION, 1, 1),
        );
        compute_barrier(ctx, cmd);
        self.stamp(cmd, slot, 5);

        // Pack the final blocks.
        let capacity_words = (self.bitstream.size / 4) as u32;
        for (component, level, band, b) in layout.bands() {
            let res = rate::quant_resolution(level, component, band);
            let (bx, by) = b.blocks_32x32();
            p.packing.dispatch(
                cmd,
                &[],
                &PackingPush {
                    bitstream_data: self.bitstream.address,
                    bitstream_data_16b: self.bitstream.address,
                    bitstream_data_8b: self.bitstream.address,
                    bitstream_meta: self.table.address,
                    block_meta: self.block_meta.address,
                    payload_counter: self.payload.address,
                    payload_data: self.payload.address + 8,
                    block_stats: self.block_stats.address,
                    quant_data: self.quant.address,
                    frame_params: self.frame_params.address,
                    resolution: [b.width as i32, b.height as i32],
                    resolution_32x32_blocks: [bx as i32, by as i32],
                    resolution_8x8_blocks: [
                        b.width.div_ceil(8) as i32,
                        b.height.div_ceil(8) as i32,
                    ],
                    quant_resolution_code: u32::from(rate::encode_quant(1.0 / res)),
                    block_offset_32x32: b.offset_32x32 as i32,
                    block_stride_32x32: b.stride_32x32 as i32,
                    block_offset_8x8: b.offset_8x8 as i32,
                    block_stride_8x8: b.stride_8x8 as i32,
                    bitstream_capacity_words: capacity_words,
                },
                (bx.div_ceil(2), by.div_ceil(2), 1),
            );
        }
        memory_barrier(
            ctx,
            cmd,
            vk::PipelineStageFlags2::COMPUTE_SHADER,
            vk::AccessFlags2::SHADER_WRITE,
            vk::PipelineStageFlags2::COPY,
            vk::AccessFlags2::TRANSFER_READ,
        );
        self.stamp(cmd, slot, 6);

        unsafe { device.end_command_buffer(cmd)? };
        Ok(())
    }

    /// Per frame: the table, the counters, and the bitstream up to the
    /// target plus headroom, into the slot's read-back buffer.
    fn record_epilogue(&self, cmd: vk::CommandBuffer, slot: usize, copy_bytes: u64) -> Result<()> {
        let ctx = &self.ctx;
        let device = ctx.device();
        let rb = &*self.readback_layout;
        let readback = self.slots[slot].readback.lock().unwrap().buffer;
        self.begin(cmd, true)?;
        unsafe {
            device.cmd_copy_buffer(
                cmd,
                self.table.buffer,
                readback,
                &[vk::BufferCopy {
                    src_offset: 0,
                    dst_offset: rb.table,
                    size: self.table.size,
                }],
            );
            device.cmd_copy_buffer(
                cmd,
                self.payload.buffer,
                readback,
                &[vk::BufferCopy {
                    src_offset: 0,
                    dst_offset: rb.counters,
                    size: 8,
                }],
            );
            device.cmd_copy_buffer(
                cmd,
                self.bitstream.buffer,
                readback,
                &[vk::BufferCopy {
                    src_offset: 0,
                    dst_offset: rb.bitstream,
                    size: copy_bytes,
                }],
            );
        }
        memory_barrier(
            ctx,
            cmd,
            vk::PipelineStageFlags2::COPY,
            vk::AccessFlags2::TRANSFER_WRITE,
            vk::PipelineStageFlags2::HOST,
            vk::AccessFlags2::HOST_READ,
        );
        unsafe { device.end_command_buffer(cmd)? };
        Ok(())
    }

    /// The forward transforms `include` selects, level by level, reading the
    /// planes through `planes` in `planes_layout`.
    fn record_dwt(
        &self,
        cmd: vk::CommandBuffer,
        planes: &[vk::ImageView; 3],
        planes_layout: vk::ImageLayout,
        include: impl Fn(usize, usize) -> bool,
    ) {
        let ctx = &self.ctx;
        let layout = &*self.layout;
        let chroma = self.config.chroma;
        let mirror = self.wavelet.mirror.sampler;
        for level in 0..DECOMPOSITION_LEVELS {
            let mut any = false;
            // A component indexes the planes, their views and the wavelet
            // bands alike.
            #[allow(clippy::needless_range_loop)]
            for component in 0..NUM_COMPONENTS {
                if !chroma.has_level(component, level) || !include(level, component) {
                    continue;
                }
                // What this component's transform at this level reads: its
                // plane where it enters the transform, otherwise the LL band
                // the level above left.
                let (view, view_layout, resolution, aligned, shift) =
                    if reads_plane(chroma, level, component) {
                        let aligned = if level == 0 {
                            [layout.aligned_width, layout.aligned_height]
                        } else {
                            [layout.aligned_width >> 1, layout.aligned_height >> 1]
                        };
                        (
                            planes[component],
                            planes_layout,
                            [self.planes[component].width, self.planes[component].height],
                            aligned,
                            true,
                        )
                    } else {
                        let (w, h) = layout.level_size(level - 1);
                        (
                            self.wavelet.ll[component][level - 1],
                            vk::ImageLayout::GENERAL,
                            [w, h],
                            [w, h],
                            false,
                        )
                    };
                self.pipelines.dwt[usize::from(shift)].dispatch(
                    cmd,
                    &[
                        Bind::sampled_in(view, mirror, view_layout),
                        Bind::storage(self.wavelet.bands[component][level]),
                    ],
                    &DwtPush {
                        resolution: [resolution[0] as i32, resolution[1] as i32],
                        inv_resolution: [1.0 / resolution[0] as f32, 1.0 / resolution[1] as f32],
                        aligned_resolution: [aligned[0] as i32, aligned[1] as i32],
                    },
                    (aligned[0].div_ceil(32), aligned[1].div_ceil(32), 1),
                );
                any = true;
            }
            if any {
                compute_barrier(ctx, cmd);
            }
        }
    }
}

/// Whether a component's transform at `level` reads its plane: at level 0,
/// or at level 1 for 4:2:0 chroma, whose half-size plane enters there.
fn reads_plane(chroma: Chroma, level: usize, component: usize) -> bool {
    level == 0 || (level == 1 && !chroma.has_level(component, 0))
}

/// Which body a frame runs: after the encoder's own conversion, or after the
/// first transforms of the caller's planes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MainKind {
    Rgb = 0,
    Planes = 1,
}

/// Prologue, epilogue, and one body for each kind of input.
const COMMANDS_PER_SLOT: usize = 4;

/// Reads one frame back and packetizes it, on the completion thread.
fn complete(
    layout: &Layout,
    slot: &Slot,
    timeline: &Timeline,
    rb: &ReadbackLayout,
    packet_size: usize,
    w: &Work,
) -> Result<EncodedFrame> {
    timeline.wait(w.value)?;
    let readback = slot.readback.lock().unwrap();
    readback.invalidate()?;
    let bytes = readback.bytes();

    let blocks = layout.blocks_32x32() as usize;
    let words = |offset: u64, count: usize| -> Vec<u32> {
        let start = offset as usize;
        bytes[start..start + 4 * count]
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| u32::from_le_bytes(*b))
            .collect()
    };
    let raw_table = words(rb.table, 2 * blocks);
    let counters = words(rb.counters, 2);
    let bitstream = words(rb.bitstream, w.copied_words as usize);

    let mut table: Vec<GpuPacket> = raw_table
        .as_chunks::<2>()
        .0
        .iter()
        .map(|p| GpuPacket {
            offset_words: p[0],
            num_words: p[1],
        })
        .collect();

    // Blocks rate control produced beyond what was read back are dropped,
    // whole; so, earlier, were blocks past the scratch payload's capacity.
    // Either is a frame that overshot badly, and says so in the stats.
    let mut dropped_blocks = 0;
    for entry in &mut table {
        if entry.num_words != 0 && entry.offset_words + entry.num_words > w.copied_words {
            entry.num_words = 0;
            dropped_blocks += 1;
        }
    }
    if dropped_blocks > 0 {
        tracing::warn!(
            frame = w.index,
            dropped_blocks,
            produced_words = counters[1],
            read_back_words = w.copied_words,
            "rate control overshot the read-back; blocks dropped"
        );
    }

    let frame = packetize(layout, w.header, &table, &bitstream, packet_size)?;

    let passes = match &slot.timestamps {
        Some(t) => t.read()?,
        None => vec![0.0; TIMESTAMPS as usize - 1],
    };
    let stats = EncodeStats {
        convert_ns: passes[0],
        dwt_ns: passes[1],
        quant_ns: passes[2],
        analyze_ns: passes[3],
        resolve_ns: passes[4],
        packing_ns: passes[5],
        target_bytes: w.target_bytes,
        produced_words: counters[1],
        dropped_blocks,
        scratch_bytes: counters[0],
        scratch_capacity: w.scratch_capacity,
    };
    if stats.scratch_overflowed() {
        tracing::warn!(
            frame = w.index,
            scratch_bytes = stats.scratch_bytes,
            scratch_capacity = stats.scratch_capacity,
            "the quantizer's scratch payload overflowed; blocks dropped"
        );
    }

    Ok(EncodedFrame {
        data: frame.data,
        packets: frame.packets,
        critical_packets: frame.critical_packets,
        index: w.index,
        sequence: w.header.sequence,
        stats,
    })
}

impl Drop for Encoder {
    fn drop(&mut self) {
        // Let the completion thread drain what is in flight, then stop it.
        drop(self.work.take());
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
        // Nothing may be destroyed while the GPU still uses it.
        let _ = self.timeline.wait(self.submitted);
    }
}
