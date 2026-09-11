// The guest end of the control channel.
//
// The shape of the exchange, and none of it is negotiable from this side: the
// guest speaks first with its version, is handed one document describing the
// box, brings the box's own services up, says so — and then takes commands for
// as long as the box lives. ref(d-0063)
//
// It is not a supervisor. Nothing here restarts anything of its own accord: a
// workload's exit is reported, a service's death is reported, and starting
// something again is the caller's decision, because the caller is the only end
// that can see whether restarting is repair or a loop. ref(d-0033)
//
// # One launch at a time
//
// A box may be launched into many times over its life, and not twice at once.
// A launch arriving while one is running is refused with the id it was asked
// for, rather than queued or silently replacing it — a box has one compositor
// and one screen, so a second concurrent launch has nowhere to draw. Nothing
// in the wire format forbids it if that ever changes; this is a property of
// this implementation and it says so where it refuses.

use nesprotocol::lifecycle::{
    CONTROL_VERSION, Exec, Exit, GuestToHost, HostToGuest, LaunchId, OnExit, Payload, from_line,
    to_line,
};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};

use crate::payload::Ports;
use crate::services::{Died, Services};
use crate::workload::{Exited, Failure, Workload};
use tokio::sync::mpsc::Receiver;

/// How a session ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// A launch whose exit was terminal ended, and the exit was reported.
    WorkloadExited(Exit),
    /// The caller asked for a shutdown.
    Shutdown,
    /// The channel closed under us. Not an error by itself — a caller that has
    /// stopped listening has also stopped being able to tell us to stop.
    ChannelClosed,
    /// The box could not be made. The reason is the operating system's,
    /// verbatim.
    ///
    /// This is the descriptor or the service stack, never a launch: a command
    /// that will not run is reported and the box stays up, because a box that
    /// dies of a bad `argv` cannot be told a better one.
    Refused(Failure),
}

/// The launch that is running, and what it would take to start it again.
struct Current {
    id: LaunchId,
    /// Kept so a restart is the same command rather than a new one the caller
    /// has to re-send.
    exec: Exec,
    on_exit: OnExit,
    exited: Exited,
    /// Set by `restart`, read when the exit arrives. A restart is a kill
    /// followed by a launch and this is the "followed by".
    relaunch: bool,
}

/// Run one session over an already-connected channel.
///
/// Generic over the channel so the exchange can be driven from a test without
/// a VM: the transport contributes nothing to the protocol beyond ordering and
/// framing, which any byte stream has.
pub async fn run<C, W, S>(
    channel: C,
    workload: &mut W,
    services: &mut S,
    payload: &mut Ports,
    addresses: &mut Receiver<String>,
    untrusted: &crate::ticket::Untrusted,
) -> std::io::Result<Outcome>
where
    C: AsyncRead + AsyncWrite,
    W: Workload,
    S: Services,
{
    match converse(channel, workload, services, payload, addresses, untrusted).await {
        Err(error) if channel_gone(&error) => {
            // A caller that has stopped reading has also stopped being able to
            // tell us to stop, which is the same situation as the channel
            // closing under a read. One outcome, not two.
            workload.signal_stop();
            Ok(Outcome::ChannelClosed)
        }
        other => other,
    }
}

/// Whether an error means the far end is gone rather than that something went
/// wrong here.
fn channel_gone(error: &std::io::Error) -> bool {
    use std::io::ErrorKind::{BrokenPipe, ConnectionAborted, ConnectionReset, UnexpectedEof};
    matches!(
        error.kind(),
        BrokenPipe | ConnectionReset | ConnectionAborted | UnexpectedEof
    )
}

