//! What a controller looks like to a game as an evdev device: its identity and
//! its layout.
//!
//! # Why the layout follows the identity
//!
//! A game rarely reads a controller's buttons by code. SDL, Wine and Steam each
//! build an id from the device's bus, vendor, product and version, look it up
//! in a mapping database, and read the device through that mapping -- which
//! was written against the exact set of axes and buttons the *Linux driver*
//! for that device exposes, in the order the driver exposes them. A device
//! claiming a real controller's identity with any other layout gets its
//! buttons scrambled, which is worse than being unrecognised.
//!
//! So each template here is built the way the driver for its identity builds
//! it, read from that driver's source, or it is [`generic`]: the kernel's own
//! gamepad layout under a neutral identity, which every mapping layer knows how
//! to read without a database entry. Which template a controller gets is
//! `crate::template`'s to decide.

use nesprotocol::gamepad::button;
use nesprotocol::gamepad::{PadIdentity, PadState};

use crate::uinput::code::{self, BUS_USB, BUS_VIRTUAL};
use crate::uinput::{AbsAxis, InputEvent};

/// A controller as the box will present it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layout {
    pub name: String,
    pub bus: u16,
    pub vendor: u16,
    pub product: u16,
    pub version: u16,
    /// Wire button bit, and the key code it becomes. A bit of zero is a key
    /// the real device has and the wire cannot carry: registered, because a
    /// mapping counts the device's keys to number them, and never pressed.
    pub buttons: &'static [(u32, u16)],
    /// Left x, left y, right x, right y.
    pub sticks: [AbsAxis; 4],
    /// Left, right. `None` for a controller whose triggers are only buttons.
    pub triggers: Option<[AbsAxis; 2]>,
    /// Which driver this imitates, for the log.
    pub driver: &'static str,
}

/// The kernel's generic gamepad buttons, by position.
///
/// Also exactly what hid-playstation registers, which is why its template
/// shares it. The d-pad is not here: every layout below reports it as a hat.
const GAMEPAD_BUTTONS: &[(u32, u16)] = &[
    (button::SOUTH, code::BTN_SOUTH),
    (button::EAST, code::BTN_EAST),
    (button::NORTH, code::BTN_NORTH),
    (button::WEST, code::BTN_WEST),
    (button::LEFT_SHOULDER, code::BTN_TL),
    (button::RIGHT_SHOULDER, code::BTN_TR),
    (button::LEFT_TRIGGER, code::BTN_TL2),
    (button::RIGHT_TRIGGER, code::BTN_TR2),
    (button::SELECT, code::BTN_SELECT),
    (button::START, code::BTN_START),
    (button::MODE, code::BTN_MODE),
    (button::LEFT_STICK, code::BTN_THUMBL),
    (button::RIGHT_STICK, code::BTN_THUMBR),
];

/// What xpad registers for the 360 and One pads it drives with the d-pad as
/// a hat and the triggers as axes.
///
/// xpad names its face buttons by letter, not position: the left one, X, is
/// reported as `BTN_X`, which is the same code as `BTN_NORTH`, and the top
/// one, Y, as `BTN_Y`, the code of `BTN_WEST`. Mappings written against xpad
/// expect exactly that, so it is kept.
const XPAD_BUTTONS: &[(u32, u16)] = &[
    (button::SOUTH, code::BTN_SOUTH),
    (button::EAST, code::BTN_EAST),
    (button::WEST, code::BTN_X),
    (button::NORTH, code::BTN_Y),
    (button::LEFT_SHOULDER, code::BTN_TL),
    (button::RIGHT_SHOULDER, code::BTN_TR),
    (button::SELECT, code::BTN_SELECT),
    (button::START, code::BTN_START),
    (button::MODE, code::BTN_MODE),
    (button::LEFT_STICK, code::BTN_THUMBL),
    (button::RIGHT_STICK, code::BTN_THUMBR),
];

