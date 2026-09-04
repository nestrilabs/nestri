// The lifecycle layer of the control channel between a box and whatever runs
// it: the boot descriptor the guest is handed, and what the guest says back
// about carrying it out.
//
// It lives beside the media types for the same reason they live here — one
// definition, so the two ends cannot drift from each other silently.
//
// Nothing in this module describes *what* the guest runs. A command line, a
// set of share tags, an output geometry, and what an exit means: that is the
// whole vocabulary, and a field that only makes sense for one kind of workload
// does not belong in it. ref(d-0033)
//
// The channel also carries a second layer, which the guest relays as opaque
// bytes and never parses. Those types land with the relay that needs them.

use std::collections::BTreeMap;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

/// The vsock port the guest dials.
///
/// The guest dials out rather than being connected to, which is worth keeping
/// for two reasons: the listener is up before the VM starts, so nothing races a
/// booting kernel and nothing has to retry; and the connection establishing is
/// itself the liveness signal, without which a caller needs a timeout to tell a
/// slow boot from a dead one.
pub const CONTROL_PORT: u32 = 7000;

/// Version of this layer. Both ends compare it during the handshake and refuse
/// on mismatch, so a guest built against one version meeting a caller built
/// against another fails immediately and legibly, rather than later on a field
/// that turned out to be missing.
///
/// Adding a variant or a field does not need a bump; removing or renaming one
/// does.
pub const CONTROL_VERSION: u32 = 2;

/// The command to run, and who runs it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Exec {
    /// The program and its arguments. Never a shell string: a guest that splits
    /// words is a guest that can split them differently than the caller meant.
    pub argv: Vec<String>,
    /// Environment for the process. Sorted, so two descriptors that say the
    /// same thing serialize identically.
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// Working directory. `None` means the root of the guest filesystem.
    #[serde(default)]
    pub cwd: Option<String>,
    /// The uid and gid to drop to before exec.
    ///
    /// These are load-bearing rather than hygiene. Whoever writes this
    /// descriptor is also whoever exported the writable share, so the ids have
    /// to agree; when they do not, the share refuses the first write and the
    /// failure surfaces here as `EACCES` with a path, instead of as a workload
    /// that misbehaves much later for no visible reason.
    pub uid: u32,
    pub gid: u32,
}

/// One share to mount, named by tag.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Mount {
    /// The share's tag. Never a path on the other side of the channel — the
    /// guest learns nothing about the filesystem it is being handed a piece of.
    pub tag: String,
    /// Where it lands inside the guest.
    ///
    /// The caller names this, not the guest: choosing a mount point means
    /// knowing what the workload expects to find there, which is exactly the
    /// knowledge a workload-independent init does not have. ref(d-0033)
    pub at: String,
    #[serde(default)]
    pub ro: bool,
}

/// The output the compositor should produce.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Geometry {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    #[serde(default)]
    pub hdr: bool,
}

/// What the workload exiting means for the session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct OnExit {
    /// Whether the exit ends the session.
    ///
    /// This says what an exit *means*; it is not a restart policy. The guest
    /// reports the exit and stops, and starting something again is a new
    /// command from the caller — the only end that can see whether restarting
    /// is repair or a loop. ref(d-0033)
    pub terminal: bool,
}

/// Everything the guest is told at boot, in one document.
///
/// Sent once, immediately after the handshake, and read once. Deliberately not
/// a conversation: boot configuration is a document, and a document cannot
/// half-arrive.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BootDescriptor {
    pub exec: Exec,
    #[serde(default)]
    pub mounts: Vec<Mount>,
    pub geometry: Geometry,
    pub on_exit: OnExit,
}

/// How a workload ended.
///
/// Exactly one of these is set: a process that was signalled has no exit code,
/// and reporting `0` for one would make a kill look like a clean run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Exit {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub signal: Option<i32>,
}

