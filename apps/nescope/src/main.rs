//! nescope — lightweight headless Wayland compositor for game capture.
//!
//! # Overview
//!
//! nescope creates a virtual Wayland output, starts XWayland, and gives games
//! a complete compositor environment.  Frames are captured externally by a
//! Vulkan interception library (`hudless`); nescope itself
//! never allocates a GBM pool or forwards DMA-BUFs.
//!
//! # Usage
//!
//! ```text
//! nescope [OPTIONS] -- <command> [args...]
//!
//! Options:
//!   --width  <N>     Output width  [default: 1920]
//!   --height <N>     Output height [default: 1080]
//!   --fps    <N>     Virtual refresh rate [default: 60]
//!   --hdr            Enable HDR protocols (wp_color_management_v1 + gamescope_swapchain)
//!   --socket <NAME>  Wayland socket name [default: nescope-0]
//! ```
//!
//! # Environment variables
//!
//! | Variable        | Effect                                        |
//! |----------------|-----------------------------------------------|
//! | `WAYLAND_DISPLAY` | Set by nescope before spawning the game      |
//! | `DISPLAY`         | Set to the XWayland display (`:N`)           |
//! | `XCURSOR_THEME`   | XCursor theme name for the software cursor   |
//! | `XCURSOR_SIZE`    | XCursor size in pixels                       |
//! | `RUST_LOG`        | Tracing filter (e.g. `nescope=debug`)        |
//!
//! # Ctrl+C / shutdown
//!
//! The first SIGINT/SIGTERM sets an atomic flag; the event loop detects it on
//! the next idle tick, kills all child process groups, and exits cleanly.
//! A second signal falls through to the OS default handler (hard kill).
//!
//! nescope registers itself as a subreaper (`PR_SET_CHILD_SUBREAPER`) so that
//! orphaned game descendants (grandchildren, great-grandchildren, …) are
//! reparented to it instead of PID 1.  This prevents zombie accumulation and
//! ensures `kill_all_children()` can reach every descendant.

use std::os::unix::process::CommandExt;
use std::sync::Arc;
use std::time::Duration;

use calloop::generic::Generic;
use calloop::signals::{Signal, Signals};
use calloop::timer::Timer;
use calloop::{EventLoop, Interest, Mode, PostAction};
use clap::Parser;
use smithay::reexports::wayland_server::Display;
use smithay::wayland::socket::ListeningSocketSource;

mod focus;
mod gpu_readback;
mod handlers;
mod hdr;
mod input;
mod input_ipc;
mod libinput_backend;
mod protocols;
mod screenshot_ipc;
mod screenshot_wire;
mod state;
mod xwm;

use crate::input::{decode_wire_event, process_input};
use state::{CalloopData, ClientState, NescopeState};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

#[derive(Parser, Debug)]
#[command(
    name = "nescope",
    about = "Lightweight headless Wayland compositor for game capture",
    after_help = "Everything after '--' is the game command, e.g.:\n  nescope --hdr -- %command%"
)]
struct Args {
    /// Output width in pixels.
    #[arg(long, default_value = "1920", env = "NESCOPE_WIDTH")]
    width: u32,

    /// Output height in pixels.
    #[arg(long, default_value = "1080", env = "NESCOPE_HEIGHT")]
    height: u32,

    /// Virtual output refresh rate (fps).
    #[arg(long, default_value = "60", env = "NESCOPE_FPS")]
    fps: u32,

    /// Enable HDR protocols (wp_color_management_v1 + gamescope_swapchain_factory_v2).
    #[arg(long, env = "NESCOPE_HDR")]
    hdr: bool,

    /// Wayland socket name (created in $XDG_RUNTIME_DIR).
    #[arg(long, default_value = "nescope-0", env = "NESCOPE_SOCKET")]
    socket: String,

