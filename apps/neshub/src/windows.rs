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
//! encoding. That is the box's *primary* picture, the frames of the encoder
//! that has been drawing longest without a gap. With one game in the box it is
//! that game, whatever window id nescope gave it, and the bytes are the ones
//! the client always received.

use std::collections::{BTreeMap, HashMap};
use std::time::{Duration, Instant};

use nesprotocol::input::{
    INPUT_OUTPUT_SIZE, encode_window_focus, encode_window_output_size,
};
use nesprotocol::window::{WINDOW_DEFAULT, WindowEvent, WindowId};

/// Who drew a frame: an encoder's process id, or `None` for an encoder that
/// predates tagging, which is the box's first window.
pub type Source = Option<u32>;

/// How long the primary encoder may go without a frame before another one
/// takes its place for connections that never subscribed.
const PRIMARY_SILENCE: Duration = Duration::from_secs(1);

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
}

/// The box's windows, their owners, and which encoder is primary.
#[derive(Debug, Default)]
pub struct WindowTable {
    open: BTreeMap<WindowId, OpenWindow>,
    pids: HashMap<u32, WindowId>,
    /// Launch id of a process that drew but owns no window, read once.
    launch_of: HashMap<u32, Option<String>>,
    primary: Option<(Source, Instant)>,
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
            WindowEvent::Closed { window } => {
                self.open.remove(window);
                self.pids.retain(|_, w| w != window);
            }
        }
    }

    /// Window `window` is owned by process `pid`.
    pub fn bind_pid(&mut self, window: WindowId, pid: u32) {
        self.pids.insert(pid, window);
        self.launch_of.remove(&pid);
    }

    /// Every open window, as the events that tell a late subscriber about it.
    pub fn snapshot(&self) -> Vec<WindowEvent> {
        let mut out = Vec::new();
        for open in self.open.values() {
            out.push(open.opened.clone());
            out.extend(open.icon.clone());
        }
        out
    }

    /// The compositor went: forget everything, and say which windows closed.
    pub fn reset(&mut self) -> Vec<WindowId> {
        let closed = self.open.keys().copied().collect();
        *self = Self {
            primary: self.primary,
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
    pub fn resolve(
        &mut self,
        source: Source,
        launch_of: &dyn Fn(u32) -> Option<String>,
    ) -> Option<WindowId> {
        let Some(pid) = source else {
            return Some(WINDOW_DEFAULT);
        };
        if let Some(window) = self.pids.get(&pid) {
            return Some(*window);
        }
        let launch = self
            .launch_of
            .entry(pid)
            .or_insert_with(|| launch_of(pid).filter(|l| !l.is_empty()))
            .clone();
        if let Some(launch) = launch {
            let newest = self.open.iter().rev().find_map(|(id, w)| match &w.opened {
                WindowEvent::Opened { launch_id, .. } if *launch_id == launch => Some(*id),
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

    /// Note a frame from `source` and say whether it is the primary picture.
    ///
    /// The first encoder to draw is primary, and stays so while it keeps
    /// drawing. Once it has been silent for [`PRIMARY_SILENCE`] the next
    /// encoder to draw takes over.
    pub fn note_primary(&mut self, source: Source, now: Instant) -> bool {
        match self.primary {
            Some((current, last))
                if current != source && now.duration_since(last) < PRIMARY_SILENCE =>
            {
                false
            }
            _ => {
                self.primary = Some((source, now));
                true
            }
        }
    }

    /// The window the primary picture is, so input from a connection that
    /// never subscribed goes to it.
    pub fn primary_window(&mut self, launch_of: &dyn Fn(u32) -> Option<String>) -> WindowId {
        match self.primary {
            Some((source, _)) => self.resolve(source, launch_of).unwrap_or(WINDOW_DEFAULT),
            None => WINDOW_DEFAULT,
        }
    }
}

/// Read a process's `NESTRI_LAUNCH_ID`, if it has one and this process may
/// read its environment.
pub fn launch_of_process(pid: u32) -> Option<String> {
    let environ = std::fs::read(format!("/proc/{pid}/environ")).ok()?;
    environ
        .split(|b| *b == 0)
        .find_map(|kv| kv.strip_prefix(b"NESTRI_LAUNCH_ID="))
        .and_then(|v| String::from_utf8(v.to_vec()).ok())
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
}

impl FocusTagger {
    /// The messages to write for one input event from `window`. An empty
    /// event asks only for focus (a gamepad message, which goes to the box by
    /// another route, follows the focused window).
    pub fn messages(&mut self, window: WindowId, event: &[u8]) -> Vec<Vec<u8>> {
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

    fn no_launch(_: u32) -> Option<String> {
        None
    }

    #[test]
    fn an_untagged_encoder_is_window_zero() {
        let mut t = WindowTable::default();
        assert_eq!(t.resolve(None, &no_launch), Some(0));
        t.apply(&opened(0, "a"));
        t.apply(&opened(1, "b"));
        assert_eq!(t.resolve(None, &no_launch), Some(0));
    }

    #[test]
    fn a_tagged_encoder_is_the_window_its_process_owns() {
        let mut t = WindowTable::default();
        t.apply(&opened(0, "a"));
        t.apply(&opened(1, "b"));
        t.bind_pid(0, 100);
        t.bind_pid(1, 200);
        assert_eq!(t.resolve(Some(100), &no_launch), Some(0));
        assert_eq!(t.resolve(Some(200), &no_launch), Some(1));
        t.apply(&WindowEvent::Closed { window: 1 });
        // Its window gone, and another still open: nobody can say.
        assert_eq!(t.resolve(Some(200), &no_launch), None);
    }

    #[test]
    fn an_unknown_process_is_found_by_its_launch() {
        let mut t = WindowTable::default();
        t.apply(&opened(0, "steam"));
        t.apply(&opened(1, "launch_b"));
        t.apply(&opened(2, "launch_b"));
        let launch = |pid: u32| (pid == 300).then(|| "launch_b".to_string());
        assert_eq!(t.resolve(Some(300), &launch), Some(2), "the newest of its launch");
        assert_eq!(t.resolve(Some(301), &launch), None);
    }

    #[test]
    fn with_one_window_any_encoder_is_window_zero() {
        // One game, nescope that predates pid messages: as it always was.
        let mut t = WindowTable::default();
        assert_eq!(t.resolve(Some(4242), &no_launch), Some(0));
        t.apply(&opened(0, ""));
        assert_eq!(t.resolve(Some(4242), &no_launch), Some(0));
    }

    #[test]
    fn the_first_encoder_to_draw_is_primary_until_it_stops() {
        let mut t = WindowTable::default();
        let t0 = Instant::now();
        assert!(t.note_primary(Some(1), t0));
        assert!(!t.note_primary(Some(2), t0 + Duration::from_millis(10)));
        assert!(t.note_primary(Some(1), t0 + Duration::from_millis(500)));
        assert!(!t.note_primary(Some(2), t0 + Duration::from_millis(1400)));
        // Silent for a second: the other takes over.
        assert!(t.note_primary(Some(2), t0 + Duration::from_millis(1600)));
        assert!(!t.note_primary(Some(1), t0 + Duration::from_millis(1610)));
    }

    #[test]
    fn primary_window_follows_the_primary_encoder() {
        let mut t = WindowTable::default();
        assert_eq!(t.primary_window(&no_launch), 0);
        t.apply(&opened(0, "steam"));
        t.apply(&opened(1, "game"));
        t.bind_pid(1, 50);
        t.note_primary(Some(50), Instant::now());
        assert_eq!(t.primary_window(&no_launch), 1);
    }

    #[test]
    fn routing() {
        use Subscription::*;
        assert_eq!(route(Legacy, Some(3), true), Some(0), "old encoding for an old client");
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
        assert_eq!(tagger.messages(0, &key), vec![key.clone()]);
        assert_eq!(tagger.messages(0, &size), vec![size.clone()]);
        assert!(tagger.messages(0, &[]).is_empty());
    }

    #[test]
    fn a_change_of_window_is_tagged_once() {
        let mut tagger = FocusTagger::default();
        let mut mv = Vec::new();
        encode_mouse_move(&mut mv, 1, 1);
        let out = tagger.messages(2, &mv);
        assert_eq!(out.len(), 2);
        assert!(matches!(
            decode_input_event(&out[0]),
            Some(DecodedInput::WindowFocus { window: 2 })
        ));
        assert_eq!(out[1], mv);
        assert_eq!(tagger.messages(2, &mv), vec![mv.clone()], "no tag while unchanged");
        // Back to window 0: tagged, since the box is now on 2.
        assert_eq!(tagger.messages(0, &mv).len(), 2);
        // Focus alone.
        let out = tagger.messages(5, &[]);
        assert_eq!(out.len(), 1);
        assert!(tagger.messages(5, &[]).is_empty());
    }

    #[test]
    fn a_window_resize_is_rewritten_except_for_window_zero() {
        let mut tagger = FocusTagger::default();
        let mut size = Vec::new();
        encode_output_size(&mut size, 1280, 720);
        let out = tagger.messages(3, &size);
        assert_eq!(out.len(), 1, "a resize carries its window and moves no focus");
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
