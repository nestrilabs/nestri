// The lifecycle layer of the control channel between a box and whatever runs
// it: the document describing the box, the commands that run things inside it,
// and what the guest says back about carrying either out.
//
// It lives beside the media types for the same reason they live here — one
// definition, so the two ends cannot drift from each other silently.
//
// Nothing in this module describes *what* the guest runs. A set of share tags,
// a command line, and what an exit means: that is the whole vocabulary, and a
// field that only makes sense for one kind of workload does not belong in it.
// ref(d-0033)
//
// # The box outlives what runs in it
//
// The guest init is resident: it mounts what the descriptor names, brings up
// the box's service stack, says so, and then takes commands for as long as the
// box lives. So the descriptor describes the *box* — which shares are mounted
// where — and a command describes an occupant. A box may be launched into many
// times. ref(d-0063)
//
// That is why every launch carries an id and every event about a launch carries
// it back. Without one, a second launch's exit is indistinguishable from the
// first's, which reads as an ended session that keeps billing or a running one
// reported as stopped.
//
// # What is deliberately absent
//
// **Output geometry.** The compositor wraps the workload rather than running as
// a service, so it is started by a launch with that launch's geometry in its own
// argv, and the numbers appear nowhere else. Two sources of truth for one number
// is a worse failure than either choice, because the wrong one is used silently.
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
///
/// Version 3 took three fields off the descriptor and put an id on three
/// messages, so a version-2 peer and a version-3 peer do not talk at all.
/// There is deliberately no shim: nothing is deployed, and a shim would be the
/// second definition of this wire that one shared crate exists to prevent.
pub const CONTROL_VERSION: u32 = 3;

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

/// Names one launch, for as long as anything has something to say about it.
///
/// Minted by the caller and only ever echoed by the guest. A guest that
/// generated these would be naming things the caller then has to correlate
/// against something else.
///
/// Opaque on purpose: nothing in this layer parses it, and a caller that wants
/// meaning in it can put meaning in it without this crate having an opinion.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct LaunchId(pub String);

impl LaunchId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for LaunchId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
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
    ///
    /// It rides on the launch rather than on the descriptor, because a box that
    /// can be launched into repeatedly cannot have one answer to this fixed at
    /// boot. ref(d-0063)
    pub terminal: bool,
}

