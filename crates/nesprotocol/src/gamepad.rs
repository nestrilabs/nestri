// Gamepads: what the client says about the controllers plugged into it, and
// what the box says back.
//
// Client → box travels as `MSG_GAMEPAD` frames on the input stream, one
// message per frame. Box → client travels as `MSG_GAMEPAD_FEEDBACK` frames on
// the same stream's other half. The hub forwards both without reading them,
// tagged with which client they belong to (see `encode_ipc`).
//
// # Two ways a controller travels
//
// **As the device itself**, wherever the client can open it as HID: its own
// report descriptor on connect, then its raw reports byte for byte, and the
// box recreates the device from them. Nothing on the way interprets a byte, so
// whatever the device is -- and whatever a game expects of it, down to report
// formats games parse by hand -- arrives intact. Requests a game makes of the
// device go back to the real one and its answers come forward.
//
// **As a gamepad**, for a controller the client can only see through its
// platform's gamepad API: its identity on connect, then its whole state as a
// positional snapshot on every change. The box builds the device a Linux
// driver would have built for that identity, or a neutral one when it knows
// none. A snapshot rather than edges, because a lost edge leaves a button held
// forever and a snapshot can only ever be stale until the next one.
//
// Either way the client describes the controller and never chooses one:
// nothing here names a controller family.

/// A controller appeared on the client. Payload:
/// `[slot][bus u16][vendor u16][product u16][version u16][name_len u8][name]`.
pub const PAD_CONNECT: u8 = 0x00;
/// The whole of a controller's state. Payload:
/// `[slot][buttons u32][lx i16][ly i16][rx i16][ry i16][lt u16][rt u16]`.
pub const PAD_STATE: u8 = 0x01;
/// A controller went away, either kind. Payload: `[slot]`.
pub const PAD_DISCONNECT: u8 = 0x02;
/// A controller that travels as the device itself. Payload:
/// `[slot][bus u16][vendor u16][product u16][version u16][country u8]
/// [name_len u8][name][uniq_len u8][uniq][desc_len u16][descriptor]`.
pub const PAD_HID_CONNECT: u8 = 0x03;
/// One input report from it, exactly as the device sent it, report id
/// included where the device numbers its reports. Payload: `[slot][report]`.
pub const PAD_HID_INPUT: u8 = 0x04;
/// The device's answer to a [`PAD_HID_GET_REPORT`] or [`PAD_HID_SET_REPORT`].
/// Payload: `[slot][id u32][err u16][data]`, `err` an errno, zero for success,
/// `data` empty for a set.
pub const PAD_HID_REPLY: u8 = 0x05;

/// Rumble to play on a client's controller. Payload:
/// `[slot][strong u16][weak u16][duration_ms u16]`. Both magnitudes zero is a
/// stop; a duration of zero plays until the next message for that slot.
pub const PAD_RUMBLE: u8 = 0x80;
/// The box has no controller in this slot: send its connect again. Payload:
/// `[slot]`.
///
/// Asked when input arrives for a slot the box does not know, which is what a
/// client sees after the box's side restarted under it. Re-announcing is
/// cheaper than either end trying to remember the other's view.
pub const PAD_ANNOUNCE: u8 = 0x81;
/// A report written to the device by something in the box -- rumble, lights,
/// whatever the device takes -- for the real one. Payload: `[slot][kind][data]`.
pub const PAD_HID_OUTPUT: u8 = 0x82;
/// Read a report from the real device and answer with [`PAD_HID_REPLY`].
/// Payload: `[slot][id u32][number u8][kind u8]`.
pub const PAD_HID_GET_REPORT: u8 = 0x83;
/// Write a report to the real device and answer with [`PAD_HID_REPLY`].
/// Payload: `[slot][id u32][number u8][kind u8][data]`.
pub const PAD_HID_SET_REPORT: u8 = 0x84;

/// Everything a client had plugged in is gone, because the client is.
///
/// Only ever said by the hub, on the IPC socket: a client that disconnects
/// cannot say it itself, and a controller left behind would still be plugged
/// into the game.
pub const PAD_SESSION_END: u8 = 0x40;

/// Report kinds, numbered as Linux's `uhid` numbers them.
pub const REPORT_FEATURE: u8 = 0;
pub const REPORT_OUTPUT: u8 = 1;
pub const REPORT_INPUT: u8 = 2;

