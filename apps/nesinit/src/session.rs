// The guest end of the control channel.
//
// The shape of the exchange, and none of it is negotiable from this side: the
// guest speaks first with its version, is handed one boot descriptor, and from
// then on reports. It is not a supervisor: when the workload ends, the exit
// goes up the channel and this returns. Starting something again is the
// caller's decision, because the caller is the only end that can see whether
// restarting is repair or a loop. ref(d-0033)

use nesprotocol::lifecycle::{
    BootDescriptor, CONTROL_VERSION, Exit, GuestToHost, HostToGuest, from_line, to_line,
};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};

use crate::workload::{Failure, Workload};

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
pub async fn run<C, W>(channel: C, workload: &mut W) -> std::io::Result<Outcome>
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

    let mut running: Option<crate::workload::Exited> = None;

    loop {
        let line = match running.as_mut() {
            Some(exited) => tokio::select! {
                ended = exited => {
                    let exit = ended?;
                    send(&mut writer, &GuestToHost::WorkloadExited { exit }).await?;
                    return Ok(Outcome::WorkloadExited(exit));
                }
                line = lines.next_line() => line?,
            },
            None => lines.next_line().await?,
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
                match begin(&descriptor, workload) {
                    Ok(exited) => running = Some(exited),
                    Err(failure) => {
                        tracing::error!(reason = %failure.reason, "the descriptor was refused");
                        return Ok(Outcome::Refused(failure));
                    }
                }
            }
            HostToGuest::Stop => workload.signal_stop(),
            HostToGuest::Shutdown => return Ok(Outcome::Shutdown),
        }
    }
}

/// Carry out a descriptor: shares first, then the command.
///
/// The two stay distinguishable on the way out because they want different
/// things looked at — a share that did not mount and a command that did not
/// start are not the same incident.
fn begin<W: Workload>(
    descriptor: &BootDescriptor,
    workload: &mut W,
) -> Result<crate::workload::Exited, Failure> {
    workload.mount(&descriptor.mounts)?;
    workload.start(&descriptor.exec)
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
    use nesprotocol::lifecycle::{Exec, Geometry, Mount, OnExit};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream};

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
            let mut workload = Double::exits_when_stopped(Exit::code(0));
            let outcome = run(guest, &mut workload).await.unwrap();
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
            let mut workload = Double::exits_when_stopped(Exit::code(0));
            let outcome = run(guest, &mut workload).await.unwrap();
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
            let mut workload = Double::exits_at_once(Exit::code(3));
            let outcome = run(guest, &mut workload).await.unwrap();
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
            let mut workload = Double::exits_at_once(Exit::signal(9));
            run(guest, &mut workload).await.unwrap()
        });

        assert!(matches!(caller.expect().await, GuestToHost::Ready { .. }));
        caller
            .say(&HostToGuest::Boot {
                descriptor: Box::new(descriptor()),
            })
            .await;

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
            let mut workload = Double::exits_when_stopped(Exit::code(0));
            let outcome = run(guest, &mut workload).await.unwrap();
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
            let mut workload = Double::exits_at_once(Exit::code(0));
            workload.mount_failure = Some(Failure::new("EACCES: /mnt/user"));
            let outcome = run(guest, &mut workload).await.unwrap();
            (outcome, workload)
        });

        assert!(matches!(caller.expect().await, GuestToHost::Ready { .. }));
        caller
            .say(&HostToGuest::Boot {
                descriptor: Box::new(descriptor()),
            })
            .await;

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
            let mut workload = Double::exits_when_stopped(Exit::code(0));
            run(guest, &mut workload).await.unwrap()
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
            let mut workload = Double::exits_when_stopped(Exit::code(0));
            let outcome = run(guest, &mut workload).await.unwrap();
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
}
