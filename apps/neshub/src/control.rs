//! Deciding what the encoder may spend.
//!
//! # Why this exists at all
//!
//! Nothing used to decide. The encoder took a bitrate from an environment
//! variable nobody set, so every session offered the same 10 Mbps whatever the
//! path between the two ends could carry. On a path sustaining under 3 Mbps that
//! does not degrade the picture, it removes it: most fragments are dropped,
//! every frame made of several fragments arrives incomplete, and the keyframe --
//! the largest frame there is -- never completes either, so nothing ever
//! recovers.
//!
//! # Why the receiver decides, and not this end
//!
//! The obvious inputs are here: the hub holds the QUIC connection and can read
//! its round-trip time, its congestion window and its remaining datagram buffer.
//! They were measured, over an entire multi-session run, saying the path was
//! healthy while the client was receiving almost nothing -- 182 ms round trip,
//! *zero* QUIC packet loss, and arrivals falling from 1776 to 239 datagrams a
//! second.
//!
//! Part of that is structural rather than bad luck. `send_datagram` evicts the
//! oldest queued datagrams and returns `Ok`, so a sender that is overrunning the
//! path is told nothing at all; the "frames dropped" counter it feeds cannot be
//! non-zero however badly things are going. So the primary evidence is the
//! receiver's own report of what arrived, and this end's view is the fallback
//! for when no report has come in.
//!
//! # Shape
//!
//! Slow and dull on purpose. This is not a congestion controller in the QUIC
//! sense and does not try to be: it finds the right order of magnitude for a
//! video bitrate and stays there, at one decision a second. The transport
//! underneath is still doing real congestion control on its own packets.

use nesprotocol::{ControlMode, ReceiverReport};

/// Loss above this means the path is being overrun and the target comes down.
const LOSS_DECREASE: f32 = 0.10;
/// Loss below this means there is room to climb.
const LOSS_INCREASE: f32 = 0.02;

/// What to keep of the measured goodput when backing off.
///
/// Backing off to *below* what actually got through, rather than to a fraction
/// of what we were asking for, is what makes recovery quick. At 10 Mbps into a
/// 3 Mbps path the next target is about 2.5 Mbps rather than 8.5, so one step
/// does what twenty multiplicative decreases would.
const BACKOFF: f32 = 0.85;

/// How much of the ceiling to add per calm second. Twenty steps from floor to
/// ceiling: slow enough that a brief quiet spell does not undo a back-off.
const CLIMB_FRACTION: u32 = 20;

/// Don't actuate for less than this fraction of the current target.
///
/// Retuning is cheap now -- it no longer rebuilds the encoder or forces a
/// keyframe -- but a line in the log every second saying the bitrate moved by
/// 1% is noise that hides the changes that matter.
const DEADBAND: f32 = 0.10;

/// Never go below this, whatever the ceiling is.
///
/// Under this a 1080p stream is not worth sending and the right answer is fewer
/// pixels rather than fewer bits, which is a decision about the tier and not one
/// this can make. It also has to leave room for audio, which shares the
/// connection and is not counted against the video ceiling.
const ABSOLUTE_FLOOR_KBPS: u32 = 800;

/// Seconds without a receiver report before this end's own view is used instead.
const SILENT_TICKS_BEFORE_FALLBACK: u32 = 3;

/// Backlog, in milliseconds of video, that means the path is being overrun.
///
/// Not a tuned number: it is a latency budget. At sixty frames a second a frame
/// is under 17 ms, so a quarter second of backlog is fifteen frames already
/// handed over and not yet gone -- a player is looking at a picture from before
/// their last four keypresses. There is no bitrate worth that, so past this the
/// target comes down whatever the loss says.
const QUEUE_DECREASE_MS: u32 = 250;

/// Backlog, in milliseconds, under which the path is considered clear.
///
/// Climbing needs a stronger warrant than holding does, because climbing is
/// what digs the queue. Five frames or so of backlog is the most that can be
/// outstanding and still be called live.
const QUEUE_CLIMB_MS: u32 = 80;

/// The band a target must stay inside.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub ceiling_kbps: u32,
}

impl Limits {
    pub fn new(ceiling_kbps: u32) -> Self {
        Self { ceiling_kbps }
    }

