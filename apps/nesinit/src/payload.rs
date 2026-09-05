// The relay for the layer the guest does not read.
//
// Bytes arrive on the control channel inside an envelope, are handed to the
// workload over a unix socket, and come back the same way. Nothing here parses
// a body, and nothing here logs one.
//
// The socket is the soft part of this: it is a mechanism, where the envelope is
// a boundary. Expect the socket to change and do not let a change to it change
// anything above it.

use std::io;
use std::path::Path;

use nesprotocol::lifecycle::{Payload, from_line, to_line};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::mpsc::{Receiver, Sender};

/// Where the workload finds the relay.
pub const SOCKET: &str = "/nestri/payload.sock";

/// The longest envelope this will assemble before giving up on the connection.
///
/// A cap rather than a preference. The workload is on the other end of this
/// socket and can write for as long as it likes without ever sending a
/// newline; without a limit, the process holding the buffer is the one process
/// in the guest the kernel has been told not to kill, so the memory it takes
/// comes out of everything else.
const LONGEST_ENVELOPE: usize = 64 * 1024;

/// The two directions, as the session sees them.
pub struct Ports {
    /// Envelopes bound for the workload.
    pub to_workload: Sender<Payload>,
    /// Envelopes the workload sent.
    pub from_workload: Receiver<Payload>,
}

/// Listen for the workload and relay in both directions for as long as it is
/// connected.
///
/// The guest listens and the workload dials in, which removes the startup
/// ordering problem: a workload that is not running yet has simply not
/// connected yet, and one that reconnects gets the relay again.
pub async fn serve(
    path: &Path,
    mut outbound: Receiver<Payload>,
    inbound: Sender<Payload>,
) -> io::Result<()> {
    if let Some(directory) = path.parent() {
        std::fs::create_dir_all(directory)?;
    }
    // A socket left behind by a previous boot would refuse the bind. Nothing
    // durable lives in the guest, so there is nothing here to preserve.
    let _ = std::fs::remove_file(path);
    let listener = UnixListener::bind(path)?;

    loop {
        let stream = tokio::select! {
            accepted = listener.accept() => accepted?.0,
            waiting = outbound.recv() => {
                // Dropped rather than queued for whoever connects next. What
                // crosses this layer is re-sent when it changes, so what a
                // queue would hold is a stale copy, and holding it is also
                // what would eventually block the session that fills it.
                match waiting {
                    Some(envelope) => {
                        tracing::warn!(
                            envelope = %envelope.summary(),
                            "dropped an envelope: nothing is on the relay",
                        );
                        continue;
                    }
                    None => return Ok(()), // the session is over
                }
            }
        };
        tracing::info!("the workload is on the relay");
        match relay(stream, &mut outbound, &inbound).await {
            Ok(()) => tracing::info!("the workload left the relay"),
            Err(error) => tracing::warn!(%error, "the relay connection ended"),
        }
    }
}

async fn relay(
    stream: UnixStream,
    outbound: &mut Receiver<Payload>,
    inbound: &Sender<Payload>,
) -> io::Result<()> {
    let (reader, mut writer) = stream.into_split();
    let mut reader = BufReader::new(reader);
    let mut frame = Vec::new();

    loop {
        tokio::select! {
            read = read_capped(&mut reader, &mut frame) => {
                if !read? {
                    return Ok(()); // the workload closed the socket
                }
                // Deliberately not `{:?}` on the error either: a decoder is
                // entitled to quote what it could not read, and what it could
                // not read is a body.
                let decoded = std::str::from_utf8(&frame)
                    .ok()
                    .and_then(|line| from_line::<Payload>(line).ok());
                let Some(payload) = decoded else {
                    tracing::warn!(bytes = frame.len(), "ignoring an envelope that would not decode");
                    frame.clear();
                    continue;
                };
                frame.clear();
                tracing::debug!(envelope = %payload.summary(), "relaying from the workload");
                if inbound.send(payload).await.is_err() {
                    return Ok(()); // the session is over
                }
            }
            outgoing = outbound.recv() => {
                let Some(payload) = outgoing else { return Ok(()) };
                tracing::debug!(envelope = %payload.summary(), "relaying to the workload");
                let line = to_line(&payload).map_err(io::Error::other)?;
                writer.write_all(line.as_bytes()).await?;
                writer.flush().await?;
            }
        }
    }
}

