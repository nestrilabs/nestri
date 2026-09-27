//! The decoder: packets in as they arrive, three planes out.
//!
//! Packets go to [`Decoder::push_packet`] in any order. When
//! [`Decoder::readiness`] says enough of the frame is there, and when that is
//! enough is the caller's decision, [`Decoder::decode_after`] submits the
//! frame and returns its planes with the timeline point they are ready at.
//! Nothing waits on the CPU: the consumer waits on that point in its own
//! submission.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use ash::vk;

use crate::bitstream::{
    Chroma, ColourDescription, DECOMPOSITION_LEVELS, Depacketizer, Layout, NUM_COMPONENTS, Push,
    Readiness,
};
use crate::device::Context;
use crate::encoder::Depth;
use crate::error::{Error, Result};
use crate::gpu::{
    Buffer, Commands, Image, ImageDesc, Location, Timeline, Timestamps, compute_barrier,
    memory_barrier, to_general,
};
use crate::pipeline::{Bind, Pipeline, PipelineDesc, SubgroupSize, entry};
use crate::shaders;
use crate::sync::TimelinePoint;
use crate::wavelet::Wavelet;

#[derive(Debug, Clone)]
pub struct DecodeConfig {
    pub width: u32,
    pub height: u32,
    pub chroma: Chroma,
    /// Depth of the output planes. The stream does not carry one: PyroWave
    /// decodes in floating point, so this is the consumer's choice.
    pub depth: Depth,
    /// The queue family that reads the planes, when it is not nespyro's.
    pub consumer_family: Option<u32>,
}

impl DecodeConfig {
    pub fn new(width: u32, height: u32, chroma: Chroma, depth: Depth) -> Self {
        Self {
            width,
            height,
            chroma,
            depth,
            consumer_family: None,
        }
    }

    /// Output planes are shared with `family`, so a consumer there samples
    /// them without an ownership transfer.
    pub fn with_consumer_queue_family(mut self, family: u32) -> Self {
        self.consumer_family = Some(family);
        self
    }
}

/// One output plane.
///
/// The image is padded to the codec's alignment, so the last inverse
/// transform never writes out of bounds; only `width` × `height` from the
/// top-left corner is the picture. Sample by texel coordinate, or scale
/// normalised coordinates by `width / image_width`.
#[derive(Debug, Clone, Copy)]
pub struct PlaneView {
    pub image: vk::Image,
    pub view: vk::ImageView,
    pub format: vk::Format,
    pub width: u32,
    pub height: u32,
    pub image_width: u32,
    pub image_height: u32,
}

/// A decoded frame: its planes stay the caller's until this is dropped.
///
/// The planes are in `GENERAL`, full-range YCbCr as `colour` describes, and
/// valid once `ready` is reached. A consumer waits on `ready` in its own
/// submission and drops the frame only after that submission is done with
/// the planes, since dropping hands them back for the next decode.
pub struct DecodedFrame {
    pub y: PlaneView,
    pub cb: PlaneView,
    pub cr: PlaneView,
    pub width: u32,
    pub height: u32,
    pub chroma: Chroma,
    pub depth: Depth,
    pub colour: ColourDescription,
    /// Blocks the frame's header promised that never arrived, decoded as
    /// zeros. Zero for a whole frame.
    pub missing_blocks: u32,
    pub ready: TimelinePoint,
    _hold: SlotHold,
}

impl std::fmt::Debug for DecodedFrame {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DecodedFrame")
            .field("width", &self.width)
            .field("height", &self.height)
            .field("chroma", &self.chroma)
            .field("colour", &self.colour)
            .field("missing_blocks", &self.missing_blocks)
            .field("ready", &self.ready)
            .finish_non_exhaustive()
    }
}

/// Marks an output slot busy until dropped.
struct SlotHold(Arc<AtomicBool>);

impl Drop for SlotHold {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

/// Output slots. One being decoded, one being shown, one spare.
const OUTPUTS: usize = 3;
/// Uploads in flight.
const UPLOADS: usize = 2;

struct Output {
    planes: [Image; 3],
    views: [vk::ImageView; 3],
    held: Arc<AtomicBool>,
}

/// GPU time of one decode, in nanoseconds.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct DecodeStats {
    /// Copying the payload to device-local memory, when it is not there
    /// already.
    pub upload_ns: f64,
    pub dequant_ns: f64,
    pub idwt_ns: f64,
}

