// Gamepads: what the client says about the controllers plugged into it, and
// what the box says back.
//
// Client → box travels as `MSG_GAMEPAD` frames on the input stream, one
// message per frame. Box → client travels as `MSG_GAMEPAD_FEEDBACK` frames on
// the same stream's other half. The hub forwards both without reading them,
// tagged with which client they belong to (see `encode_ipc`).
//
// # The client describes the controller, it does not choose one
//
// A `Connect` carries the real device's identity as the client saw it, and the
// box decides what a game inside it should see. Nothing here names a
// controller family, and there is no default one: the box builds the device a
// Linux driver would have built for that identity, or a neutral one when it
// knows no driver for it.
//
// # State, not edges
//
// A `State` is the whole controller every time. A lost or reordered edge would
// leave a button held forever; a snapshot can only ever be stale until the next
// one. Button names are positional (south, east, ...), after the kernel's own
// gamepad layout, so no face-button lettering from any one vendor is implied.

/// A controller appeared on the client. Payload:
/// `[slot][bus u16][vendor u16][product u16][version u16][name_len u8][name]`.
pub const PAD_CONNECT: u8 = 0x00;
/// The whole of a controller's state. Payload:
/// `[slot][buttons u32][lx i16][ly i16][rx i16][ry i16][lt u16][rt u16]`.
pub const PAD_STATE: u8 = 0x01;
/// A controller went away. Payload: `[slot]`.
pub const PAD_DISCONNECT: u8 = 0x02;

/// Rumble to play on a client's controller. Payload:
/// `[slot][strong u16][weak u16][duration_ms u16]`. Both magnitudes zero is a
/// stop; a duration of zero plays until the next message for that slot.
pub const PAD_RUMBLE: u8 = 0x80;
/// The box has no controller in this slot: send its `Connect` again. Payload:
/// `[slot]`.
///
/// Asked when state arrives for a slot the box does not know, which is what a
/// client sees after the box's side restarted under it. Re-announcing is
/// cheaper than either end trying to remember the other's view.
pub const PAD_ANNOUNCE: u8 = 0x81;

/// Everything a client had plugged in is gone, because the client is.
///
/// Only ever said by the hub, on the IPC socket: a client that disconnects
/// cannot say it itself, and a controller left behind would still be plugged
/// into the game.
pub const PAD_SESSION_END: u8 = 0x40;

/// Bus numbers, as Linux numbers them. `BUS_UNKNOWN` is a client that could not
/// tell, which is normal on platforms whose controller APIs do not say.
pub const BUS_UNKNOWN: u16 = 0x00;
pub const BUS_USB: u16 = 0x03;
pub const BUS_BLUETOOTH: u16 = 0x05;
pub const BUS_VIRTUAL: u16 = 0x06;

/// The longest name carried. A `Connect` with a longer one is cut at a
/// character boundary.
pub const NAME_MAX: usize = 255;

/// Buttons, as bits of [`PadState::buttons`].
pub mod button {
    pub const SOUTH: u32 = 1 << 0;
    pub const EAST: u32 = 1 << 1;
    pub const NORTH: u32 = 1 << 2;
    pub const WEST: u32 = 1 << 3;
    pub const LEFT_SHOULDER: u32 = 1 << 4;
    pub const RIGHT_SHOULDER: u32 = 1 << 5;
    /// Digital trigger clicks. Sent alongside the analog value, because some
    /// controllers report both and a game may read either.
    pub const LEFT_TRIGGER: u32 = 1 << 6;
    pub const RIGHT_TRIGGER: u32 = 1 << 7;
    pub const SELECT: u32 = 1 << 8;
    pub const START: u32 = 1 << 9;
    pub const MODE: u32 = 1 << 10;
    pub const LEFT_STICK: u32 = 1 << 11;
    pub const RIGHT_STICK: u32 = 1 << 12;
    pub const DPAD_UP: u32 = 1 << 13;
    pub const DPAD_DOWN: u32 = 1 << 14;
    pub const DPAD_LEFT: u32 = 1 << 15;
    pub const DPAD_RIGHT: u32 = 1 << 16;
}

/// Who a controller is, as the client saw it.
///
/// Zero in `bus` or `version` means the client could not tell, not that the
/// device said zero.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PadIdentity {
    pub bus: u16,
    pub vendor: u16,
    pub product: u16,
    pub version: u16,
    pub name: String,
}

/// One controller's whole state.
///
/// Sticks are full-range `i16` with Linux's orientation: positive x is right,
/// positive y is *down*. Triggers are `0..=u16::MAX`, released to fully
/// pulled. The default is a controller nobody is touching.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PadState {
    pub buttons: u32,
    pub left_x: i16,
    pub left_y: i16,
    pub right_x: i16,
    pub right_y: i16,
    pub left_trigger: u16,
    pub right_trigger: u16,
}

