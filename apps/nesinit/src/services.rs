// The box's own services, and the table that is the whole of what a box runs
// before anything is launched into it.
//
// There is no service manager in a box and no init scripts, so this is what
// replaces them. ref(d-0063)
//
// # Why the table is in the binary
//
// A unit format would make this configurable, and nothing wants to configure
// it: the services in a box are ours, they are the same in every box, and a
// table in a file is a table two images can disagree about. Being able to run
// on any distribution comes from depending on no distribution's init scripts,
// which this does — not from being told what to start.
//
// # What is deliberately not here
//
// **The compositor.** It wraps the workload and is started by a launch, with
// that launch's geometry, and dies with it. A compositor in this table would be
// a compositor with no geometry to come up with.
//
// **Restarting.** A service that dies is reported up the channel and left dead.
// Whether restarting it is repair or a loop is not visible from inside the box.
//
// **Readiness beyond "it is running".** Nothing here waits for a socket to
// answer or a bus name to appear. If a service ever needs that, this stops
// being a table and becomes a supervisor, and that is worth noticing rather
// than absorbing — see the decision's own falsification list.

use std::os::unix::process::CommandExt;

use nesprotocol::lifecycle::Exit;
use tokio::sync::mpsc::{Receiver, Sender};

use crate::reap::{Waiters, Watched};
use crate::workload::Failure;

/// A service that died, and how.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Died {
    pub name: String,
    pub exit: Exit,
}

/// The box's service stack, as the session sees it.
///
/// A trait because the interesting behaviour is the session's — that a death is
/// reported and not repaired, that a stack which will not come up refuses the
/// box — and none of that needs a process to assert.
pub trait Services {
    /// Bring the stack up in order, and name what came up.
    ///
    /// Called once, after the shares are mounted and before anything may be
    /// launched. An empty stack is legitimate: a box with no services still
    /// boots, and a caller can still launch something that needs none.
    fn bring_up(&mut self) -> Result<Vec<String>, Failure>;

    /// Deaths, as they happen.
    ///
    /// A channel rather than a future so the session can wait on it beside the
    /// control channel, the relay and the address carrier without any of them
    /// being able to starve the others.
    fn deaths(&mut self) -> &mut Receiver<Died>;
}

// There is deliberately no `stop_all`. On the way down this process is PID 1
// and the ordered shutdown already signals every process it may signal, which
// is all of them — so a second, politer path would be a duplicate that only the
// tests exercise. Reverse-order stopping buys nothing on a machine that is
// about to be powered off.

/// One service, and everything about starting it.
///
/// `env` is per-entry rather than inherited: init's own environment is the
/// kernel's command line and says nothing a service should read.
pub struct Service {
    /// What appears in a log line and in `initialized`.
    pub name: &'static str,
    pub argv: &'static [&'static str],
    pub env: &'static [(&'static str, &'static str)],
    /// Who it runs as. `None` means init's own user, which is root.
    pub user: Option<(u32, u32)>,
    /// Said when it will not start, in terms of what stops working. The same
    /// discipline the early filesystems use: a failure that names a cost can be
    /// acted on, where "could not start pipewire" cannot.
    pub cost: &'static str,
    /// Whether the box is unusable without it.
    ///
    /// A required service that will not start refuses the box, because a caller
    /// launching into it would get a session that comes up and does not work.
    /// An optional one is reported and stepped over.
    pub required: bool,
}

/// The user the box's own services run as.
///
/// **Not the user a workload runs as, and that is the whole reason for the
/// number.** A workload sharing a user with these can replace a socket one of
/// them listens on and answer in its place — and the answer that matters is the
/// address a client is told to connect to. See `ticket::Untrusted`.
pub const SERVICE_UID: u32 = 1000;
pub const SERVICE_GID: u32 = 1000;

/// Where a service's runtime sockets live.
pub const RUNTIME_DIR: &str = "/run/user/1000";

