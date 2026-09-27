# nespyro: a PyroWave codec crate

Status: approved design, 2026-09-27. Part 1 of 4.

## Why

Nestri streams with hardware H.264, H.265 and AV1 through Vulkan Video. PyroWave
(Hans-Kristian Arntzen, MIT) is an intra-only wavelet codec that runs entirely in
compute shaders. It spends far more bandwidth (about 170 Mbit/s at 1080p60 4:2:0)
and far less time (upstream claims under 0.1 ms encode and decode at 1080p) than
any hardware encoder, which makes it the LAN codec: a direct path, a wired
network, and latency as the only thing that matters.

## The four parts

Each part gets its own spec and is built complete; nothing half-wired lands.

1. **nespyro** (this spec): the codec as a Rust crate, both directions, proven
   on one device and against the C++ reference.
2. **Protocol and transport**: a codec id, a self-contained-frame flag so intra
   frames do not ride the reliable keyframe path, datagrams cut on PyroWave
   packet boundaries, partial frames delivered to the decoder, and a bitrate
   ceiling that admits hundreds of Mbit/s.
3. **nescapture**: `PerFrameEncoder` behind an abstraction over pixelforge or
   nespyro, and nespyro's device requirements merged into the game's device.
4. **nesrecon / nesvideo**: a nespyro decoder beside the others, a shared device
   and compute queue no longer gated on H.264 Vulkan Video decode, a
   three-plane convert, and the convert shader's format bug fixed while it is
   open (see part 4 notes below).

Parts 3 and 4 depend on 1. Part 2 is independent of both, but nothing crosses
the network without it.

## Decisions

- **Separate crate, not pixelforge.** pixelforge is shaped by Vulkan Video at
  every layer: a closed `Codec` enum matched throughout, a `VideoCodec` trait of
  sessions and DPBs, and device selection that refuses a GPU without a video
  queue. nescore also pins upstream pixelforge rather than the fork, and a
  wavelet codec would never go upstream there.
- **Lives at `nestri/crates/nespyro`**, MIT like PyroWave itself. It is open;
  there is nothing to gate.
- **Bitstream is exactly upstream's**, frozen at PyroWave `89f7e47`
  (2026-09-25). Codec bugs stay reportable upstream, and the C++ reference stays
  a usable oracle. nesprotocol (part 2) carries a PyroWave format version, since
  the bitstream itself has none and is marked draft.
- **Shaders are Slang**, ported from upstream's GLSL, compiled by `build.rs`
  with `slangc` at build time only. Nothing compiles at runtime.
- **Desktop GPUs only** (path A). See "Future work: mobile path".
- **Vulkan 1.3 minimum.** Its core features are used freely.
- **The API mirrors pixelforge** so nescapture plugs it in the same way it
  plugs in the pixelforge encoder.

## Scope

- Chroma 4:2:0 and 4:4:4.
- 8-bit (R8) and 16-bit (R16) planes: SDR, and HDR10 PQ.
- Precision mode 1 only, which is upstream's default: FP16 wavelet storage for
  levels 0 and 1, FP32 for levels 2 to 4. Modes 0 and 2 are tuning knobs that do
  not affect the bitstream.
- The decoder carries the non-FP16 variants of the inverse transform and
  chooses at runtime. The encoder requires `shaderFloat16`, because upstream's
  quantizer and rate-control shaders use it unconditionally.
- Colour: full range always, BT.709 or BT.2020 PQ. Limited range and BT.601
  are not produced.

## Crate layout

```
crates/nespyro/
  build.rs          slangc over an explicit entry-point list
  shaders/          Slang
  src/
    lib.rs
    bitstream/      pure Rust, no Vulkan
    device.rs       requirements, Context
    pipeline.rs     layouts, spec constants, subgroup sizes, cache
    encoder/        EncodeConfig, Encoder, EncodeFuture, EncodedFrame
    decoder/        Decoder, DecodedFrame
    sync.rs         TimelinePoint, QueueLock
  tests/
```

### build.rs and shaders

`build.rs` runs `slangc` (or `$SLANGC`) for each entry point, with
`-target spirv -profile spirv_1_5 -emit-spirv-directly -fvk-use-entrypoint-name`.
It does not pass `-fvk-invert-y`, because everything here is compute. Output
goes to `OUT_DIR`, is embedded with `include_bytes!`, and a missing or failing
`slangc` fails the build with the command it ran.

