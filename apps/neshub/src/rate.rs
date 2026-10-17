//! What rate one client's path can carry, from how its frames arrived.
//!
//! See nescore's `docs/superpowers/specs/2026-10-16-video-rate-from-the-path-design.md`.
//!
//! # Every frame is a measurement
//!
//! A frame's fragments leave this end back to back (`congestion.rs` sees that
//! nothing holds them), so they reach the client spaced by the slowest link
//! they crossed. Two things follow, both read from the client's per-frame
//! feedback rather than guessed:
//!
//! - **Capacity.** A frame's bytes after its first fragment, over the time its
//!   fragments took to arrive, is the bottleneck's rate. Every multi-fragment
//!   frame measures it without sending above it for longer than one frame.
//! - **Whether we are over it.** Below capacity a frame's train has drained
//!   before the next frame reaches the bottleneck, so consecutive trains arrive
//!   with a gap between them. When the next train starts arriving no later than
//!   the previous one's next fragment would have, the bottleneck never went idle
//!   between them: it is busy with our traffic. Busy is not yet too much -- a
//!   keyframe keeps it busy for a few frames and then it drains -- so the test
//!   is whether the queue the first fragments find is *growing* across the busy
//!   period, and whether more is being sent into it than comes out.
//!
//! # Down at once, up on evidence
//!
//! When the queue grows, what the path delivered over the busy period is its
//! measured share, and the queue already built is drained exactly: sending as
//! far below that share as the rate went above it, for as long, until the
//! trains have a gap between them again. Then the rate sits at the share.
//!
//! Going up uses the capacity the frames measured, and holds each step on the
//! same evidence the audio playout uses: a rate may be used again once the path
//! has gone quiet for longer than the longest it has ever gone between two
//! overloads at or below it, playout's start counting as the first.

use nesprotocol::datagram::FrameFeedback;

/// Why a client's rate is what it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Reason {
    /// Where the session started; nothing has said otherwise yet.
    Start,
    /// The queue was growing; sending below the path's share to drain it.
    Draining,
    /// Settled at the share the path delivered while it was queueing.
    Measured,
    /// Raised to what the path has proven it carries.
    Stepped,
    /// No frame has come back; held at the last rate the path proved.
    Silent,
}

/// One time the path was overloaded.
#[derive(Debug, Clone, Copy)]
struct Overload {
    at_us: u64,
    /// What was being sent into it.
    sent_kbps: u32,
}

/// A run of frames during which the bottleneck never went idle.
#[derive(Debug, Clone, Copy)]
struct Busy {
    start_sent_us: u64,
    start_arrival_us: u64,
    /// Bytes of the frames in the run before the latest one.
    bytes: u64,
    /// The queue the second frame of the run found: the first frame's own
    /// burst included, so a run that only drains never reads as growing.
    first_q_us: u32,
    /// Whether this run has already been counted as an overload.
    counted: bool,
}

#[derive(Debug)]
pub struct PathModel {
    allowed_kbps: u32,
    reason: Reason,
    started_us: u64,
    prev: Option<FrameFeedback>,
    busy: Option<Busy>,
    draining: bool,
    /// The share the path last delivered while queueing.
    delivery_kbps: Option<u32>,
    /// What frames have measured of the capacity since the last overload.
    capacity: Median,
    overloads: Vec<Overload>,
    /// Whether any feedback arrived since the last [`tick`](Self::tick).
    heard: bool,
}

/// The median of everything pushed, kept as two heaps so each push costs
/// `log n` however long the session runs.
///
/// The median rather than the highest, because the error in a dispersion
/// sample is one-sided at each end. Fragments the client reads in one batch
/// share a timestamp, so a train's spread reads short and its rate high -- on a
/// fast path, measured 2026-10-16, a highest-ever of 9 Gbps through a link
/// carrying 8 Mbps. A train interleaved with other traffic spreads long and
/// reads low. Neither is the bottleneck; the middle of the frames is.
#[derive(Debug, Default)]
struct Median {
    /// The lower half, largest on top.
    low: std::collections::BinaryHeap<u32>,
    /// The upper half, smallest on top.
    high: std::collections::BinaryHeap<std::cmp::Reverse<u32>>,
}

impl Median {
    fn push(&mut self, v: u32) {
        if self.low.peek().is_none_or(|&top| v <= top) {
            self.low.push(v);
        } else {
            self.high.push(std::cmp::Reverse(v));
        }
        if self.low.len() > self.high.len() + 1 {
            self.high.push(std::cmp::Reverse(self.low.pop().unwrap()));
        } else if self.high.len() > self.low.len() {
            self.low.push(self.high.pop().unwrap().0);
        }
    }

