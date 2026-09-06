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
//
// # Who is allowed to answer
//
// Dialling a path means trusting whoever is behind it, and an address is the
// capability to reach this session — so the wrong answer here does not break a
// session, it hands one to somebody else. The workload runs arbitrary code, and
// on a writable directory it can unlink whatever bound the socket and bind a
// replacement; every read after that returns an address of its choosing, and
// the client outside connects there instead.
//
// So the peer's credentials are checked and an answer from the workload's own
// user is refused. That check is only as good as the workload having a user of
// its own: run it as the same user as the process serving the address and
// nothing can tell the two apart, which is [`Peer::indistinguishable`] and is
// said out loud at boot rather than discovered later.

use std::io;
use std::os::fd::AsRawFd;
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

/// How long one look is given before it is abandoned.
///
/// A cap on time, next to the cap on size below and for the same reason: the
/// far end can accept a connection and then write nothing at all, and a read
/// with no deadline turns that into a poll loop that never runs again. The
/// address it already forwarded stays correct; the better one that arrives
/// later never would.
const PATIENCE: Duration = Duration::from_secs(5);

/// The longest address this will read.
///
/// One line of text. A cap rather than a preference: the process on the other
/// end can write without ever sending a newline, and the process holding the
/// buffer is the one the kernel has been told not to kill.
const LONGEST: u64 = 8 * 1024;

/// Who may not serve this session's address.
///
/// The workload's user, and nothing else is excluded — this is not an allow
/// list of trusted uids, because init does not know which user an image happens
/// to run its media components as, and inventing one here would be a second
/// place for that to be configured wrongly.
///
/// Shared and filled in later, because the carrier starts before the descriptor
/// that names the user arrives. That leaves no gap: a workload cannot serve
/// anything before it is started, and it is started from the same descriptor,
/// which sets this first.
#[derive(Clone, Debug, Default)]
pub struct Untrusted(std::sync::Arc<std::sync::atomic::AtomicU32>);

/// No workload has been started, so there is no untrusted user yet.
const NOBODY: u32 = u32::MAX;

impl Untrusted {
    pub fn unknown() -> Self {
        Self(std::sync::Arc::new(std::sync::atomic::AtomicU32::new(
            NOBODY,
        )))
    }

    /// Name the user the workload runs as. Called before it is started.
    pub fn is(&self, uid: u32) {
        self.0.store(uid, std::sync::atomic::Ordering::Release);
        if uid == 0 {
            tracing::warn!(
                "the workload runs as root, so an address it serves cannot be \
                 told apart from a real one. Give it a user of its own."
            );
        }
    }

    /// The uid to refuse, or `None` when refusing anything would be wrong.
    ///
    /// `None` covers two cases that want the same answer for different reasons:
    /// nothing has been started yet, so no peer can be the workload; and the
    /// workload runs as `root`, which is every user at once — refusing root
    /// would refuse whatever legitimately serves the address as well. The uid
    /// being shared is the thing an operator has to fix, and `is` says so.
    fn refuse(&self) -> Option<u32> {
        match self.0.load(std::sync::atomic::Ordering::Acquire) {
            NOBODY | 0 => None,
            uid => Some(uid),
        }
    }
}

/// Forward every new address for as long as the session lasts.
///
/// Never returns on its own. A server that is not there yet, or has gone away,
/// is retried at the next interval — there is nothing here worth ending a
/// running session over, and an address that stops being re-offered does not
/// stop being correct.
pub async fn carry(path: PathBuf, out: Sender<String>, untrusted: Untrusted) {
    let mut sent: Option<String> = None;
    loop {
        match look(&path, &untrusted).await {
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
            // Not the same as no address yet, and it must not be logged as
            // though it were: this says something *is* serving an address and
            // it is the one thing that may not. A session with no address at
            // all is a legible failure; a session pointed somewhere else is
            // not, so this is the line that has to be found afterwards.
            Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
                tracing::error!(%error, "refusing an address for this session");
            }
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

/// One look at the socket, abandoned if it takes longer than [`PATIENCE`].
async fn look(path: &Path, untrusted: &Untrusted) -> io::Result<String> {
    match tokio::time::timeout(PATIENCE, read(path, untrusted)).await {
        Ok(result) => result,
        Err(_) => Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "the socket accepted a connection and did not answer",
        )),
    }
}

/// One line from the socket, which is the whole protocol.
async fn read(path: &Path, untrusted: &Untrusted) -> io::Result<String> {
    let stream = UnixStream::connect(path).await?;

    // Before a byte is read. The kernel answers this about the socket's peer
    // rather than about the path, so it cannot be spoofed by whoever holds the
    // path — which is the whole reason the check is worth anything.
    if let Some(refuse) = untrusted.refuse()
        && peer_uid(&stream)? == refuse
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "the workload is serving this session's address, which would point \
             a client at whatever it chose",
        ));
    }

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

