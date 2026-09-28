//! How much a delay varies, measured the same way at both ends.
//!
//! # What this measures
//!
//! Every frame carries the timestamp the sender stamped on it at capture. The
//! two clocks are unrelated, so the difference between that and the moment the
//! frame arrives here is meaningless on its own -- it contains an unknown,
//! roughly constant offset. Its *variation* is not meaningless, and variation is
//! the only thing a playout buffer exists to absorb: a path that delivers every
//! frame exactly 300 ms late needs no buffer at all, while one that alternates
//! between 10 ms and 60 ms needs 50 ms whatever its average.
//!
//! So this tracks the smallest difference seen recently -- the best the path has
//! managed, which stands in for the unknown offset -- and reports how far above
//! it each frame lands.
//!
//! # What it deliberately does not do
//!
//! It does not distinguish the sender's contribution from the network's. The
//! sender reports its own pipeline delay separately, and the two are compared
//! rather than subtracted: a frame that was late because the encoder stalled
//! should not raise a buffer, because buffering is latency spent hiding a fault
//! that should be fixed instead.
//!
//! # Why this is shared
//!
//! Both ends measure a delay and the two are compared: the hub reports how much
//! its own pipeline varied before a frame left, the client reports how much the
//! total varied by the time it arrived. A comparison between two different
//! measures would be meaningless, so there is one measure, defined once.
//!
//! It also has to be *variation* on both sides rather than absolute delay,
//! because neither side can know the absolute. The hub's `timestamp_ms` counts
//! from the encoder's own start, not from any epoch, so even on one machine the
//! difference to wall clock contains an unknown constant -- and across two
//! machines there is no shared clock at all.
//!
//! Nothing here adapts anything yet. It measures, so that the decision about
//! what to adapt is made against a distribution rather than an intuition.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// How long a best-case observation stays authoritative.
///
/// The minimum has to expire. Paths change -- a relay is dropped for a direct
/// connection, a phone moves between cells -- and a minimum from the old path
/// makes every frame on the new one look permanently late, which would pin a
/// buffer at a size nothing needs. Long enough that an ordinary quiet spell does
/// not reset the baseline, short enough that a genuine change is noticed.
const BASELINE_WINDOW: Duration = Duration::from_secs(30);

/// Ceiling on retained observations, so a stalled consumer cannot grow this.
const MAX_SAMPLES: usize = 4096;

/// One second's worth of lateness, summarised.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DelaySummary {
    /// Frames measured.
    pub frames: u32,
    /// Median lateness above the best the path has managed, in milliseconds.
    pub p50_ms: u16,
    /// The 95th percentile of the same.
    pub p95_ms: u16,
    /// The worst single frame.
    pub max_ms: u16,
}

/// Tracks arrival lateness for one media stream.
#[derive(Debug)]
pub struct DelayTracker {
    /// Best-case delay observations, each with when it was taken, oldest first.
    ///
    /// A deque rather than a single value because a minimum that can only fall
    /// never recovers from a path that improved, and one that is simply reset on
    /// a timer throws away a good baseline for no reason. Holding the recent
    /// candidates lets the oldest expire while a better one is still standing.
    baseline: VecDeque<(Instant, i32)>,
    /// Lateness of each frame this second, in milliseconds.
    samples: Vec<u16>,
    /// The first delay seen, as an anchor for every later one.
    ///
    /// Delays are compared *relative to this*, in wrapping arithmetic. Both
    /// clocks are unrelated and the sender's stamp is a `u32` of milliseconds
    /// that wraps every 49 days, so an absolute subtraction is a number with no
    /// meaning and a wrap in the middle of a session makes it jump by 2^32 --
    /// which, taken as lateness, reads as every frame being weeks late until the
    /// baseline expires. Anchoring and then interpreting the difference as
    /// signed makes the wrap a non-event, because the quantity that matters is
    /// only ever a few hundred milliseconds wide.
    anchor: Option<u32>,
}