    /// Path to the hub's input IPC socket (nescope connects as client).
    #[arg(
        long,
        env = "NESCOPE_INPUT_IPC",
        default_value = "/tmp/nestri-input.sock"
    )]
    input_ipc: String,

    /// Path to the hub's screenshot IPC socket (nescope connects as client).
    ///
    /// Optional, and absent means the feature is simply off: it exists for
    /// clients that are not games — a Steam login screen has no Vulkan frames
    /// for `nescapture` to take, so its pixels can only come from here.
    #[arg(long, env = "NESCOPE_SCREENSHOT_IPC")]
    screenshot_ipc: Option<String>,

    /// GPU render device (e.g. /dev/dri/renderD128). Sets VK_DRIVER_FILES
    /// for the game so it uses the same GPU.
    #[arg(long, env = "NESCOPE_RENDER_DEVICE")]
    render_device: Option<String>,

    /// X display number for XWayland, so clients can be pointed at it.
    ///
    /// Fixed rather than whatever XWayland picks: in compositor mode the
    /// processes that join are started by something else entirely, and a
    /// display number nobody can predict would need a discovery handshake to
    /// communicate something that is free to agree on in advance.
    #[arg(long, env = "NESCOPE_X_DISPLAY", default_value_t = 1)]
    x_display: u32,

    /// Game command — everything after '--'.
    ///
    /// **Optional.** With one, nescope launches it and exits when it and its
    /// windows are gone — a wrapper around a single game. Without one, nescope
    /// is a plain compositor: it comes up, publishes its displays and waits,
    /// and whatever wants to draw connects to it.
    ///
    /// The second shape is what a session needs. A Steam client and the game
    /// it authorises have to share a compositor *and* a Wine prefix, and
    /// neither can be the other's parent.
    #[arg(last = true)]
    command: Vec<String>,
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let args = Args::parse();
    tracing::info!(
        "nescope {}×{}@{}fps hdr={} socket={}",
        args.width,
        args.height,
        args.fps,
        args.hdr,
        args.socket,
    );

    // ── Become a process subreaper ────────────────────────────────────────
    // Orphaned grandchild processes (Steam launcher → real game client) are
    // reparented to us instead of PID 1.  This lets us:
    //   • reap all zombie descendants
    //   • detect when the entire game tree has exited
    //   • kill all children reliably on shutdown
    unsafe {
        if libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0 {
            tracing::warn!("prctl(PR_SET_CHILD_SUBREAPER) failed — orphans may become zombies");
        } else {
            tracing::debug!("Registered as child subreaper");
        }
    }

    // ── Event loop ────────────────────────────────────────────────────────
    let mut event_loop: EventLoop<CalloopData> =
        EventLoop::try_new().expect("Failed to create event loop");
    let loop_handle = event_loop.handle();
    let loop_signal = event_loop.get_signal();

    // ── Signal handling ───────────────────────────────────────────────────
    let signals =
        Signals::new(&[Signal::SIGINT, Signal::SIGTERM]).expect("Failed to create signal source");

    loop_handle
        .insert_source(signals, |event, _, data| {
            tracing::info!("Received signal {:?} — shutting down", event.signal());

            // Kill game process group
            if let Some(pgid) = data.game_pgid {
                unsafe {
                    libc::kill(-pgid, libc::SIGKILL);
                }
            }

            // Kill everything else
            kill_all_children_sigkill();

            // Reap
            std::thread::sleep(Duration::from_millis(200));
            reap_zombies(data);

            data.loop_signal.stop();
        })
        .expect("Failed to register signal source");

    // ── Wayland display ───────────────────────────────────────────────────
    let mut display: Display<NescopeState> =
        Display::new().expect("Failed to create Wayland display");
    let display_handle = display.handle();

    // Wake calloop when game clients send requests.
    {
        let fd = display
            .backend()
            .poll_fd()
            .try_clone_to_owned()
            .expect("Failed to clone display fd");
        loop_handle
            .insert_source(
                Generic::new(fd, Interest::READ, Mode::Level),
                |_, _, data| {
                    data.display
                        .dispatch_clients(&mut data.state)
                        .expect("dispatch_clients failed");
                    Ok(PostAction::Continue)
                },
            )
            .expect("Failed to register display fd");
    }

    // ── Wayland socket ────────────────────────────────────────────────────
    let xdg_runtime_dir = std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| "/tmp".into());

    // Remove stale socket + lock files from a previous crash.
    for name in [&args.socket, &format!("{}.lock", args.socket)] {
        let path = std::path::Path::new(&xdg_runtime_dir).join(name);
        if path.exists() {
            tracing::warn!("Removing stale socket file: {}", path.display());
            let _ = std::fs::remove_file(&path);
        }
    }

    let socket_source = ListeningSocketSource::with_name(&args.socket)
        .unwrap_or_else(|e| panic!("Failed to create Wayland socket '{}': {e}", args.socket));
    let socket_name = socket_source.socket_name().to_os_string();

    tracing::info!("Wayland socket: {socket_name:?}");

    {
        let mut dh = display_handle.clone();
        loop_handle
            .insert_source(socket_source, move |stream, _, _| {
                if let Err(e) = dh.insert_client(
                    stream,
                    Arc::new(ClientState {
                        compositor_state: Default::default(),
                    }),
                ) {
                    tracing::error!("Failed to accept Wayland client: {e}");
                }
            })
            .expect("Failed to register socket source");
    }

    // ── Compositor state ──────────────────────────────────────────────────
    let (mut state, _input_tx) = NescopeState::new(
        display_handle.clone(),
        loop_handle.clone(),
        args.width,
        args.height,
        args.fps,
        args.hdr,
        args.render_device.clone(),
    );
    //state.init_xwayland(&loop_handle, Some(args.x_display));

    // Said out loud because in compositor mode nothing else can work them out.
    // A process started by the hub rather than by nescope has no inherited
    // environment to read them from.
    if args.command.is_empty() {
        tracing::info!(
            wayland_display = %socket_name.to_string_lossy(),
            display = format!(":{}", args.x_display),
            "compositor mode — point clients at these and they will connect"
        );
    }

    // The GPU to import dmabufs on for screenshots. Same device the game is
    // pointed at, because a buffer the game produced can only be imported on
    // the device that made it.
    gpu_readback::set_render_device(args.render_device.clone());

    // ── Screenshot IPC source ────────────────────────────────────────────
    // Same dial-out shape as the input socket below, so the hub is the
    // listener and there is no race against a socket that does not exist yet.
    // Absent means the feature is off, which is the normal case for a game.
    if let Some(path) = args.screenshot_ipc.clone() {
        match screenshot_ipc::ScreenshotIpcSource::connect(&path) {
            Ok(source) => match source.try_clone_writer() {
                Ok(mut writer) => {
                    tracing::info!("Connected to screenshot IPC socket: {path}");
                    loop_handle
                        .insert_source(source, move |request, _, data| {
                            if request != screenshot_ipc::REQUEST_CAPTURE {
                                tracing::warn!("unknown screenshot request {request:#x}");
                                return;
                            }
                            let (status, capture) =
                                screenshot_ipc::capture_frontmost(&data.state.space);
                            if status != screenshot_wire::Status::Ok {
                                // Worth saying: `Unreadable` means the client is
                                // rendering on the GPU and this path can never
                                // see it -- a configuration problem, not a
                                // transient one.
                                tracing::debug!("screenshot answered with {status:?}");
                            }
                            if let Err(e) = screenshot_ipc::write_reply_to(
                                &mut writer,
                                status,
                                capture.as_ref(),
                            ) {
                                tracing::warn!("failed to answer a screenshot request: {e}");
                            }
                        })
                        .expect("Failed to register screenshot IPC source");
                }
                Err(e) => tracing::warn!("Failed to clone screenshot IPC stream: {e}"),
            },
            Err(e) => tracing::warn!("Failed to connect to screenshot IPC socket {path}: {e}"),
        }
    }

    // ── Input IPC source ─────────────────────────────────────────────────
    // Connect to the neshub input socket and feed events into the
    // compositor seat. Reconnection is handled in the idle callback.
    let ipc_path = args.input_ipc.clone();
    match input_ipc::InputIpcSource::connect(&ipc_path) {
        Ok(source) => {
            tracing::info!("Connected to input IPC socket: {ipc_path}");
            match source.try_clone() {
                Ok(write_stream) => {
                    state.ipc_write = Some(write_stream);
                    state.cursor_image_sent = false; // re-send on reconnect
                }
                Err(e) => {
                    tracing::warn!("Failed to clone IPC write stream: {e}");
                }
            }
            loop_handle
                .insert_source(source, move |payload, _, data| {
                    if let Some(event) = decode_wire_event(&payload) {
                        process_input(event, &mut data.state);
                    }
                })
                .expect("Failed to register input IPC source");
        }
        Err(e) => {
            tracing::warn!("Failed to connect to input IPC socket {ipc_path}: {e}");
        }
    }

    // ── Frame-callback timer ──────────────────────────────────────────────
    // Send wl_surface.frame done events at the target fps.  This is what
    // drives the game's render loop in the absence of a real scanout.
    let frame_interval = Duration::from_micros(1_000_000 / args.fps.max(1) as u64);
    loop_handle
        .insert_source(Timer::from_duration(frame_interval), move |_, _, data| {
            if let Some(ref mut li) = data.libinput {
                libinput_backend::dispatch_libinput(li, &mut data.state);
            }
            data.state.on_frame_tick();
            calloop::timer::TimeoutAction::ToDuration(frame_interval)
        })
        .expect("Failed to register frame timer");

    // ── CalloopData ───────────────────────────────────────────────────────
    let socket_name_for_cleanup = args.socket.clone();
    let command = args.command.clone();
    let gamescope_wayland_socket = args.socket.clone();

    // ── libinput backend ─────────────────────────────────────────────────
    let libinput_ctx =
        libinput_backend::create_libinput().expect("Failed to create libinput context");

    let mut data = CalloopData {
        state,
        display,
        loop_signal,
        libinput: Some(libinput_ctx),
        game_process: None,
        primary_pid: None,
        game_pgid: None,
    };

    tracing::info!("Entering event loop");

    // Run with a 1-second timeout so the idle closure fires even when no
    // Wayland events arrive (needed for zombie reaping and auto-exit checks).
    event_loop
        .run(Some(Duration::from_secs(1)), &mut data, move |data| {
            // ── Reap zombie children ──────────────────────────────────
            // As subreaper we own all orphaned descendants.  Reap them
            // here on every tick so they don't accumulate.
            reap_zombies(data);

            // ── Launch game once XWayland is ready ────────────────────
            if !command.is_empty()
                && data.game_process.is_none()
                && data.primary_pid.is_none()
                && !data.state.game_launched
            {
                //if let Some(xdisplay) = data.state.xdisplay {
                data.state.game_launched = true;
                tracing::info!("Launching {:?}", command[0]);

                let mut cmd = std::process::Command::new(&command[0]);

                cmd.args(&command[1..])
                    //.env("DISPLAY", format!(":{xdisplay}"))
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::inherit())
                    .stderr(std::process::Stdio::inherit())
                    // Put the game in its own process group so we can
                    // kill the whole tree at once with kill(-pgid, …).
                    .process_group(0)
                    // Provide also WAYLAND_DISPLAY, so if the game or application
                    // is Wayland-native and doesn't support older X11 it'll still run.
                    .env("WAYLAND_DISPLAY", &gamescope_wayland_socket);

                if args.hdr {
                    tracing::debug!(
                        gamescope_wayland_socket,
                        "Setting GAMESCOPE_WAYLAND_DISPLAY for application"
                    );
                    cmd.env("GAMESCOPE_WAYLAND_DISPLAY", &gamescope_wayland_socket);
                    cmd.env("ENABLE_GAMESCOPE_WSI", "1");
                    // DXVK's dxgi.dll gates HDR color space exposure on this env var.
                    // Without it, both DX11 (DXVK) and DX12 (vkd3d-proton via DXVK dxgi)
                    // games will not see HDR as available.
                    cmd.env("DXVK_HDR", "1");
                }

                // Detect GPU vendor from render device and set VK_DRIVER_FILES
                // so the game uses the same GPU as nescope.
                if let Some(ref rd) = args.render_device {
                    if let Some(icd_path) = detect_gpu_icd(rd) {
                        cmd.env("VK_ICD_FILENAMES", &icd_path);
                        cmd.env("VK_DRIVER_FILES", &icd_path); // Mesa fallback
                        tracing::info!("GPU ICD → {icd_path}");
                    }
                }

                match cmd.spawn() {
                    Ok(child) => {
                        let pid = child.id();
                        tracing::info!("Game process spawned (pid {pid})");
                        data.primary_pid = Some(pid as i32);
                        data.game_pgid = Some(pid as i32); // PGID == PID due to .process_group(0)
                        data.game_process = Some(child);
                    }
                    Err(e) => {
                        tracing::error!("Failed to launch {:?}: {e}", command[0]);
                        data.loop_signal.stop();
                        return;
                    }
                }
                //}
            }

            // ── Poll primary process ──────────────────────────────────
            // The launcher (e.g. Steam's shell wrapper) may exit quickly
            // while the real game client stays alive as a reparented
            // child.  We keep the loop running until all mapped windows
            // are gone.
            if let Some(ref mut child) = data.game_process {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        tracing::info!("Primary game process exited: {status}");
                        data.game_process = None;
                    }
                    Ok(None) => {}
                    Err(e) if e.raw_os_error() == Some(libc::ECHILD) => {
                        tracing::info!("Primary process already reaped");
                        data.game_process = None;
                    }
                    Err(e) => {
                        tracing::warn!("try_wait error: {e}");
                        data.game_process = None;
                    }
                }
            }

            // ── Auto-exit after all windows are gone ──────────────────
            // Wait 5 s after the last mapped window disappears to give
            // any lingering save-game / cleanup processes time to finish.
            if data.state.game_launched && data.game_process.is_none() {
                let has_windows = data.state.space.elements().next().is_some();
                if !has_windows {
                    let since = data
                        .state
                        .no_clients_since
                        .get_or_insert_with(std::time::Instant::now);
                    if since.elapsed() > Duration::from_secs(5) {
                        tracing::info!("No mapped windows for 5 s — exiting.");
                        kill_all_children();
                        data.loop_signal.stop();
                        return;
                    }
                } else {
                    data.state.no_clients_since = None;
                }
            }

            // ── Flush Wayland clients ─────────────────────────────────
            if let Err(e) = data.display.flush_clients() {
                tracing::warn!("Error flushing Wayland clients: {e}");
            }
        })
        .expect("Event loop error");

    // ── Final cleanup ─────────────────────────────────────────────────────
    // Kill the game process group directly — SIGKILL, not SIGTERM.
    // This runs regardless of whether the shutdown handler fired.
    if let Some(pgid) = data.game_pgid {
        tracing::debug!("Final cleanup: SIGKILL to game pgid {pgid}");
        unsafe {
            libc::kill(-pgid, libc::SIGKILL);
        }
    }
    kill_all_children_sigkill();

    // Give kills time to be delivered before we remove sockets
    std::thread::sleep(Duration::from_millis(200));
    reap_zombies(&mut data);

    // Remove socket files so the next launch doesn't hit stale-lock errors.
    for name in [
        &socket_name_for_cleanup,
        &format!("{}.lock", socket_name_for_cleanup),
    ] {
        let path = std::path::Path::new(&xdg_runtime_dir).join(name);
        if path.exists() {
            let _ = std::fs::remove_file(&path);
            tracing::debug!("Cleaned up {}", path.display());
        }
    }

    tracing::info!("nescope exiting cleanly.");
}

