//! Window ids and what the hub is told about each window, ref(d-0085).
//!
//! Every toplevel gets an id when it is first mapped: `0` for the first window
//! of this compositor, then counting up, never reused, and none past 65,535.
//! The hub hears each window's lifecycle on the input socket in nesprotocol's
//! window encoding, and which process owns it, which is how it joins an
//! encoder's frames (tagged with its process) to the window they draw.
//!
//! This module holds no compositor objects beyond an opaque key, so the rules
//! can be tested without one.


use nesprotocol::window::{WindowEvent, WindowId, encode_event_message, encode_window_pid};

/// One window as the hub knows it.
#[derive(Debug, Clone)]
pub struct Tracked<K> {
    pub key: K,
    pub id: WindowId,
    pub pid: Option<u32>,
    /// The X11 window id, for a window Xwayland draws.
    native: Option<u32>,
    /// False while an X11 window is unmapped: the hub has been told it closed,
    /// and a map again opens it under the same id.
    mapped: bool,
    launch_id: String,
    title: String,
    app_id: String,
}

/// The windows this compositor has given ids to.
#[derive(Debug)]
pub struct Registry<K> {
    /// The next id to mint; past `u16::MAX` none are left.
    next: u32,
    windows: Vec<Tracked<K>>,
    refused: bool,
}

impl<K> Default for Registry<K> {
    fn default() -> Self {
        Self {
            next: 0,
            windows: Vec::new(),
            refused: false,
        }
    }
}

/// What the compositor knows about a window when it maps.
pub struct NewWindow {
    pub pid: Option<u32>,
    /// The X11 window id, for a window Xwayland draws.
    pub native: Option<u32>,
    pub title: String,
    pub app_id: String,
    pub size: (u16, u16),
}

impl<K: PartialEq + Clone> Registry<K> {
    /// Give a newly mapped window an id, and return the messages that tell the
    /// hub. A window unmapped earlier is opened again under its old id. `None`
    /// for a window that is already open, or when ids have run out for this
    /// run.
    pub fn open(
        &mut self,
        key: K,
        new: NewWindow,
        launch_of: impl Fn(u32) -> Option<String>,
    ) -> Option<Vec<Vec<u8>>> {
        if let Some(w) = self.windows.iter_mut().find(|w| w.key == key) {
            if w.mapped {
                return None;
            }
            w.mapped = true;
            w.pid = new.pid.or(w.pid);
            w.native = new.native.or(w.native);
            w.title = new.title;
            w.app_id = new.app_id;
            tracing::info!(window = w.id, "window opened again");
            return Some(announce(w, new.size));
        }
        let Ok(id) = WindowId::try_from(self.next) else {
            if !self.refused {
                tracing::error!("this compositor has minted every window id; refusing new windows");
                self.refused = true;
            }
            return None;
        };
        self.next += 1;
        let launch_id = new.pid.and_then(launch_of).unwrap_or_default();
        let tracked = Tracked {
            key,
            id,
            pid: new.pid,
            native: new.native,
            mapped: true,
            launch_id,
            title: new.title,
            app_id: new.app_id,
        };
        let messages = announce(&tracked, new.size);
        tracing::info!(
            window = id,
            pid = ?tracked.pid,
            launch = %tracked.launch_id,
            app_id = %tracked.app_id,
            "window opened"
        );
        self.windows.push(tracked);
        Some(messages)
    }

    /// A window went for good. The message for the hub, if it was open.
    pub fn close(&mut self, key: &K) -> Option<Vec<u8>> {
        let at = self.windows.iter().position(|w| w.key == *key)?;
        let gone = self.windows.remove(at);
        tracing::info!(window = gone.id, "window closed");
        gone.mapped.then(|| closed(gone.id))
    }

    /// An X11 window was unmapped: closed for the hub, but its id is kept for
    /// when it is mapped again.
    pub fn unmap(&mut self, key: &K) -> Option<Vec<u8>> {
        let w = self.windows.iter_mut().find(|w| w.key == *key)?;
        if !w.mapped {
            return None;
        }
        w.mapped = false;
        tracing::info!(window = w.id, "window unmapped");
        Some(closed(w.id))
    }

    /// A window's title is `title` now. The message for the hub if it changed.
    pub fn retitle(&mut self, key: &K, title: &str) -> Option<Vec<u8>> {
        let w = self.windows.iter_mut().find(|w| w.key == *key)?;
        if w.title == title {
            return None;
        }
        w.title = title.to_string();
        if !w.mapped {
            return None;
        }
        let mut m = Vec::new();
        encode_event_message(
            &mut m,
            &WindowEvent::Title {
                window: w.id,
                title: w.title.clone(),
            },
        );
        Some(m)
    }

    /// Every window is now `size`: one output, which every window fills.
    pub fn resize_all(&self, size: (u16, u16)) -> Vec<Vec<u8>> {
        self.windows
            .iter()
            .filter(|w| w.mapped)
            .map(|w| {
                let mut m = Vec::new();
                encode_event_message(
                    &mut m,
                    &WindowEvent::Size {
                        window: w.id,
                        width: size.0,
                        height: size.1,
                    },
                );
                m
            })
            .collect()
    }

