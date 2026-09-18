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
}

impl PathView {
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
}

/// The controller's whole state.
#[derive(Debug, Clone, Copy)]
pub struct Controller {
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
            target_kbps: limits.ceiling_kbps,
            sent_kbps: None,
            limits,
            mode: ControlMode::Auto,
            constant_quality: false,
            silent_ticks: 0,
            reason: Reason::Holding,
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

    /// Adopt a ceiling a client asked for, never above the one the box was given.
    ///
    /// A client may lower its own ceiling -- to test a path, or because it knows
    /// something about its link that this end does not -- but it may not raise
    /// the one the tier bought.
    pub fn set_ceiling(&mut self, ceiling_kbps: u32, box_ceiling_kbps: u32) {
        self.limits = Limits::new(ceiling_kbps.min(box_ceiling_kbps).max(1));
        self.target_kbps = self.limits.clamp(self.target_kbps);
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
    pub fn tick(&mut self, report: Option<ReceiverReport>, path: PathView) -> Option<u32> {
        if self.constant_quality {
            self.reason = Reason::ConstantQuality;
            return None;
        }
        if self.mode == ControlMode::Manual {
            self.reason = Reason::Manual;
            return None;
        }

        let next = match report.as_ref().and_then(|r| r.loss().map(|l| (r, l))) {
            Some((report, loss)) => {
                self.silent_ticks = 0;
                self.decide_from_report(report, loss)
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

    fn decide_from_report(&mut self, report: &ReceiverReport, loss: f32) -> u32 {
        if loss > LOSS_DECREASE {
            self.reason = Reason::Congested;
            // Anchored on what actually arrived, not on what we were asking for.
            // `goodput` of zero means nothing completed at all, in which case
            // there is no measurement to anchor to and the target is simply
            // halved -- the alternative, backing off to zero, would take the
            // stream below the floor on a single bad second.
            let measured = (report.goodput_bps / 1000) as u32;
            let anchor = if measured == 0 {
                self.target_kbps / 2
            } else {
                measured.min(self.target_kbps)
            };
            return (anchor as f32 * BACKOFF) as u32;
        }
        if loss < LOSS_INCREASE {
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

    /// The reported failure, as measured: a 10 Mbps offer into a path carrying
    /// under three, where *no* frame completed for minutes.
    #[test]
    fn the_reported_failure_is_corrected_in_seconds() {
        let mut c = controller();
        assert_eq!(c.target_kbps(), CEILING);

        let mut ticks = 0;
        while c.target_kbps() > 2_800 && ticks < 10 {
            // 46 frames a second starting to arrive, none of them completing.
            c.tick(Some(report(0, 46, 0)), PathView::default());
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
        let sent = c.tick(Some(report(12, 48, 2_850)), PathView::default());
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
        assert_eq!(c.tick(Some(healthy()), PathView::default()), Some(CEILING));
        for _ in 0..60 {
            assert_eq!(
                c.tick(Some(healthy()), PathView::default()),
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
            c.tick(Some(healthy()), PathView::default()),
            Some(CEILING),
            "the opening target was never stated",
        );
        // And not repeated, now that the encoder has been told.
        assert_eq!(c.tick(Some(healthy()), PathView::default()), None);
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
            c.tick(Some(healthy()), PathView::default());
            assert!(c.target_kbps() <= CEILING, "{} kbps", c.target_kbps());
        }
    }

    #[test]
    fn the_floor_is_never_gone_below() {
        let mut c = controller();
        for _ in 0..200 {
            c.tick(Some(report(0, 60, 0)), PathView::default());
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
            c.tick(Some(report(0, 46, 0)), PathView::default());
        }
        let bottom = c.target_kbps();
        for _ in 0..40 {
            c.tick(Some(healthy()), PathView::default());
        }
        assert!(
            c.target_kbps() > bottom,
            "never recovered from {bottom} kbps"
        );
        assert_eq!(c.target_kbps(), CEILING, "did not climb all the way back");
    }

    #[test]
    fn a_hand_set_bitrate_stands_the_controller_down() {
        // How this class of bug gets diagnosed. A controller that overrode a
        // person's setting a second later would take the tool away.
        let mut c = controller();
        c.note_manual_target(1_000);
        for _ in 0..30 {
            assert_eq!(c.tick(Some(report(0, 60, 0)), PathView::default()), None);
        }
        assert_eq!(c.target_kbps(), 1_000);
        assert_eq!(c.reason(), Reason::Manual);
    }

    #[test]
    fn constant_quality_has_no_bitrate_to_decide() {
        let mut c = controller();
        c.set_constant_quality(true);
        assert_eq!(c.tick(Some(report(0, 60, 0)), PathView::default()), None);
        assert_eq!(c.reason(), Reason::ConstantQuality);
    }

    #[test]
    fn silence_is_tolerated_briefly_and_then_acted_on() {
        let mut c = controller();
        // A missed report or two says nothing; the path was fine a second ago.
        for _ in 0..(SILENT_TICKS_BEFORE_FALLBACK - 1) {
            assert_eq!(c.tick(None, PathView::default()), None);
            assert_eq!(c.target_kbps(), CEILING);
        }
        // Past that, with nothing visible from this end either, it decays rather
        // than holding a high target on no evidence at all -- holding is how the
        // original failure sustained itself.
        c.tick(None, PathView::default());
        assert_eq!(c.reason(), Reason::Blind);
        assert!(c.target_kbps() < CEILING);
    }

    #[test]
    fn this_ends_view_is_used_only_when_the_far_end_is_silent() {
        let mut c = controller();
        let path = PathView {
            cwnd_bytes: Some(120_000),
            rtt_ms: Some(200),
        };
        // A report present means the path view is ignored, however tempting.
        c.tick(Some(healthy()), path);
        assert_eq!(c.reason(), Reason::Climbing);

        for _ in 0..SILENT_TICKS_BEFORE_FALLBACK {
            c.tick(None, path);
        }
        assert_eq!(c.reason(), Reason::Fallback);
        // 120 KB in flight per 200 ms is 4.8 Mbps.
        assert_eq!(c.target_kbps(), 4_800);
    }

    #[test]
    fn a_client_may_lower_its_ceiling_but_not_raise_it() {
        let mut c = controller();
        c.set_ceiling(4_000, CEILING);
        assert_eq!(c.limits().ceiling_kbps, 4_000);
        assert!(c.target_kbps() <= 4_000, "the target outlived its ceiling");

        c.set_ceiling(50_000, CEILING);
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
        c.tick(Some(empty), PathView::default());
        assert_eq!(c.target_kbps(), CEILING, "climbed on an empty report");
    }
}