impl Default for DelayTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl DelayTracker {
    pub fn new() -> Self {
        Self {
            baseline: VecDeque::new(),
            samples: Vec::new(),
            anchor: None,
        }
    }

    /// Record one frame's arrival.
    ///
    /// `stamp_ms` is the timestamp the frame carries; `observed_ms` is the local
    /// clock at the point being measured -- arrival, for a receiver; the moment
    /// the frame is handed to the transport, for a sender. See [`anchor`](Self::anchor) for why the difference is taken
    /// in wrapping arithmetic rather than widened.
    pub fn observe(&mut self, stamp_ms: u32, observed_ms: u64, now: Instant) {
        let raw = (observed_ms as u32).wrapping_sub(stamp_ms);
        let anchor = *self.anchor.get_or_insert(raw);
        let delay = raw.wrapping_sub(anchor) as i32;
        self.expire(now);

        // Anything at or below the running minimum becomes the new baseline, and
        // supersedes the candidates it beats -- they can only be worse, so
        // keeping them would let a stale, higher value resurface on expiry.
        while self.baseline.back().is_some_and(|(_, d)| *d >= delay) {
            self.baseline.pop_back();
        }
        self.baseline.push_back((now, delay));

        let best = self.baseline.front().map(|(_, d)| *d).unwrap_or(delay);
        let lateness = i64::from(delay)
            .saturating_sub(i64::from(best))
            .clamp(0, i64::from(u16::MAX)) as u16;
        if self.samples.len() < MAX_SAMPLES {
            self.samples.push(lateness);
        }
    }

    /// Summarise and clear the frames seen since the last call.
    ///
    /// Returns `None` for a second in which nothing arrived. That is not the
    /// same as a second with no lateness, and reporting zero would say the path
    /// is behaving perfectly at the moment it has stopped delivering anything.
    pub fn take(&mut self) -> Option<DelaySummary> {
        if self.samples.is_empty() {
            return None;
        }
        self.samples.sort_unstable();
        let at = |q: f64| self.samples[((self.samples.len() - 1) as f64 * q) as usize];
        let summary = DelaySummary {
            frames: self.samples.len() as u32,
            p50_ms: at(0.5),
            p95_ms: at(0.95),
            max_ms: self.samples[self.samples.len() - 1],
        };
        self.samples.clear();
        Some(summary)
    }

    /// Forget the baseline entirely.
    ///
    /// For a path change, where the old best case says nothing about the new
    /// path and keeping it would make every frame look late until it expired.
    pub fn reset_baseline(&mut self) {
        self.baseline.clear();
    }