    fn get(&self) -> Option<u32> {
        self.low.peek().copied()
    }
}

/// Bits per millisecond, which is kbps, from bytes over microseconds.
fn kbps(bytes: u64, us: u64) -> u32 {
    (bytes.saturating_mul(8_000) / us.max(1)).min(u64::from(u32::MAX)) as u32
}

impl PathModel {
    pub fn new(start_kbps: u32, now_us: u64) -> Self {
        Self {
            allowed_kbps: start_kbps,
            reason: Reason::Start,
            started_us: now_us,
            prev: None,
            busy: None,
            draining: false,
            delivery_kbps: None,
            capacity: Median::default(),
            overloads: Vec::new(),
            heard: false,
        }
    }

    pub fn allowed_kbps(&self) -> u32 {
        self.allowed_kbps
    }
    pub fn reason(&self) -> Reason {
        self.reason
    }
    pub fn capacity_kbps(&self) -> Option<u32> {
        self.capacity.get()
    }
    pub fn delivery_kbps(&self) -> Option<u32> {
        self.delivery_kbps
    }

    /// Take one frame's feedback.
    pub fn observe(&mut self, frame: &FrameFeedback, now_us: u64) {
        self.heard = true;
        if frame.fragments >= 2 && frame.spread_us > 0 {
            let measured = kbps(
                u64::from(frame.bytes.saturating_sub(u32::from(frame.first_bytes))),
                u64::from(frame.spread_us),
            );
            self.capacity.push(measured);
        }

        if let Some(prev) = self.prev.replace(*frame) {
            if busy_between(&prev, frame) {
                self.continue_busy(&prev, frame, now_us);
            } else {
                self.busy = None;
                if self.draining {
                    self.draining = false;
                    if let Some(share) = self.delivery_kbps {
                        self.allowed_kbps = share;
                        self.reason = Reason::Measured;
                    }
                } else {
                    self.step_up(now_us);
                }
            }
        }
    }

    fn continue_busy(&mut self, prev: &FrameFeedback, frame: &FrameFeedback, now_us: u64) {
        let busy = self.busy.get_or_insert(Busy {
            start_sent_us: prev.sent_us,
            start_arrival_us: prev.first_arrival_us,
            bytes: 0,
            first_q_us: frame.first_q_us,
            counted: false,
        });
        busy.bytes += u64::from(prev.bytes);
        let delivered = kbps(
            busy.bytes,
            frame.first_arrival_us.saturating_sub(busy.start_arrival_us),
        );
        let sent = kbps(busy.bytes, frame.sent_us.saturating_sub(busy.start_sent_us));
        let growing = frame.first_q_us > busy.first_q_us;
        if !(growing && sent > delivered) {
            return;
        }
        // Drained at the rate it was built: as far below the share as the
        // sender went above it, for as long as the run has lasted.
        self.allowed_kbps = (2 * u64::from(delivered))
            .saturating_sub(u64::from(sent))
            .max(1) as u32;
        self.delivery_kbps = Some(delivered);
        self.draining = true;
        self.reason = Reason::Draining;
        if !busy.counted {
            busy.counted = true;
            self.overloads.push(Overload {
                at_us: now_us,
                sent_kbps: sent,
            });
            // What the frames measured above this share was not true of the
            // path as it is now; it is measured again from here.
            self.capacity = Median::default();
            self.capacity.push(delivered);
        }
    }

    /// Raise the rate to the highest the path has proven it carries.
    fn step_up(&mut self, now_us: u64) {
        let Some(capacity) = self.capacity.get() else {
            return;
        };
        if capacity <= self.allowed_kbps {
            return;
        }
        // The capacity frames measured, or the highest rate below it that the
        // path has gone quiet at for long enough to be trusted.
        let mut candidates: Vec<u32> = self
            .overloads
            .iter()
            .map(|o| o.sent_kbps)
            .filter(|&r| r > self.allowed_kbps && r < capacity)
            .chain(std::iter::once(capacity))
            .collect();
        candidates.sort_unstable_by(|a, b| b.cmp(a));
        let Some(&to) = candidates.iter().find(|&&r| self.proven(r, now_us)) else {
            return;
        };
        if to > self.allowed_kbps {
            self.allowed_kbps = to;
            self.reason = Reason::Stepped;
        }
    }

