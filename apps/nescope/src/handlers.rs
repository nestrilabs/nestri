//! Smithay protocol handler implementations for nescope.
//!
//! - `CompositorHandler` on `NescopeState`
//! - `XdgShellHandler` on `NescopeState`
//! - `SeatHandler` on `NescopeState`
//! - `XwmHandler` on `CalloopData` (calloop dispatch type) + stub on `NescopeState`
//! - All delegate macros

use smithay::backend::allocator::dmabuf::Dmabuf;
use smithay::desktop::Window;
use smithay::input::pointer::{CursorImageStatus, PointerHandle};
use smithay::input::{Seat, SeatHandler, SeatState};
use smithay::output::Output;
use smithay::reexports::wayland_server::protocol::wl_buffer;
use smithay::reexports::wayland_server::protocol::wl_output::WlOutput;
use smithay::reexports::wayland_server::protocol::wl_seat::WlSeat;
use smithay::reexports::wayland_server::protocol::wl_surface::WlSurface;
use smithay::utils::{Logical, Point, Rectangle, Serial};
use smithay::wayland::buffer::BufferHandler;
use smithay::wayland::compositor::{
    BufferAssignment, CompositorClientState, CompositorHandler, CompositorState, SurfaceAttributes,
    is_sync_subsurface, with_states,
};
use smithay::wayland::dmabuf::{DmabufGlobal, DmabufHandler, DmabufState, ImportNotifier};
use smithay::wayland::output::OutputHandler;
use smithay::wayland::pointer_constraints::{PointerConstraintsHandler, with_pointer_constraint};
use smithay::wayland::seat::WaylandFocus;
use smithay::wayland::selection::SelectionHandler;
use smithay::wayland::selection::data_device::{
    ClientDndGrabHandler, DataDeviceHandler, DataDeviceState, ServerDndGrabHandler,
};
use smithay::wayland::shell::xdg::{
    PopupSurface, PositionerState, ToplevelSurface, XdgShellHandler, XdgShellState,
};
use smithay::wayland::shm::{ShmHandler, ShmState, with_buffer_contents};
use smithay::wayland::xwayland_shell::{XWaylandShellHandler, XWaylandShellState};
use smithay::xwayland::xwm::{Reorder, ResizeEdge, WmWindowProperty, XwmId};
use smithay::xwayland::{X11Surface, X11Wm, XWaylandClientData, XwmHandler};

use crate::focus::KeyboardFocusTarget;
use crate::state::{CalloopData, ClientState, NescopeState};

// ===========================================================================
// BufferHandler / ShmHandler
// ===========================================================================

impl BufferHandler for NescopeState {
    fn buffer_destroyed(&mut self, _buffer: &wl_buffer::WlBuffer) {}
}

impl ShmHandler for NescopeState {
    fn shm_state(&self) -> &ShmState {
        &self.shm_state
    }
}

// ===========================================================================
// CompositorHandler
// ===========================================================================

impl CompositorHandler for NescopeState {
    fn compositor_state(&mut self) -> &mut CompositorState {
        &mut self.compositor_state
    }

    fn client_compositor_state<'a>(
        &self,
        client: &'a smithay::reexports::wayland_server::Client,
    ) -> &'a CompositorClientState {
        if let Some(state) = client.get_data::<ClientState>() {
            return &state.compositor_state;
        }
        if let Some(state) = client.get_data::<XWaylandClientData>() {
            return &state.compositor_state;
        }
        panic!("Client has neither ClientState nor XWaylandClientData");
    }

    fn commit(&mut self, surface: &WlSurface) {
        self.hdr.commit(surface);

        if is_sync_subsurface(surface) {
            return;
        }

        // Hold a reference to the committed buffer — delays wl_buffer.release
        // until the next frame tick, starving the swapchain of images in FIFO mode.
        smithay::wayland::compositor::with_states(surface, |states| {
            let mut cached = states
                .cached_state
                .get::<smithay::wayland::compositor::SurfaceAttributes>();
            let attrs = cached.current();
            if let Some(smithay::wayland::compositor::BufferAssignment::NewBuffer(ref wl_buf)) =
                attrs.buffer
            {
                self.held_buffer = Some(wl_buf.clone());
            }
        });

        // Notify the window of the commit so it can refresh its cached state.
        if let Some(window) = self
            .space
            .elements()
            .find(|w| {
                w.toplevel()
                    .map(|t| t.wl_surface() == surface)
                    .unwrap_or(false)
            })
            .cloned()
        {
            window.on_commit();
        }
    }

    fn destroyed(&mut self, surface: &WlSurface) {
        self.hdr.surface_destroyed(surface);
        self.vulkan_surfaces.remove(surface);
    }
}

