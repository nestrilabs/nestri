use crate::args::encoding_args::AudioCaptureMethod;
use crate::enc_helper::{AudioCodec, EncoderType, VideoCodec};
use clap::builder::TypedValueParser;
use clap::builder::{BoolishValueParser, NonEmptyStringValueParser};
use clap::{Arg, Command, value_parser};

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
                    .value_parser(BoolishValueParser::new())
                    .default_value("false"),
            )
            .arg(
                Arg::new("relay-url")
                    .short('u')
                    .long("relay-url")
                    .env("RELAY_URL")
                    .value_parser(NonEmptyStringValueParser::new())
                    .help("Nestri relay URL"),
            )
            .arg(
                Arg::new("resolution")
                    .short('r')
                    .long("resolution")
                    .env("RESOLUTION")
                    .help("Display/stream resolution in 'WxH' format")
                    .value_parser(NonEmptyStringValueParser::new())
                    .default_value("1280x720"),
            )
            .arg(
                Arg::new("framerate")
                    .short('f')
                    .long("framerate")
                    .env("FRAMERATE")
                    .help("Display/stream framerate")
                    .value_parser(value_parser!(u32).range(5..240))
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
                    .help("GPU to use by vendor")
                    .required(false),
            )
            .arg(
                Arg::new("gpu-name")
                    .short('n')
                    .long("gpu-name")
                    .env("GPU_NAME")
                    .help("GPU to use by name")
                    .required(false),
            )
            .arg(
                Arg::new("gpu-index")
                    .short('i')
                    .long("gpu-index")
                    .env("GPU_INDEX")
                    .help("GPU to use by index")
                    .value_parser(value_parser!(u32).range(0..))
                    .required(false),
            )
            .arg(
                Arg::new("gpu-card-path")
                    .long("gpu-card-path")
                    .env("GPU_CARD_PATH")
                    .help("Force a specific GPU by /dev/dri/ card or render path")
                    .required(false)
                    .conflicts_with_all(["gpu-vendor", "gpu-name", "gpu-index"]),
            )
            .arg(
                Arg::new("video-codec")
                    .short('c')
                    .long("video-codec")
                    .env("VIDEO_CODEC")
                    .help("Preferred video codec")
                    .value_parser(value_parser!(VideoCodec))
                    .default_value("h264"),
            )
            .arg(
                Arg::new("video-encoder")
                    .long("video-encoder")
                    .env("VIDEO_ENCODER")
                    .help("Override video encoder"),
            )
            .arg(
                Arg::new("video-rate-control")
                    .long("video-rate-control")
                    .env("VIDEO_RATE_CONTROL")
                    .help("Rate control method")
                    .value_parser(value_parser!(encoding_args::RateControlMethod))
                    .default_value("cbr"),
            )
            .arg(
                Arg::new("video-cqp")
                    .long("video-cqp")
                    .env("VIDEO_CQP")
                    .help("Constant Quantization Parameter (CQP) quality")
                    .value_parser(value_parser!(u32).range(1..51))
                    .default_value("26"),
            )
            .arg(
                Arg::new("video-bitrate")
                    .long("video-bitrate")
                    .env("VIDEO_BITRATE")
                    .help("Target bitrate in kbps")
                    .value_parser(value_parser!(u32).range(1..))
                    .default_value("6000"),
            )
            .arg(
                Arg::new("video-bitrate-max")
                    .long("video-bitrate-max")
                    .env("VIDEO_BITRATE_MAX")
                    .help("Maximum bitrate in kbps")
                    .value_parser(value_parser!(u32).range(1..))
                    .default_value("8000"),
            )
            .arg(
                Arg::new("video-encoder-type")
                    .long("video-encoder-type")
                    .env("VIDEO_ENCODER_TYPE")
                    .help("Encoder type")
                    .value_parser(value_parser!(EncoderType))
                    .default_value("hardware"),
            )
            .arg(
                Arg::new("video-bit-depth")
                    .long("video-bit-depth")
                    .env("VIDEO_BIT_DEPTH")
                    .help("Video bit depth (8 or 10), only with DMA-BUF and non-H264 codec")
                    .value_parser(
                        clap::builder::PossibleValuesParser::new(["8", "10"])
                            .map(|s| s.parse::<u32>().unwrap()),
                    )
                    .default_value("8"),
            )
            .arg(
                Arg::new("audio-capture-method")
                    .long("audio-capture-method")
                    .env("AUDIO_CAPTURE_METHOD")
                    .help("Audio capture method")
                    .value_parser(value_parser!(AudioCaptureMethod))
                    .default_value("pipewire"),
            )
            .arg(
                Arg::new("audio-codec")
                    .long("audio-codec")
                    .env("AUDIO_CODEC")
                    .help("Preferred audio codec")
                    .value_parser(value_parser!(AudioCodec))
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
                    .help("Rate control method")
                    .value_parser(value_parser!(encoding_args::RateControlMethod))
                    .default_value("cbr"),
            )
            .arg(
                Arg::new("audio-bitrate")
                    .long("audio-bitrate")
                    .env("AUDIO_BITRATE")
                    .help("Target bitrate in kbps")
                    .value_parser(value_parser!(u32).range(1..))
                    .default_value("128"),
            )
            .arg(
                Arg::new("audio-bitrate-max")
                    .long("audio-bitrate-max")
                    .env("AUDIO_BITRATE_MAX")
                    .help("Maximum bitrate in kbps")
                    .value_parser(value_parser!(u32).range(1..))
                    .default_value("192"),
            )
            .arg(
                Arg::new("dma-buf")
                    .long("dma-buf")
                    .env("DMA_BUF")
                    .help("Use DMA-BUF for pipeline")
                    .value_parser(BoolishValueParser::new())
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
