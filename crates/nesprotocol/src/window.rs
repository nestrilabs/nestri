//! Windows: one box, several pictures, ref(d-0085).
//!
//! A box runs a person's launches, and every window a launch opens is a video
//! stream of its own. A client connection shows one window: nesktop runs one
//! process per local window, each with its own connections to the hub, each
//! subscribed to one remote window.
//!
//! # Window ids
//!
//! A [`WindowId`] is a `u16`, minted by the box and never reused within one run
//! of it. Two bytes because it rides on every video datagram, next to a frame
//! sequence number that is also two bytes; 65,535 windows in one run of a box
//! is not a limit a person reaches by opening games. Window `0` is *the* window:
//! the first one, and the only one any component knew about before windows had
//! ids. Everything about window `0` is encoded exactly as it was before this
//! module existed, which is the whole compatibility story:
//!
//! - **Old client, new hub.** An old client never sends [`MSG_WINDOW_SUBSCRIBE`],
//!   so the hub treats it as subscribed to window `0`, sends it only window
//!   `0`'s frames, and those are byte-identical to what it always received. It
//!   is never sent a [`STREAM_WINDOWS`] stream either: the hub opens one only
//!   for a client that has subscribed.
//! - **New client, old hub.** The old hub logs [`MSG_WINDOW_SUBSCRIBE`] as an
//!   unknown control message and carries on, sends window `0` in the old
//!   encoding, and never opens a windows stream. A new client therefore treats
//!   "no windows stream" as "a single-window box" and shows what arrives.
//!
//! # Video
//!
//! Frames of window `0` keep [`DGRAM_VIDEO`] and [`MSG_DATA`]. Any other window
//! uses a sibling kind that says "a window id follows":
//!
//! ```text
//! datagram, window 0:  [0x00 DGRAM_VIDEO]        [2B seq][2B index][2B total][8B sent_us]             [fragment]
//! datagram, window n:  [0x04 DGRAM_VIDEO_WINDOW] [2B seq][2B index][2B total][8B sent_us][2B window] [fragment]
//!
//! frame body, window 0: [0x00 MSG_DATA]        [2B seq]             [video payload]
//! frame body, window n: [0x01 MSG_WINDOW_DATA] [2B seq][2B window]  [video payload]
//! ```
//!
//! All integers little-endian. The window id is in both, for the same reason the
//! sequence number is: reassembly needs it before the body exists, and the
//! keyframe stream (see [`reliable`](crate::reliable)) carries a body with no
//! datagram header around it. Sequence numbers count per window.
//!
//! # Window lifecycle (box → hub → client)
//!
//! On a uni stream of its own, `[1B STREAM_WINDOWS][1B STREAM_VERSION]` then
//! length-prefixed frames ([`encode_frame`](crate::encode_frame)), whose type
//! byte is one of the `MSG_WINDOW_*` below and whose seq is unused (0). The hub
//! opens it on the video connection of a client that has subscribed, and starts
//! it with an [`WindowEvent::Opened`] for every window already open, so a
//! client that arrives late learns the box as it stands. Every payload starts
//! with the window id:
//!
//! ```text
//! OPENED 0x20: [2B window][2B width][2B height][2B len][launch id][2B len][title][2B len][app id]
//! TITLE  0x21: [2B window][2B len][title]
//! ICON   0x22: [2B window][2B width][2B height][4B rgba len][rgba, width*height*4]
//! SIZE   0x23: [2B window][2B width][2B height]
//! CLOSED 0x24: [2B window]
//! ```
//!
//! Strings are UTF-8. The launch id is the `lifecycle::LaunchId` the caller minted, so a
//! client knows which launch a window belongs to; the app id is the Wayland
//! `app_id` (X11 `WM_CLASS` under Xwayland). The icon is straight RGBA, the way
//! [`CURSOR_IMAGE`](crate::input::CURSOR_IMAGE) carries a cursor.
//!
//! # What carries no window id
//!
//! - **PyroWave** has a datagram header of its own (see
//!   [`pyrowave`](crate::pyrowave)) and no windowed form: for now it streams
//!   window `0` only. A windowed PyroWave format is future work.
//! - **The keyframe stream** carries the window id only in the body. A client
//!   drops any body, from a datagram or a keyframe stream, whose window id is
//!   not its subscription.
//! - **Feedback, receiver reports and keyframe requests** ([`DGRAM_FEEDBACK`],
//!   [`MSG_RECEIVER_REPORT`], [`MSG_IDR_REQUEST`]) always mean the
//!   connection's subscribed window. A resubscribe resets the connection's
//!   reassembly, loss and rate state: none of it describes the new window.
//!
//! [`DGRAM_FEEDBACK`]: crate::datagram::DGRAM_FEEDBACK
//! [`MSG_RECEIVER_REPORT`]: crate::MSG_RECEIVER_REPORT
//! [`MSG_IDR_REQUEST`]: crate::MSG_IDR_REQUEST
//!
//! # Fragmenting
//!
//! A windowed datagram's header is two bytes longer, so a sender sizes
//! fragments with [`max_fragment_payload`] for the window it is sending, never
//! from `DGRAM_HDR_LEN` alone, or the datagram outgrows the path.
//!
//! # Lifetime of ids and subscriptions
//!
//! Ids do not wrap within a run of a box: a box that has minted 65,535 window
//! ids refuses to open more. When the box restarts its ids mean nothing, and
//! the hub tears down every subscription.
//!
//! # Forward compatibility
//!
//! Every decoder here accepts trailing bytes after the fields it knows, so a
//! later version may append fields to any message.
//!
//! # Subscribing (client → hub)
//!
//! [`MSG_WINDOW_SUBSCRIBE`] `[2B window]` on the control stream
//! ([`BIDI_CONTROL`](crate::BIDI_CONTROL)). A connection that never sends it is
//! subscribed to window `0`. Sending it again moves the subscription. Order on
//! a resubscribe: the hub switches the connection to the new window first, then
//! requests a keyframe for it, since nothing the client holds predicts it; a
//! keyframe requested before the switch could arrive for the old window.
//!
//! # Input
//!
//! Input events stay untagged on the wire from the client: a connection's
//! input belongs to the window that client is subscribed to, and the hub knows
//! which that is. Toward the box the hub tags it, by sending
//! [`INPUT_WINDOW_FOCUS`](crate::input::INPUT_WINDOW_FOCUS) `[0x06][2B window]`
//! in the input stream before any event that comes from a different window than
//! the last one it forwarded. Every event after it, until the next, belongs to
//! that window. Three rules follow:
//!
//! - Nothing that merges events (mouse motion coalescing, batching) may merge
//!   across a focus tag: the events on either side belong to different windows.
//! - Gamepad messages go to the focused window.
//! - nescope resets its current window to `0` when its input IPC reconnects,
//!   so a hub that predates tags is still understood.
//!
//! A client's [`INPUT_OUTPUT_SIZE`](crate::input::INPUT_OUTPUT_SIZE) is
//! rewritten the same way: the hub sends the box
//! [`INPUT_WINDOW_OUTPUT_SIZE`](crate::input::INPUT_WINDOW_OUTPUT_SIZE)
//! `[0x05][2B window][2B width][2B height]`. For window `0` it sends the old
//! `INPUT_OUTPUT_SIZE` instead, so a compositor that predates windows keeps
//! resizing its one output. A client never sends the windowed form.
//!
//! # Cursor
//!
//! No change. The cursor stream goes to a connection and describes the pointer
//! as that connection's window sees it, in that window's coordinates; a
//! client shows one window, so it has one cursor. The hub forwards a cursor
//! update to the clients subscribed to the window it came from, which is the
//! box's business to say on its internal path, not the client's to decode.

