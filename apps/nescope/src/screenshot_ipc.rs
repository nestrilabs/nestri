//! Reading a window's pixels out, for things that are not the game.
//!
//! nescope does not render. It is a headless compositor whose job is to make a
//! game happy so `nescapture` can pull Vulkan frames straight off it — the
//! frames never pass through here at all.
//!
//! That works for games and not for anything else. A Steam client showing a
//! login QR is not a Vulkan application, so nothing captures it, and the person
//! who needs to scan that QR has no way to see it.
//!
//! This is the way out: a client surface's committed buffer, read directly and
//! handed to whoever asked. No rendering, no compositing, no swapchain.
//!
//! # Only shm buffers can be read
//!
//! nescope accepts dmabuf and never imports it — see `DmabufHandler` — because
//! nothing here needs the pixels. So a surface backed by dmabuf cannot be read
//! by this path, and [`Status::Unreadable`] says so rather than returning
//! something wrong.
//!
//! In practice that makes **software rendering a requirement, not a
//! preference**, for anything meant to be captured this way. A Steam client
//! started with its browser GPU-accelerated will hand over dmabuf and be
//! invisible here.
//!
//! # Shape
//!
//! nescope dials out, exactly as [`crate::input_ipc`] does, so whatever
//! supervises it is the listener and there is no race against a socket that
//! does not exist yet. One byte in, one framed image out:
//!
//! ```text
//!   ->  [u8 request]                                  0x01 = capture
//!   <-  [u8 status][u32 LE width][u32 LE height][RGBA…]
//! ```
//!
//! Width and height are zero unless the status is [`Status::Ok`].

use std::io::{self, Read, Write};
use std::os::unix::io::{AsFd, BorrowedFd};
use std::os::unix::net::UnixStream;

pub use crate::screenshot_wire::{Capture, Status};
pub use crate::screenshot_wire::{REQUEST_CAPTURE, encode_reply};

use smithay::desktop::{Space, Window};
use smithay::reexports::wayland_server::protocol::wl_buffer;
use smithay::wayland::compositor::{BufferAssignment, SurfaceAttributes, with_states};
use smithay::wayland::seat::WaylandFocus;
use smithay::wayland::shm::with_buffer_contents;

/// Read the pixels of the frontmost mapped window.
///
/// Deliberately the *frontmost* rather than a composite of everything: nescope
/// does not composite, and inventing a stacking order here would be guessing at
/// something no one has asked for. One window is what a Steam login screen is.
pub fn capture_frontmost(space: &Space<Window>) -> (Status, Option<Capture>) {
    // Front to back rather than the frontmost alone. A client often maps a
    // small helper window over its real one -- a splash, a tooltip, an
    // override-redirect popup -- and reading only the topmost would report
    // nothing readable while the window somebody wants is sitting right
    // behind it.
    let mut saw_window = false;
    let mut saw_gpu_buffer = false;
    for window in space.elements().rev() {
        saw_window = true;
        let Some(surface) = window.wl_surface() else {
            continue;
        };
        let buffer = with_states(&surface, |data| {
            let mut attrs = data.cached_state.get::<SurfaceAttributes>();
            match attrs.current().buffer {
                Some(BufferAssignment::NewBuffer(ref buf)) => Some(buf.clone()),
                _ => None,
            }
        });
        let Some(buffer) = buffer else {
            continue;
        };

        // `with_buffer_contents` fails for anything that is not shm, which is
        // how a GPU-rendered client is told apart from one that has not drawn.
        match read_shm(&buffer) {
            Ok(Some(capture)) => return (Status::Ok, Some(capture)),
            Ok(None) => continue,
            // Not shm. Try the GPU: importing the dmabuf and copying it back
            // is the only way to see a client that renders on hardware, which
            // under XWayland is every client, since smithay spawns it with
            // glamor enabled and no way to ask for otherwise.
            Err(()) => {
                saw_gpu_buffer = true;
                match crate::gpu_readback::from_wl_buffer(&buffer) {
                    Some(capture) => return (Status::Ok, Some(capture)),
                    // Stepped over rather than given up on: a GPU-backed
                    // splash often sits in front of a readable window.
                    None => continue,
                }
            }
        }
    }

    // Ordered by which answer is most actionable. A readable window anywhere
    // wins; failing that, `Unreadable` now means the GPU path was tried and
    // could not do it either -- a real failure rather than a limitation --
    // and it outranks "nothing has drawn" because it will not resolve by
    // waiting.
    match (saw_gpu_buffer, saw_window) {
        (true, _) => (Status::Unreadable, None),
        (false, true) => (Status::NoBuffer, None),
        (false, false) => (Status::NoSurface, None),
    }
}