    /// The lowest this may go.
    pub fn floor_kbps(&self) -> u32 {
        ABSOLUTE_FLOOR_KBPS
            .max(self.ceiling_kbps / 10)
            // A ceiling below the floor is a tier nobody should have configured,
            // but clamping the wrong way round would put the target *above* the
            // ceiling, which is the one thing a ceiling must never allow.
            .min(self.ceiling_kbps)
    }

    fn clamp(&self, kbps: u32) -> u32 {
        kbps.clamp(self.floor_kbps(), self.ceiling_kbps)
    }
}

/// What this end can see about the path, for when the far end is not talking.
///
/// Every field is optional because every one of them can be unavailable: a
/// connection with no established path has no round-trip time, and a congestion
/// window is only meaningful once something has been sent.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PathView {
    /// Congestion window in bytes, as the transport currently believes it.
    pub cwnd_bytes: Option<u64>,
    /// Round-trip time in milliseconds.
    pub rtt_ms: Option<u32>,
    /// Datagram bytes handed to the transport that have not yet left.
    ///
    /// The backlog is the one thing this end can see that says the path is
    /// being overrun *while it is still only late*. Loss says so too, but only
    /// afterwards, and on a path that queues rather than drops, "afterwards"
    /// can be several seconds.
    pub backlog_bytes: Option<u64>,
}

impl PathView {
    /// How long the backlog takes to drain at `drain_kbps`, in milliseconds.
    ///
    /// Bits divided by kilobits-per-second is milliseconds. The rate to divide
    /// by is the one the queue actually drains at -- what is getting through --
    /// and not what we are asking for, which is the number that is too high
    /// whenever this matters.
    pub fn backlog_ms(&self, drain_kbps: u32) -> Option<u32> {
        let backlog = self.backlog_bytes?;
        let drain = u64::from(drain_kbps.max(1));
        Some((backlog.saturating_mul(8) / drain).min(u64::from(u32::MAX)) as u32)
    }

    /// Delivery rate the window and round trip imply, in kbps.
    ///
    /// A window is a quantity of bytes in flight for one round trip, so the two
    /// together are a rate. Treated as an estimate of last resort: it describes
    /// the transport's own opinion of the path, and that opinion is exactly what
    /// was observed to be wrong when this mattered most.
    pub fn estimate_kbps(&self) -> Option<u32> {
        let (cwnd, rtt) = (self.cwnd_bytes?, self.rtt_ms?.max(1));
        let bits_per_second = cwnd.saturating_mul(8) * 1000 / u64::from(rtt);
        Some((bits_per_second / 1000).min(u64::from(u32::MAX)) as u32)
    }
}

/// Why the target is what it is, for the overlay and the log.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Reason {
    /// Loss was high; backed off to under what was actually getting through.
    Congested,
    /// Loss was in the middle band; left alone.
    Holding,
    /// Loss was low; climbing towards the ceiling.
    Climbing,
    /// No receiver report recently; using this end's view of the path.
    Fallback,
    /// No report and no usable view either; decaying towards the floor.
    Blind,
    /// Somebody set the bitrate by hand.
    Manual,
    /// The encoder is not under a bitrate at all, so there is nothing to decide.
    ConstantQuality,
    /// Nobody is connected, so there is no path to have an opinion about.
    NoClients,
    /// This second's numbers describe frames the hub chose not to send, so they
    /// say nothing about the path.
    SelfInflicted,
    /// Nothing was lost, but the send queue is standing deep enough that the
    /// picture is arriving late. Backed off on the queue rather than on loss.
    Backlogged,
}

/// The controller's whole state.
#[derive(Debug, Clone, Copy)]
pub struct Controller {
    /// The ceiling the box was given, which a client may lower but never raise.
    ///
    /// Kept apart from `limits`, which holds whatever is in force *now*. Folding
    /// the two together means a client that lowers the ceiling can never raise
    /// it again, because the only number left to compare against is the one it
    /// just lowered.
    box_ceiling_kbps: u32,
    /// What the controller currently believes the bitrate should be.
    ///
    /// Kept apart from `sent_kbps` deliberately. Folding the two together looks
    /// simpler and stalls the climb: the step up is a fraction of the *ceiling*,
    /// so once the target passes half of it each step is under the deadband, and
    /// a target that only moved when it actuated could never accumulate past
    /// that point. Belief moves every second; only saying so is rationed.
    target_kbps: u32,
    /// What the encoder was last told, or `None` before anything was sent.
    sent_kbps: Option<u32>,
    limits: Limits,
    mode: ControlMode,
    /// Set when the encoder is in constant-QP; there is no bitrate to control.
    constant_quality: bool,
    silent_ticks: u32,
    reason: Reason,
    /// Last measured send-queue depth, kept for reporting rather than control.
    backlog_ms: u32,
}

