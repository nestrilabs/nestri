//! Programmatic input injection into the Smithay seat.
//!
//! Unlike the proxy version, nescope does **not** receive input from a host
//! compositor.  Instead callers (e.g. a streaming server, a test harness, or
//! a control socket handler) send [`InputEvent`]s over a
//! [`calloop::channel::Channel`] that is registered in the event loop.
//!
//! # Usage
//!
//! ```ignore
//! // Obtained when calling NescopeState::new()
//! let input_tx: calloop::channel::Sender<InputEvent> = ...;
//!
//! // From any thread:
//! input_tx.send(InputEvent::KeyDown { keycode: 28 }).unwrap(); // evdev KEY_ENTER
//! ```
//!
//! Keycodes follow the Linux evdev convention (the same as used in
//! Moonshine's `CompositorInputEvent`).  The compositor adds 8 to convert
//! them to X11/xkbcommon keycodes before passing them to Smithay.

#![allow(dead_code)]
use smithay::backend::input::{Axis, AxisSource, ButtonState, KeyState};
use smithay::input::keyboard::{FilterResult, Keycode};
use smithay::input::pointer::{AxisFrame, ButtonEvent, MotionEvent, RelativeMotionEvent};
use smithay::utils::{Logical, Point, SERIAL_COUNTER};
use smithay::wayland::pointer_constraints::{PointerConstraint, with_pointer_constraint};
use smithay::wayland::seat::WaylandFocus;

use nesprotocol::input::{self as nestri_input, DecodedInput};

use crate::focus::KeyboardFocusTarget;
use crate::state::NescopeState;

// ── Wire protocol constants (mirrors nestri-protocol/src/input.rs) ──
const WIRE_INPUT_KEY: u8 = 0;
const WIRE_INPUT_MOUSE_MOVE: u8 = 1;
const WIRE_INPUT_MOUSE_BUTTON: u8 = 2;
const WIRE_INPUT_MOUSE_WHEEL: u8 = 3;
const WIRE_KEY_DOWN: u8 = 1;
const WIRE_BTN_LEFT: u32 = 0x110; // BTN_LEFT
const WIRE_BTN_MIDDLE: u32 = 0x112; // BTN_MIDDLE
const WIRE_BTN_RIGHT: u32 = 0x111; // BTN_RIGHT

// ---------------------------------------------------------------------------
// Public event type
// ---------------------------------------------------------------------------

/// Events that can be injected into the compositor seat programmatically.
///
/// All coordinates are in logical (output-space) pixels.
/// Keycodes are Linux evdev keycodes (NOT X11 keycodes).
#[derive(Debug, Clone)]
pub enum InputEvent {
    // ── Keyboard ─────────────────────────────────────────────────────────
    /// Key pressed.  `keycode` is a Linux evdev keycode (8 will be added
    /// internally to produce an X11 keycode).
    KeyDown { keycode: u32 },
    /// Key released.
    KeyUp { keycode: u32 },

    // ── Pointer — absolute ───────────────────────────────────────────────
    /// Absolute pointer position.  Coordinates are in the Moonlight client's
    /// coordinate space; they are scaled to the compositor output.
    MouseMoveAbsolute {
        x: f64,
        y: f64,
        /// Client screen width used for coordinate mapping.
        screen_width: f64,
        /// Client screen height used for coordinate mapping.
        screen_height: f64,
    },

    // ── Pointer — relative ───────────────────────────────────────────────
    /// Relative pointer delta in logical pixels.
    MouseMoveRelative { dx: f64, dy: f64 },

    // ── Pointer — buttons ────────────────────────────────────────────────
    /// Mouse button pressed.  `button` is a Linux button code
    /// (e.g. `BTN_LEFT = 0x110`).
    MouseButtonDown { button: u32 },
    /// Mouse button released.
    MouseButtonUp { button: u32 },

    // ── Pointer — scroll ─────────────────────────────────────────────────
    /// Vertical scroll.  Positive = up, negative = down.
    ScrollVertical { amount: f64 },
    /// Horizontal scroll.  Positive = right, negative = left.
    ScrollHorizontal { amount: f64 },
}

// ---------------------------------------------------------------------------
// Injection
// ---------------------------------------------------------------------------