impl DecodeStats {
    pub fn gpu_ns(&self) -> f64 {
        self.upload_ns + self.dequant_ns + self.idwt_ns
    }
}

/// Timestamps around the upload, the dequantizer and the inverse transform.
const TIMESTAMPS: u32 = 4;

/// One frame's upload: the block offset table, then the payload words, then
/// padding the dequantizer may read one word into.
struct Upload {
    timestamps: Option<Timestamps>,
    host: Buffer,
    /// Where the shaders read from: `host` itself when it is device local,
    /// otherwise a device-local copy.
    device: Option<Buffer>,
    /// The timeline value of the last decode that read this upload.
    last_use: u64,
}

/// The dequantizer reads a word past the end of the last block's signs.
const PAYLOAD_PADDING: u64 = 16;

#[repr(C)]
#[derive(Clone, Copy)]
struct DequantPush {
    payload_offsets: u64,
    payload_data_u32: u64,
    payload_data_u16: u64,
    payload_data_u8: u64,
    resolution: [i32; 2],
    output_layer: i32,
    block_offset_32x32: i32,
    block_stride_32x32: i32,
    _pad: i32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct IdwtPush {
    resolution: [i32; 2],
    inv_resolution: [f32; 2],
}

pub struct Decoder {
    ctx: Context,
    config: DecodeConfig,
    layout: Layout,
    depacketizer: Depacketizer,
    dequant: Pipeline,
    /// Without and with the DC shift of a plane's final transform.
    idwt: [Pipeline; 2],
    wavelet: Wavelet,
    outputs: [Output; OUTPUTS],
    uploads: [Upload; UPLOADS],
    next_upload: usize,
    commands: Commands,
    timeline: Timeline,
    submitted: u64,
}

impl Decoder {
    pub fn new(ctx: Context, config: DecodeConfig) -> Result<Self> {
        if !ctx.supports_decode() {
            return Err(Error::Config(
                "the context's device was not created for decoding (Roles::DECODE)".into(),
            ));
        }
        let layout = Layout::new(config.width, config.height, config.chroma)?;
        let s = ctx.inner().subgroups;

        // Upstream prefers 16 and wider, and falls back to anything from 4.
        let dequant_size = s.pick(16, 128).or_else(|| s.pick(4, 128)).ok_or_else(|| {
            Error::Unsupported(vec!["a subgroup size for the dequantizer".into()])
        })?;
        let dequant = Pipeline::new(
            &ctx,
            &PipelineDesc {
                spirv: shaders::WAVELET_DEQUANT,
                entry: entry::WAVELET_DEQUANT,
                bindings: &[vk::DescriptorType::STORAGE_IMAGE],
                push_size: std::mem::size_of::<DequantPush>() as u32,
                specialization: &[],
                subgroup: dequant_size,
            },
        )?;
        let idwt_spirv = if ctx.inner().enabled.shader_float16 {
            shaders::IDWT_FP16
        } else {
            shaders::IDWT_FP32
        };
        let [idwt0, idwt1] = [0, 1].map(|shift| {
            Pipeline::new(
                &ctx,
                &PipelineDesc {
                    spirv: idwt_spirv,
                    entry: entry::IDWT,
                    bindings: &[
                        vk::DescriptorType::COMBINED_IMAGE_SAMPLER,
                        vk::DescriptorType::STORAGE_IMAGE,
                    ],
                    push_size: std::mem::size_of::<IdwtPush>() as u32,
                    specialization: &[(0, shift)],
                    subgroup: SubgroupSize::Any,
                },
            )
        });
        let wavelet = Wavelet::new(&ctx, &layout)?;

        let mut families = vec![ctx.queue_family()];
        families.extend(config.consumer_family);
        // Planes the size the transform writes, not the picture: see
        // `PlaneView`.
        let (aw, ah) = (layout.aligned_width, layout.aligned_height);
        let (acw, ach) = match config.chroma {
            Chroma::Yuv420 => (aw / 2, ah / 2),
            Chroma::Yuv444 => (aw, ah),
        };
        let make_output = || -> Result<Output> {
            let plane = |w, h| {
                Image::new(
                    &ctx,
                    &ImageDesc {
                        format: config.depth.format(),
                        width: w,
                        height: h,
                        layers: 1,
                        mips: 1,
                        usage: vk::ImageUsageFlags::SAMPLED
                            | vk::ImageUsageFlags::STORAGE
                            | vk::ImageUsageFlags::TRANSFER_SRC,
                        families: &families,
                    },
                )
            };
            let mut planes = [plane(aw, ah)?, plane(acw, ach)?, plane(acw, ach)?];
            let mut views = [vk::ImageView::null(); 3];
            for (v, p) in views.iter_mut().zip(planes.iter_mut()) {
                *v = p.view(vk::ImageViewType::TYPE_2D, 0, 0, 1)?;
            }
            Ok(Output {
                planes,
                views,
                held: Arc::new(AtomicBool::new(false)),
            })
        };
        let outputs = [make_output()?, make_output()?, make_output()?];

        let make_upload = || Self::upload_buffers(&ctx, &layout, 256 * 1024);
        let uploads = [make_upload()?, make_upload()?];

        Ok(Self {
            depacketizer: Depacketizer::new(layout.clone()),
            commands: Commands::new(&ctx, UPLOADS as u32)?,
            timeline: Timeline::new(&ctx)?,
            ctx,
            config,
            layout,
            dequant,
            idwt: [idwt0?, idwt1?],
            wavelet,
            outputs,
            uploads,
            next_upload: 0,
            submitted: 0,
        })
    }