/// What hid-nintendo registers for a Pro Controller: positional, with ZL and
/// ZR as buttons only, and Capture, which the wire does not carry.
const PRO_CONTROLLER_BUTTONS: &[(u32, u16)] = &[
    (button::SOUTH, code::BTN_SOUTH),
    (button::EAST, code::BTN_EAST),
    (button::NORTH, code::BTN_NORTH),
    (button::WEST, code::BTN_WEST),
    (button::LEFT_SHOULDER, code::BTN_TL),
    (button::RIGHT_SHOULDER, code::BTN_TR),
    (button::LEFT_TRIGGER, code::BTN_TL2),
    (button::RIGHT_TRIGGER, code::BTN_TR2),
    (button::SELECT, code::BTN_SELECT),
    (button::START, code::BTN_START),
    (button::MODE, code::BTN_MODE),
    (button::LEFT_STICK, code::BTN_THUMBL),
    (button::RIGHT_STICK, code::BTN_THUMBR),
    (0, code::BTN_Z),
];

pub const SONY: u16 = 0x054c;
pub const MICROSOFT: u16 = 0x045e;
pub const NINTENDO: u16 = 0x057e;

fn axis(code: u16, min: i32, max: i32, fuzz: i32, flat: i32) -> AbsAxis {
    AbsAxis {
        code,
        min,
        max,
        fuzz,
        flat,
    }
}

fn sticks(min: i32, max: i32, fuzz: i32, flat: i32) -> [AbsAxis; 4] {
    [code::ABS_X, code::ABS_Y, code::ABS_RX, code::ABS_RY].map(|c| axis(c, min, max, fuzz, flat))
}

fn triggers(max: i32) -> Option<[AbsAxis; 2]> {
    Some([code::ABS_Z, code::ABS_RZ].map(|c| axis(c, 0, max, 0, 0)))
}

/// A DualSense on a cable, as hid-playstation makes it.
///
/// One byte per stick and trigger, no fuzz, no flat, as the driver's
/// `ps_gamepad_create` sets them for every controller it drives. The version
/// is the driver's patch bit, which tells userspace the mapping is the
/// driver's and not hid-generic's, on the HID version; read from a
/// DualShock 4 v2 under the driver, as is the rest.
pub fn dualsense() -> Layout {
    Layout {
        name: "Sony Interactive Entertainment DualSense Wireless Controller".into(),
        bus: BUS_USB,
        vendor: SONY,
        product: 0x0ce6,
        version: 0x8111,
        buttons: GAMEPAD_BUTTONS,
        sticks: sticks(0, 255, 0, 0),
        triggers: triggers(255),
        driver: "hid-playstation",
    }
}

/// A wired Xbox 360 pad, as xpad makes it. The version is the device's own
/// release number, which xpad passes on.
pub fn xbox_360() -> Layout {
    Layout {
        name: "Microsoft X-Box 360 pad".into(),
        bus: BUS_USB,
        vendor: MICROSOFT,
        product: 0x028e,
        version: 0x0114,
        buttons: XPAD_BUTTONS,
        sticks: sticks(-32768, 32767, 16, 128),
        triggers: triggers(255),
        driver: "xpad",
    }
}

/// An Xbox One S pad on a cable, as xpad makes it: the 360's layout, with ten
/// bits of trigger.
pub fn xbox_one() -> Layout {
    Layout {
        name: "Microsoft X-Box One S pad".into(),
        bus: BUS_USB,
        vendor: MICROSOFT,
        product: 0x02ea,
        version: 0x0408,
        buttons: XPAD_BUTTONS,
        sticks: sticks(-32768, 32767, 16, 128),
        triggers: triggers(1023),
        driver: "xpad",
    }
}

