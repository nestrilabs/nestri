// The one thing a descriptor turns into: mount what it names, run what it
// names, report how that ended.
//
// It is a trait because the two halves of it arrive at different times and
// because the interesting behaviour — one start and never a second, an exit
// reported rather than acted on — is behaviour of the caller, which a double
// can test without a VM, a share or a workload.

use std::ffi::CString;
use std::future::Future;
use std::io;
use std::os::unix::ffi::OsStringExt as _;
use std::pin::Pin;

use nesprotocol::lifecycle::{
    AttachId, Compositor, Daemon, Exec, Exit, Image, LAUNCH_ID_ENV, LaunchId, Mount, Overlay, Winsize,
};

use std::os::unix::process::CommandExt;

use crate::reap::{Waiters, Watched};

/// Why something could not be done, in the words the operating system used.
///
/// The reason is passed through verbatim on purpose: `EACCES` and a path can
/// be acted on, where "could not start the workload" cannot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failure {
    pub reason: String,
}

impl Failure {
    pub fn new(reason: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
        }
    }
}

/// Resolves when the workload ends.
pub type Exited = Pin<Box<dyn Future<Output = io::Result<Exit>> + Send>>;

/// Resolves when a mount or an unmount made off the session's loop is done.
pub type Pending = Pin<Box<dyn Future<Output = Result<(), Failure>> + Send>>;

pub trait Workload {
    /// Make the shares the descriptor names, where it says to put them.
    fn mount(&mut self, mounts: &[Mount]) -> Result<(), Failure>;

    /// Mount each read-only image the descriptor names, where it says.
    ///
    /// Before the overlays and the shares: an image is the base other mount
    /// points may be inside of, and nothing mounted yet can be under it.
    fn mount_images(&mut self, images: &[Image]) -> Result<(), Failure>;

    /// Stack each overlay the descriptor names: its build image, its writable
    /// layer, and the two together where it says.
    fn mount_overlays(&mut self, overlays: &[Overlay]) -> Result<(), Failure>;

    /// Mount one launch's content into a box that is already up: its images,
    /// then its overlays. Off the caller's thread, because the caller also
    /// carries every other launch's exits and stops. ref(d-0085)
    fn mount_launch(&mut self, images: Vec<Image>, overlays: Vec<Overlay>) -> Pending;

    /// Take down what [`Workload::mount_launch`] mounted, overlays first, so
    /// the loop devices under it clear themselves. Lazily when busy.
    fn unmount_launch(&mut self, images: Vec<Image>, overlays: Vec<Overlay>) -> Pending;

    /// Start a process on a terminal and connect it to the host on a data port
    /// of its own.
    ///
    /// Returns once the process is started or has failed to be, and no later:
    /// everything that can fail before there is anything to connect to fails
    /// here, where it can be sent up the control channel. The connection itself
    /// is made in the background.
    fn attach(&mut self, id: AttachId, exec: &Exec, size: Option<Winsize>) -> Result<(), Failure>;

    /// Start one launch's command, named by its launch.
    ///
    /// Returning the exit as a future, rather than a `wait` method, is what
    /// keeps the caller free to read the channel while the workload runs — a
    /// stop has to arrive during the workload's life or it is not a stop.
    ///
    /// Several launches may be running at once: a box is a person's machine
    /// with any of their games in it, not one game's. ref(d-0085)
    fn start(&mut self, id: &LaunchId, exec: &Exec) -> Result<Exited, Failure>;

    /// Start the box's one compositor, and return once it is serving.
    ///
    /// Owned by the box and not by any launch: every launch draws on it, so no
    /// launch's stop may reach it. ref(d-0085)
    fn start_compositor(&mut self, compositor: &Compositor) -> Result<(), Failure>;

    /// The compositor's exit, once, after [`Workload::start_compositor`] has
    /// returned. The session reports it and ends the box: a box that cannot
    /// draw is no use to anyone in it. `None` when there is no compositor or it
    /// was already taken.
    fn compositor_exit(&mut self) -> Option<Exited> {
        None
    }

    /// Start the box's daemon, and return once it is spawned.
    ///
    /// Owned by the box like the compositor, and for the same reason: every
    /// launch shares what it holds (the box's one Steam sign-in), so no launch's
    /// stop may reach it. Whether it is *working* is its own to say; this is
    /// only that it started. ref(d-0085)
    fn start_daemon(&mut self, daemon: &Daemon) -> Result<(), Failure>;

    /// The daemon's exit, once, after [`Workload::start_daemon`] has returned.
    /// `None` when there is no daemon or it was already taken.
    fn daemon_exit(&mut self) -> Option<Exited> {
        None
    }

    /// Ask one launch to stop: its whole process group, not its top process.
    /// Idempotent, and never ends the session by itself. A launch that is not
    /// running is not signalled: its pid may already belong to something else.
    ///
    /// The launch's exit is delivered when its group is gone, so it reports
    /// the game's window closed rather than only the top process having left.
    fn stop_launch(&mut self, id: &LaunchId);

    /// Ask every launch to stop. Idempotent, and never ends the session by
    /// itself.
    fn signal_stop(&mut self);
}

/// The workload as a local process.
pub struct Process {
    waiters: Waiters,
    /// Every launch started, by id. An entry stays after its exit is
    /// delivered and `Watched::running` is what tells the two apart; it is
    /// replaced when the same id is started again (a restart).
    running: std::collections::BTreeMap<LaunchId, Watched>,
    /// The group of each launch in `running`, which outlives its top process.
    groups: std::collections::BTreeMap<LaunchId, std::sync::Arc<Group>>,
    /// Where launch cgroups are made: [`CGROUP_ROOT`], except in a test.
    cgroup_root: String,
    /// The box's compositor, if it has one. Not a launch: nothing in
    /// `running` is it, and a launch's stop cannot reach it.
    compositor: Option<Watched>,
    /// The compositor's exit, until the session takes it. See
    /// [`Workload::compositor_exit`].
    compositor_exit: Option<Exited>,
    /// The box's daemon, if it has one. Like the compositor, not a launch.
    daemon: Option<Watched>,
    /// The daemon's exit, until the session takes it.
    daemon_exit: Option<Exited>,
    /// Where the daemon is announced to the box's launches: [`DAEMON_MARKER`],
    /// except in a test.
    daemon_marker: String,
}

/// The file that says this box has a daemon, holding its name.
///
/// Written before the daemon is spawned and so before the box is ready, which
/// is before any launch can exist: a launch that finds it knows the daemon is
/// there to be waited for, and one that does not find it knows there is none to
/// wait for. Anything else a launch could look at (the daemon's own state) is
/// not there yet in the first moments of a box, and a launch that read its
/// absence as "no daemon" would do what the daemon is for by itself.
pub const DAEMON_MARKER: &str = "/run/nestri/daemon";

/// How long a launch's group has to leave after being asked before it is
/// killed.
pub(crate) const STOP_GRACE: std::time::Duration = std::time::Duration::from_secs(5);

/// The compositor's socket, in its user's runtime directory. nescope's own
/// default, and what a launch is told to join.
pub(crate) const COMPOSITOR_SOCKET: &str = "nescope-0";

/// The compositor's binary in the guest image.
const COMPOSITOR_BIN: &str = "/usr/bin/nescope";

/// How long the compositor has to publish its socket.
const COMPOSITOR_READY: std::time::Duration = std::time::Duration::from_secs(15);

/// Every live process in session `sid`.
///
/// A launch is started in a session of its own (`setsid`), so its session id is
/// its top pid and everything it starts inherits it. Read from `/proc` rather
/// than asked of the kernel with `kill(-pgid)` alone because a Wine or a
/// launcher may move its own children to groups of their own, and a group that
/// has been left is still in the session. Zombies are not members: the reaper
/// clears them, and waiting on one would wait on nobody.
pub(crate) fn session_members(sid: i32) -> Vec<i32> {
    let Ok(dir) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };
    dir.flatten()
        .filter_map(|entry| entry.file_name().to_str()?.parse::<i32>().ok())
        .filter(|pid| in_session(*pid, sid))
        .collect()
}

/// Whether `pid` is a live (not zombie) member of session `sid`.
fn in_session(pid: i32, sid: i32) -> bool {
    std::fs::read_to_string(format!("/proc/{pid}/stat"))
        .ok()
        .and_then(|stat| live_session_of(&stat))
        == Some(sid)
}

/// The session a `/proc/<pid>/stat` line belongs to, or `None` for a process
/// that is a zombie or whose line cannot be read.
///
/// `pid (comm) state ppid pgrp session ...`, with a comm that may hold spaces
/// and parentheses, so it is the last `)` that ends it.
fn live_session_of(stat: &str) -> Option<i32> {
    let (_, after) = stat.rsplit_once(')')?;
    let mut fields = after.split_whitespace();
    let state = fields.next()?;
    let session = fields.nth(2)?.parse::<i32>().ok()?;
    (state != "Z" && state != "X").then_some(session)
}

/// Where launch cgroups live: the cgroup v2 root, mounted by `filesystems`.
const CGROUP_ROOT: &str = "/sys/fs/cgroup";

/// Everything that belongs to one launch.
///
/// A session is not enough: Wine `setsid`s its own processes (wineserver,
/// services.exe, explorer.exe and the game itself each have a session of their
/// own), so a stop that signalled the launch's session left the game running
/// with its window open. Measured 2026-10-18 on the test box.
///
/// What a child cannot leave is a cgroup, so a launch is put in one before it
/// execs and the kernel's own list of its members is what is signalled. Where
/// no cgroup could be made (v2 not mounted) the members are the launch's
/// session plus every process whose environment names the launch, which Wine
/// cannot drop either: it is inherited.
#[derive(Debug)]
pub(crate) struct Group {
    id: String,
    /// The top process, which is also the session id.
    sid: i32,
    cgroup: Option<std::path::PathBuf>,
    /// Set when the same id is started again: this group is no longer the
    /// launch's, and nothing waiting on it may act for the launch.
    superseded: std::sync::atomic::AtomicBool,
}

/// Numbers each group, so two launches of one id never share a cgroup.
static GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// An id as a directory name: only what is safe in a path.
fn sanitise(id: &str) -> String {
    id.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '_' })
        .collect()
}

/// Make the cgroup for launch `id`, generation `generation`, under `base`, or
/// `None` when it cannot be (no cgroup v2, no permission, or one of that name
/// already). The generation is in the name so a restart never shares a
/// directory with what is left of the launch before it.
fn make_cgroup(base: &str, id: &str, generation: u64) -> Option<std::path::PathBuf> {
    let path = std::path::Path::new(base).join(format!("nestri-launch-{}-{generation}", sanitise(id)));
    match std::fs::create_dir(&path) {
        Ok(()) => Some(path),
        Err(error) => {
            tracing::warn!(%id, base, "no cgroup for this launch ({error}); its members are found by environment");
            None
        }
    }
}

