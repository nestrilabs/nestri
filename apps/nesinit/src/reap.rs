// Reaping. The part of being PID 1 that no other component can do.
//
// A process whose parent dies is reparented to PID 1, so every orphan in the
// guest becomes this process's child and stays a zombie until it is waited
// for. Zombies hold a pid and a slot in the process table; a workload that
// leaks them in a long session eventually cannot fork.

use std::io;

use nesprotocol::lifecycle::Exit;

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
