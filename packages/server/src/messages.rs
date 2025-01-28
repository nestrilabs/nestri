use std::error::Error;
use std::io::{Read, Write};
use flate2::Compression;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use num_derive::{FromPrimitive, ToPrimitive};
use num_traits::{FromPrimitive, ToPrimitive};
use serde::{Deserialize, Serialize};
use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use crate::latency::LatencyTracker;

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "type")]
pub enum InputMessage {
    #[serde(rename = "mousemove")]
    MouseMove { x: i32, y: i32 },

    #[serde(rename = "mousemoveabs")]
    MouseMoveAbs { x: i32, y: i32 },

    #[serde(rename = "wheel")]
    Wheel { x: f64, y: f64 },

    #[serde(rename = "mousedown")]
    MouseDown { key: i32 },
    // Add other variants as needed
    #[serde(rename = "mouseup")]
    MouseUp { key: i32 },

    #[serde(rename = "keydown")]
    KeyDown { key: i32 },

    #[serde(rename = "keyup")]
    KeyUp { key: i32 },
}

#[derive(Serialize, Deserialize, Debug)]
pub struct MessageBase {
    pub payload_type: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct MessageInput {
    #[serde(flatten)]
    pub base: MessageBase,
    pub data: String,
    pub latency: Option<LatencyTracker>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct MessageLog {
    #[serde(flatten)]
    pub base: MessageBase,
    pub level: String,
    pub message: String,
    pub time: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct MessageMetrics {
    #[serde(flatten)]
    pub base: MessageBase,
    pub usage_cpu: f64,
    pub usage_memory: f64,
    pub uptime: u64,
    pub pipeline_latency: f64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct MessageICE {
    #[serde(flatten)]
    pub base: MessageBase,
    pub candidate: RTCIceCandidateInit,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct MessageSDP {
    #[serde(flatten)]
    pub base: MessageBase,
    pub sdp: RTCSessionDescription,
}

#[repr(i32)]
#[derive(Debug, FromPrimitive, ToPrimitive, Copy, Clone, Serialize, Deserialize)]
#[serde(try_from = "i32", into = "i32")]
pub enum JoinerType {
    JoinerNode = 0,
    JoinerClient = 1,
}
impl TryFrom<i32> for JoinerType {
    type Error = &'static str;

    fn try_from(value: i32) -> Result<Self, Self::Error> {
        JoinerType::from_i32(value).ok_or("Invalid value for JoinerType")
    }
}
impl From<JoinerType> for i32 {
    fn from(joiner_type: JoinerType) -> Self {
        joiner_type.to_i32().unwrap()
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub struct MessageJoin {
    #[serde(flatten)]
    pub base: MessageBase,
    pub joiner_type: JoinerType,
}

#[repr(i32)]
#[derive(Debug, FromPrimitive, ToPrimitive, Copy, Clone, Serialize, Deserialize)]
#[serde(try_from = "i32", into = "i32")]
pub enum AnswerType {
    AnswerOffline = 0,
    AnswerInUse = 1,
    AnswerOK = 2,
}
impl TryFrom<i32> for AnswerType {
    type Error = &'static str;

    fn try_from(value: i32) -> Result<Self, Self::Error> {
        AnswerType::from_i32(value).ok_or("Invalid value for AnswerType")
    }
}
impl From<AnswerType> for i32 {
    fn from(answer_type: AnswerType) -> Self {
        answer_type.to_i32().unwrap()
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub struct MessageAnswer {
    #[serde(flatten)]
    pub base: MessageBase,
    pub answer_type: AnswerType,
}

pub fn encode_message<T: Serialize>(message: &T) -> Result<Vec<u8>, Box<dyn Error>> {
    // Serialize the message to JSON
    let json = serde_json::to_string(message)?;

    // Compress the JSON using gzip
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(json.as_bytes())?;
    let compressed_data = encoder.finish()?;

    Ok(compressed_data)
}

pub fn decode_message(data: &[u8]) -> Result<MessageBase, Box<dyn Error + Send + Sync>> {
    let mut decoder = GzDecoder::new(data);
    let mut decompressed_data = String::new();
    decoder.read_to_string(&mut decompressed_data)?;

    let base_message: MessageBase = serde_json::from_str(&decompressed_data)?;
    Ok(base_message)
}

pub fn decode_message_as<T: for<'de> Deserialize<'de>>(
    data: Vec<u8>,
) -> Result<T, Box<dyn Error + Send + Sync>> {
    let mut decoder = GzDecoder::new(data.as_slice());
    let mut decompressed_data = String::new();
    decoder.read_to_string(&mut decompressed_data)?;

    let message: T = serde_json::from_str(&decompressed_data)?;
    Ok(message)
}