/// Bus numbers, as Linux numbers them. `BUS_UNKNOWN` is a client that could not
/// tell, which is normal on platforms whose controller APIs do not say.
pub const BUS_UNKNOWN: u16 = 0x00;
pub const BUS_USB: u16 = 0x03;
pub const BUS_BLUETOOTH: u16 = 0x05;
pub const BUS_VIRTUAL: u16 = 0x06;

/// The longest name carried. A connect with a longer one is cut at a
/// character boundary.
pub const NAME_MAX: usize = 255;

/// The longest report descriptor a device can have, as HID limits it.
pub const DESCRIPTOR_MAX: usize = 4096;

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

/// A controller that travels as the device itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HidDevice {
    pub identity: PadIdentity,
    /// The device's own unique string, where it has one -- a serial, or a
    /// wireless controller's address. Some software pairs a device's parts by
    /// it.
    pub uniq: String,
    /// The HID country code, zero for none.
    pub country: u8,
    /// The report descriptor, exactly as the device gave it.
    pub descriptor: Vec<u8>,
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
    HidConnect {
        slot: u8,
        device: HidDevice,
    },
    HidInput {
        slot: u8,
        report: Vec<u8>,
    },
    HidReply {
        slot: u8,
        id: u32,
        err: u16,
        data: Vec<u8>,
    },
    /// See [`PAD_SESSION_END`]. Never on the wire from a client.
    SessionEnd,
}

/// Box → client.
#[derive(Debug, Clone, PartialEq, Eq)]
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
    HidOutput {
        slot: u8,
        kind: u8,
        data: Vec<u8>,
    },
    HidGetReport {
        slot: u8,
        id: u32,
        number: u8,
        kind: u8,
    },
    HidSetReport {
        slot: u8,
        id: u32,
        number: u8,
        kind: u8,
        data: Vec<u8>,
    },
}

fn cut(name: &str, max: usize) -> &str {
    if name.len() <= max {
        return name;
    }
    let mut end = max;
    while !name.is_char_boundary(end) {
        end -= 1;
    }
    &name[..end]
}

fn put_u16(buf: &mut Vec<u8>, value: u16) {
    buf.extend_from_slice(&value.to_le_bytes());
}

fn put_u32(buf: &mut Vec<u8>, value: u32) {
    buf.extend_from_slice(&value.to_le_bytes());
}

/// A string with a one-byte length, cut to fit.
fn put_short_str(buf: &mut Vec<u8>, value: &str) {
    let value = cut(value, NAME_MAX);
    buf.push(value.len() as u8);
    buf.extend_from_slice(value.as_bytes());
}

fn put_identity(buf: &mut Vec<u8>, identity: &PadIdentity) {
    put_u16(buf, identity.bus);
    put_u16(buf, identity.vendor);
    put_u16(buf, identity.product);
    put_u16(buf, identity.version);
}

/// Reads fields off the front of a message, refusing anything short.
struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let (head, rest) = (self.0.get(..n)?, self.0.get(n..)?);
        self.0 = rest;
        Some(head)
    }

    fn u8(&mut self) -> Option<u8> {
        Some(self.take(1)?[0])
    }

    fn u16(&mut self) -> Option<u16> {
        Some(u16::from_le_bytes(self.take(2)?.try_into().ok()?))
    }

    fn i16(&mut self) -> Option<i16> {
        Some(i16::from_le_bytes(self.take(2)?.try_into().ok()?))
    }

    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }

    fn short_str(&mut self) -> Option<String> {
        let len = self.u8()? as usize;
        Some(std::str::from_utf8(self.take(len)?).ok()?.to_owned())
    }

    fn identity(&mut self) -> Option<(u16, u16, u16, u16)> {
        Some((self.u16()?, self.u16()?, self.u16()?, self.u16()?))
    }

    fn rest(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.0).to_vec()
    }
}

