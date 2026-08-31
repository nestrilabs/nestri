//! Sending keyframes on reliable streams instead of datagrams.
//!
//! See `nesprotocol::reliable` for why keyframes are the exception to
//! "media travels as datagrams". This is the sending half; `dgram` carries
//! everything else.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};

use iroh::endpoint::Connection;
use tracing::debug;

use nesprotocol::reliable::MAX_KEYFRAME_STREAMS_IN_FLIGHT;
use nesprotocol::{STREAM_KEYFRAME, STREAM_VERSION};

use crate::dgram::DatagramSender;

/// Sends keyframes, one short-lived unidirectional stream each.
pub struct KeyframeSender {
    conn: Connection,
    /// Where a keyframe goes when a stream cannot take it.
    fallback: DatagramSender,
    in_flight: Arc<AtomicUsize>,
    sent: Arc<AtomicU64>,
    /// Keyframes that ended up on datagrams after all — refused for want of an
    /// in-flight slot, or dropped back after the stream failed.
    fell_back: Arc<AtomicU64>,
}

impl KeyframeSender {
    pub fn new(conn: Connection, fallback: DatagramSender) -> Self {
        Self {
            conn,
            fallback,
            in_flight: Arc::new(AtomicUsize::new(0)),
            sent: Arc::new(AtomicU64::new(0)),
            fell_back: Arc::new(AtomicU64::new(0)),
        }
    }

    /// Take responsibility for one keyframe.
    ///
    /// Returns false when the caller must send it as datagrams itself: every
    /// in-flight slot is occupied, which means keyframes are arriving faster
    /// than this connection can absorb them. Sending more stream data to a
    /// receiver already that far behind would make it worse, so the frame takes
    /// the lossy path rather than the queue.
    ///
    /// On true, the write happens on its own task. That is the whole point:
    /// stream writes are flow-controlled, so a receiver with no window left
    /// would otherwise hold up every delta frame queued behind this keyframe —
    /// and the deltas are the frames with an expiry date.
    pub fn send(&self, seq: u16, body: &[u8]) -> bool {
        if self.in_flight.load(Ordering::Relaxed) >= MAX_KEYFRAME_STREAMS_IN_FLIGHT {
            self.fell_back.fetch_add(1, Ordering::Relaxed);
            return false;
        }
        self.in_flight.fetch_add(1, Ordering::Relaxed);

        let conn = self.conn.clone();
        let fallback = self.fallback.clone();
        let in_flight = self.in_flight.clone();
        let sent = self.sent.clone();
        let fell_back = self.fell_back.clone();
        // The task outlives this call, so it needs the bytes. One copy per
        // keyframe — a couple of hundred KB every keyframe interval — against
        // not blocking the writer for a flow-controlled write.
        let body = body.to_vec();

        tokio::spawn(async move {
            let ok = write_keyframe_stream(&conn, &body).await;
            in_flight.fetch_sub(1, Ordering::Relaxed);

            if ok {
                sent.fetch_add(1, Ordering::Relaxed);
                return;
            }
            // A stream was promised and could not be delivered on. Datagrams
            // are a worse path for a keyframe, but they beat dropping the one
            // frame everything after it is predicted from.
            fell_back.fetch_add(1, Ordering::Relaxed);
            if let Err(e) = fallback.send_frame(seq, &body) {
                debug!("keyframe {seq}: stream failed and datagram fallback failed too: {e}");
            }
        });

        true
    }

    /// Keyframes delivered on a stream, and keyframes that fell back to
    /// datagrams. A rising fallback count means the receiver cannot keep up.
    pub fn counts(&self) -> (u64, u64) {
        (
            self.sent.load(Ordering::Relaxed),
            self.fell_back.load(Ordering::Relaxed),
        )
    }
}

/// Write one keyframe on a stream of its own and close it.
///
/// The stream carries `[1B STREAM_KEYFRAME] [1B STREAM_VERSION] [frame body]`
/// and nothing else, so finishing it is what tells the receiver where the frame
/// ends — no length prefix needed, exactly as a datagram needs none.
async fn write_keyframe_stream(conn: &Connection, body: &[u8]) -> bool {
    let mut send = match conn.open_uni().await {
        Ok(s) => s,
        Err(e) => {
            debug!("keyframe open_uni failed: {e}");
            return false;
        }
    };

    if let Err(e) = send.write_all(&[STREAM_KEYFRAME, STREAM_VERSION]).await {
        debug!("keyframe header write failed: {e}");
        send.reset(0u32.into()).ok();
        return false;
    }
    if let Err(e) = send.write_all(body).await {
        debug!("keyframe body write failed: {e}");
        send.reset(0u32.into()).ok();
        return false;
    }
    if let Err(e) = send.finish() {
        debug!("keyframe finish failed: {e}");
        return false;
    }

    // Hold the in-flight slot until the receiver has actually acknowledged the
    // frame, not merely until it was handed to the connection. That is what
    // makes the slot count a measure of how far behind the receiver is, which
    // is the only reason to bound it.
    let _ = send.stopped().await;
    true
}
