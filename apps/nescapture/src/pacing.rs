// ─────────────────────────────────────────────────────────────────────────────
//  pacing.rs — capture frame-rate gate
//
//  The layer is the only place that sees every frame the game produces, so it
//  is the only place that can decide which ones are worth capturing. Nothing
//  here consults the compositor: no vblank, no surface, no present feedback,
//  just the monotonic clock. nescope runs uncapped by design and must stay out
//  of this decision.
//
//  The gate only ever *drops*. It never waits, never blocks the game's present,
//  and never admits more frames than the game offered. A game running below the
//  target is passed through untouched — including, and this is the whole
//  difficulty, a game whose average is below the target but which delivers its
//  frames in fast runs separated by stalls. That is what a CPU-starved game
//  looks like, and it is the case the first version of this got wrong.
// ─────────────────────────────────────────────────────────────────────────────

use std::time::{Duration, Instant};

/// Admits at most `target_fps` frames per second, dropping the rest.
///
/// A token bucket, not a deadline. The first version compared each present
/// against a fixed deadline and, after a stall, dropped whatever debt had built
/// up so that a resuming game could not replay it as a burst. That is right for
/// a game coming back from a load screen and wrong for one that micro-stalls
/// constantly: the fast runs between stalls were thinned to the target while
/// the stalls themselves were never made up, so a game averaging fifty frames a
/// second lost a fifth of them to a gate set to sixty. Measured on the target
/// as `present 50/s, admitted 43/s`.
///
/// Credit accrues with real time and is spent one unit per admitted frame, so
/// over any window the admitted rate is the smaller of the game's rate and the
/// target — which is the property that was wanted all along. The cap on
/// accumulated credit is what keeps a long stall from banking a replay.
pub struct FrameGate {
    /// Zero means uncapped — every frame is admitted.
    interval: Duration,
    /// Credit available, in frames. One is spent per admitted frame.
    credit: f64,
    /// The most credit that may accumulate, in frames.
    ///
    /// This is the whole of the stall policy. Too small and a game that stalls
    /// briefly can never catch up, which is the bug this replaced; too large
    /// and a game returning from a load screen replays everything it missed at
    /// once. Bounded by the capture ring, because credit beyond the number of
    /// slots buys frames that would be refused for want of one anyway.
    burst: f64,
    /// When the previous present arrived. `None` until the first.
    last: Option<Instant>,
}

impl FrameGate {
    /// The most credit the gate will bank, in frames.
    ///
    /// [`crate::state::CAPTURE_SLOTS`] — a burst larger than the ring cannot be
    /// captured however generous the gate is.
    const BURST_FRAMES: f64 = crate::state::CAPTURE_SLOTS as f64;

    pub fn new(target_fps: u32) -> Self {
        let interval = if target_fps == 0 {
            Duration::ZERO
        } else {
            Duration::from_nanos(1_000_000_000 / u64::from(target_fps))
        };
        Self {
            interval,
            // Starts full: the first frames of a run must not be thinned just
            // because the gate has no history yet.
            credit: Self::BURST_FRAMES,
            burst: Self::BURST_FRAMES,
            last: None,
        }
    }

