// Wire types shared by the components that produce and consume a session's
// media: frames, audio, cursor, input and stats. One definition, so no two ends
// can drift from each other silently.

pub mod datagram;
pub mod delay;
pub mod input;
#[cfg(feature = "lifecycle")]
pub mod lifecycle;
pub mod reliable;
pub mod stats;

/// One connection per kind of traffic, not one connection for everything.
///
/// A QUIC connection is the unit that congestion control, pacing and the
/// datagram send buffer all operate on, so everything sharing one shares a
/// queue. Measured over a 1000-mile link: a video backlog delayed audio and
/// input with it, because a backlog is a property of the connection and video
/// is the only flow large enough to build one. Audio behind a deep video queue
/// was twenty-five times worse for timing than audio behind a shallow one --
/// the same audio, on the same path, ruined by what it was queued behind.
///
/// Splitting them gives each its own congestion controller and its own send
/// buffer, so video can only ever delay video. They compete at a shared
/// bottleneck rather than cooperating, which is the point: audio and input are
/// small and need a share, not a place in line behind a keyframe.
pub const ALPN_VIDEO: &[u8] = b"/nestri/video/1";
pub const ALPN_AUDIO: &[u8] = b"/nestri/audio/1";
pub const ALPN_INPUT: &[u8] = b"/nestri/input/1";
pub const ALPN_CONTROL: &[u8] = b"/nestri/control/1";

/// Every ALPN a hub accepts, for the endpoint builder.
pub const ALPNS: [&[u8]; 4] = [ALPN_VIDEO, ALPN_AUDIO, ALPN_INPUT, ALPN_CONTROL];

/// Which connection an accepted one is, by its ALPN.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Carrier {
    Video,
    Audio,
    Input,
    Control,
}

impl Carrier {
    pub fn from_alpn(alpn: &[u8]) -> Option<Self> {
        match alpn {
            a if a == ALPN_VIDEO => Some(Self::Video),
            a if a == ALPN_AUDIO => Some(Self::Audio),
            a if a == ALPN_INPUT => Some(Self::Input),
            a if a == ALPN_CONTROL => Some(Self::Control),
            _ => None,
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            Self::Video => "video",
            Self::Audio => "audio",
            Self::Input => "input",
            Self::Control => "control",
        }
    }
}

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
pub const MSG_IDR_REQUEST: u8 = 0x10; // request a keyframe (desktop → hub → nescapture)
pub const MSG_ENCODE_SETTINGS: u8 = 0x12; // change encoder settings (desktop → hub → nescapture)
pub const MSG_CLIENT_CAPS: u8 = 0x15; // what the client can decode (desktop → hub → nescapture)
pub const MSG_SURFACE_COLOR: u8 = 0x16; // what the compositor was told a surface is (nescope → nescapture)
/// What the receiver actually got, once a second (desktop → hub).
///
/// The hub cannot see this. Its own view of the path -- RTT, congestion window,
/// whether a datagram send returned an error -- was measured saying the path was
/// healthy while the client was receiving almost nothing, and one reason is
/// structural: `send_datagram` evicts the oldest queued datagrams and returns
/// `Ok`, so the send side has no backpressure signal at all. Only the far end
/// knows what arrived.
pub const MSG_RECEIVER_REPORT: u8 = 0x13;
/// Who decides the bitrate, and the ceiling to decide within (desktop → hub).
pub const MSG_CONTROL_MODE: u8 = 0x14;
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
// still tag IPC frames on the nescapture→hub unix sockets, but over QUIC their
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
/// Everything the client says that is not an input event: keyframe requests,
/// receiver reports, encode settings, control mode.
///
/// Its own stream on its own connection. Input is small and latency-critical
/// and must not wait behind a receiver report, and neither must wait behind
/// video, which is why these live apart from the media connections entirely.
pub const BIDI_CONTROL: u8 = 6;

// Codec IDs
pub const CODEC_H264: u8 = 0;
pub const CODEC_H265: u8 = 1;
pub const CODEC_AV1: u8 = 2;
pub const CODEC_OPUS: u8 = 3;
pub const CODEC_KEEP: u8 = 0xFF; // "keep current" sentinel for dynamic encoder settings

