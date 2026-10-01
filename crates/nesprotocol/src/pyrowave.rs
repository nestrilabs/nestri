//! Carrying PyroWave, the LAN codec.
//!
//! PyroWave frames are intra-only and already cut into packets that each
//! decode on their own, and its decoder shows a frame that is missing some of
//! them. Everything the hardware-codec path does to survive the internet works
//! against that: byte-slicing a frame across datagrams makes every packet
//! depend on its neighbours' fragments, a reassembler that needs every
//! fragment throws partial frames away, and keyframe streams and resync gates
//! exist for prediction chains PyroWave does not have.
//!
//! So PyroWave gets a path of its own, and this module is all of its logic:
//!
//! - **nescapture → hub:** a frame is a run of IPC messages of whole packets
//!   ([`chunk_frame`]), because one unix datagram cannot hold a frame — the
//!   kernel caps it near 416 KB by default and a frame at 1 Gbit/s is 2 MB.
//!   [`FrameAssembler`] puts them back together at the hub.
//! - **hub → client:** one packet per datagram ([`pack_datagrams`]), never a
//!   slice across two unless a single block is larger than a datagram. The
//!   critical packets go out first and again last, so a burst that eats one
//!   copy usually spares the other.
//! - **client:** [`PyroCollector`] gathers a frame's datagrams and lets it go
//!   whole, or partial once it is plainly not going to complete. Whether a
//!   partial frame is worth decoding is the decoder's question, not this one's.
//!
//! None of it does I/O or reads a clock: time is passed in, so every rule here
//! is tested as a rule.
//!
//! # Selection is opt-in
//!
//! PyroWave runs at hundreds of Mbit/s. Nothing on this side can tell a LAN
//! from a fast WAN, so negotiation never picks it ([`crate::ClientCaps::best`]
//! leaves it out); a session uses it only when the client asks.

use std::collections::VecDeque;
use std::ops::Range;

use crate::datagram::{MIN_DGRAM_PAYLOAD, seq_older_than};
use crate::{CODEC_PYROWAVE, DecodedIpcFrame, STREAM_PYROWAVE, encode_ipc_frame};

/// The PyroWave bitstream this build speaks.
///
/// The bitstream carries no version of its own and upstream marks it draft, so
/// both ends state one here. 1 is upstream `89f7e47`, as frozen by nespyro.
/// Bump it whenever nespyro's bitstream changes; a client with another value is
/// never sent PyroWave.
pub const PYROWAVE_FORMAT: u8 = 1;

/// Chroma format, in encode settings.
pub const CHROMA_420: u8 = 0;
pub const CHROMA_444: u8 = 1;

/// The largest single PyroWave block, in bytes: nespyro's
/// `LARGEST_BLOCK_WORDS * 4`. A packet is at most this or the packet size,
/// whichever is larger, since the packetizer never splits a block.
pub const LARGEST_BLOCK_BYTES: usize = 2488;

/// Most data one IPC message carries, header included.
///
/// Far below the kernel's unix datagram ceiling, so nothing has to be tuned on
/// the box for it, and large enough that a 2 MB frame is a few dozen sends.
pub const IPC_PYROWAVE_MAX: usize = 64 * 1024;

/// `[frame u32][msg index u16][msg count u16][critical u16][packet count u16]`.
pub const IPC_PYRO_HDR_LEN: usize = 12;

/// A frame still incomplete this long after its first message is abandoned.
/// The messages of one frame are written back to back, so a gap this long
/// means the sender stopped halfway.
pub const ABANDON_MS: u64 = 100;

/// Datagram kind, beside `DGRAM_VIDEO` and `DGRAM_AUDIO`.
pub const DGRAM_PYROWAVE: u8 = 2;

/// `[kind][seq u16][index u16][total u16][ts_ms u32][flags]`.
pub const PYRO_DGRAM_HDR_LEN: usize = 12;

/// Bound on datagrams per frame, about 19 MB at a typical MTU. Past it a
/// frame did not come from a sender of ours, and the bound keeps a corrupt
/// `total` from sizing an allocation.
pub const PYRO_MAX_DATAGRAMS: usize = 16384;

/// A second copy of a critical datagram, under the same index.
pub const FLAG_DUPLICATE: u8 = 1 << 0;
/// A piece of one packet too large for a datagram. Pieces take consecutive
/// indexes, from one marked [`FLAG_FIRST_PART`] to one marked
/// [`FLAG_LAST_PART`].
pub const FLAG_PART: u8 = 1 << 1;
pub const FLAG_FIRST_PART: u8 = 1 << 2;
pub const FLAG_LAST_PART: u8 = 1 << 3;
const KNOWN_FLAGS: u8 = FLAG_DUPLICATE | FLAG_PART | FLAG_FIRST_PART | FLAG_LAST_PART;

/// How long a frame waits for stragglers once a newer frame has begun.
///
/// On a LAN, datagrams of one frame do not arrive after the next frame's
/// unless they are lost. A little slack covers reordering inside a NIC queue.
pub const GRACE_US: u64 = 2_000;

/// How long a frame waits once its datagrams stop arriving.
///
/// Measured from the *last* datagram, not the first. A frame on a saturated
/// path takes about a frame interval to arrive by definition — the rate is a
/// frame per interval — so a deadline from its first datagram tears every
/// frame the moment the path is slower than the deadline assumes. Silence
/// says a frame is done arriving whatever the rate; on a LAN its datagrams are
/// microseconds apart while it is still coming.
pub const IDLE_US: u64 = 20_000;

/// Frames in collection at once. More means the receiver is far behind, and
/// the oldest is let go to make room.
pub const MAX_IN_FLIGHT: usize = 8;

// ── IPC ─────────────────────────────────────────────────────────────────

/// The per-frame fields of the IPC header.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct FrameMeta {
    pub ts_ms: u32,
    pub width: u16,
    pub height: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChunkError {
    /// A frame always has at least its sequence header.
    Empty,
    /// More critical packets than packets.
    Critical { critical: usize, packets: usize },
    /// A packet that cannot fit one message, which no packetizer of ours makes.
    PacketTooLarge { index: usize, len: usize },
    /// More messages than the header can count.
    TooLarge { messages: usize },
}

