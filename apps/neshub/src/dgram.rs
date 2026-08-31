//! Fragmenting media frames onto a connection's QUIC datagram flow.
//!
//! See `nestri_protocol::datagram` for why media left unidirectional streams and
//! what the wire format looks like. This is the sending half.

use std::fmt;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use bytes::BytesMut;
use iroh::endpoint::{Connection, QuicTransportConfig, SendDatagramError};
use tracing::{debug, warn};

use crate::keyframe::KeyframeSender;

use nesprotocol::MSG_DATA;
use nesprotocol::datagram::{
    DGRAM_BUFFER_BYTES, DGRAM_HDR_LEN, MAX_FRAGMENTS_PER_FRAME, MIN_DGRAM_PAYLOAD, fragment_count,
    write_datagram_header,
};
use nesprotocol::reliable::video_wants_reliable;

/// Transport settings for an endpoint carrying media datagrams.
///
/// See [`DGRAM_BUFFER_BYTES`] for why the defaults are not enough.
pub fn media_transport_config() -> QuicTransportConfig {
    QuicTransportConfig::builder()
        .datagram_send_buffer_size(DGRAM_BUFFER_BYTES)
        .datagram_receive_buffer_size(Some(DGRAM_BUFFER_BYTES))
        .build()
}

#[derive(Debug)]
pub enum SendFrameError {
    /// The peer never advertised datagram support, or it is disabled locally.
    /// Since v2 dropped the uni-stream media path, there is nothing to fall back
    /// to and the session cannot carry media at all.
    Unsupported,
    /// The path currently admits less than one useful fragment.
    PathTooSmall { payload: usize },
    /// The frame needs more fragments than a receiver will reassemble.
    TooFragmented { fragments: usize },
    /// QUIC refused the datagram.
    Quic(SendDatagramError),
}

