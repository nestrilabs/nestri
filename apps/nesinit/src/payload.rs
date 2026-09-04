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
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::mpsc::{Receiver, Sender};

/// Where the workload finds the relay.
pub const SOCKET: &str = "/nestri/payload.sock";

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
        let (stream, _) = listener.accept().await?;
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
    let mut lines = BufReader::new(reader).lines();

    loop {
        tokio::select! {
            line = lines.next_line() => {
                let Some(line) = line? else { return Ok(()) };
                // Deliberately not `{:?}` on the error either: a decoder is
                // entitled to quote what it could not read, and what it could
                // not read is a body.
                let Ok(payload) = from_line::<Payload>(&line) else {
                    tracing::warn!(bytes = line.len(), "ignoring an envelope that would not decode");
                    continue;
                };
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
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

    #[tokio::test]
    async fn an_envelope_crosses_in_both_directions_untouched() {
        let path = socket_path("both-ways");
        let (down_tx, down_rx) = mpsc::channel(4);
        let (up_tx, mut up_rx) = mpsc::channel(4);
        let server = tokio::spawn({
            let path = path.clone();
            async move { serve(&path, down_rx, up_tx).await }
        });

        let workload = connect(&path).await;
        let (reader, mut writer) = workload.into_split();
        let mut lines = BufReader::new(reader).lines();

        let body = r#"{"looks":"structured"} and is not"#;
        down_tx.send(Payload::new("identity", body)).await.unwrap();
        let line = lines.next_line().await.unwrap().unwrap();
        let seen: Payload = from_line(&line).unwrap();
        assert_eq!(seen.body, body, "the body arrived changed");
        assert_eq!(seen.channel, "identity");

        let back = to_line(&Payload::new("identity", "opaque back")).unwrap();
        writer.write_all(back.as_bytes()).await.unwrap();
        let up = up_rx.recv().await.unwrap();
        assert_eq!(up.body, "opaque back");

        server.abort();
        let _ = std::fs::remove_file(&path);
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

        let path = socket_path("logging");
        let (down_tx, down_rx) = mpsc::channel(4);
        let (up_tx, mut up_rx) = mpsc::channel(4);
        let server = tokio::spawn({
            let path = path.clone();
            async move { serve(&path, down_rx, up_tx).await }
        });

        let workload = connect(&path).await;
        let (reader, mut writer) = workload.into_split();
        let mut lines = BufReader::new(reader).lines();

        let secret = "a-credential-nobody-should-read";
        down_tx
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
        up_rx.recv().await.unwrap();

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

        server.abort();
        let _ = std::fs::remove_file(&path);
    }

    /// The listener may not be bound the instant the task is spawned.
    async fn connect(path: &Path) -> UnixStream {
        for _ in 0..100 {
            if let Ok(stream) = UnixStream::connect(path).await {
                return stream;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        panic!("the relay never came up on {}", path.display());
    }
}
