use std::ops::Deref;

#[derive(Debug, PartialEq, Eq, Clone)]
pub struct RateControlCQP {
    /// Constant Quantization Parameter (CQP) quality level
    pub quality: u32,
}
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct RateControlVBR {
    /// Target bitrate in kbps
    pub target_bitrate: i32,
    /// Maximum bitrate in kbps
    pub max_bitrate: i32,
}
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct RateControlCBR {
    /// Target bitrate in kbps
    pub target_bitrate: i32,
}

#[derive(Debug, PartialEq, Eq, Clone)]
pub enum RateControl {
    /// Constant Quantization Parameter
    CQP(RateControlCQP),
    /// Variable Bitrate
    VBR(RateControlVBR),
    /// Constant Bitrate
    CBR(RateControlCBR),
}

pub struct EncodingOptionsBase {
    /// Codec (e.g. "h264", "opus" etc.)
    pub codec: String,
    /// Overridable encoder (e.g. "vah264lpenc", "opusenc" etc.)
    pub encoder: String,
    /// Rate control method (e.g. "cqp", "vbr", "cbr")
    pub rate_control: RateControl,
}
impl EncodingOptionsBase {
    pub fn debug_print(&self) {
        println!("> Codec: {}", self.codec);
        println!(
            "> Encoder: {}",
            if self.encoder.is_empty() {
                "Auto-Selection"
            } else {
                &self.encoder
            }
        );
        match &self.rate_control {
            RateControl::CQP(cqp) => {
                println!("> Rate Control: CQP");
                println!("-> Quality: {}", cqp.quality);
            }
            RateControl::VBR(vbr) => {
                println!("> Rate Control: VBR");
                println!("-> Target Bitrate: {}", vbr.target_bitrate);
                println!("-> Max Bitrate: {}", vbr.max_bitrate);
            }
            RateControl::CBR(cbr) => {
                println!("> Rate Control: CBR");
                println!("-> Target Bitrate: {}", cbr.target_bitrate);
            }
        }
    }
}

pub struct VideoEncodingOptions {
    pub base: EncodingOptionsBase,
    /// Encoder type (e.g. "hardware", "software")
    pub encoder_type: String,
}
impl VideoEncodingOptions {
    pub fn from_matches(matches: &clap::ArgMatches) -> Self {
        Self {
            base: EncodingOptionsBase {
                codec: matches.get_one::<String>("video-codec").unwrap().clone(),
                encoder: matches
                    .get_one::<String>("video-encoder")
                    .unwrap_or(&"".to_string())
                    .clone(),
                rate_control: match matches
                    .get_one::<String>("video-rate-control")
                    .unwrap()
                    .as_str()
                {
                    "cqp" => RateControl::CQP(RateControlCQP {
                        quality: matches
                            .get_one::<String>("video-cqp")
                            .unwrap()
                            .parse::<u32>()
                            .unwrap(),
                    }),
                    "cbr" => RateControl::CBR(RateControlCBR {
                        target_bitrate: matches
                            .get_one::<String>("video-bitrate")
                            .unwrap()
                            .parse::<i32>()
                            .unwrap(),
                    }),
                    "vbr" => RateControl::VBR(RateControlVBR {
                        target_bitrate: matches
                            .get_one::<String>("video-bitrate")
                            .unwrap()
                            .parse::<i32>()
                            .unwrap(),
                        max_bitrate: matches
                            .get_one::<String>("video-bitrate-max")
                            .unwrap()
                            .parse::<i32>()
                            .unwrap(),
                    }),
                    _ => panic!("Invalid rate control method for video"),
                },
            },
            encoder_type: matches
                .get_one::<String>("video-encoder-type")
                .unwrap_or(&"hardware".to_string())
                .clone(),
        }
    }

    pub fn debug_print(&self) {
        println!("Video Encoding Options:");
        self.base.debug_print();
        println!("> Encoder Type: {}", self.encoder_type);
    }
}
impl Deref for VideoEncodingOptions {
    type Target = EncodingOptionsBase;

    fn deref(&self) -> &Self::Target {
        &self.base
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum AudioCaptureMethod {
    PulseAudio,
    PipeWire,
    ALSA,
}
impl AudioCaptureMethod {
    pub fn as_str(&self) -> &str {
        match self {
            AudioCaptureMethod::PulseAudio => "pulseaudio",
            AudioCaptureMethod::PipeWire => "pipewire",
            AudioCaptureMethod::ALSA => "alsa",
        }
    }
}

pub struct AudioEncodingOptions {
    pub base: EncodingOptionsBase,
    pub capture_method: AudioCaptureMethod,
}
impl AudioEncodingOptions {
    pub fn from_matches(matches: &clap::ArgMatches) -> Self {
        Self {
            base: EncodingOptionsBase {
                codec: matches.get_one::<String>("audio-codec").unwrap().clone(),
                encoder: matches
                    .get_one::<String>("audio-encoder")
                    .unwrap_or(&"".to_string())
                    .clone(),
                rate_control: match matches
                    .get_one::<String>("audio-rate-control")
                    .unwrap()
                    .as_str()
                {
                    "cbr" => RateControl::CBR(RateControlCBR {
                        target_bitrate: matches
                            .get_one::<String>("audio-bitrate")
                            .unwrap()
                            .parse::<i32>()
                            .unwrap(),
                    }),
                    "vbr" => RateControl::VBR(RateControlVBR {
                        target_bitrate: matches
                            .get_one::<String>("audio-bitrate")
                            .unwrap()
                            .parse::<i32>()
                            .unwrap(),
                        max_bitrate: matches
                            .get_one::<String>("audio-bitrate-max")
                            .unwrap()
                            .parse::<i32>()
                            .unwrap(),
                    }),
                    _ => panic!("Invalid rate control method for audio"),
                },
            },
            capture_method: match matches
                .get_one::<String>("audio-capture-method")
                .unwrap()
                .as_str()
            {
                "pulseaudio" => AudioCaptureMethod::PulseAudio,
                "pipewire" => AudioCaptureMethod::PipeWire,
                "alsa" => AudioCaptureMethod::ALSA,
                // Default to PulseAudio
                _ => AudioCaptureMethod::PulseAudio,
            },
        }
    }

    pub fn debug_print(&self) {
        println!("Audio Encoding Options:");
        self.base.debug_print();
        println!("> Capture Method: {}", self.capture_method.as_str());
    }
}
impl Deref for AudioEncodingOptions {
    type Target = EncodingOptionsBase;

    fn deref(&self) -> &Self::Target {
        &self.base
    }
}

pub struct EncodingArgs {
    /// Video encoder options
    pub video: VideoEncodingOptions,
    /// Audio encoder options
    pub audio: AudioEncodingOptions,
}
impl EncodingArgs {
    pub fn from_matches(matches: &clap::ArgMatches) -> Self {
        Self {
            video: VideoEncodingOptions::from_matches(matches),
            audio: AudioEncodingOptions::from_matches(matches),
        }
    }

    pub fn debug_print(&self) {
        println!("Encoding Arguments:");
        self.video.debug_print();
        self.audio.debug_print();
    }
}
