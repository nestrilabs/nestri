//! What a controller looks like to a game: its identity and its evdev layout.
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
//! So a device is either built the way the driver for its identity builds it,
//! from the table in [`for_identity`], or it gives up the identity and presents
//! the kernel's own generic gamepad layout under a neutral one, which every
//! mapping layer knows how to read without a database entry.

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
    /// Wire button bit, and the key code it becomes.
    pub buttons: &'static [(u32, u16)],
    /// Left x, left y, right x, right y.
    pub sticks: [AbsAxis; 4],
    /// Left, right.
    pub triggers: [AbsAxis; 2],
    /// Which table entry this came from, for the log.
    pub driver: &'static str,
}

/// The kernel's generic gamepad buttons, by position.
///
/// Also exactly what hid-playstation registers, which is why its entry shares
/// it. The d-pad is not here: every layout below reports it as a hat.
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

/// The version hid-playstation gives a device over USB: its patch bit, which
/// tells userspace the mapping is the driver's and not hid-generic's, on the
/// device's own. Read from a DualShock 4 v2, as is every axis range below; the
/// driver treats its devices alike, and a mismatch would only cost a mapping
/// layer its exact match, after which each falls back to one that ignores the
/// version.
const HID_PLAYSTATION_VERSION: u16 = 0x8111;

const SONY: u16 = 0x054c;

/// Sony controllers driven by hid-playstation and not rebuilt as themselves
/// (see `crate::replica`): product, and the name the device gives itself over
/// USB.
const HID_PLAYSTATION: &[(u16, &str)] = &[(
    0x0ce6,
    "Sony Interactive Entertainment DualSense Wireless Controller",
)];

/// Sticks and triggers the way hid-playstation registers them: one byte each,
/// no fuzz, no flat, as the driver's `ps_gamepad_create` does.
fn byte_axes() -> ([AbsAxis; 4], [AbsAxis; 2]) {
    let axis = |code| AbsAxis {
        code,
        min: 0,
        max: 255,
        fuzz: 0,
        flat: 0,
    };
    (
        [
            axis(code::ABS_X),
            axis(code::ABS_Y),
            axis(code::ABS_RX),
            axis(code::ABS_RY),
        ],
        [axis(code::ABS_Z), axis(code::ABS_RZ)],
    )
}

/// How the box presents a controller the client described.
pub fn for_identity(identity: &PadIdentity) -> Layout {
    if identity.vendor == SONY
        && let Some(&(product, name)) = HID_PLAYSTATION
            .iter()
            .find(|(product, _)| *product == identity.product)
    {
        return hid_playstation(product, name);
    }
    generic(identity)
}

/// Always as on a cable: the client cannot say how the controller is
/// attached, and a cable is what these most often arrive on.
fn hid_playstation(product: u16, name: &str) -> Layout {
    let (sticks, triggers) = byte_axes();
    Layout {
        name: name.to_owned(),
        bus: BUS_USB,
        vendor: SONY,
        product,
        version: HID_PLAYSTATION_VERSION,
        buttons: GAMEPAD_BUTTONS,
        sticks,
        triggers,
        driver: "hid-playstation",
    }
}

/// A controller the box knows no driver for.
///
/// The identity is dropped on purpose (see the module docs): vendor and
/// product zero on the virtual bus, so no mapping database can match it to a
/// real device with a different layout. The name stays, because that is what a
/// person sees in a game's settings.
pub fn generic(identity: &PadIdentity) -> Layout {
    let stick = |code| AbsAxis {
        code,
        min: -32768,
        max: 32767,
        fuzz: 16,
        flat: 128,
    };
    let trigger = |code| AbsAxis {
        code,
        min: 0,
        max: 1023,
        fuzz: 0,
        flat: 0,
    };
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
        sticks: [
            stick(code::ABS_X),
            stick(code::ABS_Y),
            stick(code::ABS_RX),
            stick(code::ABS_RY),
        ],
        triggers: [trigger(code::ABS_Z), trigger(code::ABS_RZ)],
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
        let mut axes: Vec<AbsAxis> = self.sticks.iter().chain(&self.triggers).copied().collect();
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
    const DUALSENSE: u16 = 0x0ce6;

    fn identity(vendor: u16, product: u16, name: &str) -> PadIdentity {
        PadIdentity {
            vendor,
            product,
            name: name.into(),
        }
    }

    fn value(events: &[InputEvent], code: u16) -> i32 {
        events
            .iter()
            .find(|e| e.code == code && e.kind != code::EV_SYN)
            .map(|e| e.value)
            .unwrap()
    }

    #[test]
    fn a_dualsense_is_built_as_linux_would_whatever_the_client_calls_it() {
        let layout = for_identity(&identity(SONY, DUALSENSE, "Wireless Gamepad"));
        assert_eq!(layout.driver, "hid-playstation");
        assert_eq!(
            layout.name,
            "Sony Interactive Entertainment DualSense Wireless Controller"
        );
        assert_eq!((layout.bus, layout.version), (BUS_USB, 0x8111));
    }

    #[test]
    fn an_unknown_controller_keeps_its_name_and_gives_up_its_identity() {
        let layout = for_identity(&identity(0x045e, 0x028e, "Some Pad"));
        assert_eq!(layout.driver, "generic");
        assert_eq!(
            (layout.vendor, layout.product, layout.bus),
            (0, 0, BUS_VIRTUAL)
        );
        assert_eq!(layout.name, "Some Pad");
    }

    #[test]
    fn a_resting_controller_rests_on_every_layout() {
        for layout in [
            for_identity(&identity(SONY, DUALSENSE, "")),
            for_identity(&identity(1, 2, "")),
        ] {
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
            for axis in &layout.triggers {
                assert_eq!(value(&events, axis.code), axis.min);
            }
            assert_eq!(value(&events, code::ABS_HAT0X), 0);
            assert!(events.last().unwrap().kind == code::EV_SYN);
        }
    }

    #[test]
    fn full_deflection_reaches_both_ends_of_every_range() {
        let layout = for_identity(&identity(SONY, DUALSENSE, ""));
        let pushed = PadState {
            left_x: i16::MIN,
            left_y: i16::MAX,
            right_trigger: u16::MAX,
            buttons: button::DPAD_UP | button::DPAD_LEFT | button::EAST,
            ..PadState::default()
        };
        let events = layout.events(&pushed);
        assert_eq!(value(&events, code::ABS_X), 0);
        assert_eq!(value(&events, code::ABS_Y), 255);
        assert_eq!(value(&events, code::ABS_RZ), 255);
        assert_eq!(value(&events, code::ABS_HAT0X), -1);
        assert_eq!(value(&events, code::ABS_HAT0Y), -1);
        assert_eq!(value(&events, code::BTN_EAST), 1);
        assert_eq!(value(&events, code::BTN_SOUTH), 0);
    }

    #[test]
    fn a_hid_playstation_device_has_the_buttons_its_driver_registers() {
        // KEY capability read from a DualShock 4 under the driver, which
        // registers the same for every controller it drives: 0x7fdb << 304.
        let layout = for_identity(&identity(SONY, DUALSENSE, ""));
        let mut bits = 0u64;
        for &(_, key) in layout.buttons {
            bits |= 1 << (key - 304);
        }
        assert_eq!(bits, 0x7fdb);
    }
}