    /// Everything the hub needs to know of every window, for a hub that has
    /// just connected.
    pub fn announce_all(&self, size: (u16, u16)) -> Vec<Vec<u8>> {
        self.windows
            .iter()
            .filter(|w| w.mapped)
            .flat_map(|w| announce(w, size))
            .collect()
    }

    pub fn id_of(&self, key: &K) -> Option<WindowId> {
        self.windows.iter().find(|w| w.key == *key).map(|w| w.id)
    }

    pub fn key_of(&self, id: WindowId) -> Option<&K> {
        self.windows
            .iter()
            .find(|w| w.id == id && w.mapped)
            .map(|w| &w.key)
    }
}

fn closed(window: WindowId) -> Vec<u8> {
    let mut m = Vec::new();
    encode_event_message(&mut m, &WindowEvent::Closed { window });
    m
}

fn announce<K>(w: &Tracked<K>, size: (u16, u16)) -> Vec<Vec<u8>> {
    let mut out = Vec::with_capacity(2);
    let mut m = Vec::new();
    encode_event_message(
        &mut m,
        &WindowEvent::Opened {
            window: w.id,
            width: size.0,
            height: size.1,
            launch_id: w.launch_id.clone(),
            title: w.title.clone(),
            app_id: w.app_id.clone(),
        },
    );
    out.push(m);
    if let Some(pid) = w.pid {
        let mut m = Vec::new();
        encode_window_pid(&mut m, w.id, pid);
        out.push(m);
    }
    // A capture layer names frames by the X11 window they were drawn for when
    // it knows it, marked by WINDOW_SOURCE_BIT, so a process drawing several
    // windows streams each as its own.
    if let Some(native) = w.native {
        let mut m = Vec::new();
        encode_window_pid(&mut m, w.id, WINDOW_SOURCE_BIT | native);
        out.push(m);
    }
    out
}

/// Marks a capture source as an X11 window rather than a process. Process ids
/// stay far below it.
pub const WINDOW_SOURCE_BIT: u32 = 0x8000_0000;

/// Read a process's `NESTRI_LAUNCH_ID`, which the launch put in its
/// environment and its children inherit.
pub fn launch_of_process(pid: u32) -> Option<String> {
    let environ = std::fs::read(format!("/proc/{pid}/environ")).ok()?;
    environ
        .split(|b| *b == 0)
        .find_map(|kv| kv.strip_prefix(b"NESTRI_LAUNCH_ID="))
        .and_then(|v| String::from_utf8(v.to_vec()).ok())
}

/// How long the output keeps the size one window gave it before another
/// window may change it.
pub const OUTPUT_HYSTERESIS: std::time::Duration = std::time::Duration::from_millis(500);

/// Which window input is for, and who may size the output.
///
/// The hub tags input with focus messages; until it sends one, and again
/// after every reconnect, input is window `0`'s, which is what a hub that
/// predates tags means. Focus moves keyboard and pointer input and nothing
/// else. With one output for every window, only an explicit size request from
/// the window that has focus changes it; when several windows ask, the last
/// writer wins, but not within [`OUTPUT_HYSTERESIS`] of another window's
/// change, so two clients of different sizes do not fight over it,
/// ref(d-0085).
#[derive(Debug, Default)]
pub struct WindowInput {
    current: WindowId,
    last_resize: Option<(WindowId, std::time::Instant)>,
}

impl WindowInput {
    /// The input connection is new: back to window `0`.
    pub fn reset(&mut self) {
        self.current = 0;
    }

    pub fn current(&self) -> WindowId {
        self.current
    }

    /// `window`'s client is `width`x`height`. The size to apply now, if any:
    /// only for the window that owns the output, and not within
    /// [`OUTPUT_HYSTERESIS`] of a change another window made.
    pub fn size(
        &mut self,
        window: WindowId,
        width: u16,
        height: u16,
        now: std::time::Instant,
    ) -> Option<(u16, u16)> {
        if window != self.current {
            return None;
        }
        if let Some((who, at)) = self.last_resize
            && who != window
            && now.duration_since(at) < OUTPUT_HYSTERESIS
        {
            return None;
        }
        self.last_resize = Some((window, now));
        Some((width, height))
    }

    /// Input from here on is `window`'s. Whether that is a change.
    pub fn focus(&mut self, window: WindowId) -> bool {
        if window == self.current {
            return false;
        }
        self.current = window;
        true
    }

