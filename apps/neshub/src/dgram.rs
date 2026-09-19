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

/// How long deltas may be withheld from a client waiting to resynchronise.
///
/// A bound rather than a belief. Withholding is correct only while the keyframe
/// is actually coming, and if the encoder never produces one -- it refused, it
/// died, the request never reached it -- then withholding forever turns a
/// recoverable freeze into a permanent black screen. Past this the deltas go out
/// again: useless to a desynchronised decoder, but "useless" beats "nothing at
/// all, forever" when the assumption behind the suppression has been proven
/// wrong.
const MAX_RESYNC_WITHHOLD: std::time::Duration = std::time::Duration::from_secs(2);

/// Whether to send delta frames to a client that cannot decode them yet.
///
/// A client that has lost synchronisation asks for a keyframe, and until one
/// arrives every delta frame sent to it is undecodable -- it predicts from
/// pictures that client does not have. Those frames are not merely wasted: quinn
/// writes DATAGRAM frames into a packet before STREAM frames, so a steady stream
/// of deltas takes the space the keyframe needs and starves the one frame that
/// would end the freeze. That is the loop behind "26 keyframe fallbacks, 19 IDR
/// requests": the recovery frame could not get out past the frames that needed
/// it to arrive first.
///
/// So while a client is waiting, its deltas are dropped rather than sent.
#[derive(Debug, Default)]
pub struct ResyncGate {
    /// When this client started waiting, or `None` if it is not.
    waiting_since: Option<std::time::Instant>,
    /// Deltas dropped during the current wait.
    withheld: u64,
    /// Set once the withhold bound is passed, so it is said once per wait.
    gave_up: bool,
}

impl ResyncGate {
    /// Whether this delta frame should go out.
    ///
    /// `awaiting` is whether the client has asked for a keyframe and not yet
    /// been sent one.
    pub fn admit_delta(&mut self, awaiting: bool, now: std::time::Instant) -> bool {
        if !awaiting {
            self.end_wait();
            return true;
        }
        let since = *self.waiting_since.get_or_insert(now);
        if now.duration_since(since) >= MAX_RESYNC_WITHHOLD {
            self.gave_up = true;
            return true;
        }
        self.withheld += 1;
        false
    }

    /// A keyframe has gone out, so the wait is over.
    pub fn note_keyframe(&mut self) -> Option<(u64, bool)> {
        let withheld = self.withheld;
        let gave_up = self.gave_up;
        self.end_wait();
        (withheld > 0).then_some((withheld, gave_up))
    }