impl Controller {
    /// Start at the ceiling.
    ///
    /// Optimistic on purpose: the common case is a path that can carry the tier
    /// that was sold, and a session that opened at its floor and climbed would
    /// take twenty seconds to look like what was paid for. The first bad report
    /// undoes it in one step.
    pub fn new(limits: Limits) -> Self {
        Self {
            box_ceiling_kbps: limits.ceiling_kbps,
            target_kbps: limits.ceiling_kbps,
            sent_kbps: None,
            limits,
            mode: ControlMode::Auto,
            constant_quality: false,
            silent_ticks: 0,
            reason: Reason::Holding,
            backlog_ms: 0,
        }
    }

    pub fn target_kbps(&self) -> u32 {
        self.target_kbps
    }
    pub fn limits(&self) -> Limits {
        self.limits
    }
    pub fn mode(&self) -> ControlMode {
        self.mode
    }
    pub fn reason(&self) -> Reason {
        self.reason
    }

    /// How far behind the send queue was at the last decision, in milliseconds.
    pub fn backlog_ms(&self) -> u32 {
        self.backlog_ms
    }

    /// The ceiling the box was given, whatever a client has since asked for.
    pub fn box_ceiling_kbps(&self) -> u32 {
        self.box_ceiling_kbps
    }

    /// Adopt a ceiling a client asked for, never above the one the box was given.
    ///
    /// A client may lower its own ceiling -- to test a path, or because it knows
    /// something about its link that this end does not -- but it may not raise
    /// the one the tier bought.
    pub fn set_ceiling(&mut self, ceiling_kbps: u32) {
        self.limits = Limits::new(ceiling_kbps.min(self.box_ceiling_kbps).max(1));
        self.target_kbps = self.limits.clamp(self.target_kbps);
        // A ceiling that moved is worth restating even when the target did not,
        // because the encoder is the thing that has to hear about it.
        self.sent_kbps = None;
    }

    pub fn set_mode(&mut self, mode: ControlMode) {
        self.mode = mode;
        if mode == ControlMode::Manual {
            self.reason = Reason::Manual;
        }
    }

    /// Note that somebody set the bitrate by hand.
    pub fn note_manual_target(&mut self, kbps: u32) {
        self.target_kbps = kbps;
        self.sent_kbps = Some(kbps);
        self.mode = ControlMode::Manual;
        self.reason = Reason::Manual;
    }

    /// Note that the encoder is, or is no longer, under constant quality.
    pub fn set_constant_quality(&mut self, constant_quality: bool) {
        self.constant_quality = constant_quality;
    }

