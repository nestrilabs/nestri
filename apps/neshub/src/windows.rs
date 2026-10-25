//! Which window a frame, a cursor update or an input event belongs to,
//! ref(d-0085).
//!
//! The box tells the hub about windows on the input socket: nescope mints the
//! ids and says which process owns each one. Encoders tag their frames with
//! their process id. This module joins the two, decides which connection is
//! shown what, and tags input on its way back to the box.
//!
//! The compatibility rule everything here follows: a connection that never
//! subscribes is shown what a client saw before windows existed, in the old
//! encoding. That is the box's *primary* picture: one encoder's frames,
//! replaced only after it has gone silent, by an encoder that has been drawing
//! for a while, with a keyframe and a fresh sequence on every switch. With one
//! game in the box it is that game, whatever window id nescope gave it, and
//! the bytes are the ones the client always received.

use std::collections::{BTreeMap, HashMap};
use std::time::{Duration, Instant};

use nesprotocol::input::{INPUT_OUTPUT_SIZE, encode_window_focus, encode_window_output_size};
use nesprotocol::window::{WINDOW_DEFAULT, WindowEvent, WindowId};

/// Who drew a frame: an encoder's process id, or `None` for an encoder that
/// predates tagging, which is the box's first window.
pub type Source = Option<u32>;

/// How long the primary encoder may go without a frame before another one
/// takes its place for connections that never subscribed.
pub const PRIMARY_SILENCE: Duration = Duration::from_secs(1);

/// How long an encoder must have been drawing, without a gap of
/// [`PRIMARY_SILENCE`], before it may become the primary picture. A game that
/// draws one frame on its way out does not take the picture.
pub const PRIMARY_SETTLE: Duration = Duration::from_millis(250);

/// One encoder's recent drawing, for choosing the primary picture.
#[derive(Debug, Clone, Copy)]
struct Drawing {
    /// When its current run of frames began.
    since: Instant,
    last: Instant,
    /// The order encoders were first heard from: higher is newer.
    order: u64,
}

/// What [`WindowTable::note_primary`] decided about one frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PrimaryNote {
    /// The frame is the primary picture.
    pub primary: bool,
    /// The primary picture just moved to this frame's encoder: its watchers
    /// need a keyframe and a fresh sequence.
    pub switched: bool,
}

/// What a connection is shown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Subscription {
    /// Never subscribed: the box's primary picture, encoded as window `0`.
    Legacy,
    /// One window, by id.
    Window(WindowId),
    /// Subscribed to a window of a compositor that has since gone. Its ids
    /// mean nothing now, so nothing is shown until the client subscribes again.
    Torn,
}

/// The window a frame is sent as to a connection with `sub`, or `None` if
/// that connection is not shown it. `window` is the frame's window, if known;
/// `primary` is whether it is the primary picture.
pub fn route(sub: Subscription, window: Option<WindowId>, primary: bool) -> Option<WindowId> {
    match sub {
        Subscription::Legacy => primary.then_some(WINDOW_DEFAULT),
        Subscription::Window(w) => (window == Some(w)).then_some(w),
        Subscription::Torn => None,
    }
}

/// Whether a connection with `sub` is sent a cursor update describing
/// `cursor_window`. A connection that never subscribed gets every update, as
/// it always did.
pub fn wants_cursor(sub: Subscription, cursor_window: WindowId) -> bool {
    match sub {
        Subscription::Legacy => true,
        Subscription::Window(w) => w == cursor_window,
        Subscription::Torn => false,
    }
}

/// A window as it stands, enough to tell a late subscriber about it.
#[derive(Debug, Clone)]
struct OpenWindow {
    opened: WindowEvent,
    icon: Option<WindowEvent>,
    /// The latest placement, so a client that joins late places the window too.
    placed: Option<WindowEvent>,
}

