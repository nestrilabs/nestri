//! How long the encoder takes to actually reach a bitrate it was told to use.
//!
//! # Why this exists
//!
//! The bitrate controller decides how often it is worth deciding. Everything
//! else about its design follows from one number nobody has measured: the time
//! between `set_target_bitrate` and the encoder actually producing that rate.
//!
//! Simulated against a measured 1000-mile path, the difference is the whole
//! design. With the encoder settling in a quarter second, a controller sampling
//! the send queue five times a second holds the queue at 50 ms. With the
//! encoder taking a second, the same controller at any rate holds it at about
//! 1400 ms, which is unplayable, and sampling faster buys nothing at all --
//! there is no point reacting quicker than the thing being steered can move.
//!
//! So this measures it, rather than picking a control rate and hoping.
//!
//! # Shape
//!
//! Self-driving on purpose. The ladder and the dwell are fixed here so that two
//! people on two networks produce numbers that can be laid beside each other;
//! if the steps came from a person moving a slider, they would not be.
//!
//! While a sweep is running the encoder ignores bitrates from anywhere else.
//! A controller adjusting in the background would be a second hand on the same
//! dial, and the measurement would describe the argument rather than the
//! encoder.

use std::time::{Duration, Instant};

/// Targets to step through, in kbps.
///
/// Large steps and small ones, downward and upward. Downward matters most --
/// that is the direction taken under congestion, and the direction where being
/// slow costs latency rather than picture -- but an encoder can easily be quick
/// one way and slow the other, so both are here.
const LADDER: [u32; 6] = [6_000, 1_500, 6_000, 3_000, 1_000, 4_000];

/// How long to sit at each rung.
///
/// Long enough to settle and then be seen to be steady. If settling turns out
/// to take longer than this, that is itself the answer and it is reported as a
/// failure to settle rather than as a number.
const DWELL: Duration = Duration::from_secs(5);

/// Window over which the produced rate is measured.
///
/// Short enough to see a change quickly, long enough that one large frame does
/// not look like a rate. At sixty frames a second this averages about thirty.
const WINDOW: Duration = Duration::from_millis(500);

/// How close counts as arrived.
const TOLERANCE: f32 = 0.10;

/// How long it must stay inside the tolerance to count as settled, rather than
/// having passed through on the way somewhere else.
const HOLD: Duration = Duration::from_millis(500);

/// What one rung of the ladder turned out to cost.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StepReport {
    pub from_kbps: u32,
    pub to_kbps: u32,
    /// Milliseconds from the command to the produced rate first being inside
    /// the tolerance and staying there. `None` if it never settled.
    pub settle_ms: Option<u32>,
    pub settle_frames: Option<u32>,
    /// Produced rate over the last second of the dwell, as a fraction of the
    /// target. This is the overshoot the controller has to divide out: a
    /// hardware encoder asked for 1000 does not produce 1000.
    pub steady_ratio: f32,
    /// Keyframes during the rung.
    pub keyframes: u32,
    /// The largest keyframe seen, in bytes.
    ///
    /// Reported rather than folded in, because it is a different quantity with
    /// a different consumer. Settling is about the rate control finding its
    /// operating point; a keyframe is a single burst handed to the transport
    /// whole. The controller needs both and must not confuse them: measured at
    /// 4 s GOP, a run where keyframes were counted in the rate said settling
    /// took 2266 ms where the same encoder with no keyframes said 450 ms, and
    /// in one case the number went *down* when keyframes were added. That is
    /// not an encoder being erratic, it is a window catching an IDR.
    pub keyframe_bytes: u32,
    /// How long that keyframe alone occupies the link at this rung's target,
    /// in milliseconds. This is the burst a queue has to absorb, and the
    /// reason a queue setpoint cannot simply be set below it.
    pub keyframe_ms: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// Letting the encoder reach a steady state before the first step.
    WarmUp,
    Stepping,
    Done,
}

pub struct RateProbe {
    phase: Phase,
    rung: usize,
    /// When the current rung was commanded.
    began: Instant,
    current_kbps: u32,
    /// `(when, bytes)` inside the measurement window, delta frames only.
    ///
    /// Keyframes are deliberately absent. One IDR is worth many delta frames,
    /// so a half-second window containing one reports a rate several times the
    /// truth, leaves the tolerance band, and restarts the settle clock -- which
    /// measures the GOP rather than the encoder.
    samples: Vec<(Instant, u32)>,
    keyframe_bytes: u32,
    /// Frames since the current rung was commanded.
    frames: u32,
    keyframes: u32,
    /// When the produced rate first entered the tolerance, if it still is.
    inside_since: Option<Instant>,
    settled: Option<(u32, u32)>,
    /// The last second of the dwell, for the steady-state ratio.
    steady: Vec<(Instant, u32)>,
    reports: Vec<StepReport>,
}

impl RateProbe {
    /// A probe that has not started stepping yet.
    pub fn new(now: Instant, starting_kbps: u32) -> Self {
        Self {
            phase: Phase::WarmUp,
            rung: 0,
            began: now,
            current_kbps: starting_kbps,
            samples: Vec::new(),
            keyframe_bytes: 0,
            frames: 0,
            keyframes: 0,
            inside_since: None,
            settled: None,
            steady: Vec::new(),
            reports: Vec::new(),
        }
    }

