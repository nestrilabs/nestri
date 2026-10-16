//! Deciding what the encoder may spend.
//!
//! # Why this exists at all
//!
//! Nothing used to decide. The encoder took a bitrate from an environment
//! variable nobody set, so every session offered the same 10 Mbps whatever the
//! path between the two ends could carry. On a path sustaining under 3 Mbps that
//! does not degrade the picture, it removes it.
//!
//! # From the path, frame by frame
//!
//! Each client's path is modelled from its per-frame feedback (`rate.rs`): the
//! capacity its frames measure, whether the bottleneck is still busy with one
//! frame when the next arrives, and the share it delivers when it is. Down at
//! once when the queue grows, to that measured share; up only to a rate the path
//! has proven, held on the path's own recurrence. See nescore's
//! `docs/superpowers/specs/2026-10-16-video-rate-from-the-path-design.md`.
//!
//! This replaced a controller built from thresholds: loss above 10% to back
//! off, below 2% to climb, back off to 0.85 of goodput, climb a twentieth of the
//! ceiling a second, a 10% deadband, queue limits of 250 and 80 ms. It could
//! only find the path's limit by hitting it, so it sawtoothed, and it heard about
//! the queue it built once a second, after the queue was tens of milliseconds
//! deep.
//!
//! # One encoder, the slowest client
//!
//! One encoder serves every client, so it can answer only one question: the
//! rate the slowest path allows. Averaging would leave that client never
//! recovering while the numbers look acceptable.

use std::collections::HashMap;

use iroh::EndpointId;
use nesprotocol::ControlMode;
use nesprotocol::datagram::FrameFeedback;

use crate::rate::{self, PathModel};

/// Never go below this, whatever the ceiling is.
///
/// A policy bound like the ceiling, not a guess about the network: under this a
/// 1080p stream is not worth sending, and the right answer is fewer pixels
/// rather than fewer bits, which is a decision about the tier and not one this
/// can make.
const ABSOLUTE_FLOOR_KBPS: u32 = 800;

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

/// What this end can see about a client's connection: for the stats, not for
/// the decision.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PathView {
    /// Congestion window in bytes, as the transport currently believes it.
    pub cwnd_bytes: Option<u64>,
    /// Round-trip time in milliseconds.
    pub rtt_ms: Option<u32>,
    /// Datagram bytes handed to the transport that have not yet left.
    pub backlog_bytes: Option<u64>,
}

impl PathView {
    /// How long the backlog takes to drain at `drain_kbps`, in milliseconds.
    pub fn backlog_ms(&self, drain_kbps: u32) -> Option<u32> {
        let backlog = self.backlog_bytes?;
        let drain = u64::from(drain_kbps.max(1));
        Some((backlog.saturating_mul(8) / drain).min(u64::from(u32::MAX)) as u32)
    }
}

/// Why the target is what it is, for the overlay and the log.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Reason {
    /// Where the session started; no path has said otherwise yet.
    Start,
    /// A path's queue was growing; sending below its share to drain it.
    Draining,
    /// Settled at the share the slowest path delivered while queueing.
    Measured,
    /// Raised to what the slowest path has proven it carries.
    Stepped,
    /// No frame came back from the slowest path; held at its last share.
    Silent,
    /// Somebody set the bitrate by hand.
    Manual,
    /// The encoder is not under a bitrate at all, so there is nothing to decide.
    ConstantQuality,
    /// Nobody is connected, so there is no path to have an opinion about.
    NoClients,
}

impl From<rate::Reason> for Reason {
    fn from(r: rate::Reason) -> Self {
        match r {
            rate::Reason::Start => Self::Start,
            rate::Reason::Draining => Self::Draining,
            rate::Reason::Measured => Self::Measured,
            rate::Reason::Stepped => Self::Stepped,
            rate::Reason::Silent => Self::Silent,
        }
    }
}

/// The controller's whole state.
#[derive(Debug)]
pub struct Controller {
    /// The ceiling the box was given, which a client may lower but never raise.
    ///
    /// Kept apart from `limits`, which holds whatever is in force *now*. Folding
    /// the two together means a client that lowers the ceiling can never raise
    /// it again, because the only number left to compare against is the one it
    /// just lowered.
    box_ceiling_kbps: u32,
    target_kbps: u32,
    /// What the encoder was last told, or `None` before anything was sent.
    sent_kbps: Option<u32>,
    limits: Limits,
    mode: ControlMode,
    /// Set when the encoder is in constant-QP; there is no bitrate to control.
    constant_quality: bool,
    reason: Reason,
    /// Last measured send-queue depth, for reporting.
    backlog_ms: u32,
    /// Each streaming client's path.
    paths: HashMap<EndpointId, PathModel>,
}

