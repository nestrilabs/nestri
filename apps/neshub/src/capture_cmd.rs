//! Where commands for the encoders go, ref(d-0085).
//!
//! Every game in the box runs an encoder of its own, listening on a socket
//! named for its process. The hub learns an encoder's process id from the
//! first frame it tags, and from then on sends every command to every encoder
//! it knows. Until it knows one, commands go to the shared socket, exactly as
//! they did when a box had one encoder: that is the path for an encoder that
//! predates tagging, and for every command sent before the first frame.
//!
//! An encoder that turns up later has missed what the others were told (the
//! codec every client decodes, the bitrate), so it is told again: the commands
//! so far, in order, then a keyframe request. The first encoder is not: every
//! command before it went to the shared socket, which reached it, and
//! repeating a codec change to an encoder already on that codec would restart
//! its stream for nothing. A box with one game therefore gets exactly the
//! commands it always did.

use std::collections::BTreeSet;
use std::path::PathBuf;

use nesprotocol::MSG_IDR_REQUEST;

/// Commands kept for an encoder that arrives late. A handful in practice: the
/// codec, the bitrate, a control mode.
const HISTORY: usize = 16;

#[derive(Debug, Default)]
pub struct Fanout {
    encoders: BTreeSet<u32>,
    history: Vec<Vec<u8>>,
}

impl Fanout {
    /// Where a command goes now: every known encoder's own socket, or the
    /// shared one while none is known.
    pub fn destinations(&self) -> Vec<PathBuf> {
        if self.encoders.is_empty() {
            return vec![PathBuf::from(nesprotocol::CAPTURE_CMD_SOCKET)];
        }
        self.encoders
            .iter()
            .map(|pid| PathBuf::from(nesprotocol::capture_cmd_socket(*pid)))
            .collect()
    }

    /// Record a command as sent, so a later encoder can be told it.
    pub fn sent(&mut self, cmd: &[u8]) {
        if cmd.first() == Some(&MSG_IDR_REQUEST) || cmd.is_empty() {
            return;
        }
        if self.history.last().is_some_and(|last| last == cmd) {
            return;
        }
        if self.history.len() == HISTORY {
            self.history.remove(0);
        }
        self.history.push(cmd.to_vec());
    }

    /// A frame came from `pid`. Returns what to send it if it is new to the
    /// hub, `None` if it was known.
    pub fn encoder(&mut self, pid: u32) -> Option<Vec<Vec<u8>>> {
        let first = self.encoders.is_empty();
        if !self.encoders.insert(pid) {
            return None;
        }
        if first {
            return Some(Vec::new());
        }
        let mut replay = self.history.clone();
        replay.push(vec![MSG_IDR_REQUEST]);
        Some(replay)
    }

    /// The encoder in `pid` has gone: its socket refuses.
    pub fn forget(&mut self, pid: u32) {
        self.encoders.remove(&pid);
    }
}

/// The process id in an encoder's own socket path.
pub fn pid_of(path: &std::path::Path) -> Option<u32> {
    path.file_name()?
        .to_str()?
        .strip_prefix("nescapture-cmd-")?
        .strip_suffix(".sock")?
        .parse()
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SETTINGS: &[u8] = &[nesprotocol::MSG_ENCODE_SETTINGS, 1, 2, 3];

    #[test]
    fn one_untagged_encoder_is_the_shared_socket_as_before() {
        let mut f = Fanout::default();
        assert_eq!(
            f.destinations(),
            vec![PathBuf::from("/tmp/nescapture-cmd.sock")]
        );
        f.sent(SETTINGS);
        assert_eq!(
            f.destinations(),
            vec![PathBuf::from("/tmp/nescapture-cmd.sock")]
        );
    }

    #[test]
    fn the_first_encoder_is_not_told_twice() {
        let mut f = Fanout::default();
        f.sent(SETTINGS);
        assert_eq!(f.encoder(10), Some(vec![]));
        assert_eq!(f.encoder(10), None);
        assert_eq!(
            f.destinations(),
            vec![PathBuf::from("/tmp/nescapture-cmd-10.sock")]
        );
    }

    #[test]
    fn a_later_encoder_hears_what_it_missed_then_a_keyframe_request() {
        let mut f = Fanout::default();
        f.sent(SETTINGS);
        f.encoder(10);
        f.sent(&[MSG_IDR_REQUEST]);
        let bitrate = [nesprotocol::MSG_ENCODE_SETTINGS, 9];
        f.sent(&bitrate);
        f.sent(&bitrate);
        assert_eq!(
            f.encoder(20),
            Some(vec![
                SETTINGS.to_vec(),
                bitrate.to_vec(),
                vec![MSG_IDR_REQUEST]
            ])
        );
        assert_eq!(f.destinations().len(), 2);
        f.forget(10);
        assert_eq!(
            f.destinations(),
            vec![PathBuf::from("/tmp/nescapture-cmd-20.sock")]
        );
    }

    #[test]
    fn a_second_encoder_before_any_command_gets_a_keyframe_request() {
        let mut f = Fanout::default();
        assert_eq!(f.encoder(10), Some(vec![]));
        assert_eq!(f.encoder(11), Some(vec![vec![MSG_IDR_REQUEST]]));
    }

    #[test]
    fn history_is_bounded() {
        let mut f = Fanout::default();
        for i in 0..100u8 {
            f.sent(&[nesprotocol::MSG_ENCODE_SETTINGS, i]);
        }
        f.encoder(1);
        assert_eq!(f.encoder(2).unwrap().len(), HISTORY + 1);
    }

    #[test]
    fn pid_from_path() {
        assert_eq!(
            pid_of(std::path::Path::new("/tmp/nescapture-cmd-42.sock")),
            Some(42)
        );
        assert_eq!(
            pid_of(std::path::Path::new("/tmp/nescapture-cmd.sock")),
            None
        );
    }
}