impl std::fmt::Display for ChunkError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Empty => write!(f, "frame has no packets"),
            Self::Critical { critical, packets } => {
                write!(f, "{critical} critical packets of {packets}")
            }
            Self::PacketTooLarge { index, len } => write!(f, "packet {index} is {len} bytes"),
            Self::TooLarge { messages } => write!(f, "frame needs {messages} messages"),
        }
    }
}

impl std::error::Error for ChunkError {}

/// Room for packets in one message, after both headers.
const IPC_PACKET_ROOM: usize = IPC_PYROWAVE_MAX - crate::IPC_HEADER_LEN - IPC_PYRO_HDR_LEN;

/// Cut a frame into IPC messages, each a complete datagram for the video
/// socket.
///
/// `packets` are ranges of `data` in frame order; the first `critical` of them
/// are the ones whose loss the decoder cannot mask.
pub fn chunk_frame(
    frame: u32,
    meta: FrameMeta,
    data: &[u8],
    packets: &[Range<usize>],
    critical: usize,
) -> Result<Vec<Vec<u8>>, ChunkError> {
    if packets.is_empty() {
        return Err(ChunkError::Empty);
    }
    if critical > packets.len() || critical > usize::from(u16::MAX) {
        return Err(ChunkError::Critical {
            critical,
            packets: packets.len(),
        });
    }

    // Decide the cuts first: every message names how many there are.
    let mut cuts = Vec::new();
    let mut used = 0usize;
    for (index, p) in packets.iter().enumerate() {
        let need = 2 + p.len();
        if p.len() > usize::from(u16::MAX) || need > IPC_PACKET_ROOM {
            return Err(ChunkError::PacketTooLarge {
                index,
                len: p.len(),
            });
        }
        if used + need > IPC_PACKET_ROOM {
            cuts.push(index);
            used = 0;
        }
        used += need;
    }
    let count = cuts.len() + 1;
    if count > usize::from(u16::MAX) {
        return Err(ChunkError::TooLarge { messages: count });
    }

    let bounds = std::iter::once(0)
        .chain(cuts.iter().copied())
        .zip(cuts.iter().copied().chain(std::iter::once(packets.len())));
    let mut messages = Vec::with_capacity(count);
    let mut body = Vec::with_capacity(IPC_PYROWAVE_MAX);
    for (index, (start, end)) in bounds.enumerate() {
        body.clear();
        body.extend_from_slice(&frame.to_le_bytes());
        body.extend_from_slice(&(index as u16).to_le_bytes());
        body.extend_from_slice(&(count as u16).to_le_bytes());
        body.extend_from_slice(&(critical as u16).to_le_bytes());
        body.extend_from_slice(&((end - start) as u16).to_le_bytes());
        for p in &packets[start..end] {
            body.extend_from_slice(&(p.len() as u16).to_le_bytes());
            body.extend_from_slice(&data[p.clone()]);
        }
        messages.push(encode_ipc_frame(
            STREAM_PYROWAVE,
            CODEC_PYROWAVE,
            0,
            meta.ts_ms,
            meta.width,
            meta.height,
            &body,
        ));
    }
    Ok(messages)
}

/// A whole frame, as the hub has it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PyroFrame {
    /// The sender's frame counter.
    pub frame: u32,
    pub meta: FrameMeta,
    /// Leading packets whose loss cannot be masked.
    pub critical: usize,
    /// Every packet, back to back.
    pub data: Vec<u8>,
    pub packets: Vec<Range<usize>>,
}

impl PyroFrame {
    pub fn packet(&self, index: usize) -> &[u8] {
        &self.data[self.packets[index].clone()]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssembleError {
    /// Not a PyroWave message at all.
    NotPyroWave,
    /// A PyroWave message that does not parse.
    Malformed(&'static str),
}

impl std::fmt::Display for AssembleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotPyroWave => write!(f, "not a PyroWave message"),
            Self::Malformed(what) => write!(f, "malformed PyroWave message: {what}"),
        }
    }
}

impl std::error::Error for AssembleError {}

struct Partial {
    frame: u32,
    meta: FrameMeta,
    count: u16,
    next: u16,
    critical: u16,
    started_ms: u64,
    data: Vec<u8>,
    packets: Vec<Range<usize>>,
}

/// Puts IPC messages back into frames.
///
/// Messages must arrive in order, which a unix datagram socket with one
/// sender guarantees. A gap therefore means one was dropped — the sender's
/// write timed out — and the frame is abandoned rather than patched: the hub
/// has no business inventing a partial frame the encoder never finished
/// sending. Packets land straight in the frame's buffer, so a frame costs one
/// copy here.
#[derive(Default)]
pub struct FrameAssembler {
    partial: Option<Partial>,
    abandoned: u64,
    /// The frame most recently counted as abandoned, so a frame dropped
    /// mid-way counts once and not once per remaining message.
    last_abandoned: Option<u32>,
}

impl FrameAssembler {
    pub fn new() -> Self {
        Self::default()
    }