// ===========================================================================
// DmabufHandler — accept everything; nescope never imports the buffers itself
// ===========================================================================

impl DmabufHandler for NescopeState {
    fn dmabuf_state(&mut self) -> &mut DmabufState {
        &mut self.dmabuf_state
    }

    fn dmabuf_imported(
        &mut self,
        _global: &DmabufGlobal,
        _dmabuf: Dmabuf,
        notifier: ImportNotifier,
    ) {
        // Accept unconditionally — libhudless reads buffers
        // directly from the game's Vulkan queue; nescope doesn't need to.
        let _ = notifier.successful::<NescopeState>();
    }
}

// ===========================================================================
// XDG shell
// ===========================================================================

impl XdgShellHandler for NescopeState {
    fn xdg_shell_state(&mut self) -> &mut XdgShellState {
        &mut self.xdg_shell_state
    }

    fn new_toplevel(&mut self, surface: ToplevelSurface) {
        // Tell the toplevel to fill the entire virtual output.
        surface.with_pending_state(|state| {
            state.size = Some((self.width as i32, self.height as i32).into());
        });
        surface.send_configure();

        let window = Window::new_wayland_window(surface);
        self.space.map_element(window.clone(), (0, 0), false);
        self.set_keyboard_focus_to_window(&window);
        tracing::debug!("New XDG toplevel");
    }

    fn toplevel_destroyed(&mut self, surface: ToplevelSurface) {
        // Remove the dead window from the space.
        let elem = self
            .space
            .elements()
            .find(|w| {
                w.toplevel()
                    .map(|t| t.wl_surface() == surface.wl_surface())
                    .unwrap_or(false)
            })
            .cloned();

        if let Some(elem) = elem {
            self.space.unmap_elem(&elem);
            tracing::debug!("Unmapped destroyed XDG toplevel");
        }

        // Re-focus the next window (if any).
        self.determine_and_apply_focus();
    }

    fn new_popup(&mut self, _: PopupSurface, _: PositionerState) {}
    fn grab(&mut self, _: PopupSurface, _: WlSeat, _: Serial) {}
    fn reposition_request(&mut self, _: PopupSurface, _: PositionerState, _: u32) {}
}

// ===========================================================================
// SeatHandler
// ===========================================================================

impl SeatHandler for NescopeState {
    type KeyboardFocus = KeyboardFocusTarget;
    type PointerFocus = KeyboardFocusTarget;
    type TouchFocus = WlSurface;

    fn seat_state(&mut self) -> &mut SeatState<Self> {
        &mut self.seat_state
    }

    fn focus_changed(&mut self, _seat: &Seat<Self>, focused: Option<&KeyboardFocusTarget>) {
        let kind = focused
            .map(|f| match f {
                KeyboardFocusTarget::Window(_) => "wayland window",
                KeyboardFocusTarget::ProxiedX11 { .. } => "proxied x11",
            })
            .unwrap_or("none");
        tracing::debug!("keyboard focus changed to {kind}");
    }

