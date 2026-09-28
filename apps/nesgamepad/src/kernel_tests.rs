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
use std::sync::Arc;
use std::time::{Duration, Instant};

use nesprotocol::gamepad::{PadState, button};

use crate::layout;
use crate::uinput::code::{self, BUS_USB};
use crate::uinput::{Device, Request, Spec};

fn build(layout: layout::Layout) -> (Device, layout::Layout) {
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
fn a_hid_playstation_pad_reads_like_the_real_one() {
    let (device, _) = build(layout::dualsense());
    let sys = device.syspath();
    // Every capability below was read from a DualShock 4 v2 on USB through
    // hid-playstation, which builds the gamepad node of every controller it
    // drives with the same function. FF differs on purpose: the real one also
    // lists the periodic effects ff-memless emulates, which this does not
    // offer.
    assert_eq!(
        read(sys.join("name")),
        "Sony Interactive Entertainment DualSense Wireless Controller"
    );
    assert_eq!(read(sys.join("id/bustype")), "0003");
    assert_eq!(read(sys.join("id/vendor")), "054c");
    assert_eq!(read(sys.join("id/product")), "0ce6");
    assert_eq!(read(sys.join("id/version")), "8111");
    assert_eq!(read(sys.join("capabilities/ev")), "20000b");
    assert_eq!(
        read(sys.join("capabilities/key")),
        "7fdb000000000000 0 0 0 0"
    );
    assert_eq!(read(sys.join("capabilities/abs")), "3003f");
    assert_eq!(read(sys.join("capabilities/ff")), "10000 0");
}

#[test]
#[ignore = "creates a real input device through /dev/uinput"]
fn every_template_has_its_drivers_capabilities() {
    // As each driver's tables add up: xpad's with the d-pad as a hat and the
    // triggers as axes, hid-nintendo's for a Pro Controller.
    for (layout, key, abs) in [
        (layout::xbox_360(), "7cdb000000000000 0 0 0 0", "3003f"),
        (layout::xbox_one(), "7cdb000000000000 0 0 0 0", "3003f"),
        (layout::switch_pro(), "7ffb000000000000 0 0 0 0", "3001b"),
    ] {
        let (device, _) = build(layout.clone());
        let sys = device.syspath();
        assert_eq!(read(sys.join("name")), layout.name);
        assert_eq!(read(sys.join("capabilities/key")), key, "{}", layout.name);
        assert_eq!(read(sys.join("capabilities/abs")), abs, "{}", layout.name);
    }
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
    let (device, layout) = build(layout::dualsense());
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
    let (device, _) = build(layout::dualsense());
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

/// A small gamepad, written by hand: report 1 is eight buttons and two axes,
/// report 2 a four-byte feature, report 3 a one-byte output.
#[rustfmt::skip]
const GAMEPAD_DESCRIPTOR: &[u8] = &[
    0x05, 0x01, 0x09, 0x05, 0xa1, 0x01,
    0x85, 0x01,
    0x05, 0x09, 0x19, 0x01, 0x29, 0x08, 0x15, 0x00, 0x25, 0x01, 0x75, 0x01, 0x95, 0x08, 0x81, 0x02,
    0x05, 0x01, 0x09, 0x30, 0x09, 0x31, 0x15, 0x00, 0x26, 0xff, 0x00, 0x75, 0x08, 0x95, 0x02, 0x81, 0x02,
    0x85, 0x02,
    0x06, 0x00, 0xff, 0x09, 0x01, 0x15, 0x00, 0x26, 0xff, 0x00, 0x75, 0x08, 0x95, 0x04, 0xb1, 0x02,
    0x85, 0x03,
    0x09, 0x02, 0x75, 0x08, 0x95, 0x01, 0x91, 0x02,
    0xc0,
];

/// The device, started and with its hidraw node found.
fn build_hid() -> (Arc<crate::uhid::Device>, std::path::PathBuf) {
    use crate::uhid::{Device, Event, Spec};
    let device = Arc::new(
        Device::create(&Spec {
            name: "nesgamepad test pad",
            uniq: "test",
            bus: BUS_USB,
            vendor: 0x1234,
            product: 0x5678,
            version: 0x0100,
            country: 0,
            descriptor: GAMEPAD_DESCRIPTOR,
        })
        .expect("create a HID device; this needs root for /dev/uhid"),
    );
    let deadline = Instant::now() + Duration::from_secs(3);
    while !device.drain().unwrap().contains(&Event::Start) {
        assert!(Instant::now() < deadline, "the kernel never started it");
        std::thread::sleep(Duration::from_millis(5));
    }
    loop {
        if let Some((_, nodes)) =
            crate::pads::discover(BUS_USB, 0x1234, 0x5678, &Default::default())
        {
            let name = nodes.hidraw[0].file_name().unwrap().to_owned();
            return (device, Path::new("/dev").join(name));
        }
        assert!(Instant::now() < deadline, "no hidraw node appeared");
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[test]
#[ignore = "needs root: creates a device through /dev/uhid"]
fn a_report_written_is_the_report_a_game_reads() {
    use std::io::Read;
    let (device, node) = build_hid();
    let mut hidraw = open(&node, false);
    device.input(&[0x01, 0b1000_0001, 0x10, 0xf0]).unwrap();
    let mut buf = [0u8; 64];
    let n = hidraw.read(&mut buf).unwrap();
    assert_eq!(&buf[..n], &[0x01, 0b1000_0001, 0x10, 0xf0]);
}

#[test]
#[ignore = "needs root: creates a device through /dev/uhid"]
fn a_game_reading_a_feature_report_gets_the_answer_given() {
    use crate::uhid::Event;
    let (device, node) = build_hid();
    let hidraw = open(&node, true);
    let game = std::thread::spawn(move || {
        // HIDIOCGFEATURE(5): report id in, report out.
        let mut buf = [0x02u8, 0, 0, 0, 0];
        let request = (3u64 << 30) | (5u64 << 16) | ((b'H' as u64) << 8) | 0x07;
        let n = unsafe { libc::ioctl(hidraw.as_raw_fd(), request as _, buf.as_mut_ptr()) };
        assert!(n >= 0, "{}", std::io::Error::last_os_error());
        buf
    });
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let events = device.drain().unwrap();
        if let Some(Event::GetReport { id, number, kind }) = events
            .into_iter()
            .find(|e| matches!(e, Event::GetReport { .. }))
        {
            assert_eq!((number, kind), (0x02, crate::uhid::REPORT_FEATURE));
            device
                .get_report_reply(id, 0, &[0x02, 0xde, 0xad, 0xbe, 0xef])
                .unwrap();
            break;
        }
        assert!(Instant::now() < deadline, "the request never arrived");
        std::thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(game.join().unwrap(), [0x02, 0xde, 0xad, 0xbe, 0xef]);
}

#[test]
#[ignore = "needs root: creates a device through /dev/uhid"]
fn a_report_a_game_writes_comes_out_of_the_device() {
    use crate::uhid::Event;
    use std::io::Write;
    let (device, node) = build_hid();
    let mut hidraw = open(&node, true);
    hidraw.write_all(&[0x03, 0xaa]).unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let events = device.drain().unwrap();
        if let Some(Event::Output { kind, data }) = events
            .into_iter()
            .find(|e| matches!(e, Event::Output { .. }))
        {
            assert_eq!(kind, crate::uhid::REPORT_OUTPUT);
            assert_eq!(data, [0x03, 0xaa]);
            return;
        }
        assert!(Instant::now() < deadline, "the output never arrived");
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[test]
#[ignore = "needs root: creates a device through /dev/uhid"]
fn a_rebuilt_dualshock_4_is_taken_by_the_kernel_and_read_as_sent() {
    use crate::replica::{Model, Reporter};
    use crate::uhid::{Device, Event};
    use std::io::Read;
    let model = Model::DualShock4;
    let device = Device::create(&model.spec(0x09cc, "02:00:00:00:00:01"))
        .expect("create a HID device; this needs root for /dev/uhid");
    let deadline = Instant::now() + Duration::from_secs(3);
    while !device.drain().unwrap().contains(&Event::Start) {
        assert!(
            Instant::now() < deadline,
            "the kernel refused the descriptor"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
    let node = loop {
        if let Some((_, nodes)) =
            crate::pads::discover(BUS_USB, 0x054c, 0x09cc, &Default::default())
        {
            break Path::new("/dev").join(nodes.hidraw[0].file_name().unwrap());
        }
        assert!(Instant::now() < deadline, "no hidraw node appeared");
        std::thread::sleep(Duration::from_millis(5));
    };
    let mut hidraw = open(&node, false);
    let mut reporter = Reporter::new(model);
    reporter.set(PadState {
        buttons: button::SOUTH,
        ..PadState::default()
    });
    let report = reporter.next();
    device.input(&report).unwrap();
    let mut buf = [0u8; 128];
    let n = hidraw.read(&mut buf).unwrap();
    assert_eq!(&buf[..n], &report[..]);
}