/// Somewhere every service may write.
///
/// # The service user's home is on a read-only root
///
/// `useradd -m` made `/home/nestri` in the image, and the image is mounted
/// read-only, so every library that follows XDG conventions to a default under
/// `$HOME` fails there. Measured 2026-09-12: the session manager could not
/// write its state on any boot, and anything asking Mesa for a shader cache was
/// told it was disabled.
///
/// The second one is not a warning. Mesa with no writable cache recompiles
/// every shader on every run, and the symptom a person sees is a black screen
/// or a frozen game rather than a slow one.
///
/// # Under the runtime directory rather than a tmpfs over the home
///
/// Mounting a tmpfs at `/home/nestri` would work and would hide the shell
/// files the image put there, which is how a debug shell loses its prompt and
/// its history for no stated reason. The runtime directory is already a tmpfs,
/// already owned by this user, and already made before any service starts.
///
/// Per boot, which is correct for these: a service's cache is not state anybody
/// wants to keep. A *workload's* cache is, and it is pointed at the writable
/// share it was given instead.
const WRITABLE: &[(&str, &str)] = &[
    ("HOME", "/home/nestri"),
    ("XDG_RUNTIME_DIR", RUNTIME_DIR),
    ("XDG_CACHE_HOME", "/run/user/1000/cache"),
    ("XDG_STATE_HOME", "/run/user/1000/state"),
    ("XDG_CONFIG_HOME", "/run/user/1000/config"),
    ("XDG_DATA_HOME", "/run/user/1000/data"),
];

/// The stack, in the order it comes up.
///
/// Ported from the nine init scripts this replaces, and the ordering is theirs:
/// the bus before anything that speaks on it, audio before whatever plays into
/// it, and the hub last because it binds the sockets the rest connect to.
pub const STACK: &[Service] = &[
    Service {
        name: "dbus-system",
        argv: &[
            "/usr/bin/dbus-daemon",
            "--system",
            "--nofork",
            "--nopidfile",
        ],
        env: &[],
        user: None,
        cost: "nothing that speaks on the system bus can find it",
        required: true,
    },
    Service {
        name: "dbus-session",
        argv: &[
            "/usr/bin/dbus-daemon",
            "--session",
            "--nofork",
            "--nopidfile",
            "--address=unix:path=/run/user/1000/bus",
        ],
        env: &[("XDG_RUNTIME_DIR", RUNTIME_DIR)],
        user: Some((SERVICE_UID, SERVICE_GID)),
        cost: "audio and anything else expecting a session bus will not start",
        required: true,
    },
    Service {
        name: "pipewire",
        argv: &["/usr/bin/pipewire"],
        env: &[
            ("XDG_RUNTIME_DIR", RUNTIME_DIR),
            ("DBUS_SESSION_BUS_ADDRESS", "unix:path=/run/user/1000/bus"),
        ],
        user: Some((SERVICE_UID, SERVICE_GID)),
        cost: "the session has no audio at all",
        required: true,
    },
    Service {
        name: "wireplumber",
        argv: &["/usr/bin/wireplumber"],
        env: &[
            ("XDG_RUNTIME_DIR", RUNTIME_DIR),
            ("DBUS_SESSION_BUS_ADDRESS", "unix:path=/run/user/1000/bus"),
        ],
        user: Some((SERVICE_UID, SERVICE_GID)),
        // Optional on purpose: pipewire runs without a session manager, so a
        // box with no wireplumber has audio nodes and nothing routing them,
        // which is a degraded session rather than no session.
        cost: "audio devices exist but nothing routes them",
        required: false,
    },
    Service {
        name: "neswire",
        argv: &["/usr/bin/neswire"],
        env: &[
            ("XDG_RUNTIME_DIR", RUNTIME_DIR),
            ("DBUS_SESSION_BUS_ADDRESS", "unix:path=/run/user/1000/bus"),
        ],
        user: Some((SERVICE_UID, SERVICE_GID)),
        cost: "the client gets pictures and no sound",
        required: false,
    },
    Service {
        name: "neshub",
        argv: &["/usr/bin/neshub"],
        env: &[("XDG_RUNTIME_DIR", RUNTIME_DIR)],
        user: Some((SERVICE_UID, SERVICE_GID)),
        // The one whose absence has no workaround: it owns the endpoint, so
        // without it the session has no address and nothing can reach the box.
        cost: "the session has no address, so no client can reach it",
        required: true,
    },
];