    /// One second's decision.
    ///
    /// `report` is the worst report across the clients attached, or `None` when
    /// none of them said anything. Returns the new target when it is worth
    /// sending, and `None` when nothing should be sent -- which is most seconds.
    /// One second's decision.
    ///
    /// `self_inflicted` says this second contained frames the hub deliberately
    /// withheld -- a client resynchronising, whose deltas were undecodable and
    /// were dropped rather than sent. Those seconds cannot be read as evidence
    /// about the path: fewer frames were sent, so fewer arrived, so the measured
    /// goodput is low and the loss is high, and a controller anchoring a backoff
    /// on that would cut the bitrate in response to its own decision. Every
    /// stutter would then also cost bandwidth, which is the opposite of what a
    /// resynchronisation needs.
    pub fn tick(
        &mut self,
        clients: usize,
        report: Option<ReceiverReport>,
        path: PathView,
        self_inflicted: bool,
    ) -> Option<u32> {
        if clients == 0 {
            // Nothing is connected, so nothing is being carried and there is no
            // path to form an opinion about. Deciding here means deciding on the
            // absence of evidence: the controller used to read it as silence and
            // decay to the floor, so a box waiting for its first client spent
            // that time winding itself down and then jumped back up the moment
            // somebody arrived.
            self.reason = Reason::NoClients;
            self.silent_ticks = 0;
            return None;
        }
        if self.constant_quality {
            self.reason = Reason::ConstantQuality;
            return None;
        }
        if self.mode == ControlMode::Manual {
            self.reason = Reason::Manual;
            return None;
        }
        if self_inflicted {
            // Held, not decayed. The path may be fine; this second simply
            // cannot say, and silence about the path is not evidence against it.
            self.reason = Reason::SelfInflicted;
            self.silent_ticks = 0;
            return None;
        }

        // What the queue drains at is what is getting through. With no report
        // to say, the target is the best guess available -- and a target that
        // is too high only makes the backlog look shorter than it is, so this
        // errs towards patience rather than towards cutting the rate.
        let drain_kbps = match report.as_ref().map(|r| (r.goodput_bps / 1000) as u32) {
            Some(measured) if measured > 0 => measured,
            _ => self.target_kbps,
        };
        self.backlog_ms = path.backlog_ms(drain_kbps).unwrap_or(0);

        let next = match report.as_ref().and_then(|r| r.loss().map(|l| (r, l))) {
            Some((report, loss)) => {
                self.silent_ticks = 0;
                self.decide_from_report(report, loss, path)
            }
            None => {
                self.silent_ticks = self.silent_ticks.saturating_add(1);
                if self.silent_ticks < SILENT_TICKS_BEFORE_FALLBACK {
                    self.reason = Reason::Holding;
                    return None;
                }
                self.decide_from_path(path)
            }
        };

        self.target_kbps = self.limits.clamp(next);
        // Every second moves the belief; only a change worth acting on is said.
        // The first decision is always said -- the encoder started at whatever
        // its environment gave it, and this end has no way to know it matches.
        match self.sent_kbps {
            Some(sent) if !worth_sending(sent, self.target_kbps, self.limits) => None,
            _ => {
                self.sent_kbps = Some(self.target_kbps);
                Some(self.target_kbps)
            }
        }
    }

    fn decide_from_report(&mut self, report: &ReceiverReport, loss: f32, path: PathView) -> u32 {
        let measured = (report.goodput_bps / 1000) as u32;
        // `backlog_ms` is zero both when the queue is empty and when the
        // transport cannot say, which are the same thing for this purpose: a
        // queue nobody can see is not evidence of one.
        let known = path.backlog_bytes.is_some();
        let queued = known && self.backlog_ms > QUEUE_DECREASE_MS;

        if loss > LOSS_DECREASE || queued {
            self.reason = if queued {
                Reason::Backlogged
            } else {
                Reason::Congested
            };
            // Anchored on what actually arrived, not on what we were asking for.
            // `goodput` of zero means nothing completed at all, in which case
            // there is no measurement to anchor to and the target is simply
            // halved -- the alternative, backing off to zero, would take the
            // stream below the floor on a single bad second.
            let anchor = if measured == 0 {
                self.target_kbps / 2
            } else {
                measured.min(self.target_kbps)
            };
            return (anchor as f32 * BACKOFF) as u32;
        }
        // Climbing is what digs the queue, so it needs the queue to be empty as
        // well as the loss to be low. Without this the controller climbs all
        // the way to the ceiling against a path it is already overrunning,
        // because a path that queues instead of dropping reports no loss at all
        // until the buffer finally overflows -- and by then the picture is
        // seconds behind.
        if loss < LOSS_INCREASE && (!known || self.backlog_ms < QUEUE_CLIMB_MS) {
            self.reason = Reason::Climbing;
            return self
                .target_kbps
                .saturating_add(self.limits.ceiling_kbps / CLIMB_FRACTION);
        }
        self.reason = Reason::Holding;
        self.target_kbps
    }

    fn decide_from_path(&mut self, path: PathView) -> u32 {
        match path.estimate_kbps() {
            Some(estimate) => {
                self.reason = Reason::Fallback;
                estimate
            }
            None => {
                // Nothing said and nothing visible. Holding a high target on no
                // evidence is how the original failure sustained itself, so this
                // decays rather than holds.
                self.reason = Reason::Blind;
                (self.target_kbps as f32 * BACKOFF) as u32
            }
        }
    }
}