async fn converse<C, W, S>(
    channel: C,
    workload: &mut W,
    services: &mut S,
    payload: &mut Ports,
    addresses: &mut Receiver<String>,
    untrusted: &crate::ticket::Untrusted,
) -> std::io::Result<Outcome>
where
    C: AsyncRead + AsyncWrite,
    W: Workload,
    S: Services,
{
    let (reader, mut writer) = tokio::io::split(channel);
    let mut lines = BufReader::new(reader).lines();

    // First line on the connection, before anything is read. The version is
    // here rather than in a round trip because the caller has to be able to
    // refuse a guest it cannot talk to before it hands over a descriptor.
    send(
        &mut writer,
        &GuestToHost::Ready {
            protocol_version: CONTROL_VERSION,
        },
    )
    .await?;

    let mut running: Option<Current> = None;
    let mut booted = false;
    let mut relay_open = true;
    let mut carrier_open = true;
    // Guarded like the other two, and for the same reason: a closed channel
    // resolves immediately and forever, so an unguarded branch on one turns
    // this loop into a spin that still looks like it is waiting.
    let mut services_open = true;

    loop {
        let event = match running.as_mut() {
            Some(current) => tokio::select! {
                ended = &mut current.exited => Event::Ended(ended?),
                line = lines.next_line() => Event::Line(line?),
                up = payload.from_workload.recv(), if relay_open => Event::FromWorkload(up),
                found = addresses.recv(), if carrier_open => Event::Address(found),
                gone = services.deaths().recv(), if services_open => Event::ServiceDied(gone),
            },
            None => tokio::select! {
                line = lines.next_line() => Event::Line(line?),
                up = payload.from_workload.recv(), if relay_open => Event::FromWorkload(up),
                found = addresses.recv(), if carrier_open => Event::Address(found),
                gone = services.deaths().recv(), if services_open => Event::ServiceDied(gone),
            },
        };

        let line = match event {
            Event::Ended(exit) => {
                // Taken before anything is sent: whatever happens next, this
                // launch is no longer the running one, and a failure to
                // relaunch must not leave a dead launch looking live.
                let ended = running.take().expect("an exit came from a launch");
                send(
                    &mut writer,
                    &GuestToHost::WorkloadExited {
                        id: ended.id.clone(),
                        exit,
                    },
                )
                .await?;

                if ended.relaunch {
                    // A restart is a kill followed by a launch of the same
                    // command, and this is the second half. The id is kept, so
                    // a caller sees the exit and then the same launch running
                    // again rather than having to correlate a new name.
                    running = start(
                        &mut writer,
                        workload,
                        untrusted,
                        ended.id,
                        ended.exec,
                        ended.on_exit,
                    )
                    .await?;
                    continue;
                }

                // Terminal is the launch's own answer, not this end's. A
                // non-terminal exit leaves the box up and waiting to be
                // launched into again, which is the whole point of the box
                // outliving what runs in it. ref(d-0063)
                if ended.on_exit.terminal {
                    return Ok(Outcome::WorkloadExited(exit));
                }
                tracing::info!(launch = %ended.id, "a launch ended and the box stays up");
                continue;
            }
            Event::ServiceDied(Some(Died { name, exit })) => {
                // Reported, never repaired. Nothing else in this guest is
                // watching these, so a death that is not said here is a box
                // that looks healthy and cannot work. ref(d-0063)
                tracing::error!(service = %name, ?exit, "a service died");
                send(&mut writer, &GuestToHost::ServiceDied { name, exit }).await?;
                continue;
            }
            Event::ServiceDied(None) => {
                // The supervisor is gone, which on the way down is ordinary.
                // Nothing to report and nothing to end: a box with no service
                // stack left can still be stopped and still has to report it.
                services_open = false;
                continue;
            }
            Event::FromWorkload(Some(payload)) => {
                tracing::debug!(envelope = %payload.summary(), "sending an envelope on");
                send(&mut writer, &GuestToHost::Payload { payload }).await?;
                continue;
            }
            Event::Address(Some(ticket)) => {
                // Sent whenever a better one is found, not only the first time:
                // a caller that keeps the first address it is given works on a
                // local network and fails from anywhere else.
                send(&mut writer, &GuestToHost::Ticket { ticket }).await?;
                continue;
            }
            Event::Address(None) => {
                // Nothing will look for an address again. Not an ending: the
                // session has whatever it was already told, and the workload
                // still has to be stopped and its exit reported.
                carrier_open = false;
                continue;
            }
            Event::FromWorkload(None) => {
                // The relay is gone. The session is not: the workload can
                // still be stopped, and its exit still has to be reported.
                relay_open = false;
                continue;
            }
            Event::Line(line) => line,
        };

        let Some(line) = line else {
            // The far end is gone. Stop the workload rather than leave it
            // running with nobody to report to.
            workload.signal_stop();
            return Ok(Outcome::ChannelClosed);
        };

        let message: HostToGuest = match from_line(&line) {
            Ok(message) => message,
            Err(error) => {
                // Skipped rather than fatal: a line this build does not
                // understand is not a reason to end a running session, and the
                // version handshake is what catches a peer we cannot talk to.
                tracing::warn!(%error, "ignoring an unreadable line");
                continue;
            }
        };

        match message {
            HostToGuest::Boot { descriptor } => {
                if booted {
                    tracing::warn!("ignoring a second descriptor: one is read per connection");
                    continue;
                }
                booted = true;

                // The shares, then the services, and each reported separately.
                // Which of the two failed decides what is worth looking at, so
                // the two are never one message.
                match workload.mount(&descriptor.mounts) {
                    Ok(()) => send(&mut writer, &GuestToHost::Mounted).await?,
                    Err(failure) => {
                        send(
                            &mut writer,
                            &GuestToHost::MountFailed {
                                reason: failure.reason.clone(),
                            },
                        )
                        .await?;
                        return Ok(Outcome::Refused(failure));
                    }
                }

                // A box whose own services will not come up cannot be launched
                // into, so this is refused rather than reported and carried on
                // from — unlike a launch, which is the caller's to correct.
                match services.bring_up() {
                    Ok(up) => {
                        tracing::info!(services = up.len(), "the box is ready to be launched into");
                        send(&mut writer, &GuestToHost::Initialized { services: up }).await?
                    }
                    Err(failure) => {
                        send(
                            &mut writer,
                            &GuestToHost::InitFailed {
                                reason: failure.reason.clone(),
                            },
                        )
                        .await?;
                        return Ok(Outcome::Refused(failure));
                    }
                }
            }
            HostToGuest::Launch { id, exec, on_exit } => {
                if !booted {
                    // Before the descriptor there are no shares and no
                    // services, so whatever this launch expects to find is not
                    // there yet. Refused with its own id rather than run into
                    // a box that is not finished.
                    refuse(&mut writer, id, "the box has not been told what it is").await?;
                    continue;
                }
                if let Some(current) = &running {
                    let reason =
                        format!("this box is already running a launch: {}", current.id);
                    refuse(&mut writer, id, &reason).await?;
                    continue;
                }
                running = start(&mut writer, workload, untrusted, id, exec, on_exit).await?;
            }
            HostToGuest::Stop { id } => match &running {
                // Idempotent, and never ends the session by itself.
                Some(current) if current.id == id => workload.signal_stop(),
                // Not an error and not worth failing: a caller stopping
                // something that has already stopped got what it asked for.
                // Signalling anyway would aim a kill at whatever is running
                // now, which is the one thing this must not do.
                _ => tracing::debug!(launch = %id, "nothing with that id is running to stop"),
            },
            HostToGuest::Restart { id } => match running.as_mut() {
                Some(current) if current.id == id => {
                    // Kill now, launch when the exit arrives. Doing both here
                    // would start the second before the first had gone.
                    current.relaunch = true;
                    workload.signal_stop();
                }
                // Nothing is remembered about a launch that has already ended,
                // so this cannot be a launch in disguise: the caller has the
                // command and can send it.
                _ => {
                    refuse(&mut writer, id, "nothing with that id is running to restart").await?;
                }
            },
            HostToGuest::Payload { payload: envelope } => hand_over(payload, envelope),
            HostToGuest::Shutdown => return Ok(Outcome::Shutdown),
        }
    }
}

