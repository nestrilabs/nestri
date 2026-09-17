// ─────────────────────────────────────────────────────────────────────────────
//  pacing.rs — capture frame-rate gate
//
//  The layer is the only place that sees every frame the game produces, so it
//  is the only place that can pace one. Nothing here consults the compositor:
//  no vblank, no surface, no present feedback, just the monotonic clock.
//
//  Two jobs, deliberately apart:
//
//    FrameGate   — which frames are captured. Only ever *drops*: it never
//                  waits, never blocks the game's present, and never admits
//                  more frames than the game offered.
//    FramePacer  — how fast the game may run. This one does block, at the end
//                  of the present hook, which is the only thing in the process
//                  that can hold a game whose V-Sync is off.
//
//  Both are needed. The pacer holds the game to the target, and the gate is the
//  backstop for what a sleep cannot promise: `thread::sleep` lands within a
//  fraction of a millisecond, not exactly, so frames still arrive early.
//
//  A game running below the target is untouched by either — including, and this
//  is the whole difficulty, a game whose average is below the target but which
//  delivers its frames in fast runs separated by stalls. That is what a
//  CPU-starved game looks like, and it is the case the first gate got wrong.
//
//  One correction worth recording: this file used to say nescope "runs uncapped
//  by design". It does not. Its `--fps` defaults to 60 and drives both the
//  advertised output refresh and the `wl_surface.frame` cadence, and nothing
//  passes a tier's rate down to it.
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
    /// This is the whole of the stall policy, and [`FrameGate::BURST_WINDOW`]
    /// sets it: the gate enforces the target over any window longer than that
    /// and leaves shorter ones alone.
    burst: f64,
    /// When the previous present arrived. `None` until the first.
    last: Option<Instant>,
}

impl FrameGate {
    /// How far behind the target a game may fall and still catch up.
    ///
    /// Equivalently: the gate enforces the target rate averaged over any window
    /// longer than this and does not constrain shorter ones. It has to exceed
    /// the longest stall the game takes mid-scene, because credit stops
    /// accruing once the bucket is full, and every millisecond of silence after
    /// that is a frame the game went on to present and this gate refused.
    ///
    /// It was `CAPTURE_SLOTS` — four frames, 67ms — on the reasoning that
    /// banking more bought frames the ring could not hold. That reasoning was
    /// wrong. A burst after a stall arrives serially, as fast as the game
    /// presents it, not all at once, and the ring drains a frame every three
    /// milliseconds; the ring was never the constraint. Measured on the target,
    /// stalls reach 101ms, and against a 67ms bucket a game offering 59 frames
    /// in a second had 52 of them taken.
    const BURST_WINDOW: Duration = Duration::from_millis(250);

    pub fn new(target_fps: u32) -> Self {
        let interval = if target_fps == 0 {
            Duration::ZERO
        } else {
            Duration::from_nanos(1_000_000_000 / u64::from(target_fps))
        };
        let burst = if interval.is_zero() {
            0.0
        } else {
            // Never below one whole frame. The window is a duration, so below
            // four frames a second it works out at less than a single token —
            // and since credit is capped at it, the bucket could then never
            // hold enough to admit anything at all. At `NESCAPTURE_FPS=1` that
            // is a layer that captures nothing, builds no encoder, opens no
            // sockets, and says none of it.
            (Self::BURST_WINDOW.as_secs_f64() / interval.as_secs_f64()).max(1.0)
        };
        Self {
            interval,
            // Nearly empty, not full. One unit admits the first frame, and the
            // second absorbs a frame of jitter before any history exists.
            // Starting full would hand a fast game a quarter second of free
            // frames and make its first reported second read seventy-odd
            // against a gate set to sixty — a burst in the one measurement
            // this is read by.
            credit: 2.0_f64.min(burst),
            burst,
            last: None,
        }
    }