impl Exit {
    pub fn code(code: i32) -> Self {
        Self {
            exit_code: Some(code),
            signal: None,
        }
    }

    pub fn signal(signal: i32) -> Self {
        Self {
            exit_code: None,
            signal: Some(signal),
        }
    }
}

/// What the guest says.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GuestToHost {
    /// First line on the connection, before anything else is read or written.
    Ready { protocol_version: u32 },
    /// The workload the descriptor named has ended. Terminal or not is the
    /// descriptor's answer, not this message's.
    WorkloadExited {
        #[serde(flatten)]
        exit: Exit,
    },
}

/// What the guest is told.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HostToGuest {
    /// The boot descriptor. One per connection.
    Boot {
        #[serde(flatten)]
        descriptor: Box<BootDescriptor>,
    },
    /// Stop the workload. Idempotent, and does not end the session.
    Stop,
    /// Shut the guest down.
    Shutdown,
}

/// Encode one message as a line, framing included.
///
/// Newline-delimited JSON: the channel is a byte stream, so it needs a frame,
/// and a frame a person can read in a log of the channel itself is worth more
/// here than a compact one.
pub fn to_line<T: Serialize>(message: &T) -> Result<String, serde_json::Error> {
    let mut line = serde_json::to_string(message)?;
    line.push('\n');
    Ok(line)
}

/// Decode one line. The trailing newline is optional, so a caller may pass what
/// a line-oriented reader handed it either way.
pub fn from_line<T: DeserializeOwned>(line: &str) -> Result<T, serde_json::Error> {
    serde_json::from_str(line.trim_end_matches(['\n', '\r']))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn descriptor() -> BootDescriptor {
        BootDescriptor {
            exec: Exec {
                argv: vec!["/usr/bin/true".into()],
                env: BTreeMap::from([("HOME".to_string(), "/mnt/user".to_string())]),
                cwd: Some("/mnt/user".into()),
                uid: 1000,
                gid: 1000,
            },
            mounts: vec![Mount {
                tag: "install".into(),
                at: "/mnt/install".into(),
                ro: true,
            }],
            geometry: Geometry {
                width: 1920,
                height: 1080,
                fps: 60,
                hdr: false,
            },
            on_exit: OnExit { terminal: true },
        }
    }

    #[test]
    fn a_line_round_trips() {
        let line = to_line(&HostToGuest::Boot {
            descriptor: Box::new(descriptor()),
        })
        .unwrap();
        assert!(line.ends_with('\n'), "a line has to carry its own frame");
        assert!(!line.trim_end().contains('\n'), "one message is one line");

        let back: HostToGuest = from_line(&line).unwrap();
        assert_eq!(
            back,
            HostToGuest::Boot {
                descriptor: Box::new(descriptor())
            }
        );
    }

    #[test]
    fn a_signalled_exit_is_not_a_zero_exit() {
        let signalled = to_line(&GuestToHost::WorkloadExited {
            exit: Exit::signal(9),
        })
        .unwrap();
        assert!(
            !signalled.contains("exit_code"),
            "a signalled workload has no exit code: {signalled}"
        );

        let clean = to_line(&GuestToHost::WorkloadExited {
            exit: Exit::code(0),
        })
        .unwrap();
        assert!(
            !clean.contains("signal"),
            "a clean exit was not signalled: {clean}"
        );
    }

    #[test]
    fn defaults_cover_what_a_caller_may_leave_out() {
        let json = r#"{"exec":{"argv":["/bin/sh"],"uid":1000,"gid":1000},
                       "geometry":{"width":1280,"height":720,"fps":30},
                       "on_exit":{"terminal":false}}"#;
        let parsed: BootDescriptor = from_line(json).unwrap();
        assert!(parsed.mounts.is_empty());
        assert!(parsed.exec.env.is_empty());
        assert_eq!(parsed.exec.cwd, None);
        assert!(!parsed.geometry.hdr);
    }
}
