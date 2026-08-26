//! Central compositor state for nescope.
//!
//! # Design
//!
//! nescope is a **headless Wayland compositor**.  It creates a virtual output,
//! runs XWayland, and gives games a fully-functional Wayland environment.
//! Frame capture is handled by an external Vulkan interception library (similar
//! to `OBS_vkcapture`) — nescope never touches GBM, DRM, or DMA-BUF pools.
//!
//! Key differences from nestriscope (the previous proxy version):
//!
//! - No `ProxyClient` / host Wayland connection.
//! - No DMA-BUF forwarding or GBM buffer pool.
//! - Frame callbacks are driven by an internal calloop timer, not a host
//!   frame-done event.
//! - Input comes via a [`calloop::channel::Channel`] rather than being decoded
//!   from a proxy Wayland connection.

#![allow(unused)]
use std::collections::HashSet;
use std::time::Duration;

use calloop::channel::Sender;
use smithay::desktop::utils::{
    OutputPresentationFeedback, send_frames_surface_tree,
    surface_presentation_feedback_flags_from_states, surface_primary_scanout_output,
};
use smithay::desktop::{Space, Window};
use smithay::input::pointer::CursorImageStatus;
use smithay::input::{Seat, SeatState};
use smithay::output::Output;
use smithay::reexports::calloop::{LoopHandle, LoopSignal};
use smithay::reexports::wayland_server::backend::ClientData;
use smithay::reexports::wayland_server::protocol::wl_surface::WlSurface;
use smithay::reexports::wayland_server::{Display, DisplayHandle};
use smithay::utils::{Clock, Monotonic, Point, Rectangle};
use smithay::wayland::compositor::{CompositorClientState, CompositorState};
use smithay::wayland::dmabuf::{DmabufGlobal, DmabufState};
use smithay::wayland::output::OutputManagerState;
use smithay::wayland::pointer_constraints::PointerConstraintsState;
use smithay::wayland::presentation::PresentationState;
use smithay::wayland::presentation::Refresh;
use smithay::wayland::relative_pointer::RelativePointerManagerState;
use smithay::wayland::seat::WaylandFocus;
use smithay::wayland::selection::data_device::DataDeviceState;
use smithay::wayland::shell::xdg::XdgShellState;
use smithay::wayland::shm::ShmState;
use smithay::wayland::viewporter::ViewporterState;
use smithay::wayland::xwayland_shell::XWaylandShellState;
use smithay::xwayland::{X11Wm, XWayland, XWaylandEvent};
use wayland_protocols::wp::presentation_time::server::wp_presentation_feedback;

use crate::focus::KeyboardFocusTarget;
use crate::hdr::HdrState;
use crate::input::InputEvent;

// ---------------------------------------------------------------------------
// CalloopData — threaded through the event loop
// ---------------------------------------------------------------------------

pub struct CalloopData {
    pub state: NescopeState,
    pub display: Display<NescopeState>,
    pub loop_signal: LoopSignal,
    pub libinput: Option<smithay::reexports::input::Libinput>,
    /// The spawned game process handle (the launcher — may exit before the
    /// real game client if Steam is the launcher).
    pub game_process: Option<std::process::Child>,
    /// PID of the primary child, retained after `game_process` is consumed
    /// so we can identify when the subreaper reaps it.
    pub primary_pid: Option<i32>,
    /// Process group ID of the game (== primary_pid due to .process_group(0)).
    /// Retained separately because game_process can be consumed by reap_zombies.
    pub game_pgid: Option<i32>,
}

// ---------------------------------------------------------------------------
// Per-client data
// ---------------------------------------------------------------------------

pub struct ClientState {
    pub compositor_state: CompositorClientState,
}

impl ClientData for ClientState {
    fn initialized(&self, _: smithay::reexports::wayland_server::backend::ClientId) {}
    fn disconnected(
        &self,
        _: smithay::reexports::wayland_server::backend::ClientId,
        _: smithay::reexports::wayland_server::backend::DisconnectReason,
    ) {
    }
}

// ---------------------------------------------------------------------------
// X11 atoms + connection
// ---------------------------------------------------------------------------

/// Gamescope-compatible X11 atoms used for focus and HDR signalling.
pub struct CachedAtoms {
    pub net_active_window: u32,
    pub gamescope_focused_app: u32,
    pub gamescope_focusable_apps: u32,
    pub gamescope_focusable_windows: u32,
    pub gamescope_hdr_output_feedback: u32,
    pub gamescope_xwayland_server_id: u32,
    pub xa_window: u32,
    pub xa_cardinal: u32,
}

