//! Keyframes on their own reliable QUIC stream.
//!
//! Media travels as datagrams (see the [`datagram`] module for why), which is
//! right for a frame whose worth expires in 16ms and wrong for the one frame
//! every other frame depends on.
//!
//! # Why keyframes are the exception
//!
//! Fragmentation is what makes the asymmetry brutal. A lost datagram costs the
//! whole frame it belonged to, so a frame's chance of arriving falls off with
//! its size. At 1.4% datagram loss — unremarkable for wifi — and a ~993 byte
//! payload:
//!
//! | | fragments | arrives intact |
//! | --- | --- | --- |
//! | inter frame (7.7 KB) | 8 | 89% |
//! | 1080p keyframe (~150 KB) | 155 | **12%** |
//!
//! The largest and most important object on the wire is the one least likely to
//! survive it. And because every later frame predicts from the keyframe, missing
//! one does not cost one frame: the picture stays frozen until the next keyframe
//! gets lucky. At a two second interval, 12% survival means a viewer can sit
//! frozen for tens of seconds on a link that is otherwise fine.
//!
//! Resending on the same path does not help — the retry is refragmented into the
//! same 155 datagrams with the same 12% chance — and a keyframe alone is not
//! enough to resume anyway, since the deltas that followed it reference frames
//! the receiver never got. So the fix is not a resend protocol but a change of
//! transport for the one frame that warrants it.
//!
//! # The shape of it
//!
//! A keyframe goes out on its own short-lived unidirectional stream:
//!
//! ```text
//! [1B STREAM_KEYFRAME] [1B STREAM_VERSION] [frame body]
//! ```
//!
//! The body is byte-for-byte what the datagram path would have carried — the
//! same [`encode_frame_body`] output the fragments reassemble into — so the
//! receiver parses one layout no matter how a frame arrived. It needs no length
//! prefix either: the stream carries exactly one frame and is then finished, so
//! the stream boundary is the message boundary, just as a datagram's length is.
//!
//! QUIC retransmits stream data on its own, so there is no FEC scheme and no
//! NACK protocol to design. The head-of-line blocking that makes per-frame
//! streams unworkable is confined to that one keyframe's stream, while deltas
//! keep flowing on datagrams underneath it. Keyframe survival goes from 12% to
//! effectively 100%, and the cost is that a keyframe under loss is *late* by a
//! retransmit round trip rather than *absent*.
//!
//! # What the receiver has to know
//!
//! That lateness is the part worth planning for. A reliable stream is slower
//! than the datagrams around it — it waits for retransmission, and for flow
//! control — so a keyframe routinely arrives *after* deltas that follow it in
//! sequence. A receiver that discards it as stale, the way a late delta is
//! rightly discarded, would throw away the one frame that can end the freeze.
//! A keyframe is a random-access point, so it is never too late to be useful:
//! release it out of order and let the decoder resynchronise on it.
//!
//! [`datagram`]: crate::datagram
//! [`encode_frame_body`]: crate::encode_frame_body

use crate::{FLAG_KEYFRAME, FLAG_RECONFIG};

/// Ceiling on a keyframe body read from a stream.
///
/// A stream carries no length of its own, so the receiver needs a bound before
/// it starts reading. Generous next to any real keyframe (a 4K one runs to a few
/// hundred KB) and far below anything that would matter as an allocation.
pub const MAX_KEYFRAME_BODY: usize = 8 * 1024 * 1024;

/// How many keyframe streams one sender may have in flight at once.
///
/// Deliberately small. At a two second keyframe interval, needing more than a
/// couple at once means the receiver is not keeping up at all, and piling on
/// more data is the wrong response — the excess falls back to datagrams
/// instead.
pub const MAX_KEYFRAME_STREAMS_IN_FLIGHT: usize = 2;

/// Offset of the flags byte in a video frame payload.
///
/// The payload the hub broadcasts is `[1B codec] [1B flags] [4B ts_ms LE]
/// [2B width LE] [2B height LE] [data]` — see `encode_ipc_frame`, whose header
/// fields these mirror.
pub const VIDEO_PAYLOAD_FLAGS_OFFSET: usize = 1;

