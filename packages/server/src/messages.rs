use crate::latency::LatencyTracker;
use serde::{Deserialize, Serialize};
use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;

#[derive(Serialize, Deserialize, Debug)]
pub struct MessageBase {
    pub payload_type: String,
    pub latency: Option<LatencyTracker>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct MessageRaw {
    #[serde(flatten)]
    pub base: MessageBase,
    pub data: serde_json::Value,
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