/// Client → box.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PadMessage {
    Connect {
        slot: u8,
        identity: PadIdentity,
    },
    State {
        slot: u8,
        state: PadState,
    },
    Disconnect {
        slot: u8,
    },
    /// See [`PAD_SESSION_END`]. Never on the wire from a client.
    SessionEnd,
}

/// Box → client.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PadFeedback {
    Rumble {
        slot: u8,
        strong: u16,
        weak: u16,
        duration_ms: u16,
    },
    Announce {
        slot: u8,
    },
}

fn cut_name(name: &str) -> &str {
    if name.len() <= NAME_MAX {
        return name;
    }
    let mut end = NAME_MAX;
    while !name.is_char_boundary(end) {
        end -= 1;
    }
    &name[..end]
}

impl PadMessage {
    pub fn encode(&self, buf: &mut Vec<u8>) {
        match self {
            Self::Connect { slot, identity } => {
                let name = cut_name(&identity.name);
                buf.reserve(11 + name.len());
                buf.push(PAD_CONNECT);
                buf.push(*slot);
                buf.extend_from_slice(&identity.bus.to_le_bytes());
                buf.extend_from_slice(&identity.vendor.to_le_bytes());
                buf.extend_from_slice(&identity.product.to_le_bytes());
                buf.extend_from_slice(&identity.version.to_le_bytes());
                buf.push(name.len() as u8);
                buf.extend_from_slice(name.as_bytes());
            }
            Self::State { slot, state } => {
                buf.reserve(18);
                buf.push(PAD_STATE);
                buf.push(*slot);
                buf.extend_from_slice(&state.buttons.to_le_bytes());
                for axis in [state.left_x, state.left_y, state.right_x, state.right_y] {
                    buf.extend_from_slice(&axis.to_le_bytes());
                }
                buf.extend_from_slice(&state.left_trigger.to_le_bytes());
                buf.extend_from_slice(&state.right_trigger.to_le_bytes());
            }
            Self::Disconnect { slot } => {
                buf.push(PAD_DISCONNECT);
                buf.push(*slot);
            }
            Self::SessionEnd => buf.push(PAD_SESSION_END),
        }
    }

    /// `None` for anything short, unknown, or with a name that is not UTF-8.
    pub fn decode(data: &[u8]) -> Option<Self> {
        let (&kind, rest) = data.split_first()?;
        match kind {
            PAD_CONNECT => {
                let fixed = rest.get(..10)?;
                let name_len = fixed[9] as usize;
                let name = rest.get(10..10 + name_len)?;
                Some(Self::Connect {
                    slot: fixed[0],
                    identity: PadIdentity {
                        bus: u16::from_le_bytes([fixed[1], fixed[2]]),
                        vendor: u16::from_le_bytes([fixed[3], fixed[4]]),
                        product: u16::from_le_bytes([fixed[5], fixed[6]]),
                        version: u16::from_le_bytes([fixed[7], fixed[8]]),
                        name: std::str::from_utf8(name).ok()?.to_owned(),
                    },
                })
            }
            PAD_STATE => {
                let b = rest.get(..17)?;
                let i16_at = |i: usize| i16::from_le_bytes([b[i], b[i + 1]]);
                let u16_at = |i: usize| u16::from_le_bytes([b[i], b[i + 1]]);
                Some(Self::State {
                    slot: b[0],
                    state: PadState {
                        buttons: u32::from_le_bytes([b[1], b[2], b[3], b[4]]),
                        left_x: i16_at(5),
                        left_y: i16_at(7),
                        right_x: i16_at(9),
                        right_y: i16_at(11),
                        left_trigger: u16_at(13),
                        right_trigger: u16_at(15),
                    },
                })
            }
            PAD_DISCONNECT => Some(Self::Disconnect {
                slot: *rest.first()?,
            }),
            PAD_SESSION_END => Some(Self::SessionEnd),
            _ => None,
        }
    }
}

impl PadFeedback {
    pub fn encode(&self, buf: &mut Vec<u8>) {
        match *self {
            Self::Rumble {
                slot,
                strong,
                weak,
                duration_ms,
            } => {
                buf.reserve(8);
                buf.push(PAD_RUMBLE);
                buf.push(slot);
                buf.extend_from_slice(&strong.to_le_bytes());
                buf.extend_from_slice(&weak.to_le_bytes());
                buf.extend_from_slice(&duration_ms.to_le_bytes());
            }
            Self::Announce { slot } => {
                buf.push(PAD_ANNOUNCE);
                buf.push(slot);
            }
        }
    }