/// Process a single [`InputEvent`] injected from outside the compositor.
///
/// Called from the calloop idle callback after draining the input channel.
pub fn process_input(event: InputEvent, state: &mut NescopeState) {
    let serial = SERIAL_COUNTER.next_serial();
    let time = state.clock.now().as_millis();

    // Track pointer activity for cursor inactivity timer.
    match event {
        InputEvent::KeyDown { .. } | InputEvent::KeyUp { .. } => {}
        _ => state.last_pointer_activity = std::time::Instant::now(),
    }

    // One-time X11 focus reset when the gamescope WSI surface is active.
    if state.override_surface.is_some() && state.x11_focus_needs_reset {
        state.sync_x11_focus();
    }

    match event {
        InputEvent::KeyDown { keycode } => {
            if let Some(kb) = state.seat.get_keyboard() {
                // Auto-focus the topmost window if nothing has focus yet.
                if kb.current_focus().is_none() {
                    state.determine_and_apply_focus();
                }
                // evdev → X11/xkbcommon keycode: add 8.
                kb.input::<(), _>(
                    state,
                    Keycode::from(keycode + 8),
                    KeyState::Pressed,
                    serial,
                    time,
                    |_, _, _| FilterResult::Forward,
                );
            }
        }

        InputEvent::KeyUp { keycode } => {
            if let Some(kb) = state.seat.get_keyboard() {
                if kb.current_focus().is_none() {
                    state.determine_and_apply_focus();
                }
                kb.input::<(), _>(
                    state,
                    Keycode::from(keycode + 8),
                    KeyState::Released,
                    serial,
                    time,
                    |_, _, _| FilterResult::Forward,
                );
            }
        }

        InputEvent::MouseMoveAbsolute {
            x,
            y,
            screen_width,
            screen_height,
        } => {
            let output_size = state
                .output
                .current_mode()
                .map(|m| m.size)
                .unwrap_or((state.width as i32, state.height as i32).into());

            let new_x = if screen_width > 0.0 {
                x / screen_width * output_size.w as f64
            } else {
                x
            };
            let new_y = if screen_height > 0.0 {
                y / screen_height * output_size.h as f64
            } else {
                y
            };

            state.cursor_position = Point::from((new_x, new_y));
            clamp_cursor(state);

            let under = surface_under(state);
            let pointer = state.seat.get_pointer().unwrap();
            pointer.motion(
                state,
                under,
                &MotionEvent {
                    location: state.cursor_position,
                    serial,
                    time,
                },
            );
            pointer.frame(state);
        }

        InputEvent::MouseMoveRelative { dx, dy } => {
            if !state.cursor_initialized {
                let size = state
                    .output
                    .current_mode()
                    .map(|m| m.size)
                    .unwrap_or((state.width as i32, state.height as i32).into());
                state.cursor_position = Point::from((size.w as f64 / 2.0, size.h as f64 / 2.0));
                state.cursor_initialized = true;
                tracing::debug!("cursor initialized to center: {:?}", state.cursor_position);
            }

            let delta = Point::from((dx, dy));
            let pointer = state.seat.get_pointer().unwrap();

            // Check for a pointer lock constraint.
            let mut locked = false;
            let under = surface_under(state);
            if let Some((ref target, _)) = under {
                if let Some(surf) = target.wl_surface() {
                    with_pointer_constraint(&surf, &pointer, |c| {
                        if let Some(c) = c {
                            if c.is_active() {
                                if let PointerConstraint::Locked(_) = &*c {
                                    locked = true;
                                }
                            }
                        }
                    });
                }
            }

            pointer.relative_motion(
                state,
                under.clone(),
                &RelativeMotionEvent {
                    delta,
                    delta_unaccel: delta,
                    utime: time as u64,
                },
            );

            state.cursor_position += delta;
            clamp_cursor(state);

            if locked {
                pointer.frame(state);
                return;
            }

            pointer.motion(
                state,
                under.clone(),
                &MotionEvent {
                    location: state.cursor_position,
                    serial,
                    time,
                },
            );
            pointer.frame(state);
        }

        InputEvent::MouseButtonDown { button } => {
            let pointer = state.seat.get_pointer().unwrap();
            pointer.button(
                state,
                &ButtonEvent {
                    serial,
                    time,
                    button,
                    state: ButtonState::Pressed,
                },
            );
            pointer.frame(state);
        }

        InputEvent::MouseButtonUp { button } => {
            let pointer = state.seat.get_pointer().unwrap();
            pointer.button(
                state,
                &ButtonEvent {
                    serial,
                    time,
                    button,
                    state: ButtonState::Released,
                },
            );
            pointer.frame(state);
        }

        InputEvent::ScrollVertical { amount } => {
            let pointer = state.seat.get_pointer().unwrap();
            pointer.axis(
                state,
                AxisFrame::new(time)
                    .source(AxisSource::Wheel)
                    .value(Axis::Vertical, -amount),
            );
            pointer.frame(state);
        }

        InputEvent::ScrollHorizontal { amount } => {
            let pointer = state.seat.get_pointer().unwrap();
            pointer.axis(
                state,
                AxisFrame::new(time)
                    .source(AxisSource::Wheel)
                    .value(Axis::Horizontal, amount),
            );
            pointer.frame(state);
        }
    }
}

