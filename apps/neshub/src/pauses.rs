//! Who has paused which encoder, ref(d-0087).
//!
//! A pause is a client's, not an encoder's: two clients can be shown the same
//! window, and one pausing it must not freeze the other's picture. So the hub
//! keeps, for each encoder, the set of sessions pausing it, and the encoder is
//! stopped only while that set is not empty. A session leaving (its
//! connection ending, a resubscribe, the primary picture moving) releases its
//! pause, so a pause can never outlive the client that asked for it.
//!
//! Keyed by the session's gamepad number, which is never reused within a hub's
//! lifetime, so a client that reconnects is a new session and cannot release
//! the pause of the one it replaced, or the other way round.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};

use tokio::sync::mpsc::UnboundedSender;

use crate::capture_cmd::{window_pause, window_resume};

#[derive(Debug, Default)]
pub struct PauseBook {
    /// The encoder each pausing session paused. One at a time per session.
    paused_by: BTreeMap<u32, u32>,
    /// Sessions that have gone. Set under the same lock that records pauses,
    /// so a pause that a still-running reader makes after its session was
    /// dropped finds it shut and does nothing, rather than holding an encoder
    /// that nobody is left to resume.
    closed: BTreeSet<u32>,
}

impl PauseBook {
    fn users(&self, pid: u32) -> BTreeSet<u32> {
        self.paused_by
            .iter()
            .filter(|(_, p)| **p == pid)
            .map(|(s, _)| *s)
            .collect()
    }

    /// `session` pauses `pid`. The commands to send, in order.
    fn pause(&mut self, session: u32, pid: u32) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        if self.closed.contains(&session) {
            return out;
        }
        if self.paused_by.get(&session) == Some(&pid) {
            return out;
        }
        // Moving from one encoder to another releases the first.
        out.extend(self.release(session));
        let first = self.users(pid).is_empty();
        self.paused_by.insert(session, pid);
        if first {
            out.push(window_pause(Some(pid)));
        }
        out
    }

    /// `session` stops pausing. Resumes the encoder it paused, and only that
    /// one, and only when no other session still pauses it.
    fn release(&mut self, session: u32) -> Vec<Vec<u8>> {
        let Some(pid) = self.paused_by.remove(&session) else {
            return Vec::new();
        };
        if self.users(pid).is_empty() {
            vec![window_resume(Some(pid))]
        } else {
            Vec::new()
        }
    }

    /// The session is gone: release what it paused and refuse any more.
    fn close(&mut self, session: u32) -> Vec<Vec<u8>> {
        self.closed.insert(session);
        self.release(session)
    }

    pub fn paused(&self, pid: u32) -> bool {
        !self.users(pid).is_empty()
    }
}

/// One session's way of pausing and resuming, shared with its control reader.
#[derive(Clone)]
pub struct PauseHandle {
    book: Arc<Mutex<PauseBook>>,
    session: u32,
    cmd_tx: UnboundedSender<Vec<u8>>,
}

impl PauseHandle {
    pub fn new(book: Arc<Mutex<PauseBook>>, session: u32, cmd_tx: UnboundedSender<Vec<u8>>) -> Self {
        Self { book, session, cmd_tx }
    }

    fn send(&self, cmds: Vec<Vec<u8>>) {
        for c in cmds {
            let _ = self.cmd_tx.send(c);
        }
    }

    /// Pause `pid` for this session. `pid` is the encoder it is shown, which
    /// is never 0 here: the caller does not pause what it cannot name.
    pub fn pause(&self, pid: u32) {
        let cmds = self.book.lock().unwrap_or_else(|e| e.into_inner()).pause(self.session, pid);
        self.send(cmds);
    }

    /// Resume what this session paused. Never anything else, and nothing at
    /// all when it paused nothing.
    pub fn resume(&self) {
        self.release();
    }

    /// The session is being dropped: release its pause and refuse any pause a
    /// reader that is still running makes after this.
    pub fn close(&self) {
        let cmds = self.book.lock().unwrap_or_else(|e| e.into_inner()).close(self.session);
        self.send(cmds);
    }

