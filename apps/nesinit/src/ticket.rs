// Carrying the address a client needs from inside the guest to outside it.
//
// Whatever serves media in the guest knows how it can be reached, and the
// person who needs to know is not in the guest. Standard output here is a log
// file inside a VM, so the control channel is the delivery path rather than a
// convenience — which is why this is init's job and not a detail of whichever
// component happens to bind the port.
//
// # Why it is polled rather than read once
//
// An address is not a value, it is the best answer so far. An endpoint
// discovers more ways to reach it after it binds — a local one immediately, a
// relayed or hole-punched one some seconds later — so the first answer is the
// one that works on a local network and fails from anywhere else. Re-reading
// and forwarding only what changed keeps that from being decided by whoever
// asked first.
//
// # Why it dials rather than listens
//
// The opposite of the payload relay next door, and deliberately: there the
// guest listens because the workload starts later, and here the server is the
// long-lived one. Dialling also means a server that has not bound yet is an
// error this retries, rather than a connection that has to be waited for
// without knowing whether it is coming.

use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::mpsc::Sender;

/// Where the address is read from.
pub const SOCKET: &str = "/tmp/nestri-ticket.sock";

/// How often to look for a better address.
///
/// Short, because the window this closes is the first few seconds of a session
/// and a player waiting to connect is waiting on exactly this. It costs one
/// connection to a unix socket per interval.
const EVERY: Duration = Duration::from_secs(2);

/// The longest address this will read.
///
/// One line of text. A cap rather than a preference: the process on the other
/// end can write without ever sending a newline, and the process holding the
/// buffer is the one the kernel has been told not to kill.
const LONGEST: u64 = 8 * 1024;

/// Forward every new address for as long as the session lasts.
///
/// Never returns on its own. A server that is not there yet, or has gone away,
/// is retried at the next interval — there is nothing here worth ending a
/// running session over, and an address that stops being re-offered does not
/// stop being correct.
pub async fn carry(path: PathBuf, out: Sender<String>) {
    let mut sent: Option<String> = None;
    loop {
        match read(&path).await {
            Ok(current) if Some(&current) != sent.as_ref() => {
                // The address itself is not logged. It is a capability to reach
                // this session, and a log inside the guest is the one place it
                // has no reason to be.
                tracing::info!(
                    first = sent.is_none(),
                    "forwarding an address for this session"
                );
                if out.send(current.clone()).await.is_err() {
                    // The session is over. Nothing else reads this.
                    return;
                }
                sent = Some(current);
            }
            Ok(_) => {}
            Err(error) => {
                // Expected until whatever serves the address has bound, so it
                // is not a warning the first several times. It stays at this
                // level afterwards too: a session that already has an address
                // is not harmed by failing to look for a better one.
                tracing::debug!(%error, "no address available yet");
            }
        }
        tokio::time::sleep(EVERY).await;
    }
}

/// One line from the socket, which is the whole protocol.
async fn read(path: &Path) -> io::Result<String> {
    let stream = UnixStream::connect(path).await?;
    let mut line = String::new();
    BufReader::new(stream.take(LONGEST))
        .read_line(&mut line)
        .await?;
    let line = line.trim().to_string();
    if line.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "the socket answered with nothing",
        ));
    }
    Ok(line)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;
    use tokio::net::UnixListener;
    use tokio::sync::mpsc;

    /// Serve a sequence of addresses, one per connection, the way a real one
    /// does: it answers every dial with what it currently knows.
    fn serve(path: PathBuf, answers: Vec<Option<String>>) {
        let listener = UnixListener::bind(&path).unwrap();
        tokio::spawn(async move {
            let mut answers = answers.into_iter().cycle();
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    return;
                };
                if let Some(answer) = answers.next().flatten() {
                    let _ = stream.write_all(format!("{answer}\n").as_bytes()).await;
                }
            }
        });
    }

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("nesinit-ticket-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("ticket.sock")
    }

    #[tokio::test]
    async fn an_address_reaches_the_channel() {
        let path = scratch("one");
        serve(path.clone(), vec![Some("nestri:abc".into())]);

        let (tx, mut rx) = mpsc::channel(4);
        tokio::spawn(carry(path.clone(), tx));

        let first = tokio::time::timeout(Duration::from_secs(10), rx.recv())
            .await
            .expect("no address arrived")
            .expect("the channel closed");
        assert_eq!(first, "nestri:abc");

        // And it is not sent again. An address that has not changed is the same
        // address, and re-sending it is a write per interval for nothing.
        assert!(
            tokio::time::timeout(EVERY * 3, rx.recv()).await.is_err(),
            "an unchanged address was forwarded again"
        );
        let _ = std::fs::remove_file(&path);
    }

    /// The case that decides whether this works from anywhere but a local
    /// network: a better address arrives after the first one has been sent.
    #[tokio::test]
    async fn a_better_address_replaces_the_one_before_it() {
        let path = scratch("better");
        serve(
            path.clone(),
            vec![
                Some("nestri:local-only".into()),
                Some("nestri:with-relays".into()),
            ],
        );

        let (tx, mut rx) = mpsc::channel(4);
        tokio::spawn(carry(path.clone(), tx));

        let mut seen = Vec::new();
        while seen.len() < 2 {
            let next = tokio::time::timeout(Duration::from_secs(10), rx.recv())
                .await
                .expect("the second address never arrived")
                .expect("the channel closed");
            seen.push(next);
        }
        assert_eq!(seen, ["nestri:local-only", "nestri:with-relays"]);
        let _ = std::fs::remove_file(&path);
    }

    /// Nothing serving the socket yet is the ordinary case at boot, not a
    /// failure: this starts before whatever binds it.
    #[tokio::test]
    async fn a_socket_that_is_not_there_yet_is_waited_out_rather_than_failed() {
        let path = scratch("late");
        let (tx, mut rx) = mpsc::channel(4);
        tokio::spawn(carry(path.clone(), tx));

        tokio::time::sleep(EVERY * 2).await;
        serve(path.clone(), vec![Some("nestri:late".into())]);

        let first = tokio::time::timeout(Duration::from_secs(10), rx.recv())
            .await
            .expect("an address that arrived late was never picked up")
            .expect("the channel closed");
        assert_eq!(first, "nestri:late");
        let _ = std::fs::remove_file(&path);
    }

    /// An answer with nothing in it is not an address. Forwarding one would
    /// publish an empty string as somewhere to connect.
    #[tokio::test]
    async fn an_empty_answer_is_not_an_address() {
        let path = scratch("empty");
        serve(path.clone(), vec![None, Some("nestri:real".into())]);

        let (tx, mut rx) = mpsc::channel(4);
        tokio::spawn(carry(path.clone(), tx));

        let first = tokio::time::timeout(Duration::from_secs(10), rx.recv())
            .await
            .expect("no address arrived")
            .expect("the channel closed");
        assert_eq!(first, "nestri:real");
        let _ = std::fs::remove_file(&path);
    }
}