    fn upload_buffers(ctx: &Context, layout: &Layout, payload_bytes: u64) -> Result<Upload> {
        let size = u64::from(layout.blocks_32x32()) * 4 + payload_bytes + PAYLOAD_PADDING;
        let usage = vk::BufferUsageFlags::STORAGE_BUFFER | vk::BufferUsageFlags::TRANSFER_SRC;
        let host = Buffer::new(ctx, size, usage, Location::Upload)?;
        let device = if host.device_local {
            None
        } else {
            Some(Buffer::new(
                ctx,
                size,
                vk::BufferUsageFlags::STORAGE_BUFFER | vk::BufferUsageFlags::TRANSFER_DST,
                Location::Device,
            )?)
        };
        Ok(Upload {
            timestamps: if ctx.inner().timestamps {
                Some(Timestamps::new(ctx, TIMESTAMPS)?)
            } else {
                None
            },
            host,
            device,
            last_use: 0,
        })
    }

    pub fn config(&self) -> &DecodeConfig {
        &self.config
    }

    /// Takes one packet. See [`Depacketizer::push`].
    pub fn push_packet(&mut self, packet: &[u8]) -> Result<Push> {
        Ok(self.depacketizer.push(packet)?)
    }

    pub fn readiness(&self) -> Readiness {
        self.depacketizer.readiness()
    }

    /// GPU time of the most recent decode, once it is done; `None` before it
    /// is, or on a queue without timestamps.
    pub fn stats(&self) -> Result<Option<DecodeStats>> {
        if self.submitted == 0 || self.timeline_value()? < self.submitted {
            return Ok(None);
        }
        let last = (self.next_upload + UPLOADS - 1) % UPLOADS;
        let Some(t) = &self.uploads[last].timestamps else {
            return Ok(None);
        };
        let passes = t.read()?;
        Ok(Some(DecodeStats {
            upload_ns: passes[0],
            dequant_ns: passes[1],
            idwt_ns: passes[2],
        }))
    }

    fn timeline_value(&self) -> Result<u64> {
        Ok(unsafe {
            self.ctx
                .device()
                .get_semaphore_counter_value(self.timeline.semaphore)?
        })
    }

    /// Forgets the frame being collected.
    pub fn clear(&mut self) {
        self.depacketizer.clear();
    }