    pub fn forget(&mut self, window: WindowId) {
        if self.last_resize.is_some_and(|(w, _)| w == window) {
            self.last_resize = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nesprotocol::window::{MSG_WINDOW_PID, decode_window_pid};

    fn new(pid: Option<u32>, title: &str) -> NewWindow {
        NewWindow {
            pid,
            native: None,
            title: title.into(),
            app_id: "app".into(),
            size: (1920, 1080),
        }
    }

    fn decode(m: &[u8]) -> WindowEvent {
        WindowEvent::decode(m[0], &m[1..]).expect("an event")
    }

    #[test]
    fn ids_start_at_zero_and_are_never_reused() {
        let mut r = Registry::<u32>::default();
        let launch = |pid: u32| Some(format!("launch_{pid}"));
        let a = r.open(10, new(Some(1), "a"), launch).unwrap();
        assert_eq!(
            decode(&a[0]),
            WindowEvent::Opened {
                window: 0,
                width: 1920,
                height: 1080,
                launch_id: "launch_1".into(),
                title: "a".into(),
                app_id: "app".into(),
            }
        );
        assert_eq!(a[1][0], MSG_WINDOW_PID);
        assert_eq!(decode_window_pid(&a[1][1..]), Some((0, 1)));
        assert!(
            r.open(10, new(Some(1), "a"), launch).is_none(),
            "once per window"
        );
        let b = r.open(11, new(None, "b"), launch).unwrap();
        assert_eq!(b.len(), 1, "no owner to name");
        assert_eq!(decode(&b[0]).window(), 1);
        assert_eq!(
            decode(&r.close(&10).unwrap()),
            WindowEvent::Closed { window: 0 }
        );
        assert!(r.close(&10).is_none());
        let c = r.open(12, new(None, "c"), launch).unwrap();
        assert_eq!(decode(&c[0]).window(), 2, "0 is not given out again");
        assert_eq!(r.key_of(2), Some(&12));
        assert_eq!(r.id_of(&11), Some(1));
    }

    #[test]
    fn ids_run_out_rather_than_wrap() {
        let mut r = Registry::<u32> {
            next: u32::from(u16::MAX),
            ..Default::default()
        };
        assert!(r.open(1, new(None, ""), |_| None).is_some());
        assert!(r.open(2, new(None, ""), |_| None).is_none());
        assert!(r.open(3, new(None, ""), |_| None).is_none());
    }

    #[test]
    fn titles_and_sizes() {
        let mut r = Registry::<u32>::default();
        r.open(1, new(None, "a"), |_| None);
        assert!(r.retitle(&1, "a").is_none(), "unchanged says nothing");
        assert_eq!(
            decode(&r.retitle(&1, "b").unwrap()),
            WindowEvent::Title {
                window: 0,
                title: "b".into()
            }
        );
        r.open(2, new(None, "c"), |_| None);
        let sizes: Vec<_> = r
            .resize_all((1280, 720))
            .iter()
            .map(|m| decode(m))
            .collect();
        assert_eq!(sizes.len(), 2);
        assert_eq!(
            sizes[1],
            WindowEvent::Size {
                window: 1,
                width: 1280,
                height: 720
            }
        );
        assert_eq!(r.announce_all((1, 1)).len(), 2);
    }

    #[test]
    fn an_unmapped_window_is_closed_for_the_hub_and_keeps_its_id() {
        let mut r = Registry::<u32>::default();
        let launch = |_: u32| None;
        r.open(7, new(Some(1), "a"), launch).unwrap();
        assert_eq!(decode(&r.unmap(&7).unwrap()), WindowEvent::Closed { window: 0 });
        assert!(r.unmap(&7).is_none());
        assert!(r.retitle(&7, "b").is_none(), "nothing to tell while closed");
        assert!(r.announce_all((1, 1)).is_empty());
        let again = r.open(7, new(Some(1), "c"), launch).unwrap();
        assert_eq!(decode(&again[0]).window(), 0);
        assert!(matches!(decode(&again[0]), WindowEvent::Opened { .. }));
        // Destroyed while unmapped: nothing more to say.
        r.unmap(&7);
        assert!(r.close(&7).is_none());
        assert_eq!(decode(&r.open(8, new(None, "d"), launch).unwrap()[0]).window(), 1);
    }

    #[test]
    fn focus_moves_input_only_and_sizing_is_the_focused_windows() {
        use std::time::{Duration, Instant};
        let t = Instant::now();
        let mut i = WindowInput::default();
        // A hub that predates tags: every resize is window 0's, applied.
        assert_eq!(i.size(0, 1280, 720, t), Some((1280, 720)));
        // Another window's resize is not applied, and not remembered.
        assert_eq!(i.size(3, 800, 600, t), None);
        assert!(i.focus(3));
        assert!(!i.focus(3));
        // Focus alone changed no size; the window must ask.
        // Within the hysteresis of window 0's change: held off.
        assert_eq!(i.size(3, 1024, 768, t + Duration::from_millis(100)), None);
        assert_eq!(
            i.size(3, 1024, 768, t + Duration::from_millis(500)),
            Some((1024, 768))
        );
        // The same window may resize at once.
        assert_eq!(
            i.size(3, 1100, 800, t + Duration::from_millis(510)),
            Some((1100, 800))
        );
        assert!(i.focus(0));
        assert_eq!(i.size(0, 640, 480, t + Duration::from_millis(600)), None);
        i.reset();
        assert_eq!(i.current(), 0);
    }
}