impl PadMessage {
    pub fn encode(&self, buf: &mut Vec<u8>) {
        match self {
            Self::Connect { slot, identity } => {
                buf.push(PAD_CONNECT);
                buf.push(*slot);
                put_identity(buf, identity);
                put_short_str(buf, &identity.name);
            }
            Self::State { slot, state } => {
                buf.reserve(18);
                buf.push(PAD_STATE);
                buf.push(*slot);
                put_u32(buf, state.buttons);
                for axis in [state.left_x, state.left_y, state.right_x, state.right_y] {
                    buf.extend_from_slice(&axis.to_le_bytes());
                }
                put_u16(buf, state.left_trigger);
                put_u16(buf, state.right_trigger);
            }
            Self::Disconnect { slot } => {
                buf.push(PAD_DISCONNECT);
                buf.push(*slot);
            }
            Self::HidConnect { slot, device } => {
                let descriptor = &device.descriptor[..device.descriptor.len().min(DESCRIPTOR_MAX)];
                buf.reserve(16 + device.identity.name.len() + descriptor.len());
                buf.push(PAD_HID_CONNECT);
                buf.push(*slot);
                put_identity(buf, &device.identity);
                buf.push(device.country);
                put_short_str(buf, &device.identity.name);
                put_short_str(buf, &device.uniq);
                put_u16(buf, descriptor.len() as u16);
                buf.extend_from_slice(descriptor);
            }
            Self::HidInput { slot, report } => {
                buf.reserve(2 + report.len());
                buf.push(PAD_HID_INPUT);
                buf.push(*slot);
                buf.extend_from_slice(report);
            }
            Self::HidReply {
                slot,
                id,
                err,
                data,
            } => {
                buf.push(PAD_HID_REPLY);
                buf.push(*slot);
                put_u32(buf, *id);
                put_u16(buf, *err);
                buf.extend_from_slice(data);
            }
            Self::SessionEnd => buf.push(PAD_SESSION_END),
        }
    }

    /// `None` for anything short, unknown, or with a name that is not UTF-8.
    pub fn decode(data: &[u8]) -> Option<Self> {
        let mut r = Reader(data);
        Some(match r.u8()? {
            PAD_CONNECT => {
                let slot = r.u8()?;
                let (bus, vendor, product, version) = r.identity()?;
                let name = r.short_str()?;
                Self::Connect {
                    slot,
                    identity: PadIdentity {
                        bus,
                        vendor,
                        product,
                        version,
                        name,
                    },
                }
            }
            PAD_STATE => Self::State {
                slot: r.u8()?,
                state: PadState {
                    buttons: r.u32()?,
                    left_x: r.i16()?,
                    left_y: r.i16()?,
                    right_x: r.i16()?,
                    right_y: r.i16()?,
                    left_trigger: r.u16()?,
                    right_trigger: r.u16()?,
                },
            },
            PAD_DISCONNECT => Self::Disconnect { slot: r.u8()? },
            PAD_HID_CONNECT => {
                let slot = r.u8()?;
                let (bus, vendor, product, version) = r.identity()?;
                let country = r.u8()?;
                let name = r.short_str()?;
                let uniq = r.short_str()?;
                let len = r.u16()? as usize;
                if len > DESCRIPTOR_MAX {
                    return None;
                }
                let descriptor = r.take(len)?.to_vec();
                Self::HidConnect {
                    slot,
                    device: HidDevice {
                        identity: PadIdentity {
                            bus,
                            vendor,
                            product,
                            version,
                            name,
                        },
                        uniq,
                        country,
                        descriptor,
                    },
                }
            }
            PAD_HID_INPUT => Self::HidInput {
                slot: r.u8()?,
                report: r.rest(),
            },
            PAD_HID_REPLY => Self::HidReply {
                slot: r.u8()?,
                id: r.u32()?,
                err: r.u16()?,
                data: r.rest(),
            },
            PAD_SESSION_END => Self::SessionEnd,
            _ => return None,
        })
    }
}