// ---------------------------------------------------------------------------
// GPU ICD detection
// ---------------------------------------------------------------------------

/// Detect the GPU vendor from a render device path and return the
/// appropriate Vulkan ICD JSON path for VK_ICD_FILENAMES.
fn detect_gpu_icd(render_device: &str) -> Option<String> {
    // Extract the device number (e.g. "renderD128" → "128")
    let dev_name = std::path::Path::new(render_device)
        .file_name()
        .and_then(|n| n.to_str())?;
    let card_num = dev_name.strip_prefix("renderD")?;

    let vendor_path = format!("/sys/class/drm/renderD{card_num}/device/vendor");
    let vendor_str = std::fs::read_to_string(&vendor_path).ok()?;
    let vendor = u32::from_str_radix(vendor_str.trim().trim_start_matches("0x"), 16).ok()?;

    let glob_pattern = match vendor {
        0x1002 | 0x1022 => "radeon_icd*.json",
        0x10de => "nvidia_icd*.json",
        0x8086 => "intel_icd*.json",
        _ => return None,
    };

    let icd_dirs = &["/usr/share/vulkan/icd.d", "/etc/vulkan/icd.d"];
    for dir in icd_dirs {
        let pat = format!("{dir}/{glob_pattern}");
        if let Ok(entries) = glob::glob(&pat) {
            let mut paths: Vec<_> = entries.filter_map(|e| e.ok()).collect();
            // Prefer 64-bit (x86_64) over 32-bit (i686)
            paths.sort_by(|a, b| {
                let a32 = a.to_string_lossy().contains("i686");
                let b32 = b.to_string_lossy().contains("i686");
                a32.cmp(&b32)
            });
            if let Some(path) = paths.first() {
                return Some(path.to_string_lossy().to_string());
            }
        }
    }
    None
}