/// Secondary X11 connection dedicated to atom management and explicit
/// `SetInputFocus` calls (separate from the XWM connection).
pub struct X11InputConnection {
    pub conn: smithay::reexports::x11rb::rust_connection::RustConnection,
    pub root: u32,
    pub atoms: CachedAtoms,
}

// ---------------------------------------------------------------------------
// NescopeState — central compositor state
// ---------------------------------------------------------------------------

pub struct NescopeState {
    // ── Wayland server ────────────────────────────────────────────────────
    pub display_handle: DisplayHandle,
    pub compositor_state: CompositorState,
    pub xdg_shell_state: XdgShellState,
    pub shm_state: ShmState,
    /// DMA-BUF global — needed so XWayland can initialize DRI3 / GBM / glamor.
    /// nescope never renders into these buffers itself.
    pub dmabuf_state: DmabufState,
    pub dmabuf_global: DmabufGlobal,
    pub seat_state: SeatState<Self>,
    pub data_device_state: DataDeviceState,
    pub output_manager_state: OutputManagerState,
    pub xwayland_shell_state: XWaylandShellState,
    pub viewporter_state: ViewporterState,
    pub seat: Seat<Self>,
    pub space: Space<Window>,
    pub output: Output,
    pub clock: Clock<Monotonic>,
    pub presentation_state: PresentationState,
    pub held_buffer: Option<smithay::reexports::wayland_server::protocol::wl_buffer::WlBuffer>,

    // ── HDR / color management ────────────────────────────────────────────
    pub hdr: HdrState,

    // ── XWayland ──────────────────────────────────────────────────────────
    pub xwm: Option<X11Wm>,
    /// X display number (set when XWayland becomes ready).
    pub xdisplay: Option<u32>,
    /// Secondary X11 connection for atom management.
    pub x11_input_conn: Option<X11InputConnection>,
    /// Window ID of the currently focused X11 window.
    pub focused_x11_window: Option<u32>,
    /// Steam app ID of the focused game (0 = Steam itself).
    pub focused_app_id: u32,
    /// True when X11 focus needs to be re-synced on the next input event.
    pub x11_focus_needs_reset: bool,
    /// Gamescope WSI override surface (direct Vulkan → Wayland bypass).
    pub override_surface: Option<WlSurface>,
    /// Surfaces that have announced themselves as Vulkan via gamescope protocol.
    pub vulkan_surfaces: HashSet<WlSurface>,

    // ── Input ─────────────────────────────────────────────────────────────
    /// Sender half of the input channel — clone and hand to callers.
    pub input_tx: Sender<InputEvent>,
    /// Current cursor position in logical output coordinates.
    pub cursor_position: Point<f64, smithay::utils::Logical>,
    /// Cursor surface set by the client via wl_pointer.set_cursor.
    pub cursor_status: CursorImageStatus,
    /// Captured custom cursor image data (SHM pixel buffer), if available.
    pub cursor_image_data: Option<nesprotocol::input::CursorImageData>,
    /// Whether the cursor image has been sent over IPC since capture.
    pub cursor_image_sent: bool,
    /// Write half of the input IPC socket (for sending cursor updates back).
    pub ipc_write: Option<std::os::unix::net::UnixStream>,
    /// Whether the cursor has been explicitly positioned at least once.
    pub cursor_initialized: bool,
    /// Game FPS tracking: frame count since last stats send.
    game_frame_count: u64,
    /// Last time stats were sent.
    last_stats_time: std::time::Instant,
    /// Last cursor position sent over IPC (for change detection).
    last_sent_cursor_pos: Point<f64, smithay::utils::Logical>,
    /// Last cursor status sent over IPC.
    last_sent_cursor_status: u8,
    /// Timestamp of the last non-keyboard pointer event (for inactivity hiding).
    pub last_pointer_activity: std::time::Instant,

    // ── Dimensions + frame rate ───────────────────────────────────────────
    pub width: u32,
    pub height: u32,
    pub fps: u32,

