// A shell in the box, for whoever is operating it.
//
// The host asks for one on the control channel and this end starts the process
// on a pseudo-terminal, then dials the host on a port of its own and carries
// the terminal's bytes over it. See `nesprotocol::attach` for the frames and
// why they are not on the control channel.
//
// # It is not a launch
//
// A launch is the box's workload and its exit means something to the session.
// A shell has no such meaning: it comes and goes while a game plays, it never
// ends the box, and the box ending ends it. So it takes no part in the
// session's one-running-launch bookkeeping.
//
// # Reaping goes through the same place as everything else
//
// This is PID 1, and the reaper is the only thing allowed to wait on a child
// (see `reap`). The shell is started through `Waiters` like a workload is, and
// its exit arrives the same way, so a shell that dies does not become the one
// zombie the reaper was written to prevent.
//
// # Two modes, one mechanism
//
// With a terminal on the other end the PTY is an ordinary one. Without, it is
// put in raw mode so it is a byte pipe: no echo, and no rewriting of line
// endings, which a command run for its output would otherwise get "\r\n" for
// every "\n". Stderr shares the PTY with stdout, which a terminal does anyway.

use std::collections::BTreeMap;
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};
use std::time::Duration;

use nesprotocol::attach::{ExitStatus, Frame, FrameReader};
use nesprotocol::lifecycle::{AttachId, Exec, Exit, Winsize};
use tokio::io::unix::AsyncFd;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::oneshot;

use crate::reap::{Waiters, Watched};
use crate::workload::Failure;

/// What a shell finds on `PATH` when the host named none.
///
/// The guest's, because only the guest knows its own filesystem. The environment
/// is cleared, as a launch's is, so without this a shell would have no `PATH`
/// at all and find nothing.
const DEFAULT_PATH: &str = "/usr/local/sbin:/usr/local/bin:/usr/bin";

/// How long to keep collecting a shell's last output after it has exited.
///
/// Its output may still be queued in the terminal when its exit arrives, and
/// dropping it would lose the last line -- usually the one that says why. Bounded,
/// because something it started may still hold the terminal open and nothing
/// more is coming.
const DRAIN: Duration = Duration::from_millis(300);

/// A shell that has been started and not yet connected to anything.
///
/// Dropping one hangs it up, so a shell whose connection could not be made does
/// not sit in the box with nobody at the other end.
pub struct Shell {
    master: Option<OwnedFd>,
    watched: Watched,
    exit: Option<oneshot::Receiver<Exit>>,
}

impl Shell {
    pub fn pid(&self) -> i32 {
        self.watched.pid
    }
}

impl Drop for Shell {
    fn drop(&mut self) {
        hang_up(&self.watched);
    }
}

/// Tell the shell its terminal is gone, if it is still ours to tell.
///
/// The process group, because the shell's children are in it and a `sleep`
/// left holding the terminal is what a hung-up shell is for getting rid of.
/// Asked of the registry first: after the reaper has collected the shell the
/// number may belong to something else.
fn hang_up(watched: &Watched) {
    if !watched.running() {
        return;
    }
    // SAFETY: two integers, nothing borrowed. A group that has gone fails with
    // ESRCH, which is what hanging up twice should do.
    unsafe {
        libc::kill(-watched.pid, libc::SIGHUP);
        libc::kill(watched.pid, libc::SIGHUP);
    }
}

fn pty(size: Option<Winsize>) -> io::Result<(OwnedFd, OwnedFd)> {
    let mut master: libc::c_int = -1;
    let mut slave: libc::c_int = -1;
    let window = size.map(|s| libc::winsize {
        ws_row: s.rows,
        ws_col: s.cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    });
    // SAFETY: two out-pointers to integers and a pointer to a winsize that
    // lives for the call; no name buffer and no termios are asked for.
    let opened = unsafe {
        libc::openpty(
            &mut master,
            &mut slave,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            window.as_ref().map_or(std::ptr::null_mut(), |w| {
                w as *const libc::winsize as *mut libc::winsize
            }),
        )
    };
    if opened != 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: openpty returned two descriptors this process now owns.
    let (master, slave) = unsafe { (OwnedFd::from_raw_fd(master), OwnedFd::from_raw_fd(slave)) };

    for fd in [&master, &slave] {
        // SAFETY: fcntl on a descriptor this function owns.
        if unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_SETFD, libc::FD_CLOEXEC) } != 0 {
            return Err(io::Error::last_os_error());
        }
    }
    // The master is read through the runtime, so it must not block.
    // SAFETY: as above.
    if unsafe { libc::fcntl(master.as_raw_fd(), libc::F_SETFL, libc::O_NONBLOCK) } != 0 {
        return Err(io::Error::last_os_error());
    }
    if size.is_none() {
        raw_mode(&slave)?;
    }
    Ok((master, slave))
}

