use crate::args::encoding_args::RateControl;
use crate::gpu::{GPUInfo, GPUVendor, get_gpu_by_card_path, get_gpus_by_vendor};
use clap::ValueEnum;
use gstreamer::prelude::*;
use std::error::Error;
use std::str::FromStr;

#[derive(Debug, Eq, PartialEq, Clone, ValueEnum)]
pub enum AudioCodec {
    OPUS,
}
impl AudioCodec {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::OPUS => "Opus",
        }
    }
}
impl FromStr for AudioCodec {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "opus" => Ok(Self::OPUS),
            _ => Err(format!("Invalid audio codec: {}", s)),
        }
    }
}

#[derive(Debug, Eq, PartialEq, Clone, ValueEnum)]
pub enum VideoCodec {
    H264,
    H265,
    AV1,
}
impl VideoCodec {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::H264 => "H.264",
            Self::H265 => "H.265",
            Self::AV1 => "AV1",
        }
    }
}
impl FromStr for VideoCodec {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "h264" | "h.264" | "avc" => Ok(Self::H264),
            "h265" | "h.265" | "hevc" | "hev1" => Ok(Self::H265),
            "av1" => Ok(Self::AV1),
            _ => Err(format!("Invalid video codec: {}", s)),
        }
    }
}

#[derive(Debug, Eq, PartialEq, Clone)]
pub enum Codec {
    Audio(AudioCodec),
    Video(VideoCodec),
}
impl Codec {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Audio(codec) => codec.as_str(),
            Self::Video(codec) => codec.as_str(),
        }
    }
}

#[derive(Debug, Eq, PartialEq, Clone)]
pub enum EncoderAPI {
    QSV,
    VAAPI,
    NVENC,
    AMF,
    SOFTWARE,
    UNKNOWN,
}

impl EncoderAPI {
    pub fn to_str(&self) -> &'static str {
        match self {
            Self::QSV => "Intel QuickSync Video",
            Self::VAAPI => "Video Acceleration API",
            Self::NVENC => "NVIDIA NVENC",
            Self::AMF => "AMD Media Framework",
            Self::SOFTWARE => "Software",
            Self::UNKNOWN => "Unknown",
        }
    }
}

#[derive(Debug, Eq, PartialEq, Clone, ValueEnum)]
pub enum EncoderType {
    SOFTWARE,
    HARDWARE,
}

impl EncoderType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::SOFTWARE => "Software",
            Self::HARDWARE => "Hardware",
        }
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct VideoEncoderInfo {
    pub name: String,
    pub codec: VideoCodec,
    pub encoder_type: EncoderType,
    pub encoder_api: EncoderAPI,
    pub parameters: Vec<(String, String)>,
    pub gpu_info: Option<GPUInfo>,
}

impl VideoEncoderInfo {
    pub fn new(
        name: String,
        codec: VideoCodec,
        encoder_type: EncoderType,
        encoder_api: EncoderAPI,
    ) -> Self {
        Self {
            name,
            codec,
            encoder_type,
            encoder_api,
            parameters: Vec::new(),
            gpu_info: None,
        }
    }

    pub fn get_parameters_string(&self) -> String {
        self.parameters
            .iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect::<Vec<_>>()
            .join(" ")
    }

    pub fn set_parameter(&mut self, key: &str, value: &str) {
        self.parameters.push((key.into(), value.into()));
    }

    pub fn apply_parameters(&self, element: &gstreamer::Element, verbose: bool) {
        for (key, value) in &self.parameters {
            if element.has_property(key) {
                if verbose {
                    tracing::debug!("Setting property {} to {}", key, value);
                }
                element.set_property_from_str(key, value);
            }
        }
    }
}

fn get_encoder_api(encoder: &str, encoder_type: &EncoderType) -> EncoderAPI {
    match encoder_type {
        EncoderType::HARDWARE => {
            if encoder.starts_with("qsv") {
                EncoderAPI::QSV
            } else if encoder.starts_with("va") {
                EncoderAPI::VAAPI
            } else if encoder.starts_with("nv") {
                EncoderAPI::NVENC
            } else if encoder.starts_with("amf") {
                EncoderAPI::AMF
            } else {
                EncoderAPI::UNKNOWN
            }
        }
        EncoderType::SOFTWARE => EncoderAPI::SOFTWARE,
    }
}