impl fmt::Display for SendFrameError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unsupported => write!(f, "peer does not support QUIC datagrams"),
            Self::PathTooSmall { payload } => {
                write!(
                    f,
                    "path admits only {payload} bytes of payload per datagram"
                )
            }
            Self::TooFragmented { fragments } => write!(
                f,
                "frame needs {fragments} fragments, limit is {MAX_FRAGMENTS_PER_FRAME}"
            ),
            Self::Quic(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for SendFrameError {}

/// Fragments frames of one media kind onto a connection's datagram flow.
///
/// Cloneable so the keyframe path can keep one for its fallback; both halves are
/// cheap handles onto the same connection.
#[derive(Clone)]
pub struct DatagramSender {
    conn: Connection,
    kind: u8,
}

impl DatagramSender {
    pub fn new(conn: Connection, kind: u8) -> Self {
        Self { conn, kind }
    }

    /// Fragment one frame body and send the pieces.
    ///
    /// `body` is `[1B type][2B seq][payload]` — the frame layout the stream path
    /// used, minus the length prefix a datagram does not need.
    ///
    /// A failure is reported but never retried. Retrying a real-time frame means
    /// delivering it late, which is the behaviour this whole change removes. A
    /// half-sent frame is abandoned where it stands; the receiver times its
    /// fragments out and asks for a keyframe.
    pub fn send_frame(&self, seq: u16, body: &[u8]) -> Result<(), SendFrameError> {
        // Ask QUIC what fits right now rather than assuming. The estimate moves
        // over a connection's life as path MTU discovery runs, and it can shrink
        // when a path changes underneath us — which for iroh includes migrating
        // between a direct path and a relay. Reading it per frame means the next
        // frame is already using the new size, with no shrink-on-rejection state
        // to get stuck at a pessimistic value after a transient failure.
        let max = self
            .conn
            .max_datagram_size()
            .ok_or(SendFrameError::Unsupported)?;

        let payload_size = max.saturating_sub(DGRAM_HDR_LEN);
        if payload_size < MIN_DGRAM_PAYLOAD {
            return Err(SendFrameError::PathTooSmall {
                payload: payload_size,
            });
        }

        let total = fragment_count(body.len(), payload_size);
        if total > MAX_FRAGMENTS_PER_FRAME {
            return Err(SendFrameError::TooFragmented { fragments: total });
        }

        // Lay every fragment down in one allocation, then hand out slices of it.
        // `BytesMut::split_to` gives each datagram an owned `Bytes` that shares
        // this buffer, so a 300-fragment keyframe costs one allocation, not 300.
        let mut buf = BytesMut::with_capacity(total * DGRAM_HDR_LEN + body.len());
        let mut header = [0u8; DGRAM_HDR_LEN];
        for index in 0..total {
            let start = index * payload_size;
            let end = (start + payload_size).min(body.len());
            write_datagram_header(&mut header, self.kind, seq, index as u16, total as u16);
            buf.extend_from_slice(&header);
            buf.extend_from_slice(&body[start..end]);
        }

        for index in 0..total {
            let start = index * payload_size;
            let end = (start + payload_size).min(body.len());
            let datagram = buf.split_to(DGRAM_HDR_LEN + (end - start)).freeze();
            // Deliberately not `send_datagram_wait`: that waits for buffer space
            // under congestion, which prioritises old datagrams over new ones.
            // For live media the opposite is right — drop the backlog, send the
            // frame that is actually current.
            self.conn
                .send_datagram(datagram)
                .map_err(SendFrameError::Quic)?;
        }

        Ok(())
    }
}

/// Frames arriving on `rx` are numbered and sent — deltas as datagrams,
/// keyframes on a reliable stream each when `keyframes_reliable` is set.
///
/// A send failure does not end the loop. Datagrams are dropped by design when a
/// path is congested, and one undeliverable frame says nothing about the next; a
/// connection that has genuinely gone away ends the loop through its channel or
/// through `Connection::closed`.
///
/// Set `keyframes_reliable` for video only. See `nestri_protocol::reliable`:
/// audio has no keyframes, and the flags byte a video frame carries at that
/// offset is unrelated data in an audio packet.
pub async fn run_datagram_writer(
    conn: Connection,
    kind: u8,
    label: &'static str,
    mut rx: tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>,
    relay_ms: Option<Arc<AtomicU32>>,
    keyframes_reliable: bool,
) {
    let sender = DatagramSender::new(conn.clone(), kind);
    let keyframes = keyframes_reliable.then(|| KeyframeSender::new(conn, sender.clone()));
    let mut seq: u16 = 0;
    let mut body: Vec<u8> = Vec::new();
    // Datagram loss is expected and self-correcting, so failures are logged at
    // debug. Losing datagram support entirely is not, and is worth a warning —
    // but only the first time, since it will then be true for every frame.
    let mut warned_unsupported = false;

    while let Some(payload) = rx.recv().await {
        let t0 = std::time::Instant::now();

        body.clear();
        nesprotocol::encode_frame_body(&mut body, MSG_DATA, seq, &payload);

        // A keyframe goes on a stream of its own when one will take it. The
        // relay timing below is not recorded for it: the write is asynchronous
        // by design, so the time this loop spent on it says nothing.
        if let Some(ref keyframes) = keyframes
            && video_wants_reliable(&payload)
        {
            if keyframes.send(seq, &body) {
                seq = seq.wrapping_add(1);
                continue;
            }
            // Every stream slot is still busy, so this keyframe takes the lossy
            // path after all. Worth recording: a keyframe on datagrams is the
            // exact case this path exists to avoid, and the count is the only
            // way to tell "the receiver is behind" from "the network ate it".
            let (on_streams, fell_back) = keyframes.counts();
            debug!(
                "{label}: keyframe {seq} falling back to datagrams ({on_streams} on streams, {fell_back} fell back)"
            );
        }

        match sender.send_frame(seq, &body) {
            Ok(()) => {
                if let Some(ref relay) = relay_ms {
                    let elapsed = t0.elapsed().as_secs_f32() * 1000.0;
                    relay.store(elapsed.to_bits(), Ordering::Relaxed);
                }
            }
            Err(SendFrameError::Unsupported) => {
                if !warned_unsupported {
                    warn!("{label}: peer does not support QUIC datagrams, media cannot flow");
                    warned_unsupported = true;
                }
            }
            Err(e) => debug!("{label}: dropping frame {seq}: {e}"),
        }

        seq = seq.wrapping_add(1);
    }

    if let Some(ref keyframes) = keyframes {
        let (on_streams, fell_back) = keyframes.counts();
        debug!("{label}: {on_streams} keyframes on streams, {fell_back} fell back to datagrams");
    }
    debug!("{label} datagram writer exiting (channel closed)");
}
