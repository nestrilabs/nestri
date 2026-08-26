//! A stand-in for neshub's audio IPC listener.
//!
//! neswire's only output is a Unix datagram socket that the hub binds, so
//! running it outside a guest means having nothing to talk to: it retries
//! `connect` forever and there is no way to see what it would have sent. This
//! binds that socket and reports what arrives.
//!
//! It decodes the Opus rather than only counting bytes, because byte counts
//! cannot tell the two interesting failures apart. Opus codes digital silence
//! in about two bytes a packet, so a sink receiving nothing but zeros still
//! produces a steady ~3 kbps and looks, from every meter downstream, exactly
//! like one that is working. Peak amplitude is what distinguishes them.
//!
//! Mirrors `ipc_listener::run_audio_listener` in the hub: same bind, same 0o666,
//! same stream-type and codec checks. Where it differs from the hub, the hub is
//! right and this should be corrected.

use std::os::unix::net::UnixDatagram;
use std::time::{Duration, Instant};

use anyhow::{Result, bail};
use clap::Parser;
use opus_head_sys::*;

use nesprotocol::{CODEC_OPUS, STREAM_AUDIO, decode_ipc_frame};

#[derive(Parser, Debug)]
#[command(about = "Receive and measure neswire's audio IPC stream")]
struct Args {
    /// Path to bind, matching neswire's --ipc-path.
    #[arg(long, default_value = "/tmp/nestri-audio.sock")]
    ipc_path: String,

    /// Channels neswire is configured for. The decoder has to agree with the
    /// encoder; a mismatch here reads as garbage, not as an error.
    #[arg(long, default_value_t = 2)]
    channels: u32,

    /// How often to print a line.
    #[arg(long, default_value_t = 1.0)]
    interval_secs: f64,
}

struct MsDecoder {
    ptr: *mut OpusMSDecoder,
    channels: usize,
}

impl MsDecoder {
    /// Built to match `MsEncoder::create_surround` for the same channel count:
    /// stereo is mapping family 0, one stream, one coupled pair.
    fn new(sample_rate: u32, channels: u32) -> Result<Self> {
        let (streams, coupled, mapping): (i32, i32, Vec<u8>) = match channels {
            2 => (1, 1, vec![0, 1]),
            6 => (4, 2, vec![0, 4, 1, 2, 3, 5]),
            8 => (5, 3, vec![0, 6, 1, 2, 3, 4, 5, 7]),
            n => bail!("unsupported channel count: {n}"),
        };

        let mut error: i32 = 0;
        let ptr = unsafe {
            opus_multistream_decoder_create(
                sample_rate as i32,
                channels as i32,
                streams,
                coupled,
                mapping.as_ptr(),
                &mut error,
            )
        };
        if error != OPUS_OK as i32 || ptr.is_null() {
            bail!("opus_multistream_decoder_create failed: {error}");
        }
        Ok(Self {
            ptr,
            channels: channels as usize,
        })
    }

    /// Returns the decoded samples, interleaved.
    fn decode(&self, packet: &[u8], pcm: &mut [f32]) -> Result<usize> {
        let frame_size = (pcm.len() / self.channels) as i32;
        let decoded = unsafe {
            opus_multistream_decode_float(
                self.ptr,
                packet.as_ptr(),
                packet.len() as i32,
                pcm.as_mut_ptr(),
                frame_size,
                0,
            )
        };
        if decoded < 0 {
            bail!("opus decode failed: {decoded}");
        }
        Ok(decoded as usize * self.channels)
    }
}

impl Drop for MsDecoder {
    fn drop(&mut self) {
        unsafe { opus_multistream_decoder_destroy(self.ptr) };
    }
}

fn main() -> Result<()> {
    let args = Args::parse();

    // Same sequence as the hub: clear a stale socket, bind, widen the mode.
    // neswire runs as a different user there, and 0o666 is what makes that
    // work; keeping it here means this stub cannot pass a case the hub fails.
    let _ = std::fs::remove_file(&args.ipc_path);
    let socket = UnixDatagram::bind(&args.ipc_path)?;
    std::fs::set_permissions(
        &args.ipc_path,
        std::os::unix::fs::PermissionsExt::from_mode(0o666),
    )?;
    socket.set_read_timeout(Some(Duration::from_millis(200)))?;

    println!("listening on {}", args.ipc_path);
    println!("waiting for neswire...");

    let decoder = MsDecoder::new(48_000, args.channels)?;
    // 120ms at 48kHz is the largest frame Opus can produce, so nothing that
    // decodes at all can overrun this.
    let mut pcm = vec![0f32; 5760 * args.channels as usize];
    let mut buf = vec![0u8; 65536];

    let interval = Duration::from_secs_f64(args.interval_secs);
    let mut window_start = Instant::now();
    let mut packets = 0u64;
    let mut bytes = 0u64;
    let mut peak = 0f32;
    let mut samples = 0u64;
    let mut seen_anything = false;

    loop {
        match socket.recv(&mut buf) {
            Ok(n) => {
                let Some(frame) = decode_ipc_frame(&buf[..n]) else {
                    eprintln!("invalid IPC frame ({n} bytes)");
                    continue;
                };
                if frame.stream_type != STREAM_AUDIO {
                    eprintln!("unexpected stream type: {}", frame.stream_type);
                    continue;
                }
                if frame.codec != CODEC_OPUS {
                    eprintln!("unexpected codec: {}", frame.codec);
                    continue;
                }

                packets += 1;
                bytes += frame.data.len() as u64;
                seen_anything = true;

                match decoder.decode(frame.data, &mut pcm) {
                    Ok(count) => {
                        samples += count as u64;
                        for sample in &pcm[..count] {
                            peak = peak.max(sample.abs());
                        }
                    }
                    Err(e) => eprintln!("{e}"),
                }
            }
            Err(ref e)
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut => {}
            Err(e) => return Err(e.into()),
        }

        let elapsed = window_start.elapsed();
        if elapsed >= interval {
            let secs = elapsed.as_secs_f64();
            let kbps = bytes as f64 * 8.0 / 1000.0 / secs;

            if packets == 0 {
                println!(
                    "{}",
                    if seen_anything {
                        "no packets — neswire stopped sending"
                    } else {
                        "no packets yet"
                    }
                );
            } else if peak == 0.0 {
                println!(
                    "{packets:>4} pkt  {kbps:>6.1} kbps  {samples:>6} samples  \
                     SILENT — decodes cleanly, every sample is zero"
                );
            } else {
                println!(
                    "{packets:>4} pkt  {kbps:>6.1} kbps  {samples:>6} samples  peak {peak:.4}"
                );
            }

            window_start = Instant::now();
            packets = 0;
            bytes = 0;
            samples = 0;
            peak = 0.0;
        }
    }
}