    /// Take one message. Returns the frame it completed, if it did.
    pub fn push(
        &mut self,
        ipc: &DecodedIpcFrame<'_>,
        now_ms: u64,
    ) -> Result<Option<PyroFrame>, AssembleError> {
        if ipc.stream_type != STREAM_PYROWAVE || ipc.codec != CODEC_PYROWAVE {
            return Err(AssembleError::NotPyroWave);
        }
        let d = ipc.data;
        if d.len() < IPC_PYRO_HDR_LEN {
            return Err(AssembleError::Malformed("short header"));
        }
        let u16_at = |o: usize| u16::from_le_bytes([d[o], d[o + 1]]);
        let frame = u32::from_le_bytes([d[0], d[1], d[2], d[3]]);
        let index = u16_at(4);
        let count = u16_at(6);
        let critical = u16_at(8);
        let n = usize::from(u16_at(10));
        if count == 0 || index >= count {
            return Err(AssembleError::Malformed("message index outside its count"));
        }

        // Every packet is located before anything is kept, so a message that
        // fails halfway leaves no half of itself behind.
        let mut ranges = Vec::with_capacity(n);
        let mut at = IPC_PYRO_HDR_LEN;
        for _ in 0..n {
            let len_bytes = d
                .get(at..at + 2)
                .ok_or(AssembleError::Malformed("truncated packet length"))?;
            let len = usize::from(u16::from_le_bytes([len_bytes[0], len_bytes[1]]));
            at += 2;
            if at + len > d.len() {
                return Err(AssembleError::Malformed("truncated packet"));
            }
            ranges.push(at..at + len);
            at += len;
        }
        if at != d.len() {
            return Err(AssembleError::Malformed("bytes after the last packet"));
        }

        let meta = FrameMeta {
            ts_ms: ipc.timestamp_ms,
            width: ipc.width,
            height: ipc.height,
        };
        let continues = self.partial.as_ref().is_some_and(|p| {
            p.frame == frame
                && p.next == index
                && p.count == count
                && p.critical == critical
                && p.meta == meta
                && now_ms.saturating_sub(p.started_ms) <= ABANDON_MS
        });
        if !continues {
            if let Some(p) = self.partial.take() {
                self.abandon(p.frame);
            }
            if index != 0 {
                // The middle of a frame whose start is gone.
                self.abandon(frame);
                return Ok(None);
            }
            self.partial = Some(Partial {
                frame,
                meta,
                count,
                next: 0,
                critical,
                started_ms: now_ms,
                data: Vec::new(),
                packets: Vec::new(),
            });
        }

        let p = self.partial.as_mut().expect("set above");
        for r in ranges {
            let start = p.data.len();
            p.data.extend_from_slice(&d[r]);
            p.packets.push(start..p.data.len());
        }
        p.next += 1;
        if p.next < p.count {
            return Ok(None);
        }

        let p = self.partial.take().expect("set above");
        if usize::from(p.critical) > p.packets.len() || p.packets.is_empty() {
            self.abandon(p.frame);
            return Err(AssembleError::Malformed(
                "more critical packets than packets",
            ));
        }
        Ok(Some(PyroFrame {
            frame: p.frame,
            meta: p.meta,
            critical: usize::from(p.critical),
            data: p.data,
            packets: p.packets,
        }))
    }

    fn abandon(&mut self, frame: u32) {
        if self.last_abandoned != Some(frame) {
            self.abandoned += 1;
            self.last_abandoned = Some(frame);
        }
    }

    /// Frames abandoned since the last call.
    pub fn take_abandoned(&mut self) -> u64 {
        std::mem::take(&mut self.abandoned)
    }
}

// ── Datagrams ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PyroDatagramHeader {
    /// The frame, counted by the hub per connection.
    pub seq: u16,
    /// This datagram's place in the frame, `0..total`.
    pub index: u16,
    /// Datagrams in the frame, not counting duplicates.
    pub total: u16,
    pub ts_ms: u32,
    pub flags: u8,
}

/// Write a header into the first [`PYRO_DGRAM_HDR_LEN`] bytes of `buf`.
pub fn write_pyro_header(buf: &mut [u8], h: &PyroDatagramHeader) {
    buf[0] = DGRAM_PYROWAVE;
    buf[1..3].copy_from_slice(&h.seq.to_le_bytes());
    buf[3..5].copy_from_slice(&h.index.to_le_bytes());
    buf[5..7].copy_from_slice(&h.total.to_le_bytes());
    buf[7..11].copy_from_slice(&h.ts_ms.to_le_bytes());
    buf[11] = h.flags;
}

/// Split a PyroWave datagram into header and payload. `None` for anything that
/// is not one or is inconsistent with itself.
pub fn decode_pyro_datagram(buf: &[u8]) -> Option<(PyroDatagramHeader, &[u8])> {
    if buf.len() < PYRO_DGRAM_HDR_LEN || buf[0] != DGRAM_PYROWAVE {
        return None;
    }
    let u16_at = |o: usize| u16::from_le_bytes([buf[o], buf[o + 1]]);
    let h = PyroDatagramHeader {
        seq: u16_at(1),
        index: u16_at(3),
        total: u16_at(5),
        ts_ms: u32::from_le_bytes([buf[7], buf[8], buf[9], buf[10]]),
        flags: buf[11],
    };
    if h.total == 0 || usize::from(h.total) > PYRO_MAX_DATAGRAMS || h.index >= h.total {
        return None;
    }
    if h.flags & !KNOWN_FLAGS != 0 {
        return None;
    }
    if h.flags & FLAG_PART == 0 && h.flags & (FLAG_FIRST_PART | FLAG_LAST_PART) != 0 {
        return None;
    }
    Some((h, &buf[PYRO_DGRAM_HDR_LEN..]))
}

/// A frame laid out as datagrams, in send order, in one buffer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Datagrams {
    pub buf: Vec<u8>,
    /// Each datagram's length, in order; they lie back to back in `buf`.
    pub lens: Vec<usize>,
    /// Datagrams in the frame, as the headers say. `lens.len()` is this plus
    /// the duplicates.
    pub total: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PackError {
    /// The path admits less than a useful payload per datagram.
    PathTooSmall { payload: usize },
    /// More datagrams than a receiver will collect.
    TooMany { datagrams: usize },
}

impl std::fmt::Display for PackError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PathTooSmall { payload } => write!(f, "path admits {payload} bytes a datagram"),
            Self::TooMany { datagrams } => {
                write!(
                    f,
                    "frame needs {datagrams} datagrams, limit {PYRO_MAX_DATAGRAMS}"
                )
            }
        }
    }
}

impl std::error::Error for PackError {}