    fn end_wait(&mut self) {
        self.waiting_since = None;
        self.withheld = 0;
        self.gave_up = false;
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
    // Set while this client has asked for a keyframe and not yet been sent
    // one. Video only; audio has no such notion.
    awaiting_keyframe: Option<Arc<std::sync::atomic::AtomicBool>>,
) {
    let sender = DatagramSender::new(conn.clone(), kind);
    let keyframes = keyframes_reliable.then(|| KeyframeSender::new(conn, sender.clone()));
    let mut seq: u16 = 0;
    let mut body: Vec<u8> = Vec::new();
    // Datagram loss is expected and self-correcting, so failures are logged at
    // debug. Losing datagram support entirely is not, and is worth a warning —
    // but only the first time, since it will then be true for every frame.
    let mut warned_unsupported = false;
    let mut resync = ResyncGate::default();

    while let Some(payload) = rx.recv().await {
        let t0 = std::time::Instant::now();
        body.clear();
        nesprotocol::encode_frame_body(&mut body, MSG_DATA, seq, &payload);

        // A keyframe goes on a stream of its own when one will take it. The
        // relay timing below is not recorded for it: the write is asynchronous
        // by design, so the time this loop spent on it says nothing.
        // A client that cannot decode has asked for a keyframe; until it gets
        // one, everything else sent to it is undecodable and takes the space the
        // keyframe needs. See `ResyncGate`.
        if let Some(ref awaiting) = awaiting_keyframe {
            if nesprotocol::reliable::video_is_keyframe(&payload) {
                awaiting.store(false, Ordering::Relaxed);
                if let Some((withheld, gave_up)) = resync.note_keyframe() {
                    debug!(
                        "{label}: resynchronised after withholding {withheld} frame(s){}",
                        if gave_up {
                            ", having given up waiting"
                        } else {
                            ""
                        }
                    );
                }
            } else if !resync
                .admit_delta(awaiting.load(Ordering::Relaxed), std::time::Instant::now())
            {
                // The sequence number deliberately does *not* advance. A
                // withheld frame was never sent, so leaving a hole would make
                // the receiver count it as lost -- and that count is what the
                // bitrate controller reads. The hub would then lower the
                // bitrate because of frames it chose not to send, which is a
                // controller reacting to its own decision rather than to the
                // path. Reusing the number is safe precisely because nothing
                // went out under it.
                continue;
            }
        }

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

#[cfg(test)]
mod resync_gate_tests {
    use super::{MAX_RESYNC_WITHHOLD, ResyncGate};
    use std::time::{Duration, Instant};

    #[test]
    fn a_client_that_can_decode_gets_everything() {
        // The negative that matters: nothing is withheld from a healthy client.
        let mut gate = ResyncGate::default();
        let now = Instant::now();
        for i in 0..1000 {
            assert!(gate.admit_delta(false, now + Duration::from_millis(i)));
        }
    }

    #[test]
    fn a_waiting_client_is_not_sent_frames_it_cannot_decode() {
        let mut gate = ResyncGate::default();
        let now = Instant::now();
        for i in 0..60 {
            assert!(
                !gate.admit_delta(true, now + Duration::from_millis(i * 16)),
                "frame {i} went to a client with no reference to decode it against",
            );
        }
    }

    #[test]
    fn the_keyframe_ends_the_wait_and_reports_the_cost() {
        let mut gate = ResyncGate::default();
        let now = Instant::now();
        for i in 0..5 {
            gate.admit_delta(true, now + Duration::from_millis(i * 16));
        }
        assert_eq!(gate.note_keyframe(), Some((5, false)));
        // And the next delta goes out immediately.
        assert!(gate.admit_delta(false, now + Duration::from_millis(100)));
    }

    #[test]
    fn a_keyframe_with_nothing_withheld_says_nothing() {
        // So an ordinary periodic keyframe does not log a recovery that did not
        // happen.
        let mut gate = ResyncGate::default();
        assert_eq!(gate.note_keyframe(), None);
    }

    #[test]
    fn withholding_gives_up_rather_than_going_dark_forever() {
        // The bound. Withholding is only correct while the keyframe is actually
        // coming; if the encoder never produces one, suppressing forever turns a
        // recoverable freeze into a permanent black screen. Undecodable frames
        // beat no frames once the assumption is disproven.
        let mut gate = ResyncGate::default();
        let now = Instant::now();
        assert!(!gate.admit_delta(true, now));
        assert!(!gate.admit_delta(true, now + MAX_RESYNC_WITHHOLD - Duration::from_millis(1)));
        assert!(
            gate.admit_delta(true, now + MAX_RESYNC_WITHHOLD),
            "still withholding after the keyframe plainly is not coming",
        );
    }

    #[test]
    fn giving_up_is_reported_when_the_keyframe_finally_lands() {
        let mut gate = ResyncGate::default();
        let now = Instant::now();
        gate.admit_delta(true, now);
        gate.admit_delta(true, now + MAX_RESYNC_WITHHOLD);
        let (withheld, gave_up) = gate.note_keyframe().expect("something was withheld");
        assert_eq!(withheld, 1);
        assert!(gave_up, "the wait timed out and nothing said so");
    }

    #[test]
    fn a_second_wait_starts_fresh() {
        // Otherwise the first wait's elapsed time carries over and the second is
        // abandoned immediately, or its count reports the wrong recovery.
        let mut gate = ResyncGate::default();
        let now = Instant::now();
        gate.admit_delta(true, now);
        gate.note_keyframe();

        let later = now + Duration::from_secs(60);
        assert!(
            !gate.admit_delta(true, later),
            "the new wait was not honoured"
        );
        assert_eq!(gate.note_keyframe(), Some((1, false)));
    }
}
