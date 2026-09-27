//! A HID device made in userspace, through `/dev/uhid`.
//!
//! The kernel treats it as real hardware: a driver binds to it -- hid-generic,
//! for anything not claimed more specifically -- and it gets a hidraw node,
//! which is what Proton reads a controller through when it wants the device
//! itself rather than a gamepad abstraction of it. Reports written here are
//! the device's; everything asked of it comes back out of here to be answered.
//!
//! The ABI is `linux/uhid.h`: every message in either direction is one packed
//! `struct uhid_event`, a type and a union. The layouts below are the kernel's,
//! checked by size at compile time.

use std::fs::OpenOptions;
use std::io::{self, Read, Write};
use std::os::fd::{AsRawFd, RawFd};
use std::os::unix::fs::OpenOptionsExt;
use std::sync::Mutex;

const UHID_DESTROY: u32 = 1;
const UHID_START: u32 = 2;
const UHID_STOP: u32 = 3;
const UHID_OPEN: u32 = 4;
const UHID_CLOSE: u32 = 5;
const UHID_OUTPUT: u32 = 6;
const UHID_GET_REPORT: u32 = 9;
const UHID_GET_REPORT_REPLY: u32 = 10;
const UHID_CREATE2: u32 = 11;
const UHID_INPUT2: u32 = 12;
const UHID_SET_REPORT: u32 = 13;
const UHID_SET_REPORT_REPLY: u32 = 14;

/// `UHID_DATA_MAX`, and also `HID_MAX_DESCRIPTOR_SIZE`: the kernel uses the
/// same number for both.
pub const DATA_MAX: usize = 4096;

/// The largest member of the event union is `uhid_create2_req`.
const CREATE2_LEN: usize = 128 + 64 + 64 + 2 + 2 + 4 * 4 + DATA_MAX;
/// `struct uhid_event`: a `u32` type, then the union.
const EVENT_LEN: usize = 4 + CREATE2_LEN;

const _: () = assert!(EVENT_LEN == 4376);

/// Report kinds, as `uhid` numbers them.
pub const REPORT_FEATURE: u8 = 0;
pub const REPORT_OUTPUT: u8 = 1;
pub const REPORT_INPUT: u8 = 2;

/// What a device in the box was built from.
pub struct Spec<'a> {
    pub name: &'a str,
    pub uniq: &'a str,
    pub bus: u16,
    pub vendor: u16,
    pub product: u16,
    pub version: u16,
    pub country: u8,
    pub descriptor: &'a [u8],
}

/// What the kernel said.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    /// A driver bound. Its nodes follow shortly after, not with this.
    Start,
    Stop,
    /// Something opened a node of it, or the last one closed.
    Open,
    Close,
    /// A report written to the device.
    Output {
        kind: u8,
        data: Vec<u8>,
    },
    /// Something wants a report read from the device, answered by `id`.
    GetReport {
        id: u32,
        number: u8,
        kind: u8,
    },
    /// Something wants a report written to the device, answered by `id`.
    SetReport {
        id: u32,
        number: u8,
        kind: u8,
        data: Vec<u8>,
    },
}

/// A device that exists for as long as this does.
pub struct Device {
    /// Writes are whole events, and several threads may answer requests; one
    /// at a time keeps each event in one piece.
    file: Mutex<std::fs::File>,
    fd: RawFd,
}

fn put_str(buf: &mut [u8], value: &str) {
    // One short of the field, so the kernel always finds a terminator.
    let bytes = value.as_bytes();
    let len = bytes.len().min(buf.len() - 1);
    buf[..len].copy_from_slice(&bytes[..len]);
}