/// The box's windows, their owners, and which encoder is primary.
#[derive(Debug, Default)]
pub struct WindowTable {
    open: BTreeMap<WindowId, OpenWindow>,
    pids: HashMap<u32, WindowId>,
    /// Processes whose window has closed. Their last frames belong to nobody,
    /// not to whichever window is left.
    retired: std::collections::HashSet<u32>,
    /// The launch each encoder said it draws for, ref(d-0085). The encoder
    /// says so itself: the hub runs as another user and cannot read a game's
    /// environment.
    launch_of: HashMap<u32, String>,
    /// The encoder that last drew each window, so a keyframe request can go to
    /// that encoder alone.
    drawn_by: HashMap<WindowId, u32>,
    drawing: HashMap<Source, Drawing>,
    next_order: u64,
    primary: Option<Source>,
}

impl WindowTable {
    /// Take in a lifecycle event from the box.
    pub fn apply(&mut self, event: &WindowEvent) {
        match event {
            WindowEvent::Opened { window, .. } => {
                self.open.insert(
                    *window,
                    OpenWindow {
                        opened: event.clone(),
                        icon: None,
                        placed: None,
                    },
                );
            }
            WindowEvent::Title { window, title } => {
                if let Some(WindowEvent::Opened { title: t, .. }) =
                    self.open.get_mut(window).map(|w| &mut w.opened)
                {
                    *t = title.clone();
                }
            }
            WindowEvent::Size {
                window,
                width,
                height,
            } => {
                if let Some(WindowEvent::Opened {
                    width: w,
                    height: h,
                    ..
                }) = self.open.get_mut(window).map(|w| &mut w.opened)
                {
                    (*w, *h) = (*width, *height);
                }
            }
            WindowEvent::Icon { window, .. } => {
                if let Some(open) = self.open.get_mut(window) {
                    open.icon = Some(event.clone());
                }
            }
            WindowEvent::Placed { window, .. } => {
                if let Some(open) = self.open.get_mut(window) {
                    open.placed = Some(event.clone());
                }
            }
            WindowEvent::Closed { window } => {
                self.open.remove(window);
                let retired = &mut self.retired;
                self.pids.retain(|pid, w| {
                    let keep = w != window;
                    if !keep {
                        retired.insert(*pid);
                    }
                    keep
                });
            }
        }
    }

    /// Window `window` is owned by process `pid`.
    pub fn bind_pid(&mut self, window: WindowId, pid: u32) {
        self.pids.insert(pid, window);
        self.retired.remove(&pid);
    }

    /// Encoder `pid` draws for launch `launch` (empty: it did not say).
    pub fn note_launch(&mut self, pid: u32, launch: String) {
        if launch.is_empty() {
            self.launch_of.remove(&pid);
        } else {
            self.launch_of.insert(pid, launch);
        }
    }

    /// Encoder `pid` drew a frame of `window`.
    pub fn note_drawn(&mut self, window: WindowId, pid: u32) {
        self.drawn_by.insert(window, pid);
    }

    /// The encoder that last drew `window`.
    pub fn encoder_of(&self, window: WindowId) -> Option<u32> {
        self.drawn_by.get(&window).copied()
    }

    /// The encoder of the primary picture, when it is a tagged one.
    pub fn primary_pid(&self) -> Option<u32> {
        self.primary.flatten()
    }

    /// Every open window, as the events that tell a late subscriber about it.
    pub fn snapshot(&self) -> Vec<WindowEvent> {
        let mut out = Vec::new();
        for open in self.open.values() {
            out.push(open.opened.clone());
            out.extend(open.icon.clone());
            out.extend(open.placed.clone());
        }
        out
    }

    /// The compositor went: forget everything, and say which windows closed.
    pub fn reset(&mut self) -> Vec<WindowId> {
        let closed = self.open.keys().copied().collect();
        *self = Self {
            primary: self.primary,
            drawing: std::mem::take(&mut self.drawing),
            next_order: self.next_order,
            launch_of: std::mem::take(&mut self.launch_of),
            ..Self::default()
        };
        closed
    }