/// What the box *is*, in one document: the shares it has and where they land.
///
/// Sent once, immediately after the handshake, and read once. Deliberately not
/// a conversation: this much is a document, and a document cannot half-arrive.
/// What runs *in* the box is a conversation, and a separate one — see
/// [`HostToGuest::Launch`]. ref(d-0063)
///
/// An empty `mounts` is legitimate. A box with nothing mounted still boots and
/// still brings up its services.
///
/// `deny_unknown_fields` is load-bearing rather than strictness for its own
/// sake. A descriptor still carrying a command line is a caller that has not
/// been updated, and the default behaviour — ignore what it does not recognise —
/// would mount the shares, silently drop the command, and leave a box that came
/// up correctly and runs nothing. Refusing it says so instead.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BootDescriptor {
    #[serde(default)]
    pub mounts: Vec<Mount>,
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
    ///
    /// **This is the handshake, not readiness.** It says a connection exists
    /// and both ends speak the same version. Whether anything in the box works
    /// is [`GuestToHost::Initialized`], which is a different fact and must not
    /// be merged with this one — a caller that treats this as readiness has a
    /// wait stage that succeeds before the guest has started anything.
    Ready { protocol_version: u32 },
    /// Every share the descriptor named is where it said to put it.
    Mounted,
    /// A share could not be mounted, in the words the operating system used.
    ///
    /// Kept separate from `StartFailed` because the two want different things
    /// looked at: a share that did not appear and a command that did not run
    /// are not the same incident.
    MountFailed { reason: String },
    /// The box's own services are up and it will accept launches.
    ///
    /// The one fact a caller waits on before it may launch anything. It names
    /// what came up, so a log says which — an empty list is a box with no
    /// service stack, which is legitimate and worth being able to see.
    Initialized {
        #[serde(default)]
        services: Vec<String>,
    },
    /// The box's services could not be brought up, in the words of whatever
    /// refused.
    ///
    /// Kept separate from [`GuestToHost::MountFailed`] and
    /// [`GuestToHost::StartFailed`] for the reason those two are separate from
    /// each other: a share that did not appear, a box that could not be made,
    /// and a command that did not run are three incidents that want three
    /// different things looked at. A box in this state cannot be launched into
    /// at all, which is what distinguishes it from a refused launch.
    InitFailed { reason: String },
    /// A service in the box's own stack exited.
    ///
    /// **Reported, never repaired.** Nothing else in the guest is watching
    /// these, so a death that is not said here is a box that looks healthy and
    /// cannot work. Restarting one is a decision for whoever can see whether
    /// restarting is repair or a loop, and that is not this end. ref(d-0063)
    ServiceDied {
        name: String,
        #[serde(flatten)]
        exit: Exit,
    },
    /// The launch with this id is running.
    Started { id: LaunchId },
    /// The launch with this id could not be run, in the words the operating
    /// system used.
    StartFailed { id: LaunchId, reason: String },
    /// The launch with this id has ended. Terminal or not is the launch's own
    /// answer, not this message's.
    WorkloadExited {
        id: LaunchId,
        #[serde(flatten)]
        exit: Exit,
    },
    /// How a client reaches this box's media, once it is known.
    Ticket { ticket: String },
    /// Bytes from the workload, relayed. See [`Payload`].
    Payload {
        #[serde(flatten)]
        payload: Payload,
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
    /// Run something in the box. Any number of times, after `initialized`.
    ///
    /// The caller mints `id` and every message about this launch carries it
    /// back. `on_exit` belongs here rather than on the descriptor because a box
    /// that can be launched into repeatedly has one answer per launch, not one
    /// per boot. ref(d-0063)
    Launch {
        id: LaunchId,
        exec: Exec,
        on_exit: OnExit,
    },
    /// Stop one launch. Idempotent, and does not end the session.
    Stop { id: LaunchId },
    /// Stop one launch and start it again with the same command.
    ///
    /// **Defined as a kill followed by a launch of the same `Exec`, and nothing
    /// more.** No retry, no backoff, no policy of any kind in the guest — it
    /// exists as one message only because a caller sending two has the same
    /// effect with a worse race in it. The relaunch keeps the id. ref(d-0063)
    Restart { id: LaunchId },
    /// Shut the guest down.
    Shutdown,
    /// Bytes for the workload, relayed. See [`Payload`].
    Payload {
        #[serde(flatten)]
        payload: Payload,
    },
}

/// The second layer of the channel: bytes the guest carries and never reads.
///
/// `body` is a string rather than nested JSON, and that is the structural part
/// of it. A document the guest can index into is a document the guest can grow
/// to depend on, and then this layer is no longer opaque and the boundary it
/// exists to draw is gone.
///
/// **An envelope is never logged.** Not the body, not truncated, not at debug
/// level. The channel name and the byte count are the whole of what may be
/// said about one, because what crosses here includes credentials meant for
/// the workload and nothing else. ref(d-0033)
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Payload {
    /// Which conversation this belongs to. Loggable.
    pub channel: String,
    /// Opaque bytes. Never logged, never parsed, never inspected.
    pub body: String,
}

impl Payload {
    pub fn new(channel: impl Into<String>, body: impl Into<String>) -> Self {
        Self {
            channel: channel.into(),
            body: body.into(),
        }
    }

    /// What may be said about an envelope, and all of it.
    pub fn summary(&self) -> String {
        format!("{} ({} bytes)", self.channel, self.body.len())
    }
}