    /// Decodes what has arrived of the current frame once every point in
    /// `wait` is reached. Missing blocks decode as zeros.
    pub fn decode_after(&mut self, wait: &[TimelinePoint]) -> Result<DecodedFrame> {
        let r = self.depacketizer.readiness();
        if !r.has_header {
            return Err(Error::NotReady("no start-of-frame header has arrived"));
        }
        if r.decoded {
            return Err(Error::NotReady("this frame was already decoded"));
        }
        let output = self
            .outputs
            .iter()
            .position(|o| !o.held.load(Ordering::Acquire))
            .ok_or(Error::Busy)?;

        let colour = self.depacketizer.colour().unwrap_or_default();
        let missing_blocks = self.depacketizer.missing_blocks();

        // The upload slot's last decode must be done before it is rewritten.
        let u = self.next_upload;
        self.next_upload = (u + 1) % UPLOADS;
        self.timeline.wait(self.uploads[u].last_use)?;

        let (offsets, payload) = self.depacketizer.take_for_decode();
        let offsets_bytes = offsets.len() as u64 * 4;
        let payload_bytes = payload.len() as u64 * 4;
        if offsets_bytes + payload_bytes + PAYLOAD_PADDING > self.uploads[u].host.size {
            let grown = (payload_bytes * 2).max(256 * 1024);
            self.uploads[u] = Self::upload_buffers(&self.ctx, &self.layout, grown)?;
        }
        {
            let host = &mut self.uploads[u].host;
            let bytes = host.bytes_mut();
            let (table, rest) = bytes.split_at_mut(offsets_bytes as usize);
            for (dst, src) in table.as_chunks_mut::<4>().0.iter_mut().zip(offsets) {
                *dst = src.to_le_bytes();
            }
            for (dst, src) in rest.as_chunks_mut::<4>().0.iter_mut().zip(payload) {
                *dst = src.to_le_bytes();
            }
            let pad = payload_bytes as usize;
            rest[pad..pad + PAYLOAD_PADDING as usize].fill(0);
            host.flush()?;
        }
        let upload_size = offsets_bytes + payload_bytes + PAYLOAD_PADDING;

        let cmd = self.commands.buffers[u];
        self.record(cmd, u, output, offsets_bytes, upload_size)?;

        let value = self.submitted + 1;
        let mut waits: Vec<_> = wait.iter().map(TimelinePoint::wait_info).collect();
        // Decodes share the wavelet images: each starts after the last.
        waits.push(TimelinePoint::new(self.timeline.semaphore, self.submitted).wait_info());
        let signals = [vk::SemaphoreSubmitInfo::default()
            .semaphore(self.timeline.semaphore)
            .value(value)
            .stage_mask(vk::PipelineStageFlags2::ALL_COMMANDS)];
        let cmds = [vk::CommandBufferSubmitInfo::default().command_buffer(cmd)];
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
        self.uploads[u].last_use = value;

        let o = &self.outputs[output];
        o.held.store(true, Ordering::Release);
        let (cw, ch) = match self.config.chroma {
            Chroma::Yuv420 => (self.config.width / 2, self.config.height / 2),
            Chroma::Yuv444 => (self.config.width, self.config.height),
        };
        let plane = |i: usize| PlaneView {
            image: o.planes[i].image,
            view: o.views[i],
            format: o.planes[i].format,
            width: if i == 0 { self.config.width } else { cw },
            height: if i == 0 { self.config.height } else { ch },
            image_width: o.planes[i].width,
            image_height: o.planes[i].height,
        };
        Ok(DecodedFrame {
            y: plane(0),
            cb: plane(1),
            cr: plane(2),
            width: self.config.width,
            height: self.config.height,
            chroma: self.config.chroma,
            depth: self.config.depth,
            colour,
            missing_blocks,
            ready: TimelinePoint::new(self.timeline.semaphore, value),
            _hold: SlotHold(o.held.clone()),
        })
    }