    // ── Lifecycle ─────────────────────────────────────────────────────────
    pub loop_handle: LoopHandle<'static, CalloopData>,
    /// True after the game command has been spawned.
    pub game_launched: bool,
    /// Time since all mapped windows disappeared (for auto-exit).
    pub no_clients_since: Option<std::time::Instant>,
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

impl NescopeState {
    /// Create the compositor state and register all Wayland globals.
    ///
    /// Returns `(state, input_tx)` where `input_tx` is the sender that callers
    /// use to inject [`InputEvent`]s from any thread.
    pub fn new(
        display_handle: DisplayHandle,
        loop_handle: LoopHandle<'static, CalloopData>,
        width: u32,
        height: u32,
        fps: u32,
        hdr: bool,
        render_device: Option<String>,
    ) -> (Self, Sender<InputEvent>) {
        let compositor_state = CompositorState::new::<Self>(&display_handle);
        let xdg_shell_state = XdgShellState::new::<Self>(&display_handle);
        let shm_state = ShmState::new::<Self>(&display_handle, vec![]);
        let data_device_state = DataDeviceState::new::<Self>(&display_handle);
        let output_manager_state = OutputManagerState::new_with_xdg_output::<Self>(&display_handle);
        let xwayland_shell_state = XWaylandShellState::new::<Self>(&display_handle);
        let viewporter_state = ViewporterState::new::<Self>(&display_handle);
        RelativePointerManagerState::new::<Self>(&display_handle);
        PointerConstraintsState::new::<Self>(&display_handle);

        // Seat: keyboard + pointer.
        let mut seat_state = SeatState::new();
        let mut seat = seat_state.new_wl_seat(&display_handle, "nescope");
        seat.add_keyboard(Default::default(), 200, 25)
            .expect("Failed to add keyboard");
        seat.add_pointer();

        // Virtual output — physical size assumes 96 DPI.
        let phys_w_mm = (width as f64 * 25.4 / 96.0) as i32;
        let phys_h_mm = (height as f64 * 25.4 / 96.0) as i32;
        let output = Output::new(
            "nescope-virtual".into(),
            smithay::output::PhysicalProperties {
                size: (phys_w_mm, phys_h_mm).into(),
                subpixel: smithay::output::Subpixel::Unknown,
                make: "nescope".into(),
                model: "Virtual".into(),
            },
        );
        let mode = smithay::output::Mode {
            size: (width as i32, height as i32).into(),
            refresh: (fps * 1_000) as i32,
        };
        output.change_current_state(Some(mode), None, None, Some((0, 0).into()));
        output.set_preferred(mode);
        output.create_global::<Self>(&display_handle);

        let mut space = Space::default();
        space.map_output(&output, (0, 0));

        let clock = Clock::new();
        let presentation_state = PresentationState::new::<Self>(&display_handle, clock.id() as _);

        // DMA-BUF global — required so XWayland can set up DRI3/GBM/glamor.
        // nescope itself never touches the buffers; it just accepts everything.
        let (dmabuf_state, dmabuf_global) =
            build_dmabuf_global::<Self>(&display_handle, render_device.as_deref());

        // HDR + gamescope swapchain globals (optional).
        let hdr_state = HdrState::new(&display_handle, hdr);

        // Input channel — the Sender is returned to the caller.
        let (input_tx, input_rx) = calloop::channel::channel::<InputEvent>();

        // Register the input channel as a calloop event source.
        // Events are dispatched synchronously in the idle callback via
        // the CalloopData state.
        loop_handle
            .insert_source(input_rx, |event, _, data| {
                if let calloop::channel::Event::Msg(ev) = event {
                    crate::input::process_input(ev, &mut data.state);
                }
            })
            .expect("Failed to register input channel");

        let state = Self {
            display_handle,
            compositor_state,
            xdg_shell_state,
            shm_state,
            dmabuf_state,
            dmabuf_global,
            seat_state,
            data_device_state,
            output_manager_state,
            xwayland_shell_state,
            viewporter_state,
            seat,
            space,
            output,
            clock,
            presentation_state,
            held_buffer: None,
            hdr: hdr_state,
            xwm: None,
            xdisplay: None,
            x11_input_conn: None,
            focused_x11_window: None,
            focused_app_id: 0,
            x11_focus_needs_reset: false,
            override_surface: None,
            vulkan_surfaces: HashSet::new(),
            input_tx: input_tx.clone(),
            cursor_position: Point::from((0.0f64, 0.0f64)),
            cursor_status: CursorImageStatus::default_named(),
            cursor_image_data: None,
            cursor_image_sent: false,
            ipc_write: None,
            cursor_initialized: false,
            game_frame_count: 0,
            last_stats_time: std::time::Instant::now(),
            last_sent_cursor_pos: Point::from((-1.0f64, -1.0f64)),
            last_sent_cursor_status: 0xFF,
            last_pointer_activity: std::time::Instant::now(),
            width,
            height,
            fps,
            loop_handle,
            game_launched: false,
            no_clients_since: None,
        };

        (state, input_tx)
    }