fn codec_from_encoder_name(name: &str) -> Option<VideoCodec> {
    match name.to_lowercase() {
        n if n.contains("h264") => Some(VideoCodec::H264),
        n if n.contains("h265") => Some(VideoCodec::H265),
        n if n.contains("av1") => Some(VideoCodec::AV1),
        _ => None,
    }
}

fn modify_encoder_params<F>(encoder: &VideoEncoderInfo, mut param_check: F) -> VideoEncoderInfo
where
    F: FnMut(&str) -> Option<(String, String)>,
{
    let mut encoder_optz = encoder.clone();
    let element = match gstreamer::ElementFactory::make(&encoder_optz.name).build() {
        Ok(e) => e,
        Err(_) => return encoder_optz, // Return original if element creation fails
    };

    element.list_properties().iter().for_each(|prop| {
        let prop_name = prop.name();
        if let Some((key, value)) = param_check(prop_name) {
            encoder_optz.set_parameter(&key, &value);
        }
    });

    encoder_optz
}

// Parameter setting helpers
pub fn encoder_cqp_params(encoder: &VideoEncoderInfo, quality: u32) -> VideoEncoderInfo {
    modify_encoder_params(encoder, |prop| {
        let pl = prop.to_lowercase();
        if !pl.contains("qp") {
            return None;
        }

        if pl.contains("i") || pl.contains("min") {
            Some((prop.into(), quality.to_string()))
        } else if pl.contains("p") || pl.contains("max") {
            Some((prop.into(), (quality + 2).to_string()))
        } else {
            None
        }
    })
}

pub fn encoder_vbr_params(
    encoder: &VideoEncoderInfo,
    bitrate: u32,
    max_bitrate: u32,
) -> VideoEncoderInfo {
    modify_encoder_params(encoder, |prop| {
        let pl = prop.to_lowercase();
        if !pl.contains("bitrate") {
            return None;
        }

        if !pl.contains("max") {
            Some((prop.into(), bitrate.to_string()))
        } else if encoder.name != "svtav1enc" {
            Some((prop.into(), max_bitrate.to_string()))
        } else {
            None
        }
    })
}

pub fn encoder_cbr_params(encoder: &VideoEncoderInfo, bitrate: u32) -> VideoEncoderInfo {
    modify_encoder_params(encoder, |prop| {
        let pl = prop.to_lowercase();
        if pl.contains("bitrate") && !pl.contains("max") {
            Some((prop.into(), bitrate.to_string()))
        } else {
            None
        }
    })
}

pub fn encoder_gop_params(encoder: &VideoEncoderInfo, gop_size: u32) -> VideoEncoderInfo {
    modify_encoder_params(encoder, |prop| {
        let pl = prop.to_lowercase();
        if pl.contains("gop-size")
            || pl.contains("int-max")
            || pl.contains("max-dist")
            || pl.contains("intra-period-length")
        {
            Some((prop.into(), gop_size.to_string()))
        } else {
            None
        }
    })
}