    /// Whether `rate` has been quiet long enough: since the last overload at or
    /// below it, longer than the longest gap between two such overloads.
    fn proven(&self, rate: u32, now_us: u64) -> bool {
        let mut last = self.started_us;
        let mut longest = 0;
        let mut any = false;
        for o in self.overloads.iter().filter(|o| o.sent_kbps <= rate) {
            longest = longest.max(o.at_us.saturating_sub(last));
            last = o.at_us;
            any = true;
        }
        !any || now_us.saturating_sub(last) > longest
    }

    /// Once a second. A second in which no frame came back is itself a
    /// measurement: whatever was sent did not arrive, so the rate goes to the
    /// last share the path proved, as for a queue.
    pub fn tick(&mut self) {
        if !std::mem::take(&mut self.heard) && self.prev.is_some() {
            if let Some(share) = self.delivery_kbps {
                self.allowed_kbps = self.allowed_kbps.min(share);
            }
            self.reason = Reason::Silent;
        }
    }
}

/// Whether the bottleneck went from `prev`'s train straight into `frame`'s.
///
/// On a link that never idled, `frame`'s first fragment lands exactly its own
/// serialisation after `prev`'s last, at the rate a train measured. So the
/// test is whether it landed no later than that. With no train long enough to
/// show a rate there is nothing to compare with, and two single-fragment frames
/// cannot tell a busy link from an idle one.
fn busy_between(prev: &FrameFeedback, frame: &FrameFeedback) -> bool {
    let per_byte = [prev, frame]
        .into_iter()
        .find(|f| f.fragments >= 2 && f.bytes > u32::from(f.first_bytes))
        .map(|f| {
            (
                u64::from(f.spread_us),
                u64::from(f.bytes - u32::from(f.first_bytes)),
            )
        });
    let Some((spread, bytes)) = per_byte else {
        return false;
    };
    let first = (u64::from(frame.first_bytes) * spread).div_ceil(bytes);
    let prev_end = prev.first_arrival_us + u64::from(prev.spread_us);
    frame.first_arrival_us <= prev_end + first
}

#[cfg(test)]
mod tests {
    use super::*;

    const FRAGMENT: u64 = 1_200;
    const INTERVAL_US: u64 = 16_667;
    const PROPAGATION_US: u64 = 40_000;

    /// A path with a FIFO bottleneck, fed one frame at a time.
    struct Bottleneck {
        /// What the bottleneck carries for us, in kbps, by time.
        capacity: Box<dyn Fn(u64) -> u32>,
        /// Extra bytes other traffic puts into it, by frame.
        cross: Box<dyn Fn(u64) -> u64>,
        /// When the bottleneck is next free.
        free_at: u64,
        seq: u16,
    }

    impl Bottleneck {
        fn new(capacity: impl Fn(u64) -> u32 + 'static) -> Self {
            Self {
                capacity: Box::new(capacity),
                cross: Box::new(|_| 0),
                free_at: 0,
                seq: 0,
            }
        }

        /// Send a frame of `bytes` at `sent_us`; return what the client says.
        fn send(&mut self, n: u64, sent_us: u64, bytes: u64) -> FrameFeedback {
            let c = u64::from((self.capacity)(sent_us)).max(1);
            let at = sent_us + PROPAGATION_US;
            // Cross traffic lands just ahead of the frame.
            self.free_at = self.free_at.max(at) + (self.cross)(n) * 8_000 / c;
            let start = self.free_at.max(at);
            let first_q = start - at;
            let fragments = bytes.div_ceil(FRAGMENT).max(1);
            let serialise = |b: u64| b * 8_000 / c;
            let first_done = start + serialise(FRAGMENT.min(bytes));
            let last_done = start + serialise(bytes);
            self.free_at = last_done;
            self.seq = self.seq.wrapping_add(1);
            FrameFeedback {
                seq: self.seq,
                bytes: bytes as u32,
                fragments: fragments as u16,
                first_bytes: FRAGMENT.min(bytes) as u16,
                sent_us,
                first_arrival_us: first_done,
                spread_us: (last_done - first_done) as u32,
                first_q_us: first_q as u32,
            }
        }
    }

