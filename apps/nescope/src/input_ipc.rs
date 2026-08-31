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
        let mut tmp = [0u8; 4096];
        loop {
            match self.stream.read(&mut tmp) {
                Ok(0) => {
                    return Err(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "IPC socket closed",
                    ));
                }
                Ok(n) => {
                    self.buf.extend_from_slice(&tmp[..n]);
                }
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => break,
                Err(e) => return Err(e),
            }
        }

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