// Rate control modes (encode settings)
pub const RC_CBR: u8 = 0;
pub const RC_CQP: u8 = 1;
/// "Keep current" sentinel, the rate-control counterpart of [`CODEC_KEEP`].
///
/// A settings message says four things at once, and until this existed there
/// was no way to say only one of them: a client wanting a different bit depth
/// had to name a rate control mode and a value too, which in Auto mode means
/// overruling the controller that owns the bitrate.
pub const RC_KEEP: u8 = 0xFF;

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

/// A settings payload that changes the bitrate and nothing else.
///
/// Six bytes rather than seven: the bit-depth byte is *omitted*, which
/// [`decode_encode_settings`] reports as `None`. That matters at the far end,
/// where a change carrying a depth has to be treated as a possible depth change
/// and rebuild the video session -- and a rebuild costs a keyframe. A controller
/// adjusting the bitrate every second must not do that, so it says nothing it
/// does not mean: keep the codec, keep the depth, this bitrate.
pub fn encode_bitrate_only(buf: &mut Vec<u8>, kbps: u32) {
    buf.reserve(6);
    buf.push(CODEC_KEEP);
    buf.push(RC_CBR);
    buf.extend_from_slice(&kbps.to_le_bytes());
}

// ── What colour the compositor was told a surface is ────────────────────

/// SDR: BT.709 primaries, sRGB transfer.
pub const SURFACE_COLOR_SRGB: u8 = 0;
/// HDR10: BT.2020 primaries, PQ transfer.
pub const SURFACE_COLOR_BT2020_PQ: u8 = 1;

/// What a Wayland client declared about its surface's colour.
///
/// Capture normally reads the colour space from the game's Vulkan swapchain,
/// and that is the right source when the swapchain names one. It does not
/// always: `VK_COLOR_SPACE_PASS_THROUGH_EXT` means "do not convert my values"
/// and carries no colour information at all, while the surface's real colour
/// space is declared separately, over `wp_color_manager_v1`, to the
/// compositor. A Windows title turning on HDR through wine arrives exactly
/// that way -- the pixels are BT.2020 PQ and the swapchain says nothing.
///
/// So the compositor, which is told, passes it to capture, which is not.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SurfaceColor {
    /// One of the `SURFACE_COLOR_*` constants.
    pub space: u8,
    /// Mastering metadata, as the client gave it. Zero where it said nothing.
    ///
    /// Carried now and not yet applied: it belongs in the stream's own
    /// metadata, and sending it from the start means that can be wired up
    /// without a second protocol change and a second pin.
    pub max_cll: u32,
    pub max_fall: u32,
    pub min_luminance: u32,
    pub max_luminance: u32,
}

/// Encode a surface colour declaration:
/// `[1B space] [4B max_cll] [4B max_fall] [4B min_lum] [4B max_lum]`, LE.
pub fn encode_surface_color(buf: &mut Vec<u8>, colour: &SurfaceColor) {
    buf.reserve(17);
    buf.push(colour.space);
    buf.extend_from_slice(&colour.max_cll.to_le_bytes());
    buf.extend_from_slice(&colour.max_fall.to_le_bytes());
    buf.extend_from_slice(&colour.min_luminance.to_le_bytes());
    buf.extend_from_slice(&colour.max_luminance.to_le_bytes());
}

/// Decode one. `None` when the payload is too short to be one.
pub fn decode_surface_color(payload: &[u8]) -> Option<SurfaceColor> {
    if payload.len() < 17 {
        return None;
    }
    let u32_at =
        |i: usize| u32::from_le_bytes([payload[i], payload[i + 1], payload[i + 2], payload[i + 3]]);
    Some(SurfaceColor {
        space: payload[0],
        max_cll: u32_at(1),
        max_fall: u32_at(5),
        min_luminance: u32_at(9),
        max_luminance: u32_at(13),
    })
}

// ── What the client can decode ──────────────────────────────────────────

/// The codec and depth combinations a client can decode, as one bitmask.
///
/// A host that picks something the far end cannot decode produces a black
/// screen and no error, so it needs the client's whole set rather than its
/// favourite: knowing only "this one prefers AV1" leaves nowhere to fall back
/// to when the host cannot encode AV1 either.
///
/// Sent once, on connect, before any picture. That is early enough that the
/// host never sends a codec the client cannot read, which reacting to the
/// first frame could not manage.
///
/// One bit per pair, at `codec * 2 + depth`, so the layout follows from the
/// codec ids rather than from a table that can disagree with them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ClientCaps(u16);

