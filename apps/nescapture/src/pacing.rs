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
//  target is passed through untouched.
// ─────────────────────────────────────────────────────────────────────────────

use std::time::{Duration, Instant};

/// Admits at most `target_fps` frames per second, dropping the rest.
///
/// The deadline advances by a fixed interval rather than being recomputed from
/// the admitted frame's arrival time, so a game presenting slightly off-cadence
/// does not accumulate drift.
pub struct FrameGate {
    /// Zero means uncapped — every frame is admitted.
    interval: Duration,
    /// Frames arriving within this much of the deadline are admitted early.
    ///
    /// Without it, a game running at exactly the target rate beats against the
    /// gate: presents land a hair before each deadline, get rejected, and the
    /// stream loses a frame every time the two rates drift past each other.
    slack: Duration,
    /// `None` until the first frame establishes the cadence.
    next_deadline: Option<Instant>,
}

impl FrameGate {
    pub fn new(target_fps: u32) -> Self {
        let interval = if target_fps == 0 {
            Duration::ZERO
        } else {
            Duration::from_nanos(1_000_000_000 / u64::from(target_fps))
        };
        Self {
            interval,
            slack: interval / 8,
            next_deadline: None,
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
        let Some(deadline) = self.next_deadline else {
            self.next_deadline = Some(now + self.interval);
            return true;
        };
        if now + self.slack < deadline {
            return false;
        }

        // Advance one interval from the deadline, not from `now`, so a game
        // presenting slightly early or late keeps an exact cadence.
        let advanced = deadline + self.interval;

        // Slip clamp. If the game stalled — a load screen, a shader compile, a
        // hitch — the deadline can end up many intervals in the past. Advancing
        // by one interval at a time would leave the gate "owing" frames and it
        // would admit a burst of them back to back the moment the game resumes,
        // which is exactly when the GPU can least afford it. Drop the debt and
        // restart the cadence from now.
        self.next_deadline = Some(if advanced <= now {
            now + self.interval
        } else {
            advanced
        });
        true
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
        let mut g = FrameGate::new(60);
        let t0 = Instant::now();
        let step = Duration::from_nanos(3_333_333);
        let admitted = (0..300).filter(|i| g.admit(t0 + step * *i)).count();
        assert!((59..=61).contains(&admitted), "admitted {admitted}");
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

    #[test]
    fn a_stall_does_not_bank_a_burst() {
        let mut g = FrameGate::new(60);
        let t0 = Instant::now();
        assert!(g.admit(t0));

        // Two seconds of nothing — a load screen.
        let resume = t0 + Duration::from_secs(2);

        // The first frame back is admitted immediately...
        assert!(g.admit(resume));

        // ...but the game resuming at 300 fps must not replay the ~120 frames
        // the gate "missed" during the stall. Across the next 100ms it may
        // admit only what 60 fps allows: about six, not all thirty offered.
        let step = Duration::from_nanos(3_333_333);
        let burst = (1..30).filter(|i| g.admit(resume + step * *i)).count();
        assert!((4..=7).contains(&burst), "admitted {burst} frames in 100ms");
    }
}