The guest image builder (`build/Containerfile`, builder stage) gains
`shader-slang` in its `pacman -S` list. The runtime stages do not.

Shaders, ported one to one from upstream:

| Slang | Upstream |
|---|---|
| `common.slang` | `dwt_common.h`, `dwt_swizzle.h`, `dwt_quant_scale.h`, `constants.h` |
| `rgb_to_ycbcr.slang` | none, ours |
| `dwt.slang` | `dwt.comp` |
| `wavelet_quant.slang` | `wavelet_quant.comp` |
| `analyze_rate_control.slang` | `analyze_rate_control.comp`, `analyze_rate_control_finalize.comp` |
| `resolve_rate_control.slang` | `resolve_rate_control.comp` |
| `block_packing.slang` | `block_packing.comp` |
| `wavelet_dequant.slang` | `wavelet_dequant.comp`, SSBO mode only |
| `idwt.slang` | `idwt.comp`, FP16 and FP32 variants |

Buffers are reached through buffer device addresses carried in push constants.
Images and samplers are bound with push descriptors (`VK_KHR_push_descriptor`),
so no descriptor pool exists. Every pipeline declares the subgroup size
upstream requires, and `computeFullSubgroups` where upstream asks for full
groups.

### device

`DeviceRequirements` lists what nespyro needs, in a form a caller merges into a
device it is about to create, as nescapture does for the game's device:

- Vulkan 1.3 core: `synchronization2`, `subgroupSizeControl`,
  `computeFullSubgroups`, `maintenance4`.
- Vulkan 1.2 core: `timelineSemaphore`, `bufferDeviceAddress`,
  `storageBuffer8BitAccess`, `shaderFloat16` (encoder only).
- Vulkan 1.1 core: `storageBuffer16BitAccess`.
- Vulkan 1.0: `shaderInt16`, `shaderStorageImageWriteWithoutFormat`.
- `VK_KHR_push_descriptor`.
- Subgroup operations checked against the device's properties: the encoder
  needs basic, vote, arithmetic, ballot, shuffle, shuffle relative and
  clustered. The decoder needs the same without clustered. Each pipeline's
  subgroup size range, taken from upstream (for example 16..64 for block
  packing, and exactly 64, 16 or 32 for the resolve pass), must intersect the
  device's `minSubgroupSize..maxSubgroupSize`, with compute in
  `requiredSubgroupSizeStages`.

`Context::from_existing(instance, physical_device, device, queue, family,
QueueLock)` wraps a device the caller owns. `Context::supports_encode()` and
`supports_decode()` answer from the device's real features and properties,
never from its name. There is no context that creates its own device; both
callers already have one.

### sync

`TimelinePoint { semaphore, value }` has the same shape as pixelforge's. Waits
use `ALL_COMMANDS`, for the reason pixelforge gives: nespyro's submissions begin
with transitions whose stages the caller cannot know.

`QueueLock` serialises nespyro's submits against anything else on the same
queue. A caller whose queue is not shared passes an uncontended lock.

## Encode

```rust
let mut enc = Encoder::new(ctx, EncodeConfig::new(w, h)
    .with_chroma(Chroma::Yuv444)
    .with_depth(Depth::Sixteen)
    .with_colour(ColourDescription::bt2020_pq())
    .with_frame_rate(120, 1)
    .with_target_bitrate(400_000_000)
    .with_packet_size(1200))?;
let fut = enc.encode_after(src_image, src_format, src_layout, &[blit_done])?;
let frame: EncodedFrame = fut.await?;
```

**Input.** The caller's RGB image, sampled in place: `B8G8R8A8`, `R8G8B8A8`,
`A2B10G10R10` or `R16G16B16A16_SFLOAT`. No copy is made first.

**Per slot** (two in flight): the Y, Cb and Cr plane images, the block
metadata and bitstream buffers, and a persistently mapped host-cached readback
buffer. Upstream recreates its buffers on every call; nespyro allocates them
once.

**Shared across slots**: the wavelet images, the block statistics, the quant
and bucket buffers, and the pipelines. The GPU runs the encode work in order,
so these need no copies.

**One submission per frame:**

1. Wait on the caller's points.
2. `rgb_to_ycbcr` writes the three planes. The matrix and the full range are
   applied here, and so is the 4:2:0 subsampling, with centre siting.