    // -----------------------------------------------------------------------
    // XWayland
    // -----------------------------------------------------------------------

    /// Spawn XWayland and register its calloop event source.
    pub fn init_xwayland(
        &mut self,
        loop_handle: &LoopHandle<'static, CalloopData>,
        display: Option<u32>,
    ) {
        let (xwayland, client) = XWayland::spawn(
            &self.display_handle,
            display,
            std::iter::empty::<(String, String)>(),
            true,
            std::process::Stdio::null(), // XWayland stdout (very noisy)
            std::process::Stdio::null(), // XWayland stderr (very noisy)
            |_| {},
        )
        .expect("Failed to spawn XWayland");

        let ret = loop_handle.insert_source(xwayland, move |event, _, data| match event {
            XWaylandEvent::Ready {
                x11_socket,
                display_number,
                ..
            } => {
                tracing::info!("XWayland ready on :{display_number}");
                let xwm =
                    X11Wm::start_wm(data.state.loop_handle.clone(), x11_socket, client.clone())
                        .expect("Failed to start X11 WM");
                data.state.xwm = Some(xwm);
                data.state.xdisplay = Some(display_number);
                NescopeState::open_x11_input_conn(data, display_number);
            }
            XWaylandEvent::Error => {
                tracing::error!("XWayland crashed at startup");
            }
        });

        if let Err(e) = ret {
            tracing::error!("Failed to insert XWayland event source: {e}");
        }
    }

    fn open_x11_input_conn(data: &mut CalloopData, display_number: u32) {
        use smithay::reexports::x11rb::connection::Connection as _;
        use smithay::reexports::x11rb::rust_connection::RustConnection;

        let display_str = format!(":{display_number}");
        match RustConnection::connect(Some(&display_str)) {
            Ok((conn, screen_num)) => {
                let root = conn.setup().roots[screen_num].root;
                let atoms = CachedAtoms {
                    net_active_window: intern_atom(&conn, b"_NET_ACTIVE_WINDOW"),
                    gamescope_focused_app: intern_atom(&conn, b"GAMESCOPE_FOCUSED_APP"),
                    gamescope_focusable_apps: intern_atom(&conn, b"GAMESCOPE_FOCUSABLE_APPS"),
                    gamescope_focusable_windows: intern_atom(&conn, b"GAMESCOPE_FOCUSABLE_WINDOWS"),
                    gamescope_hdr_output_feedback: intern_atom(
                        &conn,
                        b"GAMESCOPE_HDR_OUTPUT_FEEDBACK",
                    ),
                    gamescope_xwayland_server_id: intern_atom(
                        &conn,
                        b"GAMESCOPE_XWAYLAND_SERVER_ID",
                    ),
                    xa_window: intern_atom(&conn, b"WINDOW"),
                    xa_cardinal: intern_atom(&conn, b"CARDINAL"),
                };

                if data.state.hdr.enabled {
                    data.state
                        .set_gamescope_atoms(&conn, root, &atoms, display_number);
                }

                data.state.x11_input_conn = Some(X11InputConnection { conn, root, atoms });
                tracing::debug!("X11 input connection opened on :{display_number}");
            }
            Err(e) => tracing::warn!("Failed to open X11 input connection: {e}"),
        }
    }

    /// Write gamescope-specific X11 root window properties so the WSI layer
    /// can discover this compositor as a gamescope-compatible server.
    pub fn set_gamescope_atoms(
        &self,
        conn: &smithay::reexports::x11rb::rust_connection::RustConnection,
        root: u32,
        atoms: &CachedAtoms,
        display_number: u32,
    ) {
        use smithay::reexports::x11rb::connection::Connection;
        use smithay::reexports::x11rb::protocol::xproto::{AtomEnum, PropMode};
        use smithay::reexports::x11rb::wrapper::ConnectionExt as _;

        let replace = PropMode::REPLACE;
        let cardinal = AtomEnum::CARDINAL;

        // HDR output feedback — set to 1 when HDR is active.
        let _ = conn.change_property32(
            replace,
            root,
            atoms.gamescope_hdr_output_feedback,
            cardinal,
            &[1u32],
        );
        // XWayland server ID — always 0 for a standalone compositor.
        let _ = conn.change_property32(
            replace,
            root,
            atoms.gamescope_xwayland_server_id,
            cardinal,
            &[0u32],
        );
        let _ = conn.change_property32(
            replace,
            root,
            atoms.gamescope_focused_app,
            cardinal,
            &[0u32],
        );
        let _ = conn.flush();
        tracing::debug!("Set gamescope atoms on display :{display_number}");
    }

