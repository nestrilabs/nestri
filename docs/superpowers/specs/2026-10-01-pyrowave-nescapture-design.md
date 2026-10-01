# PyroWave in nescapture

Status: approved design, 2026-10-01. Part 3 of 4. Parts 1 and 2:
`2026-09-27-nespyro-codec-crate-design.md`, `2026-10-01-pyrowave-transport-design.md`.

## Decisions

- **Vulkan 1.3 instance.** `vkCreateInstance` raises anything below 1.3 to 1.3
  where the loader has it (today: 1.0 → 1.1). Only the client app has to care
  about old Vulkan; nescapture runs on the game's machine, which we control.
- **Shared device only.** nespyro runs on the game's device or not at all. On
  the own-device fallback a PyroWave request is refused and logged; a CPU round
  trip of a frame defeats the codec's reason to exist.
- **Decoupled from Vulkan Video.** The game's device gets pixelforge's
  additions, nespyro's, both, or neither, each checked on its own. A GPU with
  no video encode can still stream PyroWave once a client asks; until then
  nothing is encoded, and the log says why.

## Device (`instance.rs`, `shared.rs`, `device.rs`)

- `prepare` asks pixelforge `encode_device_requirements` and nespyro
  `DeviceRequirements::query(Roles::ENCODE)` independently.
  `Additions { video: Option<pixelforge::DeviceRequirements>, pyro:
  Option<nespyro::DeviceRequirements>, queues }`. The effective version
  (min of instance and physical device) must be 1.3 for `pyro`.
- `Feature` gains nespyro's bits: Storage16Bit, Storage8Bit, ShaderInt8,
  ShaderFloat16, BufferDeviceAddress, SubgroupSizeControl,
  ComputeFullSubgroups, and the 1.0 core ShaderInt16 and
  ShaderStorageImageWriteWithoutFormat. 1.0 bits live in
  `VkPhysicalDeviceFeatures`: patched in place inside a chained
  `VkPhysicalDeviceFeatures2`, else in a copy of `*pEnabledFeatures` the create
  info points at instead, else in a copy of our own. Restore covers all three.
- Extension `VK_KHR_push_descriptor` added with nespyro.
- `plan_queues` plans encode only with pixelforge, compute with either,
  transfer with pixelforge. nespyro uses the compute queue, `QueueLock::none()`:
  one encoder thread submits for both, at most one queue of ours per family,
  internally synchronized where shared with the game.
- `SharedDevice::pyro_context() -> Option<nespyro::Context>`.
  `SharedDevice::video_context()` returns an error when pixelforge's additions
  were not made.

## Encoder thread (`encode.rs`)

- `enum Codec { Hw(HwCodec), PyroWave }` in `EncoderConfig`,
  `EncodeSettingsChange`, `current_codec` (protocol id). `HwCodec` unchanged.
  Every match says what PyroWave does; depth clamping, GOP, intra refresh and
  IDR apply only to `Hw`. IDR on PyroWave is a no-op.
- `enum Backend { Hw(PerFrameEncoder), Pyro(PyroEncoder) }`. `PyroEncoder`
  owns `nespyro::Encoder` and its rebuild key (w, h, depth, chroma, colour,
  packet size). Bitrate-only change → `set_target_bitrate`, no rebuild.
- Input: the slot image in `GENERAL`, `encode_after(view, Source, blit)`.
  `Source` from the same `source_spec`/`stream_spec`; only BT.709 SDR and
  BT.2020 PQ, anything else refused. pixelforge `TimelinePoint` converted at
  the boundary.
- Slot lifetime: a PyroWave frame's slot is held until its future resolves; up
  to two held (nespyro's in-flight limit). Hardware path unchanged.
- `EncodedFrame.future` becomes an enum of the two futures.
- Codec switches use the existing `drop_encoder` + `needs_reconfig_flag`.

## Commands, IPC, stats

- `MSG_ENCODE_SETTINGS` via `decode_encode_settings_ext`. Codec 4 →
  `PyroWave`, with chroma and packet size. Refused (warned) with no nespyro
  context, no or too small packet size, or rate 0.
- `host_caps` includes PyroWave bits only with a nespyro context.
- IPC: PyroWave frames via `chunk_frame`, each message under the existing 250
  ms timeout. A timed-out message drops the rest of the frame and counts it in
  `dropped`; other errors reconnect as today. Width/height from the frame, not
  frozen at pipeline creation (fixes a stale-size bug for every codec).
- `enc_ms` from nespyro `gpu_ns`. Scratch overflow warned once per episode.
- Fix while open: the CPU fallback's hardcoded `Codec::H264` in
  `InputImage::new`.

## Tests

- Unit: planning with one or both sets; 1.0 feature bits in `pEnabledFeatures`,
  in `Features2`, in neither, and restoration; the instance raise decision;
  command decode and refusals; the two-slot hold rule.
- GPU `#[ignore]`: nespyro frames → nescapture's chunking → `FrameAssembler` →
  `pack_datagrams` → `PyroCollector` → `Depacketizer`; readiness equals the
  encoder's own packets, clean and with loss. (Moved from part 2.)
- Guest image: rebuild, run a title, send a PyroWave `MSG_ENCODE_SETTINGS` to
  `/tmp/nescapture-cmd.sock`, and see PyroWave frames leave neshub.