/// Read one newline-terminated frame into `frame`, refusing to grow it past
/// [`LONGEST_ENVELOPE`]. `false` at end of stream.
///
/// Cancel-safe, which it has to be to sit in a `select!`: bytes are copied out
/// of the reader and consumed together, so a cancelled read leaves the partial
/// frame in `frame` and the rest of it in the socket.
async fn read_capped<R>(reader: &mut R, frame: &mut Vec<u8>) -> io::Result<bool>
where
    R: AsyncBufRead + Unpin,
{
    loop {
        let consumed;
        let complete;
        {
            let available = reader.fill_buf().await?;
            if available.is_empty() {
                return Ok(false);
            }
            match available.iter().position(|byte| *byte == b'\n') {
                Some(end) => {
                    within_cap(frame.len() + end)?;
                    frame.extend_from_slice(&available[..end]);
                    consumed = end + 1;
                    complete = true;
                }
                None => {
                    within_cap(frame.len() + available.len())?;
                    frame.extend_from_slice(available);
                    consumed = available.len();
                    complete = false;
                }
            }
        }
        reader.consume(consumed);
        if complete {
            return Ok(true);
        }
    }
}

/// The error says how long, and nothing about what: what did not fit is a
/// body, and a body is not logged even when it is malformed.
fn within_cap(length: usize) -> io::Result<()> {
    if length > LONGEST_ENVELOPE {
        return Err(io::Error::other(format!(
            "an envelope grew past {LONGEST_ENVELOPE} bytes without ending"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
    use tokio::sync::mpsc;

    fn socket_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("nesinit-{}-{name}.sock", std::process::id()))
    }

    /// Somewhere to put log output so a test can read it back.
    #[derive(Clone, Default)]
    struct Capture(Arc<Mutex<Vec<u8>>>);

    impl Capture {
        fn text(&self) -> String {
            String::from_utf8_lossy(&self.0.lock().unwrap()).into_owned()
        }
    }

    impl io::Write for Capture {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for Capture {
        type Writer = Capture;
        fn make_writer(&'a self) -> Self::Writer {
            self.clone()
        }
    }

    /// A relay, and the two ends of it a test drives.
    struct Relay {
        path: std::path::PathBuf,
        down: mpsc::Sender<Payload>,
        up: mpsc::Receiver<Payload>,
        server: tokio::task::JoinHandle<io::Result<()>>,
    }

    impl Relay {
        fn start(name: &str) -> Self {
            let path = socket_path(name);
            let (down, outbound) = mpsc::channel(8);
            let (inbound, up) = mpsc::channel(8);
            let server = tokio::spawn({
                let path = path.clone();
                async move { serve(&path, outbound, inbound).await }
            });
            Self {
                path,
                down,
                up,
                server,
            }
        }

        /// Dial the relay and wait until it is demonstrably carrying the
        /// connection.
        ///
        /// `serve` drops what arrives while nothing is connected, so a test
        /// that sends downward before the accept has completed is racing it. A
        /// line upward is the barrier: it can only arrive once the relay is
        /// carrying this connection.
        async fn workload(&mut self) -> (BufReader<OwnedReadHalf>, OwnedWriteHalf) {
            let (reader, mut writer) = self.dial().await.into_split();
            writer
                .write_all(to_line(&Payload::new("handshake", "")).unwrap().as_bytes())
                .await
                .unwrap();
            assert_eq!(self.up.recv().await.unwrap().channel, "handshake");
            (BufReader::new(reader), writer)
        }

        /// The listener may not be bound the instant the task is spawned.
        async fn dial(&self) -> UnixStream {
            for _ in 0..100 {
                if let Ok(stream) = UnixStream::connect(&self.path).await {
                    return stream;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
            panic!("the relay never came up on {}", self.path.display());
        }
    }

    impl Drop for Relay {
        fn drop(&mut self) {
            self.server.abort();
            let _ = std::fs::remove_file(&self.path);
        }
    }

    #[tokio::test]
    async fn an_envelope_crosses_in_both_directions_untouched() {
        let mut relay = Relay::start("both-ways");
        let (reader, mut writer) = relay.workload().await;
        let mut lines = reader.lines();

        let body = r#"{"looks":"structured"} and is not"#;
        relay
            .down
            .send(Payload::new("identity", body))
            .await
            .unwrap();
        let line = lines.next_line().await.unwrap().unwrap();
        let seen: Payload = from_line(&line).unwrap();
        assert_eq!(seen.body, body, "the body arrived changed");
        assert_eq!(seen.channel, "identity");

        let back = to_line(&Payload::new("identity", "opaque back")).unwrap();
        writer.write_all(back.as_bytes()).await.unwrap();
        assert_eq!(relay.up.recv().await.unwrap().body, "opaque back");
    }

    #[tokio::test]
    async fn nothing_the_relay_logs_contains_a_body() {
        let capture = Capture::default();
        let subscriber = tracing_subscriber::fmt()
            .with_writer(capture.clone())
            .with_ansi(false)
            .with_max_level(tracing::Level::TRACE)
            .finish();
        let _log = tracing::subscriber::set_default(subscriber);

        let mut relay = Relay::start("logging");
        let (reader, mut writer) = relay.workload().await;
        let mut lines = reader.lines();

        let secret = "a-credential-nobody-should-read";
        relay
            .down
            .send(Payload::new("identity", secret))
            .await
            .unwrap();
        lines.next_line().await.unwrap().unwrap();

        writer
            .write_all(
                to_line(&Payload::new("identity", secret))
                    .unwrap()
                    .as_bytes(),
            )
            .await
            .unwrap();
        relay.up.recv().await.unwrap();

        // An envelope that will not decode is the other way a body reaches a
        // log line — a decoder is entitled to quote what it could not read —
        // so a broken one carrying the same secret goes through the same
        // check.
        let malformed = format!("{{\"channel\":\"identity\",\"body\":\"{secret}\"\n");
        writer.write_all(malformed.as_bytes()).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let logged = capture.text();
        assert!(
            !logged.contains(secret),
            "a body reached a log line:\n{logged}"
        );
        // The relay's own line about a line it could not read says how long it
        // was and nothing else. What may be said about an envelope it *could*
        // read is asserted where that summary is written, because callsite
        // interest is cached process-wide and a debug line another test
        // reached first will not arrive here.
        assert!(
            logged.contains("bytes=62"),
            "the byte count is loggable:\n{logged}"
        );
    }

    #[tokio::test]
    async fn an_envelope_sent_while_nobody_is_connected_is_dropped_rather_than_queued() {
        let mut relay = Relay::start("nobody-home");

        // Sent into a relay nothing is on. It is not held for whoever connects
        // next: what crosses this layer is re-sent when it changes, so a held
        // copy is a stale copy — and a queue that fills is what would
        // eventually stall the session filling it.
        relay
            .down
            .send(Payload::new("identity", "stale"))
            .await
            .unwrap();

        let (reader, _writer) = relay.workload().await;
        let mut lines = reader.lines();
        relay
            .down
            .send(Payload::new("identity", "current"))
            .await
            .unwrap();

        let line = lines.next_line().await.unwrap().unwrap();
        let seen: Payload = from_line(&line).unwrap();
        assert_eq!(
            seen.body, "current",
            "a stale envelope was delivered on connect"
        );
    }

    #[tokio::test]
    async fn a_frame_that_never_ends_costs_the_connection_and_not_the_guest() {
        use tokio::io::AsyncReadExt;

        let mut relay = Relay::start("unbounded");
        let (mut reader, mut writer) = relay.dial().await.into_split();

        // Well past the cap, and not a newline in it. Without a limit the
        // buffer holding this grows in the one process the kernel has been
        // told not to kill, so what it takes comes out of everything else.
        let flood = vec![b'a'; LONGEST_ENVELOPE + 4096];
        // The write fails once the relay drops the connection, which is the
        // outcome under test rather than a problem with it.
        let _ = writer.write_all(&flood).await;

        // The relay closes on us rather than keeping the buffer. Bounded,
        // because the failure being guarded against is a relay that reads for
        // as long as the workload writes.
        let mut unread = Vec::new();
        let closed = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            reader.read_to_end(&mut unread),
        )
        .await
        .expect("the relay is still assembling a frame that never ends");
        assert_eq!(
            closed.unwrap(),
            0,
            "the relay answered a frame it should have refused"
        );

        // And it is there for whoever connects next.
        let (reader, mut writer) =
            tokio::time::timeout(std::time::Duration::from_secs(5), relay.workload())
                .await
                .expect("the relay never came back for the next workload");
        let mut lines = reader.lines();
        writer
            .write_all(
                to_line(&Payload::new("identity", "after the flood"))
                    .unwrap()
                    .as_bytes(),
            )
            .await
            .unwrap();
        assert_eq!(relay.up.recv().await.unwrap().body, "after the flood");

        relay
            .down
            .send(Payload::new("identity", "down"))
            .await
            .unwrap();
        let line = lines.next_line().await.unwrap().unwrap();
        assert_eq!(from_line::<Payload>(&line).unwrap().body, "down");
    }
}