/// Whether a change is big enough to be worth actuating.
///
/// Reaching either end of the band always is: a target pinned to the floor or
/// the ceiling is a fact worth stating even when the step to it was small.
pub fn worth_sending(current: u32, next: u32, limits: Limits) -> bool {
    if current == next {
        return false;
    }
    if next == limits.floor_kbps() || next == limits.ceiling_kbps {
        return true;
    }
    let change = current.abs_diff(next) as f32;
    change >= current as f32 * DEADBAND
}

#[cfg(test)]
mod tests {
    use super::*;

    const CEILING: u32 = 10_000;

    fn limits() -> Limits {
        Limits::new(CEILING)
    }

    fn controller() -> Controller {
        Controller::new(limits())
    }

    /// A second in which `released` of `total` frames made it, carrying
    /// `goodput_kbps` of completed video.
    fn report(released: u32, incomplete: u32, goodput_kbps: u64) -> ReceiverReport {
        ReceiverReport {
            goodput_bps: goodput_kbps * 1000,
            released,
            incomplete,
            never_arrived: 0,
            rtt_ms: 180,
        }
    }

    fn healthy() -> ReceiverReport {
        report(60, 0, 9_800)
    }

    /// A path with `backlog` bytes handed over and not yet gone.
    fn backlogged(backlog: u64) -> PathView {
        PathView {
            cwnd_bytes: Some(13_000),
            rtt_ms: Some(180),
            backlog_bytes: Some(backlog),
        }
    }

    /// The second reported failure, as measured over a 1000-mile link.
    ///
    /// Every frame arrived and every frame completed -- zero loss, zero QUIC
    /// congestion events, a flat 180 ms round trip for the whole session -- and
    /// the picture was still several seconds behind, because the offer was
    /// several times what the path carried and the difference was sitting in
    /// the hub's own send buffer. A controller reading loss alone sees a
    /// perfect path here and climbs to the ceiling against it.
    #[test]
    fn a_path_that_queues_instead_of_dropping_must_not_read_as_healthy() {
        let mut c = controller();
        // Two megabits get through; a megabyte is already queued behind them.
        let arriving = report(60, 0, 2_000);
        let path = backlogged(1024 * 1024);

        for _ in 0..30 {
            c.tick(1, Some(arriving), path, false);
        }

        assert_ne!(
            c.reason(),
            Reason::Climbing,
            "climbing against a path with four seconds of backlog"
        );
        assert!(
            c.target_kbps() < 2_000,
            "target {} kbps is at or above what is getting through, so the \
             queue can only grow",
            c.target_kbps()
        );
    }

    /// The sawtooth: floor, climb to ceiling, collapse, repeat every 20 s.
    ///
    /// Loss alone cannot break this cycle, because on a queueing path loss only
    /// appears once the buffer finally overflows -- long after the latency has
    /// made the session unplayable, and by then the queue is deep enough that
    /// backing off to the floor is the only way out.
    #[test]
    fn the_target_settles_instead_of_sawtoothing() {
        let mut c = controller();
        // A steady 2 Mbps path. The backlog is what the last second of
        // over-sending left behind, drained at what actually gets through.
        let mut backlog: i64 = 0;
        let mut seen = Vec::new();

        for _ in 0..60 {
            let target = c.target_kbps();
            // Whatever was asked for above 2 Mbps piles up; the rest drains.
            backlog = (backlog + (i64::from(target) - 2_000) * 1000 / 8).clamp(0, 4 * 1024 * 1024);
            c.tick(
                1,
                Some(report(60, 0, 2_000)),
                backlogged(backlog as u64),
                false,
            );
            seen.push(c.target_kbps());
        }

        let settled = &seen[30..];
        let (lo, hi) = (
            *settled.iter().min().unwrap(),
            *settled.iter().max().unwrap(),
        );
        assert!(
            hi - lo <= 1_000,
            "target still swinging between {lo} and {hi} kbps after 30 seconds"
        );
        assert!(
            hi <= 2_400,
            "settled at {hi} kbps against a path carrying 2000"
        );
    }

