// A shell on a real pseudo-terminal, over an in-memory stream.
//
// Its own test binary on purpose, for the reason `reaping.rs` is: the reaper waits
// on any child, so in a binary shared with other tests it would collect
// processes they were waiting for.

use std::time::{Duration, Instant};

use nesinit::attach::{serve, spawn};
use nesinit::reap::{Waiters, reap_exited};
use nesprotocol::attach::{ExitStatus, Frame, FrameReader};
use nesprotocol::lifecycle::{AttachId, Exec, Winsize};
use tokio::io::{AsyncReadExt, AsyncWriteExt, DuplexStream};

/// Reaping is process-wide, so these run one at a time.
static ONE_REAPER: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// A reaper like the guest's: the only thing that waits, handing exits to
/// whoever asked.
fn start_reaper(waiters: Waiters) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            for (pid, exit) in reap_exited() {
                waiters.deliver(pid, exit);
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
}

fn me() -> (u32, u32) {
    // SAFETY: two calls with no arguments.
    unsafe { (libc::getuid(), libc::getgid()) }
}

fn exec(argv: &[&str]) -> Exec {
    let (uid, gid) = me();
    Exec {
        argv: argv.iter().map(|s| s.to_string()).collect(),
        env: [("TERM".to_string(), "dumb".to_string())].into(),
        cwd: None,
        uid,
        gid,
    }
}

/// The host's end of the stream.
struct Host {
    stream: DuplexStream,
    frames: FrameReader,
}

impl Host {
    async fn say(&mut self, frame: Frame) {
        self.stream
            .write_all(&frame.encode().unwrap())
            .await
            .unwrap();
    }

    async fn next(&mut self) -> Option<Frame> {
        let mut buf = [0u8; 4096];
        loop {
            if let Some(frame) = self.frames.next_frame().unwrap() {
                return Some(frame);
            }
            let n = tokio::time::timeout(Duration::from_secs(10), self.stream.read(&mut buf))
                .await
                .expect("the guest went quiet")
                .unwrap();
            if n == 0 {
                return None;
            }
            self.frames.push(&buf[..n]);
        }
    }

    /// Everything until the exit, as (output, status).
    async fn until_exit(&mut self) -> (Vec<u8>, ExitStatus) {
        let mut out = Vec::new();
        loop {
            match self.next().await.expect("the stream ended before an exit") {
                Frame::Data(bytes) => out.extend(bytes),
                Frame::Exit(status) => return (out, status),
                other => panic!("unexpected frame from the guest: {other:?}"),
            }
        }
    }
}