/// Start one launch, reporting which of the two things happened.
///
/// Returns `None` when it could not be started, which is not the end of the
/// session: a box that dies of a bad `argv` cannot be told a better one.
async fn start<W, Wr>(
    writer: &mut Wr,
    workload: &mut W,
    untrusted: &crate::ticket::Untrusted,
    id: LaunchId,
    exec: Exec,
    on_exit: OnExit,
) -> std::io::Result<Option<Current>>
where
    W: Workload,
    Wr: AsyncWrite + Unpin,
{
    // Before the workload exists, so there is no window in which it is running
    // and something else would still be trusted to serve this session's
    // address.
    untrusted.is(exec.uid);

    match workload.start(&exec) {
        Ok(exited) => {
            send(writer, &GuestToHost::Started { id: id.clone() }).await?;
            Ok(Some(Current {
                id,
                exec,
                on_exit,
                exited,
                relaunch: false,
            }))
        }
        Err(failure) => {
            refuse(writer, id, &failure.reason).await?;
            Ok(None)
        }
    }
}

/// Say that a launch will not happen, in the words of whatever refused it.
async fn refuse<Wr>(writer: &mut Wr, id: LaunchId, reason: &str) -> std::io::Result<()>
where
    Wr: AsyncWrite + Unpin,
{
    tracing::warn!(launch = %id, reason, "refusing a launch");
    send(
        writer,
        &GuestToHost::StartFailed {
            id,
            reason: reason.to_string(),
        },
    )
    .await
}

/// What the session is waiting on.
enum Event {
    Line(Option<String>),
    Ended(Exit),
    FromWorkload(Option<Payload>),
    Address(Option<String>),
    ServiceDied(Option<Died>),
}

/// Hand an envelope to the relay, and treat a relay that is not there as the
/// caller's problem rather than a failure of this session.
///
/// It never waits. This loop also carries stop, shutdown and the workload's
/// exit, and none of those may be held up by a workload that is slow to read
/// its own mail — or by one that never connected at all. What crosses this
/// layer is re-sent when it changes, so a dropped copy costs less than a
/// stalled session.
fn hand_over(ports: &mut Ports, envelope: Payload) {
    use tokio::sync::mpsc::error::TrySendError;

    let summary = envelope.summary();
    match ports.to_workload.try_send(envelope) {
        Ok(()) => tracing::debug!(envelope = %summary, "handed an envelope over"),
        Err(TrySendError::Full(_)) => {
            tracing::warn!(envelope = %summary, "dropped an envelope: the relay is behind")
        }
        Err(TrySendError::Closed(_)) => {
            tracing::warn!(envelope = %summary, "dropped an envelope: the relay is gone")
        }
    }
}

