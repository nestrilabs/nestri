//! `nescope-shot` — ask a running nescope for a picture of what it is showing.
//!
//! nescope has no display and no renderer, so "is anything actually there?" is
//! otherwise unanswerable: a black stream, a window that never mapped and a
//! client rendering on the GPU all look identical from outside.
//!
//! This is the listener side of the screenshot socket. nescope dials *out*, so
//! a shell one-liner cannot stand in for it — something has to be listening
//! before nescope starts, and the reply is a length-prefixed binary frame
//! rather than text.
//!
//! ```text
//!   nescope-shot --socket /tmp/nestri-screenshot.sock --watch --out shot.ppm
//!   nescope --screenshot-ipc /tmp/nestri-screenshot.sock -- <program>
//! ```
//!
//! Start this first. It waits for nescope to connect, then asks — once, or on
//! an interval with `--watch`.
//!
//! # Watching, and why it is the useful mode
//!
//! A client can take a long time to put anything on screen. Steam unpacks,
//! self-updates, verifies and starts a browser process before it shows a login
//! window at all, so a single capture almost always lands on nothing and says
//! so. Watching turns that into a story: nothing, then a window with no buffer,
//! then pixels.
//!
//! # Reading the answer
//!
//! The status is the whole diagnosis:
//!
//! - **ok** — pixels arrived; whatever is running presents an shm surface
//! - **no-surface** — no window is mapped at all
//! - **no-buffer** — windows exist but none has drawn anything readable yet.
//!   Normal while something is starting; suspicious if it persists
//! - **unreadable** — a surface exists but could not be read by any route:
//!   not as shm, and importing it from the GPU failed as well. This is a bug
//!   rather than a limitation, and nescope's own log carries the reason
//!
//! PPM is written rather than PNG so this tool needs no image dependency. Any
//! viewer opens it, and `magick shot.ppm shot.png` converts it.

// Included by path rather than duplicated, so the tool and the compositor
// cannot drift apart on the wire format. Most of the module is the
// compositor's half and unused here, which is expected rather than a problem.
#[path = "../screenshot_wire.rs"]
#[allow(dead_code)]
mod screenshot_wire;

use std::io::{Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::time::{Duration, Instant};

use screenshot_wire::{REQUEST_CAPTURE, Status};

fn status_from(byte: u8) -> Option<Status> {
    match byte {
        0 => Some(Status::Ok),
        1 => Some(Status::NoSurface),
        2 => Some(Status::Unreadable),
        3 => Some(Status::NoBuffer),
        _ => None,
    }
}

/// What to tell somebody staring at the result.
fn explain(status: Status) -> &'static str {
    match status {
        Status::Ok => "a surface was read",
        Status::NoSurface => "no window is mapped at all",
        Status::NoBuffer => {
            "windows exist but none has drawn anything readable yet — normal while something \
             is starting, suspicious if it persists"
        }
        Status::Unreadable => {
            "a surface exists but could not be read by any route — not as shm, and importing \
             it from the GPU failed too. nescope's own log says why"
        }
    }
}

struct Args {
    socket: String,
    out: Option<String>,
    watch: bool,
    interval: Duration,
    keep: usize,
}

fn parse_args() -> Args {
    let mut args = Args {
        socket: "/tmp/nestri-screenshot.sock".to_string(),
        out: None,
        watch: false,
        interval: Duration::from_millis(1000),
        keep: 5,
    };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--socket" | "-s" => args.socket = it.next().unwrap_or(args.socket),
            "--out" | "-o" => args.out = it.next(),
            "--watch" | "-w" => args.watch = true,
            "--interval" => {
                args.interval = it
                    .next()
                    .and_then(|v| v.parse().ok())
                    .map(Duration::from_millis)
                    .unwrap_or(args.interval)
            }
            "--keep" => args.keep = it.next().and_then(|v| v.parse().ok()).unwrap_or(args.keep),
            "--help" | "-h" => {
                println!("nescope-shot [OPTIONS]");
                println!();
                println!("  -s, --socket PATH   socket to listen on");
                println!("  -o, --out FILE.ppm  write the capture here");
                println!("  -w, --watch         keep capturing until Ctrl-C");
                println!("      --interval MS   how often to capture when watching (1000)");
                println!("      --keep N        rolling files to keep when watching (5)");
                println!();
                println!("Start this before nescope; nescope connects to it.");
                std::process::exit(0);
            }
            other => {
                eprintln!("unknown argument {other:?}; try --help");
                std::process::exit(2);
            }
        }
    }
    args
}

/// `shot.ppm` + 2 -> `shot-2.ppm`, so the files sort next to each other.
fn numbered(path: &str, n: usize) -> String {
    match path.rsplit_once('.') {
        Some((stem, ext)) => format!("{stem}-{n}.{ext}"),
        None => format!("{path}-{n}"),
    }
}