use crate::datagram::{decode_datagram, DatagramHeader, DGRAM_HDR_LEN, DGRAM_VIDEO};
use crate::MSG_DATA;

/// Names one window for one run of a box. See the module docs.
pub type WindowId = u16;

/// The window every component knew about before windows had ids.
pub const WINDOW_DEFAULT: WindowId = 0;

/// A video datagram of a window other than `0`: [`DGRAM_VIDEO`] with a window
/// id after the common header.
pub const DGRAM_VIDEO_WINDOW: u8 = 4;

/// Header length of a [`DGRAM_VIDEO_WINDOW`] datagram.
pub const DGRAM_WINDOW_HDR_LEN: usize = DGRAM_HDR_LEN + 2;

/// A video frame body of a window other than `0`: [`MSG_DATA`] with a window
/// id before the payload.
pub const MSG_WINDOW_DATA: u8 = 0x01;

/// Which window this connection shows (client → hub, control stream).
pub const MSG_WINDOW_SUBSCRIBE: u8 = 0x17;

/// Uni stream (hub → client) carrying the `MSG_WINDOW_*` lifecycle messages.
pub const STREAM_WINDOWS: u8 = 8;

pub const MSG_WINDOW_OPENED: u8 = 0x20;
pub const MSG_WINDOW_TITLE: u8 = 0x21;
pub const MSG_WINDOW_ICON: u8 = 0x22;
pub const MSG_WINDOW_SIZE: u8 = 0x23;
pub const MSG_WINDOW_CLOSED: u8 = 0x24;