    /// Read the target from the environment. `0` disables the gate.
    pub fn from_env() -> Self {
        let raw = std::env::var("NESCAPTURE_FPS");
        let fps = raw
            .as_deref()
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(60);
        // Said out loud, because every other symptom of getting this wrong is
        // silence. A layer capturing at the wrong rate, or at a rate somebody
        // thought they had overridden and had not, looks exactly like a layer
        // working.
        match raw.as_deref() {
            Ok(value) => log::info!("capture rate: {fps} fps (NESCAPTURE_FPS={value})"),
            Err(_) => log::info!("capture rate: {fps} fps (NESCAPTURE_FPS unset)"),
        }
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

/// Holds the game to the target rate, by delaying its present's *return*.
///
/// [`FrameGate`] decides which frames are captured and never touches the game;
/// this decides how fast the game is allowed to run. They are separate because
/// they answer separate questions, and because a game paced to the target still
/// needs the gate as a backstop: `thread::sleep` lands within a fraction of a
/// millisecond, not exactly, so a frame occasionally arrives early.
///
/// # Why the layer and not the compositor
///
/// A compositor cannot pace a game that has V-Sync off. `IMMEDIATE` and
/// `MAILBOX` swapchains do not wait on `wl_surface.frame` — that callback is
/// FIFO's throttle and nothing else's — so a player turning V-Sync off leaves
/// the compositor with no lever at all. The only one it has left is withholding
/// `wl_buffer.release` to starve the swapchain, which stalls the game inside
/// `vkAcquireNextImageKHR` at a depth the *application* chose when it picked an
/// image count. This process sees every present and owns a monotonic clock,
/// which is the whole of what pacing needs.
///
/// # Why the hold goes after the present, not before it
///
/// Sleeping before calling down delays the frame reaching the screen, which is
/// latency added to a frame that was ready. Sleeping after it means the frame
/// went out the moment it was ready and the application is merely held back
/// from *starting* the next one. Same cadence, no added latency — which is
/// where every other frame limiter puts it.
pub struct FramePacer {
    /// Zero means no limiting — the game runs as fast as it can.
    interval: Duration,
    /// When the next present may return. `None` until the first one does.
    due: Option<Instant>,
}

impl FramePacer {
    pub fn new(target_fps: u32) -> Self {
        Self {
            interval: if target_fps == 0 {
                Duration::ZERO
            } else {
                Duration::from_nanos(1_000_000_000 / u64::from(target_fps))
            },
            due: None,
        }
    }

    /// Read the target from the environment.
    ///
    /// The same `NESCAPTURE_FPS` the gate reads, because a capture rate and a
    /// game rate that disagree is a stream sending frames nobody asked for or
    /// dropping frames somebody paid to render. `NESCAPTURE_LIMIT=0` leaves the
    /// game alone and captures at the rate anyway, which is how the capture
    /// path's cost is measured without the limiter hiding it.
    pub fn from_env() -> Self {
        let limit = std::env::var("NESCAPTURE_LIMIT")
            .map(|v| v != "0")
            .unwrap_or(true);
        if !limit {
            log::info!("game frame limiting off (NESCAPTURE_LIMIT=0)");
            return Self::new(0);
        }
        let fps = std::env::var("NESCAPTURE_FPS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(60);
        Self::new(fps)
    }

    /// How long to hold the application before its present may return.
    ///
    /// Pure, and returns the duration rather than sleeping, so the cadence can
    /// be tested without a clock that really waits. Zero whenever the game is
    /// already at or below the target: a slow game is never made slower.
    pub fn hold(&mut self, now: Instant) -> Duration {
        if self.interval.is_zero() {
            return Duration::ZERO;
        }
        let slot = self.due.unwrap_or(now);
        let wait = slot.saturating_duration_since(now);

        // Advance from the slot, not from `now`, so a game presenting a hair
        // early or late keeps an exact cadence rather than drifting. The clamp
        // is for a real stall: a slot far enough in the past would otherwise
        // let the game run a burst of frames back to back to "catch up", and
        // the frames it would be catching up on were never rendered.
        let next = slot + self.interval;
        self.due = Some(if next <= now {
            now + self.interval
        } else {
            next
        });
        wait
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
        assert!(
            (595..=610).contains(&admitted),
            "admitted {admitted} in 10s"
        );
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
            admitted,
            200,
            "dropped {} frames of a 50 fps game",
            200 - admitted
        );
    }

    /// The stall the target actually exhibits: gaps up to 101ms, in a second
    /// where the game still offers fewer frames than the gate allows. Every one
    /// must survive. At the old 67ms bucket this lost seven frames in sixty —
    /// `present 59/s, admitted 52/s` on the target.
    #[test]
    fn a_hundred_millisecond_stall_costs_no_frames() {
        let mut g = FrameGate::new(60);
        let mut at = Instant::now();
        let mut admitted = 0;
        let mut offered = 0;
        // Ten frames at 11ms, then 100ms of silence: 10 frames per 210ms, about
        // 48 a second, well inside a gate set to 60.
        let step = |i: usize| {
            if i % 11 == 10 {
                Duration::from_millis(100)
            } else {
                Duration::from_millis(11)
            }
        };
        // The bucket starts nearly empty, so the first second of a game faster
        // than the target loses a handful of frames while it fills. That is the
        // deliberate trade for not bursting at startup, and it is not what this
        // is testing — the claim is about steady state, so warm up first.
        for i in 0..100 {
            at += step(i);
            g.admit(at);
        }
        for i in 100..400 {
            at += step(i);
            offered += 1;
            if g.admit(at) {
                admitted += 1;
            }
        }
        assert_eq!(
            admitted,
            offered,
            "dropped {} frames of a stalling sub-target game",
            offered - admitted
        );
    }

    /// The bucket bridges a stall; it does not raise the ceiling. A game that
    /// is genuinely faster than the target over a long run is still thinned to
    /// it, however it distributes its frames.
    #[test]
    fn a_sustained_fast_game_is_still_held_to_the_target() {
        let mut g = FrameGate::new(60);
        let mut at = Instant::now();
        let mut admitted = 0;
        // 120 fps in bursts of eight with a 20ms pause: ~8 frames per 76ms,
        // about 105 a second, sustained for ten seconds.
        for i in 0..1000 {
            at += if i % 9 == 8 {
                Duration::from_millis(20)
            } else {
                Duration::from_millis(8)
            };
            if g.admit(at) {
                admitted += 1;
            }
        }
        let seconds = 9.5;
        let rate = admitted as f64 / seconds;
        assert!(
            rate < 66.0,
            "admitted {admitted} frames, about {rate:.0}/s, from a gate set to 60"
        );
    }

    /// A target low enough that a quarter-second window is less than one
    /// frame. The burst is a duration, so at 1 fps it works out at 0.25 of a
    /// token — and with credit capped at the burst, the bucket could never hold
    /// the whole token an admission costs. The gate admitted nothing, ever.
    ///
    /// What that looked like was not a slow stream. Nothing is captured, so the
    /// encode pipeline is never built, no IPC socket is opened and no stats are
    /// logged: the layer loads, reports a swapchain, and goes quiet.
    #[test]
    fn a_target_below_the_burst_window_still_admits_frames() {
        for fps in [1, 2, 3, 4, 5] {
            let mut g = FrameGate::new(fps);
            let t0 = Instant::now();
            let interval = Duration::from_secs(1) / fps;
            let admitted = (0..20).filter(|i| g.admit(t0 + interval * *i)).count();
            assert!(
                admitted >= 19,
                "at {fps} fps a game presenting at exactly that rate had \
                 {admitted} of 20 frames taken"
            );
        }
    }

    #[test]
    fn a_stall_does_not_bank_an_unbounded_burst() {
        let mut g = FrameGate::new(60);
        let t0 = Instant::now();
        assert!(g.admit(t0));

        // Two seconds of nothing — a load screen, not a hitch.
        let resume = t0 + Duration::from_secs(2);
        assert!(g.admit(resume));

        // The game resuming at 300 fps must not replay the ~120 frames the gate
        // "missed". The bucket is a quarter second deep, so what comes through
        // is that plus what the elapsed time earns — well short of everything
        // on offer.
        let step = Duration::from_nanos(3_333_333);
        let burst = (1..120).filter(|i| g.admit(resume + step * *i)).count();
        assert!(
            burst < 45,
            "admitted {burst} frames in 400ms after a two-second stall"
        );
    }

    /// Credit is bounded however long the stall, so the burst after one does
    /// not grow with it. This is what stops a load screen becoming a replay.
    #[test]
    fn a_longer_stall_does_not_bank_a_deeper_burst() {
        let after = |stall: Duration| {
            let mut g = FrameGate::new(60);
            let t0 = Instant::now();
            g.admit(t0);
            let resume = t0 + stall;
            let step = Duration::from_nanos(3_333_333);
            (0..120).filter(|i| g.admit(resume + step * *i)).count()
        };
        assert_eq!(
            after(Duration::from_secs(2)),
            after(Duration::from_secs(600)),
            "a longer stall banked a deeper burst"
        );
    }
}

#[cfg(test)]
mod pacer_tests {
    use super::*;

    /// Run a game that renders each frame in `render`, for `frames` frames,
    /// obeying whatever hold the pacer asks for. Returns the wall time taken.
    fn run(pacer: &mut FramePacer, frames: u32, render: Duration) -> Duration {
        let start = Instant::now();
        let mut now = start;
        for _ in 0..frames {
            now += render;
            now += pacer.hold(now);
        }
        now.saturating_duration_since(start)
    }

    #[test]
    fn no_target_never_holds() {
        let mut p = FramePacer::new(0);
        let now = Instant::now();
        for i in 0..100 {
            assert_eq!(p.hold(now + Duration::from_micros(i)), Duration::ZERO);
        }
    }

    /// A game that could render at 500 fps is held to 60: sixty frames take
    /// about a second, not a tenth of one.
    #[test]
    fn a_fast_game_is_held_to_the_target() {
        let mut p = FramePacer::new(60);
        let took = run(&mut p, 60, Duration::from_millis(2));
        assert!(
            took >= Duration::from_millis(970) && took <= Duration::from_millis(1030),
            "sixty frames at a 60 fps limit took {took:?}"
        );
    }

    /// A game slower than the target is never delayed. Holding one would be
    /// this layer making a struggling game slower still.
    #[test]
    fn a_slow_game_is_never_held() {
        let mut p = FramePacer::new(120);
        let mut now = Instant::now();
        for i in 0..60 {
            // 40 fps against a 120 fps limit.
            now += Duration::from_millis(25);
            assert_eq!(
                p.hold(now),
                Duration::ZERO,
                "frame {i} of a 40 fps game was held against a 120 fps limit"
            );
        }
    }

    /// After a stall, the frames that were never rendered are not owed back.
    /// Advancing one interval at a time would let the game run flat out until
    /// it had "caught up" on frames that do not exist.
    #[test]
    fn a_stall_is_not_repaid_with_a_burst() {
        let mut p = FramePacer::new(60);
        let t0 = Instant::now();
        p.hold(t0);

        // Two seconds gone — a load screen.
        let resume = t0 + Duration::from_secs(2);
        assert_eq!(
            p.hold(resume),
            Duration::ZERO,
            "the first frame back waited"
        );

        // And the next frame is paced normally rather than let through free.
        let next = resume + Duration::from_millis(2);
        let held = p.hold(next);
        assert!(
            held >= Duration::from_millis(13),
            "the frame after a stall was held only {held:?}"
        );
    }

    /// The rate holds over a long run, which is the property that matters —
    /// per-frame exactness is not something a sleep can promise.
    #[test]
    fn the_rate_holds_over_ten_seconds() {
        let mut p = FramePacer::new(120);
        let took = run(&mut p, 1200, Duration::from_micros(500));
        assert!(
            took >= Duration::from_millis(9_900) && took <= Duration::from_millis(10_100),
            "1200 frames at a 120 fps limit took {took:?}"
        );
    }
}
