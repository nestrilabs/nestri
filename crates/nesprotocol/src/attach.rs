//! The byte stream of an attached shell.
//!
//! A shell in a box is a terminal's worth of bytes in both directions, plus the
//! few things a terminal says out of band: it has been resized, the other end
//! has gone, the process has ended. Those ride a connection of their own (see
//! [`crate::lifecycle::ATTACH_PORT`]) rather than the JSON-lines control
//! channel, because a screenful of output on a channel shared with everything
//! else would hold every other message in the box behind it.
//!
//! # A codec and nothing else
//!
//! No I/O here: [`Frame::encode`] makes bytes and [`FrameReader`] is fed bytes
//! and hands back frames. Three programs speak this -- the guest, the agent and
//! its command line -- each with its own idea of how to read a socket, and none
//! of them should have to agree with the others about anything but this.
//!
//! # Hostile enough to be careful
//!
//! Both ends are ours, but one of them is a guest, and a length prefix read from
//! a guest is a length prefix read from the other side of a trust boundary. A
//! frame longer than [`MAX_PAYLOAD`] is an error and not an allocation, and an
//! unknown tag is an error and not a skip: skipping needs a length this end has
//! no reason to believe.

/// The longest payload a frame may carry.
pub const MAX_PAYLOAD: usize = 1 << 20;

const HEADER: usize = 5;

const TAG_HELLO: u8 = 1;
const TAG_DATA: u8 = 2;
const TAG_RESIZE: u8 = 3;
const TAG_HANGUP: u8 = 4;
const TAG_EXIT: u8 = 5;

/// How the process ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExitStatus {
    Code(i32),
    /// Killed by this signal. Kept apart from a code: a signalled process has
    /// no exit code, and `0` for one would make a kill look like a clean run.
    Signal(i32),
}

/// One message on the stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frame {
    /// First frame from the guest: which attach this connection is for.
    Hello(String),
    /// Terminal bytes, in either direction.
    Data(Vec<u8>),
    /// The terminal changed size. Host to guest.
    Resize { cols: u16, rows: u16 },
    /// The host is done with the shell. Host to guest.
    Hangup,
    /// The process ended. Last frame, guest to host.
    Exit(ExitStatus),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FrameError {
    UnknownTag(u8),
    TooLarge(usize),
    Malformed(&'static str),
}

impl std::fmt::Display for FrameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FrameError::UnknownTag(tag) => write!(f, "an unknown frame tag, {tag}"),
            FrameError::TooLarge(len) => {
                write!(f, "a frame of {len} bytes, past the {MAX_PAYLOAD} allowed")
            }
            FrameError::Malformed(what) => write!(f, "a malformed frame: {what}"),
        }
    }
}

impl std::error::Error for FrameError {}

impl Frame {
    /// This frame as bytes. Refuses a payload it could not be read back from.
    pub fn encode(&self) -> Result<Vec<u8>, FrameError> {
        let (tag, payload): (u8, Vec<u8>) = match self {
            Frame::Hello(id) => (TAG_HELLO, id.as_bytes().to_vec()),
            Frame::Data(bytes) => (TAG_DATA, bytes.clone()),
            Frame::Resize { cols, rows } => {
                let mut p = Vec::with_capacity(4);
                p.extend_from_slice(&cols.to_le_bytes());
                p.extend_from_slice(&rows.to_le_bytes());
                (TAG_RESIZE, p)
            }
            Frame::Hangup => (TAG_HANGUP, Vec::new()),
            Frame::Exit(status) => {
                let (kind, value) = match status {
                    ExitStatus::Code(code) => (0u8, *code),
                    ExitStatus::Signal(signal) => (1u8, *signal),
                };
                let mut p = vec![kind];
                p.extend_from_slice(&value.to_le_bytes());
                (TAG_EXIT, p)
            }
        };
        if payload.len() > MAX_PAYLOAD {
            return Err(FrameError::TooLarge(payload.len()));
        }
        let mut out = Vec::with_capacity(HEADER + payload.len());
        out.push(tag);
        out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        out.extend_from_slice(&payload);
        Ok(out)
    }