impl Device {
    pub fn create(spec: &Spec<'_>) -> io::Result<Self> {
        if spec.descriptor.is_empty() || spec.descriptor.len() > DATA_MAX {
            return Err(io::Error::other(format!(
                "a report descriptor of {} bytes",
                spec.descriptor.len()
            )));
        }
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .custom_flags(libc::O_NONBLOCK | libc::O_CLOEXEC)
            .open("/dev/uhid")?;
        let fd = file.as_raw_fd();
        let device = Self {
            file: Mutex::new(file),
            fd,
        };

        let mut event = vec![0u8; EVENT_LEN];
        event[..4].copy_from_slice(&UHID_CREATE2.to_ne_bytes());
        let body = &mut event[4..];
        put_str(&mut body[..128], spec.name);
        // `phys` is where a device is attached. This one is attached nowhere
        // real, and saying so is truer than inventing a USB path.
        put_str(&mut body[128..192], "nesgamepad");
        put_str(&mut body[192..256], spec.uniq);
        body[256..258].copy_from_slice(&(spec.descriptor.len() as u16).to_ne_bytes());
        body[258..260].copy_from_slice(&spec.bus.to_ne_bytes());
        body[260..264].copy_from_slice(&u32::from(spec.vendor).to_ne_bytes());
        body[264..268].copy_from_slice(&u32::from(spec.product).to_ne_bytes());
        body[268..272].copy_from_slice(&u32::from(spec.version).to_ne_bytes());
        body[272..276].copy_from_slice(&u32::from(spec.country).to_ne_bytes());
        body[276..276 + spec.descriptor.len()].copy_from_slice(spec.descriptor);
        device.write_event(&event)?;
        Ok(device)
    }

    fn write_event(&self, event: &[u8]) -> io::Result<()> {
        let mut file = self.file.lock().unwrap_or_else(|e| e.into_inner());
        file.write_all(event)
    }

    /// One input report, as the device sent it.
    pub fn input(&self, report: &[u8]) -> io::Result<()> {
        let len = report.len().min(DATA_MAX);
        let mut event = Vec::with_capacity(4 + 2 + len);
        event.extend_from_slice(&UHID_INPUT2.to_ne_bytes());
        event.extend_from_slice(&(len as u16).to_ne_bytes());
        event.extend_from_slice(&report[..len]);
        self.write_event(&event)
    }

    /// Answer a [`Event::GetReport`]. A short event is extended with zeroes
    /// by the kernel, so only what is used is written.
    pub fn get_report_reply(&self, id: u32, err: u16, data: &[u8]) -> io::Result<()> {
        let len = data.len().min(DATA_MAX);
        let mut event = Vec::with_capacity(4 + 8 + len);
        event.extend_from_slice(&UHID_GET_REPORT_REPLY.to_ne_bytes());
        event.extend_from_slice(&id.to_ne_bytes());
        event.extend_from_slice(&err.to_ne_bytes());
        event.extend_from_slice(&(len as u16).to_ne_bytes());
        event.extend_from_slice(&data[..len]);
        self.write_event(&event)
    }

    /// Answer a [`Event::SetReport`].
    pub fn set_report_reply(&self, id: u32, err: u16) -> io::Result<()> {
        let mut event = Vec::with_capacity(10);
        event.extend_from_slice(&UHID_SET_REPORT_REPLY.to_ne_bytes());
        event.extend_from_slice(&id.to_ne_bytes());
        event.extend_from_slice(&err.to_ne_bytes());
        self.write_event(&event)
    }

    /// Everything the kernel has said since the last call.
    pub fn drain(&self) -> io::Result<Vec<Event>> {
        let mut out = Vec::new();
        let mut buf = vec![0u8; EVENT_LEN];
        loop {
            let n = {
                let mut file = self.file.lock().unwrap_or_else(|e| e.into_inner());
                match file.read(&mut buf) {
                    Ok(n) => n,
                    Err(e) if e.kind() == io::ErrorKind::WouldBlock => return Ok(out),
                    Err(e) => return Err(e),
                }
            };
            if n == 0 {
                return Ok(out);
            }
            // The kernel may write short; the rest reads as zero.
            buf[n..].fill(0);
            if let Some(event) = parse(&buf) {
                out.push(event);
            }
        }
    }
}