/// Written by hand, and it is load-bearing: a derived `Debug` puts the body
/// one careless `{:?}` away from a log line.
impl std::fmt::Debug for Payload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Payload")
            .field("channel", &self.channel)
            .field("body", &format_args!("<{} bytes>", self.body.len()))
            .finish()
    }
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
            mounts: vec![Mount {
                tag: "install".into(),
                at: "/mnt/install".into(),
                ro: true,
            }],
        }
    }

    fn exec() -> Exec {
        Exec {
            argv: vec!["/usr/bin/true".into()],
            env: BTreeMap::from([("HOME".to_string(), "/mnt/user".to_string())]),
            cwd: Some("/mnt/user".into()),
            uid: 1000,
            gid: 1000,
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
    fn a_launch_round_trips_with_its_id() {
        let launch = HostToGuest::Launch {
            id: LaunchId::new("l-1"),
            exec: exec(),
            on_exit: OnExit { terminal: true },
        };
        let back: HostToGuest = from_line(&to_line(&launch).unwrap()).unwrap();
        assert_eq!(back, launch);
    }

    /// The reason ids exist: a caller has to be able to tell which launch it is
    /// being told about, or the second one's exit overwrites the first's record.
    #[test]
    fn every_event_about_a_launch_carries_the_launch_it_is_about() {
        let first = LaunchId::new("l-1");
        let second = LaunchId::new("l-2");

        let events = [
            GuestToHost::Started { id: first.clone() },
            GuestToHost::StartFailed {
                id: first.clone(),
                reason: "ENOENT".into(),
            },
            GuestToHost::WorkloadExited {
                id: first.clone(),
                exit: Exit::code(0),
            },
        ];

        for event in events {
            let line = to_line(&event).unwrap();
            assert!(
                line.contains(first.as_str()) && !line.contains(second.as_str()),
                "an event does not say which launch it is about: {line}"
            );
            let back: GuestToHost = from_line(&line).unwrap();
            assert_eq!(back, event);
        }
    }

    /// The descriptor describes the box. A caller still sending a command in it
    /// has not been updated, and the cost of accepting one quietly is a box that
    /// mounts, comes up, and runs nothing.
    #[test]
    fn a_descriptor_carrying_a_command_is_refused_rather_than_ignored() {
        let stale = r#"{"exec":{"argv":["/bin/sh"],"uid":1000,"gid":1000},
                        "mounts":[],
                        "geometry":{"width":1280,"height":720,"fps":60},
                        "on_exit":{"terminal":true}}"#;
        let parsed: Result<BootDescriptor, _> = from_line(stale);
        assert!(
            parsed.is_err(),
            "a descriptor with a command in it parsed: {parsed:?}"
        );
    }

    /// Geometry is in the launched argv and nowhere else, so there is no field
    /// here for it to disagree with.
    #[test]
    fn geometry_is_not_on_this_layer() {
        let line = to_line(&HostToGuest::Boot {
            descriptor: Box::new(descriptor()),
        })
        .unwrap();
        for named in ["width", "height", "fps", "hdr", "geometry"] {
            assert!(
                !line.contains(named),
                "the descriptor names {named}, which belongs in the launch: {line}"
            );
        }
    }

    /// A dead service is not a dead workload: they are different incidents and
    /// want different things looked at.
    #[test]
    fn a_dead_service_says_which_one_and_how() {
        let died = GuestToHost::ServiceDied {
            name: "pipewire".into(),
            exit: Exit::signal(9),
        };
        let line = to_line(&died).unwrap();
        assert!(line.contains("pipewire"), "no service name: {line}");
        assert!(
            !line.contains("exit_code"),
            "a signalled service has no exit code: {line}"
        );
        let back: GuestToHost = from_line(&line).unwrap();
        assert_eq!(back, died);
    }

    /// `ready` is the handshake and `initialized` is the box working. A caller
    /// waiting on the wrong one succeeds before anything has started.
    #[test]
    fn readiness_and_initialisation_are_two_messages() {
        let ready = to_line(&GuestToHost::Ready {
            protocol_version: CONTROL_VERSION,
        })
        .unwrap();
        let initialized = to_line(&GuestToHost::Initialized {
            services: vec!["dbus".into(), "pipewire".into()],
        })
        .unwrap();
        assert_ne!(ready, initialized);

        // An empty stack is legitimate and has to survive the round trip, or a
        // box with no services looks like a box that never came up.
        let empty = GuestToHost::Initialized { services: vec![] };
        let back: GuestToHost = from_line(&to_line(&empty).unwrap()).unwrap();
        assert_eq!(back, empty);
    }

    #[test]
    fn a_signalled_exit_is_not_a_zero_exit() {
        let signalled = to_line(&GuestToHost::WorkloadExited {
            id: LaunchId::new("l-1"),
            exit: Exit::signal(9),
        })
        .unwrap();
        assert!(
            !signalled.contains("exit_code"),
            "a signalled workload has no exit code: {signalled}"
        );

        let clean = to_line(&GuestToHost::WorkloadExited {
            id: LaunchId::new("l-1"),
            exit: Exit::code(0),
        })
        .unwrap();
        assert!(
            !clean.contains("signal"),
            "a clean exit was not signalled: {clean}"
        );
    }

    #[test]
    fn an_envelope_does_not_print_its_body() {
        let payload = Payload::new("identity", "a-credential-nobody-should-read");
        let printed = format!("{payload:?}");
        assert!(
            !printed.contains("a-credential"),
            "the body reached a log line: {printed}"
        );
        assert!(
            printed.contains("identity"),
            "the channel name is loggable: {printed}"
        );
        assert_eq!(payload.summary(), "identity (31 bytes)");
    }

    #[test]
    fn an_envelope_body_stays_a_string_in_both_directions() {
        // Nested JSON in the body has to survive as text: the moment it
        // arrives as structure, this layer is one field access from being
        // parsed.
        let body = r#"{"looks":"structured"}"#;
        let line = to_line(&GuestToHost::Payload {
            payload: Payload::new("identity", body),
        })
        .unwrap();
        let back: GuestToHost = from_line(&line).unwrap();
        let GuestToHost::Payload { payload } = back else {
            panic!("not an envelope: {line}")
        };
        assert_eq!(payload.body, body);

        let line = to_line(&HostToGuest::Payload {
            payload: Payload::new("identity", body),
        })
        .unwrap();
        let back: HostToGuest = from_line(&line).unwrap();
        let HostToGuest::Payload { payload } = back else {
            panic!("not an envelope: {line}")
        };
        assert_eq!(payload.body, body);
    }

    #[test]
    fn a_mount_failure_keeps_its_reason_verbatim() {
        let reason = "EACCES: /mnt/user";
        let line = to_line(&GuestToHost::MountFailed {
            reason: reason.into(),
        })
        .unwrap();
        let back: GuestToHost = from_line(&line).unwrap();
        assert_eq!(
            back,
            GuestToHost::MountFailed {
                reason: reason.into()
            }
        );
    }

    #[test]
    fn defaults_cover_what_a_caller_may_leave_out() {
        // A box with nothing mounted is a legitimate box.
        let parsed: BootDescriptor = from_line("{}").unwrap();
        assert!(parsed.mounts.is_empty());

        let launch = r#"{"type":"launch","id":"l-1",
                         "exec":{"argv":["/bin/sh"],"uid":1000,"gid":1000},
                         "on_exit":{"terminal":false}}"#;
        let HostToGuest::Launch { id, exec, on_exit } = from_line(launch).unwrap() else {
            panic!("not a launch: {launch}")
        };
        assert_eq!(id, LaunchId::new("l-1"));
        assert!(exec.env.is_empty());
        assert_eq!(exec.cwd, None);
        assert!(!on_exit.terminal);
    }
}