    // -----------------------------------------------------------------------
    // Override surface (gamescope WSI bypass)
    // -----------------------------------------------------------------------

    /// Register the gamescope WSI override surface for an X11 window.
    pub fn override_window_surface(&mut self, x11_window: u32, surface: WlSurface) {
        tracing::debug!(x11_window, "Registered gamescope WSI override surface");
        self.override_surface = Some(surface);
    }

    // -----------------------------------------------------------------------
    // Resize
    // -----------------------------------------------------------------------

    /// Apply a new output resolution (e.g. from a runtime resize request).
    #[allow(unused)]
    pub fn apply_resize(&mut self, width: u32, height: u32) {
        tracing::info!("Applying resize: {width}x{height}");
        self.width = width;
        self.height = height;

        let mode = smithay::output::Mode {
            size: (width as i32, height as i32).into(),
            refresh: (self.fps * 1_000) as i32,
        };
        self.output
            .change_current_state(Some(mode), None, None, None);

        for window in self.space.elements().cloned().collect::<Vec<_>>() {
            if let Some(tl) = window.toplevel() {
                tl.with_pending_state(|s| {
                    s.size = Some((width as i32, height as i32).into());
                });
                tl.send_pending_configure();
            }
            if let Some(x11) = window.x11_surface() {
                let geo = Rectangle::new((0, 0).into(), (width as i32, height as i32).into());
                if let Err(e) = x11.configure(geo) {
                    tracing::warn!("Failed to reconfigure X11 window on resize: {e}");
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // X11 focus helpers
    // -----------------------------------------------------------------------

    pub(crate) fn sync_x11_focus(&mut self) {
        use smithay::reexports::x11rb::connection::Connection as _;
        use smithay::reexports::x11rb::protocol::xproto::{
            ConnectionExt as _, InputFocus, PropMode,
        };

        let Some(ref x11) = self.x11_input_conn else {
            return;
        };
        let Some(win_id) = self.focused_x11_window else {
            return;
        };

        tracing::debug!("sync_x11_focus: id:{}", win_id);

        let _ = x11.conn.set_input_focus(
            InputFocus::PARENT,
            win_id,
            smithay::reexports::x11rb::CURRENT_TIME,
        );

        let _ = x11.conn.change_property(
            PropMode::REPLACE,
            x11.root,
            x11.atoms.net_active_window,
            x11.atoms.xa_window,
            32,
            1,
            &win_id.to_ne_bytes(),
        );

        // Build focusable apps and windows lists (gamescope-compatible).
        let mut focusable_apps: Vec<u32> = Vec::new();
        let mut focusable_windows: Vec<u32> = Vec::new();

        for win in self.space.elements() {
            let Some(x11_win) = win.x11_surface() else {
                continue;
            };
            if x11_win.is_override_redirect() {
                continue;
            }

            let class = x11_win.class();
            let wapp_id: u32 = class
                .strip_prefix("steam_app_")
                .and_then(|s| s.parse().ok())
                .unwrap_or_else(|| {
                    if class.eq_ignore_ascii_case("steam") {
                        769
                    } else {
                        0
                    }
                });

            if wapp_id != 0 && !focusable_apps.contains(&wapp_id) {
                focusable_apps.push(wapp_id);
            }
            focusable_windows.extend_from_slice(&[
                x11_win.window_id(),
                wapp_id,
                x11_win.pid().unwrap_or(0),
            ]);
        }

        let apps_bytes: Vec<u8> = focusable_apps
            .iter()
            .flat_map(|id| id.to_ne_bytes())
            .collect();
        let wins_bytes: Vec<u8> = focusable_windows
            .iter()
            .flat_map(|id| id.to_ne_bytes())
            .collect();

        let _ = x11.conn.change_property(
            PropMode::REPLACE,
            x11.root,
            x11.atoms.gamescope_focusable_apps,
            x11.atoms.xa_cardinal,
            32,
            focusable_apps.len() as u32,
            &apps_bytes,
        );
        let _ = x11.conn.change_property(
            PropMode::REPLACE,
            x11.root,
            x11.atoms.gamescope_focusable_windows,
            x11.atoms.xa_cardinal,
            32,
            focusable_windows.len() as u32,
            &wins_bytes,
        );

        let app_id = self.focused_app_id;
        let (app_data, app_len): (&[u8], u32) = if app_id != 0 {
            (&app_id.to_ne_bytes(), 1)
        } else {
            (&[], 0)
        };
        let _ = x11.conn.change_property(
            PropMode::REPLACE,
            x11.root,
            x11.atoms.gamescope_focused_app,
            x11.atoms.xa_cardinal,
            32,
            app_len,
            app_data,
        );

        let _ = x11.conn.flush();
        self.x11_focus_needs_reset = false;
    }

    pub(crate) fn set_keyboard_focus_to_window(&mut self, window: &Window) {
        use smithay::utils::SERIAL_COUNTER;
        let serial = SERIAL_COUNTER.next_serial();

        if let Some(x11) = window.x11_surface() {
            self.focused_x11_window = Some(x11.window_id());

            if x11.wl_surface().is_none() {
                if let Some(proxy) = self.find_xwayland_proxy_surface() {
                    let target = crate::focus::KeyboardFocusTarget::ProxiedX11 {
                        window: window.clone(),
                        proxy_surface: proxy,
                    };
                    if let Some(kb) = self.seat.get_keyboard() {
                        kb.set_focus(self, Some(target), serial);
                    }
                    self.sync_x11_focus();
                    self.x11_focus_needs_reset = true;
                    return;
                }
            }
        }

        if let Some(kb) = self.seat.get_keyboard() {
            kb.set_focus(
                self,
                Some(crate::focus::KeyboardFocusTarget::Window(window.clone())),
                serial,
            );
        }
        self.sync_x11_focus();
    }

    pub(crate) fn find_xwayland_proxy_surface(&self) -> Option<WlSurface> {
        self.space
            .elements()
            .filter_map(|w| w.x11_surface())
            .find_map(|x11| x11.wl_surface())
    }

    /// Re-evaluate focus after any window map/unmap/property-change event.
    pub(crate) fn determine_and_apply_focus(&mut self) {
        let mut game_window: Option<Window> = None;
        let mut fallback_window: Option<Window> = None;

        for win in self.space.elements() {
            if let Some(x11) = win.x11_surface() {
                if x11.is_override_redirect() {
                    continue;
                }
                let class = x11.class();
                if class.starts_with("steam_app_") {
                    game_window = Some(win.clone());
                } else {
                    fallback_window = Some(win.clone());
                }
            } else {
                // Native Wayland toplevel — treat as a game window
                // (higher priority than unknown X11 windows).
                if game_window.is_none() {
                    game_window = Some(win.clone());
                }
            }
        }

        let target = match (game_window, fallback_window) {
            (Some(g), _) => g,
            (None, Some(f)) => f,
            (None, None) => return,
        };

        // For X11 windows, check if focus actually changed.
        let new_id = target.x11_surface().map(|x| x.window_id());
        if new_id.is_some() && new_id == self.focused_x11_window && !self.x11_focus_needs_reset {
            return;
        }

        // Update app ID tracking (X11 only — native Wayland doesn't use steam class names).
        if let Some(x11) = target.x11_surface() {
            let class = x11.class();
            self.focused_app_id = class
                .strip_prefix("steam_app_")
                .and_then(|s| s.parse().ok())
                .unwrap_or_else(|| {
                    if class.eq_ignore_ascii_case("steam") {
                        769
                    } else {
                        0
                    }
                });
            self.focused_x11_window = new_id;
        } else {
            // Native Wayland window — clear X11 focus state.
            self.focused_x11_window = None;
            self.focused_app_id = 0;
        }

        self.set_keyboard_focus_to_window(&target);

        // Point the pointer at the window so games receive the initial
        // enter event correctly.
        use smithay::desktop::WindowSurfaceType;
        if let Some(geo) = self.space.element_geometry(&target) {
            let loc = geo.loc.to_f64();
            if target
                .surface_under(Point::from((0.0f64, 0.0f64)), WindowSurfaceType::ALL)
                .is_some()
            {
                if let Some(pointer) = self.seat.get_pointer() {
                    let serial = smithay::utils::SERIAL_COUNTER.next_serial();
                    let target_focus = KeyboardFocusTarget::Window(target.clone());
                    pointer.motion(
                        self,
                        Some((target_focus, loc)),
                        &smithay::input::pointer::MotionEvent {
                            location: loc,
                            serial,
                            time: self.clock.now().as_millis(),
                        },
                    );
                    pointer.frame(self);
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Frame callbacks — driven by the fps timer in main.rs
    // -----------------------------------------------------------------------

    /// Called from the calloop timer at target fps.
    pub fn on_frame_tick(&mut self) {
        self.game_frame_count += 1;

        let output = self.output.clone();
        let now = self.clock.now();

        // 1. Release the held buffer → frees a swapchain image for the game.
        self.held_buffer.take();

        // 2. Presentation feedback — tell clients about vsync timing.
        let mut output_presentation_feedback = OutputPresentationFeedback::new(&output);
        for window in self.space.elements().cloned().collect::<Vec<_>>() {
            window.take_presentation_feedback(
                &mut output_presentation_feedback,
                surface_primary_scanout_output,
                |_, _| wp_presentation_feedback::Kind::Vsync,
            );
        }
        output_presentation_feedback.presented(
            now,
            output
                .current_mode()
                .map(|mode| Refresh::fixed(Duration::from_secs_f64(1_000f64 / mode.refresh as f64)))
                .unwrap_or(Refresh::Unknown),
            0,
            wp_presentation_feedback::Kind::Vsync,
        );

        // 3. Frame callbacks — tell the game it can present the next frame.
        for window in self.space.elements().cloned().collect::<Vec<_>>() {
            if let Some(surface) = window.wl_surface() {
                send_frames_surface_tree(&*surface, &output, now, Some(Duration::ZERO), |_, _| {
                    Some(output.clone())
                });
            }
        }

        if let Some(ref s) = self.override_surface {
            send_frames_surface_tree(s, &output, now, Some(Duration::ZERO), |_, _| {
                Some(output.clone())
            });
        }

        // 4. Send periodic stats over IPC
        let now = std::time::Instant::now();
        if now.duration_since(self.last_stats_time) >= std::time::Duration::from_secs(1) {
            let fps = self.game_frame_count.min(255) as u8;
            let count = self.game_frame_count as u32;
            self.game_frame_count = 0;
            self.last_stats_time = now;

            if let Some(ref mut ipc) = self.ipc_write {
                use std::io::Write;
                let mut buf = Vec::with_capacity(6);
                nesprotocol::stats::encode_nescope_stats(&mut buf, fps, count);
                let len = buf.len() as u16;
                let _ = ipc.write_all(&len.to_le_bytes());
                let _ = ipc.write_all(&buf);
                let _ = ipc.flush();
            }
        }

        // 5. Send cursor position update over IPC (if changed).
        self.send_cursor_update();
    }

    fn send_cursor_update(&mut self) {
        use std::io::Write;
        let ipc = match self.ipc_write.as_mut() {
            Some(s) => s,
            None => return,
        };

        // Send cursor image if it hasn't been sent yet
        if let Some(ref image_data) = self.cursor_image_data {
            if !self.cursor_image_sent {
                let x = self.cursor_position.x as f32;
                let y = self.cursor_position.y as f32;
                let mut buf = Vec::with_capacity(21 + image_data.rgba.len());
                nesprotocol::input::encode_cursor_image(
                    &mut buf,
                    x,
                    y,
                    image_data.width,
                    image_data.height,
                    image_data.hotspot_x,
                    image_data.hotspot_y,
                    &image_data.rgba,
                );
                let len = buf.len() as u16;
                let _ = ipc.write_all(&len.to_le_bytes());
                let _ = ipc.write_all(&buf);
                let _ = ipc.flush();
                tracing::debug!(
                    "cursor: sent custom image {}x{} ({} bytes) pos=({:.0},{:.0})",
                    image_data.width,
                    image_data.height,
                    image_data.rgba.len(),
                    x,
                    y
                );
                self.cursor_image_sent = true;
                self.last_sent_cursor_pos = self.cursor_position;
                self.last_sent_cursor_status = nesprotocol::input::CURSOR_IMAGE;
                return;
            }
        }

        let status = match &self.cursor_status {
            CursorImageStatus::Hidden => nesprotocol::input::CURSOR_HIDDEN,
            CursorImageStatus::Named(_) => nesprotocol::input::CURSOR_NAMED,
            CursorImageStatus::Surface(_) => nesprotocol::input::CURSOR_SURFACE,
        };

        let pos_changed = (self.cursor_position.x - self.last_sent_cursor_pos.x).abs() > 0.5
            || (self.cursor_position.y - self.last_sent_cursor_pos.y).abs() > 0.5;
        let status_changed = status != self.last_sent_cursor_status;

        if !pos_changed && !status_changed {
            return;
        }

        let x = self.cursor_position.x as f32;
        let y = self.cursor_position.y as f32;

        let mut buf = Vec::with_capacity(10);
        nesprotocol::input::encode_cursor_update(&mut buf, x, y, status);

        let len = buf.len() as u16;
        let _ = ipc.write_all(&len.to_le_bytes());
        let _ = ipc.write_all(&buf);
        let _ = ipc.flush();

        tracing::debug!(
            "cursor: sent update pos=({:.0},{:.0}) status={status}",
            x,
            y
        );
        self.last_sent_cursor_pos = self.cursor_position;
        self.last_sent_cursor_status = status;
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn intern_atom(
    conn: &smithay::reexports::x11rb::rust_connection::RustConnection,
    name: &[u8],
) -> u32 {
    use smithay::reexports::x11rb::protocol::xproto::ConnectionExt as _;
    conn.intern_atom(false, name)
        .map_err(Into::into)
        .and_then(|c| c.reply())
        .map(|r| r.atom)
        .unwrap_or_else(|e| {
            tracing::warn!("intern_atom({:?}): {e}", String::from_utf8_lossy(name));
            0
        })
}

/// Register the `zwp_linux_dmabuf_v1` global.
///
/// nescope does not render into DMA-BUFs itself, but XWayland needs DRI3
/// (backed by this global) for GBM/glamor initialization — without it Steam's
/// GLX initialization fails.  A v4 global with default feedback is preferred;
/// a v3 fallback is used when no render node is available.
fn build_dmabuf_global<D>(
    display: &DisplayHandle,
    render_device: Option<&str>,
) -> (DmabufState, DmabufGlobal)
where
    D: smithay::wayland::dmabuf::DmabufHandler
        + smithay::reexports::wayland_server::GlobalDispatch<
            wayland_protocols::wp::linux_dmabuf::zv1::server::zwp_linux_dmabuf_v1::ZwpLinuxDmabufV1,
            smithay::wayland::dmabuf::DmabufGlobalData,
        > + 'static,
{
    use smithay::backend::allocator::{Format, Fourcc, Modifier};
    use smithay::wayland::dmabuf::{DmabufFeedbackBuilder, DmabufState};
    use std::os::unix::fs::MetadataExt;

    // Formats declared to XWayland for DRI3.  The actual pixel format used
    // by the game's Vulkan swapchain is independent of this list.
    let formats = [
        Format {
            code: Fourcc::Argb8888,
            modifier: Modifier::Linear,
        },
        Format {
            code: Fourcc::Xrgb8888,
            modifier: Modifier::Linear,
        },
        Format {
            code: Fourcc::Abgr8888,
            modifier: Modifier::Linear,
        },
        Format {
            code: Fourcc::Abgr2101010,
            modifier: Modifier::Linear,
        },
        Format {
            code: Fourcc::Argb2101010,
            modifier: Modifier::Linear,
        },
        Format {
            code: Fourcc::Argb8888,
            modifier: Modifier::Invalid,
        },
        Format {
            code: Fourcc::Xrgb8888,
            modifier: Modifier::Invalid,
        },
    ];

    let mut dmabuf_state = DmabufState::new();

    let render_node = render_device
        .map(std::path::PathBuf::from)
        .filter(|p| p.exists())
        .or_else(|| {
            std::env::var("NESCOPE_RENDER_DEVICE")
                .ok()
                .map(std::path::PathBuf::from)
                .filter(|p| p.exists())
        })
        .or_else(|| {
            std::fs::read_dir("/dev/dri").ok().and_then(|dir| {
                dir.filter_map(|e| e.ok())
                    .find(|e| e.file_name().to_string_lossy().starts_with("renderD"))
                    .map(|e| e.path())
            })
        });

    if let Some(ref path) = render_node {
        if let Ok(meta) = std::fs::metadata(path) {
            let dev = meta.rdev();
            tracing::info!(
                "DMA-BUF: using render node {} (dev={}:{})",
                path.display(),
                libc::major(dev),
                libc::minor(dev)
            );
            if let Ok(feedback) = DmabufFeedbackBuilder::new(dev, formats.iter().copied()).build() {
                let global =
                    dmabuf_state.create_global_with_default_feedback::<D>(display, &feedback);
                return (dmabuf_state, global);
            }
        }
    } else {
        tracing::warn!(
            "No render node in /dev/dri — XWayland DRI3 will be unavailable; \
             Steam may fail with glXChooseVisual"
        );
    }

    let global = dmabuf_state.create_global::<D>(display, formats.iter().copied());
    (dmabuf_state, global)
}
