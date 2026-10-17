//! Media transport over QUIC datagrams.
//!
//! Video and audio used to have one unidirectional QUIC stream each, and QUIC
//! streams are reliable *and ordered*: a single lost packet stalls every frame
//! queued behind it until the retransmission lands. On a LAN that is invisible.
//! Over the internet, and on mobile especially, frames are never lost but arrive
//! late and bunched, and playback sags with no dropped frame to explain it.
//!
//! Datagrams give up the ordering guarantee on purpose. A lost packet costs the
//! one frame it belonged to and nothing else. The receiver reassembles fragments
//! and decides what to do about the gaps, which is where that decision belongs:
//! for an interactive stream, showing the newer frame and asking for a keyframe
//! beats waiting for the older one every time.
//!
//! Input, cursor and stats stay on reliable streams. They are small, rare, and
//! stateful — a lost key-up is a stuck key.
//!
//! # Wire format
//!
//! ```text
//! [1B kind] [2B frame seq LE] [2B fragment index LE] [2B fragment count LE]
//! [8B sent_us LE] [fragment]
//! ```
//!
//! `sent_us` is when the hub handed the datagram to QUIC, on the sender's
//! [`clock`](crate::clock). Every fragment carries it, so the receiver can
//! measure the path from any one of them (see [`delay`](crate::delay)).
//!
//! The fragments carry a frame *body*: exactly the bytes [`encode_frame`] produces
//! minus its four-byte length prefix, which only a stream needs since a datagram
//! already knows its own length. Reassembled, the body is `[1B type][2B seq][payload]`
//! and parses exactly as it did when it arrived on a stream.
//!
//! The frame's sequence number therefore appears twice: once in the datagram
//! header, where reassembly needs it before the body exists, and once inside the
//! body, where the stream-era parser has always read it. The duplication buys an
//! unchanged frame parser on the far side, which is worth two bytes.
//!
//! [`encode_frame`]: crate::encode_frame

/// kind(1) + frame seq(2) + fragment index(2) + fragment count(2) + sent_us(8).
pub const DGRAM_HDR_LEN: usize = 15;

/// Datagram kinds, a numbering of their own. Video and audio happen to share
/// the numbers of the stream types they replace; later kinds
/// ([`DGRAM_FEEDBACK`], [`crate::window::DGRAM_VIDEO_WINDOW`]) do not follow
/// the stream numbering, and a kind and a stream type with the same value are
/// unrelated.
pub const DGRAM_VIDEO: u8 = 0;
pub const DGRAM_AUDIO: u8 = 1;
/// PyroWave, whose datagrams have a header of their own: see
/// [`crate::pyrowave`].
pub const DGRAM_PYROWAVE: u8 = crate::pyrowave::DGRAM_PYROWAVE;

/// One completed video frame as the client saw it arrive, client to hub on the
/// video connection.
///
/// Sent once per frame, so the hub hears about every frame a round trip after
/// it left rather than once a second. What the hub's rate decision rests on:
/// whether the bottleneck was still busy with the last frame when this one
/// reached it, and how fast it delivered this one's fragments. See nescore's
/// `docs/superpowers/specs/2026-10-16-video-rate-from-the-path-design.md`.
pub const DGRAM_FEEDBACK: u8 = 3;

/// `[1B kind][2B seq][4B bytes][2B fragments][2B first_bytes][8B sent_us]
/// [8B first_arrival_us][4B spread_us][4B first_q_us]`, little-endian.
pub const FEEDBACK_LEN: usize = 35;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct FrameFeedback {
    /// The frame's sequence number.
    pub seq: u16,
    /// Datagram payload bytes that arrived for it, header excluded.
    pub bytes: u32,
    /// Fragments that arrived.
    pub fragments: u16,
    /// Payload bytes of the first fragment to arrive, which the arrival spread
    /// does not cover: the spread starts when it has landed.
    pub first_bytes: u16,
    /// When the hub sent the frame, from its datagrams' `sent_us`.
    pub sent_us: u64,
    /// When the first fragment arrived, on the client's own clock. Only ever
    /// compared with another frame's, never with the hub's clock.
    pub first_arrival_us: u64,
    /// The last fragment's arrival minus the first's.
    pub spread_us: u32,
    /// Queueing delay of the first fragment on the path (`delay`).
    pub first_q_us: u32,
}

pub fn encode_feedback(f: &FrameFeedback) -> [u8; FEEDBACK_LEN] {
    let mut b = [0u8; FEEDBACK_LEN];
    b[0] = DGRAM_FEEDBACK;
    b[1..3].copy_from_slice(&f.seq.to_le_bytes());
    b[3..7].copy_from_slice(&f.bytes.to_le_bytes());
    b[7..9].copy_from_slice(&f.fragments.to_le_bytes());
    b[9..11].copy_from_slice(&f.first_bytes.to_le_bytes());
    b[11..19].copy_from_slice(&f.sent_us.to_le_bytes());
    b[19..27].copy_from_slice(&f.first_arrival_us.to_le_bytes());
    b[27..31].copy_from_slice(&f.spread_us.to_le_bytes());
    b[31..35].copy_from_slice(&f.first_q_us.to_le_bytes());
    b
}

