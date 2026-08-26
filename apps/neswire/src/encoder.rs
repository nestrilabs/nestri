use anyhow::{Result, bail};
use crossbeam_channel::Receiver;
use opus_head_sys::*;
use std::os::unix::net::UnixDatagram;
use std::time::Instant;

use nesprotocol::{CODEC_OPUS, STREAM_AUDIO, encode_ipc_frame};

pub struct EncoderConfig {
    pub channels: u32,
    pub sample_rate: u32,
    pub frame_size: u32,
    pub ipc_path: String,
    pub bitrate_per_channel: u32,
}

struct MsEncoder {
    ptr: *mut OpusMSEncoder,
}
impl MsEncoder {
    fn create_surround(config: &EncoderConfig) -> Result<Self> {
        let mut error: i32 = 0;
        let mut streams: i32 = 0;
        let mut coupled_streams: i32 = 0;
        let mut mapping = [0u8; 255];

        let mapping_family = if config.channels > 2 { 1 } else { 0 };

        let encoder = unsafe {
            opus_multistream_surround_encoder_create(
                config.sample_rate as i32,
                config.channels as i32,
                mapping_family,
                &mut streams,
                &mut coupled_streams,
                mapping.as_mut_ptr(),
                OPUS_APPLICATION_AUDIO as i32,
                &mut error,
            )
        };

        if error != OPUS_OK as i32 || encoder.is_null() {
            bail!(
                "opus_multistream_surround_encoder_create failed: {}",
                opus_error(error)
            );
        }

        tracing::info!(
            "opus multistream mapping: streams={}, coupled={}, mapping={:?}",
            streams,
            coupled_streams,
            &mapping[..config.channels as usize],
        );

        let bitrate = (config.bitrate_per_channel * config.channels) * 1000;

        let ret = unsafe {
            opus_multistream_encoder_ctl(encoder, OPUS_SET_BITRATE_REQUEST as i32, bitrate)
        };
        if ret != OPUS_OK as i32 {
            unsafe { opus_multistream_encoder_destroy(encoder) };
            bail!("failed to set bitrate: {}", opus_error(ret));
        }

        tracing::info!("opus bitrate: {}kbps", bitrate / 1000);

        let ret = unsafe {
            opus_multistream_encoder_ctl(encoder, OPUS_SET_COMPLEXITY_REQUEST as i32, 10 as i32)
        };
        if ret != OPUS_OK as i32 {
            unsafe { opus_multistream_encoder_destroy(encoder) };
            bail!("failed to set complexity: {}", opus_error(ret));
        }

        tracing::info!("opus complexity set to 10 (max quality)");

        let ret = unsafe {
            opus_multistream_encoder_ctl(
                encoder,
                OPUS_SET_SIGNAL_REQUEST as i32,
                OPUS_SIGNAL_MUSIC as i32,
            )
        };
        if ret != OPUS_OK as i32 {
            unsafe { opus_multistream_encoder_destroy(encoder) };
            bail!("failed to set signal type: {}", opus_error(ret));
        }

        tracing::info!("opus signal type set to MUSIC");

        Ok(Self { ptr: encoder })
    }

    fn encode_float(&self, pcm: &[f32], frame_size: u32, output: &mut [u8]) -> Result<usize> {
        let ret = unsafe {
            opus_multistream_encode_float(
                self.ptr,
                pcm.as_ptr(),
                frame_size as i32,
                output.as_mut_ptr(),
                output.len() as i32,
            )
        };

        if ret < 0 {
            bail!("opus encode failed: {}", opus_error(ret));
        }

        Ok(ret as usize)
    }
}
impl Drop for MsEncoder {
    fn drop(&mut self) {
        unsafe {
            opus_multistream_encoder_destroy(self.ptr);
        }
    }
}

fn opus_error(code: i32) -> String {
    unsafe {
        let ptr = opus_strerror(code);
        if ptr.is_null() {
            format!("unknown error {}", code)
        } else {
            std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned()
        }
    }
}

fn send_frame(
    encoder: &MsEncoder,
    socket: &UnixDatagram,
    config: &EncoderConfig,
    frame: &[f32],
    start: &Instant,
    opus_buf: &mut Vec<u8>,
) -> Result<()> {
    let encoded_len = encoder.encode_float(frame, config.frame_size, opus_buf)?;
    let encoded_data = &opus_buf[..encoded_len];
    let timestamp_ms = start.elapsed().as_millis() as u32;
    let ipc_frame = encode_ipc_frame(
        STREAM_AUDIO,
        CODEC_OPUS,
        0,
        timestamp_ms,
        0,
        0,
        encoded_data,
    );
    socket.send(&ipc_frame)?;
    Ok(())
}