    /// The reported depth is what the next session will be judged on, so it
    /// has to be right: bytes over the rate they leave at, in milliseconds.
    #[test]
    fn the_queue_depth_is_reported_as_measured() {
        let mut c = controller();
        // 250 kB queued behind a 2 Mbps drain is exactly one second.
        c.tick(1, Some(report(60, 0, 2_000)), backlogged(250_000), false);
        assert_eq!(c.backlog_ms(), 1_000);

        // A transport that cannot say must report no queue, not a wrong one.
        c.tick(1, Some(report(60, 0, 2_000)), PathView::default(), false);
        assert_eq!(c.backlog_ms(), 0);
    }

    /// The backlog must not become a reason never to climb again.
    #[test]
    fn a_clear_queue_still_climbs() {
        let mut c = controller();
        c.set_ceiling(4_000);
        let clear = backlogged(0);
        for _ in 0..5 {
            c.tick(1, Some(report(60, 0, 3_900)), clear, false);
        }
        assert_eq!(c.reason(), Reason::Climbing);
    }

    /// The reported failure, as measured: a 10 Mbps offer into a path carrying
    /// under three, where *no* frame completed for minutes.
    #[test]
    fn the_reported_failure_is_corrected_in_seconds() {
        let mut c = controller();
        assert_eq!(c.target_kbps(), CEILING);

        let mut ticks = 0;
        while c.target_kbps() > 2_800 && ticks < 10 {
            // 46 frames a second starting to arrive, none of them completing.
            c.tick(1, Some(report(0, 46, 0)), PathView::default(), false);
            ticks += 1;
        }
        assert!(
            c.target_kbps() <= 2_800,
            "still at {} kbps after {ticks} seconds",
            c.target_kbps(),
        );
        assert!(
            ticks <= 5,
            "took {ticks} seconds to stop overrunning the path"
        );
    }

    /// With a goodput measurement to anchor on it should take one step, not
    /// several -- that is the whole reason for backing off to what arrived
    /// rather than to a fraction of what was asked for.
    #[test]
    fn a_measured_goodput_is_corrected_in_one_step() {
        let mut c = controller();
        let sent = c.tick(1, Some(report(12, 48, 2_850)), PathView::default(), false);
        assert_eq!(sent, Some(c.target_kbps()));
        assert!(
            c.target_kbps() < 2_850,
            "backed off to {} kbps, which is above what actually arrived",
            c.target_kbps(),
        );
    }

    /// The negative that matters most: a path that is fine must be left alone.
    #[test]
    fn a_healthy_path_is_not_wandered_away_from() {
        let mut c = controller();
        // The first decision is always stated. The encoder started at whatever
        // its environment gave it and this end cannot know that matches, so the
        // target is asserted once rather than assumed.
        assert_eq!(
            c.tick(1, Some(healthy()), PathView::default(), false),
            Some(CEILING)
        );
        for _ in 0..60 {
            assert_eq!(
                c.tick(1, Some(healthy()), PathView::default(), false),
                None,
                "a healthy path produced a bitrate change",
            );
        }
        assert_eq!(c.target_kbps(), CEILING);
    }

    #[test]
    fn the_first_decision_is_always_stated() {
        // Otherwise a session whose path happens to match its ceiling never
        // tells the encoder anything, and the encoder keeps whatever its
        // environment gave it -- which is the failure this replaces.
        let mut c = controller();
        assert_eq!(
            c.tick(1, Some(healthy()), PathView::default(), false),
            Some(CEILING),
            "the opening target was never stated",
        );
        // And not repeated, now that the encoder has been told.
        assert_eq!(c.tick(1, Some(healthy()), PathView::default(), false), None);
    }

    #[test]
    fn a_small_change_is_not_worth_saying() {
        // Below the deadband nothing is sent, so the log and the encoder are not
        // touched sixty times a minute for changes nobody could see.
        let l = limits();
        assert!(!worth_sending(5_000, 5_200, l));
        assert!(worth_sending(5_000, 5_600, l));
    }

    #[test]
    fn reaching_either_end_of_the_band_is_always_worth_saying() {
        let l = limits();
        assert!(worth_sending(l.floor_kbps() + 1, l.floor_kbps(), l));
        assert!(worth_sending(CEILING - 1, CEILING, l));
    }

