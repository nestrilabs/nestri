//! Against the real kernel: build a device through `/dev/uinput` and read it
//! back the way a game would.
//!
//! Ignored by default, because they need write access to `/dev/uinput` and
//! create a real (short-lived) input device on whatever runs them. Run with
//! `cargo test -p nesgamepad -- --ignored` on a machine where that is fine.
//! Nothing here touches udev's database: that is the host's, not ours.

use std::fs::OpenOptions;
use std::os::fd::AsRawFd;
use std::path::Path;
use std::time::{Duration, Instant};

use nesprotocol::gamepad::{BUS_USB, PadIdentity, PadState, button};

use crate::layout;
use crate::uinput::{Device, Request, Spec, code};

fn build(identity: &PadIdentity) -> (Device, layout::Layout) {
    let layout = layout::for_identity(identity);
    let keys: Vec<u16> = layout.buttons.iter().map(|&(_, key)| key).collect();
    let device = Device::create(&Spec {
        name: &layout.name,
        bus: layout.bus,
        vendor: layout.vendor,
        product: layout.product,
        version: layout.version,
        keys: &keys,
        axes: &layout.axes(),
    })
    .expect("create a device; is /dev/uinput writable?");
    (device, layout)
}

fn dualshock_4() -> PadIdentity {
    PadIdentity {
        bus: BUS_USB,
        vendor: 0x054c,
        product: 0x09cc,
        version: 0,
        name: "Wireless Controller".into(),
    }
}

/// Open a new device's node, waiting out the host's udev granting access to
/// it, which happens a moment after the node itself appears.
fn open(path: &Path, write: bool) -> std::fs::File {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match OpenOptions::new().read(true).write(write).open(path) {
            Ok(file) => return file,
            Err(e) if Instant::now() > deadline => panic!("{}: {e}", path.display()),
            Err(_) => std::thread::sleep(Duration::from_millis(20)),
        }
    }
}

fn read(path: impl AsRef<Path>) -> String {
    std::fs::read_to_string(path).unwrap().trim().to_owned()
}

fn event_node(device: &Device) -> std::path::PathBuf {
    let dir = device.syspath();
    let name = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(Result::ok)
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .find(|n| n.starts_with("event"))
        .expect("an event node");
    Path::new("/dev/input").join(name)
}

#[test]
#[ignore = "creates a real input device through /dev/uinput"]
fn a_dualshock_4_reads_like_the_real_one() {
    let (device, _) = build(&dualshock_4());
    let sys = device.syspath();
    // Every value below was read from a DualShock 4 v2 on USB through
    // hid-playstation. FF differs on purpose: the real one also lists the
    // periodic effects ff-memless emulates, which this does not offer.
    assert_eq!(
        read(sys.join("name")),
        "Sony Interactive Entertainment Wireless Controller"
    );
    assert_eq!(read(sys.join("id/bustype")), "0003");
    assert_eq!(read(sys.join("id/vendor")), "054c");
    assert_eq!(read(sys.join("id/product")), "09cc");
    assert_eq!(read(sys.join("id/version")), "8111");
    assert_eq!(read(sys.join("capabilities/ev")), "20000b");
    assert_eq!(
        read(sys.join("capabilities/key")),
        "7fdb000000000000 0 0 0 0"
    );
    assert_eq!(read(sys.join("capabilities/abs")), "3003f");
    assert_eq!(read(sys.join("capabilities/ff")), "10000 0");
}

/// `EVIOCGABS(code)`: an axis's current value and range.
fn abs(fd: i32, code: u16) -> [i32; 6] {
    let mut info = [0i32; 6];
    let request = (2u64 << 30) | (24u64 << 16) | ((b'E' as u64) << 8) | (0x40 + code as u64);
    assert!(unsafe { libc::ioctl(fd, request as _, info.as_mut_ptr()) } >= 0);
    info
}

#[test]
#[ignore = "creates a real input device through /dev/uinput"]
fn state_written_is_state_a_game_reads() {
    let (device, layout) = build(&dualshock_4());
    let node = open(&event_node(&device), false);
    let fd = node.as_raw_fd();

    let resting = abs(fd, code::ABS_X);
    assert_eq!(&resting[1..3], &[0, 255]);

    let state = PadState {
        left_x: i16::MAX,
        right_trigger: u16::MAX,
        buttons: button::DPAD_DOWN,
        ..PadState::default()
    };
    device.write(&layout.events(&state)).unwrap();
    assert_eq!(abs(fd, code::ABS_X)[0], 255);
    assert_eq!(abs(fd, code::ABS_RZ)[0], 255);
    assert_eq!(abs(fd, code::ABS_HAT0Y)[0], 1);
}

/// `struct ff_effect` for a rumble, as a game uploads it.
#[repr(C)]
#[allow(dead_code)]
struct Rumble {
    kind: u16,
    id: i16,
    direction: u16,
    trigger: [u16; 2],
    replay: [u16; 2],
    /// The union starts eight-aligned.
    gap: u16,
    strong: u16,
    weak: u16,
    pad: [u8; 28],
}

const _: () = assert!(std::mem::size_of::<Rumble>() == 48);

#[test]
#[ignore = "creates a real input device through /dev/uinput"]
fn a_game_uploading_rumble_is_answered_and_heard() {
    let (device, _) = build(&dualshock_4());
    let node = open(&event_node(&device), true);

    // The upload blocks in the kernel until the device's owner answers it, so
    // the game's side runs on a thread of its own, exactly as it would be a
    // process of its own.
    let game = std::thread::spawn(move || {
        let mut effect = Rumble {
            kind: code::FF_RUMBLE,
            id: -1,
            direction: 0,
            trigger: [0; 2],
            replay: [300, 0],
            gap: 0,
            strong: 0xc000,
            weak: 0x4000,
            pad: [0; 28],
        };
        const EVIOCSFF: u64 = (1u64 << 30) | (48u64 << 16) | ((b'E' as u64) << 8) | 0x80;
        let rc = unsafe { libc::ioctl(node.as_raw_fd(), EVIOCSFF as _, &mut effect) };
        assert!(
            rc >= 0,
            "upload refused: {}",
            std::io::Error::last_os_error()
        );
        // Play it once.
        let play = crate::uinput::InputEvent::default();
        let mut raw: [u8; 24] = unsafe { std::mem::transmute(play) };
        raw[16..18].copy_from_slice(&code::EV_FF.to_ne_bytes());
        raw[18..20].copy_from_slice(&(effect.id as u16).to_ne_bytes());
        raw[20..24].copy_from_slice(&1i32.to_ne_bytes());
        use std::io::Write;
        (&node).write_all(&raw).unwrap();
        effect.id
    });

    let deadline = Instant::now() + Duration::from_secs(5);
    let mut seen = Vec::new();
    while Instant::now() < deadline && !seen.iter().any(|r| matches!(r, Request::Play { .. })) {
        seen.extend(device.drain().unwrap());
        std::thread::sleep(Duration::from_millis(5));
    }
    let id = game.join().unwrap();

    let uploaded = seen.iter().find_map(|r| match r {
        Request::Upload(effect) => Some(*effect),
        _ => None,
    });
    let uploaded = uploaded.expect("the upload reached the device");
    assert_eq!(uploaded.id, id);
    assert_eq!(uploaded.rumble(), Some((0xc000, 0x4000)));
    assert_eq!(uploaded.length_ms(), 300);
    assert!(
        seen.iter()
            .any(|r| matches!(r, Request::Play { id: played, on: true } if *played == id)),
        "{seen:?}"
    );
}