pub fn encoder_low_latency_params(
    encoder: &VideoEncoderInfo,
    _rate_control: &RateControl,
    framerate: u32,
) -> VideoEncoderInfo {
    // 1 second keyframe interval for fast recovery, is this too taxing?
    let mut encoder_optz = encoder_gop_params(encoder, framerate);

    match encoder_optz.encoder_api {
        EncoderAPI::QSV => {
            encoder_optz.set_parameter("low-latency", "true");
            encoder_optz.set_parameter("target-usage", "7");
        }
        EncoderAPI::VAAPI => {
            encoder_optz.set_parameter("target-usage", "7");
        }
        EncoderAPI::NVENC => {
            encoder_optz.set_parameter("multi-pass", "disabled");
            encoder_optz.set_parameter("preset", "p1");
            encoder_optz.set_parameter("tune", "ultra-low-latency");
            encoder_optz.set_parameter("zerolatency", "true");
        }
        EncoderAPI::AMF => {
            encoder_optz.set_parameter("preset", "speed");
            let usage = match encoder_optz.codec {
                VideoCodec::H264 | VideoCodec::H265 => "ultra-low-latency",
                VideoCodec::AV1 => "low-latency",
            };
            if !usage.is_empty() {
                encoder_optz.set_parameter("usage", usage);
            }
        }
        EncoderAPI::SOFTWARE => match encoder_optz.name.as_str() {
            "openh264enc" => {
                encoder_optz.set_parameter("complexity", "low");
                encoder_optz.set_parameter("usage-type", "screen");
            }
            "x264enc" => {
                encoder_optz.set_parameter("rc-lookahead", "0");
                encoder_optz.set_parameter("speed-preset", "ultrafast");
                encoder_optz.set_parameter("tune", "zerolatency");
            }
            "svtav1enc" => {
                encoder_optz.set_parameter("preset", "11");
                encoder_optz.set_parameter("parameters-string", "lookahead=0");
            }
            "av1enc" => {
                encoder_optz.set_parameter("usage-profile", "realtime");
                encoder_optz.set_parameter("cpu-used", "10");
                encoder_optz.set_parameter("lag-in-frames", "0");
            }
            _ => {}
        },
        _ => {}
    }

    encoder_optz
}

pub fn get_compatible_encoders(gpus: &Vec<GPUInfo>) -> Vec<VideoEncoderInfo> {
    let mut encoders = Vec::new();
    let registry = gstreamer::Registry::get();

    for plugin in registry.plugins() {
        for feature in registry.features_by_plugin(plugin.plugin_name().as_str()) {
            let encoder_name = feature.name();

            let factory = match gstreamer::ElementFactory::find(encoder_name.as_str()) {
                Some(f) => f,
                None => continue,
            };

            let klass = match factory.metadata("klass") {
                Some(k) => k.to_lowercase(),
                None => continue,
            };

            if !klass.contains("encoder/video") {
                continue;
            }

            let encoder_type = if klass.contains("/hardware") {
                EncoderType::HARDWARE
            } else {
                EncoderType::SOFTWARE
            };

            let api = get_encoder_api(encoder_name.as_str(), &encoder_type);
            let codec = match codec_from_encoder_name(encoder_name.as_str()) {
                Some(c) => c,
                None => continue,
            };

            let element = match factory.create().build() {
                Ok(e) => e,
                Err(_) => continue,
            };

            let mut gpu_info = None;

            if encoder_type == EncoderType::HARDWARE {
                gpu_info = std::panic::catch_unwind(|| {
                    match api {
                        EncoderAPI::QSV | EncoderAPI::VAAPI => {
                            // Safe property access with panic protection, gstreamer-rs is fun
                            let path = if element.has_property("device-path") {
                                Some(element.property::<String>("device-path"))
                            } else if element.has_property("device") {
                                Some(element.property::<String>("device"))
                            } else {
                                None
                            };

                            path.and_then(|p| get_gpu_by_card_path(&gpus, &p))
                        }
                        EncoderAPI::NVENC => {
                            if encoder_name.contains("device") {
                                // Parse by element name's index (i.e. "nvh264device{N}enc")
                                let re = regex::Regex::new(r"device(\d+)").unwrap();
                                if let Some(caps) = re.captures(encoder_name.as_str()) {
                                    if let Some(m) = caps.get(1) {
                                        if let Ok(id) = m.as_str().parse::<usize>() {
                                            return get_gpus_by_vendor(&gpus, GPUVendor::NVIDIA)
                                                .get(id)
                                                .cloned();
                                        }
                                    }
                                }
                                None
                            } else if element.has_property("cuda-device-id") {
                                let device_id = match element
                                    .property_value("cuda-device-id")
                                    .get::<i32>()
                                {
                                    Ok(v) if v >= 0 => Some(v as usize),
                                    _ => {
                                        // If only one NVIDIA GPU, default to 0
                                        // fixes "Type: 'Hardware', Device: 'CPU'" issue
                                        if get_gpus_by_vendor(&gpus, GPUVendor::NVIDIA).len() == 1 {
                                            Some(0)
                                        } else {
                                            None
                                        }
                                    }
                                };

                                // We'll just treat cuda-device-id as an index
                                device_id.and_then(|id| {
                                    get_gpus_by_vendor(&gpus, GPUVendor::NVIDIA)
                                        .get(id)
                                        .cloned()
                                })
                            } else {
                                None
                            }
                        }
                        EncoderAPI::AMF if element.has_property("device") => {
                            let device_id = match element.property_value("device").get::<u32>() {
                                Ok(v) => Some(v as usize),
                                Err(_) => None,
                            };

                            device_id.and_then(|id| {
                                get_gpus_by_vendor(&gpus, GPUVendor::AMD).get(id).cloned()
                            })
                        }
                        _ => None,
                    }
                })
                .unwrap_or_else(|_| {
                    tracing::error!(
                        "Error occurred while querying properties for {}",
                        encoder_name
                    );
                    None
                });
            }

            let mut encoder_info =
                VideoEncoderInfo::new(encoder_name.into(), codec, encoder_type.clone(), api);
            encoder_info.gpu_info = gpu_info;
            encoders.push(encoder_info);
        }
    }

    encoders
}