    pub fn finished(&self) -> bool {
        self.phase == Phase::Done
    }

    /// Whether a bitrate from elsewhere should be ignored.
    pub fn owns_the_bitrate(&self) -> bool {
        self.phase != Phase::Done
    }

    /// One encoded frame.
    pub fn observe(&mut self, now: Instant, bytes: u32, keyframe: bool) {
        if keyframe {
            self.keyframe_bytes = self.keyframe_bytes.max(bytes);
        } else {
            self.samples.push((now, bytes));
        }
        self.samples
            .retain(|(t, _)| now.duration_since(*t) <= WINDOW);
        // The steady-state ratio *does* include keyframes: it answers what the
        // link actually carries for a given target, which is the whole output.
        self.steady.push((now, bytes));
        self.steady
            .retain(|(t, _)| now.duration_since(*t) <= Duration::from_secs(1));
        if self.phase != Phase::Stepping {
            return;
        }
        self.frames += 1;
        if keyframe {
            self.keyframes += 1;
        }
        if self.settled.is_some() {
            return;
        }
        let Some(rate) = self.measured_kbps(now) else {
            return;
        };
        let drift =
            (rate as f32 - self.current_kbps as f32).abs() / self.current_kbps.max(1) as f32;
        if drift > TOLERANCE {
            // Left the band, so whatever it was doing was not settling.
            self.inside_since = None;
            return;
        }
        let entered = *self.inside_since.get_or_insert(now);
        if now.duration_since(entered) >= HOLD {
            // Credit the moment it arrived, not the moment it had stayed long
            // enough to prove it: the hold is evidence about the arrival, not
            // part of the time the encoder took.
            let ms = entered.duration_since(self.began).as_millis() as u32;
            self.settled = Some((ms, self.frames));
        }
    }

    /// Produced rate over the window, or `None` before there is a window's worth.
    fn measured_kbps(&self, now: Instant) -> Option<u32> {
        let oldest = self.samples.first()?.0;
        let span = now.duration_since(oldest);
        if span < WINDOW / 2 {
            return None;
        }
        let bits: u64 = self.samples.iter().map(|(_, b)| u64::from(*b) * 8).sum();
        Some((bits as f64 / span.as_secs_f64() / 1000.0) as u32)
    }

    /// The next target to apply, when the current rung is done.
    pub fn due_step(&mut self, now: Instant) -> Option<u32> {
        if now.duration_since(self.began) < DWELL {
            return None;
        }
        if self.phase == Phase::Stepping {
            self.close_rung(now);
        }
        if self.rung >= LADDER.len() {
            self.phase = Phase::Done;
            return None;
        }
        let next = LADDER[self.rung];
        self.rung += 1;
        self.phase = Phase::Stepping;
        self.began = now;
        self.frames = 0;
        self.keyframes = 0;
        self.keyframe_bytes = 0;
        self.inside_since = None;
        self.settled = None;
        let from = self.current_kbps;
        self.current_kbps = next;
        let _ = from;
        Some(next)
    }

    fn close_rung(&mut self, now: Instant) {
        let steady_bits: u64 = self.steady.iter().map(|(_, b)| u64::from(*b) * 8).sum();
        let span = self
            .steady
            .first()
            .map(|(t, _)| now.duration_since(*t).as_secs_f64())
            .unwrap_or(0.0);
        let steady_kbps = if span > 0.0 {
            steady_bits as f64 / span / 1000.0
        } else {
            0.0
        };
        let from = self.reports.last().map_or(0, |r| r.to_kbps);
        self.reports.push(StepReport {
            from_kbps: from,
            to_kbps: self.current_kbps,
            settle_ms: self.settled.map(|(ms, _)| ms),
            settle_frames: self.settled.map(|(_, f)| f),
            steady_ratio: (steady_kbps / f64::from(self.current_kbps.max(1))) as f32,
            keyframes: self.keyframes,
            keyframe_bytes: self.keyframe_bytes,
            keyframe_ms: (u64::from(self.keyframe_bytes) * 8 / u64::from(self.current_kbps.max(1)))
                as u32,
        });
    }

    pub fn reports(&self) -> &[StepReport] {
        &self.reports
    }

