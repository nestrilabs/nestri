# nescapture

A Vulkan implicit layer that captures frames from a running game, encodes them
with **Vulkan Video** hardware acceleration (H.264 / H.265 / AV1), packetizes with
Reed-Solomon FEC, and streams over RTP/UDP to a Moonlight-compatible client —
all with **zero CPU copies** — fully GPU from game rendering to RTP output.

---

## Architecture

```
Game process
    │  Vulkan calls
    ▼
┌───────────────────────────────────────────────┐
│  nescapture Vulkan implicit layer                │
│                                               │
│  vkCreateShaderModule  → SHA-256 hash         │
│  vkCreateGraphicsPipelines → track hashes    │
│  vkCmdBindPipeline     → detect HUD shaders  │
│  vkCmdEndRenderPass/Rendering → inject copy  │
│  vkQueuePresentKHR     → capture + encode    │
└───────────────────────────────────────────────┘
    │  GPU blit (same device)
    ▼
final_image  (DMA-BUF exportable)
    │  get_dmabuf_fd(final_memory)
    ▼
DmaBufImporter (pixelforge VkDevice)
    │  import_or_reuse() → vk::Image
    ▼
ColorConverter  (GPU compute shader)
    │  BGRA/RGB10/FP16 → NV12/P010/YUV444
    ▼
Encoder  (Vulkan Video, hardware H.264/H.265)
    │  encode()
    ▼
EncodedPacket (Annex-B)
    │
    ▼
Packetizer  (Moonlight wire format, Reed-Solomon FEC)
    │  UDP datagrams
    ▼
Moonlight client  (or any RTP/UDP receiver)

CPU fallback: only when DMA-BUF export unavailable (rare driver config)
```

---

## Quick start

```bash
# 1. Build
cargo build --release

# 2. Install the layer manifest
sudo cp manifest/VK_LAYER_nescapture.json /usr/share/vulkan/implicit_layer.d/
# Edit the manifest's `library_path` to point at target/release/libnescapture.so

# 3. Configure and launch a game
export NESCAPTURE_ENABLE=1
export NESCAPTURE_RTP_HOST=192.168.1.50   # Moonlight / receiver IP
export NESCAPTURE_RTP_PORT=47998          # default
export NESCAPTURE_CODEC=h265              # h264 | h265 | av1 (auto-probes if unset)
export NESCAPTURE_BITRATE=10000           # kbps (CBR; ignored if NESCAPTURE_QP is set)
export NESCAPTURE_FPS=60
export RUST_LOG=info                   # or NESCAPTURE_LOG=debug

wine MyGame.exe          # or native Vulkan game
```

---

## Environment variables

| Variable                  | Default        | Description                                            |
| ------------------------- | -------------- | ------------------------------------------------------ |
| `NESCAPTURE_ENABLE`          | _(unset)_      | Set to `1` to activate the layer                       |
| `NESCAPTURE_RTP_HOST`        | _(required)_   | Destination IP / hostname for RTP stream               |
| `NESCAPTURE_RTP_PORT`        | `47998`        | Destination UDP port                                   |
| `NESCAPTURE_CODEC`           | auto           | `h264`, `h265` or `av1` — falls back to h264 if unsupported   |
| `NESCAPTURE_BITRATE`         | `10000`        | CBR target bitrate in kbps                             |
| `NESCAPTURE_QP`              | _(unset)_      | If set, use CQP with this quality level instead of CBR |
| `NESCAPTURE_FPS`             | `60`           | Target frame rate                                      |
| `NESCAPTURE_IDR_INTERVAL`    | `120`          | Force an IDR keyframe every N frames                   |
| `NESCAPTURE_FEC_PCT`         | `20`           | Reed-Solomon FEC percentage                            |
| `NESCAPTURE_MIN_FEC`         | `2`            | Minimum FEC packets per block                          |
| `NESCAPTURE_PACKET_SIZE`     | `1392`         | Max UDP payload size (bytes)                           |
| `NESCAPTURE_CTRL_PORT`       | `47999`        | UDP port for the control stream                        |
| `NESCAPTURE_CAPTURE_HUDLESS` | _(unset)_      | Set to `1` to also capture HUDless frames              |
| `NESCAPTURE_CONFIG`          | _(unset)_      | Path to per-game shader-hash TOML config               |
| `NESCAPTURE_GAME_NAME`       | (exe basename) | Override game identification                           |
| `NESCAPTURE_DISCOVER`        | _(unset)_      | Set to `1` to enable discovery mode (logs all draws)   |
| `NESCAPTURE_LOG`             | `info`         | Log level (`error`, `warn`, `info`, `debug`, `trace`)  |
| `NESCAPTURE_RTP_FORMAT`      | `moonlight`    | `standard` for RFC 6184/7798 RTP (GStreamer/FFmpeg compatible), `moonlight` for Moonlight wire format with FEC |

