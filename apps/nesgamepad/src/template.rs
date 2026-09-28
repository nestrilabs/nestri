//! Which controller the box presents for the one a client described.
//!
//! A controller is matched to a template the box supports by vendor and
//! product. One that matches none, from a vendor the box knows, gets that
//! vendor's default -- the controller of theirs games know best -- so that it
//! still shows up as its vendor's, with that vendor's buttons in a game. Only a
//! controller the box cannot tell at all is presented as generic.
//!
//! A fallback presents the template's identity, not the client's: an identity
//! is only worth passing on with the layout that goes with it (see
//! `crate::layout`).

use nesprotocol::gamepad::PadIdentity;

use crate::layout::{self, Layout, MICROSOFT, NINTENDO, SONY};
use crate::replica::{self, Model};

pub enum Template {
    /// The device itself, as `product` (see `crate::replica`).
    Replica { model: Model, product: u16 },
    /// One evdev device.
    Gamepad(Layout),
}

pub fn for_identity(identity: &PadIdentity) -> Template {
    let product = identity.product;
    match identity.vendor {
        SONY => match product {
            0x0ce6 => Template::Gamepad(layout::dualsense()),
            _ if replica::is(Model::DualShock4, product) => Template::Replica {
                model: Model::DualShock4,
                product,
            },
            _ => Template::Replica {
                model: Model::DualShock4,
                product: replica::DUALSHOCK4_V2,
            },
        },
        MICROSOFT => match product {
            0x02ea => Template::Gamepad(layout::xbox_one()),
            _ => Template::Gamepad(layout::xbox_360()),
        },
        NINTENDO => Template::Gamepad(layout::switch_pro()),
        _ => Template::Gamepad(layout::generic(identity)),
    }
}

impl Template {
    /// Which template, for the log.
    pub fn describe(&self) -> String {
        match self {
            Self::Replica { model, product } => format!("{model:?} {product:04x}"),
            Self::Gamepad(layout) => format!("{} {:04x}", layout.driver, layout.product),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pick(vendor: u16, product: u16) -> Template {
        for_identity(&PadIdentity {
            vendor,
            product,
            name: "Pad".into(),
        })
    }

    fn gamepad(template: Template) -> Layout {
        match template {
            Template::Gamepad(layout) => layout,
            Template::Replica { .. } => panic!("a replica"),
        }
    }

    #[test]
    fn a_dualshock_4_is_rebuilt_as_the_one_it_is() {
        for product in [0x05c4, 0x09cc, 0x0ba0] {
            assert!(matches!(
                pick(SONY, product),
                Template::Replica { model: Model::DualShock4, product: p } if p == product
            ));
        }
    }

    #[test]
    fn a_sony_controller_nothing_fits_is_a_dualshock_4() {
        // A DualSense Edge, which has no template of its own.
        assert!(matches!(
            pick(SONY, 0x0df2),
            Template::Replica {
                model: Model::DualShock4,
                product: 0x09cc
            }
        ));
    }

    #[test]
    fn a_dualsense_has_its_own() {
        assert_eq!(gamepad(pick(SONY, 0x0ce6)).product, 0x0ce6);
    }

    #[test]
    fn an_xbox_controller_nothing_fits_is_a_360_pad() {
        assert_eq!(gamepad(pick(MICROSOFT, 0x02ea)).product, 0x02ea);
        assert_eq!(gamepad(pick(MICROSOFT, 0x028e)).product, 0x028e);
        // A Series X|S pad.
        let layout = gamepad(pick(MICROSOFT, 0x0b12));
        assert_eq!((layout.vendor, layout.product), (MICROSOFT, 0x028e));
    }

    #[test]
    fn anything_from_nintendo_is_a_pro_controller() {
        for product in [0x2009, 0x2006, 0x2007] {
            assert_eq!(gamepad(pick(NINTENDO, product)).product, 0x2009);
        }
    }

    #[test]
    fn a_controller_nobody_can_tell_is_generic() {
        assert_eq!(gamepad(pick(0x2dc8, 0x3106)).driver, "generic");
        assert_eq!(gamepad(pick(0, 0)).driver, "generic");
    }
}
