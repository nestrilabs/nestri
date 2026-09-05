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
use std::pin::Pin;

use nesprotocol::lifecycle::{Exec, Exit, Mount};

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

pub trait Workload {
    /// Make the shares the descriptor names, where it says to put them.
    fn mount(&mut self, mounts: &[Mount]) -> Result<(), Failure>;

    /// Start the command the descriptor names.
    ///
    /// Returning the exit as a future, rather than a `wait` method, is what
    /// keeps the caller free to read the channel while the workload runs — a
    /// stop has to arrive during the workload's life or it is not a stop.
    fn start(&mut self, exec: &Exec) -> Result<Exited, Failure>;

    /// Ask the workload to stop. Idempotent, and never ends the session by
    /// itself.
    fn signal_stop(&mut self);
}

/// The workload as a local process.
pub struct Process {
    waiters: Waiters,
    running: Option<Watched>,
}

impl Process {
    /// Started through the reaper's registry, because the reaper is the only
    /// thing in this component that may call `wait`.
    pub fn new(waiters: Waiters) -> Self {
        Self {
            waiters,
            running: None,
        }
    }

    /// Send a signal to the workload and nothing else.
    ///
    /// Nothing here ever signals the process group or every process: the order
    /// a shutdown promises is only true if the workload can be stopped alone.
    pub fn signal(&self, signal: libc::c_int) {
        let Some(watched) = &self.running else { return };
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
        let Some(watched) = &self.running else {
            return true;
        };
        if !watched.running() {
            return true; // already reaped, and its exit already reported
        }
        let pid = watched.pid;
        let deadline = std::time::Instant::now() + grace;
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

    fn start(&mut self, exec: &Exec) -> Result<Exited, Failure> {
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
        command.envs(&exec.env);
        if let Some(cwd) = &exec.cwd {
            command.current_dir(cwd);
        }

        let (uid, gid) = (exec.uid, exec.gid);
        // SAFETY: the closure runs between fork and exec in the child, where
        // only async-signal-safe calls are allowed. These two are, and it
        // allocates nothing.
        unsafe {
            command.pre_exec(move || {
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
            .map_err(|error| Failure::new(error.to_string()))?;

        // The caller gets the exit and reports it; this handle keeps the pid
        // and whether that pid is still this child's.
        let exit = watched.take_exit().expect("a new watch has its exit");
        self.running = Some(watched);

        Ok(Box::pin(async move {
            exit.await
                .map_err(|_| io::Error::other("the workload's exit was not delivered"))
        }))
    }

    fn signal_stop(&mut self) {
        self.signal(libc::SIGTERM);
    }
}

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

/// A failure names the path, which is what makes it actionable: a permission
/// error and the directory it happened on can be acted on, where "the share
/// did not mount" cannot.
fn failed(share: &Mount, error: io::Error) -> Failure {
    Failure::new(format!("{}: {error}", share.at))
}

#[cfg(test)]
mod tests {
    use super::*;

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
        pub started: Vec<Exec>,
        pub stops: usize,
        pub mount_failure: Option<Failure>,
        pub start_failure: Option<Failure>,
        exit: Exit,
        on_stop: Option<oneshot::Sender<Exit>>,
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
                started: Vec::new(),
                stops: 0,
                mount_failure: None,
                start_failure: None,
                exit,
                on_stop: None,
                holds_until_stopped,
            }
        }
    }

    impl Workload for Double {
        fn mount(&mut self, mounts: &[Mount]) -> Result<(), Failure> {
            self.mounted.push(mounts.to_vec());
            match &self.mount_failure {
                Some(failure) => Err(failure.clone()),
                None => Ok(()),
            }
        }

        fn start(&mut self, exec: &Exec) -> Result<Exited, Failure> {
            self.started.push(exec.clone());
            if let Some(failure) = &self.start_failure {
                return Err(failure.clone());
            }
            let exit = self.exit;
            if !self.holds_until_stopped {
                return Ok(Box::pin(async move { Ok(exit) }));
            }
            let (tx, rx) = oneshot::channel();
            self.on_stop = Some(tx);
            Ok(Box::pin(async move {
                rx.await
                    .map_err(|_| io::Error::other("the workload was dropped"))
            }))
        }

        fn signal_stop(&mut self) {
            self.stops += 1;
            if let Some(tx) = self.on_stop.take() {
                let _ = tx.send(self.exit);
            }
        }
    }
}
