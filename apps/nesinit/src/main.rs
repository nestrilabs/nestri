// nesinit: PID 1 inside a box.
//
// Three jobs, in the order they matter: reap what the workload orphans, run
// the workload the channel describes, and turn the end of either into an
// ordered shutdown.

use std::time::Duration;

use nesinit::reap::{self, Waiters};
use nesinit::session::{self, Outcome};
use nesinit::shutdown::{self, Machine};
use nesinit::workload::{Process, Workload};
use nesprotocol::lifecycle::CONTROL_PORT;
use tokio::signal::unix::{SignalKind, signal};
use tokio_vsock::{VMADDR_CID_HOST, VsockAddr, VsockStream};

/// How long a process gets between being asked to stop and being made to.
const GRACE: Duration = Duration::from_secs(10);

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    // Both before anything is started, so nothing can be orphaned or scored
    // in the window where neither is true yet.
    if let Err(error) = reap::become_subreaper() {
        tracing::warn!(%error, "orphans may not be reaped by this process");
    }
    if let Err(error) = reap::refuse_oom_kill() {
        // Not fatal: outside a guest there may be no procfs to write to, and
        // refusing to boot over it would be worse than the risk.
        tracing::warn!(%error, "init is eligible for the OOM killer");
    }

    let pid = std::process::id();
    if pid != 1 {
        tracing::warn!(pid, "not PID 1: the kernel will reparent orphans elsewhere");
    }

    let waiters = Waiters::new();
    let mut workload = Process::new(waiters.clone());

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let outcome = runtime.block_on(guest(&waiters, &mut workload));
    match &outcome {
        Ok(outcome) => tracing::info!(?outcome, "the session ended"),
        Err(error) => tracing::error!(%error, "the session failed"),
    }

    // Before anything below waits on a pid: the reaper runs on this runtime's
    // threads, and two things calling `wait` is what the registry exists to
    // prevent.
    drop(runtime);

    // Reached however the session ended, including an error: an init that
    // returns leaves the guest running with nothing in it.
    let mut machine = Guest { workload };
    shutdown::ordered(&mut machine, GRACE);
    unreachable!("power_off does not return");
}

async fn guest(waiters: &Waiters, workload: &mut Process) -> anyhow::Result<Outcome> {
    // Reaping runs for as long as the guest does. A workload that leaks
    // orphans leaks them while it is running, not when it stops.
    tokio::spawn(reaper(waiters.clone()));

    let address = VsockAddr::new(VMADDR_CID_HOST, CONTROL_PORT);
    // Dialled once, with no retry: the far end is listening before this
    // machine exists, so a refused connection means something is wrong that
    // waiting will not fix.
    let channel = VsockStream::connect(address).await?;

    let outcome = tokio::select! {
        outcome = session::run(channel, workload) => outcome?,
        signal = asked_to_stop() => {
            signal?;
            tracing::info!("asked to stop");
            Outcome::Shutdown
        }
    };
    Ok(outcome)
}

/// Drain exited children whenever the kernel says there are some, and hand
/// each exit to whoever is waiting for it.
async fn reaper(waiters: Waiters) {
    let mut children = match signal(SignalKind::child()) {
        Ok(children) => children,
        Err(error) => {
            tracing::error!(%error, "orphans will not be reaped");
            return;
        }
    };
    loop {
        children.recv().await;
        for (pid, exit) in reap::reap_exited() {
            if !waiters.deliver(pid, exit) {
                // An orphan nothing asked about, which is most of them.
                tracing::debug!(pid, ?exit, "reaped");
            }
        }
    }
}

/// A signal from outside the channel. In a guest this is the hypervisor's
/// shutdown request.
async fn asked_to_stop() -> std::io::Result<()> {
    let mut term = signal(SignalKind::terminate())?;
    let mut int = signal(SignalKind::interrupt())?;
    tokio::select! {
        _ = term.recv() => Ok(()),
        _ = int.recv() => Ok(()),
    }
}

/// The machine, for real.
struct Guest {
    workload: Process,
}

impl Machine for Guest {
    fn signal_workload(&mut self) {
        self.workload.signal_stop();
    }

    fn await_workload(&mut self, grace: Duration) -> bool {
        // The session already reported the exit if there was one; this is the
        // window for a workload that was asked to stop on the way down. It
        // waits for that pid and no other, or the first service to leave would
        // look like the workload leaving.
        self.workload.await_exit(grace)
    }

    fn kill_workload(&mut self) {
        // The workload alone. Everything else in the guest is still expected
        // to get the ordered stop below, and a kill to every process here
        // would take the services with it.
        self.workload.signal(libc::SIGKILL);
        self.workload.await_exit(Duration::from_secs(1));
    }

    fn signal_rest(&mut self, grace: Duration) {
        // -1 is every process this one may signal, which as PID 1 is all of
        // them but itself. The workload has already stopped by here.
        unsafe { libc::kill(-1, libc::SIGTERM) };
        wait_for_quiet(grace);
    }

    fn kill_rest(&mut self) {
        unsafe { libc::kill(-1, libc::SIGKILL) };
        wait_for_quiet(Duration::from_secs(1));
    }

    fn flush_disks(&mut self) {
        unsafe { libc::sync() };
    }

    fn power_off(&mut self) {
        // SAFETY: reboot is the only way out of a guest whose init is done.
        unsafe { libc::reboot(libc::RB_POWER_OFF) };
        // Reached only if the guest refused to power off, which no caller can
        // be told about — the channel is gone by now.
        std::process::exit(0);
    }
}

/// Reap until nothing is left or the deadline passes.
fn wait_for_quiet(grace: Duration) -> bool {
    let deadline = std::time::Instant::now() + grace;
    loop {
        let mut status: libc::c_int = 0;
        // Blocking on purpose: this runs after the runtime has stopped, so
        // there is nothing left to keep responsive.
        let pid = unsafe { libc::waitpid(-1, &mut status, libc::WNOHANG) };
        if pid == -1 {
            return true; // ECHILD: nothing left to wait for
        }
        if std::time::Instant::now() >= deadline {
            return false;
        }
        if pid == 0 {
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}