/// Whether `pid` is listed in the cgroup at `path`: the proof the launch's
/// child joined it, which its own unchecked write could not give.
fn joined(path: &std::path::Path, pid: i32) -> bool {
    std::fs::read_to_string(path.join("cgroup.procs"))
        .map(|procs| procs.lines().any(|line| line.trim().parse::<i32>().ok() == Some(pid)))
        .unwrap_or(false)
}

/// Whether `pid` is not a zombie.
fn is_live(pid: i32) -> bool {
    std::fs::read_to_string(format!("/proc/{pid}/stat"))
        .ok()
        .and_then(|stat| live_session_of(&stat))
        .is_some()
}

/// Whether the NUL-separated environment `environ` carries `NAME=value`.
fn environ_names(environ: &[u8], id: &str) -> bool {
    let want = format!("{LAUNCH_ID_ENV}={id}");
    environ.split(|b| *b == 0).any(|entry| entry == want.as_bytes())
}

impl Group {
    /// The group of a launch whose top process is `sid`.
    fn new(id: &LaunchId, sid: i32, cgroup: Option<std::path::PathBuf>) -> Self {
        Self { id: id.as_str().to_string(), sid, cgroup, superseded: false.into() }
    }

    /// Whether the launch has been started again since this group was made.
    fn is_superseded(&self) -> bool {
        self.superseded.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// Every live process of the launch.
    pub(crate) fn members(&self) -> Vec<i32> {
        if let Some(path) = &self.cgroup {
            if let Ok(procs) = std::fs::read_to_string(path.join("cgroup.procs")) {
                let found: Vec<i32> = procs
                    .lines()
                    .filter_map(|line| line.trim().parse::<i32>().ok())
                    .filter(|pid| is_live(*pid))
                    .collect();
                // An empty cgroup with the top process alive is a cgroup the
                // launch is not in: the scan below is what finds it.
                if !found.is_empty() || !in_session(self.sid, self.sid) {
                    return found;
                }
            }
        }
        let mut members = session_members(self.sid);
        if let Ok(dir) = std::fs::read_dir("/proc") {
            for pid in dir.flatten().filter_map(|e| e.file_name().to_str()?.parse::<i32>().ok()) {
                if members.contains(&pid) || !is_live(pid) {
                    continue;
                }
                let named = std::fs::read(format!("/proc/{pid}/environ"))
                    .map(|environ| environ_names(&environ, &self.id))
                    .unwrap_or(false);
                if named {
                    members.push(pid);
                }
            }
        }
        members
    }

    /// Signal everything of the launch.
    pub(crate) fn signal(&self, signal: libc::c_int) {
        let members = self.members();
        if members.is_empty() {
            // Only a number again: a group call now could reach whatever the
            // kernel gave it to.
            return;
        }
        // SAFETY: integers only; a group that has gone fails with ESRCH.
        unsafe { libc::kill(-self.sid, signal) };
        for pid in members {
            // SAFETY: as above.
            unsafe { libc::kill(pid, signal) };
        }
    }

    /// End everything of the launch now, with no chance to refuse.
    pub(crate) fn kill(&self) {
        if let Some(path) = &self.cgroup {
            if std::fs::write(path.join("cgroup.kill"), "1").is_ok() {
                return;
            }
            // Before Linux 5.14 there is no `cgroup.kill`: kill by pid.
        }
        self.signal(libc::SIGKILL);
    }

    /// Remove the launch's cgroup, once it is empty. A zombie still counts as
    /// a member to the kernel until it is reaped, so `EBUSY` is retried for a
    /// moment before it is given up on.
    async fn remove(&self) {
        let Some(path) = &self.cgroup else { return };
        let mut error = None;
        for _ in 0..40 {
            match std::fs::remove_dir(path) {
                Ok(()) => return,
                Err(e) if e.kind() == io::ErrorKind::NotFound => return,
                Err(e) => error = Some(e),
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        if let Some(error) = error {
            tracing::warn!(path = %path.display(), "a launch's cgroup was not removed: {error}");
        }
    }
}

/// Wait for a launch's group to be gone, ending it if it will not go alone.
///
/// Reached once the top process has been reaped. When it leaves, whatever it
/// started is ended with it (TERM, then KILL after the grace): a launch is not
/// reported ended while something of it is still running, and what it left
/// behind is not kept alive.
async fn group_gone(group: std::sync::Arc<Group>) {
    if group.members().is_empty() {
        group.remove().await;
        return;
    }
    tracing::info!(sid = group.sid, "a launch's top process has gone and its group has not: ending the group");
    group.signal(libc::SIGTERM);
    let deadline = std::time::Instant::now() + STOP_GRACE;
    let mut killed = false;
    // Past the grace plus as long again: a process in uninterruptible sleep
    // ignores SIGKILL, and a launch that never ends is worse than one that
    // ended with something stuck in it.
    let give_up = deadline + STOP_GRACE * 2;
    loop {
        if group.members().is_empty() {
            group.remove().await;
            return;
        }
        let now = std::time::Instant::now();
        if now >= give_up {
            tracing::warn!(sid = group.sid, "a launch's group would not die; reporting the launch ended anyway");
            group.remove().await;
            return;
        }
        if now >= deadline && !killed {
            killed = true;
            group.kill();
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

/// Stop a group: TERM now, then `cgroup.kill` (or KILL) after the grace if it
/// is still there. On a thread of its own, because the caller cannot wait and
/// the runtime may be busy with the exits it is meant to deliver.
fn stop_group(group: std::sync::Arc<Group>) {
    group.signal(libc::SIGTERM);
    std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + STOP_GRACE;
        while std::time::Instant::now() < deadline {
            // The launch was started again under this id: what is in the
            // environment-named fallback is now the new launch's, and a kill
            // here would be its death.
            if group.is_superseded() || group.members().is_empty() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        if !group.is_superseded() {
            group.kill();
        }
    });
}

impl Process {
    /// Started through the reaper's registry, because the reaper is the only
    /// thing in this component that may call `wait`.
    pub fn new(waiters: Waiters) -> Self {
        Self {
            waiters,
            running: std::collections::BTreeMap::new(),
            groups: std::collections::BTreeMap::new(),
            cgroup_root: CGROUP_ROOT.to_string(),
            compositor: None,
            compositor_exit: None,
            daemon: None,
            daemon_exit: None,
            daemon_marker: DAEMON_MARKER.to_string(),
        }
    }

    /// Send a signal to the workload and nothing else.
    ///
    /// The launches' top processes only, never every process: the order a
    /// shutdown promises is only true if the workload can be stopped alone.
    /// The one exception is SIGKILL, which is the end of the order and takes
    /// each launch's whole group; a launch's own stop does too
    /// ([`Workload::stop_launch`]).
    pub fn signal(&self, signal: libc::c_int) {
        for watched in self.running.values() {
            Self::signal_one(watched, signal);
        }
        if signal == libc::SIGKILL {
            for group in self.groups.values() {
                group.kill();
            }
        }
    }

    fn signal_one(watched: &Watched, signal: libc::c_int) {
        // Nothing is signalled once the exit has been delivered. The pid was
        // freed by the reap that produced it, and the kernel is entitled to
        // give that number to something else — a stop or a kill aimed at it
        // then lands on a process nobody meant.
        if !watched.running() {
            return;
        }
        // SAFETY: two integers, and it cannot touch this process's memory. A
        // pid that has already gone fails with ESRCH, which is exactly the
        // idempotence the callers of this rely on.
        unsafe { libc::kill(watched.pid, signal) };
    }

    /// Wait up to `grace` for the workload to leave, without a runtime.
    ///
    /// Used on the way down, after the reaper has stopped: it polls for the
    /// one pid rather than for any child, so a slow service cannot be mistaken
    /// for the workload still running.
    pub fn await_exit(&self, grace: std::time::Duration) -> bool {
        let deadline = std::time::Instant::now() + grace;
        self.running
            .values()
            .all(|watched| Self::await_one(watched, deadline))
    }

    fn await_one(watched: &Watched, deadline: std::time::Instant) -> bool {
        if !watched.running() {
            return true; // already reaped, and its exit already reported
        }
        let pid = watched.pid;
        loop {
            let mut status: libc::c_int = 0;
            // SAFETY: waitpid writes only into `status`.
            let seen = unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) };
            // -1 is ECHILD: already reaped, which is also gone.
            if seen == pid || seen == -1 {
                return true;
            }
            if std::time::Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }
}

impl Workload for Process {
    fn mount(&mut self, mounts: &[Mount]) -> Result<(), Failure> {
        for share in mounts {
            // Stops at the first failure rather than mounting what it can: a
            // workload given some of its shares fails later, somewhere else,
            // for a reason nobody can see from here.
            mount_share(share)?;
        }
        Ok(())
    }

    fn mount_images(&mut self, images: &[Image]) -> Result<(), Failure> {
        for image in images {
            mount_image(image)?;
        }
        Ok(())
    }

    fn attach(&mut self, id: AttachId, exec: &Exec, size: Option<Winsize>) -> Result<(), Failure> {
        use nesprotocol::lifecycle::ATTACH_PORT;
        use tokio_vsock::{VMADDR_CID_HOST, VsockAddr, VsockStream};

        let shell = crate::attach::spawn(&self.waiters, exec, size)?;
        tracing::info!(attach = %id, pid = shell.pid(), uid = exec.uid, "a shell was started");
        tokio::spawn(async move {
            // Dialled once. The host is listening before it asks, so a refused
            // connection means it stopped wanting the shell, and `shell`
            // dropping at the end of this task is what hangs it up.
            let address = VsockAddr::new(VMADDR_CID_HOST, ATTACH_PORT);
            let stream = match VsockStream::connect(address).await {
                Ok(stream) => stream,
                Err(error) => {
                    tracing::warn!(attach = %id, %error, "could not reach the host for a shell");
                    return;
                }
            };
            match crate::attach::serve(shell, &id, stream).await {
                Ok(()) => tracing::info!(attach = %id, "a shell ended"),
                Err(error) => tracing::warn!(attach = %id, %error, "a shell's connection failed"),
            }
        });
        Ok(())
    }

    fn mount_overlays(&mut self, overlays: &[Overlay]) -> Result<(), Failure> {
        for overlay in overlays {
            mount_overlay(overlay)?;
        }
        Ok(())
    }

    fn mount_launch(&mut self, images: Vec<Image>, overlays: Vec<Overlay>) -> Pending {
        off_loop(move || {
            for image in &images {
                mount_image(image)?;
            }
            for overlay in &overlays {
                mount_overlay(overlay)?;
            }
            Ok(())
        })
    }

    fn unmount_launch(&mut self, images: Vec<Image>, overlays: Vec<Overlay>) -> Pending {
        off_loop(move || {
            // Everything is attempted, and the first failure is the one said.
            let mut first = None;
            let mut note = |result: Result<(), Failure>| {
                if let Err(failure) = result {
                    first.get_or_insert(failure);
                }
            };
            for overlay in overlays.iter().rev() {
                match OverlayPlan::new(overlay) {
                    Ok(plan) => {
                        for at in [&plan.at, &plan.rw_at, &plan.lower_at] {
                            note(unmount_one(at));
                        }
                    }
                    Err(failure) => note(Err(failure)),
                }
            }
            for image in images.iter().rev() {
                match ImagePlan::new(image) {
                    Ok(plan) => note(unmount_one(&plan.at)),
                    Err(failure) => note(Err(failure)),
                }
            }
            first.map_or(Ok(()), Err)
        })
    }

    fn start(&mut self, id: &LaunchId, exec: &Exec) -> Result<Exited, Failure> {
        let Some((program, args)) = exec.argv.split_first() else {
            return Err(Failure::new("the command is empty"));
        };

        // The standard library's process rather than the runtime's: the
        // runtime reaps the children it spawns, and in this component reaping
        // belongs to one place. See `reap::Waiters`.
        let mut command = std::process::Command::new(program);
        command.args(args);
        // Cleared rather than inherited: init's environment is the kernel's
        // and says nothing a workload should read.
        command.env_clear();
        if let Some(cwd) = &exec.cwd {
            command.current_dir(cwd);
        }

        let (uid, gid) = (exec.uid, exec.gid);

        // Made here, in the parent, because this process is the one with the
        // privilege to own it to somebody else -- and made before the spawn
        // rather than in `system::prepare`, because the uid it is named after
        // arrives with the launch and is not known at boot.
        //
        // A warning rather than a refusal: a workload that draws nothing needs
        // no runtime directory, and refusing the launch would turn "audio has
        // nowhere to put a socket" into "the box does not start".
        let runtime = match crate::system::runtime_dir(uid, gid) {
            Ok(path) => {
                tracing::info!(%path, uid, "the launch has a runtime directory");
                Some(path)
            }
            Err(error) => {
                tracing::warn!(
                    uid,
                    "no runtime directory for this launch, so anything reading \
                     XDG_RUNTIME_DIR fails on it: {error}"
                );
                None
            }
        };
        command.envs(launch_environment(exec, runtime.as_deref(), id));

        // The launch's cgroup, made here and joined before exec: what a child
        // that makes its own session still cannot leave. The path is built
        // now because the closure below may not allocate.
        let generation = GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let cgroup = make_cgroup(&self.cgroup_root, id.as_str(), generation);
        let procs_file = cgroup
            .as_ref()
            .and_then(|path| std::ffi::CString::new(path.join("cgroup.procs").into_os_string().into_vec()).ok());

        // SAFETY: the closure runs between fork and exec in the child, where
        // only async-signal-safe calls are allowed. These are, and it
        // allocates nothing.
        unsafe {
            command.pre_exec(move || {
                // A session of its own: the launch is a group that can be
                // stopped alone, which is what makes one launch's stop leave
                // another's windows open. Before the drops below, which do
                // not care.
                if libc::setsid() == -1 {
                    return Err(io::Error::last_os_error());
                }
                // Into the launch's cgroup, as root, before the uid drops.
                // A failure is not one here, where nothing may be said: the
                // parent checks the child is in the cgroup after the spawn and
                // falls back to the environment when it is not.
                if let Some(file) = &procs_file {
                    let fd = libc::open(file.as_ptr(), libc::O_WRONLY | libc::O_CLOEXEC);
                    if fd >= 0 {
                        libc::write(fd, b"0".as_ptr().cast(), 1);
                        libc::close(fd);
                    }
                }
                // gid first: dropping the uid first would lose the privilege
                // needed to set the gid at all.
                if libc::setgid(gid) != 0 {
                    return Err(io::Error::last_os_error());
                }
                if libc::setuid(uid) != 0 {
                    return Err(io::Error::last_os_error());
                }
                Ok(())
            });
        }

        let mut watched = self
            .waiters
            .watch(|| Ok(command.spawn()?.id() as i32))
            .map_err(|error| {
                if let Some(path) = &cgroup {
                    let _ = std::fs::remove_dir(path);
                }
                // The program, the user, and what the system said.
                //
                // `Permission denied` on its own is the least useful true
                // sentence available here: it is equally consistent with a
                // share the caller exported without letting this user read it,
                // a binary that is not executable, and a mount that forbids
                // execution. The one thing a reader needs is which file, and
                // as whom. Measured 2026-09-12: a launch refused with the bare
                // message cost a search of three machines' permissions.
                Failure::new(format!("{program} as {}:{}: {error}", exec.uid, exec.gid))
            })?;

        // The caller gets the exit and reports it; this handle keeps the pid
        // and whether that pid is still this child's.
        let exit = watched.take_exit().expect("a new watch has its exit");
        // A launch that ended leaves its entry behind until its id is used
        // again; dropping those here keeps the map the size of what runs.
        self.running.retain(|_, watched| watched.running());
        self.running.insert(id.clone(), watched);

        // The session id is the top pid (`setsid` above), and stays that
        // number for as long as anything is in it.
        let sid = self.running.get(id).map(|w| w.pid).expect("just inserted");
        // The join was unchecked in the child. A cgroup the child is not in
        // would read as an empty launch, and a stop of it would do nothing, so
        // it is dropped for the session-and-environment fallback.
        let cgroup = match cgroup {
            Some(path) if !joined(&path, sid) => {
                tracing::warn!(
                    %id,
                    path = %path.display(),
                    "the launch did not join its cgroup; its members are found by environment"
                );
                let _ = std::fs::remove_dir(&path);
                None
            }
            other => other,
        };
        // Groups with nothing left in them are dropped here, as `running` is.
        self.groups.retain(|_, group| !group.members().is_empty());
        let group = std::sync::Arc::new(Group::new(id, sid, cgroup));
        if let Some(old) = self.groups.insert(id.clone(), group.clone()) {
            old.superseded.store(true, std::sync::atomic::Ordering::SeqCst);
        }
        Ok(Box::pin(async move {
            let exit = exit
                .await
                .map_err(|_| io::Error::other("the workload's exit was not delivered"))?;
            // The launch ended when its group has, not when its top process
            // did. See `group_gone`.
            group_gone(group).await;
            Ok(exit)
        }))
    }

    fn start_compositor(&mut self, compositor: &Compositor) -> Result<(), Failure> {
        let (uid, gid) = (compositor.uid, compositor.gid);
        let runtime = crate::system::runtime_dir(uid, gid).map_err(|error| {
            Failure::new(format!("no runtime directory for the compositor (uid {uid}): {error}"))
        })?;
        let exec = Exec {
            argv: vec![
                COMPOSITOR_BIN.to_string(),
                "--width".into(),
                compositor.width.to_string(),
                "--height".into(),
                compositor.height.to_string(),
                "--fps".into(),
                compositor.fps.to_string(),
            ],
            env: compositor.env.clone(),
            cwd: None,
            uid,
            gid,
        };
        let mut command = std::process::Command::new(&exec.argv[0]);
        command.args(&exec.argv[1..]);
        command.env_clear();
        command.envs(environment(&exec, Some(&runtime)));
        // SAFETY: async-signal-safe calls only, nothing allocated.
        unsafe {
            command.pre_exec(move || {
                if libc::setsid() == -1 {
                    return Err(io::Error::last_os_error());
                }
                if libc::setgid(gid) != 0 {
                    return Err(io::Error::last_os_error());
                }
                if libc::setuid(uid) != 0 {
                    return Err(io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let socket = format!("{runtime}/{COMPOSITOR_SOCKET}");
        let before = crate::services::identity_of(&socket);
        let mut watched = self
            .waiters
            .watch(|| Ok(command.spawn()?.id() as i32))
            .map_err(|error| {
                Failure::new(format!("{} as {uid}:{gid}: {error}", exec.argv[0]))
            })?;
        let exit = watched.take_exit().expect("a new watch has its exit");
        let pid = watched.pid;
        let flag = &watched;
        if let Err(failure) = crate::services::await_path(
            "the compositor",
            &socket,
            before,
            &|| flag.running(),
            COMPOSITOR_READY,
        ) {
            // One that never served is not left running behind a box that
            // reports it could not be made.
            if watched.running() {
                // SAFETY: two integers; the pid is still this child's.
                unsafe { libc::kill(-pid, libc::SIGKILL) };
                unsafe { libc::kill(pid, libc::SIGKILL) };
            }
            return Err(failure);
        }
        tracing::info!(pid, %socket, "the compositor is serving");
        // Handed to the session, which reports it and ends the box: with it
        // gone no launch has anywhere to draw.
        self.compositor_exit = Some(Box::pin(async move {
            exit.await.map_err(|_| io::Error::other("the compositor's exit was not delivered"))
        }));
        self.compositor = Some(watched);
        Ok(())
    }

    fn compositor_exit(&mut self) -> Option<Exited> {
        self.compositor_exit.take()
    }

    fn start_daemon(&mut self, daemon: &Daemon) -> Result<(), Failure> {
        let exec = &daemon.exec;
        let Some((program, args)) = exec.argv.split_first() else {
            return Err(Failure::new(format!("the {} daemon has no command", daemon.name)));
        };
        let (uid, gid) = (exec.uid, exec.gid);
        let runtime = crate::system::runtime_dir(uid, gid).map_err(|error| {
            Failure::new(format!(
                "no runtime directory for the {} daemon (uid {uid}): {error}",
                daemon.name
            ))
        })?;
        // Before the spawn: see [`DAEMON_MARKER`]. A failure here refuses the
        // box, because a launch that could not tell would start its own.
        if let Some(directory) = std::path::Path::new(&self.daemon_marker).parent() {
            std::fs::create_dir_all(directory).map_err(|error| {
                Failure::new(format!("could not make {}: {error}", directory.display()))
            })?;
        }
        std::fs::write(&self.daemon_marker, &daemon.name).map_err(|error| {
            Failure::new(format!("could not write {}: {error}", self.daemon_marker))
        })?;

        let mut command = std::process::Command::new(program);
        command.args(args);
        command.env_clear();
        if let Some(cwd) = &exec.cwd {
            command.current_dir(cwd);
        }
        command.envs(environment(exec, Some(&runtime)));
        // SAFETY: async-signal-safe calls only, nothing allocated.
        unsafe {
            command.pre_exec(move || {
                if libc::setsid() == -1 {
                    return Err(io::Error::last_os_error());
                }
                if libc::setgid(gid) != 0 {
                    return Err(io::Error::last_os_error());
                }
                if libc::setuid(uid) != 0 {
                    return Err(io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let mut watched = self
            .waiters
            .watch(|| Ok(command.spawn()?.id() as i32))
            .map_err(|error| Failure::new(format!("{program} as {uid}:{gid}: {error}")))?;
        let exit = watched.take_exit().expect("a new watch has its exit");
        let name = daemon.name.clone();
        tracing::info!(pid = watched.pid, %name, "the box's daemon is started");
        self.daemon_exit = Some(Box::pin(async move {
            exit.await
                .map_err(|_| io::Error::other(format!("the {name} daemon's exit was not delivered")))
        }));
        self.daemon = Some(watched);
        Ok(())
    }

    fn daemon_exit(&mut self) -> Option<Exited> {
        self.daemon_exit.take()
    }

    fn stop_launch(&mut self, id: &LaunchId) {
        if let Some(group) = self.groups.get(id) {
            // Whether or not the top process is still there: its children may
            // be, and they are what holds the window.
            stop_group(group.clone());
        }
    }

    fn signal_stop(&mut self) {
        self.signal(libc::SIGTERM);
    }
}

/// A launch's environment: everything [`environment`] gives, then its id.
///
/// The id goes last so nothing in the caller's environment can name a launch
/// other than the one this is. ref(d-0085)
pub(crate) fn launch_environment(
    exec: &Exec,
    runtime: Option<&str>,
    id: &LaunchId,
) -> Vec<(String, String)> {
    let mut env = environment(exec, runtime);
    env.retain(|(k, _)| k != LAUNCH_ID_ENV);
    env.push((LAUNCH_ID_ENV.to_string(), id.as_str().to_string()));
    env
}

/// Everything a launch is started with, in the order that decides ties.
///
/// The image's own graphics settings first and the caller's environment last,
/// so a host can override anything here. A host that knows better than this
/// image about this box is unlikely, but it should not have to patch an image
/// to say so.
///
/// A function rather than two calls on the command, because the two calls
/// could be -- and for one commit were -- reduced to one by an edit that
/// dropped the first. The only thing that noticed was a dead-code warning.
///
/// `runtime` is the directory made for this launch's user, or `None` when it
/// could not be made. **Making it and not naming it is the same as not making
/// it**: the environment is cleared, so nothing a workload inherits points at
/// it, and every toolkit that wants one reads `XDG_RUNTIME_DIR`. A client that
/// finds the variable unset does not fail loudly -- the compositor here falls
/// back to `/tmp` -- so the sockets land somewhere world-writable and shared
/// with every other user, and everything reports success. ref(d-0065)
pub(crate) fn environment(exec: &Exec, runtime: Option<&str>) -> Vec<(String, String)> {
    GRAPHICS
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .chain(runtime.map(|path| ("XDG_RUNTIME_DIR".to_string(), path.to_string())))
        .chain(exec.env.iter().map(|(k, v)| (k.clone(), v.clone())))
        .collect()
}

/// What the image's own graphics stack needs said out loud.
///
/// # Why this is here and not in a profile script
///
/// There is one in the image, and it has never run: every process in a box is
/// exec'd by this component with `env_clear`, and nothing starts a login
/// shell. A `profile.d` file is for a person who logged in, and nobody does.
///
/// # Why it has to be said at all
///
/// The image ships a Mesa with exactly one gallium driver, `zink`, on purpose:
/// OpenGL is translated to Vulkan so that the capture layer -- which is a
/// Vulkan layer -- sees the frames of a game that draws in GL. A game whose GL
/// reached a native driver would render correctly and be captured as nothing,
/// which is the worst shape a failure can have here.
///
/// But the loader picks a driver by the *kernel device's* name. It looks for
/// one called `virtio_gpu`, finds that the only driver built is `zink`, and
/// gives up with `virtio_gpu: driver missing`. It does not fall back, and
/// `zink` is never chosen for an arbitrary device on its own. So it is named.
///
/// Measured 2026-09-12: without these, every process that touched the GPU
/// failed to create an EGL screen, in a box whose Vulkan drivers were both
/// present and loadable.
const GRAPHICS: &[(&str, &str)] = &[
    ("MESA_LOADER_DRIVER_OVERRIDE", "zink"),
    ("GALLIUM_DRIVER", "zink"),
    // For anything that goes through libglvnd. Harmless where nothing does.
    ("__GLX_VENDOR_LIBRARY_NAME", "mesa"),
    // **Intel's Vulkan Video is off unless asked for.** Its driver gates the
    // video encode and decode extensions behind this, so on an Intel host the
    // capture layer finds no encode support, produces nothing, and says
    // nothing about why -- a box that streams a black screen while every
    // component reports success.
    //
    // Read only by Intel's driver, so it costs nothing on a host with any
    // other GPU. Measured 2026-09-12 on an Arc A310: without it, capture
    // produced no output at all.
    ("ANV_DEBUG", "video-encode,video-decode"),
    // **Audio is not under this user's runtime directory.** The services that
    // serve it run as somebody else, so the socket lives somewhere both can
    // reach and both are told where. Without this a game renders and plays
    // silently, having looked under its own uid and found nothing.
    ("PIPEWIRE_RUNTIME_DIR", crate::services::AUDIO_DIR),
    // And the same for PulseAudio, which most applications speak.
    ("PULSE_SERVER", concat!("unix:", "/run/pipewire/pulse-native")),
];

/// Mount one share where the descriptor says to put it.
///
/// The tag names an export; nothing here is a path on the other side of the
/// channel, so the guest still learns nothing about the filesystem it is being
/// handed a piece of.
fn mount_share(share: &Mount) -> Result<(), Failure> {
    // Checked before anything is created: a descriptor this component cannot
    // act on should leave no directory behind to confuse whoever reads the
    // failure.
    let (source, target, flags) = options(share)?;

    // The mount point may not exist yet: a share can land anywhere the
    // descriptor names, including a directory no image created.
    std::fs::create_dir_all(&share.at).map_err(|error| failed(share, error))?;

    // SAFETY: mount takes two paths, a filesystem name and a flag word, all
    // of which outlive the call, and no options string.
    let mounted = unsafe {
        libc::mount(
            source.as_ptr(),
            target.as_ptr(),
            FSTYPE.as_ptr(),
            flags,
            std::ptr::null(),
        )
    };
    if mounted != 0 {
        return Err(failed(share, io::Error::last_os_error()));
    }
    Ok(())
}

/// The shares arrive over a virtio transport, which is the only kind of
/// filesystem this mounts. A descriptor cannot name another.
const FSTYPE: &std::ffi::CStr = c"virtiofs";

/// Stack one overlay: the build image, the box's writable layer, and the two
/// together at `at`.
///
/// Each step's failure names the step, because "the install did not mount"
/// has three different causes and each one is fixed somewhere else: a build
/// image the kernel cannot read, an upper layer that was never formatted, and
/// an overlay the kernel refused.
fn mount_overlay(overlay: &Overlay) -> Result<(), Failure> {
    // Everything that can be refused without touching the filesystem is
    // refused first, so a descriptor this cannot act on leaves nothing behind.
    let plan = OverlayPlan::new(overlay)?;
    let (lower, _lower_held) = device_for(&plan.lower, true)
        .map_err(|error| plan.failed("the build image", &plan.lower, error))?;
    let (upper, _upper_held) = device_for(&plan.upper, false)
        .map_err(|error| plan.failed("the writable layer", &plan.upper, error))?;

    mount_one(
        &lower,
        &plan.lower_at,
        c"erofs",
        plan.lower_flags,
        None,
    )
    .map_err(|error| plan.failed("the build image", &plan.lower_at, error))?;
    mount_one(&upper, &plan.rw_at, c"ext4", plan.upper_flags, None)
        .map_err(|error| plan.failed("the writable layer", &plan.rw_at, error))?;

    for dir in [&plan.upper_dir, &plan.work_dir] {
        std::fs::create_dir_all(as_path(dir))
            .map_err(|error| plan.failed("the writable layer", dir, error))?;
    }
    // **The upper directory takes the build's root ownership.** overlayfs
    // shows a merged directory with the attributes of its upper half when it
    // has one, and this one always does -- so an upper directory this init
    // created, `root:root 0755`, would make the install's top directory
    // unwritable to the workload, whatever the build image says. Copied from
    // the lower root rather than named here: which uid the workload runs as is
    // the host's decision, and the host already made it when it packed the
    // image.
    let (uid, gid, mode) = ownership(&plan.lower_at)
        .map_err(|error| plan.failed("the build image", &plan.lower_at, error))?;
    set_ownership(&plan.upper_dir, uid, gid, mode)
        .map_err(|error| plan.failed("the writable layer", &plan.upper_dir, error))?;

    mount_one(
        c"overlay",
        &plan.at,
        c"overlay",
        plan.overlay_flags,
        Some(&plan.overlay_data),
    )
    .map_err(|error| plan.failed("the overlay", &plan.at, error))?;
    Ok(())
}

/// What mounting a read-only image is given, worked out before anything is
/// attempted, for the reason an overlay's plan is: the part worth asserting is
/// the part that needs no privilege.
///
/// `nosuid` and `nodev` like every other layer, and not `noexec`: what is in an
/// image is run from it.
#[derive(Debug)]
struct ImagePlan {
    device: CString,
    at: CString,
    flags: libc::c_ulong,
}

impl ImagePlan {
    fn new(image: &Image) -> Result<Self, Failure> {
        // Nothing at all is mounted over the root, and a relative mount point
        // would land wherever the init's working directory happens to be.
        let at = std::path::Path::new(&image.at);
        if !at.is_absolute() || at.parent().is_none() {
            return Err(Failure::new(format!(
                "an image cannot be mounted at {:?}: the mount point has to be an \
                 absolute path below the root",
                image.at
            )));
        }
        Ok(Self {
            device: c_string(&image.device, "the image device")?,
            at: c_string(&image.at, "the image mount point")?,
            flags: libc::MS_NOSUID | libc::MS_NODEV | libc::MS_RDONLY,
        })
    }

    /// The mount point and the device, in the operating system's words.
    fn failed(&self, error: io::Error) -> Failure {
        Failure::new(format!(
            "{}: the image {}: {error}",
            self.at.to_string_lossy(),
            self.device.to_string_lossy()
        ))
    }
}

/// Mount one read-only image where the descriptor says.
fn mount_image(image: &Image) -> Result<(), Failure> {
    let plan = ImagePlan::new(image)?;
    let (device, _held) = device_for(&plan.device, true).map_err(|error| plan.failed(error))?;
    mount_one(&device, &plan.at, c"erofs", plan.flags, None).map_err(|error| plan.failed(error))
}

/// Run blocking filesystem work on the runtime's blocking pool.
fn off_loop(work: impl FnOnce() -> Result<(), Failure> + Send + 'static) -> Pending {
    Box::pin(async move {
        tokio::task::spawn_blocking(work)
            .await
            .unwrap_or_else(|error| Err(Failure::new(format!("the mount work did not finish: {error}"))))
    })
}

/// Unmount one filesystem, lazily if it is still in use: a launch that has
/// exited can leave a child holding a file open, and the mount must still go
/// so the loop device under it is freed when that child does.
fn unmount_one(target: &std::ffi::CStr) -> Result<(), Failure> {
    // SAFETY: a nul-terminated path that outlives the call.
    if unsafe { libc::umount2(target.as_ptr(), 0) } == 0 {
        return Ok(());
    }
    let error = io::Error::last_os_error();
    match error.raw_os_error() {
        // Never mounted, or already gone: what was asked for.
        Some(libc::EINVAL) | Some(libc::ENOENT) => Ok(()),
        Some(libc::EBUSY) => {
            // SAFETY: as above.
            if unsafe { libc::umount2(target.as_ptr(), libc::MNT_DETACH) } == 0 {
                Ok(())
            } else {
                Err(Failure::new(format!(
                    "{}: {}",
                    target.to_string_lossy(),
                    io::Error::last_os_error()
                )))
            }
        }
        _ => Err(Failure::new(format!("{}: {error}", target.to_string_lossy()))),
    }
}

/// The block device to mount `source` from.
///
/// A block device is used as it is, which is every mount made at boot. A
/// regular file is attached to a free loop device first: that is how content
/// reaches a box that is already running, as a file in a share, because a
/// box cannot be given a new block device after it has booted. ref(d-0085)
///
/// The loop device clears itself when the filesystem on it is unmounted, so
/// nothing here has to remember it.
///
/// A symbolic link anywhere in the path is refused rather than followed: a
/// file in a share is the host's to name, and a link would let whatever wrote
/// it name another. Anything that is neither a block device nor a regular file
/// is refused too.
///
/// A loop device comes back with its descriptor, which the caller holds until
/// the mount is made: it is attached with autoclear, so the moment nothing
/// holds it open the kernel detaches it, and the next attach is handed the
/// same device. Two attaches in a row (a build image, then its writable layer)
/// then both land on one device and the first mount reads the second file.
fn device_for(source: &std::ffi::CStr, read_only: bool) -> io::Result<(CString, Option<std::fs::File>)> {
    use std::os::unix::fs::FileTypeExt;
    let probe = open_no_symlinks(source, libc::O_RDONLY)?;
    let kind = probe.metadata()?.file_type();
    if kind.is_block_device() {
        return Ok((source.to_owned(), None));
    }
    if !kind.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "a mount source has to be a block device or a regular file",
        ));
    }
    drop(probe);
    loop_attach(source, read_only).map(|(path, device)| (path, Some(device)))
}

/// `struct open_how` from `<linux/openat2.h>`.
#[repr(C)]
struct OpenHow {
    flags: u64,
    mode: u64,
    resolve: u64,
}

const RESOLVE_NO_SYMLINKS: u64 = 0x04;

/// Open a path, refusing a symbolic link at any component (`openat2`), not
/// only the last one.
fn open_no_symlinks(path: &std::ffi::CStr, flags: libc::c_int) -> io::Result<std::fs::File> {
    use std::os::fd::FromRawFd;
    let how = OpenHow {
        flags: (flags | libc::O_CLOEXEC | libc::O_NONBLOCK) as u64,
        mode: 0,
        resolve: RESOLVE_NO_SYMLINKS,
    };
    // SAFETY: a nul-terminated path and an `open_how` that outlive the call.
    let fd = unsafe {
        libc::syscall(
            libc::SYS_openat2,
            libc::AT_FDCWD,
            path.as_ptr(),
            &how as *const OpenHow,
            std::mem::size_of::<OpenHow>(),
        )
    };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: a descriptor the kernel just returned, owned by nothing else.
    Ok(unsafe { std::fs::File::from_raw_fd(fd as i32) })
}

/// `struct loop_info64` from `<linux/loop.h>`.
#[repr(C)]
struct LoopInfo64 {
    device: u64,
    inode: u64,
    rdevice: u64,
    offset: u64,
    sizelimit: u64,
    number: u32,
    encrypt_type: u32,
    encrypt_key_size: u32,
    flags: u32,
    file_name: [u8; 64],
    crypt_name: [u8; 64],
    encrypt_key: [u8; 32],
    init: [u64; 2],
}

/// `struct loop_config` from `<linux/loop.h>`.
#[repr(C)]
struct LoopConfig {
    fd: u32,
    block_size: u32,
    info: LoopInfo64,
    reserved: [u64; 8],
}

const LOOP_CTL_GET_FREE: libc::c_ulong = 0x4C82;
const LOOP_CONFIGURE: libc::c_ulong = 0x4C0A;
const LO_FLAGS_READ_ONLY: u32 = 1;
const LO_FLAGS_AUTOCLEAR: u32 = 4;

/// Attach a file to a free loop device and name the device.
///
/// Retried a few times on `EBUSY`: a device handed out as free can be taken
/// by somebody else before it is configured.
fn loop_attach(file: &std::ffi::CStr, read_only: bool) -> io::Result<(CString, std::fs::File)> {
    use std::os::fd::AsRawFd;

    // Opened again, with the same refusal, because the file may have been
    // swapped since it was looked at.
    let backing = open_no_symlinks(file, if read_only { libc::O_RDONLY } else { libc::O_RDWR })?;
    if !backing.metadata()?.is_file() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "not a regular file"));
    }
    let control = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open("/dev/loop-control")?;

    let mut last = io::Error::from_raw_os_error(libc::EBUSY);
    for _ in 0..8 {
        // SAFETY: an ioctl with no argument on a descriptor this owns.
        let number = unsafe { libc::ioctl(control.as_raw_fd(), LOOP_CTL_GET_FREE as _) };
        if number < 0 {
            return Err(io::Error::last_os_error());
        }
        let path = format!("/dev/loop{number}");
        let device = std::fs::OpenOptions::new()
            .read(true)
            .write(!read_only)
            .open(&path)?;
        let mut flags = LO_FLAGS_AUTOCLEAR;
        if read_only {
            flags |= LO_FLAGS_READ_ONLY;
        }
        // SAFETY: zero is a valid value for every field of this plain C struct.
        let mut config: LoopConfig = unsafe { std::mem::zeroed() };
        config.fd = backing.as_raw_fd() as u32;
        config.info.flags = flags;
        // SAFETY: the kernel reads `config` and nothing else, and it outlives
        // the call.
        let done = unsafe {
            libc::ioctl(
                device.as_raw_fd(),
                LOOP_CONFIGURE as _,
                &config as *const LoopConfig,
            )
        };
        if done == 0 {
            return Ok((CString::new(path).map_err(io::Error::other)?, device));
        }
        last = io::Error::last_os_error();
        if last.raw_os_error() != Some(libc::EBUSY) {
            return Err(last);
        }
    }
    Err(last)
}

/// Mount one filesystem, creating its mount point first.
fn mount_one(
    source: &std::ffi::CStr,
    target: &std::ffi::CStr,
    fstype: &std::ffi::CStr,
    flags: libc::c_ulong,
    data: Option<&std::ffi::CStr>,
) -> io::Result<()> {
    // The mount point may not exist yet: the descriptor can name anywhere,
    // including a directory no image created.
    std::fs::create_dir_all(as_path(target))?;
    // SAFETY: every pointer is to a nul-terminated string that outlives the
    // call, and a null data pointer is what mount(2) takes for "no options".
    let mounted = unsafe {
        libc::mount(
            source.as_ptr(),
            target.as_ptr(),
            fstype.as_ptr(),
            flags,
            data.map_or(std::ptr::null(), |d| d.as_ptr().cast()),
        )
    };
    if mounted != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// The same bytes, as a path: lossless, where a round trip through `str` is
/// not.
fn as_path(path: &std::ffi::CStr) -> &std::path::Path {
    use std::os::unix::ffi::OsStrExt;
    std::path::Path::new(std::ffi::OsStr::from_bytes(path.to_bytes()))
}

fn ownership(path: &std::ffi::CStr) -> io::Result<(u32, u32, u32)> {
    use std::os::unix::fs::MetadataExt;
    let meta = std::fs::metadata(as_path(path))?;
    Ok((meta.uid(), meta.gid(), meta.mode() & 0o7777))
}

fn set_ownership(path: &std::ffi::CStr, uid: u32, gid: u32, mode: u32) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let path = as_path(path);
    std::os::unix::fs::chown(path, Some(uid), Some(gid))?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
}

/// What the mount call is given, split out because this is the part worth
/// asserting: mounting itself needs privileges a test does not have.
fn options(share: &Mount) -> Result<(CString, CString, libc::c_ulong), Failure> {
    // nosuid and nodev on every share, whether or not it is writable. A share
    // is data handed to the guest; a setuid binary or a device node appearing
    // in one is not something a workload should be able to use, and no
    // descriptor has a way to ask for it.
    let mut flags = libc::MS_NOSUID | libc::MS_NODEV;
    if share.ro {
        flags |= libc::MS_RDONLY;
    }
    // A nul byte inside a tag or a path is a descriptor that cannot be carried
    // out under any flags. Refused by name rather than silently emptied: an
    // empty source turns up later as a mount failure about something else
    // entirely, which is the wrong thing to go and look at.
    let source = CString::new(share.tag.as_str()).map_err(|_| {
        Failure::new(format!(
            "the share tag contains a nul byte: {:?}",
            share.tag
        ))
    })?;
    let target = CString::new(share.at.as_str()).map_err(|_| {
        Failure::new(format!(
            "the mount point contains a nul byte: {:?}",
            share.at
        ))
    })?;
    Ok((source, target, flags))
}

/// Everything an overlay's three mounts are given, worked out before any of
/// them is attempted.
///
/// Split out because this is the part worth asserting: mounting needs
/// privileges a test does not have.
///
/// # Where the layers go
///
/// Beside the overlay, in a hidden directory named after it:
/// `/nestri/install` stacks `/nestri/.install/lower` under
/// `/nestri/.install/rw/upper`. Beside rather than under, because anything
/// mounted under `at` is covered the moment the overlay is mounted over it.
///
/// # Flags
///
/// `nosuid` and `nodev` on every layer and on the result, for the reason every
/// share has them: what is stacked here is files a CDN handed us, checked for
/// the bytes the manifest named and for nothing about what those bytes are.
/// **Not `noexec`** anywhere: the game's executable is in the build.
///
/// `noatime` on the writable layer and the overlay, so a game reading its own
/// install does not turn every read into a write. The build image is mounted
/// read-only and has no access times to write.
///
/// No filesystem-specific options on the upper layer: `commit=` and
/// `barrier=` were once passed to a journal-less ext4 and the mount failed
/// outright with `EINVAL`.
#[derive(Debug)]
struct OverlayPlan {
    lower: CString,
    upper: CString,
    at: CString,
    lower_at: CString,
    rw_at: CString,
    upper_dir: CString,
    work_dir: CString,
    lower_flags: libc::c_ulong,
    upper_flags: libc::c_ulong,
    overlay_flags: libc::c_ulong,
    overlay_data: CString,
}

impl OverlayPlan {
    fn new(overlay: &Overlay) -> Result<Self, Failure> {
        let at = std::path::Path::new(&overlay.at);
        let (Some(parent), Some(name)) = (at.parent(), at.file_name()) else {
            return Err(Failure::new(format!(
                "the overlay mount point has no parent to put its layers beside: {:?}",
                overlay.at
            )));
        };
        let layers = parent.join(format!(".{}", name.to_string_lossy()));
        let lower_at = layers.join("lower");
        let rw_at = layers.join("rw");
        let upper_dir = rw_at.join("upper");
        let work_dir = rw_at.join("work");

        // overlayfs splits its options on commas and its layer lists on
        // colons, and has no escape for either that this should rely on. A
        // path carrying one would mount a different directory than the one
        // named, so it is refused.
        for path in [&lower_at, &upper_dir, &work_dir] {
            let text = path.to_string_lossy();
            if text.contains([',', ':']) {
                return Err(Failure::new(format!(
                    "the overlay mount point cannot carry a comma or a colon: {:?}",
                    overlay.at
                )));
            }
        }
        let data = format!(
            "lowerdir={},upperdir={},workdir={}",
            lower_at.display(),
            upper_dir.display(),
            work_dir.display()
        );

        let common = libc::MS_NOSUID | libc::MS_NODEV;
        Ok(Self {
            lower: c_string(&overlay.lower, "the build image device")?,
            upper: c_string(&overlay.upper, "the writable layer device")?,
            at: c_string(&overlay.at, "the overlay mount point")?,
            lower_at: c_string(&lower_at.to_string_lossy(), "the overlay mount point")?,
            rw_at: c_string(&rw_at.to_string_lossy(), "the overlay mount point")?,
            upper_dir: c_string(&upper_dir.to_string_lossy(), "the overlay mount point")?,
            work_dir: c_string(&work_dir.to_string_lossy(), "the overlay mount point")?,
            lower_flags: common | libc::MS_RDONLY,
            upper_flags: common | libc::MS_NOATIME,
            overlay_flags: common | libc::MS_NOATIME,
            overlay_data: c_string(&data, "the overlay mount point")?,
        })
    }

    /// Which step failed, on which path, in the operating system's words.
    fn failed(&self, step: &str, path: &std::ffi::CStr, error: io::Error) -> Failure {
        Failure::new(format!(
            "{}: {step}: {}: {error}",
            self.at.to_string_lossy(),
            path.to_string_lossy()
        ))
    }
}

/// A nul byte inside a path is a descriptor that cannot be carried out under
/// any flags. Refused by name rather than silently emptied: an empty path turns
/// up later as a mount failure about something else entirely.
fn c_string(text: &str, what: &str) -> Result<CString, Failure> {
    CString::new(text).map_err(|_| Failure::new(format!("{what} contains a nul byte: {text:?}")))
}

/// A failure names the path, which is what makes it actionable: a permission
/// error and the directory it happened on can be acted on, where "the share
/// did not mount" cannot.
fn failed(share: &Mount, error: io::Error) -> Failure {
    Failure::new(format!("{}: {error}", share.at))
}

#[cfg(test)]
mod loop_tests {
    use super::*;

    /// The layouts the kernel reads, checked against `<linux/loop.h>`.
    #[test]
    fn the_loop_structs_have_the_kernels_layout() {
        assert_eq!(std::mem::size_of::<LoopInfo64>(), 232);
        assert_eq!(std::mem::size_of::<LoopConfig>(), 304);
        assert_eq!(std::mem::offset_of!(LoopConfig, info), 8);
    }

    /// Only a block device (every mount made at boot) or a regular file is a
    /// source. A character device, a directory and the like are refused.
    #[test]
    fn a_source_that_is_neither_a_block_device_nor_a_file_is_refused() {
        for path in [c"/dev/null", c"/tmp"] {
            let error = device_for(path, true).unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::InvalidInput, "{path:?}: {error}");
        }
    }

    /// A link is refused at the last component and at any earlier one.
    #[test]
    fn a_source_reached_through_a_symbolic_link_is_refused() {
        let dir = std::env::temp_dir().join(format!("nesinit-link-{}", std::process::id()));
        let real = dir.join("real");
        std::fs::create_dir_all(&real).unwrap();
        std::fs::write(real.join("build.erofs"), b"x").unwrap();
        std::os::unix::fs::symlink(real.join("build.erofs"), dir.join("file-link")).unwrap();
        std::os::unix::fs::symlink(&real, dir.join("dir-link")).unwrap();
        for path in [dir.join("file-link"), dir.join("dir-link").join("build.erofs")] {
            let source = CString::new(path.to_string_lossy().as_bytes()).unwrap();
            let error = device_for(&source, true).unwrap_err();
            assert_eq!(error.raw_os_error(), Some(libc::ELOOP), "{path:?}: {error}");
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn unmounting_what_is_not_mounted_is_not_a_failure() {
        assert_eq!(unmount_one(c"/nonexistent/nesinit-test"), Ok(()));
    }

    #[test]
    fn a_source_that_is_not_there_names_the_error() {
        let error = device_for(c"/nonexistent/build.erofs", true).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::NotFound);
    }

    /// The launch id is in the environment, and the caller cannot name
    /// another launch in its place.
    #[test]
    fn a_launch_is_told_its_own_id() {
        let mut exec = Exec {
            argv: vec!["/bin/true".into()],
            env: Default::default(),
            cwd: None,
            uid: 1001,
            gid: 1001,
        };
        exec.env.insert(LAUNCH_ID_ENV.into(), "launch_other".into());
        let env = launch_environment(&exec, None, &LaunchId::new("launch_01"));
        let ids: Vec<_> = env.iter().filter(|(k, _)| k == LAUNCH_ID_ENV).collect();
        assert_eq!(ids.len(), 1, "{env:?}");
        assert_eq!(ids[0].1, "launch_01");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stat_line_names_its_session_whatever_the_command_is_called() {
        assert_eq!(live_session_of("42 (launcher) S 1 42 42 0 -1"), Some(42));
        assert_eq!(live_session_of("43 (a) b (c) R 42 42 42 0"), Some(42));
        assert_eq!(live_session_of("44 (x) Z 42 42 42 0"), None);
        assert_eq!(live_session_of("garbage"), None);
    }

    /// Reaps one pid, as the guest's reaper does for every child.
    fn reap_for(waiters: crate::reap::Waiters, pid: i32) {
        tokio::spawn(async move {
            loop {
                let mut status = 0;
                // SAFETY: writes only into `status`.
                let seen = unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) };
                if seen == pid {
                    waiters.deliver(pid, crate::reap::exit_of(status));
                    return;
                }
                if seen == -1 {
                    return;
                }
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        });
    }

    /// A process whose cgroups are made in a directory of the test's own, so
    /// no test touches the real `/sys/fs/cgroup`. It is a plain directory with
    /// no `cgroup.procs`, so a join into it fails, which is the fallback path.
    fn process_in_tmp(waiters: crate::reap::Waiters) -> (Process, std::path::PathBuf) {
        static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let root = std::env::temp_dir().join(format!(
            "nesinit-cg-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&root).unwrap();
        let mut process = Process::new(waiters);
        process.cgroup_root = root.to_string_lossy().into_owned();
        (process, root)
    }

    fn me(script: &str) -> Exec {
        // SAFETY: no arguments.
        let (uid, gid) = unsafe { (libc::getuid(), libc::getgid()) };
        Exec {
            argv: vec!["/bin/sh".into(), "-c".into(), script.into()],
            env: Default::default(),
            cwd: None,
            uid,
            gid,
        }
    }

    async fn started(script: &str) -> (Process, LaunchId, i32, Exited) {
        let waiters = crate::reap::Waiters::new();
        let (mut process, _root) = process_in_tmp(waiters.clone());
        static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        // Unique per test: members are found by the id in their environment.
        let id = LaunchId::new(format!(
            "g-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        ));
        let exited = process.start(&id, &me(script)).expect("it starts");
        let top = process.running.get(&id).unwrap().pid;
        reap_for(waiters, top);
        // Long enough for the shell to have started its children.
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        (process, id, top, exited)
    }

    /// The bug this exists for: a stop that reached the top process only left
    /// everything it had started running, and with it the game's window.
    #[tokio::test]
    async fn stopping_a_launch_ends_its_children_and_it_ends_when_they_have() {
        let (mut process, id, _top, exited) = started("sleep 300 & sleep 300 & wait").await;
        let group = process.groups[&id].clone();
        assert!(group.members().len() >= 3, "{:?}", group.members());
        process.stop_launch(&id);
        tokio::time::timeout(std::time::Duration::from_secs(10), exited)
            .await
            .expect("the launch did not end")
            .unwrap();
        assert!(group.members().is_empty(), "something of the launch is left");
    }

    /// A child that ignores SIGTERM is killed after the grace, and the launch
    /// is not reported ended before it has gone.
    #[tokio::test]
    async fn a_child_that_ignores_the_stop_is_killed_after_the_grace() {
        let (mut process, id, _top, exited) =
            started("trap '' TERM; (trap '' TERM; sleep 300) & wait").await;
        let group = process.groups[&id].clone();
        process.stop_launch(&id);
        let began = std::time::Instant::now();
        tokio::time::timeout(std::time::Duration::from_secs(15), exited)
            .await
            .expect("the launch did not end")
            .unwrap();
        assert!(began.elapsed() >= STOP_GRACE.saturating_sub(std::time::Duration::from_millis(500)));
        assert!(group.members().is_empty());
    }

    /// The top process leaving by itself does not end the launch while
    /// something of it runs; the leftovers are ended and then it has ended.
    #[tokio::test]
    async fn a_launch_whose_top_process_left_is_not_ended_until_its_group_is() {
        let (process, id, _top, exited) = started("sleep 300 & exit 3").await;
        let group = process.groups[&id].clone();
        let exit = tokio::time::timeout(std::time::Duration::from_secs(10), exited)
            .await
            .expect("the launch did not end")
            .unwrap();
        assert_eq!(exit, Exit::code(3));
        assert!(group.members().is_empty());
    }

    /// A cgroup the child could not join is dropped, not trusted: it would
    /// read as an empty launch and a stop would do nothing.
    #[tokio::test]
    async fn a_launch_that_cannot_join_its_cgroup_falls_back_and_is_still_stopped() {
        let waiters = crate::reap::Waiters::new();
        let (mut process, root) = process_in_tmp(waiters.clone());
        let id = LaunchId::new(format!("join-{}", std::process::id()));
        let exited = process.start(&id, &me("sleep 300 & wait")).unwrap();
        reap_for(waiters, process.running[&id].pid);
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        let group = process.groups[&id].clone();
        assert!(group.cgroup.is_none(), "the cgroup was kept");
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0, "its directory was left");
        assert!(group.members().len() >= 2, "{:?}", group.members());
        process.stop_launch(&id);
        tokio::time::timeout(std::time::Duration::from_secs(10), exited)
            .await
            .expect("the launch did not end")
            .unwrap();
        assert!(group.members().is_empty());
    }

    /// A stop that is still waiting out its grace must not kill a launch that
    /// has taken the same id since.
    #[tokio::test]
    async fn a_pending_stop_does_not_kill_the_launch_that_replaced_it() {
        let (mut process, id, _top, _exited) = started("sleep 300 & wait").await;
        let old = process.groups[&id].clone();
        process.stop_launch(&id);
        let waiters = process.waiters.clone();
        let _again = process.start(&id, &me("sleep 300 & wait")).unwrap();
        reap_for(waiters, process.running[&id].pid);
        assert!(old.is_superseded());
        tokio::time::sleep(STOP_GRACE + std::time::Duration::from_secs(1)).await;
        let new = process.groups[&id].clone();
        let alive = new.members();
        new.kill();
        assert!(alive.len() >= 2, "the new launch was killed by the old stop: {alive:?}");
    }

    /// Two launches are two groups: stopping one leaves the other running.
    #[tokio::test]
    async fn stopping_one_launch_leaves_another_running() {
        let waiters = crate::reap::Waiters::new();
        let (mut process, _root) = process_in_tmp(waiters.clone());
        let (a, b) = (LaunchId::new("iso-a"), LaunchId::new("iso-b"));
        let exited_a = process.start(&a, &me("sleep 300 & wait")).unwrap();
        let _exited_b = process.start(&b, &me("sleep 300 & wait")).unwrap();
        let (top_a, top_b) = (
            process.running[&a].pid,
            process.running[&b].pid,
        );
        reap_for(waiters.clone(), top_a);
        reap_for(waiters, top_b);
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        process.stop_launch(&a);
        tokio::time::timeout(std::time::Duration::from_secs(10), exited_a)
            .await
            .unwrap()
            .unwrap();
        assert!(process.groups[&a].members().is_empty());
        assert!(process.groups[&b].members().len() >= 2, "the other launch was touched");
        process.groups[&b].kill();
    }

    /// The case that broke #433: Wine `setsid`s its own processes, so they are
    /// in no session of the launch's. The launch still owns them, by its
    /// environment (no cgroup here: the test is not root), and a stop ends
    /// them.
    #[tokio::test]
    async fn a_child_that_makes_its_own_session_is_still_stopped() {
        let (mut process, id, top, exited) =
            started("setsid sleep 300 & setsid sh -c 'sleep 300 & wait' & wait").await;
        let group = process.groups[&id].clone();
        assert!(
            session_members(top).len() < group.members().len(),
            "the setsid children should be outside the launch's session: {:?}",
            group.members()
        );
        process.stop_launch(&id);
        tokio::time::timeout(std::time::Duration::from_secs(10), exited)
            .await
            .expect("the launch did not end")
            .unwrap();
        assert!(group.members().is_empty(), "something of the launch is left");
    }

    /// The same through a real cgroup. Needs a cgroup v2 directory the test
    /// may create in, named by `NESTRI_TEST_CGROUP_BASE` (a systemd user
    /// delegation, or `/sys/fs/cgroup` as root).
    #[tokio::test]
    #[ignore = "needs a writable cgroup v2 directory in NESTRI_TEST_CGROUP_BASE"]
    async fn a_cgroup_holds_a_child_that_makes_its_own_session() {
        let base = std::env::var("NESTRI_TEST_CGROUP_BASE").expect("NESTRI_TEST_CGROUP_BASE");
        let waiters = crate::reap::Waiters::new();
        let mut process = Process::new(waiters.clone());
        process.cgroup_root = base;
        let id = LaunchId::new(format!("cg-{}", std::process::id()));
        let exited = process
            .start(&id, &me("setsid sleep 300 & setsid sh -c 'sleep 300 & wait' & wait"))
            .unwrap();
        let top = process.running[&id].pid;
        reap_for(waiters, top);
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        let group = process.groups[&id].clone();
        let path = group.cgroup.clone().expect("the cgroup was made");
        assert!(group.members().len() >= 4, "{:?}", group.members());
        process.stop_launch(&id);
        tokio::time::timeout(std::time::Duration::from_secs(10), exited)
            .await
            .expect("the launch did not end")
            .unwrap();
        assert!(group.members().is_empty());
        assert!(!path.exists(), "the cgroup was not removed");
    }

    #[test]
    fn the_launch_id_is_found_whole_in_an_environment() {
        let env = b"A=1\0NESTRI_LAUNCH_ID=g-10\0B=2\0";
        assert!(environ_names(env, "g-10"));
        assert!(!environ_names(env, "g-1"));
        assert!(!environ_names(b"X_NESTRI_LAUNCH_ID=g-10\0", "g-10"));
    }

    #[test]
    fn an_id_becomes_a_safe_directory_name() {
        assert_eq!(sanitise("a/../b c"), "a_.._b_c");
    }


    /// The driver override has to reach the workload, because nothing else
    /// carries it: the image's profile script never runs for an exec'd
    /// process. Without it a game's OpenGL finds no driver at all.
    fn exec_with(env: &[(&str, &str)]) -> Exec {
        Exec {
            argv: vec!["/bin/true".into()],
            env: env
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            cwd: None,
            uid: 1001,
            gid: 1001,
        }
    }

    /// The override has to reach the launch, and asserting that it is in a
    /// table is not asserting that. A commit once defined the table and never
    /// applied it; the tests passed and a dead-code warning was the only sign.
    #[test]
    fn the_launch_is_told_which_gallium_driver_to_use() {
        let env = environment(&exec_with(&[]), None);
        let driver = env
            .iter()
            .find(|(k, _)| k == "MESA_LOADER_DRIVER_OVERRIDE")
            .map(|(_, v)| v.as_str());
        assert_eq!(
            driver,
            Some("zink"),
            "without this a game's GL reaches a native driver, renders \
             correctly, and is captured as nothing"
        );
    }

    /// Intel's driver hides Vulkan Video behind a debug variable, and the
    /// capture layer needs video encode.
    ///
    /// Without it the layer loads, finds no encode support, produces nothing,
    /// and reports nothing -- so the box streams a black screen while every
    /// component says it is working. It cost an evening to find once.
    #[test]
    fn intels_vulkan_video_is_asked_for() {
        let env = environment(&exec_with(&[]), None);
        let debug = env
            .iter()
            .find(|(k, _)| k == "ANV_DEBUG")
            .map(|(_, v)| v.as_str())
            .unwrap_or_default();
        assert!(
            debug.contains("video-encode"),
            "on an Intel host this is the difference between a stream and a \
             black screen, and neither says which: {debug:?}"
        );
    }

    /// The directory made for the launch has to be named to the launch.
    ///
    /// Making it and saying nothing is indistinguishable from not making it:
    /// the environment is cleared, so a workload inherits no path to it. The
    /// compositor in this image falls back to `/tmp` rather than failing, which
    /// means the whole session comes up, works, and puts one user's sockets in
    /// a directory every other user can write. ref(d-0065)
    #[test]
    fn the_launch_is_told_where_its_runtime_directory_is() {
        let env = environment(&exec_with(&[]), Some("/run/user/1001"));
        let runtime = env
            .iter()
            .find(|(k, _)| k == "XDG_RUNTIME_DIR")
            .map(|(_, v)| v.as_str());
        assert_eq!(runtime, Some("/run/user/1001"));
    }

    /// A directory that could not be made is not claimed to exist.
    ///
    /// Pointing a workload at a path that is not there is worse than leaving it
    /// unset: unset is a case every toolkit handles, and a bad path is one they
    /// report as something else.
    #[test]
    fn a_launch_without_a_runtime_directory_is_told_nothing() {
        let env = environment(&exec_with(&[]), None);
        assert!(!env.iter().any(|(k, _)| k == "XDG_RUNTIME_DIR"));
    }

    /// Last wins, so a host can override what the image assumes.
    #[test]
    fn the_callers_own_environment_beats_the_images() {
        let env = environment(&exec_with(&[("GALLIUM_DRIVER", "something-else")]), None);
        let chosen: Vec<&str> = env
            .iter()
            .filter(|(k, _)| k == "GALLIUM_DRIVER")
            .map(|(_, v)| v.as_str())
            .collect();
        // Both are present; `envs` applies in order, so the last is the one
        // the process gets.
        assert_eq!(chosen.last(), Some(&"something-else"));
    }

    fn share(ro: bool) -> Mount {
        Mount {
            tag: "user".into(),
            at: "/mnt/user".into(),
            ro,
        }
    }

    #[test]
    fn a_writable_share_is_still_mounted_without_devices_or_setuid() {
        let (source, target, flags) = options(&share(false)).unwrap();
        assert_eq!(
            source.to_str().unwrap(),
            "user",
            "the tag is the source, never a path"
        );
        assert_eq!(target.to_str().unwrap(), "/mnt/user");
        assert_eq!(flags & libc::MS_NOSUID, libc::MS_NOSUID);
        assert_eq!(flags & libc::MS_NODEV, libc::MS_NODEV);
        assert_eq!(flags & libc::MS_RDONLY, 0);
    }

    fn image(at: &str) -> Image {
        Image {
            device: "/dev/vdd".into(),
            at: at.into(),
        }
    }

    /// Read-only, guarded like every other layer, and runnable: what is in it
    /// is a program.
    #[test]
    fn an_image_is_mounted_read_only_without_devices_or_setuid_but_can_execute() {
        let plan = ImagePlan::new(&image("/nestri/compat")).unwrap();
        assert_eq!(plan.device.to_str().unwrap(), "/dev/vdd");
        assert_eq!(plan.at.to_str().unwrap(), "/nestri/compat");
        assert_eq!(plan.flags & libc::MS_RDONLY, libc::MS_RDONLY);
        assert_eq!(plan.flags & libc::MS_NOSUID, libc::MS_NOSUID);
        assert_eq!(plan.flags & libc::MS_NODEV, libc::MS_NODEV);
        assert_eq!(plan.flags & libc::MS_NOEXEC, 0);
    }

    #[test]
    fn an_image_that_cannot_be_placed_is_refused_before_anything_mounts() {
        for at in ["/", "nestri/compat", "", "/nestri/co\0mpat"] {
            assert!(ImagePlan::new(&image(at)).is_err(), "{at:?} was accepted");
        }
        let nul_device = Image {
            device: "/dev/v\0dd".into(),
            at: "/nestri/compat".into(),
        };
        assert!(ImagePlan::new(&nul_device).is_err());
    }

    #[test]
    fn a_failed_image_names_the_mount_point_and_the_device() {
        let plan = ImagePlan::new(&image("/nestri/compat")).unwrap();
        let failure = plan.failed(io::Error::from_raw_os_error(libc::EINVAL));
        assert!(
            failure
                .reason
                .starts_with("/nestri/compat: the image /dev/vdd: "),
            "{}",
            failure.reason
        );
    }

    fn overlay(at: &str) -> Overlay {
        Overlay {
            lower: "/dev/vdb".into(),
            upper: "/dev/vdc".into(),
            at: at.into(),
        }
    }

    /// The layers sit beside the overlay, never under it: anything mounted
    /// under `at` is hidden the moment the overlay covers it.
    #[test]
    fn an_overlays_layers_sit_beside_it_and_the_options_name_them() {
        let plan = OverlayPlan::new(&overlay("/nestri/install")).unwrap();
        assert_eq!(plan.lower.to_str().unwrap(), "/dev/vdb");
        assert_eq!(plan.upper.to_str().unwrap(), "/dev/vdc");
        assert_eq!(plan.lower_at.to_str().unwrap(), "/nestri/.install/lower");
        assert_eq!(plan.rw_at.to_str().unwrap(), "/nestri/.install/rw");
        assert_eq!(
            plan.overlay_data.to_str().unwrap(),
            "lowerdir=/nestri/.install/lower,\
             upperdir=/nestri/.install/rw/upper,\
             workdir=/nestri/.install/rw/work"
        );
    }

    /// Every layer carries the guard every share carries, and none of them
    /// stops the game's own executable from running.
    ///
    /// These are the mounts that most need it: a share is a directory this
    /// host prepared, and a build is a filesystem made out of whatever a CDN
    /// sent.
    #[test]
    fn every_layer_is_mounted_without_devices_or_setuid_but_can_still_execute() {
        let plan = OverlayPlan::new(&overlay("/nestri/install")).unwrap();
        for flags in [plan.lower_flags, plan.upper_flags, plan.overlay_flags] {
            assert_eq!(flags & libc::MS_NOSUID, libc::MS_NOSUID);
            assert_eq!(flags & libc::MS_NODEV, libc::MS_NODEV);
            assert_eq!(flags & libc::MS_NOEXEC, 0);
        }
        assert_eq!(plan.lower_flags & libc::MS_RDONLY, libc::MS_RDONLY);
        assert_eq!(plan.upper_flags & libc::MS_RDONLY, 0);
        assert_eq!(plan.overlay_flags & libc::MS_RDONLY, 0);
        assert_eq!(plan.overlay_flags & libc::MS_NOATIME, libc::MS_NOATIME);
    }

    /// overlayfs splits its options on commas and colons, so a path carrying
    /// one would stack a different directory than the one named.
    #[test]
    fn an_overlay_the_kernel_would_misread_is_refused_before_anything_mounts() {
        for at in [
            "/nestri/in,stall",
            "/nestri/in:stall",
            "/",
            "/nestri/ins\0tall",
        ] {
            assert!(
                OverlayPlan::new(&overlay(at)).is_err(),
                "{at:?} was accepted"
            );
        }
    }

    #[test]
    fn a_failed_overlay_step_names_the_overlay_the_step_and_the_path() {
        let plan = OverlayPlan::new(&overlay("/nestri/install")).unwrap();
        let failure = plan.failed(
            "the build image",
            &plan.lower_at,
            io::Error::from_raw_os_error(libc::ENODEV),
        );
        assert!(
            failure
                .reason
                .starts_with("/nestri/install: the build image: /nestri/.install/lower: "),
            "{}",
            failure.reason
        );
    }

    #[test]
    fn a_read_only_share_is_mounted_read_only() {
        let (_, _, flags) = options(&share(true)).unwrap();
        assert_eq!(flags & libc::MS_RDONLY, libc::MS_RDONLY);
    }

    #[test]
    fn a_descriptor_with_a_nul_byte_in_it_is_refused_by_name() {
        let tagged = Mount {
            tag: "us\0er".into(),
            at: "/mnt/user".into(),
            ro: false,
        };
        let failure = options(&tagged).expect_err("an empty source would have been mounted");
        assert!(failure.reason.contains("tag"), "{}", failure.reason);

        let placed = Mount {
            tag: "user".into(),
            at: "/mnt/us\0er".into(),
            ro: false,
        };
        let failure = options(&placed).expect_err("an empty target would have been mounted");
        assert!(failure.reason.contains("mount point"), "{}", failure.reason);
    }

    #[test]
    fn a_failure_names_the_path_it_happened_on() {
        let failure = failed(&share(false), io::Error::from_raw_os_error(libc::EACCES));
        assert!(
            failure.reason.starts_with("/mnt/user: "),
            "{}",
            failure.reason
        );
        assert!(
            failure.reason.contains("ermission denied"),
            "{}",
            failure.reason
        );
    }
}

#[cfg(test)]
pub mod double {
    use super::*;
    use tokio::sync::oneshot;

    /// A workload that starts nothing, so what the caller does with it is the
    /// only thing under test.
    pub struct Double {
        pub mounted: Vec<Vec<Mount>>,
        pub overlays: Vec<Vec<Overlay>>,
        pub images: Vec<Vec<Image>>,
        /// Which kind of mount was asked for, in the order it was asked.
        pub order: Vec<&'static str>,
        pub attached: Vec<(AttachId, Exec, Option<Winsize>)>,
        pub attach_failure: Option<Failure>,
        pub started: Vec<Exec>,
        /// An exit of its own for a launch, over `exit`.
        pub exit_for: std::collections::BTreeMap<LaunchId, Exit>,
        /// Launches whose start fails after the first, for a restart test.
        pub fail_restart_of: Option<LaunchId>,
        /// What `unmount_launch` was asked to take down, in order.
        pub unmounted: Vec<(Vec<Image>, Vec<Overlay>)>,
        /// Which launch each start was for, in the same order as `started`.
        pub started_ids: Vec<LaunchId>,
        /// Every stop asked for, one launch or all (`None`).
        pub stopped: Vec<Option<LaunchId>>,
        pub stops: usize,
        /// Every compositor asked for.
        pub compositors: Vec<Compositor>,
        pub compositor_failure: Option<Failure>,
        /// When the compositor "exits": the session takes this after it starts.
        pub compositor_exit: Option<oneshot::Receiver<Exit>>,
        /// Every daemon asked for.
        pub daemons: Vec<Daemon>,
        pub daemon_failure: Option<Failure>,
        /// When the daemon "exits": the session takes this after it starts.
        pub daemon_exit: Option<oneshot::Receiver<Exit>>,
        pub mount_failure: Option<Failure>,
        pub image_failure: Option<Failure>,
        /// Like `image_failure`, but only for a call that names an image, so a
        /// box can boot with none and fail a later mount.
        pub named_image_failure: Option<Failure>,
        pub start_failure: Option<Failure>,
        exit: Exit,
        on_stop: std::collections::BTreeMap<LaunchId, oneshot::Sender<Exit>>,
        holds_until_stopped: bool,
    }

    impl Double {
        /// Its workload has already ended by the time it is started.
        pub fn exits_at_once(exit: Exit) -> Self {
            Self::new(exit, false)
        }

        /// Its workload runs until it is asked to stop.
        pub fn exits_when_stopped(exit: Exit) -> Self {
            Self::new(exit, true)
        }

        fn new(exit: Exit, holds_until_stopped: bool) -> Self {
            Self {
                mounted: Vec::new(),
                overlays: Vec::new(),
                images: Vec::new(),
                order: Vec::new(),
                attached: Vec::new(),
                attach_failure: None,
                started: Vec::new(),
                unmounted: Vec::new(),
                exit_for: Default::default(),
                fail_restart_of: None,
                started_ids: Vec::new(),
                stopped: Vec::new(),
                stops: 0,
                compositors: Vec::new(),
                compositor_failure: None,
                compositor_exit: None,
                daemons: Vec::new(),
                daemon_failure: None,
                daemon_exit: None,
                mount_failure: None,
                image_failure: None,
                named_image_failure: None,
                start_failure: None,
                exit,
                on_stop: Default::default(),
                holds_until_stopped,
            }
        }
    }

    impl Workload for Double {
        fn mount(&mut self, mounts: &[Mount]) -> Result<(), Failure> {
            self.order.push("shares");
            self.mounted.push(mounts.to_vec());
            match &self.mount_failure {
                Some(failure) => Err(failure.clone()),
                None => Ok(()),
            }
        }

        fn attach(
            &mut self,
            id: AttachId,
            exec: &Exec,
            size: Option<Winsize>,
        ) -> Result<(), Failure> {
            self.attached.push((id, exec.clone(), size));
            match &self.attach_failure {
                Some(failure) => Err(failure.clone()),
                None => Ok(()),
            }
        }

        fn mount_images(&mut self, images: &[Image]) -> Result<(), Failure> {
            self.order.push("images");
            self.images.push(images.to_vec());
            if let Some(failure) = self.named_image_failure.as_ref().filter(|_| !images.is_empty()) {
                return Err(failure.clone());
            }
            match &self.image_failure {
                Some(failure) => Err(failure.clone()),
                None => Ok(()),
            }
        }

        fn mount_launch(&mut self, images: Vec<Image>, overlays: Vec<Overlay>) -> Pending {
            let result = self
                .mount_images(&images)
                .and_then(|()| self.mount_overlays(&overlays));
            Box::pin(async move { result })
        }

        fn unmount_launch(&mut self, images: Vec<Image>, overlays: Vec<Overlay>) -> Pending {
            self.unmounted.push((images, overlays));
            Box::pin(async { Ok(()) })
        }

        fn mount_overlays(&mut self, overlays: &[Overlay]) -> Result<(), Failure> {
            self.order.push("overlays");
            self.overlays.push(overlays.to_vec());
            match &self.mount_failure {
                Some(failure) => Err(failure.clone()),
                None => Ok(()),
            }
        }

        fn start(&mut self, id: &LaunchId, exec: &Exec) -> Result<Exited, Failure> {
            self.started.push(exec.clone());
            let again = self.started_ids.contains(id);
            self.started_ids.push(id.clone());
            if let Some(failure) = &self.start_failure {
                return Err(failure.clone());
            }
            if again && self.fail_restart_of.as_ref() == Some(id) {
                return Err(Failure::new("it would not come back"));
            }
            let exit = self.exit_for.get(id).copied().unwrap_or(self.exit);
            if !self.holds_until_stopped {
                return Ok(Box::pin(async move { Ok(exit) }));
            }
            let (tx, rx) = oneshot::channel();
            self.on_stop.insert(id.clone(), tx);
            Ok(Box::pin(async move {
                rx.await
                    .map_err(|_| io::Error::other("the workload was dropped"))
            }))
        }

        fn start_compositor(&mut self, compositor: &Compositor) -> Result<(), Failure> {
            self.order.push("compositor");
            self.compositors.push(compositor.clone());
            match &self.compositor_failure {
                Some(failure) => Err(failure.clone()),
                None => Ok(()),
            }
        }

        fn compositor_exit(&mut self) -> Option<Exited> {
            let rx = self.compositor_exit.take()?;
            Some(Box::pin(async move {
                rx.await.map_err(|_| io::Error::other("the compositor was dropped"))
            }))
        }

        fn start_daemon(&mut self, daemon: &Daemon) -> Result<(), Failure> {
            self.order.push("daemon");
            self.daemons.push(daemon.clone());
            match &self.daemon_failure {
                Some(failure) => Err(failure.clone()),
                None => Ok(()),
            }
        }

        fn daemon_exit(&mut self) -> Option<Exited> {
            let rx = self.daemon_exit.take()?;
            Some(Box::pin(async move {
                rx.await.map_err(|_| io::Error::other("the daemon was dropped"))
            }))
        }

        fn stop_launch(&mut self, id: &LaunchId) {
            self.stops += 1;
            self.stopped.push(Some(id.clone()));
            if let Some(tx) = self.on_stop.remove(id) {
                let _ = tx.send(self.exit_for.get(id).copied().unwrap_or(self.exit));
            }
        }

        fn signal_stop(&mut self) {
            self.stops += 1;
            self.stopped.push(None);
            for (id, tx) in std::mem::take(&mut self.on_stop) {
                let _ = tx.send(self.exit_for.get(&id).copied().unwrap_or(self.exit));
            }
        }
    }
}
