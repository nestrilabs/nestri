// What the service stack does with its children when it goes away, against
// real processes.
//
// Its own test binary for the same reason as `reaping`: these wait on children,
// and a reaper in another test in the same binary would collect them.

use std::time::{Duration, Instant};

use nesinit::reap::Waiters;
use nesinit::services::{Service, Services, Stack};

/// A service that stays up until something stops it, and one that binds a
/// socket -- which is all the table needs to be for either question here.
static SLEEPERS: &[Service] = &[
    Service {
        name: "sleeper",
        argv: &["/bin/sleep", "60"],
        env: &[],
        user: None,
        cost: "nothing: this is a test",
        required: true,
        umask: None,
        ready: None,
    },
    Service {
        name: "second-sleeper",
        argv: &["/bin/sleep", "60"],
        env: &[],
        user: None,
        cost: "nothing: this is a test",
        required: true,
        umask: None,
        ready: None,
    },
];

/// Whether a pid is still a live process, asked without reaping it.
fn alive(pid: i32) -> bool {
    // Signal 0 checks for the process without sending anything.
    unsafe { libc::kill(pid, 0) == 0 }
}

/// Dropping the stack stops what it started.
///
/// As PID 1 the ordered shutdown would reach these anyway. Run by hand -- which
/// is how a guest that will not boot is debugged -- nothing else does, and the
/// bus, the audio server and the hub were left running with sockets nobody was
/// serving.
#[tokio::test]
async fn a_stack_that_goes_away_takes_its_services_with_it() {
    let waiters = Waiters::new();
    let mut stack = Stack::from_table(waiters, SLEEPERS);
    let up = stack.bring_up(Default::default()).expect("two sleeps did not start");
    assert_eq!(up.len(), 2);

    let pids = stack.pids();
    assert_eq!(pids.len(), 2, "the stack did not keep what it started");
    assert!(pids.iter().all(|&pid| alive(pid)));

    drop(stack);

    // Signalled, not waited for: the stack cannot reap on its way out, so what
    // is asserted is that each one leaves, not how fast.
    let deadline = Instant::now() + Duration::from_secs(5);
    for pid in pids {
        loop {
            // Nothing here reaps, so a signalled child becomes a zombie rather
            // than disappearing -- and a zombie still answers signal 0. It is
            // waited for explicitly instead.
            let mut status = 0;
            let seen = unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) };
            if seen == pid || seen == -1 {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "{pid} was still running five seconds after its stack was dropped"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
}
