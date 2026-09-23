# nescapture

A Vulkan implicit layer that captures frames from inside the workload's own
process, encodes them with **Vulkan Video** on the GPU that drew them, and
sends them to [`neshub`](../neshub) over a Unix socket — no copy out to the
CPU and back.

Being a layer rather than a screen-scraper is the whole point: the frame is
already on the GPU when we get it, and it never leaves.

---

## Where it sits

```
Game process
    │  Vulkan calls
    ▼
┌──────────────────────────────────────────────┐
│  nescapture implicit layer                   │
│                                              │
│  vkCreateShaderModule       → SHA-256 hash   │
│  vkCreateGraphicsPipelines  → track hashes   │
│  vkCmdBindPipeline          → detect HUD     │
│  vkQueuePresentKHR          → capture+encode │
└──────────────────────────────────────────────┘
    │  GPU blit on the game's queue, signals a timeline semaphore
    ▼
ring slot  (an image on the game's own device)
    │  read in place, once the blit's point is reached
    ▼
ColorConverter  (GPU compute shader, the encoder's own queue)
    │  BGRA/RGB10/FP16 → NV12/P010/YUV444
    ▼
Encoder  (Vulkan Video: H.264 / H.265 / AV1)
    │  Annex-B packets
    ▼
Unix datagram → neshub → the client
```

The encoder runs on the game's own `VkDevice`. The layer creates that device
with what the encoder needs: the extensions and feature bits it asks for, and
queues of its own wherever a queue family has one to spare, since a `VkQueue`
may not be submitted to from two threads at once. Where no family has room,
the game's queue is created internally synchronized and shared. Every step of
a frame is ordered on the GPU; nothing waits on the CPU.

Where the conversion is only the YUV matrix and the device has
`VK_VALVE_video_encode_rgb_conversion`, the encoder takes the RGB frame and
converts it itself, and the converter is not built. That path runs at limited
range, since the one driver offering it writes limited range whatever it is
asked; everything else is full range.

When the game's device cannot host the encoder -- an instance the loader
cannot raise to Vulkan 1.1, no queue the encoder could safely use, a driver
refusing the additions, or `NESCAPTURE_SHARED_DEVICE=0` -- the encoder gets a
device of its own, and each frame is read back on the CPU and uploaded there.
That works everywhere and costs a copy each way.

---

## Sockets

| path | direction | carries |
| --- | --- | --- |
| `/tmp/nestri-video.sock` | nescapture → neshub | encoded frames |
| `/tmp/nestri-stats.sock` | nescapture → neshub | capture fps, encode ms, drops |
| `/tmp/nescapture-cmd.sock` | neshub → nescapture | IDR requests, encode settings |

nescapture binds the command socket and connects to the other two. The stats
path is derived from `NESCAPTURE_IPC_PATH`'s directory, so moving the video
socket moves both.

---

## Quick start

```bash
# 1. Build
cargo build --release -p nescapture

# 2. Install the layer manifest
sudo cp apps/nescapture/manifest/VK_LAYER_nescapture.json /usr/share/vulkan/implicit_layer.d/
# Point the manifest's `library_path` at target/release/libnescapture_layer.so

# 3. Run something that draws
export NESCAPTURE_ENABLE=1
export NESCAPTURE_CODEC=h265
export NESCAPTURE_BITRATE=10000
export RUST_LOG=info

./my-vulkan-app
```

The layer is inert unless `NESCAPTURE_ENABLE=1`. That is deliberate — an
implicit layer is loaded into *every* Vulkan process on the system.

---

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `NESCAPTURE_ENABLE` | _(unset)_ | Set to `1` to activate the layer. Nothing happens otherwise |
| `NESCAPTURE_IPC_PATH` | `/tmp/nestri-video.sock` | Where to send encoded frames |
| `NESCAPTURE_CODEC` | best available | `h264`, `h265` or `av1`; probes if unset |
| `NESCAPTURE_FORMAT` | `yuv420` | `yuv420` or `yuv444` |
| `NESCAPTURE_DEPTH` | auto | `8` or `10`; inferred from the swapchain `VkFormat` if unset |
| `NESCAPTURE_RC` | _(inferred)_ | `cqp`, `cbr` or `vbr`. Unset infers `cqp` when `NESCAPTURE_QP` is set, `cbr` otherwise |
| `NESCAPTURE_BITRATE` | `10000` | Target bitrate in kbps, under `cbr` and `vbr` |
| `NESCAPTURE_BITRATE_MAX` | 1.5x the target | VBR ceiling in kbps. Ignored outside `vbr` |
| `NESCAPTURE_QP` | _(unset)_ | Constant QP, under `cqp` |
| `NESCAPTURE_FPS` | `60` | Target frame rate |
| `NESCAPTURE_IDR_INTERVAL` | `4` | Force an IDR every N **seconds** |
| `NESCAPTURE_INTRA_REFRESH` | _(off)_ | Set to `1` to replace periodic key frames with an intra refresh cycle |
| `NESCAPTURE_INTRA_REFRESH_QP_DELTA` | `-4` | QP shift inside the refresh band; negative spends bits on it |
| `NESCAPTURE_INTRA_REFRESH_SHAPE` | auto | `rows`, `columns` or `partitions`; the driver chooses if unset |
| `NESCAPTURE_TUNE` | _(unset)_ | `highquality`, `lowlatency`, `ultralowlatency`, `lossless` |
| `NESCAPTURE_SHARED_DEVICE` | _(on)_ | Set to `0` to leave the game's device as the game asked for it, and encode on a device of the encoder's own with CPU readback |
| `NESCAPTURE_RGB_ENCODE` | _(on)_ | Set to `0` to always convert with the shader, even where the encoder could convert RGB itself |
| `NESCAPTURE_CONFIG` | _(unset)_ | Path to the per-app shader-hash TOML |
| `NESCAPTURE_GAME_NAME` | exe basename | Override app identification for that config |
| `NESCAPTURE_DISCOVER` | _(unset)_ | Set to `1` to log every draw, for finding HUD shaders |
| `RUST_LOG` | `error` | Standard `env_logger` filter, e.g. `nescapture_layer=debug` |

