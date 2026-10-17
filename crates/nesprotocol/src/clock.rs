//! The one clock media time is measured on.
//!
//! # Why one clock, and why this one
//!
//! Every media unit carries when it was captured and when it was handed to the
//! transport, and those stamps are taken by different processes: nescapture
//! stamps a video frame, neswire an audio packet's graph position, neshub the
//! send. They can only be subtracted if they are on one clock, so the sender's
//! clock is the kernel's `CLOCK_MONOTONIC`, which every process on a machine
//! shares and nothing can step. Wall clock would be shared too, and NTP moves
//! it.
//!
//! Microseconds in a `u64`: fine enough to see a millisecond of jitter in, and
//! it does not wrap in any session that will ever run, so nothing downstream
//! needs wrapping arithmetic.
//!
//! # The receiver
//!
//! The two machines' clocks are unrelated, so a receiver never compares its own
//! reading with a sender's stamp except through `delay`, which only uses the
//! difference's variation. Off unix (the client on Windows) this is therefore
//! the process's own monotonic clock, anchored at first use: consistent within
//! the process, which is all a receiver needs.

/// Now, in microseconds, on the clock media timestamps are on.
#[cfg(unix)]
pub fn monotonic_us() -> u64 {
    let mut ts = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: `ts` is a valid out-pointer, and `CLOCK_MONOTONIC` exists on
    // every unix this builds for, so the call cannot fail.
    unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut ts) };
    ts.tv_sec as u64 * 1_000_000 + ts.tv_nsec as u64 / 1_000
}

/// Now, in microseconds, on this process's own monotonic clock.
#[cfg(not(unix))]
pub fn monotonic_us() -> u64 {
    static ANCHOR: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    ANCHOR
        .get_or_init(std::time::Instant::now)
        .elapsed()
        .as_micros() as u64
}

/// When `instant` was, on the same clock as [`monotonic_us`].
///
/// For a moment something else stamped as an `Instant`, such as a compositor's
/// present time, taken as how long ago it was. An instant in the future reads
/// as now.
pub fn instant_us(instant: std::time::Instant) -> u64 {
    monotonic_us().saturating_sub(instant.elapsed().as_micros() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_clock_moves_forward_in_microseconds() {
        let a = monotonic_us();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let b = monotonic_us();
        assert!(b - a >= 2_000, "{a} -> {b}");
        assert!(b - a < 1_000_000, "{a} -> {b}");
    }

    #[test]
    fn an_instant_lands_on_the_same_clock() {
        let then = std::time::Instant::now();
        std::thread::sleep(std::time::Duration::from_millis(3));
        let now = monotonic_us();
        let stamped = instant_us(then);
        assert!(
            (2_000..1_000_000).contains(&(now - stamped)),
            "{stamped} vs {now}"
        );
    }
}
