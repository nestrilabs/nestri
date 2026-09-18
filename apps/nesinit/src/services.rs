// The box's own services, and the table that is the whole of what a box runs
// before anything is launched into it.
//
// There is no service manager in a box and no init scripts, so this is what
// replaces them. ref(d-0064)
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
// **Readiness beyond "its socket exists".** A service that names a socket is
// waited for until that socket is there; nothing here asks it a question or
// waits for a bus name. That much was in the init scripts this replaced and
// leaving it out was a regression: `spawn` returns at fork, so without it the
// bus's client is started before the bus is listening and audio comes up
// against nothing. It races rather than failing — which is the shape this
// component is least able to see — and the cost of losing the race is a box
// that boots, reports itself ready, and has no sound.
//
// That is as far as it goes. Health checks, restarts and readiness that is not
// a file on a path would make this a supervisor; see the decision's own
// falsification list.

use std::os::unix::process::CommandExt;

use nesprotocol::lifecycle::Exit;
use tokio::sync::mpsc::{Receiver, Sender};

use crate::reap::{Waiters, Watched};
use crate::workload::Failure;
use nesprotocol::lifecycle::VideoLimits;

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
    ///
    /// `video` comes from the descriptor and reaches the services that read it.
    /// It has to arrive here rather than later because a service configured
    /// after it is already running has a window in which it is not configured,
    /// and for a bitrate ceiling that window is a session streaming at whatever
    /// default it started with.
    fn bring_up(&mut self, video: VideoLimits) -> Result<Vec<String>, Failure>;

    /// Deaths, as they happen.
    ///
    /// A channel rather than a future so the session can wait on it beside the
    /// control channel, the relay and the address carrier without any of them
    /// being able to starve the others.
    fn deaths(&mut self) -> &mut Receiver<Died>;
}

// There is deliberately no ordered `stop_all`, and reverse-order stopping buys
// nothing on a machine that is about to be powered off. What there is instead
// is a `Drop` that signals the children this stack started — because the
// argument for having nothing at all was "this process is PID 1 and the ordered
// shutdown signals every process", and that is true of a box and false of the
// way this program is run by hand to debug one. Outside PID 1 the old path left
// a bus, an audio server and a hub running with sockets nobody was serving.

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
    /// The umask to exec under, when the default one is wrong.
    ///
    /// Only audio sets this, and only because of who has to reach it. A unix
    /// socket is created `0777` masked by the umask, so the inherited `022`
    /// gives `0755` -- and connecting to a socket needs *write*, so every user
    /// but the owner is refused. The services run as one user and a workload
    /// runs as another, so that is the workload: it finds the socket, cannot
    /// open it, and plays silently.
    ///
    /// `0` rather than a mode in PipeWire's own configuration because the
    /// socket list lives inside a module's arguments, and a drop-in that
    /// re-declares that module loads it twice.
    pub umask: Option<u32>,
    /// A path that exists once this service can be talked to.
    ///
    /// `None` means "started is ready", which is true of anything nothing else
    /// in the table connects to. Where something does connect, the path is the
    /// socket it connects to: `spawn` returns when the child has been forked,
    /// which is before that child has bound anything, so the next service in
    /// the table would otherwise be started against a socket that is not there.
    ///
    /// Existence only. Whether the thing behind the socket answers correctly is
    /// not knowable from here, and a box is not the place to find out.
    pub ready: Option<&'static str>,
}

/// How long a service gets to bind its socket before the box gives up on it.
///
/// Long enough that a cold boot on a slow disk is not cut short, short enough
/// that a service which will never bind does not hold the box for a minute
/// before saying so. What actually happens is that the wait ends in single-
/// digit milliseconds, because the child binds before its parent gets back to
/// this loop.
const READY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

/// The user the box's own services run as.
///
/// **Not the user a workload runs as, and that is the whole reason for the
/// number.** A workload sharing a user with these can replace a socket one of
/// them listens on and answer in its place — and the answer that matters is the
/// address a client is told to connect to. See `ticket::Untrusted`.
pub const SERVICE_UID: u32 = 1000;

