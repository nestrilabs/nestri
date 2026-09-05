// The one thing a descriptor turns into: mount what it names, run what it
// names, report how that ended.
//
// It is a trait because the two halves of it arrive at different times and
// because the interesting behaviour — one start and never a second, an exit
// reported rather than acted on — is behaviour of the caller, which a double
// can test without a VM, a share or a workload.

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
        if mounts.is_empty() {
            return Ok(());
        }
        // Refused rather than ignored: a workload started without the shares
        // it was promised fails later, somewhere else, for a reason nobody can
        // see from here.
        Err(Failure::new(format!(
            "this build mounts nothing; {} share(s) were requested",
            mounts.len()
        )))
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