    #[test]
    fn the_ceiling_is_never_exceeded() {
        let mut c = controller();
        for _ in 0..200 {
            c.tick(1, Some(healthy()), PathView::default(), false);
            assert!(c.target_kbps() <= CEILING, "{} kbps", c.target_kbps());
        }
    }

    #[test]
    fn the_floor_is_never_gone_below() {
        let mut c = controller();
        for _ in 0..200 {
            c.tick(1, Some(report(0, 60, 0)), PathView::default(), false);
            assert!(
                c.target_kbps() >= c.limits().floor_kbps(),
                "{} kbps is below the floor",
                c.target_kbps(),
            );
        }
    }

    #[test]
    fn it_climbs_back_after_a_bad_patch() {
        let mut c = controller();
        for _ in 0..5 {
            c.tick(1, Some(report(0, 46, 0)), PathView::default(), false);
        }
        let bottom = c.target_kbps();
        for _ in 0..40 {
            c.tick(1, Some(healthy()), PathView::default(), false);
        }
        assert!(
            c.target_kbps() > bottom,
            "never recovered from {bottom} kbps"
        );
        assert_eq!(c.target_kbps(), CEILING, "did not climb all the way back");
    }

    #[test]
    fn a_second_the_hub_starved_is_not_read_as_a_bad_path() {
        // While a client resynchronises its deltas are withheld, so fewer frames
        // are sent, fewer arrive, goodput reads low and loss reads high. Backing
        // off on that would cut the bitrate in response to the hub's own
        // decision -- and make every stutter cost bandwidth as well.
        let mut c = controller();
        assert_eq!(
            c.tick(1, Some(healthy()), PathView::default(), false),
            Some(CEILING)
        );

        let starved = report(0, 46, 0);
        for _ in 0..10 {
            assert_eq!(c.tick(1, Some(starved), PathView::default(), true), None);
        }
        assert_eq!(c.target_kbps(), CEILING, "the hub cut its own bitrate");
        assert_eq!(c.reason(), Reason::SelfInflicted);
    }

    #[test]
    fn a_genuinely_bad_second_still_acts_once_the_hub_stops_starving_it() {
        // The flag holds, it does not blind. The moment a second is the path's
        // own, the same evidence is acted on.
        let mut c = controller();
        c.tick(1, Some(healthy()), PathView::default(), false);
        c.tick(1, Some(report(0, 46, 0)), PathView::default(), true);
        assert_eq!(c.target_kbps(), CEILING);

        c.tick(1, Some(report(12, 48, 2_850)), PathView::default(), false);
        assert!(c.target_kbps() < 2_850, "a real bad second was ignored too");
    }

    #[test]
    fn a_starved_second_does_not_count_towards_silence() {
        // It is not a missing report -- one arrived, it just cannot be read.
        // Counting it as silence would slide towards the path-based fallback and
        // then to decaying blind, which is a different wrong answer.
        let mut c = controller();
        c.tick(1, Some(healthy()), PathView::default(), false);
        for _ in 0..10 {
            c.tick(1, Some(report(0, 60, 0)), PathView::default(), true);
        }
        assert_eq!(c.reason(), Reason::SelfInflicted);
        assert_eq!(c.target_kbps(), CEILING);
    }

    #[test]
    fn a_hand_set_bitrate_stands_the_controller_down() {
        // How this class of bug gets diagnosed. A controller that overrode a
        // person's setting a second later would take the tool away.
        let mut c = controller();
        c.note_manual_target(1_000);
        for _ in 0..30 {
            assert_eq!(
                c.tick(1, Some(report(0, 60, 0)), PathView::default(), false),
                None
            );
        }
        assert_eq!(c.target_kbps(), 1_000);
        assert_eq!(c.reason(), Reason::Manual);
    }

    #[test]
    fn constant_quality_has_no_bitrate_to_decide() {
        let mut c = controller();
        c.set_constant_quality(true);
        assert_eq!(
            c.tick(1, Some(report(0, 60, 0)), PathView::default(), false),
            None
        );
        assert_eq!(c.reason(), Reason::ConstantQuality);
    }