    fn cursor_image(&mut self, _seat: &Seat<Self>, image: CursorImageStatus) {
        let kind = match &image {
            CursorImageStatus::Hidden => "hidden",
            CursorImageStatus::Named(n) => {
                tracing::debug!("cursor: named({n})");
                "named"
            }
            CursorImageStatus::Surface(_) => {
                tracing::debug!("cursor: custom surface");
                "surface"
            }
        };
        tracing::trace!("cursor_image set to {kind}");

        // Try to capture custom cursor pixels from SHM buffer
        let captured = if let CursorImageStatus::Surface(ref surface) = image {
            let buffer_opt: Option<wl_buffer::WlBuffer> = with_states(surface, |data| {
                let mut attrs = data.cached_state.get::<SurfaceAttributes>();
                match attrs.current().buffer {
                    Some(BufferAssignment::NewBuffer(ref buf)) => Some(buf.clone()),
                    _ => None,
                }
            });
            buffer_opt.and_then(|buffer| {
                match with_buffer_contents(&buffer, |ptr, _len, data| {
                    let offset = data.offset as isize;
                    let src = unsafe { ptr.offset(offset) };
                    let pixel_bytes = (data.width * data.height * 4) as usize;
                    let stride = data.stride as usize;
                    let is_xrgb = data.format
                        == smithay::reexports::wayland_server::protocol::wl_shm::Format::Xrgb8888;
                    let mut rgba = vec![0u8; pixel_bytes];
                    for row in 0..data.height as usize {
                        let src_start = row * stride;
                        let dst_row = (data.height as usize - 1 - row) * data.width as usize * 4;
                        unsafe {
                            std::ptr::copy_nonoverlapping(
                                src.add(src_start),
                                rgba.as_mut_ptr().add(dst_row),
                                data.width as usize * 4,
                            );
                        }
                    }
                    if is_xrgb {
                        for px in rgba.chunks_exact_mut(4) {
                            px[3] = 255;
                        }
                    }
                    let preview = if rgba.len() >= 16 {
                        &rgba[..16]
                    } else {
                        &rgba[..]
                    };
                    tracing::debug!(
                        "cursor: captured {}x{} xrgb={} preview={:02x?}",
                        data.width,
                        data.height,
                        is_xrgb,
                        preview,
                    );
                    nesprotocol::input::CursorImageData {
                        x: 0.0,
                        y: 0.0,
                        width: data.width as u16,
                        height: data.height as u16,
                        hotspot_x: 0,
                        hotspot_y: 0,
                        rgba,
                    }
                }) {
                    Ok(d) => Some(d),
                    Err(_) => {
                        tracing::debug!("cursor: surface buffer is not SHM, using box fallback");
                        None
                    }
                }
            })
        } else {
            None
        };

        self.cursor_image_data = captured;
        self.cursor_image_sent = false; // allow re-send for new cursor surface
        if self.cursor_image_data.is_some() {
            tracing::debug!(
                "cursor: captured custom image {}x{} (BGRA)",
                self.cursor_image_data.as_ref().unwrap().width,
                self.cursor_image_data.as_ref().unwrap().height,
            );
        }

        self.cursor_status = image;
    }

    fn led_state_changed(&mut self, _: &Seat<Self>, _: smithay::input::keyboard::LedState) {}
}

// ===========================================================================
// Selection / data device
// ===========================================================================

impl SelectionHandler for NescopeState {
    type SelectionUserData = ();
}
impl DataDeviceHandler for NescopeState {
    fn data_device_state(&self) -> &DataDeviceState {
        &self.data_device_state
    }
}
impl ClientDndGrabHandler for NescopeState {}
impl ServerDndGrabHandler for NescopeState {}

// ===========================================================================
// Output
// ===========================================================================

impl OutputHandler for NescopeState {
    fn output_bound(&mut self, _output: Output, _wl_output: WlOutput) {}
}

// ===========================================================================
// Pointer constraints
// ===========================================================================

impl PointerConstraintsHandler for NescopeState {
    fn new_constraint(&mut self, surface: &WlSurface, pointer: &PointerHandle<Self>) {
        if let Some(focus) = pointer.current_focus() {
            if focus.wl_surface().as_deref() == Some(surface) {
                with_pointer_constraint(surface, pointer, |c| {
                    if let Some(c) = c {
                        c.activate();
                    }
                });
            }
        }
    }