    /// Let go of whatever this session paused: it is leaving, or looking at
    /// another picture.
    pub fn release(&self) {
        let cmds = self.book.lock().unwrap_or_else(|e| e.into_inner()).release(self.session);
        self.send(cmds);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rig() -> (Arc<Mutex<PauseBook>>, UnboundedSender<Vec<u8>>, tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>) {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        (Arc::new(Mutex::new(PauseBook::default())), tx, rx)
    }

    fn sent(rx: &mut tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>) -> Vec<Vec<u8>> {
        std::iter::from_fn(|| rx.try_recv().ok()).collect()
    }

    #[test]
    fn one_of_two_sessions_pausing_a_shared_encoder_pauses_it_until_both_let_go() {
        let (book, tx, mut rx) = rig();
        let a = PauseHandle::new(book.clone(), 1, tx.clone());
        let b = PauseHandle::new(book.clone(), 2, tx);
        a.pause(10);
        assert_eq!(sent(&mut rx), vec![window_pause(Some(10))]);
        // B pauses too: the encoder is already stopped, nothing to send.
        b.pause(10);
        assert!(sent(&mut rx).is_empty());
        // A resumes, B still pauses: the encoder stays stopped.
        a.resume();
        assert!(sent(&mut rx).is_empty());
        assert!(book.lock().unwrap().paused(10));
        b.resume();
        assert_eq!(sent(&mut rx), vec![window_resume(Some(10))]);
        assert!(!book.lock().unwrap().paused(10));
    }

    #[test]
    fn a_session_that_never_paused_resumes_nothing() {
        let (book, tx, mut rx) = rig();
        let a = PauseHandle::new(book.clone(), 1, tx.clone());
        let b = PauseHandle::new(book, 2, tx);
        a.pause(10);
        sent(&mut rx);
        // B, shown the same window, did not pause it: its resume must not
        // start the encoder A stopped.
        b.resume();
        b.release();
        assert!(sent(&mut rx).is_empty());
    }

    #[test]
    fn a_session_that_goes_while_paused_resumes_the_encoder() {
        let (book, tx, mut rx) = rig();
        let a = PauseHandle::new(book.clone(), 1, tx);
        a.pause(10);
        sent(&mut rx);
        a.release(); // what its drop does
        assert_eq!(sent(&mut rx), vec![window_resume(Some(10))]);
        // Releasing twice is not resuming twice.
        a.release();
        assert!(sent(&mut rx).is_empty());
    }

    #[test]
    fn a_resubscribe_while_paused_releases_the_old_encoder_only() {
        let (book, tx, mut rx) = rig();
        let a = PauseHandle::new(book.clone(), 1, tx.clone());
        let other = PauseHandle::new(book.clone(), 2, tx);
        a.pause(10);
        other.pause(20);
        sent(&mut rx);
        a.release(); // restart_picture on moving to another window
        assert_eq!(sent(&mut rx), vec![window_resume(Some(10))]);
        assert!(book.lock().unwrap().paused(20), "someone else's pause is untouched");
    }

    #[test]
    fn a_pause_after_the_session_is_closed_is_a_no_op() {
        let (book, tx, mut rx) = rig();
        let a = PauseHandle::new(book.clone(), 1, tx);
        a.pause(10);
        sent(&mut rx);
        a.close();
        assert_eq!(sent(&mut rx), vec![window_resume(Some(10))]);
        // The control reader, still running on another thread, pauses again.
        a.pause(10);
        assert!(sent(&mut rx).is_empty());
        assert!(!book.lock().unwrap().paused(10));
    }

    #[test]
    fn releasing_without_closing_still_allows_a_later_pause() {
        let (book, tx, mut rx) = rig();
        let a = PauseHandle::new(book, 1, tx);
        a.pause(10);
        a.release();
        sent(&mut rx);
        a.pause(20);
        assert_eq!(sent(&mut rx), vec![window_pause(Some(20))]);
    }

    #[test]
    fn pausing_another_encoder_moves_the_pause() {
        let (book, tx, mut rx) = rig();
        let a = PauseHandle::new(book, 1, tx);
        a.pause(10);
        a.pause(20);
        assert_eq!(
            sent(&mut rx),
            vec![window_pause(Some(10)), window_resume(Some(10)), window_pause(Some(20))]
        );
    }
}