/// Start a shell and serve it; return the host's end and the pid.
async fn attach(
    waiters: &Waiters,
    argv: &[&str],
    size: Option<Winsize>,
) -> (Host, i32, tokio::task::JoinHandle<std::io::Result<()>>) {
    let shell = spawn(waiters, &exec(argv), size).expect("the shell starts");
    let pid = shell.pid();
    let (guest_end, host_end) = tokio::io::duplex(1 << 16);
    let id = AttachId::new("a-test");
    let served = tokio::spawn(async move { serve(shell, &id, guest_end).await });
    let mut host = Host {
        stream: host_end,
        frames: FrameReader::new(),
    };
    assert_eq!(
        host.next().await,
        Some(Frame::Hello("a-test".into())),
        "the first frame must say which shell this is"
    );
    (host, pid, served)
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

#[tokio::test]
async fn a_person_at_a_terminal_types_and_sees_the_answer() {
    let _alone = ONE_REAPER.lock().await;
    let waiters = Waiters::new();
    let reaper = start_reaper(waiters.clone());

    let (mut host, _, served) =
        attach(&waiters, &["/bin/sh"], Some(Winsize { cols: 80, rows: 24 })).await;
    host.say(Frame::Data(b"echo hello-from-the-box\nexit 3\n".to_vec()))
        .await;
    let (out, status) = host.until_exit().await;

    assert!(text(&out).contains("hello-from-the-box"), "{}", text(&out));
    assert_eq!(status, ExitStatus::Code(3));
    served.await.unwrap().unwrap();
    reaper.abort();
}

/// A terminal that was resized tells the program on it, which is what makes a
/// full-screen tool fit the window it is in.
#[tokio::test]
async fn a_resize_reaches_the_program_on_the_terminal() {
    let _alone = ONE_REAPER.lock().await;
    let waiters = Waiters::new();
    let reaper = start_reaper(waiters.clone());

    let (mut host, _, served) =
        attach(&waiters, &["/bin/sh"], Some(Winsize { cols: 80, rows: 24 })).await;
    host.say(Frame::Resize {
        cols: 100,
        rows: 30,
    })
    .await;
    host.say(Frame::Data(b"stty size\nexit 0\n".to_vec())).await;
    let (out, status) = host.until_exit().await;

    assert!(text(&out).contains("30 100"), "{}", text(&out));
    assert_eq!(status, ExitStatus::Code(0));
    served.await.unwrap().unwrap();
    reaper.abort();
}

/// A command run for its output is a byte pipe: nothing rewrites its line
/// endings, and what it wrote to stderr is there too.
#[tokio::test]
async fn a_command_without_a_terminal_gets_its_bytes_back_unrewritten() {
    let _alone = ONE_REAPER.lock().await;
    let waiters = Waiters::new();
    let reaper = start_reaper(waiters.clone());

    let (mut host, _, served) = attach(
        &waiters,
        &["/bin/sh", "-c", "echo out; echo err >&2; exit 5"],
        None,
    )
    .await;
    let (out, status) = host.until_exit().await;

    let out = text(&out);
    assert!(out.contains("out\n") && out.contains("err\n"), "{out:?}");
    assert!(
        !out.contains('\r'),
        "a terminal rewrote the line endings of a command's output: {out:?}"
    );
    assert_eq!(status, ExitStatus::Code(5));
    served.await.unwrap().unwrap();
    reaper.abort();
}

/// A kill is not an exit code.
#[tokio::test]
async fn a_shell_that_is_killed_says_which_signal() {
    let _alone = ONE_REAPER.lock().await;
    let waiters = Waiters::new();
    let reaper = start_reaper(waiters.clone());

    let (mut host, _, served) = attach(&waiters, &["/bin/sh", "-c", "kill -9 $$"], None).await;
    let (_, status) = host.until_exit().await;

    assert_eq!(status, ExitStatus::Signal(9));
    served.await.unwrap().unwrap();
    reaper.abort();
}

/// The last thing a program printed is what says why it stopped, so it must
/// not be lost to the exit arriving first.
#[tokio::test]
async fn output_written_just_before_the_exit_is_not_lost() {
    let _alone = ONE_REAPER.lock().await;
    let waiters = Waiters::new();
    let reaper = start_reaper(waiters.clone());

    let (mut host, _, served) = attach(
        &waiters,
        &["/bin/sh", "-c", "printf 'the-last-line\\n'; exit 1"],
        None,
    )
    .await;
    let (out, status) = host.until_exit().await;

    assert!(text(&out).contains("the-last-line"), "{}", text(&out));
    assert_eq!(status, ExitStatus::Code(1));
    served.await.unwrap().unwrap();
    reaper.abort();
}

/// The command line going away hangs the shell up, and what it started with it.
#[tokio::test]
async fn closing_the_stream_hangs_up_the_shell() {
    let _alone = ONE_REAPER.lock().await;
    let waiters = Waiters::new();
    let reaper = start_reaper(waiters.clone());

    let (host, pid, served) = attach(&waiters, &["/bin/sh", "-c", "sleep 60"], None).await;
    drop(host);
    served.await.unwrap().unwrap();

    // Gone, and collected: signal zero asks whether the pid still exists.
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        // SAFETY: an integer pid and the null signal.
        let alive = unsafe { libc::kill(pid, 0) } == 0;
        if !alive {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "the shell outlived the connection that was its reason to exist"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    reaper.abort();
}

/// An explicit hangup does the same.
#[tokio::test]
async fn a_hangup_frame_ends_the_shell() {
    let _alone = ONE_REAPER.lock().await;
    let waiters = Waiters::new();
    let reaper = start_reaper(waiters.clone());

    let (mut host, pid, served) = attach(&waiters, &["/bin/sh", "-c", "sleep 60"], None).await;
    host.say(Frame::Hangup).await;
    served.await.unwrap().unwrap();

    let deadline = Instant::now() + Duration::from_secs(5);
    while unsafe { libc::kill(pid, 0) } == 0 {
        assert!(Instant::now() < deadline, "the shell outlived a hangup");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    reaper.abort();
}

/// Everything that can be refused before there is a connection is refused where
/// it can be sent up the control channel.
#[tokio::test]
async fn a_program_that_does_not_exist_is_refused_before_anything_connects() {
    let _alone = ONE_REAPER.lock().await;
    let waiters = Waiters::new();
    let reaper = start_reaper(waiters.clone());

    let refused = spawn(&waiters, &exec(&["/nonexistent/program"]), None)
        .err()
        .expect("a missing program started");
    assert!(
        refused.reason.contains("/nonexistent/program"),
        "{}",
        refused.reason
    );
    assert!(spawn(&waiters, &exec(&[]), None).is_err());
    reaper.abort();
}

/// A peer that speaks the wrong half of the protocol is not obeyed.
#[tokio::test]
async fn a_frame_only_the_guest_sends_is_refused_and_the_shell_hung_up() {
    let _alone = ONE_REAPER.lock().await;
    let waiters = Waiters::new();
    let reaper = start_reaper(waiters.clone());

    let (mut host, pid, served) = attach(&waiters, &["/bin/sh", "-c", "sleep 60"], None).await;
    host.say(Frame::Exit(ExitStatus::Code(0))).await;
    assert!(served.await.unwrap().is_err());

    let deadline = Instant::now() + Duration::from_secs(5);
    while unsafe { libc::kill(pid, 0) } == 0 {
        assert!(Instant::now() < deadline, "the shell outlived a bad peer");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    reaper.abort();
}
