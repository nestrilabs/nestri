// ─────────────────────────────────────────────────────────────────────────────
//  timing.rs — where a present's time actually goes
//
//  The rate line says how many frames survive each stage. It cannot say why a
//  game that offers 68 presents a second yields 56 captures against a gate set
//  to 60, because that shortfall is made of gaps: stretches where the game
//  presented nothing and the gate had no frames to admit. Whether those gaps
//  belong to the game, to the driver, or to this layer is the whole question,
//  and nothing measured so far distinguishes them.
//
//  Three spans per present, all on the game's own thread, which together
//  partition the wall clock between one present and the next:
//
//    gap    — previous present returning to this one arriving. The game's own
//             frame time, everything this layer does excluded.
//    layer  — this layer's code, both sides of the down-call added together.
//    down   — the down-call: driver, WSI, compositor.
//
//  A hitch shows up in exactly one of them and that names the culprit.
//
//  A fourth, blit, is not part of that partition. It is GPU execution time for
//  the capture copy, which runs alongside the game rather than in front of it,
//  and answers a different question: what the capture takes from the device the
//  game is rendering on. CPU time in the hook says nothing about it — the hook
//  submits the blit and returns without waiting.
// ─────────────────────────────────────────────────────────────────────────────

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::Duration;

/// One span's running total for the current reporting second.
#[derive(Default)]
pub struct Span {
    total_us: AtomicU64,
    max_us: AtomicU32,
    count: AtomicU32,
}

impl Span {
    pub fn record(&self, d: Duration) {
        let us = d.as_micros().min(u32::MAX as u128) as u32;
        self.total_us.fetch_add(u64::from(us), Ordering::Relaxed);
        self.max_us.fetch_max(us, Ordering::Relaxed);
        self.count.fetch_add(1, Ordering::Relaxed);
    }

    /// Mean and maximum in milliseconds, resetting for the next second.
    pub fn take(&self) -> (f32, f32) {
        let total = self.total_us.swap(0, Ordering::Relaxed);
        let max = self.max_us.swap(0, Ordering::Relaxed);
        let count = self.count.swap(0, Ordering::Relaxed);
        let mean = if count == 0 {
            0.0
        } else {
            total as f32 / count as f32 / 1000.0
        };
        (mean, max as f32 / 1000.0)
    }
}

/// Every span of the present path, plus a count of the gaps big enough to be
/// the hitch being hunted.
#[derive(Default)]
pub struct PresentTiming {
    pub gap: Span,
    pub layer: Span,
    pub down: Span,
    /// GPU execution time of the capture blit, from timestamps in its own
    /// command buffer.
    ///
    /// Not part of the `gap`/`layer`/`down` partition — those three account for
    /// the game's thread, and this is the GPU, which runs alongside it. It is
    /// the share of the device the capture takes from whatever is rendering.
    pub blit: Span,
    /// Gaps longer than [`LONG_GAP`]. A steady handful per second is a
    /// periodic stall; zero means the frame time is merely uneven.
    long_gaps: AtomicU32,
}

/// What counts as a hitch rather than jitter: two frames' worth at 60.
pub const LONG_GAP: Duration = Duration::from_millis(33);

impl PresentTiming {
    pub fn record_gap(&self, d: Duration) {
        self.gap.record(d);
        if d >= LONG_GAP {
            self.long_gaps.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub fn take_long_gaps(&self) -> u32 {
        self.long_gaps.swap(0, Ordering::Relaxed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_span_reports_mean_and_max_then_resets() {
        let s = Span::default();
        s.record(Duration::from_micros(1000));
        s.record(Duration::from_micros(3000));
        let (mean, max) = s.take();
        assert!((mean - 2.0).abs() < 0.001, "mean was {mean}");
        assert!((max - 3.0).abs() < 0.001, "max was {max}");

        // Taking resets, so a quiet second reads zero rather than the last
        // second's numbers over again.
        let (mean, max) = s.take();
        assert_eq!((mean, max), (0.0, 0.0));
    }

    #[test]
    fn only_gaps_past_the_threshold_are_counted_as_hitches() {
        let t = PresentTiming::default();
        t.record_gap(Duration::from_millis(16));
        t.record_gap(Duration::from_millis(32));
        t.record_gap(Duration::from_millis(33));
        t.record_gap(Duration::from_millis(120));
        assert_eq!(t.take_long_gaps(), 2);
        assert_eq!(t.take_long_gaps(), 0, "the count did not reset");
    }
}
