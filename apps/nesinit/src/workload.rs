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
    pid: Option<i32>,
}

impl Process {
    pub fn new() -> Self {
        Self { pid: None }
    }
}

impl Default for Process {
    fn default() -> Self {
        Self::new()
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

        let mut command = tokio::process::Command::new(program);
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

        let mut child = command.spawn().map_err(|e| Failure::new(e.to_string()))?;
        self.pid = child.id().map(|pid| pid as i32);
        let waiter = async move {
            let status = child.wait().await?;
            Ok(exit_of(status))
        };
        Ok(Box::pin(waiter))
    }

    fn signal_stop(&mut self) {
        if let Some(pid) = self.pid {
            // SAFETY: kill takes two integers and cannot touch this process's
            // memory. A pid that has already exited fails with ESRCH, which is
            // exactly the idempotence this method promises.
            unsafe { libc::kill(pid, libc::SIGTERM) };
        }
    }
}

/// Read a finished process's status as an exit.
fn exit_of(status: std::process::ExitStatus) -> Exit {
    use std::os::unix::process::ExitStatusExt;
    match (status.code(), status.signal()) {
        (Some(code), _) => Exit::code(code),
        (None, Some(signal)) => Exit::signal(signal),
        // Neither: nothing on this platform produces it, and inventing a zero
        // would report a clean run.
        (None, None) => Exit::signal(0),
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