/// Largest icon accepted, per side. A window icon is a few dozen pixels; this
/// bounds the allocation a corrupt length could ask for.
pub const MAX_ICON_SIDE: u16 = 512;

/// The most fragment bytes a video datagram of `window` can carry when the
/// path takes datagrams of at most `max_dgram` bytes. Zero if not even the
/// header fits.
pub fn max_fragment_payload(window: WindowId, max_dgram: usize) -> usize {
    max_dgram.saturating_sub(video_datagram_header_len(window))
}

/// How long the header of a video datagram of `window` is.
pub fn video_datagram_header_len(window: WindowId) -> usize {
    if window == WINDOW_DEFAULT {
        DGRAM_HDR_LEN
    } else {
        DGRAM_WINDOW_HDR_LEN
    }
}

/// Write a video datagram header for `window` into the start of `buf`, and
/// return its length. `header.kind` is ignored: the kind follows the window.
/// Window `0` writes exactly what
/// [`write_datagram_header`](crate::datagram::write_datagram_header) writes for
/// [`DGRAM_VIDEO`].
///
/// The header is two bytes longer for any other window: size the fragment
/// after it with [`max_fragment_payload`], not from `DGRAM_HDR_LEN`.
///
/// # Panics
/// If `buf` is shorter than [`video_datagram_header_len`].
pub fn write_video_datagram_header(
    buf: &mut [u8],
    header: &DatagramHeader,
    window: WindowId,
) -> usize {
    let kind = if window == WINDOW_DEFAULT {
        DGRAM_VIDEO
    } else {
        DGRAM_VIDEO_WINDOW
    };
    crate::datagram::write_datagram_header(buf, &DatagramHeader { kind, ..*header });
    if window == WINDOW_DEFAULT {
        DGRAM_HDR_LEN
    } else {
        buf[DGRAM_HDR_LEN..DGRAM_WINDOW_HDR_LEN].copy_from_slice(&window.to_le_bytes());
        DGRAM_WINDOW_HDR_LEN
    }
}

/// Split a video datagram of any window into header, window and fragment.
///
/// Accepts [`DGRAM_VIDEO`] (window `0`) and [`DGRAM_VIDEO_WINDOW`], and reports
/// both with `kind == DGRAM_VIDEO` so a receiver has one kind to handle. `None`
/// for any other kind, and for anything [`decode_datagram`] rejects.
pub fn decode_video_datagram(buf: &[u8]) -> Option<(DatagramHeader, WindowId, &[u8])> {
    let (mut header, rest) = decode_datagram(buf)?;
    match header.kind {
        DGRAM_VIDEO => Some((header, WINDOW_DEFAULT, rest)),
        DGRAM_VIDEO_WINDOW => {
            if rest.len() < 2 {
                return None;
            }
            header.kind = DGRAM_VIDEO;
            Some((header, u16::from_le_bytes([rest[0], rest[1]]), &rest[2..]))
        }
        _ => None,
    }
}