    fn expire(&mut self, now: Instant) {
        while self
            .baseline
            .front()
            .is_some_and(|(seen, _)| now.duration_since(*seen) > BASELINE_WINDOW)
        {
            self.baseline.pop_front();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A frame sent at `ts_ms` arriving `transit` milliseconds later, where the
    /// receiver's clock is offset from the sender's by an arbitrary amount.
    const OFFSET: u64 = 1_700_000_000_000;

    fn at(j: &mut DelayTracker, ts_ms: u32, transit: u64, now: Instant) {
        j.observe(ts_ms, OFFSET + u64::from(ts_ms) + transit, now);
    }

    #[test]
    fn a_constant_delay_is_not_jitter() {
        // The point of the whole measure. A path that delivers every frame
        // exactly 300 ms late needs no buffer at all; only variation does.
        let mut j = DelayTracker::new();
        let now = Instant::now();
        for i in 0..120u32 {
            at(
                &mut j,
                i * 16,
                300,
                now + Duration::from_millis(u64::from(i) * 16),
            );
        }
        let s = j.take().expect("frames arrived");
        assert_eq!(s.max_ms, 0, "a constant offset was read as lateness");
        assert_eq!(s.frames, 120);
    }

    #[test]
    fn lateness_is_measured_against_the_best_the_path_managed() {
        let mut j = DelayTracker::new();
        let now = Instant::now();
        at(&mut j, 0, 20, now);
        at(&mut j, 16, 70, now + Duration::from_millis(16));
        at(&mut j, 32, 20, now + Duration::from_millis(32));
        let s = j.take().expect("frames arrived");
        assert_eq!(
            s.max_ms, 50,
            "the 70 ms frame is 50 ms above the 20 ms best"
        );
    }

    #[test]
    fn a_silent_second_reports_nothing_rather_than_no_jitter() {
        // Zero would say the path is behaving perfectly at the moment it has
        // stopped delivering anything at all.
        let mut j = DelayTracker::new();
        assert_eq!(j.take(), None);
    }

    #[test]
    fn the_baseline_expires_so_an_improved_path_is_noticed() {
        // A minimum that can only fall never recovers: one lucky early frame
        // would make every later frame look late for the rest of the session.
        let mut j = DelayTracker::new();
        let now = Instant::now();
        at(&mut j, 0, 10, now);
        j.take();

        // Much later, the path settles at a steady 200 ms.
        let later = now + BASELINE_WINDOW + Duration::from_secs(1);
        for i in 0..10u32 {
            at(
                &mut j,
                1000 + i * 16,
                200,
                later + Duration::from_millis(u64::from(i) * 16),
            );
        }
        let s = j.take().expect("frames arrived");
        assert_eq!(
            s.max_ms, 0,
            "a stale best case from a previous path made a steady path look late",
        );
    }

    #[test]
    fn a_better_observation_supersedes_worse_ones_still_in_the_window() {
        // Otherwise a higher candidate resurfaces when the better one expires,
        // and the baseline walks upwards for no reason the path can account for.
        let mut j = DelayTracker::new();
        let now = Instant::now();
        at(&mut j, 0, 90, now);
        at(&mut j, 16, 10, now + Duration::from_millis(16));
        // The 90 ms candidate is gone, so this sits 40 ms above the 10 ms best.
        at(&mut j, 32, 50, now + Duration::from_millis(32));
        let s = j.take().expect("frames arrived");
        assert_eq!(s.max_ms, 40);
    }

    #[test]
    fn a_reset_forgets_the_old_path_entirely() {
        let mut j = DelayTracker::new();
        let now = Instant::now();
        at(&mut j, 0, 10, now);
        j.take();
        j.reset_baseline();
        at(&mut j, 16, 400, now + Duration::from_millis(16));
        let s = j.take().expect("frames arrived");
        assert_eq!(s.max_ms, 0, "the new path was judged against the old one");
    }

    #[test]
    fn the_tail_is_kept_apart_from_the_middle() {
        // The number that sizes a buffer is the tail. A run of prompt frames
        // with one bad one must not average into "slightly late".
        let mut j = DelayTracker::new();
        let now = Instant::now();
        for i in 0..99u32 {
            at(
                &mut j,
                i * 16,
                10,
                now + Duration::from_millis(u64::from(i) * 16),
            );
        }
        at(&mut j, 99 * 16, 260, now + Duration::from_millis(99 * 16));
        let s = j.take().expect("frames arrived");
        assert_eq!(s.p50_ms, 0);
        assert_eq!(s.max_ms, 250);
    }

    #[test]
    fn taking_clears_so_each_answer_describes_one_second() {
        let mut j = DelayTracker::new();
        let now = Instant::now();
        at(&mut j, 0, 10, now);
        assert!(j.take().is_some());
        assert_eq!(
            j.take(),
            None,
            "a second reported the previous second again"
        );
    }

    #[test]
    fn a_wrapped_sender_timestamp_does_not_poison_the_baseline() {
        // ts_ms wraps every 49 days. A negative delay taken as the best case
        // would make every subsequent frame appear weeks late.
        let mut j = DelayTracker::new();
        let now = Instant::now();
        j.observe(u32::MAX - 10, OFFSET, now);
        j.observe(5, OFFSET + 16, now + Duration::from_millis(16));
        let s = j.take().expect("frames arrived");
        assert!(s.max_ms < u16::MAX, "a wrap produced a nonsense lateness");
    }
}
