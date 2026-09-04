// Reaping, against real processes.
//
// Its own test binary on purpose: the reaper waits on any child, so it would
// collect processes another test in the same binary was waiting for.

use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use nesinit::reap::{become_subreaper, reap_exited};

/// Reaping is process-wide: `waitpid(-1, ...)` collects any child, so two of
/// these tests running at once would each reap the other's. One at a time.
static ONE_REAPER: Mutex<()> = Mutex::new(());

fn alone() -> MutexGuard<'static, ()> {
    ONE_REAPER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Fork a child, run `body` in it, and never return from the child.
///
/// Raw fork rather than `Command` because the point is a child nothing else
/// holds a handle to — the standard library reaps the children it spawns,
/// which is precisely the work under test.
fn fork_child(body: impl FnOnce()) -> i32 {
    let pid = unsafe { libc::fork() };
    assert!(pid >= 0, "fork failed: {}", std::io::Error::last_os_error());
    if pid == 0 {
        body();
        unsafe { libc::_exit(0) };
    }
    pid
}

/// Reap until `pid` turns up, or give up.
fn reap_until(pid: i32) -> Option<nesprotocol::lifecycle::Exit> {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        for (reaped, exit) in reap_exited() {
            if reaped == pid {
                return Some(exit);
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    None
}

#[test]
fn a_child_that_exits_is_reaped_with_its_code() {
    let _alone = alone();
    let pid = fork_child(|| unsafe { libc::_exit(7) });
    let exit = reap_until(pid).expect("the child was left a zombie");
    assert_eq!(exit.exit_code, Some(7));
    assert_eq!(exit.signal, None);
}

#[test]
fn a_child_that_is_killed_is_reaped_as_signalled() {
    let _alone = alone();
    let pid = fork_child(|| {
        // Sleep long enough to be killed rather than to exit on its own.
        unsafe { libc::pause() };
    });
    assert_eq!(unsafe { libc::kill(pid, libc::SIGKILL) }, 0);

    let exit = reap_until(pid).expect("the child was left a zombie");
    assert_eq!(exit.signal, Some(libc::SIGKILL));
    assert_eq!(exit.exit_code, None, "a killed process has no exit code");
}

#[test]
fn an_orphan_is_reaped_by_whoever_inherits_it() {
    let _alone = alone();
    become_subreaper().expect("PR_SET_CHILD_SUBREAPER");

    // A grandchild that outlives its parent. In a guest the kernel hands it to
    // PID 1; here the same reparenting is arranged with the subreaper bit, so
    // the reaper is exercised rather than the privilege.
    let (read_fd, write_fd) = pipe();
    let child = fork_child(|| {
        let grandchild = unsafe { libc::fork() };
        if grandchild == 0 {
            // Outlive the parent, then exit with a code the test can pick out.
            std::thread::sleep(Duration::from_millis(200));
            unsafe { libc::_exit(11) };
        }
        let pid = grandchild.to_le_bytes();
        unsafe { libc::write(write_fd, pid.as_ptr().cast(), pid.len()) };
        unsafe { libc::_exit(0) };
    });

    let mut buf = [0u8; 4];
    let read = unsafe { libc::read(read_fd, buf.as_mut_ptr().cast(), buf.len()) };
    assert_eq!(read, 4, "the child never reported its own child");
    let grandchild = i32::from_le_bytes(buf);

    // The parent goes first; the orphan is what this test is about.
    assert!(reap_until(child).is_some(), "the child was left a zombie");

    let exit = reap_until(grandchild).expect("the orphan was left a zombie");
    assert_eq!(exit.exit_code, Some(11));
}

fn pipe() -> (i32, i32) {
    let mut fds = [0i32; 2];
    assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0);
    (fds[0], fds[1])
}