    /// The number the controller design turns on: the slowest settle observed.
    ///
    /// The slowest rather than the average, for the same reason the bitrate
    /// controller reads the worst client's report: a loop that keeps up with
    /// the typical step and not the worst one is a loop that falls behind
    /// exactly when the path is changing, which is the only time it matters.
    pub fn worst_settle_ms(&self) -> Option<u32> {
        self.reports.iter().map(|r| r.settle_ms).max().flatten()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Feed a probe frames at `kbps` for `secs`, sixty a second.
    fn feed(probe: &mut RateProbe, start: Instant, secs: f32, kbps: u32) -> Instant {
        let frames = (secs * 60.0) as u32;
        let bytes = (u64::from(kbps) * 1000 / 8 / 60) as u32;
        let mut now = start;
        for i in 1..=frames {
            // From the start each time: stepping by a rounded frame interval
            // drifts, and a helper that loses 4% of every second makes a probe
            // measuring seconds look broken when it is not.
            now = start + Duration::from_secs_f64(f64::from(i) / 60.0);
            probe.observe(now, bytes, false);
        }
        now
    }

    #[test]
    fn an_encoder_that_changes_at_once_settles_at_once() {
        let t0 = Instant::now();
        let mut p = RateProbe::new(t0, 6_000);
        let mut now = feed(&mut p, t0, 5.1, 6_000);
        let step = p.due_step(now).expect("first rung");
        assert_eq!(step, 6_000);
        now = feed(&mut p, now, 5.1, 6_000);
        assert_eq!(p.due_step(now), Some(1_500));
        // Produces the new rate immediately.
        feed(&mut p, now, 2.0, 1_500);
        let r = p.reports();
        assert!(!r.is_empty());
        assert!(
            r[0].settle_ms.is_some_and(|ms| ms < 1_200),
            "an instant encoder reported {:?}",
            r[0].settle_ms
        );
    }

    /// The case that would kill the fast-loop design, and must be visible.
    #[test]
    fn an_encoder_that_never_gets_there_reports_no_settle() {
        let t0 = Instant::now();
        let mut p = RateProbe::new(t0, 6_000);
        let mut now = feed(&mut p, t0, 5.1, 6_000);
        p.due_step(now);
        now = feed(&mut p, now, 5.1, 6_000);
        assert_eq!(p.due_step(now), Some(1_500));
        // Ignores the command completely.
        now = feed(&mut p, now, 5.1, 6_000);
        p.due_step(now);
        let r = p.reports();
        let step = r
            .iter()
            .find(|r| r.to_kbps == 1_500)
            .expect("the 1500 rung");
        assert_eq!(
            step.settle_ms, None,
            "an encoder that ignored us looked settled"
        );
        assert!(
            step.steady_ratio > 3.0,
            "steady ratio {} did not show it producing four times the target",
            step.steady_ratio
        );
    }

    /// Overshoot is the other number the controller needs, so it must be real.
    #[test]
    fn steady_ratio_reports_the_overshoot() {
        let t0 = Instant::now();
        let mut p = RateProbe::new(t0, 6_000);
        let mut now = feed(&mut p, t0, 5.1, 6_000);
        p.due_step(now);
        now = feed(&mut p, now, 5.1, 6_000);
        p.due_step(now);
        // Asked for 1500, produces 1875: the 25% overshoot measured on hardware.
        now = feed(&mut p, now, 5.1, 1_875);
        p.due_step(now);
        let step = p.reports().iter().find(|r| r.to_kbps == 1_500).unwrap();
        assert!(
            (step.steady_ratio - 1.25).abs() < 0.1,
            "steady ratio {} should be about 1.25",
            step.steady_ratio
        );
    }

    /// The confound that made a 4 s GOP look like a three-times slower
    /// encoder, including making one rung appear *faster* when keyframes were
    /// added -- which no encoder does, and which gave the measurement away.
    #[test]
    fn a_keyframe_landing_mid_window_does_not_delay_the_reported_settle() {
        let t0 = Instant::now();
        let mut p = RateProbe::new(t0, 6_000);
        let mut now = feed(&mut p, t0, 5.1, 6_000);
        p.due_step(now);
        now = feed(&mut p, now, 5.1, 6_000);
        assert_eq!(p.due_step(now), Some(1_500));

        // Settles immediately, but an IDR worth a second of bitrate lands in
        // the middle of the window that is meant to prove it.
        let bytes = (1_500u64 * 1000 / 8 / 60) as u32;
        let base = now;
        for i in 1..=320u32 {
            now = base + Duration::from_secs_f64(f64::from(i) / 60.0);
            let key = i == 40;
            p.observe(now, if key { 1_500 * 1000 / 8 } else { bytes }, key);
        }
        p.due_step(now);
        let step = p.reports().iter().find(|r| r.to_kbps == 1_500).unwrap();
        assert!(
            step.settle_ms.is_some_and(|ms| ms < 1_000),
            "an encoder that settled at once reported {:?} because of one keyframe",
            step.settle_ms
        );
        // And the burst is still reported, because the queue has to absorb it.
        assert_eq!(step.keyframes, 1);
        assert!(
            step.keyframe_ms >= 900,
            "a keyframe worth a second of bitrate reported {} ms",
            step.keyframe_ms
        );
    }

    #[test]
    fn a_sweep_ends_and_does_not_step_forever() {
        let t0 = Instant::now();
        let mut p = RateProbe::new(t0, 6_000);
        let mut now = t0;
        for _ in 0..(LADDER.len() + 2) {
            now = feed(&mut p, now, 5.1, 3_000);
            p.due_step(now);
        }
        assert!(p.finished());
        assert!(
            !p.owns_the_bitrate(),
            "a finished sweep still holds the dial"
        );
        assert_eq!(p.reports().len(), LADDER.len());
    }
}