/// Best first. The same order the host uses to pick among its own encoders,
/// stated once so the two cannot drift apart.
pub const CODEC_PREFERENCE: [u8; 3] = [CODEC_AV1, CODEC_H265, CODEC_H264];

impl ClientCaps {
    /// Nothing supported. What a client that never spoke is assumed to have,
    /// which is why [`Self::best`] treats an empty set as "no opinion" rather
    /// than as "decodes nothing".
    pub fn empty() -> Self {
        Self(0)
    }

    pub fn from_bits(bits: u16) -> Self {
        Self(bits)
    }

    pub fn bits(self) -> u16 {
        self.0
    }

    pub fn is_empty(self) -> bool {
        self.0 == 0
    }

    fn bit(codec: u8, depth: u8) -> Option<u16> {
        // `CODEC_KEEP` and the audio codec have no place in a video capability
        // set, and shifting by them would be nonsense rather than a small
        // error.
        if !matches!(codec, CODEC_H264 | CODEC_H265 | CODEC_AV1) {
            return None;
        }
        if !matches!(depth, DEPTH_8 | DEPTH_10) {
            return None;
        }
        Some(1u16 << (codec * 2 + depth))
    }

    /// Add one pair. Unknown codecs and depths are ignored rather than
    /// panicking: this is built from what a device probe reported.
    #[must_use]
    pub fn with(mut self, codec: u8, depth: u8) -> Self {
        if let Some(bit) = Self::bit(codec, depth) {
            self.0 |= bit;
        }
        self
    }

    pub fn supports(self, codec: u8, depth: u8) -> bool {
        Self::bit(codec, depth).is_some_and(|bit| self.0 & bit != 0)
    }

    /// Whether this set can decode `codec` at any depth.
    pub fn supports_codec(self, codec: u8) -> bool {
        self.supports(codec, DEPTH_8) || self.supports(codec, DEPTH_10)
    }

    /// The best codec and depth both ends can manage.
    ///
    /// Walks [`CODEC_PREFERENCE`], takes the first codec present in both sets,
    /// and within it prefers ten bits -- deeper coefficients carry less
    /// rounding error through the transform, so it is usually a small win on
    /// efficiency rather than a trade against it.
    ///
    /// `None` when nothing overlaps, which is a real possibility rather than a
    /// theoretical one: an old client that sends no capabilities at all reads
    /// as empty. The caller keeps whatever it was already doing.
    pub fn best(self, host: Self) -> Option<(u8, u8)> {
        if self.is_empty() || host.is_empty() {
            return None;
        }
        for codec in CODEC_PREFERENCE {
            for depth in [DEPTH_10, DEPTH_8] {
                if self.supports(codec, depth) && host.supports(codec, depth) {
                    return Some((codec, depth));
                }
            }
        }
        None
    }
}

/// Encode a capability set: `[2B bits LE]`.
pub fn encode_client_caps(buf: &mut Vec<u8>, caps: ClientCaps) {
    buf.extend_from_slice(&caps.bits().to_le_bytes());
}

/// Decode a capability set. `None` when the payload is too short to be one.
pub fn decode_client_caps(payload: &[u8]) -> Option<ClientCaps> {
    if payload.len() < 2 {
        return None;
    }
    Some(ClientCaps::from_bits(u16::from_le_bytes([
        payload[0], payload[1],
    ])))
}

/// A settings payload that changes the bit depth and nothing else.
///
/// What a client sends once, on connect, to say what it can actually decode.
/// The codec and the rate control are both left alone, so this is safe to send
/// in Auto mode, where the controller owns the bitrate.
///
/// Seven bytes, because the depth byte is the seventh: see
/// [`encode_bitrate_only`] for why its absence means something.
pub fn encode_depth_only(buf: &mut Vec<u8>, bit_depth: u8) {
    encode_encode_settings(buf, CODEC_KEEP, RC_KEEP, 0, bit_depth);
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

// ── Receiver report ─────────────────────────────────────────────

/// What one second looked like from the receiving end.
///
/// Counts are per-second deltas, not totals: a controller wants to know what is
/// happening now, and a total makes every reading depend on how long the session
/// has been running.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ReceiverReport {
    /// Video bits per second actually reassembled and released to the decoder.
    ///
    /// Not what was sent, and not what arrived -- what *completed*. A frame
    /// missing one fragment contributes nothing here, which is right: it
    /// contributed nothing to the picture either. When the sender is saturating
    /// the path this is the measured capacity of it.
    pub goodput_bps: u64,
    /// Frames released to the decoder.
    pub released: u32,
    /// Frames that started arriving and never completed.
    pub incomplete: u32,
    /// Frames no fragment of which ever arrived.
    pub never_arrived: u32,
    /// The receiver's own round-trip estimate, in milliseconds.
    pub rtt_ms: u32,
}