/// Lay a frame out as datagrams no larger than `max_datagram`.
///
/// One packet per datagram. A packet larger than the payload — only a single
/// oversized block can be, and the hub sizes packets to fit — goes in pieces
/// on consecutive indexes. The critical packets lead the frame, and their
/// datagrams are repeated at the end under the same indexes.
pub fn pack_datagrams(
    seq: u16,
    frame: &PyroFrame,
    max_datagram: usize,
) -> Result<Datagrams, PackError> {
    let payload = max_datagram.saturating_sub(PYRO_DGRAM_HDR_LEN);
    if payload < MIN_DGRAM_PAYLOAD {
        return Err(PackError::PathTooSmall { payload });
    }

    // (packet, byte range within it, flags), one per index.
    let mut entries: Vec<(usize, Range<usize>, u8)> = Vec::with_capacity(frame.packets.len());
    let mut critical_entries = 0;
    for (i, p) in frame.packets.iter().enumerate() {
        let len = p.len();
        if len <= payload {
            entries.push((i, 0..len, 0));
        } else {
            let pieces = len.div_ceil(payload);
            for k in 0..pieces {
                let mut flags = FLAG_PART;
                if k == 0 {
                    flags |= FLAG_FIRST_PART;
                }
                if k == pieces - 1 {
                    flags |= FLAG_LAST_PART;
                }
                entries.push((i, k * payload..((k + 1) * payload).min(len), flags));
            }
        }
        if i < frame.critical {
            critical_entries = entries.len();
        }
    }
    if entries.len() > PYRO_MAX_DATAGRAMS {
        return Err(PackError::TooMany {
            datagrams: entries.len(),
        });
    }
    let total = entries.len() as u16;

    let order = (0..entries.len()).chain(0..critical_entries);
    let sends = entries.len() + critical_entries;
    let bytes: usize = entries.iter().map(|e| e.1.len()).sum::<usize>()
        + entries[..critical_entries]
            .iter()
            .map(|e| e.1.len())
            .sum::<usize>()
        + sends * PYRO_DGRAM_HDR_LEN;
    let mut buf = Vec::with_capacity(bytes);
    let mut lens = Vec::with_capacity(sends);
    let mut header = [0u8; PYRO_DGRAM_HDR_LEN];
    for (n, index) in order.enumerate() {
        let (packet, ref range, flags) = entries[index];
        let duplicate = if n >= entries.len() {
            FLAG_DUPLICATE
        } else {
            0
        };
        write_pyro_header(
            &mut header,
            &PyroDatagramHeader {
                seq,
                index: index as u16,
                total,
                ts_ms: frame.meta.ts_ms,
                flags: flags | duplicate,
            },
        );
        buf.extend_from_slice(&header);
        buf.extend_from_slice(&frame.packet(packet)[range.clone()]);
        lens.push(PYRO_DGRAM_HDR_LEN + range.len());
    }
    Ok(Datagrams { buf, lens, total })
}

// ── Whether to send at all ──────────────────────────────────────────────

/// Why a frame was not sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Skip {
    /// More than a frame is still queued from before.
    Behind,
    /// The frame would not fit beside what is queued.
    NoRoom,
    /// The frame would not fit the send buffer even empty.
    TooLarge,
}

/// Whether a frame of `frame_bytes` should go out on a queue holding
/// `backlog` of a `buffer`-byte send buffer.
///
/// QUIC makes room in a full datagram buffer by evicting the *oldest* queued
/// datagrams and reporting success (see `nestri/docs/media-transport.md`). For
/// PyroWave that is the worst outcome available: the evicted datagrams are the
/// tail of the frame before, and the head of this one may follow them, so two
/// frames are damaged where skipping would have cost one. Every PyroWave frame
/// stands alone, so skipping one is clean, and the queue never holds much more
/// than a frame waiting behind the one going out.
pub fn should_skip(backlog: usize, frame_bytes: usize, buffer: usize) -> Option<Skip> {
    if frame_bytes > buffer {
        Some(Skip::TooLarge)
    } else if backlog > frame_bytes {
        Some(Skip::Behind)
    } else if backlog + frame_bytes > buffer {
        Some(Skip::NoRoom)
    } else {
        None
    }
}

// ── Collection, at the client ───────────────────────────────────────────

/// One packet of a collected frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CollectedPacket<P> {
    /// It arrived in one datagram, and this is that datagram's payload.
    Whole(P),
    /// It arrived in pieces, joined here.
    Joined(Vec<u8>),
}

impl<P: AsRef<[u8]>> AsRef<[u8]> for CollectedPacket<P> {
    fn as_ref(&self) -> &[u8] {
        match self {
            Self::Whole(p) => p.as_ref(),
            Self::Joined(v) => v,
        }
    }
}

/// A frame let go by the collector, whole or not.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CollectedFrame<P> {
    pub seq: u16,
    pub ts_ms: u32,
    /// Datagrams that arrived, out of `total`.
    pub received: u16,
    pub total: u16,
    /// What arrived, in frame order. A packet whose pieces did not all arrive
    /// is not here.
    pub packets: Vec<CollectedPacket<P>>,
}

impl<P> CollectedFrame<P> {
    pub fn is_whole(&self) -> bool {
        self.received == self.total
    }
}

/// What collection looked like, since the last [`PyroCollector::take_stats`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CollectorStats {
    /// Frames let go with every datagram.
    pub whole: u64,
    /// Frames let go with some missing. Not lost — the decoder may well show
    /// them — and not fine either.
    pub partial: u64,
    /// Datagrams that never arrived, across the partial frames.
    pub lost: u64,
    /// Datagrams that arrived when their index already had. Expected: every
    /// critical datagram is sent twice.
    pub duplicates: u64,
    /// Critical copies that filled a hole the first copy left.
    pub recovered: u64,
    /// Datagrams for a frame already let go.
    pub stale: u64,
    /// Datagrams disagreeing with their frame about its size.
    pub inconsistent: u64,
    /// Oversized packets dropped because a piece was missing.
    pub broken_parts: u64,
}

struct Flight<P> {
    seq: u16,
    ts_ms: u32,
    total: u16,
    slots: Vec<Option<(u8, P)>>,
    received: u16,
    /// When its most recent datagram arrived.
    last_us: u64,
    /// When a newer frame began, if one has.
    superseded_us: Option<u64>,
}

impl<P> Flight<P> {
    fn due_at(&self) -> u64 {
        let deadline = self.last_us + IDLE_US;
        match self.superseded_us {
            Some(t) => deadline.min(t + GRACE_US),
            None => deadline,
        }
    }
}

/// Gathers PyroWave datagrams into frames.
///
/// Generic over the payload so the client can keep slices of the datagrams it
/// received rather than copying each into a frame buffer.
pub struct PyroCollector<P> {
    /// In frame order, oldest first.
    flights: VecDeque<Flight<P>>,
    newest_released: Option<u16>,
    stats: CollectorStats,
}

impl<P: AsRef<[u8]>> Default for PyroCollector<P> {
    fn default() -> Self {
        Self::new()
    }
}

impl<P: AsRef<[u8]>> PyroCollector<P> {
    pub fn new() -> Self {
        Self {
            flights: VecDeque::new(),
            newest_released: None,
            stats: CollectorStats::default(),
        }
    }

