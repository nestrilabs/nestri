//! A virtual input device, through `/dev/uinput`.
//!
//! Raw ioctls rather than a crate: the interface is a dozen calls and four
//! structs, and the part that matters -- force feedback, where the kernel
//! blocks a game's upload until this process answers it -- is the part a
//! wrapper is most likely to get subtly wrong. The struct layouts are checked
//! against the kernel ABI at compile time below.

use std::ffi::CStr;
use std::fs::OpenOptions;
use std::io;
use std::mem::size_of;
use std::os::fd::{AsRawFd, OwnedFd, RawFd};
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;

/// Event types and codes, from `linux/input-event-codes.h`.
pub mod code {
    pub const EV_SYN: u16 = 0x00;
    pub const EV_KEY: u16 = 0x01;
    pub const EV_ABS: u16 = 0x03;
    pub const EV_FF: u16 = 0x15;
    pub const EV_UINPUT: u16 = 0x0101;

    pub const SYN_REPORT: u16 = 0;

    pub const BTN_SOUTH: u16 = 0x130;
    pub const BTN_EAST: u16 = 0x131;
    pub const BTN_NORTH: u16 = 0x133;
    pub const BTN_WEST: u16 = 0x134;
    pub const BTN_TL: u16 = 0x136;
    pub const BTN_TR: u16 = 0x137;
    pub const BTN_TL2: u16 = 0x138;
    pub const BTN_TR2: u16 = 0x139;
    pub const BTN_SELECT: u16 = 0x13a;
    pub const BTN_START: u16 = 0x13b;
    pub const BTN_MODE: u16 = 0x13c;
    pub const BTN_THUMBL: u16 = 0x13d;
    pub const BTN_THUMBR: u16 = 0x13e;

    pub const ABS_X: u16 = 0x00;
    pub const ABS_Y: u16 = 0x01;
    pub const ABS_Z: u16 = 0x02;
    pub const ABS_RX: u16 = 0x03;
    pub const ABS_RY: u16 = 0x04;
    pub const ABS_RZ: u16 = 0x05;
    pub const ABS_HAT0X: u16 = 0x10;
    pub const ABS_HAT0Y: u16 = 0x11;

    pub const FF_RUMBLE: u16 = 0x50;

    pub const UI_FF_UPLOAD: u16 = 1;
    pub const UI_FF_ERASE: u16 = 2;
}

/// One axis and its range.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AbsAxis {
    pub code: u16,
    pub min: i32,
    pub max: i32,
    pub fuzz: i32,
    pub flat: i32,
}

/// `struct input_event` on a 64-bit kernel.
#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct InputEvent {
    tv_sec: i64,
    tv_usec: i64,
    pub kind: u16,
    pub code: u16,
    pub value: i32,
}

impl InputEvent {
    pub fn key(code: u16, down: bool) -> Self {
        Self::new(code::EV_KEY, code, i32::from(down))
    }

    pub fn abs(code: u16, value: i32) -> Self {
        Self::new(code::EV_ABS, code, value)
    }

    pub fn report() -> Self {
        Self::new(code::EV_SYN, code::SYN_REPORT, 0)
    }

    fn new(kind: u16, code: u16, value: i32) -> Self {
        // The time is the kernel's to stamp; a writer's is ignored.
        Self {
            kind,
            code,
            value,
            ..Self::default()
        }
    }
}

#[repr(C)]
struct InputId {
    bustype: u16,
    vendor: u16,
    product: u16,
    version: u16,
}

#[repr(C)]
struct UinputSetup {
    id: InputId,
    name: [u8; 80],
    ff_effects_max: u32,
}

#[repr(C)]
struct UinputAbsSetup {
    code: u16,
    // absinfo: value, minimum, maximum, fuzz, flat, resolution
    absinfo: [i32; 6],
}

/// `struct ff_effect`. The union is kept as raw bytes: only its rumble member
/// is ever read, and that is the first four of them.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct FfEffect {
    pub kind: u16,
    pub id: i16,
    direction: u16,
    trigger: [u16; 2],
    /// length (ms), delay (ms)
    replay: [u16; 2],
    union: [u64; 4],
}

impl FfEffect {
    /// Strong and weak magnitudes, if this is a rumble effect.
    pub fn rumble(&self) -> Option<(u16, u16)> {
        if self.kind != code::FF_RUMBLE {
            return None;
        }
        let raw = self.union[0].to_ne_bytes();
        Some((
            u16::from_ne_bytes([raw[0], raw[1]]),
            u16::from_ne_bytes([raw[2], raw[3]]),
        ))
    }

    pub fn length_ms(&self) -> u16 {
        self.replay[0]
    }
}

#[repr(C)]
struct UinputFfUpload {
    request_id: u32,
    retval: i32,
    effect: FfEffect,
    old: FfEffect,
}