impl ReceiverReport {
    /// The fraction of frames that did not make it, in `0.0..=1.0`.
    ///
    /// `None` when no frames were accounted for at all, which is not the same
    /// as no loss -- a second in which nothing was sent and a second in which
    /// nothing arrived look identical here, and only the caller knows which it
    /// is expecting.
    pub fn loss(&self) -> Option<f32> {
        let total = self.released + self.incomplete + self.never_arrived;
        if total == 0 {
            return None;
        }
        Some((self.incomplete + self.never_arrived) as f32 / total as f32)
    }
}

/// `[8B goodput_bps][4B released][4B incomplete][4B never_arrived][4B rtt_ms]`,
/// all little-endian.
pub const RECEIVER_REPORT_LEN: usize = 24;

pub fn encode_receiver_report(buf: &mut Vec<u8>, report: &ReceiverReport) {
    buf.reserve(RECEIVER_REPORT_LEN);
    buf.extend_from_slice(&report.goodput_bps.to_le_bytes());
    buf.extend_from_slice(&report.released.to_le_bytes());
    buf.extend_from_slice(&report.incomplete.to_le_bytes());
    buf.extend_from_slice(&report.never_arrived.to_le_bytes());
    buf.extend_from_slice(&report.rtt_ms.to_le_bytes());
}

/// Decode a receiver report. `None` when the payload is short.
///
/// A payload *longer* than expected is accepted and its tail ignored, so a newer
/// client that appends a field still reports usefully to an older hub.
pub fn decode_receiver_report(payload: &[u8]) -> Option<ReceiverReport> {
    if payload.len() < RECEIVER_REPORT_LEN {
        return None;
    }
    let u32_at = |o: usize| u32::from_le_bytes(payload[o..o + 4].try_into().unwrap());
    Some(ReceiverReport {
        goodput_bps: u64::from_le_bytes(payload[0..8].try_into().unwrap()),
        released: u32_at(8),
        incomplete: u32_at(12),
        never_arrived: u32_at(16),
        rtt_ms: u32_at(20),
    })
}

// ── Control mode ────────────────────────────────────────────────

/// Who is choosing the bitrate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ControlMode {
    /// The hub's controller decides, within the ceiling.
    #[default]
    Auto,
    /// A person decided, and the controller stands down until told otherwise.
    ///
    /// Kept because it is how this class of bug gets diagnosed at all: the
    /// original "the bitrate is already lowered" report was wrong, and the only
    /// way anyone established that was by setting one by hand and watching the
    /// picture come back.
    Manual,
}

pub const CONTROL_MODE_AUTO: u8 = 0;
pub const CONTROL_MODE_MANUAL: u8 = 1;

/// `[1B mode][4B ceiling_kbps LE]`. A ceiling of 0 means "no opinion, keep
/// whatever the hub was given".
pub const CONTROL_MODE_LEN: usize = 5;

pub fn encode_control_mode(buf: &mut Vec<u8>, mode: ControlMode, ceiling_kbps: u32) {
    buf.reserve(CONTROL_MODE_LEN);
    buf.push(match mode {
        ControlMode::Auto => CONTROL_MODE_AUTO,
        ControlMode::Manual => CONTROL_MODE_MANUAL,
    });
    buf.extend_from_slice(&ceiling_kbps.to_le_bytes());
}