    /// Take one datagram. Returns every frame now let go, oldest first.
    pub fn push(
        &mut self,
        h: PyroDatagramHeader,
        payload: P,
        now_us: u64,
    ) -> Vec<CollectedFrame<P>> {
        let mut out = self.poll(now_us);

        if let Some(newest) = self.newest_released
            && !seq_older_than(newest, h.seq)
        {
            self.stats.stale += 1;
            return out;
        }

        let pos = match self.flights.iter().position(|f| f.seq == h.seq) {
            Some(pos) => pos,
            None => {
                // Sorted insert. Whatever is older than the new frame has now
                // been overtaken, and the new frame itself is overtaken if it
                // arrived behind a newer one.
                let pos = self
                    .flights
                    .iter()
                    .position(|f| seq_older_than(h.seq, f.seq))
                    .unwrap_or(self.flights.len());
                for f in self.flights.iter_mut().take(pos) {
                    f.superseded_us.get_or_insert(now_us);
                }
                let superseded = (pos < self.flights.len()).then_some(now_us);
                self.flights.insert(
                    pos,
                    Flight {
                        seq: h.seq,
                        ts_ms: h.ts_ms,
                        total: h.total,
                        slots: (0..h.total).map(|_| None).collect(),
                        received: 0,
                        last_us: now_us,
                        superseded_us: superseded,
                    },
                );
                if self.flights.len() > MAX_IN_FLIGHT {
                    self.release_through(0, &mut out);
                    pos - 1
                } else {
                    pos
                }
            }
        };

        let flight = &mut self.flights[pos];
        flight.last_us = now_us;
        if flight.total != h.total {
            self.stats.inconsistent += 1;
            return out;
        }
        let slot = &mut flight.slots[usize::from(h.index)];
        if slot.is_some() {
            self.stats.duplicates += 1;
            return out;
        }
        if h.flags & FLAG_DUPLICATE != 0 {
            self.stats.recovered += 1;
        }
        *slot = Some((h.flags & !FLAG_DUPLICATE, payload));
        flight.received += 1;

        if flight.received == flight.total {
            self.release_through(pos, &mut out);
        }
        out
    }

    /// Let go of every frame whose time is up.
    pub fn poll(&mut self, now_us: u64) -> Vec<CollectedFrame<P>> {
        let mut out = Vec::new();
        // A due frame takes every older one with it: frames leave in order.
        if let Some(last) = self.flights.iter().rposition(|f| f.due_at() <= now_us) {
            self.release_through(last, &mut out);
        }
        out
    }

    /// When [`Self::poll`] next has something to do, if ever.
    pub fn next_deadline(&self) -> Option<u64> {
        self.flights.iter().map(Flight::due_at).min()
    }

    pub fn take_stats(&mut self) -> CollectorStats {
        std::mem::take(&mut self.stats)
    }

    fn release_through(&mut self, pos: usize, out: &mut Vec<CollectedFrame<P>>) {
        for _ in 0..=pos {
            let flight = self.flights.pop_front().expect("pos is in range");
            self.newest_released = Some(flight.seq);
            let frame = self.finish(flight);
            out.push(frame);
        }
    }