/// Make a terminal a byte pipe: no echo, no line editing, no rewriting.
fn raw_mode(slave: &OwnedFd) -> io::Result<()> {
    // SAFETY: a zeroed termios is filled by tcgetattr before it is used, and
    // every call is on a descriptor this function was handed.
    unsafe {
        let mut termios: libc::termios = std::mem::zeroed();
        if libc::tcgetattr(slave.as_raw_fd(), &mut termios) != 0 {
            return Err(io::Error::last_os_error());
        }
        libc::cfmakeraw(&mut termios);
        if libc::tcsetattr(slave.as_raw_fd(), libc::TCSANOW, &termios) != 0 {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(())
}

/// The environment a shell starts with: what a launch gets, plus a `PATH`.
fn environment(exec: &Exec) -> BTreeMap<String, String> {
    // Made here for the same reason a launch's is: the environment is cleared,
    // so nothing a shell inherits points at it, and a tool that wants a runtime
    // directory reads `XDG_RUNTIME_DIR`.
    let runtime = crate::system::runtime_dir(exec.uid, exec.gid).ok();
    let mut env: BTreeMap<String, String> = crate::workload::environment(exec, runtime.as_deref())
        .into_iter()
        .collect();
    env.entry("PATH".into())
        .or_insert_with(|| DEFAULT_PATH.into());
    env
}

/// Start the process on a terminal.
///
/// Synchronous on purpose: everything that can fail before there is anything to
/// connect to fails here, where it can be returned and sent up the control
/// channel. A host that heard nothing would wait out a timeout to learn the
/// program does not exist.
pub fn spawn(waiters: &Waiters, exec: &Exec, size: Option<Winsize>) -> Result<Shell, Failure> {
    let Some((program, args)) = exec.argv.split_first() else {
        return Err(Failure::new("the command is empty"));
    };
    let (master, slave) = pty(size).map_err(|e| Failure::new(format!("no terminal: {e}")))?;
    let again = |slave: &OwnedFd| {
        slave
            .try_clone()
            .map_err(|e| Failure::new(format!("no terminal: {e}")))
    };

    let mut command = Command::new(program);
    command
        .args(args)
        .env_clear()
        .envs(environment(exec))
        .current_dir(exec.cwd.as_deref().unwrap_or("/"))
        .stdin(Stdio::from(again(&slave)?))
        .stdout(Stdio::from(again(&slave)?))
        .stderr(Stdio::from(slave));

    let (uid, gid) = (exec.uid, exec.gid);
    // SAFETY: the closure runs between fork and exec, where only
    // async-signal-safe calls are allowed. These are, and it allocates nothing.
    unsafe {
        command.pre_exec(move || {
            // A session of its own, with the terminal as its controlling one:
            // that is what makes ^C reach the foreground job instead of the
            // shell's whole group, and what lets job control work at all.
            if libc::setsid() < 0 {
                return Err(io::Error::last_os_error());
            }
            if libc::ioctl(0, libc::TIOCSCTTY as _, 0) < 0 {
                return Err(io::Error::last_os_error());
            }
            // gid first: dropping the uid first would lose the privilege needed
            // to set the gid at all.
            if libc::setgid(gid) != 0 {
                return Err(io::Error::last_os_error());
            }
            if libc::setuid(uid) != 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }

    let mut watched = waiters
        .watch(|| Ok(command.spawn()?.id() as i32))
        .map_err(|error| Failure::new(format!("{program} as {uid}:{gid}: {error}")))?;
    let exit = watched.take_exit().expect("a new watch has its exit");
    Ok(Shell {
        master: Some(master),
        watched,
        exit: Some(exit),
    })
}

fn read_fd(fd: RawFd, buf: &mut [u8]) -> io::Result<usize> {
    // SAFETY: a pointer and length into a buffer that outlives the call.
    let n = unsafe { libc::read(fd, buf.as_mut_ptr().cast(), buf.len()) };
    if n < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(n as usize)
    }
}

fn write_fd(fd: RawFd, buf: &[u8]) -> io::Result<usize> {
    // SAFETY: a pointer and length into a buffer that outlives the call.
    let n = unsafe { libc::write(fd, buf.as_ptr().cast(), buf.len()) };
    if n < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(n as usize)
    }
}

fn resize(fd: RawFd, cols: u16, rows: u16) {
    let window = libc::winsize {
        ws_row: rows,
        ws_col: cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    // SAFETY: a pointer to a winsize that lives for the call. The kernel sends
    // the foreground job SIGWINCH itself.
    unsafe { libc::ioctl(fd, libc::TIOCSWINSZ as _, &window) };
}

/// Whether a read failure means the terminal has no process on it any more.
///
/// A pseudo-terminal's master reports `EIO` once every holder of the slave has
/// gone, and that is its end of file.
fn terminal_gone(error: &io::Error) -> bool {
    error.raw_os_error() == Some(libc::EIO)
}

async fn send<W: AsyncWrite + Unpin>(out: &mut W, frame: &Frame) -> io::Result<()> {
    let bytes = frame
        .encode()
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    out.write_all(&bytes).await
}

async fn send_data<W: AsyncWrite + Unpin>(out: &mut W, bytes: &[u8]) -> io::Result<()> {
    for frame in Frame::data(bytes) {
        send(out, &frame).await?;
    }
    Ok(())
}

/// Write to the terminal, waiting for room.
async fn write_terminal(master: &AsyncFd<OwnedFd>, mut bytes: &[u8]) -> io::Result<()> {
    while !bytes.is_empty() {
        let mut ready = master.writable().await?;
        match ready.try_io(|fd| write_fd(fd.as_raw_fd(), bytes)) {
            Ok(Ok(n)) => bytes = &bytes[n..],
            // The shell is gone; what was typed at it has nowhere to go.
            Ok(Err(e)) if terminal_gone(&e) => return Ok(()),
            Ok(Err(e)) => return Err(e),
            Err(_would_block) => {}
        }
    }
    Ok(())
}

/// How the process ended, as the stream says it.
fn status_of(exit: Option<Exit>) -> ExitStatus {
    match exit {
        Some(Exit {
            signal: Some(signal),
            ..
        }) => ExitStatus::Signal(signal),
        Some(Exit {
            exit_code: Some(code),
            ..
        }) => ExitStatus::Code(code),
        // The reaper never delivered an exit, which it only fails to do when this
        // end is being torn down. Said as a code no shell returns on its own.
        _ => ExitStatus::Code(-1),
    }
}

/// Carry a shell's terminal over `stream` until one side is done.
///
/// Generic over the stream so it can be driven by a real pseudo-terminal and an
/// in-memory pipe, which is the only way to test the part that matters.
pub async fn serve<S>(mut shell: Shell, id: &AttachId, stream: S) -> io::Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let master = AsyncFd::new(
        shell
            .master
            .take()
            .expect("a shell has its terminal until served"),
    )?;
    let mut exit = shell
        .exit
        .take()
        .expect("a shell has its exit until served");
    let (mut from_host, mut to_host) = tokio::io::split(stream);

    send(&mut to_host, &Frame::Hello(id.to_string())).await?;

    let mut frames = FrameReader::new();
    let mut input = vec![0u8; 8192];
    let mut output = vec![0u8; 16384];
    let mut terminal_open = true;

    let ended = loop {
        tokio::select! {
            ready = master.readable(), if terminal_open => {
                let mut ready = ready?;
                match ready.try_io(|fd| read_fd(fd.as_raw_fd(), &mut output)) {
                    Ok(Ok(0)) => terminal_open = false,
                    Ok(Ok(n)) => send_data(&mut to_host, &output[..n]).await?,
                    Ok(Err(e)) if terminal_gone(&e) => terminal_open = false,
                    Ok(Err(e)) => return Err(e),
                    Err(_would_block) => {}
                }
            }
            read = from_host.read(&mut input) => {
                let n = read?;
                if n == 0 {
                    // The command line went away. Dropping `shell` hangs it up.
                    return Ok(());
                }
                frames.push(&input[..n]);
                loop {
                    match frames.next_frame() {
                        Ok(Some(Frame::Data(bytes))) => {
                            if terminal_open {
                                write_terminal(&master, &bytes).await?;
                            }
                        }
                        Ok(Some(Frame::Resize { cols, rows })) => resize(master.as_raw_fd(), cols, rows),
                        Ok(Some(Frame::Hangup)) => return Ok(()),
                        // Hello and Exit are ours to send. A peer that sends them
                        // has lost track of which end it is.
                        Ok(Some(other)) => {
                            return Err(io::Error::new(
                                io::ErrorKind::InvalidData,
                                format!("the host sent a frame only the guest sends: {other:?}"),
                            ));
                        }
                        Ok(None) => break,
                        Err(e) => return Err(io::Error::new(io::ErrorKind::InvalidData, e)),
                    }
                }
            }
            exit = &mut exit => break exit.ok(),
        }
    };

    // Collect what it said last, then say how it ended.
    if terminal_open {
        let drained = tokio::time::timeout(DRAIN, async {
            loop {
                let mut ready = master.readable().await?;
                match ready.try_io(|fd| read_fd(fd.as_raw_fd(), &mut output)) {
                    Ok(Ok(0)) => return Ok::<(), io::Error>(()),
                    Ok(Ok(n)) => send_data(&mut to_host, &output[..n]).await?,
                    Ok(Err(e)) if terminal_gone(&e) => return Ok(()),
                    Ok(Err(e)) => return Err(e),
                    Err(_would_block) => return Ok(()),
                }
            }
        })
        .await;
        if let Ok(Err(e)) = drained {
            return Err(e);
        }
    }
    send(&mut to_host, &Frame::Exit(status_of(ended))).await?;
    to_host.flush().await?;
    to_host.shutdown().await
}