/// The uid of the process on the other end of a connected unix socket.
///
/// From the kernel, at connect time, and not from anything the peer says about
/// itself. `SO_PEERCRED` records who held the other end when it connected, so a
/// process cannot claim a uid it does not have.
fn peer_uid(stream: &UnixStream) -> io::Result<u32> {
    let mut credentials = libc::ucred {
        pid: 0,
        uid: u32::MAX,
        gid: u32::MAX,
    };
    let mut length = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    // SAFETY: a connected socket this function borrows, and an out-parameter of
    // exactly the length being passed.
    let rc = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&raw mut credentials).cast::<libc::c_void>(),
            &raw mut length,
        )
    };
    if rc != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(credentials.uid)
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
        tokio::spawn(carry(path.clone(), tx, Untrusted::unknown()));

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
        tokio::spawn(carry(path.clone(), tx, Untrusted::unknown()));

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

    /// The peer's user decides whether an address is trusted, and this process
    /// is the peer in a test — so naming *it* as the workload is a real refusal
    /// of a real connection, not a stubbed one.
    ///
    /// The attack this closes: the workload unlinks whatever bound the socket,
    /// binds its own, and every read afterwards hands the client an address of
    /// the workload's choosing.
    #[tokio::test]
    async fn an_address_served_by_the_workload_is_refused() {
        let path = scratch("hostile");
        serve(path.clone(), vec![Some("nestri:attacker".into())]);

        // SAFETY: reading this process's own uid cannot fail.
        let ours = unsafe { libc::getuid() };
        let untrusted = Untrusted::unknown();
        untrusted.is(ours);

        let error = look(&path, &untrusted)
            .await
            .expect_err("an address from the workload's own user was accepted");
        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);

        // And the same socket is read happily once the workload is somebody
        // else, which is what shows the refusal is about the peer and not about
        // the socket.
        let elsewhere = Untrusted::unknown();
        elsewhere.is(ours + 1);
        assert_eq!(look(&path, &elsewhere).await.unwrap(), "nestri:attacker");

        let _ = std::fs::remove_file(&path);
    }

    /// Before a workload is started there is nothing to refuse, and refusing
    /// anything then would mean no session ever got an address.
    #[tokio::test]
    async fn nothing_is_refused_before_a_workload_exists() {
        let path = scratch("early");
        serve(path.clone(), vec![Some("nestri:real".into())]);
        let untrusted = Untrusted::unknown();
        assert_eq!(untrusted.refuse(), None);
        assert_eq!(look(&path, &untrusted).await.unwrap(), "nestri:real");
        let _ = std::fs::remove_file(&path);
    }

    /// A workload running as root is every user at once, so refusing root would
    /// refuse whatever legitimately serves the address too. The check stands
    /// down and `is` warns instead — the uid being shared is the operator's to
    /// fix and this is not the place to fail closed over it.
    #[tokio::test]
    async fn a_root_workload_leaves_nothing_to_tell_apart() {
        let untrusted = Untrusted::unknown();
        untrusted.is(0);
        assert_eq!(untrusted.refuse(), None);
    }

    /// Nothing serving the socket yet is the ordinary case at boot, not a
    /// failure: this starts before whatever binds it.
    #[tokio::test]
    async fn a_socket_that_is_not_there_yet_is_waited_out_rather_than_failed() {
        let path = scratch("late");
        let (tx, mut rx) = mpsc::channel(4);
        tokio::spawn(carry(path.clone(), tx, Untrusted::unknown()));

        tokio::time::sleep(EVERY * 2).await;
        serve(path.clone(), vec![Some("nestri:late".into())]);

        let first = tokio::time::timeout(Duration::from_secs(10), rx.recv())
            .await
            .expect("an address that arrived late was never picked up")
            .expect("the channel closed");
        assert_eq!(first, "nestri:late");
        let _ = std::fs::remove_file(&path);
    }

    /// A server that accepts and then says nothing must not take the poll loop
    /// with it. Without a deadline on the read this hangs forever, and the
    /// address that arrives afterwards is never seen.
    #[tokio::test]
    async fn a_server_that_answers_nothing_does_not_stop_the_search() {
        let path = scratch("mute");
        let listener = UnixListener::bind(&path).unwrap();
        let held = std::sync::Arc::new(tokio::sync::Mutex::new(Vec::new()));
        {
            let held = held.clone();
            tokio::spawn(async move {
                // Accepted and kept open, deliberately unanswered, which is
                // what a wedged producer looks like from here.
                let mut answered = false;
                loop {
                    let Ok((mut stream, _)) = listener.accept().await else {
                        return;
                    };
                    if answered {
                        let _ = stream.write_all(b"nestri:eventually\n").await;
                    } else {
                        answered = true;
                        held.lock().await.push(stream);
                    }
                }
            });
        }

        let (tx, mut rx) = mpsc::channel(4);
        tokio::spawn(carry(path.clone(), tx, Untrusted::unknown()));

        let first = tokio::time::timeout(PATIENCE + EVERY * 4, rx.recv())
            .await
            .expect("the carrier never got past a server that would not answer")
            .expect("the channel closed");
        assert_eq!(first, "nestri:eventually");
        let _ = std::fs::remove_file(&path);
    }

    /// An answer with nothing in it is not an address. Forwarding one would
    /// publish an empty string as somewhere to connect.
    #[tokio::test]
    async fn an_empty_answer_is_not_an_address() {
        let path = scratch("empty");
        serve(path.clone(), vec![None, Some("nestri:real".into())]);

        let (tx, mut rx) = mpsc::channel(4);
        tokio::spawn(carry(path.clone(), tx, Untrusted::unknown()));

        let first = tokio::time::timeout(Duration::from_secs(10), rx.recv())
            .await
            .expect("no address arrived")
            .expect("the channel closed");
        assert_eq!(first, "nestri:real");
        let _ = std::fs::remove_file(&path);
    }
}