#[repr(C)]
struct UinputFfErase {
    request_id: u32,
    retval: i32,
    effect_id: u32,
}

const _: () = {
    assert!(size_of::<InputEvent>() == 24);
    assert!(size_of::<UinputSetup>() == 92);
    assert!(size_of::<UinputAbsSetup>() == 28);
    assert!(size_of::<FfEffect>() == 48);
    assert!(size_of::<UinputFfUpload>() == 104);
    assert!(size_of::<UinputFfErase>() == 12);
};

// `_IOC` as `asm-generic/ioctl.h` builds it, which is what x86 uses.
const fn ioc(dir: u64, nr: u64, size: usize) -> u64 {
    (dir << 30) | ((size as u64) << 16) | ((b'U' as u64) << 8) | nr
}
const NONE: u64 = 0;
const WRITE: u64 = 1;
const READ: u64 = 2;

const UI_DEV_CREATE: u64 = ioc(NONE, 1, 0);
const UI_DEV_DESTROY: u64 = ioc(NONE, 2, 0);
const UI_DEV_SETUP: u64 = ioc(WRITE, 3, size_of::<UinputSetup>());
const UI_ABS_SETUP: u64 = ioc(WRITE, 4, size_of::<UinputAbsSetup>());
const UI_SET_EVBIT: u64 = ioc(WRITE, 100, size_of::<libc::c_int>());
const UI_SET_KEYBIT: u64 = ioc(WRITE, 101, size_of::<libc::c_int>());
const UI_SET_ABSBIT: u64 = ioc(WRITE, 103, size_of::<libc::c_int>());
const UI_SET_FFBIT: u64 = ioc(WRITE, 107, size_of::<libc::c_int>());
const UI_BEGIN_FF_UPLOAD: u64 = ioc(READ | WRITE, 200, size_of::<UinputFfUpload>());
const UI_END_FF_UPLOAD: u64 = ioc(WRITE, 201, size_of::<UinputFfUpload>());
const UI_BEGIN_FF_ERASE: u64 = ioc(READ | WRITE, 202, size_of::<UinputFfErase>());
const UI_END_FF_ERASE: u64 = ioc(WRITE, 203, size_of::<UinputFfErase>());
const SYSNAME_LEN: usize = 64;
const UI_GET_SYSNAME: u64 = ioc(READ, 44, SYSNAME_LEN);

/// How many effects a game may have uploaded at once. The same as ff-memless,
/// which is what real controller drivers are built on.
const FF_EFFECTS_MAX: u32 = 16;

