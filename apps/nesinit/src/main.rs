// nesinit: PID 1 inside a box.
//
// Three jobs, in the order they matter: reap what the workload orphans, run
// the workload the channel describes, and turn the end of either into an
// ordered shutdown.

use std::path::{Path, PathBuf};
use std::time::Duration;

use nesinit::payload::{self, Ports};
use nesinit::reap::{self, Waiters};
use nesinit::services::Stack;
use nesinit::session::{self, Outcome};
use nesinit::shutdown::{self, Machine};
use nesinit::ticket;
use nesinit::workload::{Process, Workload};
use nesprotocol::lifecycle::CONTROL_PORT;
use tokio::signal::unix::{SignalKind, signal};
use tokio_vsock::{VMADDR_CID_HOST, VsockAddr, VsockStream};

/// How long a process gets between being asked to stop and being made to.
const GRACE: Duration = Duration::from_secs(10);

/// How many envelopes may be in flight in one direction.
///
/// Small on purpose: what crosses this layer is re-sent when it changes, so a
/// deep queue holds stale copies of it rather than protecting anything.
const RELAY_DEPTH: usize = 8;

/// How many addresses may be waiting to be forwarded.
///
/// Two, because only the newest one matters: an address is superseded by the
/// next one rather than added to, so a deeper queue holds stale copies of it
/// and delays the one that is current.
const ADDRESS_DEPTH: usize = 2;

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    // Before everything, including the two below: the root is read-only and
    // nothing else in this guest is an init system, so until this runs there
    // is no `/proc` to score this process in and nowhere to put a socket.
    nesinit::filesystems::establish();

    // Everything a distribution's init scripts used to do, and nothing else is
    // going to: a hostname, the box's address, the directories a session's
    // sockets live in, and device nodes something is allowed to open. Before
    // the runtime, so the few processes it starts are waited for directly
    // rather than racing the reaper into existence. ref(d-0063)
    nesinit::system::prepare();

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
    //
    // `is_init` is what makes that safe to say. The three machine-wide steps
    // below — signal everything, kill everything, power off — are correct for
    // PID 1 of a box and catastrophic anywhere else, and this program is meant
    // to be runnable by hand: that is how most of it is tested and it is the
    // documented way to debug a guest that will not boot. Run as root outside a
    // box, the old path reached `kill(-1)` and `reboot` the moment the control
    // channel could not be dialled.
    let mut machine = Guest {
        workload,
        is_init: pid == 1,
    };
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

    // The relay is up before the workload is started, so a workload that
    // dials in as its first act finds it there.
    let (down_tx, down_rx) = tokio::sync::mpsc::channel(RELAY_DEPTH);
    let (up_tx, up_rx) = tokio::sync::mpsc::channel(RELAY_DEPTH);
    tokio::spawn(async move {
        if let Err(error) = payload::serve(Path::new(payload::SOCKET), down_rx, up_tx).await {
            tracing::error!(%error, "the relay is not running");
        }
    });
    let mut ports = Ports {
        to_workload: down_tx,
        from_workload: up_rx,
    };

    // Started before the workload, like the relay, and for the same reason:
    // whatever serves the address may bind the moment it comes up, and nothing
    // here should be the reason a session waits to be reachable.
    let (found_tx, mut found_rx) = tokio::sync::mpsc::channel(ADDRESS_DEPTH);
    // Which user the carrier must not accept an address from. Empty until the
    // descriptor names it, which is also when the workload that could abuse it
    // is started -- so there is nothing to refuse before it is filled in.
    let untrusted = ticket::Untrusted::unknown();
    tokio::spawn(ticket::carry(
        PathBuf::from(ticket::SOCKET),
        found_tx,
        untrusted.clone(),
    ));

    // The box's own services. Nothing is started here: bring-up happens once
    // the descriptor has been carried out, because a box whose shares are not
    // where they belong is not a box worth starting a stack in.
    let mut services = Stack::new(waiters.clone());

    let outcome = tokio::select! {
        outcome = session::run(channel, workload, &mut services, &mut ports, &mut found_rx, &untrusted) => outcome?,
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
    /// Whether this process is PID 1, and therefore whether the steps that act
    /// on *the machine* rather than on our own children may be taken at all.
    is_init: bool,
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
        if !self.is_init {
            tracing::warn!(
                "not PID 1, so not signalling every process: outside a box that \
                 is this machine's processes, not this box's"
            );
            return;
        }
        // -1 is every process this one may signal, which as PID 1 is all of
        // them but itself. The workload has already stopped by here.
        unsafe { libc::kill(-1, libc::SIGTERM) };
        wait_for_quiet(grace);
    }

    fn kill_rest(&mut self) {
        if !self.is_init {
            return;
        }
        unsafe { libc::kill(-1, libc::SIGKILL) };
        wait_for_quiet(Duration::from_secs(1));
    }

    fn flush_disks(&mut self) {
        // Harmless anywhere, so it is not guarded: the worst it does outside a
        // box is flush somebody's page cache.
        unsafe { libc::sync() };
    }

    fn power_off(&mut self) {
        if !self.is_init {
            // Everything this process started has been stopped by here, which
            // is the whole of what it may take responsibility for when it is
            // not the machine's init. What it prepared — the mounts, the
            // runtime directories — is deliberately left behind, because that
            // is exactly what makes a hand-run useful: run it, watch it fail to
            // reach a control channel that is not there, and then poke at a
            // guest that is otherwise set up.
            tracing::warn!("not PID 1, so not powering the machine off");
            std::process::exit(1);
        }
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