    /// Which window a frame from `source` is.
    ///
    /// An untagged encoder is window `0`. A tagged one is the window its
    /// process owns; failing that, the newest window of the launch the process
    /// belongs to (a renderer process drawing for a window another process of
    /// the same launch owns); failing that, window `0` while the box has no
    /// other window. Otherwise nobody can say, and the frame is shown only as
    /// the primary picture, if it is that.
    pub fn resolve(&mut self, source: Source) -> Option<WindowId> {
        let Some(pid) = source else {
            return Some(WINDOW_DEFAULT);
        };
        if let Some(window) = self.pids.get(&pid) {
            return Some(*window);
        }
        if self.retired.contains(&pid) {
            return None;
        }
        if let Some(launch) = self.launch_of.get(&pid) {
            let newest = self.open.iter().rev().find_map(|(id, w)| match &w.opened {
                WindowEvent::Opened { launch_id, .. } if launch_id == launch => Some(*id),
                _ => None,
            });
            if newest.is_some() {
                return newest;
            }
        }
        self.open
            .keys()
            .all(|w| *w == WINDOW_DEFAULT)
            .then_some(WINDOW_DEFAULT)
    }

    /// Note a frame from `source` and decide whether it is the primary
    /// picture.
    ///
    /// The first encoder to draw is primary, and stays so while it keeps
    /// drawing. Only once it has been silent for [`PRIMARY_SILENCE`] may
    /// another take over, and only one that has drawn for [`PRIMARY_SETTLE`];
    /// of those, the newest encoder, which is the most recent launch. The
    /// first choice is not a switch: nobody has been shown anything yet.
    pub fn note_primary(&mut self, source: Source, now: Instant) -> PrimaryNote {
        let order = &mut self.next_order;
        let d = self.drawing.entry(source).or_insert_with(|| {
            *order += 1;
            Drawing {
                since: now,
                last: now,
                order: *order,
            }
        });
        if now.duration_since(d.last) >= PRIMARY_SILENCE {
            d.since = now;
        }
        d.last = now;

        let not = PrimaryNote {
            primary: false,
            switched: false,
        };
        let Some(current) = self.primary else {
            self.primary = Some(source);
            return PrimaryNote {
                primary: true,
                switched: false,
            };
        };
        if current == source {
            return PrimaryNote {
                primary: true,
                switched: false,
            };
        }
        let current_silent = self
            .drawing
            .get(&current)
            .is_none_or(|c| now.duration_since(c.last) >= PRIMARY_SILENCE);
        if !current_silent {
            return not;
        }
        let best = self
            .drawing
            .iter()
            .filter(|(_, d)| {
                now.duration_since(d.last) < PRIMARY_SILENCE
                    && now.duration_since(d.since) >= PRIMARY_SETTLE
            })
            .max_by_key(|(_, d)| d.order)
            .map(|(s, _)| *s);
        if best != Some(source) {
            return not;
        }
        self.primary = Some(source);
        PrimaryNote {
            primary: true,
            switched: true,
        }
    }
}

/// Tags input on its way to the box with the window it belongs to.
///
/// One per connection to nescope, starting at window `0`, which is what
/// nescope assumes on every new connection. A focus tag goes out only when the
/// window changes, so a box where every event is window `0`'s sees exactly the
/// bytes it always did.
#[derive(Debug, Default)]
pub struct FocusTagger {
    last: WindowId,
    /// Who last sent a keyboard or pointer event, and when.
    typing: Option<(u32, Instant)>,
}

/// How long a client's keyboard or pointer input keeps another client's
/// gamepad from taking focus.
pub const TYPING_HOLDS_FOCUS: Duration = Duration::from_secs(1);