impl Controller {
    /// Start at the ceiling.
    ///
    /// Optimistic on purpose: the common case is a path that can carry the tier
    /// that was sold, and a path that cannot says so within frames.
    pub fn new(limits: Limits) -> Self {
        Self {
            box_ceiling_kbps: limits.ceiling_kbps,
            target_kbps: limits.ceiling_kbps,
            sent_kbps: None,
            limits,
            mode: ControlMode::Auto,
            constant_quality: false,
            reason: Reason::NoClients,
            backlog_ms: 0,
            paths: HashMap::new(),
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

    /// How far behind the send queue was at the last tick, in milliseconds.
    pub fn backlog_ms(&self) -> u32 {
        self.backlog_ms
    }

    /// The slowest path's measured capacity, in kbps; 0 before one is measured.
    pub fn capacity_kbps(&self) -> u32 {
        self.slowest()
            .and_then(PathModel::capacity_kbps)
            .unwrap_or(0)
    }

    /// The slowest path's last delivered share, in kbps; 0 before it queued.
    pub fn delivery_kbps(&self) -> u32 {
        self.slowest()
            .and_then(PathModel::delivery_kbps)
            .unwrap_or(0)
    }

    /// The ceiling the box was given, whatever a client has since asked for.
    pub fn box_ceiling_kbps(&self) -> u32 {
        self.box_ceiling_kbps
    }

    /// Adopt a ceiling a client asked for, never above the one the box was given.
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

    /// One frame's feedback from one client. Returns a new target when the
    /// encoder should hear one.
    pub fn on_feedback(
        &mut self,
        client: EndpointId,
        frame: &FrameFeedback,
        now_us: u64,
    ) -> Option<u32> {
        let start = self.target_kbps;
        self.paths
            .entry(client)
            .or_insert_with(|| PathModel::new(start, now_us))
            .observe(frame, now_us);
        self.decide()
    }

    /// Once a second, with the clients that are streaming and this end's view
    /// of their connections. Returns a new target when the encoder should hear
    /// one.
    pub fn tick(&mut self, streaming: &[EndpointId], path: PathView) -> Option<u32> {
        self.paths.retain(|id, _| streaming.contains(id));
        for model in self.paths.values_mut() {
            model.tick();
        }
        self.backlog_ms = path.backlog_ms(self.target_kbps).unwrap_or(0);
        if streaming.is_empty() {
            // Nothing is connected, so nothing is being carried and there is no
            // path to form an opinion about.
            self.reason = Reason::NoClients;
            return None;
        }
        self.decide()
    }

    fn slowest(&self) -> Option<&PathModel> {
        self.paths.values().min_by_key(|m| m.allowed_kbps())
    }

    fn decide(&mut self) -> Option<u32> {
        if self.constant_quality {
            self.reason = Reason::ConstantQuality;
            return None;
        }
        if self.mode == ControlMode::Manual {
            self.reason = Reason::Manual;
            return None;
        }
        let (allowed, reason) = match self.slowest() {
            Some(m) => (m.allowed_kbps(), m.reason().into()),
            None if self.sent_kbps.is_none() => (self.target_kbps, Reason::Start),
            None => return None,
        };
        self.reason = reason;
        self.target_kbps = self.limits.clamp(allowed);
        // Every change is said: they are events -- a queue found, a share
        // measured, a step proven -- not a level wandering by a percent. The
        // first decision is always said, because the encoder started at
        // whatever its environment gave it.
        if self.sent_kbps == Some(self.target_kbps) {
            return None;
        }
        self.sent_kbps = Some(self.target_kbps);
        Some(self.target_kbps)
    }
}

/// Tell the encoder a target the controller has just decided.
pub fn actuate(
    cmd_tx: &tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    controller: &Controller,
    kbps: u32,
) {
    let mut cmd = vec![nesprotocol::MSG_ENCODE_SETTINGS];
    nesprotocol::encode_bitrate_only(&mut cmd, kbps);
    if cmd_tx.send(cmd).is_err() {
        tracing::warn!("encoder command channel closed");
        return;
    }
    // Debug, not info: each is an event, but a path that keeps changing can
    // make several a second, which at info buries the lines that matter.
    tracing::debug!(
        "video target {kbps}/{} kbps: {:?}",
        controller.limits().ceiling_kbps,
        controller.reason(),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    const CEILING: u32 = 10_000;

    fn controller() -> Controller {
        Controller::new(Limits::new(CEILING))
    }

    fn client(n: u8) -> EndpointId {
        iroh::SecretKey::from_bytes(&[n; 32]).public()
    }

    /// A frame of `bytes` sent at `t_us`, arriving over a link of `kbps`
    /// that `busy` says was still carrying the previous frame.
    fn frame(seq: u16, t_us: u64, bytes: u32, kbps: u32, queue_us: u32) -> FrameFeedback {
        let spread = (u64::from(bytes - 1_200) * 8_000 / u64::from(kbps)) as u32;
        FrameFeedback {
            seq,
            bytes,
            fragments: bytes.div_ceil(1_200) as u16,
            first_bytes: 1_200,
            sent_us: t_us,
            first_arrival_us: t_us + 40_000 + u64::from(queue_us),
            spread_us: spread,
            first_q_us: queue_us,
        }
    }

    #[test]
    fn the_first_decision_is_always_stated() {
        let mut c = controller();
        assert_eq!(c.tick(&[client(1)], PathView::default()), Some(CEILING));
        assert_eq!(c.tick(&[client(1)], PathView::default()), None);
    }

    #[test]
    fn the_slowest_client_decides() {
        let mut c = controller();
        let (fast, slow) = (client(1), client(2));
        let mut t = 0;
        let mut q = 0;
        for seq in 0..120u16 {
            // The fast client's frames drain at once; the slow one's queue
            // grows by 6 ms a frame, a train arriving straight behind the last.
            c.on_feedback(fast, &frame(seq, t, 20_000, 40_000, 0), t);
            let mut f = frame(seq, t, 20_000, 6_000, q);
            if seq > 0 {
                f.first_arrival_us = t + 40_000 + u64::from(q);
            }
            c.on_feedback(slow, &f, t);
            q += 6_000;
            t += 16_667;
        }
        assert!(
            c.target_kbps() < CEILING,
            "the slow client did not bring the rate down"
        );
    }

    #[test]
    fn the_ceiling_is_never_exceeded_and_the_floor_never_gone_below() {
        let mut c = controller();
        c.tick(&[client(1)], PathView::default());
        assert!(c.target_kbps() <= CEILING);
        c.set_ceiling(500);
        assert!(c.target_kbps() <= 500);
        assert!(c.target_kbps() >= c.limits().floor_kbps());
    }

    #[test]
    fn a_hand_set_bitrate_stands_the_controller_down() {
        let mut c = controller();
        c.note_manual_target(3_000);
        assert_eq!(c.tick(&[client(1)], PathView::default()), None);
        assert_eq!(c.reason(), Reason::Manual);
        assert_eq!(c.target_kbps(), 3_000);
    }

    #[test]
    fn constant_quality_has_no_bitrate_to_decide() {
        let mut c = controller();
        c.set_constant_quality(true);
        assert_eq!(c.tick(&[client(1)], PathView::default()), None);
        assert_eq!(c.reason(), Reason::ConstantQuality);
    }

    #[test]
    fn nothing_is_decided_while_nobody_is_connected() {
        let mut c = controller();
        assert_eq!(c.tick(&[], PathView::default()), None);
        assert_eq!(c.reason(), Reason::NoClients);
    }

    #[test]
    fn a_client_that_leaves_takes_its_path_with_it() {
        let mut c = controller();
        c.on_feedback(client(1), &frame(0, 0, 20_000, 6_000, 0), 0);
        c.tick(&[], PathView::default());
        assert!(c.paths.is_empty());
    }

    #[test]
    fn a_lowered_ceiling_can_be_raised_again() {
        let mut c = controller();
        c.set_ceiling(4_000);
        assert_eq!(c.limits().ceiling_kbps, 4_000);
        c.set_ceiling(9_000);
        assert_eq!(c.limits().ceiling_kbps, 9_000);
    }

    #[test]
    fn a_client_may_lower_its_ceiling_but_not_raise_it() {
        let mut c = controller();
        c.set_ceiling(CEILING * 2);
        assert_eq!(c.limits().ceiling_kbps, CEILING);
    }

    #[test]
    fn a_ceiling_change_is_restated_to_the_encoder() {
        let mut c = controller();
        c.tick(&[client(1)], PathView::default());
        c.set_ceiling(CEILING);
        assert_eq!(c.tick(&[client(1)], PathView::default()), Some(CEILING));
    }

    #[test]
    fn a_ceiling_under_the_floor_does_not_invert_the_band() {
        let limits = Limits::new(500);
        assert!(limits.floor_kbps() <= limits.ceiling_kbps);
    }
}