    /// Terminal bytes as frames no larger than a frame may be.
    pub fn data(bytes: &[u8]) -> impl Iterator<Item = Frame> + '_ {
        bytes
            .chunks(MAX_PAYLOAD)
            .map(|chunk| Frame::Data(chunk.to_vec()))
    }
}

/// Frames out of bytes that arrive in whatever pieces the socket gives.
#[derive(Debug, Default)]
pub struct FrameReader {
    buf: Vec<u8>,
}

impl FrameReader {
    pub fn new() -> Self {
        Self::default()
    }

    /// Bytes that have arrived.
    pub fn push(&mut self, bytes: &[u8]) {
        self.buf.extend_from_slice(bytes);
    }

    /// The next whole frame, if one has arrived.
    ///
    /// `Ok(None)` is "not yet". After an error the reader is poisoned in the
    /// sense that matters: the stream has lost its framing, nothing after this
    /// point can be trusted, and the caller closes the connection.
    pub fn next_frame(&mut self) -> Result<Option<Frame>, FrameError> {
        if self.buf.len() < HEADER {
            return Ok(None);
        }
        let tag = self.buf[0];
        let len = u32::from_le_bytes([self.buf[1], self.buf[2], self.buf[3], self.buf[4]]) as usize;
        if !(TAG_HELLO..=TAG_EXIT).contains(&tag) {
            return Err(FrameError::UnknownTag(tag));
        }
        if len > MAX_PAYLOAD {
            return Err(FrameError::TooLarge(len));
        }
        if self.buf.len() < HEADER + len {
            return Ok(None);
        }
        let payload: Vec<u8> = self.buf[HEADER..HEADER + len].to_vec();
        self.buf.drain(..HEADER + len);

        let frame = match tag {
            TAG_HELLO => Frame::Hello(
                String::from_utf8(payload).map_err(|_| FrameError::Malformed("a non-UTF-8 id"))?,
            ),
            TAG_DATA => Frame::Data(payload),
            TAG_RESIZE => {
                let [c0, c1, r0, r1] = payload[..] else {
                    return Err(FrameError::Malformed("a resize that is not four bytes"));
                };
                Frame::Resize {
                    cols: u16::from_le_bytes([c0, c1]),
                    rows: u16::from_le_bytes([r0, r1]),
                }
            }
            TAG_HANGUP => {
                if !payload.is_empty() {
                    return Err(FrameError::Malformed("a hangup with a payload"));
                }
                Frame::Hangup
            }
            TAG_EXIT => {
                let [kind, a, b, c, d] = payload[..] else {
                    return Err(FrameError::Malformed("an exit that is not five bytes"));
                };
                let value = i32::from_le_bytes([a, b, c, d]);
                match kind {
                    0 => Frame::Exit(ExitStatus::Code(value)),
                    1 => Frame::Exit(ExitStatus::Signal(value)),
                    _ => return Err(FrameError::Malformed("an exit of an unknown kind")),
                }
            }
            _ => unreachable!("the tag range was checked above"),
        };
        Ok(Some(frame))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round_trip(frame: Frame) {
        let bytes = frame.encode().unwrap();
        let mut reader = FrameReader::new();
        reader.push(&bytes);
        assert_eq!(reader.next_frame().unwrap(), Some(frame));
        assert_eq!(reader.next_frame().unwrap(), None);
    }

    #[test]
    fn every_frame_survives_the_round_trip() {
        round_trip(Frame::Hello("a-1".into()));
        round_trip(Frame::Data(b"ls -l\r".to_vec()));
        round_trip(Frame::Data(Vec::new()));
        round_trip(Frame::Resize {
            cols: 220,
            rows: 61,
        });
        round_trip(Frame::Hangup);
        round_trip(Frame::Exit(ExitStatus::Code(0)));
        round_trip(Frame::Exit(ExitStatus::Code(127)));
        round_trip(Frame::Exit(ExitStatus::Signal(9)));
    }

    /// A signal is not a code, and the two must not read back as each other.
    #[test]
    fn a_kill_is_not_an_exit_code() {
        let mut reader = FrameReader::new();
        reader.push(&Frame::Exit(ExitStatus::Signal(9)).encode().unwrap());
        assert_ne!(
            reader.next_frame().unwrap(),
            Some(Frame::Exit(ExitStatus::Code(9)))
        );
    }

    /// A socket hands over bytes in whatever pieces it likes.
    #[test]
    fn frames_are_reassembled_from_any_split() {
        let frames = vec![
            Frame::Hello("x".into()),
            Frame::Data(vec![7; 3000]),
            Frame::Resize { cols: 80, rows: 24 },
            Frame::Exit(ExitStatus::Code(3)),
        ];
        let wire: Vec<u8> = frames.iter().flat_map(|f| f.encode().unwrap()).collect();
        for step in [1, 2, 5, 7, 4096] {
            let mut reader = FrameReader::new();
            let mut got = Vec::new();
            for piece in wire.chunks(step) {
                reader.push(piece);
                while let Some(frame) = reader.next_frame().unwrap() {
                    got.push(frame);
                }
            }
            assert_eq!(got, frames, "split into {step}-byte pieces");
        }
    }

    #[test]
    fn two_frames_in_one_read_come_out_as_two() {
        let mut reader = FrameReader::new();
        let mut wire = Frame::Data(b"a".to_vec()).encode().unwrap();
        wire.extend(Frame::Hangup.encode().unwrap());
        reader.push(&wire);
        assert_eq!(
            reader.next_frame().unwrap(),
            Some(Frame::Data(b"a".to_vec()))
        );
        assert_eq!(reader.next_frame().unwrap(), Some(Frame::Hangup));
        assert_eq!(reader.next_frame().unwrap(), None);
    }

    /// The length is the other side's to claim, and is not believed past the cap.
    #[test]
    fn a_length_past_the_cap_is_refused_before_anything_is_waited_for() {
        let mut reader = FrameReader::new();
        let mut header = vec![TAG_DATA];
        header.extend_from_slice(&((MAX_PAYLOAD as u32) + 1).to_le_bytes());
        reader.push(&header);
        assert_eq!(
            reader.next_frame(),
            Err(FrameError::TooLarge(MAX_PAYLOAD + 1))
        );
        assert!(Frame::Data(vec![0; MAX_PAYLOAD + 1]).encode().is_err());
        assert!(Frame::Data(vec![0; MAX_PAYLOAD]).encode().is_ok());
    }

    #[test]
    fn an_unknown_tag_is_an_error_and_not_a_skip() {
        for tag in [0u8, 6, 255] {
            let mut reader = FrameReader::new();
            reader.push(&[tag, 0, 0, 0, 0]);
            assert_eq!(reader.next_frame(), Err(FrameError::UnknownTag(tag)));
        }
    }

    #[test]
    fn a_frame_whose_payload_is_the_wrong_shape_is_refused() {
        for (tag, payload) in [
            (TAG_RESIZE, vec![1, 2, 3]),
            (TAG_HANGUP, vec![1]),
            (TAG_EXIT, vec![0, 1, 2]),
            (TAG_EXIT, vec![9, 0, 0, 0, 0]),
            (TAG_HELLO, vec![0xff, 0xfe]),
        ] {
            let mut wire = vec![tag];
            wire.extend_from_slice(&(payload.len() as u32).to_le_bytes());
            wire.extend_from_slice(&payload);
            let mut reader = FrameReader::new();
            reader.push(&wire);
            assert!(
                matches!(reader.next_frame(), Err(FrameError::Malformed(_))),
                "tag {tag} with {payload:?}"
            );
        }
    }

    #[test]
    fn large_output_is_split_into_frames_a_frame_may_be() {
        let bytes = vec![1u8; MAX_PAYLOAD * 2 + 10];
        let frames: Vec<Frame> = Frame::data(&bytes).collect();
        assert_eq!(frames.len(), 3);
        for frame in &frames {
            assert!(frame.encode().is_ok());
        }
    }
}