    fn cursor_position_hint(
        &mut self,
        surface: &WlSurface,
        pointer: &PointerHandle<Self>,
        location: Point<f64, Logical>,
    ) {
        if with_pointer_constraint(surface, pointer, |c| c.is_some_and(|c| c.is_active())) {
            use smithay::wayland::seat::WaylandFocus;
            let origin = self
                .space
                .elements()
                .find_map(|w| (w.wl_surface().as_deref() == Some(surface)).then(|| w.geometry()))
                .unwrap_or_default()
                .loc
                .to_f64();
            pointer.set_location(origin + location);
        }
    }
}

// ===========================================================================
// XWayland shell
// ===========================================================================

impl XWaylandShellHandler for NescopeState {
    fn xwayland_shell_state(&mut self) -> &mut XWaylandShellState {
        &mut self.xwayland_shell_state
    }

    fn surface_associated(&mut self, _xwm: XwmId, _wl_surface: WlSurface, surface: X11Surface) {
        tracing::debug!(window_id = surface.window_id(), "X11 surface associated");
        self.determine_and_apply_focus();
    }
}

impl XWaylandShellHandler for CalloopData {
    fn xwayland_shell_state(&mut self) -> &mut XWaylandShellState {
        &mut self.state.xwayland_shell_state
    }

    fn surface_associated(&mut self, xwm: XwmId, wl_surface: WlSurface, surface: X11Surface) {
        XWaylandShellHandler::surface_associated(&mut self.state, xwm, wl_surface, surface);
    }
}

// ===========================================================================
// XwmHandler — real implementation on CalloopData
// ===========================================================================

impl XwmHandler for CalloopData {
    fn xwm_state(&mut self, _xwm: XwmId) -> &mut X11Wm {
        self.state.xwm.as_mut().expect("XWM not initialized")
    }

    fn new_window(&mut self, _xwm: XwmId, window: X11Surface) {
        tracing::debug!(
            window_id = window.window_id(),
            title = ?window.title(),
            "New X11 window"
        );
    }

    fn new_override_redirect_window(&mut self, _xwm: XwmId, window: X11Surface) {
        tracing::debug!(
            window_id = window.window_id(),
            "New override-redirect window"
        );
    }

    fn map_window_request(&mut self, _xwm: XwmId, window: X11Surface) {
        tracing::debug!(
            title = ?window.title(),
            class = ?window.class(),
            "X11 map_window_request"
        );
        let geo = Rectangle::new(
            (0, 0).into(),
            (self.state.width as i32, self.state.height as i32).into(),
        );
        if let Err(e) = window.configure(geo) {
            tracing::warn!("configure failed: {e}");
        }
        if let Err(e) = window.set_mapped(true) {
            tracing::error!("set_mapped failed: {e}");
            return;
        }
        let win = Window::new_x11_window(window);
        self.state.space.map_element(win, (0, 0), true);
        self.state.determine_and_apply_focus();
    }

    fn mapped_override_redirect_window(&mut self, _xwm: XwmId, window: X11Surface) {
        let location = window.geometry().loc;
        let win = Window::new_x11_window(window);
        self.state.space.map_element(win, location, false);
    }

    fn unmapped_window(&mut self, _xwm: XwmId, window: X11Surface) {
        let was_focused = Some(window.window_id()) == self.state.focused_x11_window;

        let elem = self
            .state
            .space
            .elements()
            .find(|e| e.x11_surface().map(|x| x == &window).unwrap_or(false))
            .cloned();

        if let Some(elem) = elem {
            self.state.space.unmap_elem(&elem);
        }

        if !window.is_override_redirect() {
            let _ = window.set_mapped(false);
        }

        if was_focused {
            self.state.focused_x11_window = None;
            self.state.determine_and_apply_focus();
        }
    }

    fn destroyed_window(&mut self, _xwm: XwmId, _window: X11Surface) {}