fn ioctl<T>(fd: RawFd, request: u64, arg: *mut T) -> io::Result<()> {
    // SAFETY: every request above is paired with the struct its size encodes.
    if unsafe { libc::ioctl(fd, request as _, arg) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn ioctl_int(fd: RawFd, request: u64, value: u16) -> io::Result<()> {
    // SAFETY: the `UI_SET_*BIT` requests take their argument by value.
    if unsafe { libc::ioctl(fd, request as _, libc::c_int::from(value)) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// What a device was built with.
pub struct Spec<'a> {
    pub name: &'a str,
    pub bus: u16,
    pub vendor: u16,
    pub product: u16,
    pub version: u16,
    pub keys: &'a [u16],
    pub axes: &'a [AbsAxis],
}

/// A device that exists for as long as this does.
pub struct Device {
    fd: OwnedFd,
    /// `inputN`, the kernel's name for it.
    pub sysname: String,
}

/// What reading the device produced.
#[derive(Debug, Clone, Copy)]
pub enum Request {
    /// A game uploaded or replaced an effect. It has already been accepted.
    Upload(FfEffect),
    Erase(i16),
    /// A game started (`true`) or stopped an effect.
    Play {
        id: i16,
        on: bool,
    },
}

impl std::fmt::Debug for FfEffect {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FfEffect")
            .field("kind", &self.kind)
            .field("id", &self.id)
            .field("rumble", &self.rumble())
            .field("length_ms", &self.length_ms())
            .finish()
    }
}

impl Device {
    pub fn create(spec: &Spec<'_>) -> io::Result<Self> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .custom_flags(libc::O_NONBLOCK | libc::O_CLOEXEC)
            .open("/dev/uinput")?;
        let fd: OwnedFd = file.into();
        let raw = fd.as_raw_fd();

        ioctl_int(raw, UI_SET_EVBIT, code::EV_KEY)?;
        for &key in spec.keys {
            ioctl_int(raw, UI_SET_KEYBIT, key)?;
        }
        ioctl_int(raw, UI_SET_EVBIT, code::EV_ABS)?;
        for axis in spec.axes {
            ioctl_int(raw, UI_SET_ABSBIT, axis.code)?;
            let mut setup = UinputAbsSetup {
                code: axis.code,
                absinfo: [
                    (axis.min + axis.max) / 2,
                    axis.min,
                    axis.max,
                    axis.fuzz,
                    axis.flat,
                    0,
                ],
            };
            ioctl(raw, UI_ABS_SETUP, &mut setup)?;
        }
        ioctl_int(raw, UI_SET_EVBIT, code::EV_FF)?;
        ioctl_int(raw, UI_SET_FFBIT, code::FF_RUMBLE)?;

        let mut setup = UinputSetup {
            id: InputId {
                bustype: spec.bus,
                vendor: spec.vendor,
                product: spec.product,
                version: spec.version,
            },
            name: [0; 80],
            ff_effects_max: FF_EFFECTS_MAX,
        };
        // One short of the buffer, so the kernel always finds a terminator.
        let name = spec.name.as_bytes();
        let len = name.len().min(setup.name.len() - 1);
        setup.name[..len].copy_from_slice(&name[..len]);
        ioctl(raw, UI_DEV_SETUP, &mut setup)?;
        ioctl(raw, UI_DEV_CREATE, std::ptr::null_mut::<u8>())?;

        let mut sysname = [0u8; SYSNAME_LEN];
        ioctl(raw, UI_GET_SYSNAME, sysname.as_mut_ptr())?;
        let sysname = CStr::from_bytes_until_nul(&sysname)
            .map_err(|_| io::Error::other("unterminated sysname"))?
            .to_string_lossy()
            .into_owned();
        Ok(Self { fd, sysname })
    }

    /// Where the kernel put it in sysfs.
    pub fn syspath(&self) -> PathBuf {
        PathBuf::from("/sys/devices/virtual/input").join(&self.sysname)
    }

    pub fn write(&self, events: &[InputEvent]) -> io::Result<()> {
        let bytes = std::mem::size_of_val(events);
        // SAFETY: `InputEvent` is `repr(C)` plain data.
        let n = unsafe { libc::write(self.fd.as_raw_fd(), events.as_ptr().cast(), bytes) };
        if n < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    /// Everything waiting on the device, answering any upload or erase as it
    /// goes. Returns once the device has nothing more to say.
    ///
    /// The answering is not optional: a game's upload ioctl blocks in the
    /// kernel until this process ends it, so an unread request is a game
    /// frozen mid-call.
    pub fn drain(&self) -> io::Result<Vec<Request>> {
        let raw = self.fd.as_raw_fd();
        let mut out = Vec::new();
        loop {
            let mut event = InputEvent::default();
            // SAFETY: reading one plain-data event into a buffer its size.
            let n = unsafe {
                libc::read(
                    raw,
                    (&mut event as *mut InputEvent).cast(),
                    size_of::<InputEvent>(),
                )
            };
            if n < 0 {
                let error = io::Error::last_os_error();
                if error.kind() == io::ErrorKind::WouldBlock {
                    return Ok(out);
                }
                return Err(error);
            }
            if n as usize != size_of::<InputEvent>() {
                return Ok(out);
            }
            match (event.kind, event.code) {
                (code::EV_UINPUT, code::UI_FF_UPLOAD) => {
                    // SAFETY: plain data, filled in by the kernel.
                    let mut upload: UinputFfUpload = unsafe { std::mem::zeroed() };
                    upload.request_id = event.value as u32;
                    ioctl(raw, UI_BEGIN_FF_UPLOAD, &mut upload)?;
                    // Rumble is the only effect the device advertises, so the
                    // kernel refuses anything else before it gets here.
                    upload.retval = 0;
                    let effect = upload.effect;
                    ioctl(raw, UI_END_FF_UPLOAD, &mut upload)?;
                    out.push(Request::Upload(effect));
                }
                (code::EV_UINPUT, code::UI_FF_ERASE) => {
                    let mut erase = UinputFfErase {
                        request_id: event.value as u32,
                        retval: 0,
                        effect_id: 0,
                    };
                    ioctl(raw, UI_BEGIN_FF_ERASE, &mut erase)?;
                    erase.retval = 0;
                    let id = erase.effect_id as i16;
                    ioctl(raw, UI_END_FF_ERASE, &mut erase)?;
                    out.push(Request::Erase(id));
                }
                (code::EV_FF, id) => out.push(Request::Play {
                    id: id as i16,
                    on: event.value > 0,
                }),
                _ => {}
            }
        }
    }
}

impl AsRawFd for Device {
    fn as_raw_fd(&self) -> RawFd {
        self.fd.as_raw_fd()
    }
}

impl Device {
    /// Remove the device now, whoever else still holds this.
    ///
    /// Closing the descriptor would do it too, but only when the last holder
    /// closes it. Destroying twice is harmless: the second is refused.
    pub fn destroy(&self) {
        let _ = ioctl(
            self.fd.as_raw_fd(),
            UI_DEV_DESTROY,
            std::ptr::null_mut::<u8>(),
        );
    }
}

impl Drop for Device {
    fn drop(&mut self) {
        self.destroy();
    }
}
