//! How late a media unit arrived, measured the same way at both ends.
//!
//! # What this measures
//!
//! Every media unit carries the time the sender stamped on it, on the sender's
//! [`clock`](crate::clock). The receiver's clock is unrelated, so the one-way
//! delay `d = observed - stamp` contains an unknown constant -- the two clocks'
//! offset -- plus propagation, plus queueing. Only the queueing varies, and it
//! is the only part a playout or a rate decision has any use for: a path that
//! delivers everything exactly 300 ms late needs no buffer, while one that
//! alternates between 10 and 60 ms needs 50 whatever its average.
//!
//! So the lowest `d` the path has produced stands in for offset plus
//! propagation, and a unit's queueing delay is how far above that it landed.
//!
//! # Clock skew, measured instead of expired
//!
//! Two crystals never run at quite the same rate. At 100 ppm the receiver's
//! clock gains 0.1 ms a second on the sender's, so `d` drifts linearly, and a
//! lowest-ever `d` taken an hour ago would be 360 ms off. This used to be
//! handled by letting the best case expire after 30 s, which was a guess about
//! how fast paths change, and threw away a good baseline on a timer.
//!
//! Instead the drift is measured: the lowest `d` of each second lies on a line
//! whose slope is the skew, found by least squares over every second the path
//! has run. The baseline is that line at its lowest, and it never expires --
//! nothing invalidates it but a change of path, which the caller knows about
//! and says so with [`DelayTracker::reset_baseline`].
//!
//! # Why this is shared
//!
//! The hub measures its own pipeline with it (capture to hand-off, one clock,
//! no skew) and the client measures the whole path. Two different measures
//! could not be compared, so there is one, defined once.

/// One second's queueing delay, summarised.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DelaySummary {
    /// Units measured.
    pub frames: u32,
    /// Median queueing delay above the path's best, in microseconds.
    pub p50_us: u32,
    /// The 95th percentile of the same.
    pub p95_us: u32,
    /// The worst single unit.
    pub max_us: u32,
}

/// `[4B frames][4B p50_us][4B p95_us][4B max_us]`, little-endian.
pub const DELAY_SUMMARY_LEN: usize = 16;

impl DelaySummary {
    pub fn encode(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.frames.to_le_bytes());
        buf.extend_from_slice(&self.p50_us.to_le_bytes());
        buf.extend_from_slice(&self.p95_us.to_le_bytes());
        buf.extend_from_slice(&self.max_us.to_le_bytes());
    }

    /// `None` when `buf` is shorter than [`DELAY_SUMMARY_LEN`].
    pub fn decode(buf: &[u8]) -> Option<Self> {
        let at = |o: usize| Some(u32::from_le_bytes(buf.get(o..o + 4)?.try_into().ok()?));
        Some(Self {
            frames: at(0)?,
            p50_us: at(4)?,
            p95_us: at(8)?,
            max_us: at(12)?,
        })
    }
}

/// Ceiling on units held for one summary, so a consumer that stops taking
/// cannot grow this without bound. Far past a second of any stream we send.
const MAX_SAMPLES: usize = 4096;

/// Tracks queueing delay for one media stream on one path.
#[derive(Debug, Default)]
pub struct DelayTracker {
    /// The first observation, which every later one is measured relative to,
    /// so the fit works on small numbers: `(observed_us, d_us)`.
    origin: Option<(u64, i64)>,
    /// The second being collected, and the lowest `d` seen in it so far.
    current: Option<(u64, f64)>,
    /// Every completed second's lowest `d`: `(seconds since origin, d)`.
    minima: Vec<(f64, f64)>,
    /// Running sums for the least-squares line through `minima`.
    fit: Fit,
    /// The skew, in microseconds of `d` per second of the receiver's clock.
    slope: f64,
    /// The lowest `d - slope * x` the path has produced: where the baseline
    /// line sits.
    floor: Option<f64>,
    /// Queueing delay of each unit since the last [`take`](Self::take).
    samples: Vec<u32>,
}

#[derive(Debug, Default, Clone, Copy)]
struct Fit {
    n: f64,
    sx: f64,
    sy: f64,
    sxx: f64,
    sxy: f64,
}

impl Fit {
    fn add(&mut self, x: f64, y: f64) {
        self.n += 1.0;
        self.sx += x;
        self.sy += y;
        self.sxx += x * x;
        self.sxy += x * y;
    }