/// Whether a video frame payload warrants a reliable stream over datagrams.
///
/// True for a keyframe, and for the reconfiguration frame that follows a codec
/// or bit-depth change: that one carries the parameter sets every frame after it
/// is decoded against, so losing it costs exactly as much as losing a keyframe.
///
/// Only ask this of a *video* payload. Audio has no keyframes, and at this
/// offset an audio packet holds unrelated bytes, so the answer would be
/// meaningless roughly half the time.
pub fn video_wants_reliable(payload: &[u8]) -> bool {
    payload
        .get(VIDEO_PAYLOAD_FLAGS_OFFSET)
        .is_some_and(|flags| flags & (FLAG_KEYFRAME | FLAG_RECONFIG) != 0)
}

/// Whether a video frame payload is a keyframe proper: a point the decoder can
/// start from cold.
///
/// Narrower than [`video_wants_reliable`] on purpose. That one answers a
/// transport question — is this frame worth a reliable stream — and a
/// reconfiguration frame qualifies because losing its parameter sets costs as
/// much as losing a keyframe. This one answers a decoding question, and only a
/// keyframe is an answer to it: a receiver may release a keyframe out of order
/// knowing the decoder will resynchronise, which is not something to assume of
/// a frame merely because it arrived reliably.
pub fn video_is_keyframe(payload: &[u8]) -> bool {
    payload
        .get(VIDEO_PAYLOAD_FLAGS_OFFSET)
        .is_some_and(|flags| flags & FLAG_KEYFRAME != 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CODEC_H264, STREAM_VIDEO, decode_ipc_frame, encode_ipc_frame};

    /// Build the payload the hub broadcasts out of an IPC frame, the way
    /// `ipc_listener` does, so the offset is checked against its real producer
    /// rather than against a hand-written copy of the layout.
    fn broadcast_payload(flags: u8) -> Vec<u8> {
        let ipc = encode_ipc_frame(
            STREAM_VIDEO,
            CODEC_H264,
            flags,
            1234,
            1920,
            1080,
            &[9, 9, 9],
        );
        let decoded = decode_ipc_frame(&ipc).expect("valid ipc frame");
        let mut payload = vec![decoded.codec, decoded.flags];
        payload.extend_from_slice(&decoded.timestamp_ms.to_le_bytes());
        payload.extend_from_slice(&decoded.width.to_le_bytes());
        payload.extend_from_slice(&decoded.height.to_le_bytes());
        payload.extend_from_slice(decoded.data);
        payload
    }

    #[test]
    fn keyframes_and_reconfigs_want_a_stream() {
        assert!(video_wants_reliable(&broadcast_payload(FLAG_KEYFRAME)));
        assert!(video_wants_reliable(&broadcast_payload(FLAG_RECONFIG)));
        assert!(video_wants_reliable(&broadcast_payload(
            FLAG_KEYFRAME | FLAG_RECONFIG
        )));
    }

    #[test]
    fn delta_frames_stay_on_datagrams() {
        assert!(!video_wants_reliable(&broadcast_payload(0)));
        // An unrelated flag in the same byte must not promote a delta frame.
        assert!(!video_wants_reliable(&broadcast_payload(0x80)));
    }

    #[test]
    fn a_reconfig_alone_is_worth_a_stream_but_is_not_a_resync_point() {
        // The transport question and the decoding question have different
        // answers for this frame, which is the reason for two predicates.
        let reconfig = broadcast_payload(FLAG_RECONFIG);
        assert!(video_wants_reliable(&reconfig));
        assert!(!video_is_keyframe(&reconfig));

        let both = broadcast_payload(FLAG_KEYFRAME | FLAG_RECONFIG);
        assert!(video_wants_reliable(&both));
        assert!(video_is_keyframe(&both));
    }

    #[test]
    fn a_payload_too_short_to_have_flags_is_not_a_keyframe() {
        assert!(!video_wants_reliable(&[]));
        assert!(!video_wants_reliable(&[CODEC_H264]));
        assert!(!video_is_keyframe(&[]));
        assert!(!video_is_keyframe(&[CODEC_H264]));
    }
}