/// Helper to return encoder from vector by name (case-insensitive).
/// # Arguments
/// * `encoders` - A vector containing information about each encoder.
/// * `name` - A string slice that holds the encoder name.
/// # Returns
/// * `Result<EncoderInfo, Box<dyn Error>>` - A Result containing EncoderInfo if found, or an error.
pub fn get_encoder_by_name(
    encoders: &Vec<VideoEncoderInfo>,
    name: &str,
) -> Result<VideoEncoderInfo, Box<dyn Error>> {
    let name = name.to_lowercase();
    if let Some(encoder) = encoders
        .iter()
        .find(|encoder| encoder.name.to_lowercase() == name)
    {
        Ok(encoder.clone())
    } else {
        Err(format!("Encoder '{}' not found", name).into())
    }
}

/// Helper to get encoders from vector by video codec.
/// # Arguments
/// * `encoders` - A vector containing information about each encoder.
/// * `codec` - The codec of the encoder.
/// # Returns
/// * `Vec<EncoderInfo>` - A vector containing EncoderInfo structs if found.
pub fn get_encoders_by_videocodec(
    encoders: &Vec<VideoEncoderInfo>,
    codec: &VideoCodec,
) -> Vec<VideoEncoderInfo> {
    encoders
        .iter()
        .filter(|encoder| encoder.codec == *codec)
        .cloned()
        .collect()
}

/// Helper to get encoders from vector by encoder type.
/// # Arguments
/// * `encoders` - A vector containing information about each encoder.
/// * `encoder_type` - The type of the encoder.
/// # Returns
/// * `Vec<EncoderInfo>` - A vector containing EncoderInfo structs if found.
pub fn get_encoders_by_type(
    encoders: &Vec<VideoEncoderInfo>,
    encoder_type: &EncoderType,
) -> Vec<VideoEncoderInfo> {
    encoders
        .iter()
        .filter(|encoder| encoder.encoder_type == *encoder_type)
        .cloned()
        .collect()
}

/// Returns best-case compatible encoder given desired codec and encoder type.
/// # Arguments
/// * `encoders` - List of encoders to pick from.
/// * `codec` - Desired codec.
/// * `encoder_type` - Desired encoder type.
/// # Returns
/// * `Result<VideoEncoderInfo, Box<dyn Error>>` - A Result containing the best compatible encoder if found, or an error.
pub fn get_best_compatible_encoder(
    encoders: &Vec<VideoEncoderInfo>,
    codec: &Codec,
    encoder_type: &EncoderType,
) -> Result<VideoEncoderInfo, Box<dyn Error>> {
    let mut best_encoder: Option<VideoEncoderInfo> = None;
    let mut best_score: i32 = 0;

    let codec = match codec {
        Codec::Video(c) => c.clone(),
        Codec::Audio(_) => {
            // Only for video currently
            return Err("Attempted to get best compatible video encoder with audio codec".into());
        }
    };

    // Filter by codec and type first
    let encoders = get_encoders_by_videocodec(encoders, &codec);
    let encoders = get_encoders_by_type(&encoders, &encoder_type);

    for encoder in encoders {
        // Local score
        let mut score = 0;

        // API score
        score += match encoder.encoder_api {
            EncoderAPI::NVENC => 3,
            EncoderAPI::QSV => 3,
            EncoderAPI::AMF => 3,
            EncoderAPI::VAAPI => 2,
            EncoderAPI::SOFTWARE => 1,
            EncoderAPI::UNKNOWN => 0,
        };

        // If software, score also based on name to get most compatible software encoder for low latency
        if encoder.encoder_type == EncoderType::SOFTWARE {
            score += match encoder.name.as_str() {
                "openh264enc" => 2,
                "x264enc" => 1,
                "svtav1enc" => 2,
                "av1enc" => 1,
                _ => 0,
            };
        }

        // Update best encoder based on score
        if score > best_score {
            best_encoder = Some(encoder.clone());
            best_score = score;
        }
    }

    if let Some(encoder) = best_encoder {
        Ok(encoder)
    } else {
        Err("No compatible encoder found".into())
    }
}