3. `dwt`, 13 dispatches for 4:2:0 and 15 for 4:4:4.
4. `wavelet_quant` then `analyze_rate_control`, per band (42 bands for 4:2:0,
   48 for 4:4:4).
5. `analyze_rate_control_finalize`, then `resolve_rate_control`.
6. `block_packing` per band. Finished 32×32 block packets land in GPU order.
7. Copy the metadata table and the first `target_bytes + headroom` bytes of the
   bitstream into the readback buffer. Rate control caps the frame at its
   target, so the copy is sized to the target, not to the whole buffer.
8. Signal the encoder's timeline.

**Completion thread.** It waits for that value, then packetizes on the CPU:
the 8-byte sequence header first, carrying the configured colour fields and
the frame counter, then every non-empty block in block-index order. A new
packet starts when the next block would pass `packet_size`, and blocks are
never split. It resolves the future with:

```rust
struct EncodedFrame {
    data: Vec<u8>,
    packets: Vec<Range<usize>>,   // each independently parseable
    critical_packets: usize,      // leading packets covering the lowest bands
    pts: u64,
    stats: EncodeStats,           // GPU timestamps per pass
}
```

**Rate control.** The target bits per frame is bitrate ÷ fps.
`set_target_bitrate` takes effect on the next frame with no rebuild. There is
no IDR and no GOP, because every frame stands alone. `set_colour_description`
changes the matrix and the header bits. Changing the size, chroma or depth
means building a new `Encoder`, as in pixelforge.

**Errors.** A block's header size must equal its size in the metadata table,
or packetizing fails with an error, as upstream checks it. A block cannot
exceed the 12-bit `payload_words` limit: the largest possible 32×32 block is
about 620 words (8-byte header, 16 × 3 bytes of codes, 16 × 8 subblocks × 18
planes, 128 bytes of signs), well under 4095. A test pins that bound. A lost
device or failed submit is an error from the future.

## Decode

```rust
let mut dec = Decoder::new(ctx, DecodeConfig::new(w, h, chroma, depth)
    .with_consumer_queue_family(graphics_family))?;
match dec.push_packet(datagram)? { Push::Accepted | Push::Stale => {},
    Push::Reconfigure(info) => { /* rebuild the decoder */ } }
if dec.readiness().is_complete_enough() {
    let frame = dec.decode_after(&[])?;
}
```

**Packets.** `push_packet(&[u8]) -> Result<Push>` parses one packet on the CPU,
copying only block payloads. It handles the 3-bit frame counter as upstream
does: an older frame's packet is `Stale` and dropped, a newer frame's clears
the state. A header that disagrees with the decoder's size, chroma or depth
returns `Reconfigure`, and nothing is rebuilt behind the caller's back. A
truncated packet, or one whose block sizes run past its end, is `Err(Malformed)`,
never skipped.

**Readiness.** `readiness()` reports blocks received against the header's
total, and whether the two lowest bands are complete. When to decode is the
caller's decision (part 2's policy). `is_complete_enough()` is upstream's rule:
every block, or at least 90% with the two lowest bands complete.

**One submission per frame:**

1. Write block payloads and the offset table into the slot's mapped buffer. On
   memory that is both device-local and host-visible (ReBAR, or an integrated
   GPU) the shader reads it there. Otherwise a staging copy moves it to
   device-local memory first.
2. `wavelet_dequant` per band. A missing block has offset `u32::MAX` and
   decodes as zeros.
3. `idwt` per level per component, FP16 or FP32 as chosen at creation. The last
   level adds the DC offset back and writes straight into the output planes.
4. Signal the decoder's timeline.

**Output.**

```rust
struct DecodedFrame {
    y: PlaneView, cb: PlaneView, cr: PlaneView,
    width: u32, height: u32, chroma: Chroma, depth: Depth,
    colour: ColourDescription,   // from the sequence header
    missing_blocks: u32,
    ready: TimelinePoint,
}
```

The planes come from a ring of three slots, R8 or R16, in `GENERAL`, with
sampled and storage usage. When the consumer's queue family differs, they are
created `CONCURRENT` across the decode and consumer families, as pixelforge
does for `with_consumer_queue_family`, so no ownership transfer is needed. The
consumer waits on `ready` in its own submit; nothing waits on the CPU.
Dropping the frame returns its slot. If all three slots are held,
`decode_after` returns `Busy` instead of stalling, which makes a consumer
holding frames too long visible.

