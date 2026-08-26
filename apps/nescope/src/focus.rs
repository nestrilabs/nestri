//! Keyboard and pointer focus target types for the compositor.
//!
//! Smithay's `SeatHandler::KeyboardFocus` / `PointerFocus` types determine how
//! keyboard and pointer events are dispatched.  For X11 windows (via XWayland)
//! focus must go through the `X11Surface` implementation — this calls
//! `XSetInputFocus` (keyboard) or translates Wayland pointer events back to
//! X11 pointer events, which X11 clients require.
//!
//! The `ProxiedX11` variant handles the narrow window between when a game's
//! X11 window is mapped and when its `wl_surface` becomes available.  We
//! route events through any other XWayland surface so that `wl_keyboard` /
//! `wl_pointer` delivery still reaches the XWayland process; XWayland then
//! forwards the events to whichever X11 window holds X11 focus.

use std::borrow::Cow;

use smithay::backend::input::KeyState;
use smithay::desktop::{Window, WindowSurface};
use smithay::input::Seat;
use smithay::input::keyboard::{KeyboardTarget, KeysymHandle, ModifiersState};
use smithay::input::pointer::{
    AxisFrame, ButtonEvent, MotionEvent, PointerTarget, RelativeMotionEvent,
};
use smithay::reexports::wayland_server::protocol::wl_surface::WlSurface;
use smithay::utils::{IsAlive, Serial};
use smithay::wayland::seat::WaylandFocus;

use crate::state::NescopeState;

/// Focus target for keyboard and pointer input.
///
/// Wraps a [`Window`] and dispatches keyboard/pointer events to the correct
/// underlying surface type (Wayland toplevel or X11 surface).
#[derive(Debug, Clone, PartialEq)]
pub enum KeyboardFocusTarget {
    /// A normal Wayland or X11 window with a live `wl_surface`.
    Window(Window),
    /// An X11 window whose `wl_surface` is not yet available (e.g. the
    /// gamescope WSI bypass creates a raw VkSurface before XWayland gets a
    /// chance to create a `wl_surface`).  Events are proxied through
    /// a different XWayland surface so that delivery still reaches the
    /// XWayland client.
    ProxiedX11 {
        window: Window,
        proxy_surface: WlSurface,
    },
}

impl IsAlive for KeyboardFocusTarget {
    #[inline]
    fn alive(&self) -> bool {
        match self {
            Self::Window(w) => w.alive(),
            Self::ProxiedX11 { window, .. } => window.alive(),
        }
    }
}

impl WaylandFocus for KeyboardFocusTarget {
    #[inline]
    fn wl_surface(&self) -> Option<Cow<'_, WlSurface>> {
        match self {
            Self::Window(w) => w.wl_surface(),
            Self::ProxiedX11 { proxy_surface, .. } => Some(Cow::Borrowed(proxy_surface)),
        }
    }
}

impl From<Window> for KeyboardFocusTarget {
    #[inline]
    fn from(w: Window) -> Self {
        Self::Window(w)
    }
}

impl KeyboardTarget<NescopeState> for KeyboardFocusTarget {
    fn enter(
        &self,
        seat: &Seat<NescopeState>,
        data: &mut NescopeState,
        keys: Vec<KeysymHandle<'_>>,
        serial: Serial,
    ) {
        match self {
            Self::Window(w) => match w.underlying_surface() {
                WindowSurface::Wayland(w) => {
                    KeyboardTarget::enter(w.wl_surface(), seat, data, keys, serial)
                }
                WindowSurface::X11(s) => KeyboardTarget::enter(s, seat, data, keys, serial),
            },
            Self::ProxiedX11 { proxy_surface, .. } => {
                KeyboardTarget::enter(proxy_surface, seat, data, keys, serial)
            }
        }
    }

    fn leave(&self, seat: &Seat<NescopeState>, data: &mut NescopeState, serial: Serial) {
        match self {
            Self::Window(w) => match w.underlying_surface() {
                WindowSurface::Wayland(w) => {
                    KeyboardTarget::leave(w.wl_surface(), seat, data, serial)
                }
                WindowSurface::X11(s) => KeyboardTarget::leave(s, seat, data, serial),
            },
            Self::ProxiedX11 { proxy_surface, .. } => {
                KeyboardTarget::leave(proxy_surface, seat, data, serial)
            }
        }
    }

    fn key(
        &self,
        seat: &Seat<NescopeState>,
        data: &mut NescopeState,
        key: KeysymHandle<'_>,
        state: KeyState,
        serial: Serial,
        time: u32,
    ) {
        match self {
            Self::Window(w) => match w.underlying_surface() {
                WindowSurface::Wayland(w) => {
                    KeyboardTarget::key(w.wl_surface(), seat, data, key, state, serial, time)
                }
                WindowSurface::X11(s) => {
                    KeyboardTarget::key(s, seat, data, key, state, serial, time)
                }
            },
            Self::ProxiedX11 { proxy_surface, .. } => {
                KeyboardTarget::key(proxy_surface, seat, data, key, state, serial, time)
            }
        }
    }

    fn modifiers(
        &self,
        seat: &Seat<NescopeState>,
        data: &mut NescopeState,
        modifiers: ModifiersState,
        serial: Serial,
    ) {
        match self {
            Self::Window(w) => match w.underlying_surface() {
                WindowSurface::Wayland(w) => {
                    KeyboardTarget::modifiers(w.wl_surface(), seat, data, modifiers, serial)
                }
                WindowSurface::X11(s) => {
                    KeyboardTarget::modifiers(s, seat, data, modifiers, serial)
                }
            },
            Self::ProxiedX11 { proxy_surface, .. } => {
                KeyboardTarget::modifiers(proxy_surface, seat, data, modifiers, serial)
            }
        }
    }
}