    fn finish(&mut self, flight: Flight<P>) -> CollectedFrame<P> {
        if flight.received == flight.total {
            self.stats.whole += 1;
        } else {
            self.stats.partial += 1;
            self.stats.lost += u64::from(flight.total - flight.received);
        }

        let mut packets = Vec::new();
        let mut slots = flight.slots.into_iter().peekable();
        while let Some(slot) = slots.next() {
            let Some((flags, payload)) = slot else {
                continue;
            };
            if flags & FLAG_PART == 0 {
                packets.push(CollectedPacket::Whole(payload));
                continue;
            }
            if flags & FLAG_FIRST_PART == 0 {
                // The run's start is gone; skip what is left of it.
                self.stats.broken_parts += 1;
                while let Some(Some((f, _))) = slots.peek()
                    && f & FLAG_PART != 0
                    && f & FLAG_FIRST_PART == 0
                {
                    slots.next();
                }
                continue;
            }
            let mut joined = payload.as_ref().to_vec();
            let mut done = flags & FLAG_LAST_PART != 0;
            while !done {
                match slots.peek() {
                    Some(Some((f, _))) if f & FLAG_PART != 0 && f & FLAG_FIRST_PART == 0 => {
                        let (f, p) = slots.next().flatten().expect("peeked");
                        joined.extend_from_slice(p.as_ref());
                        done = f & FLAG_LAST_PART != 0;
                    }
                    _ => break,
                }
            }
            if done {
                packets.push(CollectedPacket::Joined(joined));
            } else {
                self.stats.broken_parts += 1;
                // A missing piece leaves the rest of the run orphaned. Skip it
                // here, so the same packet is not counted broken twice.
                loop {
                    match slots.peek() {
                        Some(None) => {}
                        Some(Some((f, _))) if f & FLAG_PART != 0 && f & FLAG_FIRST_PART == 0 => {}
                        _ => break,
                    }
                    slots.next();
                }
            }
        }

        CollectedFrame {
            seq: flight.seq,
            ts_ms: flight.ts_ms,
            received: flight.received,
            total: flight.total,
            packets,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::decode_ipc_frame;

    /// A frame of `n` packets of the given sizes, each filled with its own
    /// index so a misplaced byte shows.
    fn frame_of(sizes: &[usize], critical: usize) -> PyroFrame {
        let mut data = Vec::new();
        let mut packets = Vec::new();
        for (i, &len) in sizes.iter().enumerate() {
            let start = data.len();
            data.extend((0..len).map(|k| (i * 31 + k) as u8));
            packets.push(start..data.len());
        }
        PyroFrame {
            frame: 7,
            meta: FrameMeta {
                ts_ms: 1234,
                width: 1920,
                height: 1080,
            },
            critical,
            data,
            packets,
        }
    }

    fn roundtrip_ipc(frame: &PyroFrame) -> (usize, PyroFrame) {
        let messages = chunk_frame(
            frame.frame,
            frame.meta,
            &frame.data,
            &frame.packets,
            frame.critical,
        )
        .expect("chunks");
        let mut asm = FrameAssembler::new();
        let mut done = None;
        for (i, m) in messages.iter().enumerate() {
            assert!(
                m.len() <= IPC_PYROWAVE_MAX,
                "message {i} is {} bytes",
                m.len()
            );
            let ipc = decode_ipc_frame(m).expect("valid ipc");
            let got = asm.push(&ipc, 0).expect("assembles");
            assert_eq!(got.is_some(), i == messages.len() - 1);
            done = got.or(done);
        }
        (messages.len(), done.expect("completed"))
    }

    #[test]
    fn a_frame_survives_the_socket() {
        let frame = frame_of(&[8, 1200, 1200, 37, 2488, 1200], 2);
        let (messages, back) = roundtrip_ipc(&frame);
        assert_eq!(messages, 1);
        assert_eq!(back, frame);
    }

    /// The reason the socket carries more than one message per frame.
    #[test]
    fn a_frame_far_past_one_datagram_survives_the_socket() {
        let sizes: Vec<usize> = (0..4000).map(|i| 900 + (i * 7) % 600).collect();
        let frame = frame_of(&sizes, 3);
        assert!(frame.data.len() > 4 * 1024 * 1024);
        let (messages, back) = roundtrip_ipc(&frame);
        assert!(messages > 60);
        assert_eq!(back, frame);
    }

    #[test]
    fn chunking_refuses_what_it_cannot_carry() {
        let f = frame_of(&[10], 0);
        assert_eq!(
            chunk_frame(0, f.meta, &f.data, &[], 0),
            Err(ChunkError::Empty)
        );
        assert!(matches!(
            chunk_frame(0, f.meta, &f.data, &f.packets, 2),
            Err(ChunkError::Critical { .. })
        ));
        let big = vec![0u8; IPC_PYROWAVE_MAX];
        assert!(matches!(
            chunk_frame(0, f.meta, &big, std::slice::from_ref(&(0..big.len())), 0),
            Err(ChunkError::PacketTooLarge { index: 0, .. })
        ));
    }

    fn messages_of(frame: &PyroFrame) -> Vec<Vec<u8>> {
        chunk_frame(
            frame.frame,
            frame.meta,
            &frame.data,
            &frame.packets,
            frame.critical,
        )
        .unwrap()
    }

    fn big_frame(id: u32) -> PyroFrame {
        let mut f = frame_of(&vec![1000; 200], 1);
        f.frame = id;
        f
    }

    /// The encoder never finished sending this frame; the hub must not
    /// invent one from what it got.
    #[test]
    fn a_frame_missing_a_message_is_abandoned_not_patched() {
        let frame = big_frame(1);
        let messages = messages_of(&frame);
        assert!(messages.len() >= 3);
        let mut asm = FrameAssembler::new();
        for (i, m) in messages.iter().enumerate() {
            if i == 1 {
                continue;
            }
            let got = asm.push(&decode_ipc_frame(m).unwrap(), 0).unwrap();
            assert!(got.is_none(), "a frame with a hole was completed");
        }
        assert_eq!(asm.take_abandoned(), 1, "counted once, not per message");

        // And the next frame is unaffected.
        let next = big_frame(2);
        let mut got = None;
        for m in messages_of(&next) {
            got = asm.push(&decode_ipc_frame(&m).unwrap(), 0).unwrap().or(got);
        }
        assert_eq!(got, Some(next));
        assert_eq!(asm.take_abandoned(), 0);
    }

    #[test]
    fn a_new_frame_abandons_an_unfinished_one() {
        let (a, b) = (big_frame(1), big_frame(2));
        let mut asm = FrameAssembler::new();
        asm.push(&decode_ipc_frame(&messages_of(&a)[0]).unwrap(), 0)
            .unwrap();
        let mut got = None;
        for m in messages_of(&b) {
            got = asm.push(&decode_ipc_frame(&m).unwrap(), 0).unwrap().or(got);
        }
        assert_eq!(got, Some(b));
        assert_eq!(asm.take_abandoned(), 1);
    }

    #[test]
    fn a_stalled_frame_is_abandoned() {
        let a = big_frame(1);
        let ms = messages_of(&a);
        let mut asm = FrameAssembler::new();
        asm.push(&decode_ipc_frame(&ms[0]).unwrap(), 0).unwrap();
        for m in &ms[1..] {
            assert_eq!(
                asm.push(&decode_ipc_frame(m).unwrap(), ABANDON_MS + 1)
                    .unwrap(),
                None
            );
        }
        assert_eq!(asm.take_abandoned(), 1);
    }

    #[test]
    fn a_malformed_message_is_refused_whole() {
        let f = frame_of(&[100, 100], 0);
        let mut m = messages_of(&f).remove(0);
        // Claim one packet more than there is.
        let at = crate::IPC_HEADER_LEN + 10;
        m[at] += 1;
        let mut asm = FrameAssembler::new();
        assert!(matches!(
            asm.push(&decode_ipc_frame(&m).unwrap(), 0),
            Err(AssembleError::Malformed(_))
        ));

        let other = crate::encode_ipc_frame(crate::STREAM_VIDEO, crate::CODEC_AV1, 0, 0, 1, 1, &[]);
        assert_eq!(
            asm.push(&decode_ipc_frame(&other).unwrap(), 0),
            Err(AssembleError::NotPyroWave)
        );
    }

    // ── packing ──

    fn unpack(d: &Datagrams) -> Vec<(PyroDatagramHeader, Vec<u8>)> {
        let mut out = Vec::new();
        let mut at = 0;
        for &len in &d.lens {
            let (h, p) = decode_pyro_datagram(&d.buf[at..at + len]).expect("parses");
            out.push((h, p.to_vec()));
            at += len;
        }
        assert_eq!(at, d.buf.len());
        out
    }

    #[test]
    fn a_packet_that_fits_takes_one_datagram_whole() {
        let frame = frame_of(&[8, 500, 1188, 300], 0);
        let d = pack_datagrams(3, &frame, 1200).unwrap();
        let got = unpack(&d);
        assert_eq!(d.total, 4);
        assert_eq!(got.len(), 4);
        for (i, (h, p)) in got.iter().enumerate() {
            assert_eq!(h.index as usize, i);
            assert_eq!(h.flags, 0);
            assert_eq!(h.seq, 3);
            assert_eq!(h.ts_ms, 1234);
            assert_eq!(
                p.as_slice(),
                frame.packet(i),
                "packet {i} not carried whole"
            );
        }
    }

    #[test]
    fn critical_datagrams_go_twice_under_the_same_index() {
        let frame = frame_of(&[8, 900, 900, 900, 900], 2);
        let got = unpack(&pack_datagrams(0, &frame, 1200).unwrap());
        assert_eq!(got.len(), 5 + 2);
        let tail: Vec<_> = got[5..].iter().map(|(h, _)| (h.index, h.flags)).collect();
        assert_eq!(tail, [(0, FLAG_DUPLICATE), (1, FLAG_DUPLICATE)]);
        assert_eq!(got[5].1, got[0].1);
        assert_eq!(got[6].1, got[1].1);
    }

    #[test]
    fn an_oversized_block_goes_in_marked_pieces() {
        let frame = frame_of(&[8, 2488, 100], 2);
        let got = unpack(&pack_datagrams(0, &frame, 1200).unwrap());
        let flags: Vec<u8> = got.iter().map(|(h, _)| h.flags).collect();
        let part = FLAG_PART;
        assert_eq!(
            flags,
            [
                0,
                part | FLAG_FIRST_PART,
                part,
                part | FLAG_LAST_PART,
                0,
                // The critical copies: the header packet and all three pieces.
                FLAG_DUPLICATE,
                FLAG_DUPLICATE | part | FLAG_FIRST_PART,
                FLAG_DUPLICATE | part,
                FLAG_DUPLICATE | part | FLAG_LAST_PART,
            ]
        );
        let joined: Vec<u8> = got[1..4].iter().flat_map(|(_, p)| p.clone()).collect();
        assert_eq!(joined, frame.packet(1));
    }

    #[test]
    fn packing_refuses_a_path_too_small_or_a_frame_too_large() {
        let frame = frame_of(&[8], 0);
        assert!(matches!(
            pack_datagrams(0, &frame, PYRO_DGRAM_HDR_LEN + MIN_DGRAM_PAYLOAD - 1),
            Err(PackError::PathTooSmall { .. })
        ));
        let frame = frame_of(&vec![100; PYRO_MAX_DATAGRAMS + 1], 0);
        assert!(matches!(
            pack_datagrams(0, &frame, 1200),
            Err(PackError::TooMany { .. })
        ));
    }

    #[test]
    fn a_datagram_inconsistent_with_itself_is_refused() {
        let mut buf = [0u8; PYRO_DGRAM_HDR_LEN];
        let ok = PyroDatagramHeader {
            seq: 1,
            index: 0,
            total: 2,
            ts_ms: 0,
            flags: 0,
        };
        write_pyro_header(&mut buf, &ok);
        assert!(decode_pyro_datagram(&buf).is_some());
        assert!(decode_pyro_datagram(&buf[..PYRO_DGRAM_HDR_LEN - 1]).is_none());

        for bad in [
            PyroDatagramHeader { total: 0, ..ok },
            PyroDatagramHeader { index: 2, ..ok },
            PyroDatagramHeader {
                total: (PYRO_MAX_DATAGRAMS + 1) as u16,
                ..ok
            },
            PyroDatagramHeader { flags: 0x80, ..ok },
            PyroDatagramHeader {
                flags: FLAG_FIRST_PART,
                ..ok
            },
        ] {
            write_pyro_header(&mut buf, &bad);
            assert!(decode_pyro_datagram(&buf).is_none(), "{bad:?} accepted");
        }
        // Another kind entirely.
        write_pyro_header(&mut buf, &ok);
        buf[0] = crate::datagram::DGRAM_VIDEO;
        assert!(decode_pyro_datagram(&buf).is_none());
    }

    // ── collection ──

    type Wire = Vec<(PyroDatagramHeader, Vec<u8>)>;

    fn wire(seq: u16, frame: &PyroFrame) -> Wire {
        unpack(&pack_datagrams(seq, frame, 1200).unwrap())
    }

    fn packets_of(f: &CollectedFrame<Vec<u8>>) -> Vec<Vec<u8>> {
        f.packets.iter().map(|p| p.as_ref().to_vec()).collect()
    }

    fn all_packets(frame: &PyroFrame) -> Vec<Vec<u8>> {
        (0..frame.packets.len())
            .map(|i| frame.packet(i).to_vec())
            .collect()
    }

    #[test]
    fn a_whole_frame_leaves_the_moment_it_completes() {
        let frame = frame_of(&[8, 900, 2488, 900], 1);
        let mut c = PyroCollector::new();
        let mut out = Vec::new();
        // The duplicates come last; the frame must not wait for them.
        let w = wire(0, &frame);
        let originals = w.len() - 1;
        for (h, p) in w.into_iter().take(originals) {
            out.extend(c.push(h, p, 0));
        }
        assert_eq!(out.len(), 1);
        assert!(out[0].is_whole());
        assert_eq!(packets_of(&out[0]), all_packets(&frame));
        let s = c.take_stats();
        assert_eq!((s.whole, s.partial, s.lost), (1, 0, 0));
    }

    #[test]
    fn order_within_a_frame_does_not_matter() {
        let frame = frame_of(&[8, 900, 2488, 900, 50], 2);
        let mut w = wire(0, &frame);
        w.reverse();
        let mut c = PyroCollector::new();
        let out: Vec<_> = w.into_iter().flat_map(|(h, p)| c.push(h, p, 0)).collect();
        assert_eq!(out.len(), 1);
        assert_eq!(packets_of(&out[0]), all_packets(&frame));
    }

    #[test]
    fn a_late_copy_is_counted_and_not_kept() {
        let frame = frame_of(&[8, 900], 1);
        let mut c = PyroCollector::new();
        for (h, p) in wire(0, &frame) {
            c.push(h, p, 0);
        }
        let s = c.take_stats();
        // The copy of datagram 0 arrives after the frame left: stale, since
        // the frame is gone, and not a duplicate.
        assert_eq!((s.whole, s.stale, s.duplicates), (1, 1, 0));
    }

    #[test]
    fn a_copy_fills_the_hole_its_original_left() {
        let frame = frame_of(&[8, 900, 900], 1);
        let w = wire(0, &frame);
        let mut c = PyroCollector::new();
        let mut out = Vec::new();
        for (h, p) in w.into_iter().skip(1) {
            out.extend(c.push(h, p, 0));
        }
        assert_eq!(out.len(), 1);
        assert!(out[0].is_whole(), "the critical copy did not stand in");
        assert_eq!(c.take_stats().recovered, 1);
    }

    #[test]
    fn a_partial_frame_leaves_once_the_next_begins_and_grace_passes() {
        let (a, b) = (frame_of(&[8, 900, 900, 900], 1), frame_of(&[8, 900], 1));
        let mut c = PyroCollector::new();
        let mut wa = wire(0, &a);
        wa.retain(|(h, _)| h.index != 2);
        for (h, p) in wa {
            assert!(c.push(h, p, 0).is_empty());
        }
        let wb = wire(1, &b);
        let (h, p) = wb[0].clone();
        assert!(c.push(h, p, 100).is_empty(), "left before grace");
        assert_eq!(c.next_deadline(), Some(100 + GRACE_US));
        assert!(c.poll(100 + GRACE_US - 1).is_empty());
        let out = c.poll(100 + GRACE_US);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].seq, 0);
        assert!(!out[0].is_whole());
        assert_eq!((out[0].received, out[0].total), (3, 4));
        let mut expect = all_packets(&a);
        expect.remove(2);
        assert_eq!(packets_of(&out[0]), expect);
        let s = c.take_stats();
        assert_eq!((s.partial, s.lost), (1, 1));
    }