A frame decoded with blocks missing succeeds and says so in `missing_blocks`,
so the loss is visible to the caller rather than looking like a whole frame.

## Testing

GPU and reference tests carry `#[ignore = "needs …"]` naming exactly what they
need, and they fail, never skip, when that is absent.

**Bitstream (pure Rust, always run):**
- Header pack and unpack against `bitstream.md`'s field layouts.
- Block-index ordering and the per-level/band tables against values taken from
  `metal/pyrowave_bitstream.cpp`.
- Packetize then parse reproduces every block exactly. No packet passes
  `packet_size` unless one block alone is larger, and no block is split.
- Frame counter wrap: stale packets drop, a new frame clears state.
- A truncated packet or an impossible `payload_words` returns `Malformed`, and
  the parser never reads past the end.
- The largest possible block fits in 12 bits of words.

**GPU (one device):**
- Round trip over synthetic sources (gradients, noise, hard text-like edges,
  flat colour) at 1920×1080, 1366×768 (not a multiple of 32) and one under the
  128 minimum. Each runs in 4:2:0 and 4:4:4, and in R8 and R16. Decoded PSNR
  must clear a threshold for each bitrate.
- Rate control really limits: encoded size is at or under the target at every
  tested rate, and above a floor, so a nearly empty frame decoding to grey
  cannot pass. A low target must give measurably lower PSNR than a high one.
- Determinism: the same input encodes to byte-identical output twice, despite
  the GPU's unordered block writes.
- Colour: known RGB values map to the expected full-range YCbCr for BT.709 and
  BT.2020 PQ. The header's colour bits match the configuration, and the decoder
  reads the same back.
- Loss: dropping non-critical packets still decodes, `missing_blocks` equals
  what was dropped, and the lowest bands are intact. Dropping a critical packet
  shows in `readiness()`.

**Reference cross-check.** A small C++ harness is built from PyroWave
`89f7e47` and Granite `1b2d1801` (`checkout_granite.sh`), outside cargo. Its
path is given in `NESPYRO_REFERENCE`, and the test fails if that is set but the
binary is missing.
- Our encoder into the reference decoder, and the reference encoder into ours.
  Pass is upstream's own tolerance from `pyrowave_device_validation.cpp`: at
  most 1 LSB luma error and at most 2 chroma.
- Our encoder beside theirs on identical YCbCr input. Slang and glslang may
  round floating point differently, so byte identity is not required. The test
  reports the fraction of blocks that match exactly, and the size and PSNR
  difference, as a diagnostic.

**Latency.** A benchmark takes GPU timestamps around every pass, ours beside
the reference, at 1080p and 4K. It measures GPU time, not command recording.

## Future work: mobile path (path B)

Left out on purpose; the device check refuses such devices with a clear error
rather than degrading. Adding them means:

- The fragment inverse transform: `idwt.vert` and `idwt.frag` with its three
  `CHROMA_CONFIG` variants, separate vertical and horizontal passes into
  R16F/R32F (RG for chroma) intermediates, and three scissored draws per pass
  with the `EDGE_CONDITION` specialization constant.
- Its output views need `COLOR_ATTACHMENT` usage, and the pass uses dynamic
  rendering.
- `wavelet_dequant` storage modes 1 (R8/R16/R32 uniform texel buffers, for
  devices without 8-bit storage) and 2 (linear-tiled images aliased on one
  buffer).
- Upstream's vendor preference table (`pyrowave_decoder.cpp:913-930`) choosing
  fragment over compute for Mali, Qualcomm and PanVK.
- Hardware to test on, which this project does not yet have.

## Part 4 notes, carried forward

Found while reading nesrecon, to fix when part 4 opens the convert shader:

- The Vulkan Video path creates its RGBA target as `R8G8B8A8_UNORM`
  (`renderer.rs:616,624`), but `yuv_convert.slang:3` writes it as `rgba16f`,
  and `probe_signal` reads it as `PASS_FORMAT` (`renderer.rs:1493-1499`). The
  DMA-BUF path correctly uses `PASS_FORMAT`.
- One `vk::Queue` per family is shared between the render thread and
  pixelforge's decode thread with no lock (`vulkan/mod.rs:555-578`). nespyro's
  `QueueLock` is where that gets fixed.