/// A Pro Controller on a cable, as hid-nintendo makes it. The name is what
/// the device calls itself over USB, manufacturer first, which the driver
/// passes on; the version is the HID version, which it passes on too.
pub fn switch_pro() -> Layout {
    Layout {
        name: "Nintendo Co., Ltd. Pro Controller".into(),
        bus: BUS_USB,
        vendor: NINTENDO,
        product: 0x2009,
        version: 0x0111,
        buttons: PRO_CONTROLLER_BUTTONS,
        sticks: sticks(-32767, 32767, 250, 500),
        triggers: None,
        driver: "hid-nintendo",
    }
}

/// A controller the box cannot tell.
///
/// The identity is dropped on purpose (see the module docs): vendor and
/// product zero on the virtual bus, so no mapping database can match it to a
/// real device with a different layout. The name stays, because that is what a
/// person sees in a game's settings.
pub fn generic(identity: &PadIdentity) -> Layout {
    let name = if identity.name.trim().is_empty() {
        "Gamepad".to_owned()
    } else {
        identity.name.clone()
    };
    Layout {
        name,
        bus: BUS_VIRTUAL,
        vendor: 0,
        product: 0,
        version: 0,
        buttons: GAMEPAD_BUTTONS,
        sticks: sticks(-32768, 32767, 16, 128),
        triggers: triggers(1023),
        driver: "generic",
    }
}

/// Map a full-range wire value onto an axis's own range.
fn scale(axis: &AbsAxis, from_min: i64, from_max: i64, value: i64) -> i32 {
    let span = i64::from(axis.max) - i64::from(axis.min);
    let offset = (value - from_min) * span / (from_max - from_min);
    (i64::from(axis.min) + offset) as i32
}

impl Layout {
    /// Every event that makes the device read as `state`, ending in a report.
    ///
    /// All of them every time: the kernel drops a value that did not change
    /// before any reader sees it, so repeating one costs nothing downstream,
    /// and a device built from a snapshot can never drift from it.
    pub fn events(&self, state: &PadState) -> Vec<InputEvent> {
        let mut events = Vec::with_capacity(self.buttons.len() + 9);
        for &(bit, key) in self.buttons {
            events.push(InputEvent::key(key, state.buttons & bit != 0));
        }
        let sticks = [state.left_x, state.left_y, state.right_x, state.right_y];
        for (axis, value) in self.sticks.iter().zip(sticks) {
            let value = scale(axis, i16::MIN.into(), i16::MAX.into(), value.into());
            events.push(InputEvent::abs(axis.code, value));
        }
        for (axis, value) in self
            .triggers
            .iter()
            .flatten()
            .zip([state.left_trigger, state.right_trigger])
        {
            let value = scale(axis, 0, u16::MAX.into(), value.into());
            events.push(InputEvent::abs(axis.code, value));
        }
        let held = |bit| i32::from(state.buttons & bit != 0);
        events.push(InputEvent::abs(
            code::ABS_HAT0X,
            held(button::DPAD_RIGHT) - held(button::DPAD_LEFT),
        ));
        events.push(InputEvent::abs(
            code::ABS_HAT0Y,
            held(button::DPAD_DOWN) - held(button::DPAD_UP),
        ));
        events.push(InputEvent::report());
        events
    }

    /// Every axis the device has, with its range.
    pub fn axes(&self) -> Vec<AbsAxis> {
        let hat = |code| AbsAxis {
            code,
            min: -1,
            max: 1,
            fuzz: 0,
            flat: 0,
        };
        let mut axes: Vec<AbsAxis> = self
            .sticks
            .iter()
            .chain(self.triggers.iter().flatten())
            .copied()
            .collect();
        axes.push(hat(code::ABS_HAT0X));
        axes.push(hat(code::ABS_HAT0Y));
        axes
    }

