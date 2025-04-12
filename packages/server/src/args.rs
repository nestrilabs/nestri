use clap::{Arg, Command};

pub mod app_args;
pub mod device_args;
pub mod encoding_args;

pub struct Args {
    pub app: app_args::AppArgs,
    pub device: device_args::DeviceArgs,
    pub encoding: encoding_args::EncodingArgs,
}

impl Args {
    pub fn new() -> Self {
        let matches = Command::new("nestri-server")
            .arg(
                Arg::new("verbose")
                    .short('v')
                    .long("verbose")
                    .env("VERBOSE")
                    .help("Enable verbose output")
                    .default_value("false"),
            )
            .arg(
                Arg::new("debug")
                    .short('d')
                    .long("debug")
                    .env("DEBUG")
                    .help("Enable additional debugging information and features")
                    .default_value("false"),
            )
            .arg(
                Arg::new("relay-url")
                    .short('u')
                    .long("relay-url")
                    .env("RELAY_URL")
                    .help("Nestri relay URL"),
            )
            .arg(
                Arg::new("resolution")
                    .short('r')
                    .long("resolution")
                    .env("RESOLUTION")
                    .help("Display/stream resolution in 'WxH' format")
                    .default_value("1280x720"),
            )
            .arg(
                Arg::new("framerate")
                    .short('f')
                    .long("framerate")
                    .env("FRAMERATE")
                    .help("Display/stream framerate")
                    .default_value("60"),
            )
            .arg(
                Arg::new("room")
                    .long("room")
                    .env("NESTRI_ROOM")
                    .help("Nestri room name/identifier"),
            )
            .arg(
                Arg::new("gpu-vendor")
                    .short('g')
                    .long("gpu-vendor")
                    .env("GPU_VENDOR")
                    .help("GPU to find by vendor (e.g. 'nvidia')")
                    .required(false),
            )
            .arg(
                Arg::new("gpu-name")
                    .short('n')
                    .long("gpu-name")
                    .env("GPU_NAME")
                    .help("GPU to find by name (e.g. 'rtx 3060')")
                    .required(false),
            )
            .arg(
                Arg::new("gpu-index")
                    .short('i')
                    .long("gpu-index")
                    .env("GPU_INDEX")
                    .help("GPU index, if multiple similar GPUs are present")
                    .default_value("0"),
            )
            .arg(
                Arg::new("gpu-card-path")
                    .long("gpu-card-path")
                    .env("GPU_CARD_PATH")
                    .help("Force a specific GPU by card/render path (e.g. '/dev/dri/card0')")
                    .required(false)
                    .conflicts_with_all(["gpu-vendor", "gpu-name", "gpu-index"]),
            )
            .arg(
                Arg::new("video-codec")
                    .short('c')
                    .long("video-codec")
                    .env("VIDEO_CODEC")
                    .help("Preferred video codec ('h264', 'h265', 'av1')")
                    .default_value("h264"),
            )
            .arg(
                Arg::new("video-encoder")
                    .long("video-encoder")
                    .env("VIDEO_ENCODER")
                    .help("Override video encoder (e.g. 'vah264enc')"),
            )
            .arg(
                Arg::new("video-rate-control")
                    .long("video-rate-control")
                    .env("VIDEO_RATE_CONTROL")
                    .help("Rate control method ('cqp', 'vbr', 'cbr')")
                    .default_value("vbr"),
            )
            .arg(
                Arg::new("video-cqp")
                    .long("video-cqp")
                    .env("VIDEO_CQP")
                    .help("Constant Quantization Parameter (CQP) quality")
                    .default_value("26"),
            )
            .arg(
                Arg::new("video-bitrate")
                    .long("video-bitrate")
                    .env("VIDEO_BITRATE")
                    .help("Target bitrate in kbps")
                    .default_value("6000"),
            )
            .arg(
                Arg::new("video-bitrate-max")
                    .long("video-bitrate-max")
                    .env("VIDEO_BITRATE_MAX")
                    .help("Maximum bitrate in kbps")
                    .default_value("8000"),
            )
            .arg(
                Arg::new("video-encoder-type")
                    .long("video-encoder-type")
                    .env("VIDEO_ENCODER_TYPE")
                    .help("Encoder type ('hardware', 'software')")
                    .default_value("hardware"),
            )
            .arg(
                Arg::new("audio-capture-method")
                    .long("audio-capture-method")
                    .env("AUDIO_CAPTURE_METHOD")
                    .help("Audio capture method ('pipewire', 'pulseaudio', 'alsa')")
                    .default_value("pulseaudio"),
            )
            .arg(
                Arg::new("audio-codec")
                    .long("audio-codec")
                    .env("AUDIO_CODEC")
                    .help("Preferred audio codec ('opus', 'aac')")
                    .default_value("opus"),
            )
            .arg(
                Arg::new("audio-encoder")
                    .long("audio-encoder")
                    .env("AUDIO_ENCODER")
                    .help("Override audio encoder (e.g. 'opusenc')"),
            )
            .arg(
                Arg::new("audio-rate-control")
                    .long("audio-rate-control")
                    .env("AUDIO_RATE_CONTROL")
                    .help("Rate control method ('cqp', 'vbr', 'cbr')")
                    .default_value("vbr"),
            )
            .arg(
                Arg::new("audio-bitrate")
                    .long("audio-bitrate")
                    .env("AUDIO_BITRATE")
                    .help("Target bitrate in kbps")
                    .default_value("128"),
            )
            .arg(
                Arg::new("audio-bitrate-max")
                    .long("audio-bitrate-max")
                    .env("AUDIO_BITRATE_MAX")
                    .help("Maximum bitrate in kbps")
                    .default_value("192"),
            )
            .arg(
                Arg::new("dma-buf")
                    .long("dma-buf")
                    .env("DMA_BUF")
                    .help("Use DMA-BUF for pipeline")
                    .default_value("false"),
            )
            .get_matches();

        Self {
            app: app_args::AppArgs::from_matches(&matches),
            device: device_args::DeviceArgs::from_matches(&matches),
            encoding: encoding_args::EncodingArgs::from_matches(&matches),
        }
    }

    pub fn debug_print(&self) {
        self.app.debug_print();
        self.device.debug_print();
        self.encoding.debug_print();
    }
}