/// Returns `(mode, ceiling_kbps)`; the ceiling is `None` when it was left at 0.
pub fn decode_control_mode(payload: &[u8]) -> Option<(ControlMode, Option<u32>)> {
    if payload.len() < CONTROL_MODE_LEN {
        return None;
    }
    let mode = match payload[0] {
        CONTROL_MODE_AUTO => ControlMode::Auto,
        CONTROL_MODE_MANUAL => ControlMode::Manual,
        // An unknown mode is not a reason to stop controlling the bitrate, and
        // guessing "manual" would silently disable the controller.
        _ => return None,
    };
    let ceiling = u32::from_le_bytes(payload[1..5].try_into().unwrap());
    Some((mode, (ceiling != 0).then_some(ceiling)))
}

#[cfg(test)]
mod media_control_tests {
    use super::*;

    fn report() -> ReceiverReport {
        ReceiverReport {
            goodput_bps: 2_850_000,
            released: 47,
            incomplete: 12,
            never_arrived: 1,
            rtt_ms: 182,
        }
    }

    #[test]
    fn a_report_survives_the_wire() {
        let mut buf = Vec::new();
        encode_receiver_report(&mut buf, &report());
        assert_eq!(buf.len(), RECEIVER_REPORT_LEN);
        assert_eq!(decode_receiver_report(&buf), Some(report()));
    }

    #[test]
    fn a_short_report_is_refused_rather_than_guessed() {
        let mut buf = Vec::new();
        encode_receiver_report(&mut buf, &report());
        for n in 0..RECEIVER_REPORT_LEN {
            assert_eq!(decode_receiver_report(&buf[..n]), None, "{n} bytes");
        }
    }

    #[test]
    fn a_longer_report_is_read_and_its_tail_ignored() {
        // So a newer client that appends a field still reports usefully to a
        // hub that predates it.
        let mut buf = Vec::new();
        encode_receiver_report(&mut buf, &report());
        buf.extend_from_slice(&[0xAA; 8]);
        assert_eq!(decode_receiver_report(&buf), Some(report()));
    }

    #[test]
    fn loss_counts_every_frame_that_did_not_arrive_whole() {
        // An incomplete frame is a lost frame. It cost bandwidth and produced no
        // picture, which is worse than never having been sent.
        let r = ReceiverReport {
            released: 90,
            incomplete: 8,
            never_arrived: 2,
            ..Default::default()
        };
        assert_eq!(r.loss(), Some(0.1));
    }

    #[test]
    fn a_silent_second_has_no_loss_figure() {
        // Nothing sent and nothing arrived look identical from here. Reporting
        // 0% would tell a controller the path is healthy; reporting 100% would
        // tell it to collapse the bitrate. Neither is known, so neither is said.
        assert_eq!(ReceiverReport::default().loss(), None);
    }

    #[test]
    fn total_loss_is_reported_as_total() {
        let r = ReceiverReport {
            released: 0,
            incomplete: 46,
            never_arrived: 14,
            ..Default::default()
        };
        assert_eq!(r.loss(), Some(1.0));
    }

    #[test]
    fn a_control_mode_survives_the_wire() {
        for (mode, ceiling) in [
            (ControlMode::Auto, 8_000u32),
            (ControlMode::Manual, 1_000),
            (ControlMode::Auto, 0),
        ] {
            let mut buf = Vec::new();
            encode_control_mode(&mut buf, mode, ceiling);
            assert_eq!(buf.len(), CONTROL_MODE_LEN);
            assert_eq!(
                decode_control_mode(&buf),
                Some((mode, (ceiling != 0).then_some(ceiling))),
            );
        }
    }

    #[test]
    fn an_unknown_mode_is_refused_rather_than_defaulted() {
        // Defaulting to manual would silently switch the controller off, which
        // is the failure this whole change exists to remove.
        let mut buf = vec![0x7F];
        buf.extend_from_slice(&8_000u32.to_le_bytes());
        assert_eq!(decode_control_mode(&buf), None);
    }

    #[test]
    fn a_surface_colour_survives_the_wire() {
        let colour = SurfaceColor {
            space: SURFACE_COLOR_BT2020_PQ,
            max_cll: 1000,
            max_fall: 400,
            min_luminance: 0,
            max_luminance: 1000,
        };
        let mut buf = Vec::new();
        encode_surface_color(&mut buf, &colour);
        assert_eq!(buf.len(), 17);
        assert_eq!(decode_surface_color(&buf), Some(colour));
    }

