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
    │  GPU blit, same device
    ▼
final_image  (DMA-BUF exportable)
    │  get_dmabuf_fd(final_memory)
    ▼
DmaBufImporter  (pixelforge VkDevice)
    │  import_or_reuse() → vk::Image
    ▼
ColorConverter  (GPU compute shader)
    │  BGRA/RGB10/FP16 → NV12/P010/YUV444
    ▼
Encoder  (Vulkan Video: H.264 / H.265 / AV1)
    │  Annex-B packets
    ▼
Unix datagram → neshub → the client
```

CPU fallback exists only for driver configurations without DMA-BUF external
memory export.

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
| `NESCAPTURE_BITRATE` | `10000` | CBR target in kbps. Ignored when `NESCAPTURE_QP` is set |
| `NESCAPTURE_QP` | _(unset)_ | Constant QP instead of CBR |
| `NESCAPTURE_FPS` | `60` | Target frame rate |
| `NESCAPTURE_IDR_INTERVAL` | `4` | Force an IDR every N **seconds** |
| `NESCAPTURE_TUNE` | _(unset)_ | `highquality`, `lowlatency`, `ultralowlatency`, `lossless` |
| `NESCAPTURE_CONFIG` | _(unset)_ | Path to the per-app shader-hash TOML |
| `NESCAPTURE_GAME_NAME` | exe basename | Override app identification for that config |
| `NESCAPTURE_DISCOVER` | _(unset)_ | Set to `1` to log every draw, for finding HUD shaders |
| `RUST_LOG` | `error` | Standard `env_logger` filter, e.g. `nescapture_layer=debug` |

Everything else is decided at runtime: the client asks `neshub` for a codec or
bitrate change and it arrives on the command socket, so the encoder is
reconfigured without a restart.

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
├── capture.rs       GPU blit to the capture image, DMA-BUF export
├── present.rs       vkQueuePresentKHR, encode dispatch
├── encode.rs        pixelforge pipeline, codec probing, IPC send
├── dmabuf_import.rs cross-device zero-copy import
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