fn write_ppm(path: &str, width: u32, height: u32, rgba: &[u8]) -> std::io::Result<()> {
    let mut ppm = Vec::with_capacity(rgba.len() / 4 * 3 + 32);
    ppm.extend_from_slice(format!("P6\n{width} {height}\n255\n").as_bytes());
    for px in rgba.chunks_exact(4) {
        ppm.extend_from_slice(&px[..3]);
    }
    std::fs::write(path, ppm)
}

/// One request and its reply. `None` means the connection ended.
fn capture(stream: &mut UnixStream) -> std::io::Result<Option<(Status, u32, u32, Vec<u8>)>> {
    if stream.write_all(&[REQUEST_CAPTURE]).is_err() {
        return Ok(None);
    }
    let mut header = [0u8; 9];
    if stream.read_exact(&mut header).is_err() {
        return Ok(None);
    }
    let Some(status) = status_from(header[0]) else {
        eprintln!("unknown status byte {:#x} — version mismatch?", header[0]);
        std::process::exit(1);
    };
    let width = u32::from_le_bytes(header[1..5].try_into().unwrap());
    let height = u32::from_le_bytes(header[5..9].try_into().unwrap());
    let mut rgba = vec![0u8; (width as usize) * (height as usize) * 4];
    if !rgba.is_empty() {
        stream.read_exact(&mut rgba)?;
    }
    Ok(Some((status, width, height, rgba)))
}

fn main() -> std::io::Result<()> {
    let args = parse_args();

    // A stale socket file from a previous run makes bind fail with EADDRINUSE,
    // which reads as "something is already listening" when nothing is.
    let _ = std::fs::remove_file(&args.socket);
    let listener = UnixListener::bind(&args.socket)?;
    eprintln!(
        "listening on {} — start nescope with --screenshot-ipc {}",
        args.socket, args.socket
    );

    let (mut stream, _) = listener.accept()?;
    eprintln!("nescope connected; requesting a capture");

    let started = Instant::now();
    let mut frame = 0usize;
    let mut last_report: Option<(Status, u32, u32)> = None;
    // Something unchanging still has to say it is alive. Watching a client
    // that never maps a window otherwise prints one line and then looks hung,
    // which is indistinguishable from the tool having died -- and sends you
    // looking at the wrong thing.
    let mut last_line = Instant::now();
    let heartbeat = Duration::from_secs(15);

    loop {
        let Some((status, width, height, rgba)) = capture(&mut stream)? else {
            eprintln!("nescope disconnected");
            return Ok(());
        };

        // In watch mode only changes are worth a line — a status printed once a
        // second for two minutes buries the moment it changed, which is the
        // only thing being watched for.
        let now = (status, width, height);
        let changed = last_report != Some(now);
        let due = last_line.elapsed() >= heartbeat;
        if changed || due || !args.watch {
            let at = started.elapsed().as_secs_f32();
            let still = if changed { "" } else { " (still)" };
            println!("[{at:6.1}s] {status:?}{still} — {}", explain(status));
            if status == Status::Ok {
                println!("          size: {width}x{height}");
            }
            last_report = Some(now);
            last_line = Instant::now();
        }

        if status == Status::Ok && !rgba.is_empty() {
            if let Some(out) = &args.out {
                let path = if args.watch {
                    numbered(out, frame % args.keep.max(1))
                } else {
                    out.clone()
                };
                write_ppm(&path, width, height, &rgba)?;
                if changed || !args.watch {
                    println!("          wrote {path}");
                }
            } else if changed || !args.watch {
                // A fully uniform image is the signature of "mapped but never
                // drew anything", which looks identical to a working capture
                // until somebody checks.
                let first = &rgba[..4.min(rgba.len())];
                let uniform = rgba.chunks_exact(4).all(|px| px == first);
                println!(
                    "          first pixel RGBA: {first:02x?}{}",
                    if uniform {
                        "  (every pixel identical — the window is blank)"
                    } else {
                        ""
                    }
                );
            }
            frame += 1;
        }

        if !args.watch {
            // Non-zero for anything but a real capture, so a script can ask
            // whether the path works at all.
            std::process::exit(if status == Status::Ok { 0 } else { 1 });
        }
        std::thread::sleep(args.interval);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rolling_names_sort_beside_the_original() {
        assert_eq!(numbered("shot.ppm", 3), "shot-3.ppm");
        assert_eq!(numbered("/tmp/a/shot.ppm", 0), "/tmp/a/shot-0.ppm");
        // No extension is not an error; the number still has to land somewhere.
        assert_eq!(numbered("shot", 2), "shot-2");
    }

    #[test]
    fn every_status_byte_maps_back() {
        // The tool and the compositor share this file, so a status added on one
        // side without the other would otherwise surface as "version mismatch"
        // against a peer of exactly the same version.
        for (byte, expected) in [
            (0, Status::Ok),
            (1, Status::NoSurface),
            (2, Status::Unreadable),
            (3, Status::NoBuffer),
        ] {
            assert_eq!(status_from(byte), Some(expected), "byte {byte}");
            assert_eq!(expected as u8, byte, "{expected:?} encodes as {byte}");
        }
        assert_eq!(status_from(9), None);
    }
}