    /// A truncated payload is not a surface that is suddenly SDR. Reading one
    /// as though it were would turn a dropped byte into a wrong picture.
    #[test]
    fn a_short_surface_colour_is_not_read() {
        let mut buf = Vec::new();
        encode_surface_color(&mut buf, &SurfaceColor::default());
        for len in 0..17 {
            assert_eq!(decode_surface_color(&buf[..len]), None, "len {len}");
        }
    }

    #[test]
    fn every_message_type_is_its_own_number() {
        // Every type byte that travels on a stream, as `(name, value)`. Listed
        // by hand because the point is to catch a new one colliding with an
        // existing one, and anything derived from the constants would agree
        // with them by construction.
        //
        // `MSG_CLIENT_CAPS` was 0x13 when it was added, which is
        // `MSG_RECEIVER_REPORT`. The hub matches on the type byte and the caps
        // arm came first, so every receiver report would have been read as
        // capabilities - taking away the only measurement the bitrate
        // controller has, silently, on a message sent once per connection.
        let types = [
            ("MSG_DATA", MSG_DATA),
            ("MSG_IDR_REQUEST", MSG_IDR_REQUEST),
            ("MSG_ENCODE_SETTINGS", MSG_ENCODE_SETTINGS),
            ("MSG_CLIENT_CAPS", MSG_CLIENT_CAPS),
            ("MSG_SURFACE_COLOR", MSG_SURFACE_COLOR),
            ("MSG_RECEIVER_REPORT", MSG_RECEIVER_REPORT),
            ("MSG_CONTROL_MODE", MSG_CONTROL_MODE),
            ("MSG_INPUT_BATCH", MSG_INPUT_BATCH),
        ];
        for (i, (name, value)) in types.iter().enumerate() {
            for (other_name, other_value) in &types[i + 1..] {
                assert_ne!(
                    value, other_value,
                    "{name} and {other_name} are both {value:#04x}"
                );
            }
        }
    }

    #[test]
    fn every_codec_and_depth_has_its_own_bit() {
        let all = [CODEC_H264, CODEC_H265, CODEC_AV1]
            .into_iter()
            .flat_map(|c| [DEPTH_8, DEPTH_10].map(move |d| (c, d)));
        let mut seen = Vec::new();
        for (codec, depth) in all {
            let caps = ClientCaps::empty().with(codec, depth);
            assert!(caps.supports(codec, depth));
            assert!(!seen.contains(&caps.bits()), "{codec}/{depth} collides");
            seen.push(caps.bits());
        }
    }

    /// Nothing outside the video codecs belongs in a capability set, and a
    /// shift by `CODEC_KEEP` would be nonsense rather than a small error.
    #[test]
    fn nonsense_pairs_are_ignored_rather_than_stored() {
        let caps = ClientCaps::empty()
            .with(CODEC_KEEP, DEPTH_8)
            .with(CODEC_OPUS, DEPTH_8)
            .with(CODEC_AV1, 7);
        assert!(caps.is_empty());
        assert!(!caps.supports(CODEC_KEEP, DEPTH_8));
    }

    fn host_all() -> ClientCaps {
        ClientCaps::empty()
            .with(CODEC_AV1, DEPTH_8)
            .with(CODEC_AV1, DEPTH_10)
            .with(CODEC_H265, DEPTH_8)
            .with(CODEC_H265, DEPTH_10)
            .with(CODEC_H264, DEPTH_8)
    }

    #[test]
    fn the_best_shared_codec_wins_at_the_deeper_depth() {
        assert_eq!(host_all().best(host_all()), Some((CODEC_AV1, DEPTH_10)));
    }

    /// The case this exists for: a client with no AV1 decoder must not be sent
    /// AV1 just because the host prefers it.
    #[test]
    fn a_client_without_av1_gets_h265() {
        let client = ClientCaps::empty()
            .with(CODEC_H265, DEPTH_8)
            .with(CODEC_H265, DEPTH_10)
            .with(CODEC_H264, DEPTH_8);
        assert_eq!(client.best(host_all()), Some((CODEC_H265, DEPTH_10)));
    }

    #[test]
    fn a_client_with_only_h264_gets_h264() {
        let client = ClientCaps::empty().with(CODEC_H264, DEPTH_8);
        assert_eq!(client.best(host_all()), Some((CODEC_H264, DEPTH_8)));
    }