/// Returns the best compatible encoder that also passes test_encoder
pub fn get_best_working_encoder(
    encoders: &Vec<VideoEncoderInfo>,
    codec: &Codec,
    encoder_type: &EncoderType,
) -> Result<VideoEncoderInfo, Box<dyn Error>> {
    let mut candidates = get_encoders_by_videocodec(
        encoders,
        match codec {
            Codec::Video(c) => c,
            Codec::Audio(_) => {
                return Err("Audio codec not supported for video encoder selection".into());
            }
        },
    );
    candidates = get_encoders_by_type(&candidates, encoder_type);
    let mut tried = Vec::new();
    while !candidates.is_empty() {
        let best = get_best_compatible_encoder(&candidates, codec, encoder_type)?;
        tracing::info!("Testing encoder: {}", best.name,);
        if test_encoder(&best).is_ok() {
            return Ok(best);
        } else {
            // Remove this encoder and try next best
            candidates.retain(|e| e != &best);
            tried.push(best.name.clone());
        }
    }
    Err(format!("No working encoder found (tried: {:?})", tried).into())
}

/// Test if a pipeline with the given encoder can be created and set to Playing
pub fn test_encoder(encoder: &VideoEncoderInfo) -> Result<(), Box<dyn Error>> {
    let src = gstreamer::ElementFactory::make("videotestsrc").build()?;
    let caps_filter = gstreamer::ElementFactory::make("capsfilter").build()?;
    let caps = gstreamer::Caps::from_str("video/x-raw,width=1280,height=720,framerate=30/1")?;
    caps_filter.set_property("caps", &caps);

    let enc = gstreamer::ElementFactory::make(&encoder.name).build()?;
    let sink = gstreamer::ElementFactory::make("fakesink").build()?;
    // Apply encoder parameters
    encoder.apply_parameters(&enc, false);

    // Create pipeline and link elements
    let pipeline = gstreamer::Pipeline::new();

    let videoconvert = gstreamer::ElementFactory::make("videoconvert").build()?;
    pipeline.add_many(&[&src, &caps_filter, &videoconvert, &enc, &sink])?;
    gstreamer::Element::link_many(&[&src, &caps_filter, &videoconvert, &enc, &sink])?;

    let bus = pipeline.bus().ok_or("Pipeline has no bus")?;
    pipeline.set_state(gstreamer::State::Playing)?;

    // Wait for either error or async-done (state change complete)
    for msg in bus.iter_timed(gstreamer::ClockTime::from_seconds(10)) {
        match msg.view() {
            gstreamer::MessageView::Error(err) => {
                let err_msg = format!("Pipeline error: {}", err.error());
                tracing::error!("Pipeline error, encoder test failed: {}", err_msg);
                let _ = pipeline.set_state(gstreamer::State::Null);
                return Err(err_msg.into());
            }
            gstreamer::MessageView::AsyncDone(_) => {
                // Pipeline successfully reached PLAYING state
                tracing::debug!("Pipeline reached PLAYING state successfully");
                let _ = pipeline.set_state(gstreamer::State::Null);
                return Ok(());
            }
            _ => {}
        }
    }

    // If we got here, timeout occurred without reaching PLAYING or error
    let _ = pipeline.set_state(gstreamer::State::Null);
    Err("Encoder test timed out".into())
}