    /// Run `frames` frames at whatever the model allows, the encoder holding
    /// its target as an average, as a CBR encoder does. `keyframe_every`
    /// frames, one is 8x a delta, and the deltas around it are smaller by what
    /// it took.
    fn run(
        path: &mut Bottleneck,
        model: &mut PathModel,
        frames: u64,
        keyframe_every: Option<u64>,
    ) -> Vec<(u32, u32)> {
        let mut out = Vec::new();
        for n in 0..frames {
            let sent = n * INTERVAL_US;
            let budget = u64::from(model.allowed_kbps()) * INTERVAL_US / 8_000;
            let size = match keyframe_every {
                Some(gop) => {
                    let delta = budget * gop / (gop + 7);
                    if n % gop == 0 { delta * 8 } else { delta }
                }
                None => budget,
            };
            let fb = path.send(n, sent, size.max(1));
            model.observe(&fb, fb.first_arrival_us);
            out.push((model.allowed_kbps(), fb.first_q_us));
        }
        out
    }

    #[test]
    fn a_rate_above_the_path_comes_down_to_what_it_delivers() {
        let mut path = Bottleneck::new(|_| 6_000);
        let mut model = PathModel::new(10_000, 0);
        let trace = run(&mut path, &mut model, 600, None);
        let (settled, q) = *trace.last().unwrap();
        assert!(
            (5_400..=6_000).contains(&settled),
            "settled at {settled} kbps on a 6000 kbps path"
        );
        assert!(q < 2_000, "the queue never drained: {q} us");
        let first_low = trace.iter().position(|(r, _)| *r <= 6_000).unwrap();
        assert!(first_low < 20, "took {first_low} frames to come down");
    }

    #[test]
    fn a_rate_below_the_path_steps_up_to_what_frames_measured() {
        let mut path = Bottleneck::new(|_| 12_000);
        let mut model = PathModel::new(3_000, 0);
        let trace = run(&mut path, &mut model, 120, None);
        let (settled, q) = *trace.last().unwrap();
        assert!(
            (11_000..=12_050).contains(&settled),
            "settled at {settled} kbps on a 12000 kbps path"
        );
        assert!(q < 2_000, "stepping up built a queue: {q} us");
    }

    #[test]
    fn a_keyframe_is_not_mistaken_for_overload() {
        let mut path = Bottleneck::new(|_| 12_000);
        let mut model = PathModel::new(6_000, 0);
        run(&mut path, &mut model, 600, Some(120));
        assert!(
            model.overloads.is_empty(),
            "{} overloads",
            model.overloads.len()
        );
    }

    #[test]
    fn a_capacity_drop_is_followed_down_and_back_up_without_a_sawtooth() {
        let mut path = Bottleneck::new(|t| {
            if (10_000_000..20_000_000).contains(&t) {
                4_000
            } else {
                9_000
            }
        });
        let mut model = PathModel::new(9_000, 0);
        let trace = run(&mut path, &mut model, 60 * 40, None);
        let during = trace[60 * 15].0;
        assert!(
            (3_600..=4_000).contains(&during),
            "{during} kbps during the drop"
        );
        let after = trace.last().unwrap().0;
        assert!(
            (8_000..=9_000).contains(&after),
            "{after} kbps after the drop"
        );
        assert!(
            model.overloads.len() <= 4,
            "{} overloads: a sawtooth",
            model.overloads.len()
        );
    }

    #[test]
    fn recurring_cross_traffic_is_learned_and_not_stepped_into_forever() {
        let mut path = Bottleneck::new(|_| 10_000);
        // Another flow sends 60 KB every 5 s.
        path.cross = Box::new(|n| if n % 300 == 150 { 60_000 } else { 0 });
        let mut model = PathModel::new(9_000, 0);
        run(&mut path, &mut model, 60 * 120, None);
        let second_minute = model
            .overloads
            .iter()
            .filter(|o| o.at_us > 60_000_000)
            .count();
        assert!(
            second_minute <= 2,
            "{second_minute} overloads in the second minute"
        );
    }

    /// What the record caught: most frames measure the path, a few batched
    /// ones read absurdly fast. The estimate is the path's.
    #[test]
    fn a_few_batched_trains_do_not_set_the_capacity() {
        let mut m = Median::default();
        for n in 0..100 {
            m.push(if n % 10 == 0 {
                9_000_000
            } else {
                11_800 + n % 7 * 100
            });
        }
        let c = m.get().unwrap();
        assert!((11_800..=12_400).contains(&c), "{c} kbps");
    }

    #[test]
    fn silence_holds_the_rate_at_the_last_proven_share() {
        let mut path = Bottleneck::new(|_| 6_000);
        let mut model = PathModel::new(10_000, 0);
        run(&mut path, &mut model, 300, None);
        model.tick();
        model.tick();
        assert_eq!(model.reason(), Reason::Silent);
        assert!(model.allowed_kbps() <= model.delivery_kbps().unwrap());
    }
}