/// Build a video frame body for `window`. Window `0` is exactly
/// [`encode_frame_body`](crate::encode_frame_body) with [`MSG_DATA`].
pub fn encode_video_frame_body(buf: &mut Vec<u8>, window: WindowId, seq: u16, payload: &[u8]) {
    if window == WINDOW_DEFAULT {
        crate::encode_frame_body(buf, MSG_DATA, seq, payload);
    } else {
        buf.reserve(5 + payload.len());
        buf.push(MSG_WINDOW_DATA);
        buf.extend_from_slice(&seq.to_le_bytes());
        buf.extend_from_slice(&window.to_le_bytes());
        buf.extend_from_slice(payload);
    }
}

/// Parse a video frame body of any window: `(window, seq, payload)`. `None` for
/// a body of another type or one too short to hold its header.
pub fn decode_video_frame_body(body: &[u8]) -> Option<(WindowId, u16, &[u8])> {
    let (msg_type, seq, rest) = crate::decode_frame(body)?;
    match msg_type {
        MSG_DATA => Some((WINDOW_DEFAULT, seq, rest)),
        MSG_WINDOW_DATA if rest.len() >= 2 => {
            Some((u16::from_le_bytes([rest[0], rest[1]]), seq, &rest[2..]))
        }
        _ => None,
    }
}

/// `[2B window]`, the payload of [`MSG_WINDOW_SUBSCRIBE`].
pub fn encode_subscribe(buf: &mut Vec<u8>, window: WindowId) {
    buf.extend_from_slice(&window.to_le_bytes());
}

pub fn decode_subscribe(payload: &[u8]) -> Option<WindowId> {
    Some(u16::from_le_bytes(payload.get(..2)?.try_into().ok()?))
}

/// What the box says about a window. See the module docs for the bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WindowEvent {
    Opened {
        window: WindowId,
        width: u16,
        height: u16,
        launch_id: String,
        title: String,
        app_id: String,
    },
    Title {
        window: WindowId,
        title: String,
    },
    Icon {
        window: WindowId,
        width: u16,
        height: u16,
        /// `width * height * 4` bytes, row-major, straight (not premultiplied)
        /// alpha.
        rgba: Vec<u8>,
    },
    Size {
        window: WindowId,
        width: u16,
        height: u16,
    },
    Closed {
        window: WindowId,
    },
}

impl WindowEvent {
    pub fn window(&self) -> WindowId {
        match self {
            WindowEvent::Opened { window, .. }
            | WindowEvent::Title { window, .. }
            | WindowEvent::Icon { window, .. }
            | WindowEvent::Size { window, .. }
            | WindowEvent::Closed { window } => *window,
        }
    }

    /// The frame type byte this event travels under.
    pub fn msg_type(&self) -> u8 {
        match self {
            WindowEvent::Opened { .. } => MSG_WINDOW_OPENED,
            WindowEvent::Title { .. } => MSG_WINDOW_TITLE,
            WindowEvent::Icon { .. } => MSG_WINDOW_ICON,
            WindowEvent::Size { .. } => MSG_WINDOW_SIZE,
            WindowEvent::Closed { .. } => MSG_WINDOW_CLOSED,
        }
    }

