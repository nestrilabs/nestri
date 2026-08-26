// Wire types shared by the components that produce and consume a session's
// media: frames, audio, cursor, input and stats. One definition, so no two ends
// can drift from each other silently.

pub mod datagram;
pub mod input;
pub mod reliable;
pub mod stats;

pub const ALPN: &[u8] = b"/nestri/stream/1";

pub const IPC_MAGIC: [u8; 4] = [b'N', b'S', b'T', b'R'];

pub const IPC_HEADER_LEN: usize = 20;

// ── QUIC stream protocol ────────────────────────────────────────

/// Current protocol version; sent as the 2nd byte on every QUIC stream
/// right after the stream-type byte. Increment on breaking frame-format changes.
///
/// v2 moved video and audio off unidirectional streams and onto QUIC datagrams
/// (see the [`datagram`] module). A v1 peer opens uni streams for media that a
/// v2 peer no longer accepts, so the two cannot interoperate.
///
/// v3 moved keyframes back onto a unidirectional stream each, keeping delta
/// frames on datagrams (see the [`reliable`] module). A v2 receiver ignores a
/// stream type it does not know, so it would receive no keyframes at all and
/// never decode anything — the two cannot interoperate either, and the mismatch
/// is worth reporting rather than presenting as a frozen picture.
pub const STREAM_VERSION: u8 = 3;

/// Uniform frame header overhead: [4B u32 LE frame_len] [1B type] [2B u16 LE seq]
pub const FRAME_HDR_LEN: usize = 7;

/// Types for the type-byte inside a framed message (within a stream).
/// For single-purpose streams (video, audio) the type is redundant but included
/// for uniformity.
pub const MSG_DATA: u8 = 0; // generic data frame (video / audio)
pub const MSG_IDR_REQUEST: u8 = 0x10; // request a keyframe (desktop → hub → hudless)
pub const MSG_ENCODE_SETTINGS: u8 = 0x12; // change encoder settings (desktop → hub → hudless)
pub const MSG_INPUT_BATCH: u8 = 0xFE; // batched input events (desktop → hub)

/// Build a frame body: `[u8 type] [u16 LE seq] [payload]`.
///
/// This is what a datagram carries. A stream needs [`encode_frame`] instead,
/// which is the same bytes behind a length prefix — a stream has no message
/// boundaries of its own, a datagram already knows where it ends.
pub fn encode_frame_body(buf: &mut Vec<u8>, msg_type: u8, seq: u16, payload: &[u8]) {
    buf.reserve(3 + payload.len());
    buf.push(msg_type);
    buf.extend_from_slice(&seq.to_le_bytes());
    buf.extend_from_slice(payload);
}

/// Build a length-prefixed frame: `[u32 LE len = type+seq+payload] [u8 type] [u16 LE seq] [payload]`
pub fn encode_frame(buf: &mut Vec<u8>, msg_type: u8, seq: u16, payload: &[u8]) {
    let frame_len = 1 + 2 + payload.len();
    buf.reserve(4 + frame_len);
    buf.extend_from_slice(&(frame_len as u32).to_le_bytes());
    encode_frame_body(buf, msg_type, seq, payload);
}

/// Decode a frame from raw bytes. Returns `(msg_type, seq_num, payload_slice)`.
pub fn decode_frame(frame: &[u8]) -> Option<(u8, u16, &[u8])> {
    if frame.len() < 3 {
        return None;
    }
    let msg_type = frame[0];
    let seq = u16::from_le_bytes([frame[1], frame[2]]);
    Some((msg_type, seq, &frame[3..]))
}

// ── Stream types ────────────────────────────────────────────────
//
// These name a media kind, not a transport. `STREAM_VIDEO` and `STREAM_AUDIO`
// still tag IPC frames on the hudless→hub unix sockets, but over QUIC their
// media now travels as datagrams; only cursor and stats still open a uni
// stream and send this as its first byte.

pub const STREAM_VIDEO: u8 = 0;
pub const STREAM_AUDIO: u8 = 1;
pub const STREAM_CURSOR: u8 = 3;
pub const STREAM_STATS: u8 = 4;
/// One keyframe, on a stream of its own, closed after it. The exception to
/// "media travels as datagrams" — see the [`reliable`] module for why.
pub const STREAM_KEYFRAME: u8 = 5;

// ── Bidi stream types (desktop ↔ hub over QUIC bidi) ───────────

pub const BIDI_INPUT: u8 = 2; // desktop → hub → nescope (input events)