    fn configure_request(
        &mut self,
        _xwm: XwmId,
        window: X11Surface,
        _x: Option<i32>,
        _y: Option<i32>,
        w: Option<u32>,
        h: Option<u32>,
        _reorder: Option<Reorder>,
    ) {
        // Honor size requests within reason but always keep position at (0,0).
        let mut geo = window.geometry();
        if let Some(w) = w {
            geo.size.w = w as i32;
        }
        if let Some(h) = h {
            geo.size.h = h as i32;
        }
        let _ = window.configure(geo);
    }

    fn configure_notify(
        &mut self,
        _xwm: XwmId,
        window: X11Surface,
        geometry: Rectangle<i32, Logical>,
        _above: Option<u32>,
    ) {
        let target_elem = self
            .state
            .space
            .elements()
            .find(|e| e.x11_surface().map(|x| x == &window).unwrap_or(false))
            .cloned();

        if let Some(elem) = target_elem {
            self.state.space.map_element(elem, geometry.loc, false);
        }
    }

    fn property_notify(&mut self, _xwm: XwmId, _window: X11Surface, property: WmWindowProperty) {
        // Only recalculate focus when the window class changes (steam_app_* detection).
        if matches!(property, WmWindowProperty::Class) {
            self.state.determine_and_apply_focus();
        }
    }

    fn resize_request(&mut self, _: XwmId, _: X11Surface, _: u32, _: ResizeEdge) {}
    fn move_request(&mut self, _: XwmId, _: X11Surface, _: u32) {}
}

// ===========================================================================
// XwmHandler stub on NescopeState
//
// `delegate_xwayland_shell!(NescopeState)` generates Dispatch impls with a
// `NescopeState: XwmHandler` bound.  Only `xwm_state()` is ever called on
// this path (surface association).  Real WM logic lives in the CalloopData impl.
// ===========================================================================

impl XwmHandler for NescopeState {
    fn xwm_state(&mut self, _xwm: XwmId) -> &mut X11Wm {
        self.xwm.as_mut().expect("XWM not initialized")
    }
    fn new_window(&mut self, _: XwmId, _: X11Surface) {}
    fn new_override_redirect_window(&mut self, _: XwmId, _: X11Surface) {}
    fn map_window_request(&mut self, _: XwmId, _: X11Surface) {}
    fn mapped_override_redirect_window(&mut self, _: XwmId, _: X11Surface) {}
    fn unmapped_window(&mut self, _: XwmId, _: X11Surface) {}
    fn destroyed_window(&mut self, _: XwmId, _: X11Surface) {}
    fn configure_request(
        &mut self,
        _: XwmId,
        _: X11Surface,
        _: Option<i32>,
        _: Option<i32>,
        _: Option<u32>,
        _: Option<u32>,
        _: Option<Reorder>,
    ) {
    }
    fn configure_notify(
        &mut self,
        _: XwmId,
        _: X11Surface,
        _: Rectangle<i32, Logical>,
        _: Option<u32>,
    ) {
    }
    fn property_notify(&mut self, _: XwmId, _: X11Surface, _: WmWindowProperty) {}
    fn resize_request(&mut self, _: XwmId, _: X11Surface, _: u32, _: ResizeEdge) {}
    fn move_request(&mut self, _: XwmId, _: X11Surface, _: u32) {}
}

// ===========================================================================
// Delegate macros
// ===========================================================================

smithay::delegate_compositor!(NescopeState);
smithay::delegate_dmabuf!(NescopeState);
smithay::delegate_shm!(NescopeState);
smithay::delegate_xdg_shell!(NescopeState);
smithay::delegate_seat!(NescopeState);
smithay::delegate_data_device!(NescopeState);
smithay::delegate_output!(NescopeState);
smithay::delegate_relative_pointer!(NescopeState);
smithay::delegate_pointer_constraints!(NescopeState);
smithay::delegate_xwayland_shell!(NescopeState);
smithay::delegate_viewporter!(NescopeState);
smithay::delegate_presentation!(NescopeState);
