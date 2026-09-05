// The guest end of the control channel.
//
// The shape of the exchange, and none of it is negotiable from this side: the
// guest speaks first with its version, is handed one boot descriptor, and from
// then on reports. It is not a supervisor: when the workload ends, the exit
// goes up the channel and this returns. Starting something again is the
// caller's decision, because the caller is the only end that can see whether
// restarting is repair or a loop. ref(d-0033)

use nesprotocol::lifecycle::{
    CONTROL_VERSION, Exit, GuestToHost, HostToGuest, Payload, from_line, to_line,
};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};

use crate::payload::Ports;
use crate::workload::{Exited, Failure, Workload};

/// How a session ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// The workload ended and the exit was reported.
    WorkloadExited(Exit),
    /// The caller asked for a shutdown.
    Shutdown,
    /// The channel closed under us. Not an error by itself — a caller that has
    /// stopped listening has also stopped being able to tell us to stop.
    ChannelClosed,
    /// The descriptor could not be carried out. The reason is the operating
    /// system's, verbatim.
    Refused(Failure),
}

/// Run one session over an already-connected channel.
///
/// Generic over the channel so the exchange can be driven from a test without
/// a VM: the transport contributes nothing to the protocol beyond ordering and
/// framing, which any byte stream has.
pub async fn run<C, W>(
    channel: C,
    workload: &mut W,
    payload: &mut Ports,
) -> std::io::Result<Outcome>
where
    C: AsyncRead + AsyncWrite,
    W: Workload,
{
    match converse(channel, workload, payload).await {
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

async fn converse<C, W>(
    channel: C,
    workload: &mut W,
    payload: &mut Ports,
) -> std::io::Result<Outcome>
where
    C: AsyncRead + AsyncWrite,
    W: Workload,
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

    let mut running: Option<Exited> = None;
    let mut relay_open = true;

    loop {
        let event = match running.as_mut() {
            Some(exited) => tokio::select! {
                ended = exited => Event::Ended(ended?),
                line = lines.next_line() => Event::Line(line?),
                up = payload.from_workload.recv(), if relay_open => Event::FromWorkload(up),
            },
            None => tokio::select! {
                line = lines.next_line() => Event::Line(line?),
                up = payload.from_workload.recv(), if relay_open => Event::FromWorkload(up),
            },
        };

        let line = match event {
            Event::Ended(exit) => {
                send(&mut writer, &GuestToHost::WorkloadExited { exit }).await?;
                return Ok(Outcome::WorkloadExited(exit));
            }
            Event::FromWorkload(Some(payload)) => {
                tracing::debug!(envelope = %payload.summary(), "sending an envelope on");
                send(&mut writer, &GuestToHost::Payload { payload }).await?;
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
                if running.is_some() {
                    tracing::warn!("ignoring a second descriptor: one is read per connection");
                    continue;
                }

                // The shares, then the command, and each reported separately.
                // Which of the two failed decides what is worth looking at,
                // so the two are never one message.
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

                match workload.start(&descriptor.exec) {
                    Ok(exited) => {
                        send(&mut writer, &GuestToHost::Started).await?;
                        running = Some(exited);
                    }
                    Err(failure) => {
                        send(
                            &mut writer,
                            &GuestToHost::StartFailed {
                                reason: failure.reason.clone(),
                            },
                        )
                        .await?;
                        return Ok(Outcome::Refused(failure));
                    }
                }
            }
            HostToGuest::Payload { payload: envelope } => hand_over(payload, envelope),
            HostToGuest::Stop => workload.signal_stop(),
            HostToGuest::Shutdown => return Ok(Outcome::Shutdown),
        }
    }
}

/// What the session is waiting on, and there are only three things.
enum Event {
    Line(Option<String>),
    Ended(Exit),
    FromWorkload(Option<Payload>),
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
    use crate::workload::double::Double;
    use nesprotocol::lifecycle::{BootDescriptor, Exec, Geometry, Mount, OnExit};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream};
    use tokio::sync::mpsc;

    fn descriptor() -> BootDescriptor {
        BootDescriptor {
            exec: Exec {
                argv: vec!["/usr/bin/workload".into(), "--windowed".into()],
                env: Default::default(),
                cwd: None,
                uid: 1000,
                gid: 1000,
            },
            mounts: vec![Mount {
                tag: "user".into(),
                at: "/mnt/user".into(),
                ro: false,
            }],
            geometry: Geometry {
                width: 1920,
                height: 1080,
                fps: 60,
                hdr: false,
            },
            on_exit: OnExit { terminal: true },
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

        /// A descriptor being carried out: the shares, then the command.
        async fn expect_started(&mut self) {
            assert_eq!(self.expect().await, GuestToHost::Mounted);
            assert_eq!(self.expect().await, GuestToHost::Started);
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

        let session = tokio::spawn(async move {
            let (mut ports, _to_workload, _from_workload) = ports();
            let mut workload = Double::exits_when_stopped(Exit::code(0));
            let outcome = run(guest, &mut workload, &mut ports).await.unwrap();
            (outcome, workload)
        });

        // Nothing has been sent to the guest, so this can only be unprompted.
        assert_eq!(
            caller.expect().await,
            GuestToHost::Ready {
                protocol_version: 2
            }
        );

        caller.say(&HostToGuest::Shutdown).await;
        let (outcome, _) = session.await.unwrap();
        assert_eq!(outcome, Outcome::Shutdown);
    }

    #[tokio::test]
    async fn the_descriptor_mounts_and_starts_what_it_names() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);

        let session = tokio::spawn(async move {
            let (mut ports, _to_workload, _from_workload) = ports();
            let mut workload = Double::exits_when_stopped(Exit::code(0));
            let outcome = run(guest, &mut workload, &mut ports).await.unwrap();
            (outcome, workload)
        });

        assert!(matches!(caller.expect().await, GuestToHost::Ready { .. }));
        caller
            .say(&HostToGuest::Boot {
                descriptor: Box::new(descriptor()),
            })
            .await;
        caller.say(&HostToGuest::Stop).await;

        let (outcome, workload) = session.await.unwrap();
        assert_eq!(outcome, Outcome::WorkloadExited(Exit::code(0)));
        assert_eq!(workload.mounted, vec![descriptor().mounts]);
        assert_eq!(workload.started, vec![descriptor().exec]);
    }

    #[tokio::test]
    async fn an_exit_is_reported_and_the_workload_is_not_started_again() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);

        let session = tokio::spawn(async move {
            let (mut ports, _to_workload, _from_workload) = ports();
            let mut workload = Double::exits_at_once(Exit::code(3));
            let outcome = run(guest, &mut workload, &mut ports).await.unwrap();
            (outcome, workload)
        });

        assert!(matches!(caller.expect().await, GuestToHost::Ready { .. }));
        caller
            .say(&HostToGuest::Boot {
                descriptor: Box::new(descriptor()),
            })
            .await;
        caller.expect_started().await;

        assert_eq!(
            caller.expect().await,
            GuestToHost::WorkloadExited {
                exit: Exit::code(3)
            },
        );

        let (outcome, workload) = session.await.unwrap();
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

        let session = tokio::spawn(async move {
            let (mut ports, _to_workload, _from_workload) = ports();
            let mut workload = Double::exits_at_once(Exit::signal(9));
            run(guest, &mut workload, &mut ports).await.unwrap()
        });

        assert!(matches!(caller.expect().await, GuestToHost::Ready { .. }));
        caller
            .say(&HostToGuest::Boot {
                descriptor: Box::new(descriptor()),
            })
            .await;
        caller.expect_started().await;

        assert_eq!(
            caller.expect().await,
            GuestToHost::WorkloadExited {
                exit: Exit::signal(9)
            },
        );
        assert_eq!(
            session.await.unwrap(),
            Outcome::WorkloadExited(Exit::signal(9))
        );
    }

    #[tokio::test]
    async fn a_stop_is_idempotent_and_does_not_end_the_session() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);

        let session = tokio::spawn(async move {
            let (mut ports, _to_workload, _from_workload) = ports();
            let mut workload = Double::exits_when_stopped(Exit::code(0));
            let outcome = run(guest, &mut workload, &mut ports).await.unwrap();
            (outcome, workload)
        });

        assert!(matches!(caller.expect().await, GuestToHost::Ready { .. }));
        // No descriptor yet, so there is nothing to stop and the session has
        // to survive being told to anyway.
        caller.say(&HostToGuest::Stop).await;
        caller.say(&HostToGuest::Stop).await;
        caller.say(&HostToGuest::Shutdown).await;

        let (outcome, workload) = session.await.unwrap();
        assert_eq!(outcome, Outcome::Shutdown);
        assert_eq!(workload.stops, 2);
        assert!(workload.started.is_empty());
    }

    #[tokio::test]
    async fn a_share_that_will_not_mount_is_refused_before_anything_starts() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);

        let session = tokio::spawn(async move {
            let (mut ports, _to_workload, _from_workload) = ports();
            let mut workload = Double::exits_at_once(Exit::code(0));
            workload.mount_failure = Some(Failure::new("EACCES: /mnt/user"));
            let outcome = run(guest, &mut workload, &mut ports).await.unwrap();
            (outcome, workload)
        });

        assert!(matches!(caller.expect().await, GuestToHost::Ready { .. }));
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

        let (outcome, workload) = session.await.unwrap();
        assert_eq!(outcome, Outcome::Refused(Failure::new("EACCES: /mnt/user")));
        assert!(
            workload.started.is_empty(),
            "a workload without its shares is not started"
        );
    }

    #[tokio::test]
    async fn an_unreadable_line_does_not_end_a_session() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);

        let session = tokio::spawn(async move {
            let (mut ports, _to_workload, _from_workload) = ports();
            let mut workload = Double::exits_when_stopped(Exit::code(0));
            run(guest, &mut workload, &mut ports).await.unwrap()
        });

        assert!(matches!(caller.expect().await, GuestToHost::Ready { .. }));
        caller
            .lines
            .get_mut()
            .write_all(b"{\"type\":\"from_a_later_version\"}\n")
            .await
            .unwrap();
        caller.say(&HostToGuest::Shutdown).await;

        assert_eq!(session.await.unwrap(), Outcome::Shutdown);
    }

    #[tokio::test]
    async fn a_closed_channel_stops_the_workload() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);

        let session = tokio::spawn(async move {
            let (mut ports, _to_workload, _from_workload) = ports();
            let mut workload = Double::exits_when_stopped(Exit::code(0));
            let outcome = run(guest, &mut workload, &mut ports).await.unwrap();
            (outcome, workload)
        });

        assert!(matches!(caller.expect().await, GuestToHost::Ready { .. }));
        caller
            .say(&HostToGuest::Boot {
                descriptor: Box::new(descriptor()),
            })
            .await;
        drop(caller);

        let (outcome, workload) = session.await.unwrap();
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
    async fn a_command_that_will_not_run_is_reported_apart_from_a_share_that_will_not_mount() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);

        let session = tokio::spawn(async move {
            let (mut ports, _to_workload, _from_workload) = ports();
            let mut workload = Double::exits_at_once(Exit::code(0));
            workload.start_failure = Some(Failure::new("ENOENT: /usr/bin/workload"));
            let outcome = run(guest, &mut workload, &mut ports).await.unwrap();
            (outcome, workload)
        });

        assert!(matches!(caller.expect().await, GuestToHost::Ready { .. }));
        caller
            .say(&HostToGuest::Boot {
                descriptor: Box::new(descriptor()),
            })
            .await;

        // The shares are reported as fine, and the failure is a different
        // message: which of the two went wrong decides what to look at.
        assert_eq!(caller.expect().await, GuestToHost::Mounted);
        assert_eq!(
            caller.expect().await,
            GuestToHost::StartFailed {
                reason: "ENOENT: /usr/bin/workload".into()
            },
        );

        let (outcome, workload) = session.await.unwrap();
        assert_eq!(
            outcome,
            Outcome::Refused(Failure::new("ENOENT: /usr/bin/workload"))
        );
        assert_eq!(workload.mounted.len(), 1);
    }

    #[tokio::test]
    async fn an_envelope_crosses_the_session_in_both_directions_unread() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);
        let (down_tx, down_rx) = mpsc::channel(4);
        let (up_tx, up_rx) = mpsc::channel(4);

        let session = tokio::spawn(async move {
            let mut ports = Ports {
                to_workload: down_tx,
                from_workload: up_rx,
            };
            let mut workload = Double::exits_when_stopped(Exit::code(0));
            run(guest, &mut workload, &mut ports).await.unwrap()
        });
        let mut to_relay = down_rx;

        assert!(matches!(caller.expect().await, GuestToHost::Ready { .. }));

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
        assert_eq!(session.await.unwrap(), Outcome::Shutdown);
    }

    #[tokio::test]
    async fn a_relay_nothing_is_on_does_not_end_a_session() {
        let (guest, host) = tokio::io::duplex(4096);
        let mut caller = Caller::new(host);
        let (down_tx, down_rx) = mpsc::channel(1);
        let (_up_tx, up_rx) = mpsc::channel::<Payload>(1);
        drop(down_rx); // nothing is on the relay

        let session = tokio::spawn(async move {
            let mut ports = Ports {
                to_workload: down_tx,
                from_workload: up_rx,
            };
            let mut workload = Double::exits_when_stopped(Exit::code(0));
            run(guest, &mut workload, &mut ports).await.unwrap()
        });

        assert!(matches!(caller.expect().await, GuestToHost::Ready { .. }));
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
        caller.expect_started().await;
        caller.say(&HostToGuest::Shutdown).await;

        assert_eq!(session.await.unwrap(), Outcome::Shutdown);
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

        let session = tokio::spawn(async move {
            let mut ports = Ports {
                to_workload: down_tx,
                from_workload: up_rx,
            };
            let mut workload = Double::exits_when_stopped(Exit::code(0));
            run(guest, &mut workload, &mut ports).await.unwrap()
        });

        assert!(matches!(caller.expect().await, GuestToHost::Ready { .. }));
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
        caller.expect_started().await;
        caller.say(&HostToGuest::Shutdown).await;

        assert_eq!(session.await.unwrap(), Outcome::Shutdown);
    }
}