    /// Ten bits is preferred, not required: a client that decodes H.265 at
    /// eight bits only still gets H.265 rather than being pushed to H.264.
    #[test]
    fn eight_bit_is_taken_when_that_is_all_there_is() {
        let client = ClientCaps::empty()
            .with(CODEC_H265, DEPTH_8)
            .with(CODEC_H264, DEPTH_8);
        assert_eq!(client.best(host_all()), Some((CODEC_H265, DEPTH_8)));
    }

    /// A host that can only encode AV1 and a client that cannot decode it
    /// share nothing. The caller keeps what it was doing rather than picking
    /// something neither end asked for.
    #[test]
    fn no_overlap_is_no_answer() {
        let host = ClientCaps::empty().with(CODEC_AV1, DEPTH_8);
        let client = ClientCaps::empty().with(CODEC_H264, DEPTH_8);
        assert_eq!(client.best(host), None);
    }

    /// A client that never sent capabilities reads as empty, which must mean
    /// "said nothing" and not "decodes nothing".
    #[test]
    fn silence_is_not_an_answer_either() {
        assert_eq!(ClientCaps::empty().best(host_all()), None);
        assert_eq!(host_all().best(ClientCaps::empty()), None);
    }

    #[test]
    fn capabilities_survive_the_wire() {
        let caps = ClientCaps::empty()
            .with(CODEC_AV1, DEPTH_10)
            .with(CODEC_H264, DEPTH_8);
        let mut buf = Vec::new();
        encode_client_caps(&mut buf, caps);
        assert_eq!(decode_client_caps(&buf), Some(caps));
        assert_eq!(decode_client_caps(&buf[..1]), None, "too short to read");
    }

    /// The host walks its own encoders in this order; stating it once is what
    /// keeps the two ends agreeing about what "best" means.
    #[test]
    fn the_preference_order_is_av1_first() {
        assert_eq!(CODEC_PREFERENCE, [CODEC_AV1, CODEC_H265, CODEC_H264]);
    }

    #[test]
    fn a_depth_only_change_touches_nothing_else() {
        let mut buf = Vec::new();
        encode_depth_only(&mut buf, DEPTH_10);
        let (codec, rc, value, depth) = decode_encode_settings(&buf).expect("readable");
        assert_eq!(codec, CODEC_KEEP, "the codec is the host's business");
        assert_eq!(rc, RC_KEEP, "the controller keeps the bitrate it chose");
        assert_eq!(value, 0, "and there is no value to read");
        assert_eq!(depth, Some(DEPTH_10), "the depth is the whole message");
    }

    /// The two sentinels have to be distinguishable from real values, or a
    /// "keep this" reads as a request for something.
    #[test]
    fn the_keep_sentinels_are_not_real_settings() {
        assert_ne!(RC_KEEP, RC_CBR);
        assert_ne!(RC_KEEP, RC_CQP);
        assert_ne!(CODEC_KEEP, CODEC_H264);
        assert_ne!(CODEC_KEEP, CODEC_H265);
        assert_ne!(CODEC_KEEP, CODEC_AV1);
    }

    #[test]
    fn a_bitrate_only_change_carries_no_depth_and_no_codec() {
        // The far end rebuilds its video session -- and spends a keyframe -- for
        // anything that might be a codec or depth change. A controller nudging
        // the bitrate every second must say neither.
        let mut buf = Vec::new();
        encode_bitrate_only(&mut buf, 2_500);
        let (codec, rc, value, depth) = decode_encode_settings(&buf).expect("readable");
        assert_eq!(codec, CODEC_KEEP);
        assert_eq!(rc, RC_CBR);
        assert_eq!(value, 2_500);
        assert_eq!(depth, None, "a depth byte would force a rebuild");
    }

    #[test]
    fn the_new_message_types_do_not_collide() {
        let all = [
            MSG_DATA,
            MSG_IDR_REQUEST,
            MSG_ENCODE_SETTINGS,
            MSG_RECEIVER_REPORT,
            MSG_CONTROL_MODE,
            MSG_INPUT_BATCH,
        ];
        for (i, a) in all.iter().enumerate() {
            for b in &all[i + 1..] {
                assert_ne!(a, b, "two message types share a value");
            }
        }
    }
}
