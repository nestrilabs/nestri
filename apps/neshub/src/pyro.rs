//! Sending PyroWave frames.
//!
//! See `nesprotocol::pyrowave` for the wire and why PyroWave has a path of its
//! own. This is the hub's half: pack each frame as one packet per datagram and
//! decide whether to send it at all.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use bytes::Bytes;
use iroh::endpoint::Connection;
use tracing::{debug, warn};

use nesprotocol::datagram::DGRAM_BUFFER_BYTES;
use nesprotocol::pyrowave::{PYRO_DGRAM_HDR_LEN, PyroFrame, Skip, pack_datagrams, should_skip};

/// One connection's PyroWave sender.
pub struct PyroSender {
    conn: Connection,
    /// Its own counter, apart from the hardware frames': a receiver collects
    /// each kind by its own sequence.
    seq: u16,
    skipped: Arc<AtomicU64>,
    warned_too_large: bool,
}

impl PyroSender {
    pub fn new(conn: Connection, skipped: Arc<AtomicU64>) -> Self {
        Self {
            conn,
            seq: 0,
            skipped,
            warned_too_large: false,
        }
    }

    /// Send one frame, or skip it.
    ///
    /// A skipped frame does not use up a sequence number: nothing went out
    /// under it, and a hole would read at the far end as a frame the path
    /// lost.
    pub fn send(&mut self, frame: &PyroFrame, label: &str) {
        let Some(max) = self.conn.max_datagram_size() else {
            debug!("{label}: peer does not support QUIC datagrams");
            return;
        };
        let datagrams = match pack_datagrams(self.seq, frame, max) {
            Ok(d) => d,
            Err(e) => {
                debug!("{label}: dropping PyroWave frame {}: {e}", frame.frame);
                return;
            }
        };

        let backlog = DGRAM_BUFFER_BYTES.saturating_sub(self.conn.datagram_send_buffer_space());
        if let Some(skip) = should_skip(backlog, datagrams.buf.len(), DGRAM_BUFFER_BYTES) {
            self.skipped.fetch_add(1, Ordering::Relaxed);
            if skip == Skip::TooLarge && !self.warned_too_large {
                warn!(
                    "{label}: a {} byte PyroWave frame cannot fit the {DGRAM_BUFFER_BYTES} byte \
                     send buffer; frames this size are never sent. Lower the rate.",
                    datagrams.buf.len()
                );
                self.warned_too_large = true;
            } else {
                debug!("{label}: skipped PyroWave frame {}: {skip:?}", frame.frame);
            }
            return;
        }

        // Taking the `Vec` is free, and each datagram is a slice of it.
        let buf = Bytes::from(datagrams.buf);
        let mut at = 0;
        for len in datagrams.lens {
            debug_assert!(len >= PYRO_DGRAM_HDR_LEN);
            let datagram = buf.slice(at..at + len);
            at += len;
            // Not `send_datagram_wait`, for the reason `dgram::send_frame`
            // gives; the guard above is what keeps this from evicting.
            if let Err(e) = self.conn.send_datagram(datagram) {
                debug!("{label}: PyroWave frame {} cut short: {e}", frame.frame);
                break;
            }
        }
        self.seq = self.seq.wrapping_add(1);
    }
}