---

## Control stream

Send single-byte UDP datagrams to `NESCAPTURE_CTRL_PORT` (default 47999):

| Byte   | Command              |
| ------ | -------------------- |
| `0x01` | Start streaming      |
| `0x02` | Stop streaming       |
| `0x03` | Request IDR keyframe |

Example with netcat:

```bash
# Request IDR
printf '\x03' | nc -u -q1 localhost 47999
```

The control handle wiring in `present.rs` is currently a commented-out stub.
See `control.rs` for the full wiring instructions.

---

## Per-game shader-hash config

HUD shader detection requires a per-game config. Run the game once with
`NESCAPTURE_DISCOVER=1` to log all shaders, then identify HUD pipelines by the
`[SUSPECT]` marker (blend=true, depth=false, ≤6 vertices).

```toml
# ~/.config/nescapture/games.toml
[game."GameName.exe"]
hud_fragment_shaders  = ["0xaabbccddeeff0011"]
hud_vertex_shaders    = ["0x1a2b3c4d5e6f7890"]
skip_fragment_shaders = ["0x1122334455667788"]
```

```bash
export NESCAPTURE_CONFIG=~/.config/nescapture/games.toml
export NESCAPTURE_GAME_NAME=GameName.exe
```

---

## Dependencies

| Crate                  | Purpose                                      |
| ---------------------- | -------------------------------------------- |
| `pixelforge`           | Vulkan Video hardware encode (H.264 / H.265) |
| `ash`                  | Vulkan bindings                              |
| `reed-solomon-erasure` | FEC for RTP packetizer                       |
| `sha2` + `bytemuck`    | SPIR-V shader fingerprinting                 |
| `dashmap`              | Lock-free concurrent state maps              |
| `serde` + `toml`       | Per-game shader config                       |

---

## Zero-copy GPU pipeline

The full GPU path is implemented — no CPU color conversion:

1. `final_image` allocated with `DMA_BUF_EXT` external memory (`capture.rs`).
2. `get_dmabuf_fd()` exports the DMA-BUF fd (`capture.rs`).
3. `DmaBufImporter::import_or_reuse()` imports the fd as a `vk::Image` (`dmabuf_import.rs`).
4. `ColorConverter::convert()` runs a GPU compute shader:
   BGRA/RGBA/RGB10/FP16 → NV12/P010/YUV444 (`encode.rs`).
5. `Encoder::encode()` encodes from the converter's output directly.
6. RTP packetizer + UDP send.

CPU fallback exists only for rare driver configurations that don't support
DMA-BUF external memory export.

---

## File structure

```
nescapture/
├── Cargo.toml
├── README.md
├── ARCHITECTURE.md
├── manifest/
│   └── VK_LAYER_nescapture.json
└── src/
    ├── lib.rs           — entry points, dispatch routing
    ├── dispatch.rs      — Vulkan function-pointer types + tables
    ├── state.rs         — global DashMaps, DeviceState, CbState
    ├── instance.rs      — vkCreateInstance / vkDestroyInstance
    ├── device.rs        — vkCreateDevice / vkDestroyDevice
    ├── shader.rs        — SPIR-V hashing
    ├── pipeline.rs      — graphics pipeline tracking
    ├── framebuffer.rs   — image view / framebuffer tracking
    ├── commands.rs      — vkCmdBind*, vkCmdDraw*, vkCmdBeginRenderPass
    ├── swapchain.rs     — vkCreateSwapchainKHR, image enumeration
    ├── capture.rs       — GPU blit to capture image, DMA-BUF export
    ├── present.rs       — vkQueuePresentKHR, encode dispatch
    ├── encode.rs        — pixelforge pipeline, codec probing, RTP send
    ├── dmabuf_import.rs — DmaBufImporter (cross-device zero-copy import)
    ├── packetizer.rs    — Moonlight RTP packetizer (Reed-Solomon FEC)
    ├── shard_batch.rs   — zero-alloc shard buffer
    ├── control.rs       — UDP control stream (IDR / start / stop)
    ├── config.rs        — per-game TOML shader-hash config
    └── discovery.rs     — draw-call logging for shader discovery
```

---

## License

TBD