impl PadFeedback {
    pub fn encode(&self, buf: &mut Vec<u8>) {
        match self {
            Self::Rumble {
                slot,
                strong,
                weak,
                duration_ms,
            } => {
                buf.push(PAD_RUMBLE);
                buf.push(*slot);
                put_u16(buf, *strong);
                put_u16(buf, *weak);
                put_u16(buf, *duration_ms);
            }
            Self::Announce { slot } => {
                buf.push(PAD_ANNOUNCE);
                buf.push(*slot);
            }
            Self::HidOutput { slot, kind, data } => {
                buf.push(PAD_HID_OUTPUT);
                buf.push(*slot);
                buf.push(*kind);
                buf.extend_from_slice(data);
            }
            Self::HidGetReport {
                slot,
                id,
                number,
                kind,
            } => {
                buf.push(PAD_HID_GET_REPORT);
                buf.push(*slot);
                put_u32(buf, *id);
                buf.push(*number);
                buf.push(*kind);
            }
            Self::HidSetReport {
                slot,
                id,
                number,
                kind,
                data,
            } => {
                buf.push(PAD_HID_SET_REPORT);
                buf.push(*slot);
                put_u32(buf, *id);
                buf.push(*number);
                buf.push(*kind);
                buf.extend_from_slice(data);
            }
        }
    }

    pub fn decode(data: &[u8]) -> Option<Self> {
        let mut r = Reader(data);
        Some(match r.u8()? {
            PAD_RUMBLE => Self::Rumble {
                slot: r.u8()?,
                strong: r.u16()?,
                weak: r.u16()?,
                duration_ms: r.u16()?,
            },
            PAD_ANNOUNCE => Self::Announce { slot: r.u8()? },
            PAD_HID_OUTPUT => Self::HidOutput {
                slot: r.u8()?,
                kind: r.u8()?,
                data: r.rest(),
            },
            PAD_HID_GET_REPORT => Self::HidGetReport {
                slot: r.u8()?,
                id: r.u32()?,
                number: r.u8()?,
                kind: r.u8()?,
            },
            PAD_HID_SET_REPORT => Self::HidSetReport {
                slot: r.u8()?,
                id: r.u32()?,
                number: r.u8()?,
                kind: r.u8()?,
                data: r.rest(),
            },
            _ => return None,
        })
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

    fn dualshock_4() -> PadIdentity {
        PadIdentity {
            bus: BUS_USB,
            vendor: 0x054c,
            product: 0x09cc,
            version: 0x8111,
            name: "Wireless Controller".into(),
        }
    }

    #[test]
    fn every_message_survives_the_wire() {
        round_trip(PadMessage::Connect {
            slot: 3,
            identity: dualshock_4(),
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
        round_trip(PadMessage::HidConnect {
            slot: 2,
            device: HidDevice {
                identity: dualshock_4(),
                uniq: "a4:ae:11:69:c8:06".into(),
                country: 0,
                descriptor: (0..=255).cycle().take(DESCRIPTOR_MAX).collect(),
            },
        });
        round_trip(PadMessage::HidInput {
            slot: 2,
            report: vec![0x01, 0x80, 0x80, 0x7f],
        });
        round_trip(PadMessage::HidReply {
            slot: 2,
            id: 77,
            err: 0,
            data: vec![0x02; 37],
        });
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
            PadFeedback::HidOutput {
                slot: 1,
                kind: REPORT_OUTPUT,
                data: vec![0x05, 0xff, 0, 0, 0x40, 0x40],
            },
            PadFeedback::HidGetReport {
                slot: 1,
                id: 9,
                number: 0x02,
                kind: REPORT_FEATURE,
            },
            PadFeedback::HidSetReport {
                slot: 1,
                id: 10,
                number: 0x14,
                kind: REPORT_FEATURE,
                data: vec![0x14, 1, 2],
            },
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
        for message in [
            PadMessage::State {
                slot: 1,
                state: PadState::default(),
            },
            PadMessage::HidConnect {
                slot: 1,
                device: HidDevice {
                    identity: dualshock_4(),
                    uniq: String::new(),
                    country: 0,
                    descriptor: vec![0x05, 0x01],
                },
            },
        ] {
            let mut buf = Vec::new();
            message.encode(&mut buf);
            for len in 0..buf.len() {
                assert_eq!(PadMessage::decode(&buf[..len]), None, "length {len}");
            }
        }
        assert_eq!(PadMessage::decode(&[0x7f, 0]), None);
    }

    #[test]
    fn a_descriptor_longer_than_hid_allows_is_refused() {
        let mut buf = vec![PAD_HID_CONNECT, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        buf.extend_from_slice(&((DESCRIPTOR_MAX + 1) as u16).to_le_bytes());
        buf.resize(buf.len() + DESCRIPTOR_MAX + 1, 0);
        assert_eq!(PadMessage::decode(&buf), None);
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