    #[test]
    fn a_frame_nobody_follows_leaves_once_it_goes_quiet() {
        let a = frame_of(&[8, 900, 900], 0);
        let w = wire(0, &a);
        let mut c = PyroCollector::new();
        c.push(w[0].0, w[0].1.clone(), 50);
        c.push(w[1].0, w[1].1.clone(), 900);
        // Timed from the last datagram, not the first.
        assert!(c.poll(900 + IDLE_US - 1).is_empty());
        let out = c.poll(900 + IDLE_US);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].received, 2);
    }

    /// The failure a deadline from the first datagram had: a frame that takes
    /// longer than the deadline to arrive, as every frame does on a path
    /// slower than the deadline assumes, was cut off while still arriving.
    #[test]
    fn a_slow_frame_is_not_cut_off_while_it_is_still_arriving() {
        let frame = frame_of(&vec![900; 400], 0);
        let mut c = PyroCollector::new();
        let mut out = Vec::new();
        let gap = IDLE_US / 2;
        for (i, (h, p)) in wire(0, &frame).into_iter().enumerate() {
            out.extend(c.push(h, p, i as u64 * gap));
        }
        assert_eq!(out.len(), 1);
        assert!(out[0].is_whole(), "{}/{}", out[0].received, out[0].total);
    }

    #[test]
    fn a_complete_frame_takes_older_unfinished_ones_with_it() {
        let (a, b) = (frame_of(&[8, 900, 900], 0), frame_of(&[8, 900], 0));
        let mut c = PyroCollector::new();
        let (h, p) = wire(0, &a)[0].clone();
        c.push(h, p, 0);
        let out: Vec<_> = wire(1, &b)
            .into_iter()
            .flat_map(|(h, p)| c.push(h, p, 10))
            .collect();
        assert_eq!(out.iter().map(|f| f.seq).collect::<Vec<_>>(), [0, 1]);
        // And the rest of the older frame is stale now.
        let (h, p) = wire(0, &a)[1].clone();
        assert!(c.push(h, p, 20).is_empty());
        assert_eq!(c.take_stats().stale, 1);
    }

    #[test]
    fn a_broken_run_drops_its_packet_and_keeps_the_rest() {
        let frame = frame_of(&[8, 2488, 2488, 100], 0);
        let w = wire(0, &frame);
        // Index 2 is the middle piece of packet 1; 4 is the first of packet 2.
        for missing in [2u16, 4] {
            let mut c = PyroCollector::new();
            for (h, p) in w.iter().filter(|(h, _)| h.index != missing).cloned() {
                c.push(h, p, 0);
            }
            let out = c.poll(IDLE_US);
            assert_eq!(out.len(), 1);
            let mut expect = all_packets(&frame);
            expect.remove(if missing == 2 { 1 } else { 2 });
            assert_eq!(packets_of(&out[0]), expect, "missing {missing}");
            assert_eq!(c.take_stats().broken_parts, 1);
        }
    }

    #[test]
    fn a_disagreeing_total_is_counted_and_ignored() {
        let frame = frame_of(&[8, 900], 0);
        let w = wire(0, &frame);
        let mut c = PyroCollector::new();
        c.push(w[0].0, w[0].1.clone(), 0);
        let mut h = w[1].0;
        h.total = 3;
        c.push(h, w[1].1.clone(), 0);
        assert_eq!(c.take_stats().inconsistent, 1);
        assert_eq!(c.push(w[1].0, w[1].1.clone(), 0).len(), 1);
    }

    #[test]
    fn too_many_frames_in_flight_lets_the_oldest_go() {
        let f = frame_of(&[8, 900], 0);
        let mut c = PyroCollector::new();
        let mut out = Vec::new();
        for seq in 0..=MAX_IN_FLIGHT as u16 {
            let (h, p) = wire(seq, &f)[0].clone();
            out.extend(c.push(h, p, 0));
        }
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].seq, 0);
    }

    #[test]
    fn collection_survives_sequence_wraparound() {
        let f = frame_of(&[8, 900], 0);
        let mut c = PyroCollector::new();
        let mut seqs = Vec::new();
        for seq in [65534u16, 65535, 0, 1] {
            for (h, p) in wire(seq, &f).into_iter().take(2) {
                seqs.extend(c.push(h, p, 0).into_iter().map(|f| f.seq));
            }
        }
        assert_eq!(seqs, [65534, 65535, 0, 1]);
        assert_eq!(c.take_stats().stale, 0);
    }
}

#[cfg(test)]
mod skip_tests {
    use super::*;

    const BUF: usize = 4 << 20;

    #[test]
    fn an_empty_queue_sends() {
        assert_eq!(should_skip(0, 400_000, BUF), None);
        assert_eq!(should_skip(0, BUF, BUF), None);
    }

    /// One frame waiting behind the one going out is the steady state at a
    /// rate the path carries; it must not trip the guard.
    #[test]
    fn a_frame_in_flight_is_not_a_backlog() {
        assert_eq!(should_skip(400_000, 400_000, BUF), None);
        assert_eq!(should_skip(399_999, 400_000, BUF), None);
    }

    #[test]
    fn more_than_a_frame_behind_skips() {
        assert_eq!(should_skip(400_001, 400_000, BUF), Some(Skip::Behind));
    }

    #[test]
    fn a_frame_that_would_evict_skips() {
        let frame = 3 << 20;
        assert_eq!(should_skip(2 << 20, frame, BUF), Some(Skip::NoRoom));
    }

    #[test]
    fn a_frame_larger_than_the_buffer_never_goes() {
        assert_eq!(should_skip(0, BUF + 1, BUF), Some(Skip::TooLarge));
    }
}
