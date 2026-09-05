// Reaping. The part of being PID 1 that no other component can do.
//
// A process whose parent dies is reparented to PID 1, so every orphan in the
// guest becomes this process's child and stays a zombie until it is waited
// for. Zombies hold a pid and a slot in the process table; a workload that
// leaks them in a long session eventually cannot fork.

use std::collections::HashMap;
use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use nesprotocol::lifecycle::Exit;
use tokio::sync::oneshot;

/// Reap every child that has already exited, without blocking on any that
/// have not.
///
/// Returns what it collected, which is what makes this testable: the caller
/// decides whether an exit is interesting, and the same call site both frees
/// the process table and answers "did the process I care about end".
pub fn reap_exited() -> Vec<(i32, Exit)> {
    let mut reaped = Vec::new();
    loop {
        let mut status: libc::c_int = 0;
        // -1 is "any child"; WNOHANG makes this a poll rather than a wait, so
        // one call drains the queue and never blocks the caller.
        let pid = unsafe { libc::waitpid(-1, &mut status, libc::WNOHANG) };
        match pid {
            0 => return reaped,
            -1 => return reaped, // no children left, or a signal interrupted the poll
            pid => reaped.push((pid, exit_of(status))),
        }
    }
}

/// Read a `wait` status as an exit.
///
/// A signalled process has no exit code. Reporting `0` for one would make a
/// kill indistinguishable from a clean run, which is the difference a caller
/// most needs from this.
pub fn exit_of(status: libc::c_int) -> Exit {
    if libc::WIFSIGNALED(status) {
        Exit::signal(libc::WTERMSIG(status))
    } else {
        Exit::code(libc::WEXITSTATUS(status))
    }
}

/// Ask the kernel to reparent orphans to this process even when it is not
/// PID 1.
///
/// In the guest this is redundant — PID 1 already collects them. It is called
/// anyway because it is what makes the reaper testable off a VM, and because a
/// nesinit that is accidentally not PID 1 should still reap rather than leak.
pub fn become_subreaper() -> io::Result<()> {
    // SAFETY: prctl with this option takes one integer argument and returns
    // -1/errno on failure; nothing here is borrowed by the kernel.
    if unsafe { libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 1) } == -1 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// Take this process out of the reach of the OOM killer.
///
/// Under memory pressure the kernel picks a victim by score, and init being
/// eligible is the one loss the guest cannot report: everything else exiting
/// is a message up the channel, whereas init exiting takes the channel with
/// it, and the caller sees a box that stopped answering for no stated reason.
///
/// This covers init only. Making the workload the preferred victim is the
/// image's job — this process cannot score other processes it did not start.
pub fn refuse_oom_kill() -> io::Result<()> {
    std::fs::write("/proc/self/oom_score_adj", "-1000\n")
}

/// The children whose exit somebody is waiting for.
///
/// Reaping and waiting cannot be two mechanisms. `waitpid(-1, ...)` collects
/// any child, so a reaper running beside a caller that waits on its own child
/// will sometimes collect that child first and the caller's wait then fails
/// with no status — the exit is gone, and an exit is the one thing this
/// component exists to report. So the reaper is the only waiter, and this is
/// how it hands an exit to whoever asked for one.
#[derive(Clone, Default)]
pub struct Waiters(Arc<Mutex<HashMap<i32, Watch>>>);

/// The registry's half of one watched child.
struct Watch {
    exit: oneshot::Sender<Exit>,
    running: Arc<AtomicBool>,
}

/// A child something is waiting for: its pid, its exit, and whether the pid
/// still means what it meant.
///
/// The flag is the point. A pid is only a name for a process until that
/// process is reaped, after which the kernel may hand the same number to
/// something else — so a caller that kept a pid and signals it later can hit a
/// process it has never heard of. Anything that signals asks here first.
pub struct Watched {
    pub pid: i32,
    running: Arc<AtomicBool>,
    exit: Option<oneshot::Receiver<Exit>>,
}

impl Watched {
    /// The exit, which only one caller may hold — whoever takes it is the one
    /// that reports it. What is left behind is the pid and whether it still
    /// means this child, which is what a signaller needs.
    pub fn take_exit(&mut self) -> Option<oneshot::Receiver<Exit>> {
        self.exit.take()
    }

    /// Whether the pid is still this child's.
    ///
    /// False from the moment its exit is delivered. There is a window between
    /// the reap and the delivery in which this still says true; closing it
    /// entirely needs a handle the kernel keeps for us rather than a number,
    /// and the number is what the rest of this component has.
    pub fn running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }
}

impl Waiters {
    pub fn new() -> Self {
        Self::default()
    }

    /// Start something and be waiting for it before it can be reaped.
    ///
    /// The lock is held across the spawn, and that is the whole point: a child
    /// that exits immediately is reaped by a thread that has to take the same
    /// lock to deliver the exit, so it waits until the slot exists rather than
    /// finding none and dropping it.
    pub fn watch<F>(&self, spawn: F) -> io::Result<Watched>
    where
        F: FnOnce() -> io::Result<i32>,
    {
        let mut waiting = self.lock();
        let pid = spawn()?;
        let (sender, receiver) = oneshot::channel();
        let running = Arc::new(AtomicBool::new(true));
        waiting.insert(
            pid,
            Watch {
                exit: sender,
                running: running.clone(),
            },
        );
        Ok(Watched {
            pid,
            running,
            exit: Some(receiver),
        })
    }

    /// Hand an exit to whoever is waiting for that pid. `false` if nobody is,
    /// which is the common case: most of what an init reaps is an orphan
    /// nothing asked about.
    pub fn deliver(&self, pid: i32, exit: Exit) -> bool {
        let Some(watch) = self.lock().remove(&pid) else {
            return false;
        };
        // Before the exit goes anywhere: the pid has been reaped, so the
        // number is free for the kernel to give to something else and nothing
        // may signal it from here on.
        watch.running.store(false, Ordering::SeqCst);
        // An error here means the caller stopped waiting, which is its right.
        watch.exit.send(exit).is_ok()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<i32, Watch>> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
