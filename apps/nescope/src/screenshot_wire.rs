//! The screenshot wire format, shared by the compositor and `nescope-shot`.
//!
//! Split from the compositor half so the tool can speak the protocol without
//! linking a Wayland compositor and an EGL renderer to do it — and so the two
//! cannot drift apart on the format, which duplicating it would invite.
//!
//! ```text
//!   ->  [u8 request]                                  0x01 = capture
//!   <-  [u8 status][u32 LE width][u32 LE height][RGBA…]
//! ```
//!
//! Width and height are zero unless the status is [`Status::Ok`].

/// Ask for a picture of what is on screen.
pub const REQUEST_CAPTURE: u8 = 0x01;

/// How a capture turned out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Status {
    Ok = 0,
    /// No window is mapped at all.
    NoSurface = 1,
    /// A surface exists but could not be read by any route — not as shm, and
    /// not by importing it from the GPU either.
    Unreadable = 2,
    /// Windows are mapped, but none has drawn anything readable yet.
    ///
    /// Distinct from [`Status::NoSurface`] on purpose: "nothing is running" and
    /// "something is running but has not drawn" send you to different places,
    /// and one status for both means watching a client start up tells you
    /// nothing about which is happening.
    NoBuffer = 3,
}

/// A captured image, in RGBA8, top row first.
pub struct Capture {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// Serialise a reply. Split out from the socket so it can be asserted without
/// one.
pub fn encode_reply(status: Status, capture: Option<&Capture>) -> Vec<u8> {
    let mut out = Vec::new();
    out.push(status as u8);
    match capture {
        Some(c) if status == Status::Ok => {
            out.extend_from_slice(&c.width.to_le_bytes());
            out.extend_from_slice(&c.height.to_le_bytes());
            out.extend_from_slice(&c.rgba);
        }
        // A non-Ok status carries no pixels, and says so with zeroed
        // dimensions rather than by the reader having to know.
        _ => out.extend_from_slice(&[0u8; 8]),
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reply_carries_its_dimensions_before_its_pixels() {
        let capture = Capture {
            width: 2,
            height: 1,
            rgba: vec![1, 2, 3, 4, 5, 6, 7, 8],
        };
        let bytes = encode_reply(Status::Ok, Some(&capture));
        assert_eq!(bytes[0], Status::Ok as u8);
        assert_eq!(u32::from_le_bytes(bytes[1..5].try_into().unwrap()), 2);
        assert_eq!(u32::from_le_bytes(bytes[5..9].try_into().unwrap()), 1);
        assert_eq!(&bytes[9..], &capture.rgba[..]);
        // The reader sizes its buffer from the header, so this has to be exact.
        assert_eq!(bytes.len(), 9 + (2 * 1 * 4));
    }

    #[test]
    fn a_failure_carries_no_pixels_and_zero_dimensions() {
        // A reader that trusted a non-zero size on a failed capture would wait
        // for bytes that are never sent.
        for status in [Status::NoSurface, Status::Unreadable, Status::NoBuffer] {
            let bytes = encode_reply(status, None);
            assert_eq!(bytes.len(), 9, "{status:?}");
            assert_eq!(bytes[0], status as u8);
            assert!(bytes[1..9].iter().all(|b| *b == 0), "{status:?}");
        }
    }

    #[test]
    fn pixels_are_dropped_when_the_status_is_not_ok() {
        // Guards against a caller passing both a failure and a stale capture:
        // the status is what the reader believes, so the two must agree.
        let capture = Capture {
            width: 4,
            height: 4,
            rgba: vec![0xff; 64],
        };
        assert_eq!(encode_reply(Status::Unreadable, Some(&capture)).len(), 9);
    }
}