    #[test]
    fn silence_is_tolerated_briefly_and_then_acted_on() {
        let mut c = controller();
        // A missed report or two says nothing; the path was fine a second ago.
        for _ in 0..(SILENT_TICKS_BEFORE_FALLBACK - 1) {
            assert_eq!(c.tick(1, None, PathView::default(), false), None);
            assert_eq!(c.target_kbps(), CEILING);
        }
        // Past that, with nothing visible from this end either, it decays rather
        // than holding a high target on no evidence at all -- holding is how the
        // original failure sustained itself.
        c.tick(1, None, PathView::default(), false);
        assert_eq!(c.reason(), Reason::Blind);
        assert!(c.target_kbps() < CEILING);
    }

    #[test]
    fn this_ends_view_is_used_only_when_the_far_end_is_silent() {
        let mut c = controller();
        let path = PathView {
            cwnd_bytes: Some(120_000),
            rtt_ms: Some(200),
            backlog_bytes: None,
        };
        // A report present means the path view is ignored, however tempting.
        c.tick(1, Some(healthy()), path, false);
        assert_eq!(c.reason(), Reason::Climbing);

        for _ in 0..SILENT_TICKS_BEFORE_FALLBACK {
            c.tick(1, None, path, false);
        }
        assert_eq!(c.reason(), Reason::Fallback);
        // 120 KB in flight per 200 ms is 4.8 Mbps.
        assert_eq!(c.target_kbps(), 4_800);
    }

    #[test]
    fn nothing_is_decided_while_nobody_is_connected() {
        // A box waiting for its first client used to read the silence as a dead
        // path and wind itself down to the floor, then jump back up the moment
        // somebody arrived. There is no path to have an opinion about yet.
        let mut c = controller();
        for _ in 0..30 {
            assert_eq!(c.tick(0, None, PathView::default(), false), None);
        }
        assert_eq!(c.target_kbps(), CEILING);
        assert_eq!(c.reason(), Reason::NoClients);
    }

    #[test]
    fn a_lowered_ceiling_can_be_raised_again() {
        // The trap in folding the box's ceiling together with the one in force:
        // after lowering, the only number left to compare against is the lowered
        // one, so the client can never get back up.
        let mut c = controller();
        c.set_ceiling(2_000);
        assert_eq!(c.limits().ceiling_kbps, 2_000);
        c.set_ceiling(5_000);
        assert_eq!(c.limits().ceiling_kbps, 5_000);
        assert_eq!(c.box_ceiling_kbps(), CEILING);
    }

    #[test]
    fn a_ceiling_change_is_restated_to_the_encoder() {
        // The encoder is the thing that has to act on it, and a target that
        // happens to land on the same number is still a different instruction
        // when the band around it moved.
        let mut c = controller();
        assert!(
            c.tick(1, Some(healthy()), PathView::default(), false)
                .is_some()
        );
        c.set_ceiling(3_000);
        assert_eq!(
            c.tick(1, Some(healthy()), PathView::default(), false),
            Some(3_000)
        );
    }

    #[test]
    fn a_client_may_lower_its_ceiling_but_not_raise_it() {
        let mut c = controller();
        c.set_ceiling(4_000);
        assert_eq!(c.limits().ceiling_kbps, 4_000);
        assert!(c.target_kbps() <= 4_000, "the target outlived its ceiling");

        c.set_ceiling(50_000);
        assert_eq!(
            c.limits().ceiling_kbps,
            CEILING,
            "a client raised the ceiling the tier bought",
        );
    }

    #[test]
    fn a_ceiling_under_the_floor_does_not_invert_the_band() {
        // A misconfigured tier must not produce a floor above its own ceiling,
        // which would put every target above the limit it exists to enforce.
        let l = Limits::new(500);
        assert!(l.floor_kbps() <= l.ceiling_kbps);
        assert_eq!(l.clamp(10_000), 500);
    }

    #[test]
    fn a_silent_second_is_not_read_as_a_healthy_one() {
        // No frames at all accounted for: nothing sent, or nothing arrived.
        // Reading it as no loss would climb straight into a path that may be
        // carrying nothing.
        let mut c = controller();
        let empty = ReceiverReport::default();
        assert_eq!(empty.loss(), None);
        c.tick(1, Some(empty), PathView::default(), false);
        assert_eq!(c.target_kbps(), CEILING, "climbed on an empty report");
    }
}