/// `None` for anything that is not a whole feedback datagram.
pub fn decode_feedback(b: &[u8]) -> Option<FrameFeedback> {
    if b.len() < FEEDBACK_LEN || b[0] != DGRAM_FEEDBACK {
        return None;
    }
    let u16_at = |o: usize| u16::from_le_bytes([b[o], b[o + 1]]);
    let u32_at = |o: usize| u32::from_le_bytes(b[o..o + 4].try_into().unwrap());
    let u64_at = |o: usize| u64::from_le_bytes(b[o..o + 8].try_into().unwrap());
    Some(FrameFeedback {
        seq: u16_at(1),
        bytes: u32_at(3),
        fragments: u16_at(7),
        first_bytes: u16_at(9),
        sent_us: u64_at(11),
        first_arrival_us: u64_at(19),
        spread_us: u32_at(27),
        first_q_us: u32_at(31),
    })
}
/// Bounds reassembly work. A 4K keyframe runs to a few hundred fragments at a
/// typical MTU; anything past this did not come from a sender of ours.
pub const MAX_FRAGMENTS_PER_FRAME: usize = 4096;

/// Floor on the usable payload per datagram. If the path cannot carry even this
/// much there is no point fragmenting — a frame would need more pieces than the
/// limit allows long before it arrived.
pub const MIN_DGRAM_PAYLOAD: usize = 64;

/// Datagram buffer headroom to give a connection carrying media, at each end.
///
/// The QUIC defaults are sized for streams, where a sender is paced by flow
/// control. A keyframe is not paced: it is a burst of hundreds of datagrams
/// handed over at once. When a datagram buffer fills, QUIC drops the *oldest*
/// queued datagrams — for a keyframe that means dropping its beginning and
/// delivering a tail that reassembles into nothing, and since every later frame
/// predicts from that keyframe, the stream cannot recover until the next one.
/// Both ends therefore get room well past the largest frame we expect.
pub const DGRAM_BUFFER_BYTES: usize = 4 * 1024 * 1024;

/// How long a receiver holds the pieces of a frame that has not fully arrived.
///
/// This is not a playout deadline: a frame missing a fragment is never going to
/// be shown, so this only bounds how long its pieces occupy memory.
pub const PARTIAL_TIMEOUT_MS: u64 = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DatagramHeader {
    pub kind: u8,
    /// Sequence number of the frame this fragment belongs to.
    pub seq: u16,
    /// This fragment's position within the frame, `0..total`.
    pub index: u16,
    /// How many fragments the whole frame was split into. Always at least 1.
    pub total: u16,
    /// When the sender handed this datagram to QUIC, in microseconds on its
    /// [`clock`](crate::clock).
    pub sent_us: u64,
}

/// Write a datagram header into the first [`DGRAM_HDR_LEN`] bytes of `buf`.
///
/// # Panics
/// If `buf` is shorter than [`DGRAM_HDR_LEN`].
pub fn write_datagram_header(buf: &mut [u8], header: &DatagramHeader) {
    buf[0] = header.kind;
    buf[1..3].copy_from_slice(&header.seq.to_le_bytes());
    buf[3..5].copy_from_slice(&header.index.to_le_bytes());
    buf[5..7].copy_from_slice(&header.total.to_le_bytes());
    buf[7..15].copy_from_slice(&header.sent_us.to_le_bytes());
}

/// Split a received datagram into its header and fragment payload.
///
/// Returns `None` for anything too short or self-inconsistent. A datagram is
/// unauthenticated only in the sense that it may be truncated or corrupt in
/// transit below QUIC's own protection, but a bad `total` would still size an
/// allocation, so it is rejected here rather than trusted downstream.
pub fn decode_datagram(buf: &[u8]) -> Option<(DatagramHeader, &[u8])> {
    if buf.len() < DGRAM_HDR_LEN {
        return None;
    }
    let total = u16::from_le_bytes([buf[5], buf[6]]);
    let index = u16::from_le_bytes([buf[3], buf[4]]);
    if total == 0 || total as usize > MAX_FRAGMENTS_PER_FRAME || index >= total {
        return None;
    }
    let header = DatagramHeader {
        kind: buf[0],
        seq: u16::from_le_bytes([buf[1], buf[2]]),
        index,
        total,
        sent_us: u64::from_le_bytes(buf[7..15].try_into().unwrap()),
    };
    Some((header, &buf[DGRAM_HDR_LEN..]))
}