## Found while building

Recorded after part 1 was built, for parts 2 to 4 to start from.

### Where the crate differs from this design

- `Context::from_existing` takes the `Roles` the device was created for.
  Vulkan cannot say which features a device was created with, and the decoder
  needs to know whether `shaderFloat16` is on before choosing its FP16 tile.
  Decode-only requirements ask for FP16 only where the device has it.
- `Encoder::encode_planes_after` encodes the caller's own YCbCr planes. It
  exists so the encoder can be compared with the reference on identical input,
  and it lets a caller with its own conversion skip ours.
- Decoder output planes are padded to the codec's alignment. The final inverse
  transform writes whole 32×32 tiles; upstream relies on out-of-bounds stores
  being discarded, which core Vulkan only promises with `robustImageAccess`.
  `PlaneView` gives both the picture size and the image size.
- `Decoder::stats` reports the GPU time of the last finished decode.
- Both halves record their many dispatches once and reuse them. On Mesa's ANV
  recording costs 6 to 14 µs per dispatch; per frame it was 416 µs of a
  decode. Per-frame values reach the shaders through a small parameters buffer.
- Device requirements also check each plane and wavelet format for sampled
  and format-less storage use, which core Vulkan guarantees only for
  `R32_SFLOAT`.

### Measured, Arc A310, Mesa ANV

| | nespyro | reference |
|---|---|---|
| encode 1080p 4:2:0, GPU, excluding colour conversion | 0.94 ms | 1.05 ms |
| encode 4K 4:2:0 | 3.07 ms | 3.22 ms |
| encode 1080p 4:4:4 | 1.36 ms | 1.50 ms |
| decode 1080p 4:2:0, GPU | 0.56 ms | |
| `encode_after` / `decode_after` CPU, 1080p 4:2:0 | 140 / 134 µs | |

Both decoders give bit-identical planes on every stream either encoder wrote.
On identical input the encoders tie on smooth content and nespyro is level or
ahead on edges and noise.

Subgroup sizes follow Granite's rule, which upstream's shaders were tuned
under: varying when a pass's range covers the device's, otherwise the smallest
in range. Taking the largest made rate-control analysis 73% slower on Intel.

### Upstream bugs, worth reporting to PyroWave

1. **Scratch payload undersized.** The quantizer's scratch is sized at aligned
   width × height × 2 bytes. High-entropy 4:4:4 content needs more (3.4 MB
   against 2.1 MB at 1366×768), and the encoder then packs blocks from bytes it
   never wrote: a block whose header claims 115 words holds 95. nespyro sizes
   it by the real bound, 136 bytes per 8×8 block.
2. **Rate-control prefix sum stops short.** `analyze_rate_control_finalize`
   steps while `step < 512 / 2`, so the upper half of its lanes miss part of
   the running total. Frames land under target, not over. Ported unchanged.
3. **Out-of-bounds shared read.** `analyze_rate_control` reads
   `shared_rate_cost[gl_SubgroupInvocationID]` past its 16 entries on wider
   subgroups. The value is unused; nespyro clamps the index.
4. **Stale bytes in the stream.** A block's unused sign bits come from
   uninitialised shared memory and its padding from whatever an earlier frame
   left. Harmless to decoders, but non-deterministic and leaks old memory;
   nespyro writes zeros.

### Toolchain and driver bugs

- **Slang 2026.17** emits `OpGroupNonUniformShuffleXor` without declaring
  `GroupNonUniformShuffle` when nothing else in the shader does. `spirv-val`
  catches it; `shuffle_xor` in `common.slang` works around it. `build.rs`
  requires `spirv-val` for that reason.
- **Mesa ANV** spends 12.6 ms of CPU recording `vkCmdFillBuffer` of an
  8,396,864-byte buffer, and 3 µs for a 16,785,472-byte one. nespyro records
  its fills once, so it no longer matters here, but it is worth a Mesa report.

### For the parts that follow

- Part 2: a frame at 200 Mbit/s and 60 fps is about 416 KB in 1200-byte
  packets, a few hundred per frame. `EncodedFrame::critical_packets` is small,
  typically one to a few packets.
- Part 4: nesrecon's convert shader takes two planes; nespyro gives three, in
  `GENERAL`, padded, with the picture size in `PlaneView`.
