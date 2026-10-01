# PyroWave decode in nesrecon / nesvideo

Status: design, 2026-10-01. Part 4 of 4; parts 1-3 are
`2026-09-27-nespyro-codec-crate-design.md`,
`2026-10-01-pyrowave-transport-design.md`,
`2026-10-01-pyrowave-nescapture-design.md`. Code lives in nescore
(`crates/nesrecon`, `apps/nesvideo`); nespyro is a git dep on nestri at the
same rev nesprotocol is pinned to.

## Decisions

- **nespyro decodes on nesrecon's device**, from the decode thread, as one
  more backend beside Vulkan Video / VA-API / CPU. Its planes stay on the GPU
  and are converted by the render thread like a Vulkan Video picture.
- **The device is no longer gated on H.264 Vulkan Video decode.**
  `shared_decode_device` exists when either pixelforge or nespyro fits.
- **Planes are always `Depth::Sixteen`.** PyroWave decodes in float and the
  stream carries no depth; R16 costs little and never bands an HDR stream.
- **Converter: a second entry point**, three planes, chroma shift in the
  uniform's spare word. The two-plane path is untouched, so its output and
  tests do not move.
- **Fix while open:** the Vulkan-path RGBA target is `R8G8B8A8_UNORM` while the
  shader writes `rgba16f` and the probe reads `PASS_FORMAT`; it becomes
  `PASS_FORMAT`. That changes the Vulkan Video path's output (it was undefined
  behaviour), so the PSNR baseline is re-taken for that path.
- **Deblock is off for PyroWave**: it has no block grid. `block_grid_for`
  returns none, as for anything without one.
- **Busy is not an error.** nespyro has three output slots and the renderer
  can hold all three (hand-off slot, current picture, retire queue); a frame
  that finds none free is dropped and counted, and the next decodes.

## Device (`vulkan/mod.rs`)

- `nespyro::DeviceRequirements::query(.., Roles::DECODE)` beside pixelforge's,
  independently. Device preference also accepts a nespyro-capable device.
- Features: the 1.0 ones in `PhysicalDeviceFeatures`, 16-bit storage in the
  existing `Vulkan11Features`, subgroup size control and full subgroups in the
  existing `Vulkan13Features`, and a new `Vulkan12Features` for 8-bit
  storage, int8, float16 (when available), buffer device address and timeline
  semaphores — replacing the standalone timeline struct, which may not be
  chained beside it.
- Queue: nespyro gets the compute-only family's queue 0, which nesrecon
  never submits to; pixelforge may use it too, but only from the same decode
  thread, so the two are serialised by that thread. Without a compute-only
  family it gets a second queue in the graphics family if there is one; with
  neither, PyroWave decode is refused and logged rather than racing the
  render thread on its queue. `QueueLock::none()` in every case that runs.
- `SharedVulkanDevice` carries `pyro: Option<(family, index)>`.
- `nesrecon::decodes(PyroWave, _)` answers from a flag set when the device was
  created with nespyro's additions; nesvideo advertises PyroWave only then.

Still open, out of scope: pixelforge's transfer queue can alias the graphics
queue on a device without a transfer or compute family, and pixelforge has no
lock to share. Unchanged by this part.

## Decode thread (`decode/`)

- The channel carries `enum VideoUnit { Coded(Vec<u8>, VideoCodec),
  PyroWave(PyroUnit) }`, `PyroUnit { packets: Vec<Bytes>, critical_complete,
  ts_ms }`. `VideoCodec` gains `PyroWave`; every closed match says what it
  means there.
- `PyroDecoder` (new backend): built lazily for the stream's size and chroma,
  rebuilt on `Push::Reconfigure`. Per unit: push every packet; decode when
  `readiness().is_complete_enough_with(critical_complete)`; otherwise drop
  and count. Output `DecodedFrame::PyroWave(PyroPicture)` into the same sink.
- `decode_ns` is CPU time as for the others; nespyro's GPU time goes to the
  log at trace once a second.

## Render (`vulkan/renderer.rs`, `yuv_convert.*`)

- `import_frame` takes `PyroPicture` into the same slot the Vulkan picture
  uses; retired the same way, after the frame that sampled it.
- The render submit waits on the picture's `ready` point when it has one.
- `yuv_convert_planar` entry: three `Texture2D` loads, chroma at
  `(x >> shift, y >> shift)`, same matrix/range/peak code. R16 full range.
- Matrix and range from the picture's `ColourDescription`, per frame.

## nesvideo

- `PyroCollector` frames go to the decode channel as `VideoUnit::PyroWave`.
  A full channel drops and counts; no IDR, nothing to resync.
- The sequence header (first packet) gives size and colour: `stream_dims`, and
  `bitstream_colour` as a `StreamColour`, so the existing colour logic picks
  the swapchain (HDR10 for PQ) exactly as for the other codecs.
- `client_capabilities` asks `nesrecon::decodes` for PyroWave like the rest.
- The overlay's "not decoded yet" note goes; the PyroWave rate line stays.

## Tests (last step)

- Unit: channel/unit plumbing, colour mapping, `block_grid_for`, the planar
  shader's text checks beside the existing ones.
- Existing nesrecon/nesvideo tests stay green.
- Full stack by eye: PyroWave on screen, switching to and from a hardware
  codec, 4:2:0 and 4:4:4, SDR and HDR.
