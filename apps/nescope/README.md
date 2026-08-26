# nescope

A lightweight headless Wayland compositor designed for game capture scenarios. nescope creates a complete compositor environment for games while delegating frame capture to an external Vulkan interception layer.

## Overview

nescope is built on top of [Smithay](https://smithay.org/), the Rust Wayland compositor framework. Unlike traditional compositors that manage window rendering and buffer scanout, nescope operates in **headless mode**—it provides the Wayland/X11 environment games expect but never allocates GBM buffers or performs rendering.

```
┌─────────────────┐
│   nescope       │  ← Headless Wayland compositor
├─────────────────┤
│ Virtual Output  │  ← 1920x1080 @ 60Hz (configurable)
│ XWayland        │  ← X11 compatibility layer
│ DMA-BUF (v4)    │  ← Required for XWayland DRI3
│ wp_color_mgmt   │  ← HDR signaling
│ gamescope WSI   │  ← Vulkan bypass protocol
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Game          │  ← Render target
└────────┬────────┘
         │ frame capture
         ▼
┌─────────────────┐
│ vkcapture layer │  ← External Vulkan interception
└─────────────────┘
```

## Architecture

### Core Components

| Module             | Purpose                                                                          |
| ------------------ | -------------------------------------------------------------------------------- |
| `main.rs`          | CLI entry point, event loop, process management                                  |
| `state.rs`         | `NescopeState` — central compositor state, Wayland globals                       |
| `handlers.rs`      | Smithay protocol handlers (`CompositorHandler`, `XdgShellHandler`, `XwmHandler`) |
| `input.rs`         | Programmatic input injection via `calloop::channel`                              |
| `hdr.rs`           | HDR/color management protocol handlers                                           |
| `focus.rs`         | Keyboard focus routing for X11 windows                                           |
| `protocols/mod.rs` | Generated gamescope swapchain bindings                                           |

### Design Decisions

1. **Headless Operation**: nescope never allocates GBM buffers. The DMA-BUF global exists solely so XWayland can initialize DRI3/GBM/glamor.

2. **Frame Callbacks**: Driven by an internal calloop timer at the configured FPS, not by a real scanout. This keeps the game's render loop alive.

3. **Input via Channel**: Input events arrive through a `calloop::channel::Sender<InputEvent>` rather than being decoded from a proxy connection. This allows external code (streaming servers, test harnesses) to inject input.

4. **Process Subreaper**: nescope registers as a subreaper (`PR_SET_CHILD_SUBREAPER`) so orphaned descendants (e.g., Steam launcher → game client) are reparented to it, enabling reliable cleanup.

## Building

```sh
cargo build --release
```

## Usage

```text
nescope [OPTIONS] -- <command> [args...]

Options:
  --width  <N>     Output width  [default: 1920]
  --height <N>     Output height [default: 1080]
  --fps    <N>     Virtual refresh rate [default: 60]
  --hdr            Enable HDR protocols
  --socket <NAME>  Wayland socket name [default: nescope-0]
```

### Environment Variables

| Variable         | Effect                                 |
| ---------------- | -------------------------------------- |
| `DISPLAY`        | XWayland display (`:N`)                |
| `NESCOPE_WIDTH`  | Override `--width`                     |
| `NESCOPE_HEIGHT` | Override `--height`                    |
| `NESCOPE_FPS`    | Override `--fps`                       |
| `NESCOPE_HDR`    | Enable HDR                             |
| `NESCOPE_SOCKET` | Override socket name                   |
| `RUST_LOG`       | Tracing filter (e.g., `nescope=debug`) |

### Example

```sh
# Launch a game at 1440p with HDR
nescope --width 2560 --height 1440 --hdr -- %command%

# 1080p with debug logging
RUST_LOG=nescope=debug nescope -- %command%
```

## HDR Support

nescope supports two HDR signaling paths:

1. **wp_color_management_v1** — Standard Wayland staging protocol used by Wine/Proton/SDL2 when requesting HDR via Vulkan color-space extensions (disabled by default).

2. **gamescope_swapchain_factory_v2** — Valve's private protocol used by the gamescope WSI Vulkan layer. This is the primary path for Steam games using `PROTON_ENABLE_NVAPI`.

When `--hdr` is enabled, nescope:

- Advertises both protocol globals
- Sets `ENABLE_GAMESCOPE_WSI=1` and `GAMESCOPE_WAYLAND_DISPLAY=$(socket_path_here)` on the X11 root window
- Tracks per-surface color space for external capture layer retrieval

## Shutdown Behavior

- **First SIGINT/SIGTERM**: Sets an atomic flag; the event loop exits cleanly, killing all child process groups.
- **Second signal**: Falls through to OS default handler (hard kill).

nescope waits 5 seconds after the last mapped window disappears before exiting, allowing save-game/cleanup processes to complete.

## Dependencies

- **smithay** — Wayland compositor framework (`wayland_frontend`, `xwayland`, `backend_drm`, `desktop`, `renderer_pixman`)
- **wayland-client** — Connects to host compositor (if needed)
- **calloop** — Event loop
- **tracing** — Structured logging
- **clap** — CLI parsing
- **x11rb** — X11 atom management

## License

See project repository.

## TODO

- [ ] Handle sending frames thru to the client
- [ ] Handle packetizing and sharding
- [ ] Handle mouse and kb input from the client