Everything else is decided at runtime: the client asks `neshub` for a codec or
bitrate change and it arrives on the command socket, so the encoder is
reconfigured without a restart.

### Intra refresh

Instead of a key frame every few seconds, each picture codes one slice of the
image as intra, so after a full cycle every part has been refreshed. The same
cost, paid evenly, with no picture much larger than any other — which is what
a link with a latency budget wants, since a key frame is the largest frame
there is.

**The cycle length is not configurable, deliberately.** It is bounded by how
many refresh regions the picture actually has, and that depends on the codec's
block size: at 1080p an H.265 picture is 17 CTB rows tall where an H.264 one is
68 macroblock rows, so the same duration is comfortable for one codec and
impossible for the other. The encoder knows the codec, the resolution and what
the device allows, and derives it from the key frame interval it replaces.

The refresh here spreads cost only; it does not make the cycle a recovery
point. Doing that would restrict prediction on every picture — expensive, and
what turns the refreshed band into a visible discontinuity — to buy a
guarantee this stream gets more cheaply from the client asking for an IDR.

The band is coded intra every cycle, so it carries none of the refinement its
neighbours have accumulated and reads as a strip of lower quality sweeping
across the picture. `NESCAPTURE_INTRA_REFRESH_QP_DELTA` spends bits back into
it, out of the rest of the frame. Measured at 1080p with ColorVideoVDP, `-4`
recovers a fifth of what intra refresh costs and the encoded size does not
grow — but the best value depends on the content, and too large a shift
starves the rest of the frame faster than too small a one helps. Devices that
cannot express a negative delta, or whose refresh regions follow the slice
layout rather than a block sweep, decline it and say so.

`NESCAPTURE_INTRA_REFRESH_SHAPE` stays configurable because the device cannot
answer it: whether a horizontal or vertical sweep looks better depends on how
the content moves. It also changes how many regions there are — a 1080p
picture in 64×64 blocks is 17 rows but 30 columns, so `columns` allows a
longer cycle and thus less intra per picture.

### Rate control

`cbr` holds every frame to the same size, which is what a link with a fixed
budget wants. `vbr` holds the same *average* while letting a frame that needs
it spend up to the ceiling — a scene change is coded rather than smeared, at
the cost of a burst the path has to absorb. `cqp` holds quality constant and
lets the bitrate go wherever the content takes it, which is a recording
setting rather than a streaming one.

The command socket carries a target bitrate but has no way to name a mode
beyond CBR and constant QP. A target arriving while the encode is `vbr` is
therefore applied as a target, leaving the mode and the ceiling alone — so the
ceiling asked for at launch survives a session, and a congestion controller
adjusts underneath it. Retargeting costs no rebuild and no key frame.

---

## Per-app shader-hash config

HUD detection needs to know which pipelines draw the HUD, and that is
per-application. Run once with `NESCAPTURE_DISCOVER=1` to log every shader,
then pick out the HUD pipelines by the `[SUSPECT]` marker — blend on, depth
off, six vertices or fewer.

```toml
# ~/.config/nescapture/apps.toml
[game."MyApp.exe"]
hud_fragment_shaders  = ["0xaabbccddeeff0011"]
hud_vertex_shaders    = ["0x1a2b3c4d5e6f7890"]
skip_fragment_shaders = ["0x1122334455667788"]
```

```bash
export NESCAPTURE_CONFIG=~/.config/nescapture/apps.toml
export NESCAPTURE_GAME_NAME=MyApp.exe
```

---

## Modules

```
src/
├── lib.rs           entry points, dispatch routing
├── dispatch.rs      Vulkan function-pointer types and tables
├── state.rs         global DashMaps, DeviceState, CbState
├── instance.rs      vkCreateInstance / vkDestroyInstance
├── device.rs        vkCreateDevice / vkDestroyDevice
├── shader.rs        SPIR-V hashing
├── pipeline.rs      graphics pipeline tracking
├── framebuffer.rs   image view and framebuffer tracking
├── commands.rs      vkCmdBind*, vkCmdDraw*, vkCmdBeginRenderPass
├── swapchain.rs     vkCreateSwapchainKHR, image enumeration
├── capture.rs       GPU blit into the capture ring, CPU readback fallback
├── present.rs       vkQueuePresentKHR, encode dispatch
├── encode.rs        pixelforge pipeline, codec probing, IPC send
├── shared.rs        creating the game's device for the encoder to share
├── config.rs        per-app TOML shader-hash config
└── discovery.rs     draw-call logging for shader discovery
```

---

## Dependencies

| Crate | Purpose |
| --- | --- |
| `pixelforge` | Vulkan Video hardware encode |
| `ash` | Vulkan bindings |
| `nesprotocol` | The IPC frame format `neshub` reads |
| `sha2`, `bytemuck` | SPIR-V fingerprinting |
| `dashmap`, `once_cell` | Lock-free concurrent state |
| `serde`, `toml` | Per-app shader config |

`ash` and `pixelforge` are pinned to git revisions — both track Vulkan Video
support that has not landed in a release.

---

## Licence

Apache 2.0. See [LICENSE](../../LICENSE).