/// Reap all zombie children without blocking.
///
/// Called every event loop tick since we are a subreaper.
fn reap_zombies(data: &mut CalloopData) {
    loop {
        let mut status: i32 = 0;
        let pid = unsafe { libc::waitpid(-1, &mut status, libc::WNOHANG) };
        match pid {
            0 => break,  // no more zombies right now
            -1 => break, // ECHILD — no children left
            pid => {
                if Some(pid) == data.primary_pid {
                    tracing::info!("Primary process reaped (pid {pid})");
                    data.game_process = None;
                } else {
                    tracing::debug!("Reaped orphaned child (pid {pid})");
                }
            }
        }
    }
}

/// Send SIGTERM to all direct children and their process groups.
///
/// Because we are a subreaper, any descendant that re-parented itself (e.g.
/// via double-fork) also ends up under us.  We scan `/proc` for direct
/// children and kill their process groups, which catches the full game tree.
fn kill_all_children() {
    let our_pid = unsafe { libc::getpid() };

    let proc = match std::fs::read_dir("/proc") {
        Ok(d) => d,
        Err(_) => return,
    };

    for entry in proc.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if !name_str
            .chars()
            .next()
            .map(|c| c.is_ascii_digit())
            .unwrap_or(false)
        {
            continue;
        }

        let stat_path = entry.path().join("stat");
        let Ok(contents) = std::fs::read_to_string(&stat_path) else {
            continue;
        };

        // The `stat` format is:  pid (comm) state ppid ...
        // The comm field may contain spaces, so we search backwards from the
        // closing ')' to find the field boundary reliably.
        let Some(after_comm) = contents.rfind(')') else {
            continue;
        };
        let fields: Vec<&str> = contents[after_comm + 1..].split_whitespace().collect();
        let Some(ppid_str) = fields.get(1) else {
            continue;
        };
        let Ok(ppid) = ppid_str.parse::<i32>() else {
            continue;
        };

        if ppid == our_pid {
            let Ok(child_pid) = name_str.parse::<i32>() else {
                continue;
            };
            tracing::debug!("Killing child pid {child_pid} and its process group");
            unsafe {
                libc::kill(-child_pid, libc::SIGTERM); // kill the process group
                libc::kill(child_pid, libc::SIGTERM); // kill the process itself
            }
        }
    }
}

/// Like kill_all_children() but sends SIGKILL instead of SIGTERM.
fn kill_all_children_sigkill() {
    let our_pid = unsafe { libc::getpid() };
    let proc = match std::fs::read_dir("/proc") {
        Ok(d) => d,
        Err(_) => return,
    };
    for entry in proc.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if !name_str
            .chars()
            .next()
            .map(|c| c.is_ascii_digit())
            .unwrap_or(false)
        {
            continue;
        }
        let stat_path = entry.path().join("stat");
        let Ok(contents) = std::fs::read_to_string(&stat_path) else {
            continue;
        };
        let Some(after_comm) = contents.rfind(')') else {
            continue;
        };
        let fields: Vec<&str> = contents[after_comm + 1..].split_whitespace().collect();
        let Some(ppid_str) = fields.get(1) else {
            continue;
        };
        let Ok(ppid) = ppid_str.parse::<i32>() else {
            continue;
        };
        if ppid == our_pid {
            let Ok(child_pid) = name_str.parse::<i32>() else {
                continue;
            };
            tracing::debug!("SIGKILL to child pid {child_pid}");
            unsafe {
                libc::kill(-child_pid, libc::SIGKILL);
                libc::kill(child_pid, libc::SIGKILL);
            }
        }
    }
}