    fn record(
        &self,
        cmd: vk::CommandBuffer,
        upload: usize,
        output: usize,
        offsets_bytes: u64,
        upload_size: u64,
    ) -> Result<()> {
        let ctx = &self.ctx;
        let device = ctx.device();
        let layout = &self.layout;
        let chroma = self.config.chroma;
        let out = &self.outputs[output];
        let up = &self.uploads[upload];

        unsafe {
            device.reset_command_buffer(cmd, vk::CommandBufferResetFlags::empty())?;
            device.begin_command_buffer(
                cmd,
                &vk::CommandBufferBeginInfo::default()
                    .flags(vk::CommandBufferUsageFlags::ONE_TIME_SUBMIT),
            )?;
        }
        let stamp = |i: u32| {
            if let Some(t) = &up.timestamps {
                unsafe {
                    device.cmd_write_timestamp2(
                        cmd,
                        vk::PipelineStageFlags2::ALL_COMMANDS,
                        t.pool,
                        i,
                    )
                };
            }
        };
        if let Some(t) = &up.timestamps {
            unsafe { device.cmd_reset_query_pool(cmd, t.pool, 0, t.count) };
        }
        stamp(0);

        let source = match &up.device {
            Some(dst) => {
                unsafe {
                    device.cmd_copy_buffer(
                        cmd,
                        up.host.buffer,
                        dst.buffer,
                        &[vk::BufferCopy {
                            src_offset: 0,
                            dst_offset: 0,
                            size: upload_size,
                        }],
                    )
                };
                memory_barrier(
                    ctx,
                    cmd,
                    vk::PipelineStageFlags2::COPY,
                    vk::AccessFlags2::TRANSFER_WRITE,
                    vk::PipelineStageFlags2::COMPUTE_SHADER,
                    vk::AccessFlags2::SHADER_READ,
                );
                dst.address
            }
            None => up.host.address,
        };
        let offsets = source;
        let payload = source + offsets_bytes;

        let mut fresh: Vec<_> = self
            .wavelet
            .images()
            .into_iter()
            .map(|i| (i, vk::ImageLayout::UNDEFINED))
            .collect();
        fresh.extend(
            out.planes
                .iter()
                .map(|p| (p.image, vk::ImageLayout::UNDEFINED)),
        );
        to_general(
            ctx,
            cmd,
            &fresh,
            vk::AccessFlags2::SHADER_READ | vk::AccessFlags2::SHADER_WRITE,
        );

        stamp(1);

        // Every band's coefficients.
        for (component, level, band, b) in layout.bands() {
            self.dequant.dispatch(
                cmd,
                &[Bind::storage(self.wavelet.bands[component][level])],
                &DequantPush {
                    payload_offsets: offsets,
                    payload_data_u32: payload,
                    payload_data_u16: payload,
                    payload_data_u8: payload,
                    resolution: [b.width as i32, b.height as i32],
                    output_layer: band as i32,
                    block_offset_32x32: b.offset_32x32 as i32,
                    block_stride_32x32: b.stride_32x32 as i32,
                    _pad: 0,
                },
                (b.width.div_ceil(32), b.height.div_ceil(32), 1),
            );
        }
        compute_barrier(ctx, cmd);
        stamp(2);

        // Inverse transforms, coarsest level first.
        let mirror = self.wavelet.mirror.sampler;
        for level in (0..DECOMPOSITION_LEVELS).rev() {
            let (w, h) = layout.level_size(level);
            // Transposed, as the shader expects.
            let push = IdwtPush {
                resolution: [h as i32, w as i32],
                inv_resolution: [1.0 / h as f32, 1.0 / w as f32],
            };
            for component in 0..NUM_COMPONENTS {
                if !chroma.has_level(component, level) {
                    continue;
                }
                // Where this level's reconstruction goes: the next level's
                // LL band, or at the end, the output plane with the DC shift
                // undone.
                let (target, shift) = if level == 0 || !chroma.has_level(component, level - 1) {
                    (out.views[component], true)
                } else {
                    (self.wavelet.ll[component][level - 1], false)
                };
                self.idwt[usize::from(shift)].dispatch(
                    cmd,
                    &[
                        Bind::sampled(self.wavelet.bands[component][level], mirror),
                        Bind::storage(target),
                    ],
                    &push,
                    (h.div_ceil(16), w.div_ceil(16), 1),
                );
            }
            compute_barrier(ctx, cmd);
        }
        stamp(3);

        unsafe { device.end_command_buffer(cmd)? };
        Ok(())
    }
}

impl Drop for Decoder {
    fn drop(&mut self) {
        // Nothing may be destroyed while the GPU still uses it.
        let _ = self.timeline.wait(self.submitted);
    }
}
