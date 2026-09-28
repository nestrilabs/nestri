//! Controllers the box rebuilds as the device itself, through `/dev/uhid`.
//!
//! Some games read a controller as a HID device and parse its reports by hand,
//! to tell one family from another and show the right buttons; Proton hands
//! such a controller to Wine as the raw device when it has a hidraw node, and
//! only then. For the families here, the box builds that device from nothing
//! but the controller's identity and its state: the real one's report
//! descriptor, and its reports written from the positional snapshot the client
//! sends. What a game asks of the device -- calibration, firmware, pairing --
//! is answered here the way the real one answers, and rumble it writes goes
//! back to the client.
//!
//! What the snapshot cannot say, the replica reports as a controller at rest:
//! motion sensors still, touchpad untouched.

mod dualshock4;

use std::time::{Duration, Instant};

use nesprotocol::gamepad::PadState;

use crate::layout::SONY;
use crate::uhid;
use crate::uinput::code;

/// The DualShock 4 a Sony controller with no template of its own is
/// presented as.
pub const DUALSHOCK4_V2: u16 = 0x09cc;

/// A family the box can rebuild.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Model {
    DualShock4,
}

/// Whether `product` is one of `model`'s.
pub fn is(model: Model, product: u16) -> bool {
    model.products().iter().any(|&(p, _)| p == product)
}

impl Model {
    fn products(self) -> &'static [(u16, &'static str)] {
        match self {
            Self::DualShock4 => dualshock4::PRODUCTS,
        }
    }

    fn vendor(self) -> u16 {
        match self {
            Self::DualShock4 => SONY,
        }
    }

    /// The name the device gives itself, which the client's platform may not
    /// have passed on as it was.
    pub fn name(self, product: u16) -> &'static str {
        let products = self.products();
        products
            .iter()
            .find(|&&(p, _)| p == product)
            .map_or(products[0].1, |&(_, name)| name)
    }

    /// Everything the device is built from. `uniq` is its address as text
    /// (see [`uniq`]).
    pub fn spec(self, product: u16, uniq: &str) -> uhid::Spec<'_> {
        let (version, descriptor) = match self {
            Self::DualShock4 => (dualshock4::VERSION, dualshock4::DESCRIPTOR),
        };
        uhid::Spec {
            name: self.name(product),
            uniq,
            bus: code::BUS_USB,
            vendor: self.vendor(),
            product,
            version,
            country: 0,
            descriptor,
        }
    }

    pub fn report_every(self) -> Duration {
        match self {
            Self::DualShock4 => dualshock4::REPORT_EVERY,
        }
    }

    /// The answer to a feature report read, `None` for one this does not
    /// know.
    pub fn feature(self, number: u8, address: [u8; 6]) -> Option<Vec<u8>> {
        match self {
            Self::DualShock4 => dualshock4::feature(number, address),
        }
    }

    /// Rumble a report written to the device asks for, as `(strong, weak)`.
    pub fn rumble(self, report: &[u8]) -> Option<(u16, u16)> {
        match self {
            Self::DualShock4 => dualshock4::rumble(report),
        }
    }
}

/// The input reports of one device: the latest state, and the counters a
/// real device moves on every report.
pub struct Reporter {
    model: Model,
    state: PadState,
    counter: u8,
    started: Instant,
}

impl Reporter {
    pub fn new(model: Model) -> Self {
        Self {
            model,
            state: PadState::default(),
            counter: 0,
            started: Instant::now(),
        }
    }

    pub fn set(&mut self, state: PadState) {
        self.state = state;
    }

    /// The next report, for the state last set.
    pub fn next(&mut self) -> Vec<u8> {
        let counter = self.counter;
        self.counter = self.counter.wrapping_add(1);
        match self.model {
            Model::DualShock4 => dualshock4::input_report(
                &self.state,
                counter,
                dualshock4::sensor_ticks(self.started.elapsed()),
            )
            .to_vec(),
        }
    }

    /// The report a read of the current input report gets, without moving
    /// the counters.
    pub fn current(&self) -> Vec<u8> {
        match self.model {
            Model::DualShock4 => dualshock4::input_report(
                &self.state,
                self.counter,
                dualshock4::sensor_ticks(self.started.elapsed()),
            )
            .to_vec(),
        }
    }
}

/// A locally administered address, unique to one client's slot. Software
/// pairs a device's parts, and tells two identical devices apart, by it.
pub fn address(session: u32, slot: u8) -> [u8; 6] {
    let s = session.to_be_bytes();
    [0x02, s[0], s[1], s[2], s[3], slot]
}

/// An address as a device's unique string, the way Linux writes one.
pub fn uniq(address: [u8; 6]) -> String {
    address
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<Vec<_>>()
        .join(":")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_device_names_itself_as_the_real_one_does() {
        let spec = Model::DualShock4.spec(0x09cc, "");
        assert_eq!(
            spec.name,
            "Sony Interactive Entertainment Wireless Controller"
        );
        assert_eq!((spec.vendor, spec.product), (SONY, 0x09cc));
        assert!(is(Model::DualShock4, 0x05c4));
        assert!(!is(Model::DualShock4, 0x0ce6));
    }

    #[test]
    fn every_slot_gets_its_own_address() {
        assert_ne!(address(1, 0), address(1, 1));
        assert_ne!(address(1, 0), address(2, 0));
        assert_eq!(uniq(address(0x0102_0304, 5)), "02:01:02:03:04:05");
    }

    #[test]
    fn the_counter_moves_with_every_report() {
        let mut reporter = Reporter::new(Model::DualShock4);
        let first = reporter.next();
        let second = reporter.next();
        assert_eq!(second[7] >> 2, (first[7] >> 2) + 1);
    }
}