/// Where audio's socket lives, for both the services and the workload.
///
/// # Why not the runtime directory
///
/// The services run as one user and a workload runs as another, on purpose
/// (see [`SERVICE_UID`]). A per-user runtime directory is `0700` and named
/// after its own uid, so a socket in the services' one is in a directory the
/// workload may not enter, at a path it would not look in anyway.
///
/// Measured 2026-09-12: the game rendered and had no sound, because it looked
/// for audio under its own uid and found nothing. Nothing failed -- a game with
/// no audio server plays silently.
///
/// So audio gets a directory of its own that both users share, named to both
/// through `PIPEWIRE_RUNTIME_DIR`. The workload still cannot replace a socket
/// here: the directory belongs to the service user and is not writable by the
/// workload, which is the property [`crate::ticket::Untrusted`] depends on.
pub const AUDIO_DIR: &str = "/run/pipewire";
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
    ("PIPEWIRE_RUNTIME_DIR", AUDIO_DIR),
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
        umask: None,
        ready: None,
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
        umask: None,
        // Every service after this one is handed this path as its bus address,
        // and a bus address that is not bound yet is a service that starts,
        // finds nothing, and carries on without a bus.
        ready: Some("/run/user/1000/bus"),
    },
    Service {
        name: "pipewire",
        argv: &["/usr/bin/pipewire"],
        env: &[
            ("XDG_RUNTIME_DIR", RUNTIME_DIR),
            ("PIPEWIRE_RUNTIME_DIR", AUDIO_DIR),
            ("DBUS_SESSION_BUS_ADDRESS", "unix:path=/run/user/1000/bus"),
        ],
        user: Some((SERVICE_UID, SERVICE_GID)),
        cost: "the session has no audio at all",
        required: true,
        // So the workload, which is not this user, can open the socket.
        umask: Some(0),
        // Both the session manager and the sender connect here, and so does
        // the workload once it starts.
        ready: Some("/run/pipewire/pipewire-0"),
    },
    Service {
        name: "wireplumber",
        argv: &["/usr/bin/wireplumber"],
        env: &[
            ("XDG_RUNTIME_DIR", RUNTIME_DIR),
            ("PIPEWIRE_RUNTIME_DIR", AUDIO_DIR),
            ("DBUS_SESSION_BUS_ADDRESS", "unix:path=/run/user/1000/bus"),
        ],
        user: Some((SERVICE_UID, SERVICE_GID)),
        // Optional on purpose: pipewire runs without a session manager, so a
        // box with no wireplumber has audio nodes and nothing routing them,
        // which is a degraded session rather than no session.
        cost: "audio devices exist but nothing routes them",
        required: false,
        umask: None,
        ready: None,
    },
    Service {
        name: "neswire",
        argv: &["/usr/bin/neswire"],
        env: &[
            ("XDG_RUNTIME_DIR", RUNTIME_DIR),
            ("PIPEWIRE_RUNTIME_DIR", AUDIO_DIR),
            ("DBUS_SESSION_BUS_ADDRESS", "unix:path=/run/user/1000/bus"),
        ],
        user: Some((SERVICE_UID, SERVICE_GID)),
        cost: "the client gets pictures and no sound",
        required: false,
        umask: None,
        ready: None,
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
        umask: None,
        ready: None,
    },
];