impl FocusTagger {
    /// The messages to write for one input event from `client`, for
    /// `window`. An empty event asks only for focus: a gamepad message, whose
    /// pads reach the game by another route and are read only by the focused
    /// window. It moves focus only to a different window, and not while
    /// another client has typed or pointed in the last [`TYPING_HOLDS_FOCUS`].
    pub fn messages(
        &mut self,
        client: u32,
        window: WindowId,
        event: &[u8],
        now: Instant,
    ) -> Vec<Vec<u8>> {
        let mut out = Vec::with_capacity(2);
        if event.first() == Some(&INPUT_OUTPUT_SIZE) && event.len() >= 5 {
            // Carries its window itself and moves no focus. Window 0 keeps
            // the old form, which a compositor that predates windows reads.
            if window == WINDOW_DEFAULT {
                out.push(event.to_vec());
            } else {
                let width = u16::from_le_bytes([event[1], event[2]]);
                let height = u16::from_le_bytes([event[3], event[4]]);
                let mut m = Vec::with_capacity(7);
                encode_window_output_size(&mut m, window, width, height);
                out.push(m);
            }
            return out;
        }
        if event.is_empty() {
            let held = self.typing.is_some_and(|(who, at)| {
                who != client && now.duration_since(at) < TYPING_HOLDS_FOCUS
            });
            if held {
                return out;
            }
        } else {
            self.typing = Some((client, now));
        }
        if window != self.last {
            let mut tag = Vec::with_capacity(3);
            encode_window_focus(&mut tag, window);
            out.push(tag);
            self.last = window;
        }
        if !event.is_empty() {
            out.push(event.to_vec());
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nesprotocol::input::{
        DecodedInput, decode_input_event, encode_key_event, encode_mouse_move, encode_output_size,
    };

    fn opened(window: WindowId, launch: &str) -> WindowEvent {
        WindowEvent::Opened {
            window,
            width: 1920,
            height: 1080,
            launch_id: launch.into(),
            title: format!("w{window}"),
            app_id: String::new(),
        }
    }


    #[test]
    fn an_untagged_encoder_is_window_zero() {
        let mut t = WindowTable::default();
        assert_eq!(t.resolve(None), Some(0));
        t.apply(&opened(0, "a"));
        t.apply(&opened(1, "b"));
        assert_eq!(t.resolve(None), Some(0));
    }

    #[test]
    fn a_tagged_encoder_is_the_window_its_process_owns() {
        let mut t = WindowTable::default();
        t.apply(&opened(0, "a"));
        t.apply(&opened(1, "b"));
        t.bind_pid(0, 100);
        t.bind_pid(1, 200);
        assert_eq!(t.resolve(Some(100)), Some(0));
        assert_eq!(t.resolve(Some(200)), Some(1));
        t.apply(&WindowEvent::Closed { window: 1 });
        // Its window gone: its last frames are nobody's, even with only
        // window 0 left.
        assert_eq!(t.resolve(Some(200)), None);
    }

    #[test]
    fn an_unknown_process_is_found_by_its_launch() {
        let mut t = WindowTable::default();
        t.apply(&opened(0, "steam"));
        t.apply(&opened(1, "launch_b"));
        t.apply(&opened(2, "launch_b"));
        t.note_launch(300, "launch_b".into());
        assert_eq!(t.resolve(Some(300)), Some(2), "the newest of its launch");
        assert_eq!(t.resolve(Some(301)), None);
    }

    #[test]
    fn with_one_window_any_encoder_is_window_zero() {
        // One game, nescope that predates pid messages: as it always was.
        let mut t = WindowTable::default();
        assert_eq!(t.resolve(Some(4242)), Some(0));
        t.apply(&opened(0, ""));
        assert_eq!(t.resolve(Some(4242)), Some(0));
    }

    fn ms(t0: Instant, ms: u64) -> Instant {
        t0 + Duration::from_millis(ms)
    }

    #[test]
    fn the_first_encoder_to_draw_is_primary_until_it_stops() {
        let mut t = WindowTable::default();
        let t0 = Instant::now();
        let yes = PrimaryNote { primary: true, switched: false };
        let no = PrimaryNote { primary: false, switched: false };
        assert_eq!(t.note_primary(Some(1), t0), yes, "the first is no switch");
        assert_eq!(t.note_primary(Some(2), ms(t0, 10)), no);
        assert_eq!(t.note_primary(Some(1), ms(t0, 500)), yes);
        assert_eq!(t.note_primary(Some(2), ms(t0, 1400)), no, "1 is not silent yet");
        // 1 silent, but 2 only began this run at 1400: not settled.
        assert_eq!(t.note_primary(Some(2), ms(t0, 1600)), no);
        assert_eq!(
            t.note_primary(Some(2), ms(t0, 1700)),
            PrimaryNote { primary: true, switched: true }
        );
        assert_eq!(t.note_primary(Some(1), ms(t0, 1710)), no);
        assert_eq!(t.primary_pid(), Some(2));
    }

    #[test]
    fn a_fresh_encoder_waits_to_settle_and_the_newest_wins() {
        let mut t = WindowTable::default();
        let t0 = Instant::now();
        t.note_primary(Some(1), t0);
        // 2 and 3 draw in turn from 100 ms; 1 has stopped.
        for at in (100..1000).step_by(20) {
            assert!(!t.note_primary(Some(2), ms(t0, at)).primary);
            assert!(!t.note_primary(Some(3), ms(t0, at + 10)).primary);
        }
        // 1 silent, both settled: 2's frame does not take it, 3 is newer.
        assert!(!t.note_primary(Some(2), ms(t0, 1000)).primary);
        assert!(t.note_primary(Some(3), ms(t0, 1010)).switched);

        // A newcomer that has drawn under 250 ms is passed over.
        let mut t = WindowTable::default();
        t.note_primary(Some(1), t0);
        assert!(!t.note_primary(Some(4), ms(t0, 1100)).primary, "not settled");
        assert!(t.note_primary(Some(4), ms(t0, 1360)).switched);
    }

    #[test]
    fn alternating_bursts_do_not_flap_faster_than_the_silence() {
        let mut t = WindowTable::default();
        let t0 = Instant::now();
        let mut switches = Vec::new();
        for frame in 0..1000u64 {
            let at = frame * 16;
            let who = if (at / 1500) % 2 == 0 { 1 } else { 2 };
            if t.note_primary(Some(who), ms(t0, at)).switched {
                switches.push(at);
            }
        }
        assert!(!switches.is_empty());
        for w in switches.windows(2) {
            assert!(w[1] - w[0] >= 1000, "switched at {} then {}", w[0], w[1]);
        }
    }

    #[test]
    fn routing() {
        use Subscription::*;
        assert_eq!(
            route(Legacy, Some(3), true),
            Some(0),
            "old encoding for an old client"
        );
        assert_eq!(route(Legacy, Some(0), false), None);
        assert_eq!(route(Window(3), Some(3), false), Some(3));
        assert_eq!(route(Window(0), Some(0), true), Some(0));
        assert_eq!(route(Window(3), Some(4), true), None);
        assert_eq!(route(Window(3), None, true), None);
        assert_eq!(route(Torn, Some(0), true), None);
        assert!(wants_cursor(Legacy, 7));
        assert!(wants_cursor(Window(7), 7));
        assert!(!wants_cursor(Window(7), 0));
        assert!(!wants_cursor(Torn, 0));
    }

    #[test]
    fn snapshot_reflects_the_box_as_it_stands() {
        let mut t = WindowTable::default();
        t.apply(&opened(0, "a"));
        t.apply(&opened(1, "b"));
        t.apply(&WindowEvent::Title {
            window: 1,
            title: "Paused".into(),
        });
        t.apply(&WindowEvent::Size {
            window: 1,
            width: 1280,
            height: 720,
        });
        t.apply(&WindowEvent::Icon {
            window: 1,
            width: 1,
            height: 1,
            rgba: vec![1, 2, 3, 4],
        });
        t.apply(&WindowEvent::Closed { window: 0 });
        let snap = t.snapshot();
        assert_eq!(snap.len(), 2);
        assert_eq!(
            snap[0],
            WindowEvent::Opened {
                window: 1,
                width: 1280,
                height: 720,
                launch_id: "b".into(),
                title: "Paused".into(),
                app_id: String::new(),
            }
        );
        assert!(matches!(snap[1], WindowEvent::Icon { window: 1, .. }));
        assert_eq!(t.reset(), vec![1]);
        assert!(t.snapshot().is_empty());
    }

    #[test]
    fn one_window_input_is_the_old_bytes() {
        let mut tagger = FocusTagger::default();
        let mut key = Vec::new();
        encode_key_event(&mut key, true, 30);
        let mut size = Vec::new();
        encode_output_size(&mut size, 1280, 720);
        assert_eq!(tagger.messages(1, 0, &key, Instant::now()), vec![key.clone()]);
        assert_eq!(tagger.messages(1, 0, &size, Instant::now()), vec![size.clone()]);
        assert!(tagger.messages(1, 0, &[], Instant::now()).is_empty());
    }

    #[test]
    fn a_change_of_window_is_tagged_once() {
        let mut tagger = FocusTagger::default();
        let mut mv = Vec::new();
        encode_mouse_move(&mut mv, 1, 1);
        let out = tagger.messages(1, 2, &mv, Instant::now());
        assert_eq!(out.len(), 2);
        assert!(matches!(
            decode_input_event(&out[0]),
            Some(DecodedInput::WindowFocus { window: 2 })
        ));
        assert_eq!(out[1], mv);
        assert_eq!(
            tagger.messages(1, 2, &mv, Instant::now()),
            vec![mv.clone()],
            "no tag while unchanged"
        );
        // Back to window 0: tagged, since the box is now on 2.
        assert_eq!(tagger.messages(1, 0, &mv, Instant::now()).len(), 2);
        // Focus alone.
        let out = tagger.messages(1, 5, &[], Instant::now());
        assert_eq!(out.len(), 1);
        assert!(tagger.messages(1, 5, &[], Instant::now()).is_empty());
    }

    #[test]
    fn a_gamepad_does_not_take_focus_from_someone_typing() {
        let mut tagger = FocusTagger::default();
        let t0 = Instant::now();
        let mut key = Vec::new();
        encode_key_event(&mut key, true, 30);
        // Client 1 types into window 0; client 2's pad asks for window 4.
        tagger.messages(1, 0, &key, t0);
        assert!(tagger.messages(2, 4, &[], t0 + Duration::from_millis(500)).is_empty());
        // A second of quiet: it may.
        assert_eq!(tagger.messages(2, 4, &[], t0 + Duration::from_millis(1100)).len(), 1);
        // Asking for the window that has focus changes nothing.
        assert!(tagger.messages(2, 4, &[], t0 + Duration::from_millis(1200)).is_empty());
        // The typist's own pad is not held back by its own typing.
        tagger.messages(1, 4, &key, t0 + Duration::from_millis(1300));
        assert_eq!(tagger.messages(1, 0, &[], t0 + Duration::from_millis(1310)).len(), 1);
    }

    #[test]
    fn a_window_resize_is_rewritten_except_for_window_zero() {
        let mut tagger = FocusTagger::default();
        let mut size = Vec::new();
        encode_output_size(&mut size, 1280, 720);
        let out = tagger.messages(1, 3, &size, Instant::now());
        assert_eq!(
            out.len(),
            1,
            "a resize carries its window and moves no focus"
        );
        assert!(matches!(
            decode_input_event(&out[0]),
            Some(DecodedInput::WindowOutputSize {
                window: 3,
                width: 1280,
                height: 720
            })
        ));
    }
}