    /// The least-squares slope, once there are two distinct seconds to draw a
    /// line through.
    fn slope(&self) -> Option<f64> {
        let denominator = self.n * self.sxx - self.sx * self.sx;
        (self.n >= 2.0 && denominator > 0.0)
            .then(|| (self.n * self.sxy - self.sx * self.sy) / denominator)
    }
}

impl DelayTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record one unit, and return its queueing delay in microseconds.
    ///
    /// `stamp_us` is the time the unit carries, on the sender's clock;
    /// `observed_us` is this end's clock at the point being measured -- arrival
    /// for a receiver, hand-off to the transport for a sender.
    pub fn observe(&mut self, stamp_us: u64, observed_us: u64) -> u32 {
        // Both are microsecond counts far below 2^63, so the difference of the
        // two as signed is exact.
        let d = observed_us as i64 - stamp_us as i64;
        let (origin_us, origin_d) = *self.origin.get_or_insert((observed_us, d));
        let x_us = observed_us.saturating_sub(origin_us);
        let x = x_us as f64 / 1e6;
        let y = (d - origin_d) as f64;

        let second = x_us / 1_000_000;
        match self.current {
            Some((at, _)) if at != second => {
                self.close_second();
                self.current = Some((second, y));
            }
            Some((_, ref mut low)) => *low = low.min(y),
            None => self.current = Some((second, y)),
        }

        let residual = y - self.slope * x;
        let floor = match self.floor {
            Some(floor) if floor <= residual => floor,
            _ => residual,
        };
        self.floor = Some(floor);

        let q = (residual - floor).clamp(0.0, f64::from(u32::MAX)) as u32;
        if self.samples.len() < MAX_SAMPLES {
            self.samples.push(q);
        }
        q
    }

    /// The skew this path has been measured at, in parts per million: how much
    /// faster this end's clock runs than the sender's. Zero until there are two
    /// seconds to measure it from.
    pub fn skew_ppm(&self) -> f64 {
        self.slope
    }

    /// Summarise and clear the units seen since the last call.
    ///
    /// Returns `None` for a second in which nothing arrived. That is not the
    /// same as a second with no queueing, and reporting zero would say the path
    /// is behaving perfectly at the moment it has stopped delivering anything.
    pub fn take(&mut self) -> Option<DelaySummary> {
        if self.samples.is_empty() {
            return None;
        }
        self.samples.sort_unstable();
        let at = |q: f64| self.samples[((self.samples.len() - 1) as f64 * q) as usize];
        let summary = DelaySummary {
            frames: self.samples.len() as u32,
            p50_us: at(0.5),
            p95_us: at(0.95),
            max_us: self.samples[self.samples.len() - 1],
        };
        self.samples.clear();
        Some(summary)
    }

    /// Forget the path entirely: baseline, skew and every second behind them.
    ///
    /// For a path change, where the old path's propagation delay says nothing
    /// about the new one's, and keeping it would read the difference as
    /// queueing for the rest of the session.
    pub fn reset_baseline(&mut self) {
        *self = Self {
            samples: std::mem::take(&mut self.samples),
            ..Self::default()
        };
    }

    /// Fold the second just finished into the fit, and move the baseline line
    /// to the new slope.
    fn close_second(&mut self) {
        let Some((second, low)) = self.current.take() else {
            return;
        };
        // The minimum is placed at the middle of its second: it could have been
        // anywhere in it, and the middle is where that error averages out.
        let x = second as f64 + 0.5;
        self.minima.push((x, low));
        self.fit.add(x, low);
        if let Some(slope) = self.fit.slope() {
            self.slope = slope;
            self.floor = self
                .minima
                .iter()
                .map(|(x, y)| y - slope * x)
                .reduce(f64::min);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The receiver's clock is offset from the sender's by an arbitrary amount.
    const OFFSET: u64 = 1_700_000_000_000_000;

    /// A unit stamped at `sent_us`, `transit_us` in flight, arriving on a
    /// receiver clock that runs `skew_ppm` fast.
    fn arrive(j: &mut DelayTracker, sent_us: u64, transit_us: u64, skew_ppm: f64) -> u32 {
        let true_arrival = sent_us + transit_us;
        let observed = OFFSET + true_arrival + (true_arrival as f64 * skew_ppm / 1e6) as u64;
        j.observe(sent_us, observed)
    }

    #[test]
    fn a_constant_delay_is_not_queueing() {
        let mut j = DelayTracker::new();
        for i in 0..120u64 {
            arrive(&mut j, i * 16_000, 300_000, 0.0);
        }
        let s = j.take().expect("units arrived");
        assert_eq!(s.max_us, 0, "a constant offset was read as queueing");
        assert_eq!(s.frames, 120);
    }

    #[test]
    fn queueing_is_measured_against_the_best_the_path_managed() {
        let mut j = DelayTracker::new();
        arrive(&mut j, 0, 20_000, 0.0);
        let q = arrive(&mut j, 16_000, 70_000, 0.0);
        arrive(&mut j, 32_000, 20_000, 0.0);
        assert_eq!(q, 50_000, "the 70 ms unit is 50 ms above the 20 ms best");
        assert_eq!(j.take().unwrap().max_us, 50_000);
    }

    #[test]
    fn a_better_unit_becomes_the_baseline_at_once() {
        let mut j = DelayTracker::new();
        arrive(&mut j, 0, 90_000, 0.0);
        assert_eq!(arrive(&mut j, 16_000, 10_000, 0.0), 0);
        assert_eq!(arrive(&mut j, 32_000, 50_000, 0.0), 40_000);
    }

    #[test]
    fn a_silent_second_reports_nothing_rather_than_no_queueing() {
        assert_eq!(DelayTracker::new().take(), None);
    }

    /// The reason the baseline no longer expires: at 100 ppm a fixed baseline
    /// would read 0.1 ms a second of drift as queueing, which over ten minutes
    /// is 60 ms on a path with none at all.
    #[test]
    fn clock_skew_is_measured_and_not_read_as_queueing() {
        let mut j = DelayTracker::new();
        // Ten minutes at 200 units a second, a steady 40 ms path, 100 ppm.
        for i in 0..(600 * 200u64) {
            let q = arrive(&mut j, i * 5_000, 40_000, 100.0);
            if i > 200 * 5 {
                assert!(q < 200, "unit {i} read {q} µs of queueing from skew alone");
            }
        }
        assert!(
            (j.skew_ppm() - 100.0).abs() < 1.0,
            "measured {} ppm",
            j.skew_ppm()
        );
    }

    #[test]
    fn queueing_on_a_skewed_path_is_still_exact() {
        let mut j = DelayTracker::new();
        for i in 0..(60 * 200u64) {
            arrive(&mut j, i * 5_000, 40_000, -150.0);
        }
        let stalled = arrive(&mut j, 60 * 200 * 5_000, 40_000 + 25_000, -150.0);
        assert!((24_500..25_500).contains(&stalled), "read {stalled} µs");
    }

    #[test]
    fn a_reset_forgets_the_old_path_entirely() {
        let mut j = DelayTracker::new();
        arrive(&mut j, 0, 10_000, 0.0);
        j.take();
        j.reset_baseline();
        assert_eq!(
            arrive(&mut j, 16_000, 400_000, 0.0),
            0,
            "the new path was judged against the old one"
        );
    }

    #[test]
    fn the_tail_is_kept_apart_from_the_middle() {
        let mut j = DelayTracker::new();
        for i in 0..99u64 {
            arrive(&mut j, i * 16_000, 10_000, 0.0);
        }
        arrive(&mut j, 99 * 16_000, 260_000, 0.0);
        let s = j.take().expect("units arrived");
        assert_eq!(s.p50_us, 0);
        assert_eq!(s.max_us, 250_000);
    }

    #[test]
    fn taking_clears_so_each_answer_describes_one_second() {
        let mut j = DelayTracker::new();
        arrive(&mut j, 0, 10_000, 0.0);
        assert!(j.take().is_some());
        assert_eq!(
            j.take(),
            None,
            "a second reported the previous second again"
        );
    }

    #[test]
    fn a_summary_survives_the_wire() {
        let s = DelaySummary {
            frames: 200,
            p50_us: 1_200,
            p95_us: 18_000,
            max_us: 41_200,
        };
        let mut buf = Vec::new();
        s.encode(&mut buf);
        assert_eq!(buf.len(), DELAY_SUMMARY_LEN);
        assert_eq!(DelaySummary::decode(&buf), Some(s));
        assert_eq!(DelaySummary::decode(&buf[..15]), None);
    }
}