    /// `ID_BUS` as udev writes it, where udev writes one at all.
    pub fn udev_bus(&self) -> Option<&'static str> {
        match self.bus {
            BUS_USB => Some("usb"),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn value(events: &[InputEvent], code: u16) -> i32 {
        events
            .iter()
            .find(|e| e.code == code && e.kind != code::EV_SYN)
            .map(|e| e.value)
            .unwrap()
    }

    fn all() -> Vec<Layout> {
        vec![
            dualsense(),
            xbox_360(),
            xbox_one(),
            switch_pro(),
            generic(&PadIdentity {
                vendor: 1,
                product: 2,
                name: String::new(),
            }),
        ]
    }

    /// The key capability as sysfs prints its first word: bit n is key
    /// `0x130 + n`.
    fn key_bits(layout: &Layout) -> u64 {
        layout
            .buttons
            .iter()
            .fold(0, |bits, &(_, key)| bits | 1 << (key - 0x130))
    }

    #[test]
    fn each_template_has_the_keys_its_driver_registers() {
        // hid-playstation's read from a DualShock 4 under the driver, which
        // registers the same for every controller it drives; the others as
        // their drivers' tables add up.
        assert_eq!(key_bits(&dualsense()), 0x7fdb);
        assert_eq!(key_bits(&xbox_360()), 0x7cdb);
        assert_eq!(key_bits(&xbox_one()), 0x7cdb);
        assert_eq!(key_bits(&switch_pro()), 0x7ffb);
    }

    #[test]
    fn xpad_puts_the_left_face_button_on_btn_x() {
        let events = xbox_360().events(&PadState {
            buttons: button::WEST,
            ..PadState::default()
        });
        assert_eq!(value(&events, code::BTN_X), 1);
        assert_eq!(value(&events, code::BTN_Y), 0);
    }

    #[test]
    fn a_key_the_wire_cannot_carry_is_never_pressed() {
        let events = switch_pro().events(&PadState {
            buttons: u32::MAX,
            ..PadState::default()
        });
        assert_eq!(value(&events, code::BTN_Z), 0);
        assert_eq!(value(&events, code::BTN_TL2), 1);
    }

    #[test]
    fn a_controller_without_analog_triggers_has_no_trigger_axes() {
        let codes: Vec<u16> = switch_pro().axes().iter().map(|a| a.code).collect();
        assert!(!codes.contains(&code::ABS_Z) && !codes.contains(&code::ABS_RZ));
    }

    #[test]
    fn a_resting_controller_rests_on_every_layout() {
        for layout in all() {
            let events = layout.events(&PadState::default());
            for axis in &layout.sticks {
                let v = value(&events, axis.code);
                let mid = (axis.min + axis.max) / 2;
                assert!(
                    (v - mid).abs() <= 1,
                    "{} stick {} at {v}",
                    layout.driver,
                    axis.code
                );
            }
            for axis in layout.triggers.iter().flatten() {
                assert_eq!(value(&events, axis.code), axis.min);
            }
            assert_eq!(value(&events, code::ABS_HAT0X), 0);
            assert!(events.last().unwrap().kind == code::EV_SYN);
        }
    }

    #[test]
    fn full_deflection_reaches_both_ends_of_every_range() {
        for layout in all() {
            let pushed = PadState {
                left_x: i16::MIN,
                left_y: i16::MAX,
                right_trigger: u16::MAX,
                buttons: button::DPAD_UP | button::DPAD_LEFT | button::EAST,
                ..PadState::default()
            };
            let events = layout.events(&pushed);
            let [x, y, ..] = layout.sticks;
            assert!(
                (value(&events, x.code) - x.min).abs() <= 1,
                "{}",
                layout.driver
            );
            assert_eq!(value(&events, y.code), y.max, "{}", layout.driver);
            if let Some([_, rz]) = layout.triggers {
                assert_eq!(value(&events, rz.code), rz.max);
            }
            assert_eq!(value(&events, code::ABS_HAT0X), -1);
            assert_eq!(value(&events, code::ABS_HAT0Y), -1);
            assert_eq!(value(&events, code::BTN_EAST), 1);
            assert_eq!(value(&events, code::BTN_SOUTH), 0);
        }
    }
}