async fn send<W>(writer: &mut W, message: &GuestToHost) -> std::io::Result<()>
where
    W: AsyncWrite + Unpin,
{
    let line = to_line(message).map_err(std::io::Error::other)?;
    writer.write_all(line.as_bytes()).await?;
    writer.flush().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::double::Double as Stack;
    use crate::workload::double::Double;
    use nesprotocol::lifecycle::{BootDescriptor, Mount};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream};
    use tokio::sync::mpsc;

    /// The box: one share, and nothing about what runs in it.
    fn descriptor() -> BootDescriptor {
        BootDescriptor {
            mounts: vec![Mount {
                tag: "user".into(),
                at: "/mnt/user".into(),
                ro: false,
            }],
        }
    }

    fn exec() -> Exec {
        Exec {
            argv: vec!["/usr/bin/workload".into(), "--windowed".into()],
            env: Default::default(),
            cwd: None,
            uid: 1001,
            gid: 1001,
        }
    }

    fn launch(id: &str) -> HostToGuest {
        HostToGuest::Launch {
            id: LaunchId::new(id),
            exec: exec(),
            on_exit: OnExit { terminal: true },
        }
    }

    /// A launch whose ending is not the session's ending, which is what lets a
    /// box be launched into again.
    fn launch_and_stay(id: &str) -> HostToGuest {
        HostToGuest::Launch {
            id: LaunchId::new(id),
            exec: exec(),
            on_exit: OnExit { terminal: false },
        }
    }

    /// The relay's two ends, as the session sees them, plus the ends a
    /// workload on the relay would hold.
    fn ports() -> (Ports, mpsc::Receiver<Payload>, mpsc::Sender<Payload>) {
        let (down_tx, down_rx) = mpsc::channel(4);
        let (up_tx, up_rx) = mpsc::channel(4);
        (
            Ports {
                to_workload: down_tx,
                from_workload: up_rx,
            },
            down_rx,
            up_tx,
        )
    }

    /// A carrier that never finds an address, for the tests that are not
    /// about one. Held open rather than closed: a closed channel is itself a
    /// case, and it is tested on purpose below.
    fn nowhere() -> mpsc::Receiver<String> {
        let (tx, rx) = mpsc::channel(1);
        // Kept alive for the process, so `recv` pends rather than resolving
        // `None` and taking a branch these tests are not exercising.
        Box::leak(Box::new(tx));
        rx
    }

    /// What a session is given, so a test names only the part it is about.
    struct Given {
        workload: Double,
        services: Stack,
        ports: Ports,
        addresses: mpsc::Receiver<String>,
    }

    impl Given {
        fn new(workload: Double) -> Self {
            let (ports, down_rx, up_tx) = ports();
            // The workload's ends of the relay, kept alive so the relay is
            // neither full nor gone in tests that are not about either.
            Box::leak(Box::new((down_rx, up_tx)));
            Self {
                workload,
                services: Stack::new(),
                ports,
                addresses: nowhere(),
            }
        }
    }

    /// Start a session and hand back what a test wants to assert against.
    fn spawn(
        guest: DuplexStream,
        given: Given,
    ) -> tokio::task::JoinHandle<(Outcome, Double, Stack)> {
        let Given {
            mut workload,
            mut services,
            mut ports,
            mut addresses,
        } = given;
        tokio::spawn(async move {
            let outcome = run(
                guest,
                &mut workload,
                &mut services,
                &mut ports,
                &mut addresses,
                &crate::ticket::Untrusted::unknown(),
            )
            .await
            .unwrap();
            (outcome, workload, services)
        })
    }

    /// The other end of the channel, as a caller would drive it.
    struct Caller {
        lines: tokio::io::Lines<BufReader<DuplexStream>>,
    }

    impl Caller {
        fn new(stream: DuplexStream) -> Self {
            Self {
                lines: BufReader::new(stream).lines(),
            }
        }

        async fn expect(&mut self) -> GuestToHost {
            let line = self
                .lines
                .next_line()
                .await
                .unwrap()
                .expect("the guest said nothing");
            from_line(&line).unwrap()
        }

        async fn expect_ready(&mut self) {
            assert_eq!(
                self.expect().await,
                GuestToHost::Ready {
                    protocol_version: CONTROL_VERSION
                }
            );
        }

        /// The descriptor being carried out: the shares, then the box's own
        /// services. Nothing is launched by either.
        async fn expect_booted(&mut self) {
            assert_eq!(self.expect().await, GuestToHost::Mounted);
            assert!(
                matches!(self.expect().await, GuestToHost::Initialized { .. }),
                "the box never said it was ready to be launched into"
            );
        }

        async fn say(&mut self, message: &HostToGuest) {
            let line = to_line(message).unwrap();
            self.lines
                .get_mut()
                .write_all(line.as_bytes())
                .await
                .unwrap();
        }
    }

    #[tokio::test]
    async fn the_guest_speaks_first_and_says_its_version() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);
        let session = spawn(guest, Given::new(Double::exits_when_stopped(Exit::code(0))));

        // Nothing has been sent to the guest, so this can only be unprompted.
        caller.expect_ready().await;

        caller.say(&HostToGuest::Shutdown).await;
        let (outcome, _, _) = session.await.unwrap();
        assert_eq!(outcome, Outcome::Shutdown);
    }

    /// The descriptor makes the box; it does not run anything. This is the
    /// property the whole resident arrangement rests on.
    #[tokio::test]
    async fn the_descriptor_mounts_and_starts_the_services_and_launches_nothing() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);
        let session = spawn(guest, Given::new(Double::exits_when_stopped(Exit::code(0))));

        caller.expect_ready().await;
        caller
            .say(&HostToGuest::Boot {
                descriptor: Box::new(descriptor()),
            })
            .await;
        caller.expect_booted().await;
        caller.say(&HostToGuest::Shutdown).await;

        let (outcome, workload, services) = session.await.unwrap();
        assert_eq!(outcome, Outcome::Shutdown);
        assert_eq!(workload.mounted, vec![descriptor().mounts]);
        assert_eq!(services.brought_up, 1);
        assert!(
            workload.started.is_empty(),
            "the descriptor started something, which is a launch's job"
        );
    }

    #[tokio::test]
    async fn a_launch_runs_what_it_names_and_is_reported_by_its_id() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);
        let session = spawn(guest, Given::new(Double::exits_when_stopped(Exit::code(0))));

        caller.expect_ready().await;
        caller
            .say(&HostToGuest::Boot {
                descriptor: Box::new(descriptor()),
            })
            .await;
        caller.expect_booted().await;

        caller.say(&launch("l-1")).await;
        assert_eq!(
            caller.expect().await,
            GuestToHost::Started {
                id: LaunchId::new("l-1")
            }
        );

        caller
            .say(&HostToGuest::Stop {
                id: LaunchId::new("l-1"),
            })
            .await;
        assert_eq!(
            caller.expect().await,
            GuestToHost::WorkloadExited {
                id: LaunchId::new("l-1"),
                exit: Exit::code(0)
            }
        );

        let (outcome, workload, _) = session.await.unwrap();
        assert_eq!(outcome, Outcome::WorkloadExited(Exit::code(0)));
        assert_eq!(workload.started, vec![exec()]);
    }

    /// A box the caller has not described has no shares and no services, so
    /// whatever a launch expects to find is not there.
    #[tokio::test]
    async fn a_launch_before_the_box_exists_is_refused() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);
        let session = spawn(guest, Given::new(Double::exits_when_stopped(Exit::code(0))));

        caller.expect_ready().await;
        caller.say(&launch("l-1")).await;

        let GuestToHost::StartFailed { id, reason } = caller.expect().await else {
            panic!("a launch into a box that does not exist was accepted")
        };
        assert_eq!(id, LaunchId::new("l-1"), "the refusal names another launch");
        assert!(!reason.is_empty());

        caller.say(&HostToGuest::Shutdown).await;
        let (outcome, workload, _) = session.await.unwrap();
        assert_eq!(outcome, Outcome::Shutdown, "the box died of a bad launch");
        assert!(workload.started.is_empty());
    }

    /// Two at once has nowhere to draw. The refusal carries the id that was
    /// refused, not the one that is running.
    #[tokio::test]
    async fn a_second_launch_is_refused_while_the_first_is_running() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);
        let session = spawn(guest, Given::new(Double::exits_when_stopped(Exit::code(0))));

        caller.expect_ready().await;
        caller
            .say(&HostToGuest::Boot {
                descriptor: Box::new(descriptor()),
            })
            .await;
        caller.expect_booted().await;

        caller.say(&launch("l-1")).await;
        assert_eq!(
            caller.expect().await,
            GuestToHost::Started {
                id: LaunchId::new("l-1")
            }
        );

        caller.say(&launch("l-2")).await;
        let GuestToHost::StartFailed { id, reason } = caller.expect().await else {
            panic!("a second concurrent launch was accepted")
        };
        assert_eq!(
            id,
            LaunchId::new("l-2"),
            "the refusal names the launch that is running rather than the one refused"
        );
        assert!(reason.contains("l-1"), "the refusal does not say why: {reason}");

        caller.say(&HostToGuest::Shutdown).await;
        let (_, workload, _) = session.await.unwrap();
        assert_eq!(
            workload.started.len(),
            1,
            "the second launch ran anyway, so the first was replaced underneath it"
        );
    }

    /// A launch that says its ending is not the session's leaves the box up and
    /// able to be launched into again. This is the whole of what "the box
    /// outlives what runs in it" means.
    #[tokio::test]
    async fn a_box_can_be_launched_into_again_after_a_launch_ends() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);
        let session = spawn(guest, Given::new(Double::exits_when_stopped(Exit::code(0))));

        caller.expect_ready().await;
        caller
            .say(&HostToGuest::Boot {
                descriptor: Box::new(descriptor()),
            })
            .await;
        caller.expect_booted().await;

        caller.say(&launch_and_stay("l-1")).await;
        assert_eq!(
            caller.expect().await,
            GuestToHost::Started {
                id: LaunchId::new("l-1")
            }
        );
        caller
            .say(&HostToGuest::Stop {
                id: LaunchId::new("l-1"),
            })
            .await;
        assert_eq!(
            caller.expect().await,
            GuestToHost::WorkloadExited {
                id: LaunchId::new("l-1"),
                exit: Exit::code(0)
            }
        );

        // The session is still here, which is the assertion.
        caller.say(&launch_and_stay("l-2")).await;
        assert_eq!(
            caller.expect().await,
            GuestToHost::Started {
                id: LaunchId::new("l-2")
            }
        );

        caller.say(&HostToGuest::Shutdown).await;
        let (outcome, workload, services) = session.await.unwrap();
        assert_eq!(outcome, Outcome::Shutdown);
        assert_eq!(workload.started.len(), 2);
        assert_eq!(
            services.brought_up, 1,
            "the services were brought up again for a second launch"
        );
    }

    /// A restart is a kill followed by a launch of the same command, and both
    /// halves are visible: the exit is reported and then the same id runs
    /// again. Nothing is restarted by this end on its own.
    #[tokio::test]
    async fn a_restart_reports_the_exit_and_runs_the_same_command_again() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);
        let session = spawn(guest, Given::new(Double::exits_when_stopped(Exit::code(0))));

        caller.expect_ready().await;
        caller
            .say(&HostToGuest::Boot {
                descriptor: Box::new(descriptor()),
            })
            .await;
        caller.expect_booted().await;

        caller.say(&launch("l-1")).await;
        assert_eq!(
            caller.expect().await,
            GuestToHost::Started {
                id: LaunchId::new("l-1")
            }
        );

        caller
            .say(&HostToGuest::Restart {
                id: LaunchId::new("l-1"),
            })
            .await;
        assert_eq!(
            caller.expect().await,
            GuestToHost::WorkloadExited {
                id: LaunchId::new("l-1"),
                exit: Exit::code(0)
            },
            "a restart hid the exit it caused"
        );
        assert_eq!(
            caller.expect().await,
            GuestToHost::Started {
                id: LaunchId::new("l-1")
            },
            "a restart kept the id but did not run again"
        );

        caller.say(&HostToGuest::Shutdown).await;
        let (outcome, workload, _) = session.await.unwrap();
        assert_eq!(outcome, Outcome::Shutdown);
        assert_eq!(
            workload.started,
            vec![exec(), exec()],
            "a restart ran a different command than the one it restarted"
        );
    }

    /// Nothing is remembered about a launch that has ended, so a restart of one
    /// is refused rather than guessed at from a stale command.
    #[tokio::test]
    async fn a_restart_of_nothing_is_refused_and_does_not_end_the_session() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);
        let session = spawn(guest, Given::new(Double::exits_when_stopped(Exit::code(0))));

        caller.expect_ready().await;
        caller
            .say(&HostToGuest::Boot {
                descriptor: Box::new(descriptor()),
            })
            .await;
        caller.expect_booted().await;

        caller
            .say(&HostToGuest::Restart {
                id: LaunchId::new("never-ran"),
            })
            .await;
        let GuestToHost::StartFailed { id, .. } = caller.expect().await else {
            panic!("a restart of nothing was accepted")
        };
        assert_eq!(id, LaunchId::new("never-ran"));

        caller.say(&HostToGuest::Shutdown).await;
        assert_eq!(session.await.unwrap().0, Outcome::Shutdown);
    }

    /// A stop for something that is not running is what a caller gets when it
    /// stops a launch twice. Signalling anyway would aim a kill at whatever is
    /// running now, which is the one thing it must not do.
    #[tokio::test]
    async fn a_stop_for_a_launch_that_is_not_running_signals_nothing() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);
        let session = spawn(guest, Given::new(Double::exits_when_stopped(Exit::code(0))));

        caller.expect_ready().await;
        caller
            .say(&HostToGuest::Boot {
                descriptor: Box::new(descriptor()),
            })
            .await;
        caller.expect_booted().await;

        caller.say(&launch_and_stay("l-1")).await;
        assert_eq!(
            caller.expect().await,
            GuestToHost::Started {
                id: LaunchId::new("l-1")
            }
        );

        // Something else entirely, while l-1 runs.
        caller
            .say(&HostToGuest::Stop {
                id: LaunchId::new("l-2"),
            })
            .await;
        caller.say(&HostToGuest::Shutdown).await;

        let (outcome, workload, _) = session.await.unwrap();
        assert_eq!(outcome, Outcome::Shutdown);
        assert_eq!(
            workload.stops, 0,
            "a stop aimed at one launch reached another"
        );
    }

    /// A command that will not run is the caller's to correct, so the box stays
    /// up and can be told a better one.
    #[tokio::test]
    async fn a_launch_that_will_not_run_does_not_take_the_box_down() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);
        let mut workload = Double::exits_at_once(Exit::code(0));
        workload.start_failure = Some(Failure::new("ENOENT: /usr/bin/workload"));
        let session = spawn(guest, Given::new(workload));

        caller.expect_ready().await;
        caller
            .say(&HostToGuest::Boot {
                descriptor: Box::new(descriptor()),
            })
            .await;
        caller.expect_booted().await;

        caller.say(&launch("l-1")).await;
        assert_eq!(
            caller.expect().await,
            GuestToHost::StartFailed {
                id: LaunchId::new("l-1"),
                reason: "ENOENT: /usr/bin/workload".into()
            },
            "the reason is passed through as the operating system wrote it",
        );

        // Still answering, which is the assertion.
        caller.say(&HostToGuest::Shutdown).await;
        assert_eq!(session.await.unwrap().0, Outcome::Shutdown);
    }

    #[tokio::test]
    async fn a_share_that_will_not_mount_is_refused_before_any_service_starts() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);
        let mut workload = Double::exits_at_once(Exit::code(0));
        workload.mount_failure = Some(Failure::new("EACCES: /mnt/user"));
        let session = spawn(guest, Given::new(workload));

        caller.expect_ready().await;
        caller
            .say(&HostToGuest::Boot {
                descriptor: Box::new(descriptor()),
            })
            .await;

        assert_eq!(
            caller.expect().await,
            GuestToHost::MountFailed {
                reason: "EACCES: /mnt/user".into()
            },
            "the reason is passed through as the operating system wrote it",
        );

        let (outcome, workload, services) = session.await.unwrap();
        assert_eq!(outcome, Outcome::Refused(Failure::new("EACCES: /mnt/user")));
        assert_eq!(
            services.brought_up, 0,
            "the services came up in a box whose shares are not there"
        );
        assert!(workload.started.is_empty());
    }

    /// A box whose own services will not come up cannot be launched into, so it
    /// is refused — and said with its own message, because a share that did not
    /// appear and a box that could not be made want different things looked at.
    #[tokio::test]
    async fn a_service_stack_that_will_not_come_up_refuses_the_box() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);
        let mut given = Given::new(Double::exits_at_once(Exit::code(0)));
        given.services = Stack::refuses("neshub: ENOENT — the session has no address");
        let session = spawn(guest, given);

        caller.expect_ready().await;
        caller
            .say(&HostToGuest::Boot {
                descriptor: Box::new(descriptor()),
            })
            .await;

        assert_eq!(caller.expect().await, GuestToHost::Mounted);
        let GuestToHost::InitFailed { reason } = caller.expect().await else {
            panic!("a box with no services said it was ready to be launched into")
        };
        assert!(reason.contains("neshub"), "{reason}");

        let (outcome, workload, _) = session.await.unwrap();
        assert!(matches!(outcome, Outcome::Refused(_)), "{outcome:?}");
        assert!(workload.started.is_empty());
    }

    /// Reported, never repaired, and it does not end the session: a box with a
    /// dead service is still a box somebody has to be told about.
    #[tokio::test]
    async fn a_dead_service_is_reported_and_not_restarted() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);
        let given = Given::new(Double::exits_when_stopped(Exit::code(0)));
        let report = given.services.report.clone();
        let session = spawn(guest, given);

        caller.expect_ready().await;
        caller
            .say(&HostToGuest::Boot {
                descriptor: Box::new(descriptor()),
            })
            .await;
        caller.expect_booted().await;

        report
            .send(Died {
                name: "pipewire".into(),
                exit: Exit::signal(9),
            })
            .await
            .unwrap();
        assert_eq!(
            caller.expect().await,
            GuestToHost::ServiceDied {
                name: "pipewire".into(),
                exit: Exit::signal(9)
            }
        );

        // Still answering, and nothing was brought up again.
        caller.say(&HostToGuest::Shutdown).await;
        let (outcome, _, services) = session.await.unwrap();
        assert_eq!(outcome, Outcome::Shutdown);
        assert_eq!(
            services.brought_up, 1,
            "a dead service was restarted by the guest"
        );
    }

    /// The address goes up the channel as it is found. This is the only way
    /// out: standard output here is a log file inside a VM and the person who
    /// needs the address is outside it.
    #[tokio::test]
    async fn an_address_that_is_found_is_reported_to_the_caller() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);
        let (found_tx, found_rx) = mpsc::channel(4);
        let mut given = Given::new(Double::exits_when_stopped(Exit::code(0)));
        given.addresses = found_rx;
        let session = spawn(guest, given);

        caller.expect_ready().await;

        found_tx
            .send("nestri:local-only".to_string())
            .await
            .unwrap();
        assert_eq!(
            caller.expect().await,
            GuestToHost::Ticket {
                ticket: "nestri:local-only".into()
            }
        );

        // And a better one replaces it rather than being the caller's problem
        // to have missed.
        found_tx
            .send("nestri:with-relays".to_string())
            .await
            .unwrap();
        assert_eq!(
            caller.expect().await,
            GuestToHost::Ticket {
                ticket: "nestri:with-relays".into()
            }
        );

        caller.say(&HostToGuest::Shutdown).await;
        assert_eq!(session.await.unwrap().0, Outcome::Shutdown);
    }

    /// Nothing looking for an address any more is not an ending. The session
    /// keeps whatever it was already told and still has to report an exit.
    #[tokio::test]
    async fn a_carrier_that_stops_does_not_end_the_session() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);
        let (found_tx, found_rx) = mpsc::channel(4);
        let mut given = Given::new(Double::exits_when_stopped(Exit::code(0)));
        given.addresses = found_rx;
        let session = spawn(guest, given);

        caller.expect_ready().await;
        drop(found_tx);

        // Still answering, which is the whole assertion.
        caller.say(&HostToGuest::Shutdown).await;
        assert_eq!(session.await.unwrap().0, Outcome::Shutdown);
    }

    #[tokio::test]
    async fn an_exit_is_reported_and_the_workload_is_not_started_again() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);
        let session = spawn(guest, Given::new(Double::exits_at_once(Exit::code(3))));

        caller.expect_ready().await;
        caller
            .say(&HostToGuest::Boot {
                descriptor: Box::new(descriptor()),
            })
            .await;
        caller.expect_booted().await;
        caller.say(&launch("l-1")).await;
        assert_eq!(
            caller.expect().await,
            GuestToHost::Started {
                id: LaunchId::new("l-1")
            }
        );

        assert_eq!(
            caller.expect().await,
            GuestToHost::WorkloadExited {
                id: LaunchId::new("l-1"),
                exit: Exit::code(3)
            },
        );

        let (outcome, workload, _) = session.await.unwrap();
        assert_eq!(outcome, Outcome::WorkloadExited(Exit::code(3)));
        assert_eq!(
            workload.started.len(),
            1,
            "an exit is reported, never restarted"
        );
    }

    #[tokio::test]
    async fn a_signalled_workload_is_reported_as_signalled() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);
        let session = spawn(guest, Given::new(Double::exits_at_once(Exit::signal(9))));

        caller.expect_ready().await;
        caller
            .say(&HostToGuest::Boot {
                descriptor: Box::new(descriptor()),
            })
            .await;
        caller.expect_booted().await;
        caller.say(&launch("l-1")).await;
        assert!(matches!(caller.expect().await, GuestToHost::Started { .. }));

        assert_eq!(
            caller.expect().await,
            GuestToHost::WorkloadExited {
                id: LaunchId::new("l-1"),
                exit: Exit::signal(9)
            },
        );
        assert_eq!(
            session.await.unwrap().0,
            Outcome::WorkloadExited(Exit::signal(9))
        );
    }

    #[tokio::test]
    async fn an_unreadable_line_does_not_end_a_session() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);
        let session = spawn(guest, Given::new(Double::exits_when_stopped(Exit::code(0))));

        caller.expect_ready().await;
        caller
            .lines
            .get_mut()
            .write_all(br#"{"type":"from_a_later_version"}"#)
            .await
            .unwrap();
        caller.lines.get_mut().write_all(b"\n")
            .await
            .unwrap();
        caller.say(&HostToGuest::Shutdown).await;

        assert_eq!(session.await.unwrap().0, Outcome::Shutdown);
    }

    #[tokio::test]
    async fn a_closed_channel_stops_the_workload() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);
        let session = spawn(guest, Given::new(Double::exits_when_stopped(Exit::code(0))));

        caller.expect_ready().await;
        caller
            .say(&HostToGuest::Boot {
                descriptor: Box::new(descriptor()),
            })
            .await;
        caller.expect_booted().await;
        caller.say(&launch("l-1")).await;
        assert!(matches!(caller.expect().await, GuestToHost::Started { .. }));
        drop(caller);

        let (outcome, workload, _) = session.await.unwrap();
        assert!(
            matches!(outcome, Outcome::ChannelClosed | Outcome::WorkloadExited(_)),
            "unexpected outcome: {outcome:?}",
        );
        assert!(
            workload.stops >= 1,
            "the workload was left running with nobody listening"
        );
    }

    #[tokio::test]
    async fn an_envelope_crosses_the_session_in_both_directions_unread() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);
        let (down_tx, down_rx) = mpsc::channel(4);
        let (up_tx, up_rx) = mpsc::channel(4);
        let mut given = Given::new(Double::exits_when_stopped(Exit::code(0)));
        given.ports = Ports {
            to_workload: down_tx,
            from_workload: up_rx,
        };
        let session = spawn(guest, given);
        let mut to_relay = down_rx;

        caller.expect_ready().await;

        // Down: an envelope arrives before any descriptor does, and still
        // reaches the relay — what crosses this layer is not the boot
        // sequence's business.
        let body = r#"{"looks":"structured"} and is not"#;
        caller
            .say(&HostToGuest::Payload {
                payload: Payload::new("identity", body),
            })
            .await;
        let handed_over = to_relay.recv().await.unwrap();
        assert_eq!(handed_over.body, body, "the body arrived changed");
        assert_eq!(handed_over.channel, "identity");

        // Up: the same, in reverse.
        up_tx
            .send(Payload::new("identity", "opaque back"))
            .await
            .unwrap();
        assert_eq!(
            caller.expect().await,
            GuestToHost::Payload {
                payload: Payload::new("identity", "opaque back")
            },
        );

        caller.say(&HostToGuest::Shutdown).await;
        assert_eq!(session.await.unwrap().0, Outcome::Shutdown);
    }

    #[tokio::test]
    async fn a_relay_nothing_is_on_does_not_end_a_session() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);
        let (down_tx, down_rx) = mpsc::channel(1);
        let (_up_tx, up_rx) = mpsc::channel::<Payload>(1);
        drop(down_rx); // nothing is on the relay
        let mut given = Given::new(Double::exits_when_stopped(Exit::code(0)));
        given.ports = Ports {
            to_workload: down_tx,
            from_workload: up_rx,
        };
        let session = spawn(guest, given);

        caller.expect_ready().await;
        caller
            .say(&HostToGuest::Payload {
                payload: Payload::new("identity", "dropped"),
            })
            .await;
        caller
            .say(&HostToGuest::Boot {
                descriptor: Box::new(descriptor()),
            })
            .await;
        caller.expect_booted().await;
        caller.say(&HostToGuest::Shutdown).await;

        assert_eq!(session.await.unwrap().0, Outcome::Shutdown);
    }

    #[tokio::test]
    async fn a_relay_that_is_not_draining_does_not_stall_the_session() {
        // Bounded, because the failure is a session that stops rather than one
        // that answers wrongly.
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            a_backed_up_relay().await
        })
        .await
        .expect("the session stalled on the relay");
    }

    async fn a_backed_up_relay() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);
        let (down_tx, down_rx) = mpsc::channel(1);
        let (_up_tx, up_rx) = mpsc::channel::<Payload>(1);
        // Held and never read: a workload that is slow to read its own mail,
        // or one that connected and stopped.
        let _backed_up = down_rx;
        let mut given = Given::new(Double::exits_when_stopped(Exit::code(0)));
        given.ports = Ports {
            to_workload: down_tx,
            from_workload: up_rx,
        };
        let session = spawn(guest, given);

        caller.expect_ready().await;
        for _ in 0..8 {
            caller
                .say(&HostToGuest::Payload {
                    payload: Payload::new("identity", "backlog"),
                })
                .await;
        }

        // The lifecycle layer still moves: stop, shutdown and an exit are on
        // this loop too, and none of them may wait on the relay.
        caller
            .say(&HostToGuest::Boot {
                descriptor: Box::new(descriptor()),
            })
            .await;
        caller.expect_booted().await;
        caller.say(&launch("l-1")).await;
        assert!(matches!(caller.expect().await, GuestToHost::Started { .. }));
        caller.say(&HostToGuest::Shutdown).await;

        assert_eq!(session.await.unwrap().0, Outcome::Shutdown);
    }
}