/// The stack as running processes.
pub struct Stack {
    waiters: Waiters,
    table: &'static [Service],
    running: Vec<(&'static str, Watched)>,
    deaths: Receiver<Died>,
    reported: Sender<Died>,
}

impl Stack {
    pub fn new(waiters: Waiters) -> Self {
        Self::from_table(waiters, STACK)
    }

    /// The same thing against a different table, which is how the ordering and
    /// the required/optional rule are tested without a `/usr/bin` full of
    /// services.
    pub fn from_table(waiters: Waiters, table: &'static [Service]) -> Self {
        // Small: what goes on it is one line per service death, and a box does
        // not have many services to lose.
        let (reported, deaths) = tokio::sync::mpsc::channel(16);
        Self {
            waiters,
            table,
            running: Vec::new(),
            deaths,
            reported,
        }
    }

    fn spawn(&mut self, service: &'static Service) -> Result<(), Failure> {
        let Some((program, args)) = service.argv.split_first() else {
            return Err(Failure::new(format!(
                "{}: the command is empty",
                service.name
            )));
        };

        // The standard library's process rather than the runtime's: the runtime
        // reaps the children it spawns, and in this component reaping belongs
        // to one place. See `reap::Waiters`.
        let mut command = std::process::Command::new(program);
        command.args(args);
        command.env_clear();
        command.envs(WRITABLE.iter().copied());
        // The service's own entry last, so a service that states one of these
        // for itself wins over the defaults above.
        command.envs(service.env.iter().copied());

        if let Some((uid, gid)) = service.user {
            // SAFETY: the closure runs between fork and exec in the child,
            // where only async-signal-safe calls are allowed. These two are,
            // and it allocates nothing.
            unsafe {
                command.pre_exec(move || {
                    // gid first: dropping the uid first would lose the
                    // privilege needed to set the gid at all.
                    if libc::setgid(gid) != 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    if libc::setuid(uid) != 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    Ok(())
                });
            }
        }

        let mut watched = self
            .waiters
            .watch(|| Ok(command.spawn()?.id() as i32))
            .map_err(|error| Failure::new(format!("{}: {error}", service.name)))?;

        // The exit is moved onto a task that turns it into one line on the
        // channel. Nothing here awaits it: bring-up is a sequence of starts,
        // and a service that exits during it is a death like any other.
        let exit = watched.take_exit().expect("a new watch has its exit");
        let reported = self.reported.clone();
        let name = service.name;
        tokio::spawn(async move {
            let exit = match exit.await {
                Ok(exit) => exit,
                // The watch was dropped, which happens on the way down. There
                // is nothing to report and nobody left to report it to.
                Err(_) => return,
            };
            let _ = reported
                .send(Died {
                    name: name.to_string(),
                    exit,
                })
                .await;
        });

        self.running.push((service.name, watched));
        Ok(())
    }
}

impl Services for Stack {
    fn bring_up(&mut self) -> Result<Vec<String>, Failure> {
        let mut up = Vec::new();
        // Lifted out so the loop does not hold a borrow of `self` across the
        // start it is asking for.
        let table = self.table;
        for service in table {
            match self.spawn(service) {
                Ok(()) => {
                    tracing::info!(service = service.name, "started");
                    up.push(service.name.to_string());
                }
                Err(failure) if service.required => {
                    // Named with its cost rather than only its error: which
                    // service failed decides whether the box is worth having,
                    // and that judgement is made outside the box.
                    return Err(Failure::new(format!(
                        "{} — {}",
                        failure.reason, service.cost
                    )));
                }
                Err(failure) => tracing::warn!(
                    service = service.name,
                    cost = service.cost,
                    "could not start, and the box goes on without it: {}",
                    failure.reason
                ),
            }
        }
        Ok(up)
    }

    fn deaths(&mut self) -> &mut Receiver<Died> {
        &mut self.deaths
    }
}

#[cfg(test)]
pub mod double {
    use super::*;

    /// A stack that starts nothing, so what the session does with it is the
    /// only thing under test.
    pub struct Double {
        pub brought_up: usize,
        pub failure: Option<Failure>,
        pub names: Vec<String>,
        deaths: Receiver<Died>,
        pub report: Sender<Died>,
    }

    impl Default for Double {
        fn default() -> Self {
            Self::new()
        }
    }

