// nesinit: PID 1 inside a box.
//
// Three jobs, in the order they matter: reap what the workload orphans, run
// the workload the channel describes, and turn the end of either into an
// ordered shutdown.

use std::time::Duration;

use nesinit::reap;
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

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let outcome = runtime.block_on(guest());
    match &outcome {
        Ok(outcome) => tracing::info!(?outcome, "the session ended"),
        Err(error) => tracing::error!(%error, "the session failed"),
    }

    // Reached however the session ended, including an error: an init that
    // returns leaves the guest running with nothing in it.
    let mut machine = Guest::new();
    shutdown::ordered(&mut machine, GRACE);
    unreachable!("power_off does not return");
}

async fn guest() -> anyhow::Result<Outcome> {
    // Reaping runs for as long as the guest does. A workload that leaks
    // orphans leaks them while it is running, not when it stops.
    tokio::spawn(reaper());

    let address = VsockAddr::new(VMADDR_CID_HOST, CONTROL_PORT);
    // Dialled once, with no retry: the far end is listening before this
    // machine exists, so a refused connection means something is wrong that
    // waiting will not fix.
    let channel = VsockStream::connect(address).await?;

    let mut workload = Process::new();
    let outcome = tokio::select! {
        outcome = session::run(channel, &mut workload) => outcome?,
        signal = asked_to_stop() => {
            signal?;
            tracing::info!("asked to stop");
            Outcome::Shutdown
        }
    };
    Ok(outcome)
}

/// Drain exited children whenever the kernel says there are some.
async fn reaper() {
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
            tracing::debug!(pid, ?exit, "reaped");
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

impl Guest {
    fn new() -> Self {
        Self {
            workload: Process::new(),
        }
    }
}

impl Machine for Guest {
    fn signal_workload(&mut self) {
        self.workload.signal_stop();
    }

    fn await_workload(&mut self, grace: Duration) -> bool {
        // The session already reported the exit if there was one; this is the
        // window for a workload that was asked to stop on the way down.
        wait_for_quiet(grace)
    }

    fn kill_workload(&mut self) {
        // SAFETY: two integers, and the kernel refuses to signal init itself.
        unsafe { libc::kill(-1, libc::SIGKILL) };
    }

    fn signal_rest(&mut self, grace: Duration) {
        // -1 is every process this one may signal, which as PID 1 is all of
        // them but itself.
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
