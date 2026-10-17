//! The transport's congestion control, handed to the media's own.
//!
//! The video rate is decided per frame from what the path measurably did
//! (`rate.rs`), and that decision needs each frame to leave as one train:
//! its fragments back to back, so the bottleneck spaces them by its own rate
//! and the client can measure it. A transport controller in between would
//! window and pace them by its own estimate, smearing the very spacing being
//! measured, and second-guess a rate already chosen from better evidence.
//!
//! So this controller holds nothing back. Its window is larger than noq paces
//! at all (it stops pacing above `u32::MAX`), and it ignores loss, which the
//! media's own controller sees sooner, as queueing.
//!
//! Endpoint-wide, because transport settings are per endpoint, not per
//! connection: audio, input and control get it too. They are small flows the
//! video rate leaves room for; nothing they send can build a queue.

use std::any::Any;
use std::sync::Arc;

use iroh::endpoint::{Controller, ControllerFactory};

/// Past this noq does not pace: see `noq_proto::connection::pacing`.
const UNPACED_WINDOW: u64 = u32::MAX as u64 * 2;

#[derive(Debug, Clone, Copy, Default)]
pub struct MediaRate;

impl Controller for MediaRate {
    fn on_congestion_event(
        &mut self,
        _now: std::time::Instant,
        _sent: std::time::Instant,
        _is_persistent_congestion: bool,
        _is_ecn: bool,
        _lost_bytes: u64,
        _largest_lost_pn: u64,
    ) {
    }

    fn on_mtu_update(&mut self, _new_mtu: u16) {}

    fn window(&self) -> u64 {
        UNPACED_WINDOW
    }

    fn clone_box(&self) -> Box<dyn Controller> {
        Box::new(*self)
    }

    fn initial_window(&self) -> u64 {
        UNPACED_WINDOW
    }

    fn into_any(self: Box<Self>) -> Box<dyn Any> {
        self
    }
}

#[derive(Debug, Default)]
pub struct MediaRateFactory;

impl ControllerFactory for MediaRateFactory {
    fn build(self: Arc<Self>, _now: std::time::Instant, _current_mtu: u16) -> Box<dyn Controller> {
        Box::new(MediaRate)
    }
}