/// The stack as running processes.
pub struct Stack {
    waiters: Waiters,
    table: &'static [Service],
    running: Vec<(&'static str, Watched)>,
    deaths: Receiver<Died>,
    reported: Sender<Died>,
    /// What the host said this box may spend on video, from the descriptor.
    ///
    /// Held here because `spawn` is where it reaches a service, and `spawn`
    /// takes a `&'static Service` whose `env` is a fixed table -- a value that
    /// arrives at runtime has no route through it otherwise. The same problem
    /// `RUST_LOG` has, solved the same way.
    video: VideoLimits,
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
            video: VideoLimits::default(),
        }
    }

    /// The pids of what is running, for a test that has to ask the kernel
    /// whether they are still there. Nothing in the program uses it: signalling
    /// happens in `Drop`, where the pids are already to hand.
    pub fn pids(&self) -> Vec<i32> {
        self.running.iter().map(|(_, w)| w.pid).collect()
    }

    /// Wait for a service to bind the socket it said it would.
    ///
    /// Blocking, on a worker of a multi-threaded runtime: bring-up is a sequence
    /// and there is nothing else for this task to do while it waits. Polling rather
    /// than an inotify watch because the directory may not exist yet either, and a
    /// watch that has to handle that is more machinery than 15 seconds of `stat`.
    ///
    /// A failure is the same shape as a failure to start, so the required/optional
    /// rule above decides what it costs: a required service that never binds refuses
    /// the box, an optional one is stepped over.
    fn await_ready(&self, service: &Service, before: Option<Identity>) -> Result<(), Failure> {
        let Some(path) = service.ready else {
            return Ok(());
        };
        // The watch for what was just started, so a service that dies during its
        // own bring-up is not waited out for the full timeout.
        let started = self.running.last().map(|(_, watched)| watched.pid);
        await_path(
            service.name,
            path,
            before,
            &|| started.is_none_or(is_alive),
            READY_TIMEOUT,
        )
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
        // Forwarded, not cleared away with everything else: a service's log
        // level is otherwise unreachable. `env_clear` drops `RUST_LOG`, every
        // service resolves its filter with `EnvFilter::try_from_default_env`,
        // and that call has no variable to read — so each one falls back to
        // `info` whatever an operator sets, wherever they set it. There was no
        // way to raise a level inside the box at all, and the only ways around
        // it were to log at a level the line does not deserve or to rebuild the
        // image for each change.
        if let Ok(filter) = std::env::var("RUST_LOG") {
            command.env("RUST_LOG", filter);
        }
        // The descriptor's video limits, for the services that read them. Same
        // shape of problem as `RUST_LOG` above -- `env_clear` drops everything
        // and the service table is a fixed list of literals, so a value that
        // only exists at runtime has no other route in. `neshub` reads this
        // through the clap `env =` attribute it already uses for every other
        // setting.
        if let Some(kbps) = self.video.bitrate_kbps {
            command.env("NESTRI_MAX_BITRATE", kbps.to_string());
        }
        // The service's own entry last, so a service that states one of these
        // for itself wins over the defaults above.
        command.envs(service.env.iter().copied());

        let mask = service.umask;
        if let Some((uid, gid)) = service.user {
            // SAFETY: the closure runs between fork and exec in the child,
            // where only async-signal-safe calls are allowed. These two are,
            // and it allocates nothing.
            unsafe {
                command.pre_exec(move || {
                    if let Some(mask) = mask {
                        // SAFETY: `umask` cannot fail and touches only this
                        // child, between fork and exec.
                        libc::umask(mask as libc::mode_t);
                    }
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
    fn bring_up(&mut self, video: VideoLimits) -> Result<Vec<String>, Failure> {
        self.video = video;
        let mut up = Vec::new();
        // Lifted out so the loop does not hold a borrow of `self` across the
        // start it is asking for.
        let table = self.table;
        for service in table {
            // Taken before the service is started, because what makes a
            // socket this service's is that it was not there -- or was a
            // different file -- a moment ago.
            let before = service.ready.and_then(identity_of);
            match self
                .spawn(service)
                .and_then(|()| self.await_ready(service, before))
            {
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

impl Drop for Stack {
    /// Ask everything this stack started to stop.
    ///
    /// The stack owns these processes and nothing else does, so its going away
    /// is the last moment anything knows their pids. As PID 1 the ordered
    /// shutdown would reach them anyway and a second SIGTERM costs nothing;
    /// run by hand it is the only thing that reaches them at all.
    ///
    /// Asked, not waited for: this runs while the runtime is going down, so
    /// there is nothing left to reap them with. A signalled child that outlives
    /// this process is reparented and dies on its own, which is the outcome we
    /// wanted; an unsignalled one keeps its sockets.
    fn drop(&mut self) {
        for (name, watched) in &self.running {
            // The same rule as everywhere else that signals: a pid that has
            // been reaped may already belong to something else.
            if !watched.running() {
                continue;
            }
            tracing::debug!(service = name, pid = watched.pid, "stopping");
            // SAFETY: two integers, and a pid that has gone fails with ESRCH.
            unsafe { libc::kill(watched.pid, libc::SIGTERM) };
        }
    }
}

/// Which file is at a path, as the kernel tells them apart.
///
/// Device and inode rather than a modification time: a socket rebound in the
/// same second has the same mtime, and `dbus-daemon` and `pipewire` both unlink
/// and bind afresh, which is a new inode every time.
type Identity = (u64, u64);

fn identity_of(path: &str) -> Option<Identity> {
    use std::os::unix::fs::MetadataExt;
    std::fs::metadata(path).ok().map(|at| (at.dev(), at.ino()))
}

/// Whether a pid is still a process at all.
///
/// Signal 0 sends nothing and only asks. A child that has exited and not yet
/// been reaped still answers, which is why this is a second opinion rather than
/// the only one -- the watch's own record is the first.
fn is_alive(pid: i32) -> bool {
    // SAFETY: two integers; a pid that has gone fails with ESRCH.
    unsafe { libc::kill(pid, 0) == 0 }
}

/// The waiting itself, with the deadline passed in so a test can assert the
/// giving-up without waiting out a real one.
fn await_path(
    name: &str,
    path: &str,
    before: Option<Identity>,
    alive: &dyn Fn() -> bool,
    timeout: std::time::Duration,
) -> Result<(), Failure> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        // A *different* file than the one that was there before it started.
        //
        // Existence alone is not readiness, because `/run` is not always empty
        // when this starts. In a box it is a fresh tmpfs and anything at these
        // paths is ours; run by hand -- how a guest that will not boot is
        // debugged -- the host's own `/run` is underneath, and a socket left by
        // a previous run, or the developer's own session bus, is sitting at
        // exactly the path being waited on. Taking that as proof would start
        // everything downstream against a socket with nothing behind it, and
        // report the box initialized.
        //
        // Compared rather than deleted. Unlinking first would be the obvious
        // fix and it is the dangerous one: outside a box that path can belong
        // to something else that is alive and using it.
        let now = identity_of(path);
        if now.is_some() && now != before {
            return Ok(());
        }
        // A service that has already left will not bind anything, and waiting
        // out the full timeout for it buys nothing but a slower failure.
        if !alive() {
            return Err(Failure::new(format!(
                "{name} exited before it bound {path}"
            )));
        }
        if std::time::Instant::now() >= deadline {
            // The path, because that is the actionable half: a service that
            // binds somewhere else is indistinguishable from one that never
            // bound, and only one of those is fixed by looking at the service.
            let stale = if before.is_some() {
                ", and what is there is the file that was there before it started"
            } else {
                ""
            };
            return Err(Failure::new(format!(
                "{name}: {path} did not appear within {}s of starting it{stale}",
                timeout.as_secs()
            )));
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

#[cfg(test)]
pub mod double {
    use super::*;

    /// A stack that starts nothing, so what the session does with it is the
    /// only thing under test.
    pub struct Double {
        pub brought_up: usize,
        /// What the last `bring_up` was told, so a test can assert the limits
        /// reached the stack rather than assuming they did.
        pub video: VideoLimits,
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
                video: VideoLimits::default(),
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
        fn bring_up(&mut self, video: VideoLimits) -> Result<Vec<String>, Failure> {
            self.brought_up += 1;
            self.video = video;
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

    /// The services and the workload have to look in the same place, and it
    /// cannot be either one's runtime directory: those are 0700 and named
    /// after a uid, and these are deliberately two different users.
    #[test]
    fn audio_is_somewhere_both_users_can_reach() {
        assert!(
            !AUDIO_DIR.starts_with("/run/user/"),
            "a per-user runtime directory is 0700 and the other user is not in it"
        );
        let audio: Vec<&Service> = STACK
            .iter()
            .filter(|s| s.env.iter().any(|(k, _)| *k == "PIPEWIRE_RUNTIME_DIR"))
            .collect();
        assert!(
            !audio.is_empty(),
            "no service was told where audio lives, so none of them agree"
        );
        for service in audio {
            let told = service
                .env
                .iter()
                .find(|(k, _)| *k == "PIPEWIRE_RUNTIME_DIR")
                .map(|(_, v)| *v);
            assert_eq!(
                told,
                Some(AUDIO_DIR),
                "{} looks somewhere else",
                service.name
            );
        }
    }

    /// A service others connect to is waited for, and the path waited on is
    /// the path they are given.
    ///
    /// Two constants that have to agree and are written in two places is how
    /// three of the four crossings in ref(d-0065) broke, so they are compared
    /// here rather than trusted to stay in step.
    #[test]
    fn what_is_waited_for_is_where_the_others_are_told_to_look() {
        let bus = STACK
            .iter()
            .find(|s| s.name == "dbus-session")
            .expect("the session bus is in the table");
        let waited = bus.ready.expect(
            "without this, everything handed this bus address is started before \
             anything is listening on it",
        );
        let address = format!("unix:path={waited}");
        let clients: Vec<&Service> = STACK
            .iter()
            .filter(|s| s.env.iter().any(|(k, _)| *k == "DBUS_SESSION_BUS_ADDRESS"))
            .collect();
        assert!(!clients.is_empty(), "nothing was told where the bus is");
        for client in clients {
            let told = client
                .env
                .iter()
                .find(|(k, _)| *k == "DBUS_SESSION_BUS_ADDRESS")
                .map(|(_, v)| *v);
            assert_eq!(
                told,
                Some(address.as_str()),
                "{} connects somewhere the box never waited for",
                client.name
            );
        }

        let pipewire = STACK
            .iter()
            .find(|s| s.name == "pipewire")
            .expect("audio is in the table");
        let waited = pipewire.ready.expect("audio is connected to by everything");
        assert!(
            waited.starts_with(AUDIO_DIR),
            "audio is waited for at {waited} and served from {AUDIO_DIR}"
        );
    }

    /// A service that names no socket is ready when it has been started, and
    /// the wait has to be free in that case: most of the table is like this.
    #[test]
    fn a_service_that_names_no_socket_is_not_waited_for() {
        let hub = STACK
            .iter()
            .find(|s| s.name == "neshub")
            .expect("the hub is in the table");
        assert!(hub.ready.is_none());
        let stack = Stack::from_table(Waiters::new(), STACK);
        stack
            .await_ready(hub, None)
            .expect("a service with nothing to wait for waited anyway");
    }

    /// A file that was already there is not this service's socket.
    ///
    /// In a box `/run` is a fresh tmpfs and anything at these paths is ours.
    /// Run by hand -- which is how a guest that will not boot is debugged --
    /// the host's own `/run` is underneath, and a socket from a previous run or
    /// the developer's own session bus sits at exactly the path being waited
    /// on. Taking it as proof starts everything downstream against a socket
    /// with nothing behind it and reports the box initialized.
    #[test]
    fn a_file_that_was_there_before_is_not_proof_that_anything_started() {
        let dir = std::env::temp_dir().join(format!("nesinit-stale-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("a directory to put a stale socket in");
        let path = dir.join("bus");
        std::fs::write(&path, b"a socket from a previous run").expect("the stale file");
        let at = path.to_str().expect("a path");

        let before = identity_of(at);
        assert!(before.is_some(), "the stale file is there to be found");

        let failure = await_path(
            "dbus-session",
            at,
            before,
            &|| true,
            std::time::Duration::from_millis(50),
        )
        .expect_err("a file from before was taken as this service's socket");
        assert!(
            failure.reason.contains("before it started"),
            "the reason has to say which of the two failures this is: {}",
            failure.reason
        );

        // Replaced, which is what binding a unix socket does: both daemons
        // here unlink and bind afresh, so the inode is new.
        std::fs::remove_file(&path).expect("removing the stale file");
        std::fs::write(&path, b"the new one").expect("the new file");
        await_path(
            "dbus-session",
            at,
            before,
            &|| true,
            std::time::Duration::from_millis(50),
        )
        .expect("a different file at the path is this service's socket");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// A service that died during its own bring-up is not waited out.
    ///
    /// The timeout is fifteen seconds and a dead service will never bind, so
    /// the box would take that long to say something it already knew -- once
    /// per service, in order.
    #[test]
    fn a_service_that_has_already_left_is_not_waited_for() {
        let began = std::time::Instant::now();
        let failure = await_path(
            "pipewire",
            "/nonexistent/pipewire-0",
            None,
            &|| false,
            std::time::Duration::from_secs(15),
        )
        .expect_err("a dead service was treated as ready");
        assert!(
            failure.reason.contains("exited before it bound"),
            "{}",
            failure.reason
        );
        assert!(
            began.elapsed() < std::time::Duration::from_secs(1),
            "it waited out the timeout for a service that had already gone"
        );
    }

    /// A socket that never appears is a failure, not a wait that ends quietly.
    ///
    /// The distinction matters because the required/optional rule above acts on
    /// it: a required service that never binds has to refuse the box rather
    /// than let one boot that reports itself ready and does not work.
    #[test]
    fn a_socket_that_never_appears_is_a_failure_that_names_it() {
        let failure = await_path(
            "pipewire",
            "/nonexistent/pipewire-0",
            None,
            &|| true,
            std::time::Duration::from_millis(50),
        )
        .expect_err("a socket that is not there was treated as ready");
        assert!(failure.reason.contains("pipewire"), "{}", failure.reason);
        assert!(
            failure.reason.contains("/nonexistent/pipewire-0"),
            "{}",
            failure.reason
        );
    }

    /// A unix socket is created 0777 masked by the umask, and connecting to
    /// one needs write. The inherited 022 therefore refuses every user but the
    /// owner -- and the workload is not the owner.
    #[test]
    fn the_audio_socket_is_reachable_by_a_user_who_does_not_own_it() {
        let pipewire = STACK
            .iter()
            .find(|s| s.name == "pipewire")
            .expect("audio is in the table");
        assert_eq!(
            pipewire.umask,
            Some(0),
            "with any other umask the game finds the socket and cannot open it"
        );
    }

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