    impl Double {
        pub fn new() -> Self {
            let (report, deaths) = tokio::sync::mpsc::channel(8);
            Self {
                brought_up: 0,
                failure: None,
                names: vec!["dbus-system".into(), "neshub".into()],
                deaths,
                report,
            }
        }

        /// A stack that refuses to come up, which refuses the box.
        pub fn refuses(reason: &str) -> Self {
            let mut double = Self::new();
            double.failure = Some(Failure::new(reason));
            double
        }
    }

    impl Services for Double {
        fn bring_up(&mut self) -> Result<Vec<String>, Failure> {
            self.brought_up += 1;
            match &self.failure {
                Some(failure) => Err(failure.clone()),
                None => Ok(self.names.clone()),
            }
        }

        fn deaths(&mut self) -> &mut Receiver<Died> {
            &mut self.deaths
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The two that failed on a real boot, and the reason each matters.
    #[test]
    fn every_service_has_somewhere_to_write() {
        let names: Vec<&str> = WRITABLE.iter().map(|(k, _)| *k).collect();
        assert!(
            names.contains(&"XDG_STATE_HOME"),
            "the session manager could not write its state on any boot"
        );
        assert!(
            names.contains(&"XDG_CACHE_HOME"),
            "no shader cache means recompiling every shader every run, and \
             what that looks like is a black screen rather than a slow one"
        );
        for (_, path) in WRITABLE {
            if path.starts_with("/run/") || *path == "/home/nestri" {
                continue;
            }
            panic!("{path} is not somewhere a read-only root lets a service write");
        }
    }

    /// The table is data, and the things that make it wrong are checkable
    /// without running any of it.
    #[test]
    fn every_service_can_be_started_and_says_what_it_costs() {
        for service in STACK {
            assert!(!service.name.is_empty(), "a service with no name");
            assert!(!service.argv.is_empty(), "{}: nothing to run", service.name);
            assert!(
                service.argv[0].starts_with('/'),
                "{}: not an absolute path, so it depends on a PATH init does not set",
                service.name
            );
            assert!(
                !service.cost.is_empty(),
                "{}: no cost, so a failure cannot be judged from outside",
                service.name
            );
        }
    }

    #[test]
    fn no_service_is_named_twice() {
        let mut names: Vec<_> = STACK.iter().map(|s| s.name).collect();
        names.sort_unstable();
        let count = names.len();
        names.dedup();
        assert_eq!(count, names.len(), "two services share a name: {names:?}");
    }

    /// The compositor is started by a launch, with that launch's geometry. One
    /// in this table would be one with no geometry to come up with.
    #[test]
    fn the_compositor_is_not_a_service() {
        for service in STACK {
            assert!(
                !service.name.contains("scope") && !service.argv[0].contains("nescope"),
                "the compositor is in the service table: {}",
                service.name
            );
        }
    }

    /// Every service runs as init or as the one service user, and never as
    /// anything else.
    ///
    /// The uid a workload runs as arrives in its launch and is not known here,
    /// so this cannot compare the two directly. What it can do is refuse a
    /// third user appearing in this table — because the separation that matters
    /// is that a workload never shares a user with these, and a service quietly
    /// given some other uid is how that stops being true. A workload sharing a
    /// user with a service can replace a socket it listens on and answer in its
    /// place, and the answer that matters is the address a client is told to
    /// connect to. See `ticket::Untrusted`.
    #[test]
    fn a_service_runs_as_init_or_as_the_service_user_and_nothing_else() {
        for service in STACK {
            if let Some((uid, gid)) = service.user {
                assert_eq!(
                    (uid, gid),
                    (SERVICE_UID, SERVICE_GID),
                    "{} runs as a third user",
                    service.name
                );
            }
        }
    }

    /// A required service whose absence has a workaround should not be
    /// required, and an optional one whose absence has none should not be
    /// optional. Only the second half is checkable, and it is the one that
    /// matters: the address is what a client needs.
    #[test]
    fn whatever_owns_the_address_is_required() {
        let hub = STACK
            .iter()
            .find(|s| s.name == "neshub")
            .expect("something has to own the endpoint");
        assert!(
            hub.required,
            "a box with no address is a box nothing can reach"
        );
    }
}