    /// Append the payload (no type byte). Strings longer than 65,535 bytes are
    /// cut at a character boundary; an icon must be `width * height * 4` bytes
    /// and no wider than [`MAX_ICON_SIDE`], or the receiver drops it.
    pub fn encode_payload(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.window().to_le_bytes());
        match self {
            WindowEvent::Opened {
                width,
                height,
                launch_id,
                title,
                app_id,
                ..
            } => {
                buf.extend_from_slice(&width.to_le_bytes());
                buf.extend_from_slice(&height.to_le_bytes());
                put_str(buf, launch_id);
                put_str(buf, title);
                put_str(buf, app_id);
            }
            WindowEvent::Title { title, .. } => put_str(buf, title),
            WindowEvent::Icon {
                width,
                height,
                rgba,
                ..
            } => {
                debug_assert!(*width <= MAX_ICON_SIDE && *height <= MAX_ICON_SIDE);
                debug_assert_eq!(rgba.len(), *width as usize * *height as usize * 4);
                buf.extend_from_slice(&width.to_le_bytes());
                buf.extend_from_slice(&height.to_le_bytes());
                buf.extend_from_slice(&(rgba.len() as u32).to_le_bytes());
                buf.extend_from_slice(rgba);
            }
            WindowEvent::Size { width, height, .. } => {
                buf.extend_from_slice(&width.to_le_bytes());
                buf.extend_from_slice(&height.to_le_bytes());
            }
            WindowEvent::Closed { .. } => {}
        }
    }

    /// Append a whole length-prefixed frame, as written on [`STREAM_WINDOWS`].
    pub fn encode_frame(&self, buf: &mut Vec<u8>) {
        let mut payload = Vec::new();
        self.encode_payload(&mut payload);
        crate::encode_frame(buf, self.msg_type(), 0, &payload);
    }

    /// Parse a payload of the given frame type. `None` for another type, a
    /// truncated payload, a string that is not UTF-8, or an icon whose size
    /// does not match its pixels.
    pub fn decode(msg_type: u8, payload: &[u8]) -> Option<Self> {
        let mut r = Reader(payload);
        let window = r.u16()?;
        Some(match msg_type {
            MSG_WINDOW_OPENED => WindowEvent::Opened {
                window,
                width: r.u16()?,
                height: r.u16()?,
                launch_id: r.str()?,
                title: r.str()?,
                app_id: r.str()?,
            },
            MSG_WINDOW_TITLE => WindowEvent::Title {
                window,
                title: r.str()?,
            },
            MSG_WINDOW_ICON => {
                let width = r.u16()?;
                let height = r.u16()?;
                let len = r.u32()? as usize;
                if width > MAX_ICON_SIDE
                    || height > MAX_ICON_SIDE
                    || len != width as usize * height as usize * 4
                {
                    return None;
                }
                WindowEvent::Icon {
                    window,
                    width,
                    height,
                    rgba: r.take(len)?.to_vec(),
                }
            }
            MSG_WINDOW_SIZE => WindowEvent::Size {
                window,
                width: r.u16()?,
                height: r.u16()?,
            },
            MSG_WINDOW_CLOSED => WindowEvent::Closed { window },
            _ => return None,
        })
    }
}

// ── Box-internal (nescope → hub) ────────────────────────────────────────────
//
// Carried on the input socket beside the cursor messages, each as one
// length-prefixed message whose first byte is its type, the same way the
// lifecycle events above travel there. Never sent to a client.

/// Window `[2B]` is owned by process `[4B pid]`: how the hub joins an encoder's
/// frames, tagged with its process, to the window they draw.
pub const MSG_WINDOW_PID: u8 = 0x28;

/// The cursor messages after this one describe the pointer as window `[2B]`
/// sees it, until the next. A compositor that never sends it describes
/// window `0`.
pub const MSG_CURSOR_WINDOW: u8 = 0x29;

/// `[MSG_WINDOW_PID][2B window][4B pid]`.
pub fn encode_window_pid(buf: &mut Vec<u8>, window: WindowId, pid: u32) {
    buf.push(MSG_WINDOW_PID);
    buf.extend_from_slice(&window.to_le_bytes());
    buf.extend_from_slice(&pid.to_le_bytes());
}

/// The payload after the type byte of [`MSG_WINDOW_PID`].
pub fn decode_window_pid(payload: &[u8]) -> Option<(WindowId, u32)> {
    let mut r = Reader(payload);
    Some((r.u16()?, r.u32()?))
}

/// `[MSG_CURSOR_WINDOW][2B window]`.
pub fn encode_cursor_window(buf: &mut Vec<u8>, window: WindowId) {
    buf.push(MSG_CURSOR_WINDOW);
    buf.extend_from_slice(&window.to_le_bytes());
}

/// A lifecycle event as one box-internal message: `[type][payload]`.
pub fn encode_event_message(buf: &mut Vec<u8>, event: &WindowEvent) {
    buf.push(event.msg_type());
    event.encode_payload(buf);
}

fn put_str(buf: &mut Vec<u8>, s: &str) {
    let mut end = s.len().min(u16::MAX as usize);
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    buf.extend_from_slice(&(end as u16).to_le_bytes());
    buf.extend_from_slice(&s.as_bytes()[..end]);
}

struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        if self.0.len() < n {
            return None;
        }
        let (head, tail) = self.0.split_at(n);
        self.0 = tail;
        Some(head)
    }
    fn u16(&mut self) -> Option<u16> {
        Some(u16::from_le_bytes(self.take(2)?.try_into().ok()?))
    }
    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }
    fn str(&mut self) -> Option<String> {
        let n = self.u16()? as usize;
        String::from_utf8(self.take(n)?.to_vec()).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::datagram::write_datagram_header;

    fn header() -> DatagramHeader {
        DatagramHeader {
            kind: DGRAM_VIDEO,
            seq: 0xBEEF,
            index: 2,
            total: 7,
            sent_us: 0x0123_4567_89AB_CDEF,
        }
    }

    #[test]
    fn window_zero_datagram_is_the_old_bytes() {
        let mut old = [0u8; DGRAM_HDR_LEN];
        write_datagram_header(&mut old, &header());
        let mut new = [0xAAu8; DGRAM_WINDOW_HDR_LEN];
        let n = write_video_datagram_header(&mut new, &header(), WINDOW_DEFAULT);
        assert_eq!(n, DGRAM_HDR_LEN);
        assert_eq!(video_datagram_header_len(0), DGRAM_HDR_LEN);
        assert_eq!(&new[..n], &old[..]);
    }

    #[test]
    fn video_datagram_round_trips_for_any_window() {
        for window in [0u16, 1, 0x1234, u16::MAX] {
            let mut buf = vec![0u8; video_datagram_header_len(window)];
            let n = write_video_datagram_header(&mut buf, &header(), window);
            assert_eq!(n, buf.len());
            buf.extend_from_slice(&[9, 8, 7]);
            let (h, w, frag) = decode_video_datagram(&buf).expect("decodes");
            assert_eq!(h, header());
            assert_eq!(w, window);
            assert_eq!(frag, &[9, 8, 7]);
        }
    }

    #[test]
    fn windowed_datagram_is_unknown_to_old_kind_checks() {
        let mut buf = [0u8; DGRAM_WINDOW_HDR_LEN];
        write_video_datagram_header(&mut buf, &header(), 3);
        assert_eq!(buf[0], DGRAM_VIDEO_WINDOW);
        assert_ne!(buf[0], DGRAM_VIDEO);
        assert_ne!(buf[0], crate::datagram::DGRAM_AUDIO);
        assert_ne!(buf[0], crate::datagram::DGRAM_PYROWAVE);
        assert_ne!(buf[0], crate::datagram::DGRAM_FEEDBACK);
    }

    #[test]
    fn truncated_video_datagrams_are_rejected() {
        let mut buf = [0u8; DGRAM_WINDOW_HDR_LEN];
        write_video_datagram_header(&mut buf, &header(), 3);
        assert!(decode_video_datagram(&buf[..DGRAM_HDR_LEN + 1]).is_none());
        assert!(decode_video_datagram(&buf[..DGRAM_HDR_LEN - 1]).is_none());
        // Audio is not video.
        let mut audio = [0u8; DGRAM_HDR_LEN];
        write_datagram_header(
            &mut audio,
            &DatagramHeader {
                kind: crate::datagram::DGRAM_AUDIO,
                ..header()
            },
        );
        assert!(decode_video_datagram(&audio).is_none());
    }

    #[test]
    fn window_zero_body_is_the_old_bytes() {
        let mut old = Vec::new();
        crate::encode_frame_body(&mut old, MSG_DATA, 42, &[1, 2, 3]);
        let mut new = Vec::new();
        encode_video_frame_body(&mut new, 0, 42, &[1, 2, 3]);
        assert_eq!(new, old);
    }

    #[test]
    fn video_body_round_trips_for_any_window() {
        for window in [0u16, 7, u16::MAX] {
            let mut body = Vec::new();
            encode_video_frame_body(&mut body, window, 42, &[1, 2, 3]);
            assert_eq!(decode_video_frame_body(&body), Some((window, 42, &[1u8, 2, 3][..])));
        }
        let mut body = Vec::new();
        encode_video_frame_body(&mut body, 7, 42, &[]);
        assert_eq!(decode_video_frame_body(&body), Some((7, 42, &[][..])));
        assert_eq!(decode_video_frame_body(&body[..4]), None);
        assert_eq!(decode_video_frame_body(&body[..2]), None);
        assert_eq!(decode_video_frame_body(&[crate::MSG_IDR_REQUEST, 0, 0]), None);
    }

    #[test]
    fn subscribe_round_trips() {
        let mut b = Vec::new();
        encode_subscribe(&mut b, 0x0302);
        assert_eq!(b, [0x02, 0x03]);
        assert_eq!(decode_subscribe(&b), Some(0x0302));
        assert_eq!(decode_subscribe(&b[..1]), None);
    }

    fn events() -> Vec<WindowEvent> {
        vec![
            WindowEvent::Opened {
                window: 5,
                width: 1920,
                height: 1080,
                launch_id: "launch-1".into(),
                title: "Dome Keeper — ünïcode".into(),
                app_id: "steam_app_1637320".into(),
            },
            WindowEvent::Title {
                window: 5,
                title: "Paused".into(),
            },
            WindowEvent::Icon {
                window: 5,
                width: 2,
                height: 3,
                rgba: (0..24).collect(),
            },
            WindowEvent::Size {
                window: 5,
                width: 1280,
                height: 720,
            },
            WindowEvent::Closed { window: 5 },
        ]
    }

    #[test]
    fn window_events_round_trip_and_reject_truncation() {
        for ev in events() {
            let mut payload = Vec::new();
            ev.encode_payload(&mut payload);
            assert_eq!(WindowEvent::decode(ev.msg_type(), &payload), Some(ev.clone()));
            for cut in 0..payload.len() {
                assert_eq!(
                    WindowEvent::decode(ev.msg_type(), &payload[..cut]),
                    None,
                    "{ev:?} cut at {cut}"
                );
            }

            let mut frame = Vec::new();
            ev.encode_frame(&mut frame);
            let len = u32::from_le_bytes(frame[..4].try_into().unwrap()) as usize;
            assert_eq!(len, frame.len() - 4);
            let (t, seq, p) = crate::decode_frame(&frame[4..]).unwrap();
            assert_eq!((t, seq), (ev.msg_type(), 0));
            assert_eq!(WindowEvent::decode(t, p), Some(ev));
        }
    }

    #[test]
    fn window_event_bytes_are_as_documented() {
        let mut p = Vec::new();
        WindowEvent::Size {
            window: 0x0102,
            width: 0x0304,
            height: 0x0506,
        }
        .encode_payload(&mut p);
        assert_eq!(p, [2, 1, 4, 3, 6, 5]);
        let mut p = Vec::new();
        WindowEvent::Title {
            window: 1,
            title: "ab".into(),
        }
        .encode_payload(&mut p);
        assert_eq!(p, [1, 0, 2, 0, b'a', b'b']);
    }

    #[test]
    fn bad_icons_and_strings_are_rejected() {
        // Pixel count disagrees with the size.
        let mut p = vec![1, 0, 2, 0, 2, 0, 15, 0, 0, 0];
        p.extend_from_slice(&[0; 15]);
        assert_eq!(WindowEvent::decode(MSG_WINDOW_ICON, &p), None);
        // Implausibly large.
        let mut p = Vec::new();
        p.extend_from_slice(&1u16.to_le_bytes());
        p.extend_from_slice(&(MAX_ICON_SIDE + 1).to_le_bytes());
        p.extend_from_slice(&1u16.to_le_bytes());
        p.extend_from_slice(&((MAX_ICON_SIDE as u32 + 1) * 4).to_le_bytes());
        assert_eq!(WindowEvent::decode(MSG_WINDOW_ICON, &p), None);
        // Not UTF-8.
        assert_eq!(
            WindowEvent::decode(MSG_WINDOW_TITLE, &[1, 0, 1, 0, 0xFF]),
            None
        );
        // Unknown type.
        assert_eq!(WindowEvent::decode(0x2F, &[1, 0]), None);
    }

    #[test]
    fn long_strings_are_cut_on_a_char_boundary() {
        let title = "é".repeat(40_000); // 80,000 bytes
        let mut p = Vec::new();
        WindowEvent::Title { window: 1, title }.encode_payload(&mut p);
        match WindowEvent::decode(MSG_WINDOW_TITLE, &p) {
            Some(WindowEvent::Title { title, .. }) => {
                assert!(title.len() <= u16::MAX as usize);
                assert_eq!(title.len() % 2, 0);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn box_internal_input_round_trips() {
        use crate::input::*;
        let mut b = Vec::new();
        encode_window_output_size(&mut b, 3, 1280, 720);
        assert_eq!(b, [5, 3, 0, 0x00, 0x05, 0xD0, 0x02]);
        match decode_input_event(&b) {
            Some(DecodedInput::WindowOutputSize { window: 3, width: 1280, height: 720 }) => {}
            other => panic!("{other:?}"),
        }
        assert!(decode_input_event(&b[..6]).is_none());

        let mut b = Vec::new();
        encode_window_focus(&mut b, 0x0102);
        assert_eq!(b, [6, 2, 1]);
        assert!(matches!(
            decode_input_event(&b),
            Some(DecodedInput::WindowFocus { window: 0x0102 })
        ));
        assert!(decode_input_event(&b[..2]).is_none());

        // The client's own resize event is unchanged.
        let mut b = Vec::new();
        encode_output_size(&mut b, 1280, 720);
        assert_eq!(b, [4, 0x00, 0x05, 0xD0, 0x02]);
    }

    #[test]
    fn fragments_leave_room_for_the_window_id() {
        assert_eq!(max_fragment_payload(0, 1200), 1200 - DGRAM_HDR_LEN);
        assert_eq!(max_fragment_payload(9, 1200), 1200 - DGRAM_WINDOW_HDR_LEN);
        assert_eq!(max_fragment_payload(9, 10), 0);
        // A full fragment plus its header fits exactly.
        let n = max_fragment_payload(9, 1200);
        let mut buf = vec![0u8; video_datagram_header_len(9)];
        write_video_datagram_header(&mut buf, &header(), 9);
        buf.resize(buf.len() + n, 0);
        assert_eq!(buf.len(), 1200);
    }

    #[test]
    fn decoders_accept_trailing_bytes() {
        let mut p = Vec::new();
        WindowEvent::Size { window: 1, width: 2, height: 3 }.encode_payload(&mut p);
        p.extend_from_slice(&[0xEE, 0xEE]);
        assert_eq!(
            WindowEvent::decode(MSG_WINDOW_SIZE, &p),
            Some(WindowEvent::Size { window: 1, width: 2, height: 3 })
        );
        assert_eq!(decode_subscribe(&[4, 0, 0xEE]), Some(4));
    }

    #[test]
    fn box_internal_messages_round_trip() {
        let mut b = Vec::new();
        encode_window_pid(&mut b, 3, 0x0102_0304);
        assert_eq!(b, [MSG_WINDOW_PID, 3, 0, 4, 3, 2, 1]);
        assert_eq!(decode_window_pid(&b[1..]), Some((3, 0x0102_0304)));
        assert_eq!(decode_window_pid(&b[1..6]), None);

        let mut b = Vec::new();
        encode_cursor_window(&mut b, 0x0201);
        assert_eq!(b, [MSG_CURSOR_WINDOW, 1, 2]);
        assert_eq!(decode_subscribe(&b[1..]), Some(0x0201));

        let ev = WindowEvent::Closed { window: 9 };
        let mut b = Vec::new();
        encode_event_message(&mut b, &ev);
        assert_eq!(WindowEvent::decode(b[0], &b[1..]), Some(ev));

        // None of them can be mistaken for what already shares the socket.
        for t in [MSG_WINDOW_PID, MSG_CURSOR_WINDOW, MSG_WINDOW_OPENED, MSG_WINDOW_CLOSED] {
            assert!(t != crate::input::CURSOR_UPDATE && t != crate::input::CURSOR_IMAGE);
            assert!(t > crate::stats::STATS_HUB);
        }
    }

    #[test]
    #[should_panic]
    #[cfg(debug_assertions)]
    fn encoding_a_bad_icon_is_a_bug() {
        let mut p = Vec::new();
        WindowEvent::Icon { window: 1, width: 2, height: 2, rgba: vec![0; 15] }
            .encode_payload(&mut p);
    }
}