/// One event, from a buffer at least as long as `struct uhid_event`.
fn parse(buf: &[u8]) -> Option<Event> {
    let kind = u32::from_ne_bytes(buf[..4].try_into().ok()?);
    let body = &buf[4..];
    let u16_at = |i: usize| u16::from_ne_bytes([body[i], body[i + 1]]);
    let u32_at = |i: usize| u32::from_ne_bytes(body[i..i + 4].try_into().unwrap());
    Some(match kind {
        UHID_START => Event::Start,
        UHID_STOP => Event::Stop,
        UHID_OPEN => Event::Open,
        UHID_CLOSE => Event::Close,
        // uhid_output_req: data[4096], size u16, rtype u8
        UHID_OUTPUT => {
            let size = (u16_at(DATA_MAX) as usize).min(DATA_MAX);
            Event::Output {
                kind: body[DATA_MAX + 2],
                data: body[..size].to_vec(),
            }
        }
        // uhid_get_report_req: id u32, rnum u8, rtype u8
        UHID_GET_REPORT => Event::GetReport {
            id: u32_at(0),
            number: body[4],
            kind: body[5],
        },
        // uhid_set_report_req: id u32, rnum u8, rtype u8, size u16, data
        UHID_SET_REPORT => {
            let size = (u16_at(6) as usize).min(DATA_MAX);
            Event::SetReport {
                id: u32_at(0),
                number: body[4],
                kind: body[5],
                data: body[8..8 + size].to_vec(),
            }
        }
        _ => return None,
    })
}

impl AsRawFd for Device {
    fn as_raw_fd(&self) -> RawFd {
        self.fd
    }
}

impl Device {
    /// Remove the device now. Closing the descriptor would too, but only when
    /// the last holder of it closes.
    pub fn destroy(&self) {
        let _ = self.write_event(&UHID_DESTROY.to_ne_bytes());
    }
}

impl Drop for Device {
    fn drop(&mut self) {
        self.destroy();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(kind: u32, body: &[u8]) -> Vec<u8> {
        let mut buf = vec![0u8; EVENT_LEN];
        buf[..4].copy_from_slice(&kind.to_ne_bytes());
        buf[4..4 + body.len()].copy_from_slice(body);
        buf
    }

    #[test]
    fn an_output_report_is_read_from_the_end_of_its_buffer() {
        // The size and kind come *after* the 4096-byte data field, which is
        // the easiest part of this ABI to get wrong.
        let mut body = vec![0u8; DATA_MAX + 3];
        body[..3].copy_from_slice(&[0x05, 0xff, 0x00]);
        body[DATA_MAX..DATA_MAX + 2].copy_from_slice(&3u16.to_ne_bytes());
        body[DATA_MAX + 2] = 1;
        assert_eq!(
            parse(&event(UHID_OUTPUT, &body)),
            Some(Event::Output {
                kind: 1,
                data: vec![0x05, 0xff, 0x00]
            })
        );
    }

    #[test]
    fn requests_carry_what_they_ask_for() {
        let mut body = Vec::new();
        body.extend_from_slice(&42u32.to_ne_bytes());
        body.extend_from_slice(&[0x02, 0]);
        assert_eq!(
            parse(&event(UHID_GET_REPORT, &body)),
            Some(Event::GetReport {
                id: 42,
                number: 0x02,
                kind: 0
            })
        );
        body.extend_from_slice(&2u16.to_ne_bytes());
        body.extend_from_slice(&[0xaa, 0xbb]);
        assert_eq!(
            parse(&event(UHID_SET_REPORT, &body)),
            Some(Event::SetReport {
                id: 42,
                number: 0x02,
                kind: 0,
                data: vec![0xaa, 0xbb]
            })
        );
    }

    #[test]
    fn a_size_larger_than_the_buffer_is_clamped() {
        let mut body = vec![0u8; DATA_MAX + 3];
        body[DATA_MAX..DATA_MAX + 2].copy_from_slice(&u16::MAX.to_ne_bytes());
        let Some(Event::Output { data, .. }) = parse(&event(UHID_OUTPUT, &body)) else {
            panic!("did not parse");
        };
        assert_eq!(data.len(), DATA_MAX);
    }
}
