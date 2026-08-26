// Pipeline stats messages sent from each component to the desktop-app
// via the hub. Each source sends its own fixed-size packet.

pub const STATS_NESCOPE: u8 = 0;
pub const STATS_HUDLESS: u8 = 1;
pub const STATS_HUB: u8 = 2;

/// Nescope stats: game frame callback rate.
/// [0][game_fps: u8][frame_count: u32 LE]
pub fn encode_nescope_stats(buf: &mut Vec<u8>, game_fps: u8, frame_count: u32) {
    buf.push(STATS_NESCOPE);
    buf.push(game_fps);
    buf.extend_from_slice(&frame_count.to_le_bytes());
}

/// Hudless stats: capture FPS, encode time, dropped frames, diagnostics, capture latency.
/// [1][capture_fps: u8][encode_avg_ms: f32 LE][dropped: u32 LE][present_attempts: u32 LE][capture_attempts: u32 LE][capture_ms: f32 LE]
pub fn encode_hudless_stats(
    buf: &mut Vec<u8>,
    capture_fps: u8,
    encode_avg_ms: f32,
    dropped: u32,
    present_attempts: u32,
    capture_attempts: u32,
    capture_ms: f32,
) {
    buf.push(STATS_HUDLESS);
    buf.push(capture_fps);
    buf.extend_from_slice(&encode_avg_ms.to_le_bytes());
    buf.extend_from_slice(&dropped.to_le_bytes());
    buf.extend_from_slice(&present_attempts.to_le_bytes());
    buf.extend_from_slice(&capture_attempts.to_le_bytes());
    buf.extend_from_slice(&capture_ms.to_le_bytes());
}

/// Hub stats: client count, video bytes, relay latency, audio.
///
/// `audio_bitrate_kbps` is *measured* ingest from neswire, not the hub's
/// configured target. It used to be the latter, which made it a constant --
/// it read the same whether neswire was feeding the socket or had never sent
/// a byte. `audio_channels` stays configuration: a byte count cannot tell you
/// how many channels those bytes describe.
///
/// The layout is unchanged, so this is not a version bump -- only the meaning
/// of a field that was never trustworthy in the first place.
/// [2][clients: u8][video_bytes_mb: u32 LE][hub_relay_ms: f32 LE][audio_bitrate_kbps: u32 LE][audio_channels: u8]
pub fn encode_hub_stats(
    buf: &mut Vec<u8>,
    clients: u8,
    video_bytes_mb: u32,
    hub_relay_ms: f32,
    audio_bitrate_kbps: u32,
    audio_channels: u8,
) {
    buf.push(STATS_HUB);
    buf.push(clients);
    buf.extend_from_slice(&video_bytes_mb.to_le_bytes());
    buf.extend_from_slice(&hub_relay_ms.to_le_bytes());
    buf.extend_from_slice(&audio_bitrate_kbps.to_le_bytes());
    buf.push(audio_channels);
}

/// Decoded stats from any source.
#[derive(Debug, Clone, Default)]
pub struct PipelineStats {
    pub nescope_fps: u8,
    pub nescope_frames: u32,
    pub hudless_fps: u8,
    pub hudless_encode_ms: f32,
    pub hudless_capture_ms: f32,
    pub hudless_dropped: u32,
    pub hub_clients: u8,
    pub hub_video_mb: u32,
    pub hub_relay_ms: f32,
    pub present_attempts: u32,
    pub capture_attempts: u32,
    pub audio_bitrate_kbps: u32,
    pub audio_channels: u8,
}

/// Try to decode a single stats packet. The `msg_type` is the frame-level
/// type byte (STATS_NESCOPE, STATS_HUDLESS, or STATS_HUB).
pub fn decode_stats(msg_type: u8, data: &[u8], stats: &mut PipelineStats) {
    match msg_type {
        STATS_NESCOPE if data.len() >= 5 => {
            stats.nescope_fps = data[0];
            stats.nescope_frames = u32::from_le_bytes([data[1], data[2], data[3], data[4]]);
        }
        STATS_HUDLESS if data.len() >= 17 => {
            stats.hudless_fps = data[0];
            stats.hudless_encode_ms = f32::from_le_bytes([data[1], data[2], data[3], data[4]]);
            stats.hudless_dropped = u32::from_le_bytes([data[5], data[6], data[7], data[8]]);
            stats.present_attempts = u32::from_le_bytes([data[9], data[10], data[11], data[12]]);
            stats.capture_attempts = u32::from_le_bytes([data[13], data[14], data[15], data[16]]);
            if data.len() >= 21 {
                stats.hudless_capture_ms =
                    f32::from_le_bytes([data[17], data[18], data[19], data[20]]);
            }
        }
        STATS_HUB if data.len() >= 5 => {
            stats.hub_clients = data[0];
            stats.hub_video_mb = u32::from_le_bytes([data[1], data[2], data[3], data[4]]);
            if data.len() >= 9 {
                stats.hub_relay_ms = f32::from_le_bytes([data[5], data[6], data[7], data[8]]);
            }
            if data.len() >= 13 {
                stats.audio_bitrate_kbps =
                    u32::from_le_bytes([data[9], data[10], data[11], data[12]]);
            }
            if data.len() >= 14 {
                stats.audio_channels = data[13];
            }
        }
        _ => {}
    }
}
