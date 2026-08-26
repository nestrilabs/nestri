mod encoder;
mod sink;

use clap::Parser;

#[derive(Parser, Debug)]
struct Args {
    /// Path for the audio IPC socket (neswire → neshub)
    #[arg(
        long,
        env = "NESWIRE_IPC_PATH",
        default_value = "/tmp/nestri-audio.sock"
    )]
    ipc_path: String,

    /// Output channels: 2, 6, or 8
    #[arg(long, env = "NESWIRE_CHANNELS", default_value_t = 2)]
    channels: u32,

    /// Packet duration in ms (5, 10..)
    #[arg(long, env = "NESWIRE_PACKET_DURATION_MS", default_value_t = 5)]
    packet_duration_ms: u32,

    /// Bitrate per channel in kbps
    #[arg(long, env = "NESWIRE_BITRATE_PER_CHANNEL", default_value_t = 64)]
    bitrate_per_channel: u32,
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let args = Args::parse();

    let sample_rate = 48_000u32;
    let frame_size = (sample_rate * args.packet_duration_ms) / 1000;

    let (tx, rx) = crossbeam_channel::bounded::<Vec<f32>>(256);

    let encoder_config = encoder::EncoderConfig {
        channels: args.channels,
        sample_rate,
        frame_size,
        ipc_path: args.ipc_path,
        bitrate_per_channel: args.bitrate_per_channel,
    };

    std::thread::spawn(move || {
        if let Err(e) = encoder::run(encoder_config, rx) {
            tracing::error!("encoder thread died: {e:#}");
        }
    });

    sink::run(sample_rate, args.channels, frame_size, tx)?;

    Ok(())
}
