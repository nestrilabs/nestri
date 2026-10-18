use std::io::{self, Read};
use std::os::unix::io::{AsFd, BorrowedFd};
use std::os::unix::net::UnixStream;

use calloop::{EventSource, Interest, Mode, Poll, PostAction, Readiness, Token, TokenFactory};

pub struct InputIpcSource {
    stream: UnixStream,
    buf: Vec<u8>,
}

impl InputIpcSource {
    pub fn connect(path: &str) -> io::Result<Self> {
        let stream = UnixStream::connect(path)?;
        stream.set_nonblocking(true)?;
        Ok(Self {
            stream,
            buf: Vec::new(),
        })
    }

    pub fn try_clone(&self) -> io::Result<UnixStream> {
        self.stream.try_clone()
    }
}

impl InputIpcSource {
    /// Read everything available into `buf`. `true` if the peer has closed.
    fn fill(&mut self) -> io::Result<bool> {
        let mut tmp = [0u8; 4096];
        loop {
            match self.stream.read(&mut tmp) {
                Ok(0) => return Ok(true),
                Ok(n) => self.buf.extend_from_slice(&tmp[..n]),
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => return Ok(false),
                Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
                Err(e) => return Err(e),
            }
        }
    }
}

impl AsFd for InputIpcSource {
    fn as_fd(&self) -> BorrowedFd<'_> {
        self.stream.as_fd()
    }
}

impl EventSource for InputIpcSource {
    type Event = Vec<u8>;
    type Metadata = ();
    type Ret = ();
    type Error = io::Error;

    fn process_events<F>(
        &mut self,
        _readiness: Readiness,
        _token: Token,
        mut callback: F,
    ) -> Result<PostAction, Self::Error>
    where
        F: FnMut(Self::Event, &mut Self::Metadata),
    {
        // The hub closing its end is not an error of this source: it is what
        // the hub does when the box is going down (init signals every process
        // at once, so the hub can be gone before our own SIGTERM is read), and
        // an `Err` here is returned out of the event loop and panics `main`,
        // skipping the cleanup after it. Frames already read are still
        // delivered, then the source removes itself and the loop carries on.
        let closed = self.fill()?;

        while self.buf.len() >= 2 {
            let payload_len = u16::from_le_bytes([self.buf[0], self.buf[1]]) as usize;
            let frame_total = 2 + payload_len;
            if self.buf.len() < frame_total {
                break;
            }
            let payload = self.buf[2..frame_total].to_vec();
            self.buf.drain(..frame_total);
            callback(payload, &mut ());
        }

        if closed {
            tracing::warn!("input IPC socket closed by the hub; no more input from it");
            return Ok(PostAction::Remove);
        }
        Ok(PostAction::Continue)
    }

    fn register(&mut self, poll: &mut Poll, factory: &mut TokenFactory) -> calloop::Result<()> {
        unsafe { poll.register(self.as_fd(), Interest::READ, Mode::Level, factory.token()) }
    }

    fn reregister(&mut self, poll: &mut Poll, factory: &mut TokenFactory) -> calloop::Result<()> {
        poll.reregister(self.as_fd(), Interest::READ, Mode::Level, factory.token())
    }

    fn unregister(&mut self, poll: &mut Poll) -> calloop::Result<()> {
        poll.unregister(self.as_fd())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn pair() -> (InputIpcSource, UnixStream) {
        let (a, b) = UnixStream::pair().unwrap();
        a.set_nonblocking(true).unwrap();
        (
            InputIpcSource {
                stream: a,
                buf: Vec::new(),
            },
            b,
        )
    }

    #[test]
    fn an_open_peer_with_nothing_to_say_is_not_closed() {
        let (mut source, _peer) = pair();
        assert!(!source.fill().unwrap());
    }

    #[test]
    fn a_closed_peer_is_closed_not_an_error() {
        let (mut source, peer) = pair();
        drop(peer);
        assert!(source.fill().unwrap());
    }

    #[test]
    fn what_the_peer_sent_before_closing_is_kept() {
        let (mut source, mut peer) = pair();
        peer.write_all(&[1, 0, 7]).unwrap();
        drop(peer);
        assert!(source.fill().unwrap());
        assert_eq!(source.buf, vec![1, 0, 7]);
    }
}