pub fn run(config: EncoderConfig, rx: Receiver<Vec<f32>>) -> Result<()> {
    tracing::info!(
        "encoder started — IPC {}, {}ch, {} samples/frame",
        config.ipc_path,
        config.channels,
        config.frame_size,
    );

    let socket = UnixDatagram::unbound()?;
    let encoder = MsEncoder::create_surround(&config)?;

    let mut opus_buf = vec![0u8; 4000];
    let start = Instant::now();

    // Connect to hub with retry
    loop {
        match socket.connect(&config.ipc_path) {
            Ok(()) => {
                tracing::info!("IPC connected to {}", config.ipc_path);
                break;
            }
            Err(e) => {
                tracing::warn!(
                    "IPC connect to {} failed (retrying in 2s): {e}",
                    config.ipc_path
                );
                std::thread::sleep(std::time::Duration::from_secs(2));
            }
        }
    }

    // Send loop
    while let Ok(frame) = rx.recv() {
        send_frame(&encoder, &socket, &config, &frame, &start, &mut opus_buf)?;
    }

    tracing::info!("encoder shut down");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use nesprotocol::decode_ipc_frame;
    use std::os::unix::net::UnixDatagram;

    const SAMPLE_RATE: u32 = 48_000;
    const CHANNELS: u32 = 2;
    /// 5ms, the default. 240 samples per channel.
    const FRAME_SIZE: u32 = 240;

    fn config(ipc_path: &str) -> EncoderConfig {
        EncoderConfig {
            channels: CHANNELS,
            sample_rate: SAMPLE_RATE,
            frame_size: FRAME_SIZE,
            ipc_path: ipc_path.to_string(),
            bitrate_per_channel: 64,
        }
    }

    fn silence() -> Vec<f32> {
        vec![0.0; (FRAME_SIZE * CHANNELS) as usize]
    }

    /// One frame of a 440Hz tone, interleaved stereo, starting at `frame_index`
    /// so consecutive frames form a continuous wave rather than restarting.
    fn tone(frame_index: usize) -> Vec<f32> {
        let start = frame_index * FRAME_SIZE as usize;
        (0..FRAME_SIZE as usize)
            .flat_map(|i| {
                let t = (start + i) as f32 / SAMPLE_RATE as f32;
                let v = (t * 440.0 * std::f32::consts::TAU).sin() * 0.5;
                [v, v]
            })
            .collect()
    }

    /// The decoder the hub's client ends up using, in miniature: same
    /// parameters the desktop app builds for stereo.
    struct Decoder(*mut OpusMSDecoder);

    impl Decoder {
        fn new() -> Self {
            let mut error = 0i32;
            let mapping = [0u8, 1];
            let ptr = unsafe {
                opus_multistream_decoder_create(
                    SAMPLE_RATE as i32,
                    CHANNELS as i32,
                    1,
                    1,
                    mapping.as_ptr(),
                    &mut error,
                )
            };
            assert_eq!(error, OPUS_OK as i32, "decoder create failed");
            Self(ptr)
        }

        fn decode(&self, packet: &[u8]) -> Vec<f32> {
            let mut pcm = vec![0f32; (FRAME_SIZE * CHANNELS) as usize];
            let n = unsafe {
                opus_multistream_decode_float(
                    self.0,
                    packet.as_ptr(),
                    packet.len() as i32,
                    pcm.as_mut_ptr(),
                    FRAME_SIZE as i32,
                    0,
                )
            };
            assert!(n > 0, "decode failed: {n}");
            pcm.truncate(n as usize * CHANNELS as usize);
            pcm
        }
    }

    impl Drop for Decoder {
        fn drop(&mut self) {
            unsafe { opus_multistream_decoder_destroy(self.0) };
        }
    }

    fn peak(pcm: &[f32]) -> f32 {
        pcm.iter().fold(0f32, |acc, s| acc.max(s.abs()))
    }

    /// Silence is nearly free to encode, and that is a trap worth pinning down.
    ///
    /// The configured bitrate is a ceiling, not a floor. At 200 packets a second
    /// these two-byte packets come to roughly 3kbps of perfectly valid,
    /// perfectly silent Opus — which looks, to every byte counter downstream,
    /// like a working stream. A whole debugging session was spent on the
    /// difference. If this test starts failing because silence got expensive,
    /// that reasoning needs revisiting.
    #[test]
    fn silence_costs_almost_nothing_to_encode() {
        let config = config("/nonexistent");
        let encoder = MsEncoder::create_surround(&config).expect("encoder");
        let mut buf = vec![0u8; 4000];

        // Past the encoder's warm-up, where the first packets are larger.
        for _ in 0..10 {
            encoder
                .encode_float(&silence(), FRAME_SIZE, &mut buf)
                .expect("encode");
        }

        let len = encoder
            .encode_float(&silence(), FRAME_SIZE, &mut buf)
            .expect("encode");
        assert!(
            len <= 8,
            "silence took {len} bytes; the ~3kbps silent-stream signature no \
             longer holds and the diagnostics that rely on it are wrong"
        );
    }

    /// The other half of the above: real audio must cost real bytes, or the
    /// test before this one would pass on a permanently broken encoder.
    #[test]
    fn a_tone_costs_far_more_than_silence() {
        let config = config("/nonexistent");
        // One encoder each. Opus codes a stream, not isolated frames, so
        // feeding both signals to one encoder makes every "silent" frame the
        // tail of a tone and costs it accordingly -- which is a measurement of
        // nothing.
        let quiet_encoder = MsEncoder::create_surround(&config).expect("encoder");
        let loud_encoder = MsEncoder::create_surround(&config).expect("encoder");
        let mut buf = vec![0u8; 4000];

        let mut quiet = 0;
        let mut loud = 0;
        for i in 0..40 {
            quiet += quiet_encoder
                .encode_float(&silence(), FRAME_SIZE, &mut buf)
                .expect("encode");
            loud += loud_encoder
                .encode_float(&tone(i), FRAME_SIZE, &mut buf)
                .expect("encode");
        }

        assert!(
            loud > quiet * 4,
            "a tone encoded to {loud} bytes against {quiet} for silence; the \
             encoder is not responding to its input"
        );
    }

    /// A tone goes in and comes back out, through the exact encoder the guest
    /// runs and the exact decoder parameters the desktop client builds.
    ///
    /// This is the one that would have caught a channel-mapping or sample-rate
    /// disagreement between the two ends, which no byte count can see.
    #[test]
    fn a_tone_survives_the_round_trip() {
        let config = config("/nonexistent");
        let encoder = MsEncoder::create_surround(&config).expect("encoder");
        let decoder = Decoder::new();
        let mut buf = vec![0u8; 4000];

        // Opus needs a few frames before its output is representative, so the
        // assertion is on the tail rather than the first packet.
        let mut last = Vec::new();
        for i in 0..40 {
            let len = encoder
                .encode_float(&tone(i), FRAME_SIZE, &mut buf)
                .expect("encode");
            last = decoder.decode(&buf[..len]);
        }

        assert_eq!(
            last.len(),
            (FRAME_SIZE * CHANNELS) as usize,
            "decoded frame is the wrong length"
        );
        assert!(
            peak(&last) > 0.1,
            "a 0.5-amplitude tone decoded to a peak of {:.4}",
            peak(&last)
        );
    }

    /// What actually crosses the socket is what the hub knows how to read.
    ///
    /// The hub rejects any frame whose stream type is not `STREAM_AUDIO` or
    /// whose codec is not `CODEC_OPUS`, and drops it with a warning nobody
    /// reads. This asserts the contract from the sending side.
    #[test]
    fn the_hub_receives_a_frame_it_can_parse() {
        let path = std::env::temp_dir().join(format!(
            "neswire-test-{}-{}.sock",
            std::process::id(),
            line!()
        ));
        let _ = std::fs::remove_file(&path);

        // Bound first: the hub binds and neswire connects, so a test that did
        // this the other way round would not be testing the real sequence.
        let listener = UnixDatagram::bind(&path).expect("bind");
        let sender = UnixDatagram::unbound().expect("socket");
        sender.connect(&path).expect("connect");

        let config = config(path.to_str().expect("utf-8 path"));
        let encoder = MsEncoder::create_surround(&config).expect("encoder");
        let start = Instant::now();
        let mut opus_buf = vec![0u8; 4000];

        send_frame(&encoder, &sender, &config, &tone(0), &start, &mut opus_buf)
            .expect("send");

        let mut buf = vec![0u8; 65536];
        let n = listener.recv(&mut buf).expect("recv");
        let frame = decode_ipc_frame(&buf[..n]).expect("hub could not parse the frame");

        assert_eq!(frame.stream_type, STREAM_AUDIO);
        assert_eq!(frame.codec, CODEC_OPUS);
        assert!(!frame.data.is_empty(), "frame carried no payload");

        // And the payload is Opus the far end can actually decode.
        Decoder::new().decode(frame.data);

        let _ = std::fs::remove_file(&path);
    }
}
