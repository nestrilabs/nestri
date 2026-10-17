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
//! codec every client decodes, the bitrate), so it is told again: the latest
//! command of each type, then a keyframe request. A keyframe request for one
//! client goes only to the encoder of the window that client is shown. The first encoder is not: every
//! command before it went to the shared socket, which reached it, and
//! repeating a codec change to an encoder already on that codec would restart
//! its stream for nothing. A box with one game therefore gets exactly the
//! commands it always did.

use std::collections::BTreeSet;
use std::path::PathBuf;

use nesprotocol::MSG_IDR_REQUEST;

/// Marks a hub-internal command meant for one encoder: `[TO_ENCODER][4B pid]
/// [command]`. Stripped before anything is sent; never leaves the hub.
const TO_ENCODER: u8 = 0xF0;

/// `cmd` for the encoder in `pid` alone, or for every encoder when `None`.
pub fn to_encoder(pid: Option<u32>, cmd: &[u8]) -> Vec<u8> {
    match pid {
        Some(pid) => {
            let mut out = Vec::with_capacity(5 + cmd.len());
            out.push(TO_ENCODER);
            out.extend_from_slice(&pid.to_le_bytes());
            out.extend_from_slice(cmd);
            out
        }
        None => cmd.to_vec(),
    }
}

/// A keyframe request for the encoder in `pid`, or every encoder.
pub fn keyframe_request(pid: Option<u32>) -> Vec<u8> {
    to_encoder(pid, &[MSG_IDR_REQUEST])
}

/// Split a queued command into its target and the command itself.
pub fn target_of(cmd: Vec<u8>) -> (Option<u32>, Vec<u8>) {
    if cmd.len() >= 5 && cmd[0] == TO_ENCODER {
        let pid = u32::from_le_bytes([cmd[1], cmd[2], cmd[3], cmd[4]]);
        (Some(pid), cmd[5..].to_vec())
    } else {
        (None, cmd)
    }
}

#[derive(Debug, Default)]
pub struct Fanout {
    encoders: BTreeSet<u32>,
    /// The latest command of each type, in the order they were last sent.
    history: Vec<Vec<u8>>,
    /// Whether any encoder has been known: only the very first is spared the
    /// replay, since only it was reached by the shared socket.
    ever_known: bool,
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

    /// Where a command for `target` goes: that encoder alone when it is
    /// known, otherwise wherever an untargeted one would.
    pub fn destinations_for(&self, target: Option<u32>) -> Vec<PathBuf> {
        match target {
            Some(pid) if self.encoders.contains(&pid) => {
                vec![PathBuf::from(nesprotocol::capture_cmd_socket(pid))]
            }
            _ => self.destinations(),
        }
    }

    /// Record a command as sent to every encoder, so a later one can be told
    /// it. Only the latest of each type is kept.
    pub fn sent(&mut self, cmd: &[u8]) {
        let Some(&kind) = cmd.first() else {
            return;
        };
        if kind == MSG_IDR_REQUEST {
            return;
        }
        self.history.retain(|c| c[0] != kind);
        self.history.push(cmd.to_vec());
    }

    /// A frame came from `pid`. Returns what to send it if it is new to the
    /// hub (or was forgotten), `None` if it was known.
    pub fn encoder(&mut self, pid: u32) -> Option<Vec<Vec<u8>>> {
        if !self.encoders.insert(pid) {
            return None;
        }
        if !std::mem::replace(&mut self.ever_known, true) {
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

/// Whether a send error means the encoder's process is gone, rather than a
/// passing condition (a full buffer) that the next command may not meet.
pub fn encoder_is_gone(e: &std::io::Error) -> bool {
    matches!(
        e.kind(),
        std::io::ErrorKind::ConnectionRefused | std::io::ErrorKind::NotFound
    )
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
    fn a_later_encoder_hears_the_latest_of_each_type_then_a_keyframe_request() {
        let mut f = Fanout::default();
        f.sent(SETTINGS);
        f.encoder(10);
        f.sent(&[MSG_IDR_REQUEST]);
        let caps = [nesprotocol::MSG_CLIENT_CAPS, 1];
        let bitrate = [nesprotocol::MSG_ENCODE_SETTINGS, 9];
        f.sent(&caps);
        f.sent(&bitrate);
        assert_eq!(
            f.encoder(20),
            Some(vec![caps.to_vec(), bitrate.to_vec(), vec![MSG_IDR_REQUEST]])
        );
        assert_eq!(f.destinations().len(), 2);
        f.forget(10);
        assert_eq!(
            f.destinations(),
            vec![PathBuf::from("/tmp/nescapture-cmd-20.sock")]
        );
        // Forgotten, then heard from again: learnt again, and told again.
        assert_eq!(f.encoder(10).map(|r| r.len()), Some(3));
    }

    #[test]
    fn a_targeted_command_goes_to_its_encoder_alone() {
        let mut f = Fanout::default();
        f.encoder(10);
        f.encoder(20);
        let (target, cmd) = target_of(keyframe_request(Some(20)));
        assert_eq!(cmd, vec![MSG_IDR_REQUEST]);
        assert_eq!(
            f.destinations_for(target),
            vec![PathBuf::from("/tmp/nescapture-cmd-20.sock")]
        );
        // Unknown target, or none: everyone.
        assert_eq!(f.destinations_for(Some(30)).len(), 2);
        assert_eq!(target_of(keyframe_request(None)), (None, vec![MSG_IDR_REQUEST]));
        assert!(encoder_is_gone(&std::io::Error::from(std::io::ErrorKind::ConnectionRefused)));
        assert!(!encoder_is_gone(&std::io::Error::from(std::io::ErrorKind::WouldBlock)));
    }

    #[test]
    fn a_second_encoder_before_any_command_gets_a_keyframe_request() {
        let mut f = Fanout::default();
        assert_eq!(f.encoder(10), Some(vec![]));
        assert_eq!(f.encoder(11), Some(vec![vec![MSG_IDR_REQUEST]]));
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