// Codec IDs
pub const CODEC_H264: u8 = 0;
pub const CODEC_H265: u8 = 1;
pub const CODEC_AV1: u8 = 2;
pub const CODEC_OPUS: u8 = 3;
pub const CODEC_KEEP: u8 = 0xFF; // "keep current" sentinel for dynamic encoder settings

// Rate control modes (encode settings)
pub const RC_CBR: u8 = 0;
pub const RC_CQP: u8 = 1;

// Bit-depth (encode settings)
pub const DEPTH_8: u8 = 0;
pub const DEPTH_10: u8 = 1;

// Video flags (bitfield)
pub const FLAG_KEYFRAME: u8 = 0x01;
pub const FLAG_RECONFIG: u8 = 0x02; // stream reconfiguration (codec/bit-depth change)

/// Encode an IPC frame into a byte buffer.
/// Format: [4B magic] [1B type] [1B codec] [1B flags] [1B reserved] [4B ts_ms LE] [4B w_h LE] [4B len LE] [N data]
pub fn encode_ipc_frame(
    stream_type: u8,
    codec: u8,
    flags: u8,
    timestamp_ms: u32,
    width: u16,
    height: u16,
    data: &[u8],
) -> Vec<u8> {
    let header_len = IPC_HEADER_LEN;
    let mut buf = Vec::with_capacity(header_len + data.len());

    buf.extend_from_slice(&IPC_MAGIC);
    buf.push(stream_type);
    buf.push(codec);
    buf.push(flags);
    buf.push(0); // reserved
    buf.extend_from_slice(&timestamp_ms.to_le_bytes());
    buf.extend_from_slice(&width.to_le_bytes());
    buf.extend_from_slice(&height.to_le_bytes());
    buf.extend_from_slice(&(data.len() as u32).to_le_bytes());
    buf.extend_from_slice(data);

    buf
}

/// Decoded IPC frame.
#[derive(Debug)]
pub struct DecodedIpcFrame<'a> {
    pub stream_type: u8,
    pub codec: u8,
    pub flags: u8,
    pub timestamp_ms: u32,
    pub width: u16,
    pub height: u16,
    pub data: &'a [u8],
}

/// Parse a raw IPC datagram. Returns None if magic doesn't match or buffer is too short.
pub fn decode_ipc_frame(buf: &[u8]) -> Option<DecodedIpcFrame<'_>> {
    if buf.len() < IPC_HEADER_LEN {
        return None;
    }
    if buf[..4] != IPC_MAGIC {
        return None;
    }
    let stream_type = buf[4];
    let codec = buf[5];
    let flags = buf[6];
    let timestamp_ms = u32::from_le_bytes([buf[8], buf[9], buf[10], buf[11]]);
    let width = u16::from_le_bytes([buf[12], buf[13]]);
    let height = u16::from_le_bytes([buf[14], buf[15]]);
    let data_len = u32::from_le_bytes([buf[16], buf[17], buf[18], buf[19]]) as usize;

    if buf.len() < IPC_HEADER_LEN + data_len {
        return None;
    }

    Some(DecodedIpcFrame {
        stream_type,
        codec,
        flags,
        timestamp_ms,
        width,
        height,
        data: &buf[IPC_HEADER_LEN..IPC_HEADER_LEN + data_len],
    })
}

/// Codec ID to human-readable name.
pub fn codec_name(codec: u8) -> &'static str {
    match codec {
        CODEC_H264 => "h264",
        CODEC_H265 => "h265",
        CODEC_AV1 => "av1",
        CODEC_OPUS => "opus",
        _ => "unknown",
    }
}

/// Encode an encode-settings change into a frame payload:
/// `[1B codec_id] [1B rate_control_mode] [4B value LE] [1B bit_depth]`
pub fn encode_encode_settings(
    buf: &mut Vec<u8>,
    codec_id: u8,
    rate_control: u8,
    value: u32,
    bit_depth: u8,
) {
    buf.reserve(7);
    buf.push(codec_id);
    buf.push(rate_control);
    buf.extend_from_slice(&value.to_le_bytes());
    buf.push(bit_depth);
}

/// Decode an encode-settings payload. Returns `(codec_id, rate_control_mode, value, bit_depth)`.
/// bit_depth is None for 6-byte (old client) payloads, Some(n) for 7+ byte payloads.
pub fn decode_encode_settings(payload: &[u8]) -> Option<(u8, u8, u32, Option<u8>)> {
    if payload.len() < 6 {
        return None;
    }
    let codec_id = payload[0];
    let rc = payload[1];
    let value = u32::from_le_bytes([payload[2], payload[3], payload[4], payload[5]]);
    let depth = if payload.len() >= 7 {
        Some(payload[6])
    } else {
        None
    };
    Some((codec_id, rc, value, depth))
}