/// How many datagrams a body of this size needs.
///
/// An empty body still takes one, so that the receiver sees the frame at all.
pub fn fragment_count(body_len: usize, payload_size: usize) -> usize {
    if body_len == 0 || payload_size == 0 {
        return 1;
    }
    body_len.div_ceil(payload_size)
}

/// Compare 16-bit sequence numbers across wraparound: is `a` older than `b`?
///
/// Straight comparison breaks at the wrap — 65535 is older than 0, not newer.
/// Serial arithmetic treats the shorter way round the circle as the true order,
/// which is right as long as the two are less than half a lap apart. At 60fps a
/// half-lap is nine minutes of frames, so that holds for anything the reorder
/// window could plausibly be looking at.
pub fn seq_older_than(a: u16, b: u16) -> bool {
    a != b && b.wrapping_sub(a) < 0x8000
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_roundtrips() {
        let mut buf = [0u8; DGRAM_HDR_LEN + 3];
        let sent = DatagramHeader {
            kind: DGRAM_VIDEO,
            seq: 0xBEEF,
            index: 2,
            total: 7,
            sent_us: 0x0123_4567_89AB_CDEF,
        };
        write_datagram_header(&mut buf, &sent);
        buf[DGRAM_HDR_LEN..].copy_from_slice(&[1, 2, 3]);

        let (header, payload) = decode_datagram(&buf).expect("valid datagram");
        assert_eq!(header, sent);
        assert_eq!(payload, &[1, 2, 3]);
    }

    #[test]
    fn rejects_malformed_headers() {
        assert!(decode_datagram(&[0u8; DGRAM_HDR_LEN - 1]).is_none());

        // total == 0 describes a frame with no fragments.
        let mut buf = [0u8; DGRAM_HDR_LEN];
        write_datagram_header(
            &mut buf,
            &DatagramHeader {
                kind: DGRAM_VIDEO,
                seq: 1,
                index: 0,
                total: 0,
                sent_us: 0,
            },
        );
        assert!(decode_datagram(&buf).is_none());

        // index outside the fragment count.
        write_datagram_header(
            &mut buf,
            &DatagramHeader {
                kind: DGRAM_VIDEO,
                seq: 1,
                index: 4,
                total: 4,
                sent_us: 0,
            },
        );
        assert!(decode_datagram(&buf).is_none());

        // A count that would size an implausible allocation.
        write_datagram_header(
            &mut buf,
            &DatagramHeader {
                kind: DGRAM_VIDEO,
                seq: 1,
                index: 0,
                total: u16::MAX,
                sent_us: 0,
            },
        );
        assert!(decode_datagram(&buf).is_none());
    }

    #[test]
    fn feedback_round_trips() {
        let f = FrameFeedback {
            seq: 0xABCD,
            bytes: 17_000,
            fragments: 15,
            first_bytes: 1_180,
            sent_us: 0x0102_0304_0506_0708,
            first_arrival_us: 0x1112_1314_1516_1718,
            spread_us: 9_800,
            first_q_us: 450,
        };
        let wire = encode_feedback(&f);
        assert_eq!(decode_feedback(&wire), Some(f));
        assert_eq!(decode_feedback(&wire[..FEEDBACK_LEN - 1]), None);
        let mut other = wire;
        other[0] = DGRAM_VIDEO;
        assert_eq!(
            decode_feedback(&other),
            None,
            "a video datagram read as feedback"
        );
    }

    #[test]
    fn empty_body_still_takes_one_fragment() {
        assert_eq!(fragment_count(0, 1000), 1);
        assert_eq!(fragment_count(1, 1000), 1);
        assert_eq!(fragment_count(1000, 1000), 1);
        assert_eq!(fragment_count(1001, 1000), 2);
        assert_eq!(fragment_count(2500, 1000), 3);
    }

    #[test]
    fn a_datagram_body_parses_like_a_stream_frame() {
        // The whole point of reusing the body layout: what comes back out of
        // reassembly goes through the same parser the stream path always used.
        let mut body = Vec::new();
        crate::encode_frame_body(&mut body, crate::MSG_DATA, 42, &[9, 8, 7]);

        let mut framed = Vec::new();
        crate::encode_frame(&mut framed, crate::MSG_DATA, 42, &[9, 8, 7]);
        assert_eq!(
            &framed[4..],
            &body[..],
            "body is the frame minus its prefix"
        );

        let (msg_type, seq, payload) = crate::decode_frame(&body).expect("body parses");
        assert_eq!(msg_type, crate::MSG_DATA);
        assert_eq!(seq, 42);
        assert_eq!(payload, &[9, 8, 7]);
    }

    #[test]
    fn sequence_order_survives_wraparound() {
        assert!(seq_older_than(1, 2));
        assert!(!seq_older_than(2, 1));
        assert!(!seq_older_than(5, 5));

        // Across the wrap, the shorter way round wins.
        assert!(seq_older_than(65535, 0));
        assert!(seq_older_than(65530, 4));
        assert!(!seq_older_than(0, 65535));
    }
}