impl PointerTarget<NescopeState> for KeyboardFocusTarget {
    fn enter(
        &self,
        seat: &Seat<NescopeState>,
        data: &mut NescopeState,
        event: &MotionEvent,
    ) {
        match self {
            Self::Window(w) => match w.underlying_surface() {
                WindowSurface::Wayland(w) => {
                    PointerTarget::enter(w.wl_surface(), seat, data, event)
                }
                WindowSurface::X11(s) => PointerTarget::enter(s, seat, data, event),
            },
            Self::ProxiedX11 { proxy_surface, .. } => {
                PointerTarget::enter(proxy_surface, seat, data, event)
            }
        }
    }

    fn motion(
        &self,
        seat: &Seat<NescopeState>,
        data: &mut NescopeState,
        event: &MotionEvent,
    ) {
        match self {
            Self::Window(w) => match w.underlying_surface() {
                WindowSurface::Wayland(w) => {
                    PointerTarget::motion(w.wl_surface(), seat, data, event)
                }
                WindowSurface::X11(s) => PointerTarget::motion(s, seat, data, event),
            },
            Self::ProxiedX11 { proxy_surface, .. } => {
                PointerTarget::motion(proxy_surface, seat, data, event)
            }
        }
    }

    fn relative_motion(
        &self,
        seat: &Seat<NescopeState>,
        data: &mut NescopeState,
        event: &RelativeMotionEvent,
    ) {
        match self {
            Self::Window(w) => match w.underlying_surface() {
                WindowSurface::Wayland(w) => {
                    PointerTarget::relative_motion(w.wl_surface(), seat, data, event)
                }
                WindowSurface::X11(s) => {
                    PointerTarget::relative_motion(s, seat, data, event)
                }
            },
            Self::ProxiedX11 { proxy_surface, .. } => {
                PointerTarget::relative_motion(proxy_surface, seat, data, event)
            }
        }
    }

    fn button(
        &self,
        seat: &Seat<NescopeState>,
        data: &mut NescopeState,
        event: &ButtonEvent,
    ) {
        match self {
            Self::Window(w) => match w.underlying_surface() {
                WindowSurface::Wayland(w) => {
                    PointerTarget::button(w.wl_surface(), seat, data, event)
                }
                WindowSurface::X11(s) => PointerTarget::button(s, seat, data, event),
            },
            Self::ProxiedX11 { proxy_surface, .. } => {
                PointerTarget::button(proxy_surface, seat, data, event)
            }
        }
    }

    fn axis(
        &self,
        seat: &Seat<NescopeState>,
        data: &mut NescopeState,
        frame: AxisFrame,
    ) {
        match self {
            Self::Window(w) => match w.underlying_surface() {
                WindowSurface::Wayland(w) => {
                    PointerTarget::axis(w.wl_surface(), seat, data, frame)
                }
                WindowSurface::X11(s) => PointerTarget::axis(s, seat, data, frame),
            },
            Self::ProxiedX11 { proxy_surface, .. } => {
                PointerTarget::axis(proxy_surface, seat, data, frame)
            }
        }
    }

    fn leave(
        &self,
        seat: &Seat<NescopeState>,
        data: &mut NescopeState,
        serial: Serial,
        time: u32,
    ) {
        match self {
            Self::Window(w) => match w.underlying_surface() {
                WindowSurface::Wayland(w) => {
                    PointerTarget::leave(w.wl_surface(), seat, data, serial, time)
                }
                WindowSurface::X11(s) => PointerTarget::leave(s, seat, data, serial, time),
            },
            Self::ProxiedX11 { proxy_surface, .. } => {
                PointerTarget::leave(proxy_surface, seat, data, serial, time)
            }
        }
    }

    fn gesture_swipe_begin(&self, _seat: &Seat<NescopeState>, _data: &mut NescopeState, _event: &smithay::input::pointer::GestureSwipeBeginEvent) {}
    fn gesture_swipe_update(&self, _seat: &Seat<NescopeState>, _data: &mut NescopeState, _event: &smithay::input::pointer::GestureSwipeUpdateEvent) {}
    fn gesture_swipe_end(&self, _seat: &Seat<NescopeState>, _data: &mut NescopeState, _event: &smithay::input::pointer::GestureSwipeEndEvent) {}
    fn gesture_pinch_begin(&self, _seat: &Seat<NescopeState>, _data: &mut NescopeState, _event: &smithay::input::pointer::GesturePinchBeginEvent) {}
    fn gesture_pinch_update(&self, _seat: &Seat<NescopeState>, _data: &mut NescopeState, _event: &smithay::input::pointer::GesturePinchUpdateEvent) {}
    fn gesture_pinch_end(&self, _seat: &Seat<NescopeState>, _data: &mut NescopeState, _event: &smithay::input::pointer::GesturePinchEndEvent) {}
    fn gesture_hold_begin(&self, _seat: &Seat<NescopeState>, _data: &mut NescopeState, _event: &smithay::input::pointer::GestureHoldBeginEvent) {}
    fn gesture_hold_end(&self, _seat: &Seat<NescopeState>, _data: &mut NescopeState, _event: &smithay::input::pointer::GestureHoldEndEvent) {}

    fn frame(&self, seat: &Seat<NescopeState>, data: &mut NescopeState) {
        match self {
            Self::Window(w) => match w.underlying_surface() {
                WindowSurface::Wayland(w) => {
                    PointerTarget::frame(w.wl_surface(), seat, data)
                }
                WindowSurface::X11(s) => PointerTarget::frame(s, seat, data),
            },
            Self::ProxiedX11 { proxy_surface, .. } => {
                PointerTarget::frame(proxy_surface, seat, data)
            }
        }
    }
}
