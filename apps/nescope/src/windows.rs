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

use std::collections::HashMap;

use nesprotocol::window::{WindowEvent, WindowId, encode_event_message, encode_window_pid};

/// One window as the hub knows it.
#[derive(Debug, Clone)]
pub struct Tracked<K> {
    pub key: K,
    pub id: WindowId,
    pub pid: Option<u32>,
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
    pub title: String,
    pub app_id: String,
    pub size: (u16, u16),
}

impl<K: PartialEq + Clone> Registry<K> {
    /// Give a newly mapped window an id, and return the messages that tell the
    /// hub. `None` for a window that already has one, or when ids have run
    /// out for this run.
    pub fn open(
        &mut self,
        key: K,
        new: NewWindow,
        launch_of: impl Fn(u32) -> Option<String>,
    ) -> Option<Vec<Vec<u8>>> {
        if self.id_of(&key).is_some() {
            return None;
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

    /// A window went. The message for the hub, if it had an id.
    pub fn close(&mut self, key: &K) -> Option<Vec<u8>> {
        let at = self.windows.iter().position(|w| w.key == *key)?;
        let gone = self.windows.remove(at);
        tracing::info!(window = gone.id, "window closed");
        let mut m = Vec::new();
        encode_event_message(&mut m, &WindowEvent::Closed { window: gone.id });
        Some(m)
    }

    /// A window's title is `title` now. The message for the hub if it changed.
    pub fn retitle(&mut self, key: &K, title: &str) -> Option<Vec<u8>> {
        let w = self.windows.iter_mut().find(|w| w.key == *key)?;
        if w.title == title {
            return None;
        }
        w.title = title.to_string();
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
            .flat_map(|w| announce(w, size))
            .collect()
    }

    pub fn id_of(&self, key: &K) -> Option<WindowId> {
        self.windows.iter().find(|w| w.key == *key).map(|w| w.id)
    }

    pub fn key_of(&self, id: WindowId) -> Option<&K> {
        self.windows.iter().find(|w| w.id == id).map(|w| &w.key)
    }
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
    out
}

/// Read a process's `NESTRI_LAUNCH_ID`, which the launch put in its
/// environment and its children inherit.
pub fn launch_of_process(pid: u32) -> Option<String> {
    let environ = std::fs::read(format!("/proc/{pid}/environ")).ok()?;
    environ
        .split(|b| *b == 0)
        .find_map(|kv| kv.strip_prefix(b"NESTRI_LAUNCH_ID="))
        .and_then(|v| String::from_utf8(v.to_vec()).ok())
}

/// Which window input is for, and what size each window's client asked for.
///
/// The hub tags input with focus messages; until it sends one, and again
/// after every reconnect, input is window `0`'s, which is what a hub that
/// predates tags means. With one output for every window, a window's size
/// request is applied while that window has focus and remembered otherwise.
#[derive(Debug, Default)]
pub struct WindowInput {
    current: WindowId,
    sizes: HashMap<WindowId, (u16, u16)>,
}

impl WindowInput {
    /// The input connection is new: back to window `0`.
    pub fn reset(&mut self) {
        self.current = 0;
    }

    pub fn current(&self) -> WindowId {
        self.current
    }

    /// `window`'s client is `width`x`height`. The size to apply now, if any.
    pub fn size(&mut self, window: WindowId, width: u16, height: u16) -> Option<(u16, u16)> {
        self.sizes.insert(window, (width, height));
        (window == self.current).then_some((width, height))
    }

    /// Input from here on is `window`'s. `None` if it already was; otherwise
    /// the size its client last asked for, to apply now if there is one.
    pub fn focus(&mut self, window: WindowId) -> Option<Option<(u16, u16)>> {
        if window == self.current {
            return None;
        }
        self.current = window;
        Some(self.sizes.get(&window).copied())
    }

    pub fn forget(&mut self, window: WindowId) {
        self.sizes.remove(&window);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nesprotocol::window::{MSG_WINDOW_PID, decode_window_pid};

    fn new(pid: Option<u32>, title: &str) -> NewWindow {
        NewWindow {
            pid,
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
    fn input_follows_focus_tags_and_starts_on_window_zero() {
        let mut i = WindowInput::default();
        // A hub that predates tags: every resize is window 0's, applied.
        assert_eq!(i.size(0, 1280, 720), Some((1280, 720)));
        // Another window's resize waits for its focus.
        assert_eq!(i.size(3, 800, 600), None);
        assert_eq!(i.focus(3), Some(Some((800, 600))));
        assert_eq!(i.focus(3), None);
        assert_eq!(i.size(3, 1024, 768), Some((1024, 768)));
        assert_eq!(i.focus(0), Some(Some((1280, 720))));
        assert_eq!(i.focus(5), Some(None));
        i.reset();
        assert_eq!(i.current(), 0);
    }
}