/// Copy an shm buffer out as RGBA. `Err` means it is not shm at all.
fn read_shm(buffer: &wl_buffer::WlBuffer) -> Result<Option<Capture>, ()> {
    with_buffer_contents(buffer, |ptr, _len, data| {
        let width = data.width.max(0) as usize;
        let height = data.height.max(0) as usize;
        let stride = data.stride.max(0) as usize;
        if width == 0 || height == 0 {
            return None;
        }
        let is_xrgb =
            data.format == smithay::reexports::wayland_server::protocol::wl_shm::Format::Xrgb8888;
        let mut rgba = vec![0u8; width * height * 4];
        for row in 0..height {
            // SAFETY: the compositor guarantees the pool covers
            // offset + stride * height, and each row copy stays inside it.
            unsafe {
                std::ptr::copy_nonoverlapping(
                    ptr.offset(data.offset as isize).add(row * stride),
                    rgba.as_mut_ptr().add(row * width * 4),
                    width * 4,
                );
            }
        }
        if is_xrgb {
            // The alpha byte is undefined in XRGB, and decoding a QR from a
            // fully transparent image finds nothing.
            for px in rgba.chunks_exact_mut(4) {
                px[3] = 255;
            }
        }
        Some(Capture {
            width: width as u32,
            height: height as u32,
            rgba,
        })
    })
    .map_err(|_| ())
}

/// Write one reply to an already-cloned socket half.
pub fn write_reply_to(
    stream: &mut UnixStream,
    status: Status,
    capture: Option<&Capture>,
) -> io::Result<()> {
    let bytes = encode_reply(status, capture);
    // Blocking for the write: a capture is megabytes and the reader is waiting
    // for it, so a partial non-blocking write would have to be buffered and
    // re-driven for no benefit.
    stream.set_nonblocking(false)?;
    let result = stream.write_all(&bytes);
    let _ = stream.set_nonblocking(true);
    result
}

/// The socket nescope reads requests from and writes images to.
pub struct ScreenshotIpcSource {
    stream: UnixStream,
}

impl ScreenshotIpcSource {
    pub fn connect(path: &str) -> io::Result<Self> {
        let stream = UnixStream::connect(path)?;
        stream.set_nonblocking(true)?;
        Ok(Self { stream })
    }

    /// A writable handle to the same socket.
    ///
    /// The source itself is moved into the event loop, so replies go out
    /// through a clone — the same split `input_ipc` uses for its write side.
    pub fn try_clone_writer(&self) -> io::Result<UnixStream> {
        self.stream.try_clone()
    }
}

impl AsFd for ScreenshotIpcSource {
    fn as_fd(&self) -> BorrowedFd<'_> {
        self.stream.as_fd()
    }
}

impl calloop::EventSource for ScreenshotIpcSource {
    /// One request byte per event.
    type Event = u8;
    type Metadata = ();
    type Ret = ();
    type Error = io::Error;

    fn process_events<F>(
        &mut self,
        _readiness: calloop::Readiness,
        _token: calloop::Token,
        mut callback: F,
    ) -> Result<calloop::PostAction, Self::Error>
    where
        F: FnMut(Self::Event, &mut Self::Metadata),
    {
        let mut tmp = [0u8; 64];
        loop {
            match self.stream.read(&mut tmp) {
                Ok(0) => return Ok(calloop::PostAction::Remove),
                Ok(n) => {
                    for byte in &tmp[..n] {
                        callback(*byte, &mut ());
                    }
                }
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => break,
                Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                Err(e) => return Err(e),
            }
        }
        Ok(calloop::PostAction::Continue)
    }

    fn register(
        &mut self,
        poll: &mut calloop::Poll,
        factory: &mut calloop::TokenFactory,
    ) -> calloop::Result<()> {
        // SAFETY: the fd stays owned by this source for as long as it is
        // registered, and is unregistered before the stream is dropped —
        // the same contract `input_ipc` relies on.
        unsafe {
            poll.register(
                self.stream.as_fd(),
                calloop::Interest::READ,
                calloop::Mode::Level,
                factory.token(),
            )
        }
    }

    fn reregister(
        &mut self,
        poll: &mut calloop::Poll,
        factory: &mut calloop::TokenFactory,
    ) -> calloop::Result<()> {
        poll.reregister(
            self.stream.as_fd(),
            calloop::Interest::READ,
            calloop::Mode::Level,
            factory.token(),
        )
    }

    fn unregister(&mut self, poll: &mut calloop::Poll) -> calloop::Result<()> {
        poll.unregister(self.stream.as_fd())
    }
}