// ---------------------------------------------------------------------------
// Wire-protocol decoder
// ---------------------------------------------------------------------------

/// Decode a single input event from the nestri guest-hub wire protocol
/// and convert it to an [`InputEvent`] for the compositor seat.
///
/// Uses the shared [`nesprotocol::input::decode_input_event`] and maps:
/// - Button 0 → `BTN_LEFT` (0x110), 1 → `BTN_MIDDLE` (0x112), 2 → `BTN_RIGHT` (0x111)
/// - Mouse wheel `dy` → `ScrollVertical`
///
/// Returns `None` if the buffer cannot be decoded.
pub fn decode_wire_event(data: &[u8]) -> Option<InputEvent> {
    match nestri_input::decode_input_event(data)? {
        DecodedInput::Key { down, keycode } => Some(if down {
            InputEvent::KeyDown {
                keycode: keycode as u32,
            }
        } else {
            InputEvent::KeyUp {
                keycode: keycode as u32,
            }
        }),
        DecodedInput::MouseMove { dx, dy } => Some(InputEvent::MouseMoveRelative {
            dx: dx as f64,
            dy: dy as f64,
        }),
        DecodedInput::MouseButton { button, down } => {
            let btn = match button {
                0 => 0x110, // BTN_LEFT
                1 => 0x112, // BTN_MIDDLE
                2 => 0x111, // BTN_RIGHT
                _ => return None,
            };
            Some(if down {
                InputEvent::MouseButtonDown { button: btn }
            } else {
                InputEvent::MouseButtonUp { button: btn }
            })
        }
        DecodedInput::MouseWheel { dx: _dx, dy } => {
            Some(InputEvent::ScrollVertical { amount: dy as f64 })
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Clamp the cursor to the output bounds.
fn clamp_cursor(state: &mut NescopeState) {
    let size = state
        .output
        .current_mode()
        .map(|m| m.size)
        .unwrap_or((state.width as i32, state.height as i32).into());
    state.cursor_position.x = state.cursor_position.x.clamp(0.0, (size.w - 1) as f64);
    state.cursor_position.y = state.cursor_position.y.clamp(0.0, (size.h - 1) as f64);
}

/// Find the focused target under the current cursor position.
pub fn surface_under(state: &NescopeState) -> Option<(KeyboardFocusTarget, Point<f64, Logical>)> {
    if state.override_surface.is_some() {
        if let Some(wid) = state.focused_x11_window {
            for window in state.space.elements() {
                if let Some(x11) = window.x11_surface() {
                    if x11.window_id() == wid {
                        let loc = state.space.element_geometry(window)?.loc;
                        return Some((KeyboardFocusTarget::Window(window.clone()), loc.to_f64()));
                    }
                }
            }
        }
        let (window, loc) = state.space.element_under(state.cursor_position)?;
        return Some((KeyboardFocusTarget::Window(window.clone()), loc.to_f64()));
    }

    // Try element_under first
    if let Some((window, loc)) = state.space.element_under(state.cursor_position) {
        return Some((KeyboardFocusTarget::Window(window.clone()), loc.to_f64()));
    }

    // Fallback: use the keyboard-focused window if any window is mapped
    if let Some(w) = state.space.elements().next() {
        if let Some(geo) = state.space.element_geometry(w) {
            return Some((KeyboardFocusTarget::Window(w.clone()), geo.loc.to_f64()));
        }
    }

    None
}