    pub fn decode(data: &[u8]) -> Option<Self> {
        let (&kind, rest) = data.split_first()?;
        match kind {
            PAD_RUMBLE => {
                let b = rest.get(..7)?;
                Some(Self::Rumble {
                    slot: b[0],
                    strong: u16::from_le_bytes([b[1], b[2]]),
                    weak: u16::from_le_bytes([b[3], b[4]]),
                    duration_ms: u16::from_le_bytes([b[5], b[6]]),
                })
            }
            PAD_ANNOUNCE => Some(Self::Announce {
                slot: *rest.first()?,
            }),
            _ => None,
        }
    }
}

// ── Hub ↔ box-side IPC ──────────────────────────────────────────
//
// `[u16 LE len][u32 LE session][message]`, where `len` counts the session and
// the message. The session number is the hub's name for one client, so two
// clients can both have a slot 0 without meeting. It means nothing outside the
// hub's own lifetime.

/// Frame one message for the IPC socket, in either direction.
pub fn encode_ipc(buf: &mut Vec<u8>, session: u32, message: &[u8]) {
    let len = 4 + message.len();
    buf.reserve(2 + len);
    buf.extend_from_slice(&(len as u16).to_le_bytes());
    buf.extend_from_slice(&session.to_le_bytes());
    buf.extend_from_slice(message);
}

/// Split one IPC frame's body (after the length) into session and message.
pub fn decode_ipc(body: &[u8]) -> Option<(u32, &[u8])> {
    let session = u32::from_le_bytes(body.get(..4)?.try_into().ok()?);
    Some((session, &body[4..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round_trip(message: PadMessage) {
        let mut buf = Vec::new();
        message.encode(&mut buf);
        assert_eq!(PadMessage::decode(&buf), Some(message));
    }

    #[test]
    fn every_message_survives_the_wire() {
        round_trip(PadMessage::Connect {
            slot: 3,
            identity: PadIdentity {
                bus: BUS_USB,
                vendor: 0x054c,
                product: 0x09cc,
                version: 0x8111,
                name: "Wireless Controller".into(),
            },
        });
        round_trip(PadMessage::State {
            slot: 15,
            state: PadState {
                buttons: button::SOUTH | button::DPAD_RIGHT,
                left_x: i16::MIN,
                left_y: i16::MAX,
                right_x: -1,
                right_y: 1,
                left_trigger: u16::MAX,
                right_trigger: 7,
            },
        });
        round_trip(PadMessage::Disconnect { slot: 0 });
        round_trip(PadMessage::SessionEnd);
    }

    #[test]
    fn feedback_survives_the_wire() {
        for feedback in [
            PadFeedback::Rumble {
                slot: 2,
                strong: 0xffff,
                weak: 0x1234,
                duration_ms: 250,
            },
            PadFeedback::Announce { slot: 9 },
        ] {
            let mut buf = Vec::new();
            feedback.encode(&mut buf);
            assert_eq!(PadFeedback::decode(&buf), Some(feedback));
        }
    }

    #[test]
    fn a_long_name_is_cut_on_a_character_boundary() {
        // Three bytes per character, so 255 falls exactly on one and 256 would
        // not: a byte cut would produce a name that no longer decodes.
        let name = "コ".repeat(100);
        let mut buf = Vec::new();
        PadMessage::Connect {
            slot: 0,
            identity: PadIdentity {
                bus: 0,
                vendor: 0,
                product: 0,
                version: 0,
                name: format!("x{name}"),
            },
        }
        .encode(&mut buf);
        let Some(PadMessage::Connect { identity, .. }) = PadMessage::decode(&buf) else {
            panic!("did not decode");
        };
        assert!(identity.name.len() <= NAME_MAX);
        assert!(identity.name.starts_with('x'));
    }

    #[test]
    fn anything_short_is_refused_rather_than_read_past() {
        let mut buf = Vec::new();
        PadMessage::State {
            slot: 1,
            state: PadState::default(),
        }
        .encode(&mut buf);
        for len in 0..buf.len() {
            assert_eq!(PadMessage::decode(&buf[..len]), None, "length {len}");
        }
        assert_eq!(PadMessage::decode(&[0x7f, 0]), None);
    }

    #[test]
    fn ipc_frames_carry_their_session() {
        let mut message = Vec::new();
        PadMessage::Disconnect { slot: 4 }.encode(&mut message);
        let mut buf = Vec::new();
        encode_ipc(&mut buf, 0xdead_beef, &message);
        let len = u16::from_le_bytes([buf[0], buf[1]]) as usize;
        assert_eq!(len, buf.len() - 2);
        let (session, body) = decode_ipc(&buf[2..]).unwrap();
        assert_eq!(session, 0xdead_beef);
        assert_eq!(
            PadMessage::decode(body),
            Some(PadMessage::Disconnect { slot: 4 })
        );
    }
}
