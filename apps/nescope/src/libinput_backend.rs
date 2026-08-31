//! libinput backend — monitors real and virtual (inputtino) input devices
//! via udev and feeds keyboard/pointer events into the Smithay seat.

use std::os::unix::io::{AsRawFd, OwnedFd};
use std::path::Path;

use smithay::reexports::input::{
    self as libinput,
    event::{self, keyboard::KeyboardEventTrait, pointer::PointerScrollEvent},
};

use crate::input::{InputEvent, process_input};
use crate::state::NescopeState;

// Use the input crate's Axis (not smithay's) for scroll methods
use libinput::event::pointer::Axis as InputAxis;

struct SessionInterface;
impl libinput::LibinputInterface for SessionInterface {
    fn open_restricted(&mut self, path: &Path, flags: i32) -> Result<OwnedFd, i32> {
        smithay::reexports::rustix::fs::open(
            path,
            smithay::reexports::rustix::fs::OFlags::from_bits_truncate(flags as u32),
            smithay::reexports::rustix::fs::Mode::empty(),
        )
        .map_err(|e| e.raw_os_error())
    }

    fn close_restricted(&mut self, fd: OwnedFd) {
        drop(fd);
    }
}

/// Create a new libinput context with udev monitoring.
pub fn create_libinput() -> Result<libinput::Libinput, Box<dyn std::error::Error>> {
    let mut ctx = libinput::Libinput::new_with_udev(SessionInterface);
    ctx.udev_assign_seat("seat0")
        .map_err(|()| std::io::Error::new(std::io::ErrorKind::Other, "udev_assign_seat failed"))?;
    tracing::info!("libinput context created, fd={}", ctx.as_raw_fd());
    Ok(ctx)
}

/// Dispatch pending libinput events and inject them into the Smithay seat.
pub fn dispatch_libinput(ctx: &mut libinput::Libinput, state: &mut NescopeState) {
    let mut event_count = 0u32;
    if let Err(e) = ctx.dispatch() {
        tracing::error!("libinput dispatch error: {e}");
        return;
    }

    for event in &mut *ctx {
        event_count += 1;
        match event {
            libinput::Event::Keyboard(kev) => {
                let keycode = kev.key();
                let ev = match kev.key_state() {
                    event::keyboard::KeyState::Pressed => InputEvent::KeyDown { keycode },
                    event::keyboard::KeyState::Released => InputEvent::KeyUp { keycode },
                };
                process_input(ev, state);
            }
            libinput::Event::Pointer(pev) => {
                match pev {
                    event::PointerEvent::Motion(ev) => {
                        process_input(
                            InputEvent::MouseMoveRelative {
                                dx: ev.dx(),
                                dy: ev.dy(),
                            },
                            state,
                        );
                    }
                    event::PointerEvent::MotionAbsolute(ev) => {
                        let size = state
                            .output
                            .current_mode()
                            .map(|m| m.size)
                            .unwrap_or((state.width as i32, state.height as i32).into());
                        process_input(
                            InputEvent::MouseMoveAbsolute {
                                x: ev.absolute_x_transformed(size.w as u32),
                                y: ev.absolute_y_transformed(size.h as u32),
                                screen_width: size.w as f64,
                                screen_height: size.h as f64,
                            },
                            state,
                        );
                    }
                    event::PointerEvent::Button(ev) => {
                        let button = ev.button();
                        let down =
                            matches!(ev.button_state(), event::pointer::ButtonState::Pressed);
                        let ev = if down {
                            InputEvent::MouseButtonDown { button }
                        } else {
                            InputEvent::MouseButtonUp { button }
                        };
                        process_input(ev, state);
                    }
                    event::PointerEvent::ScrollWheel(ev) => handle_scroll(ev, state),
                    event::PointerEvent::ScrollFinger(ev) => handle_scroll(ev, state),
                    event::PointerEvent::ScrollContinuous(ev) => handle_scroll(ev, state),
                    _ => {} // PointerAxis deprecated, covered above
                }
                state.last_pointer_activity = std::time::Instant::now();
            }
            _ => {}
        }
    }
    if event_count > 0 {
        tracing::trace!("libinput: dispatched {event_count} events");
    }
}

fn handle_scroll<SE: PointerScrollEvent>(sev: SE, state: &mut NescopeState) {
    if sev.has_axis(InputAxis::Vertical) {
        let amount = sev.scroll_value(InputAxis::Vertical);
        process_input(InputEvent::ScrollVertical { amount }, state);
    }
    if sev.has_axis(InputAxis::Horizontal) {
        let amount = sev.scroll_value(InputAxis::Horizontal);
        process_input(InputEvent::ScrollHorizontal { amount }, state);
    }
}