    /// Read the target from the environment. `0` disables the gate.
    pub fn from_env() -> Self {
        let fps = std::env::var("NESCAPTURE_FPS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(60);
        Self::new(fps)
    }

    /// Frames per second this gate admits, or 0 when uncapped.
    pub fn target_fps(&self) -> u32 {
        if self.interval.is_zero() {
            0
        } else {
            (1_000_000_000 / self.interval.as_nanos().max(1)) as u32
        }
    }

    /// Decide whether the frame presented at `now` should be captured.
    pub fn admit(&mut self, now: Instant) -> bool {
        if self.interval.is_zero() {
            return true;
        }

        // `saturating_duration_since` because `now` comes from the caller and a
        // present arriving out of order would otherwise panic. Zero elapsed
        // simply earns no credit.
        let elapsed = match self.last {
            Some(last) => now.saturating_duration_since(last),
            None => Duration::ZERO,
        };
        self.last = Some(now);

        let earned = elapsed.as_secs_f64() / self.interval.as_secs_f64();
        self.credit = (self.credit + earned).min(self.burst);

        if self.credit >= 1.0 {
            self.credit -= 1.0;
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HZ60: Duration = Duration::from_nanos(16_666_666);

    #[test]
    fn uncapped_admits_everything() {
        let mut g = FrameGate::new(0);
        let t = Instant::now();
        for i in 0..100 {
            assert!(g.admit(t + Duration::from_micros(i)));
        }
    }

    #[test]
    fn fast_game_is_thinned_to_the_target() {
        // 300 fps offered, 60 wanted: one frame in five, over a full second.
        // The bucket starts full, so the first few come through back to back —
        // hence the allowance above 60 rather than a tight band.
        let mut g = FrameGate::new(60);
        let t0 = Instant::now();
        let step = Duration::from_nanos(3_333_333);
        let admitted = (0..300).filter(|i| g.admit(t0 + step * *i)).count();
        assert!((59..=65).contains(&admitted), "admitted {admitted}");
    }

    /// Over a long enough run the starting credit stops mattering and the rate
    /// is the target, which is the property the gate exists for.
    #[test]
    fn a_fast_game_settles_at_the_target_over_ten_seconds() {
        let mut g = FrameGate::new(60);
        let t0 = Instant::now();
        let step = Duration::from_nanos(3_333_333);
        let admitted = (0..3000).filter(|i| g.admit(t0 + step * *i)).count();
        assert!((595..=610).contains(&admitted), "admitted {admitted} in 10s");
    }

    #[test]
    fn slow_game_passes_through_untouched() {
        // 30 fps offered, 60 wanted: nothing may be dropped.
        let mut g = FrameGate::new(60);
        let t0 = Instant::now();
        let step = Duration::from_nanos(33_333_333);
        for i in 0..60 {
            assert!(g.admit(t0 + step * i), "dropped frame {i} of a 30 fps game");
        }
    }

    #[test]
    fn matched_rate_does_not_beat_against_the_gate() {
        // A game at exactly the target rate must not lose frames to jitter.
        let mut g = FrameGate::new(60);
        let t0 = Instant::now();
        let mut at = t0;
        for i in 0..120 {
            // ±1ms of jitter around a perfect 60 Hz cadence.
            let jitter = if i % 2 == 0 {
                Duration::from_millis(1)
            } else {
                Duration::ZERO
            };
            at += HZ60;
            assert!(g.admit(at + jitter), "dropped frame {i} of a 60 fps game");
        }
    }

    /// The case the deadline version got wrong, and the reason this is a
    /// bucket. A CPU-starved game presents in fast runs broken by micro-stalls:
    /// four frames at 12ms, then a 52ms gap — five frames per 100ms, fifty a
    /// second, well under the sixty the gate allows. Every one must survive.
    /// The old gate dropped a fifth of them, which is what
    /// `present 50/s, admitted 43/s` was on the target.
    #[test]
    fn a_stuttering_game_below_the_target_keeps_every_frame() {
        let mut g = FrameGate::new(60);
        let mut at = Instant::now();
        let steps = [
            Duration::from_millis(12),
            Duration::from_millis(12),
            Duration::from_millis(12),
            Duration::from_millis(12),
            Duration::from_millis(52),
        ];
        let mut admitted = 0;
        for i in 0..200 {
            at += steps[i % steps.len()];
            if g.admit(at) {
                admitted += 1;
            }
        }
        assert_eq!(
            admitted, 200,
            "dropped {} frames of a 50 fps game",
            200 - admitted
        );
    }

    /// A deeper stutter than the bucket can cover is still thinned, and must
    /// be: eight frames at 10ms is a hundred a second however short the run.
    /// What matters is that it is thinned towards the target rather than below
    /// it — the failure being guarded against is losing frames a slow game
    /// needed, not admitting fewer than a fast run offers.
    #[test]
    fn a_run_faster_than_the_target_is_still_thinned() {
        let mut g = FrameGate::new(60);
        let mut at = Instant::now();
        let mut admitted = 0;
        // Eight at 10ms then 120ms idle: 8 frames per 200ms, 40 a second.
        for i in 0..400 {
            at += if i % 9 == 8 {
                Duration::from_millis(120)
            } else {
                Duration::from_millis(10)
            };
            if g.admit(at) {
                admitted += 1;
            }
        }
        // Offered 400 over ~8.9s at an average of 45/s. Whatever is dropped,
        // the result must stay far above what the old gate managed and must
        // never exceed what was offered.
        assert!(admitted <= 400);
        assert!(
            admitted >= 340,
            "admitted only {admitted} of 400 from a sub-target game"
        );
    }

    #[test]
    fn a_stall_does_not_bank_a_burst() {
        let mut g = FrameGate::new(60);
        let t0 = Instant::now();
        assert!(g.admit(t0));

        // Two seconds of nothing — a load screen.
        let resume = t0 + Duration::from_secs(2);
        assert!(g.admit(resume));

        // The game resuming at 300 fps must not replay the ~120 frames the gate
        // "missed" during the stall. Across the next 100ms it may admit what 60
        // fps allows — about six — plus at most the bucket's depth, and nothing
        // like the thirty on offer.
        let step = Duration::from_nanos(3_333_333);
        let burst = (1..30).filter(|i| g.admit(resume + step * *i)).count();
        assert!(
            burst <= 6 + FrameGate::BURST_FRAMES as usize,
            "admitted {burst} frames in 100ms after a stall"
        );
        assert!(burst >= 5, "admitted only {burst} frames in 100ms");
    }

    /// Credit is bounded however long the stall, so the depth of the burst
    /// after one does not grow with it.
    #[test]
    fn a_longer_stall_does_not_bank_a_deeper_burst() {
        let after = |stall: Duration| {
            let mut g = FrameGate::new(60);
            let t0 = Instant::now();
            g.admit(t0);
            let resume = t0 + stall;
            let step = Duration::from_nanos(3_333_333);
            (0..30).filter(|i| g.admit(resume + step * *i)).count()
        };
        assert_eq!(
            after(Duration::from_secs(2)),
            after(Duration::from_secs(60)),
            "a longer stall banked a deeper burst"
        );
    }
}
