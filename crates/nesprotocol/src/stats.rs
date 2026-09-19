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

/// What the video bitrate is made of, and who chose it.
///
/// Appended to a hub stats packet rather than replacing anything, so an older
/// reader keeps working on the part it understands -- `decode_stats` already
/// guards each field on the length it needs.
///
/// **The split is the point.** One combined byte counter cannot distinguish an
/// encoder ignoring its bitrate target from a stream that is mostly keyframes,
/// and those have opposite fixes. A session overshooting its target by ten times
/// looked identical either way, which is why the cause stayed ambiguous for
/// weeks.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct VideoBreakdown {
    /// Keyframe bits per second, measured over the last second.
    pub key_bps: u32,
    /// Everything else, measured the same way.
    pub delta_bps: u32,
    /// Keyframes in the last second.
    pub keyframes: u8,
    /// What the controller is asking the encoder for.
    pub target_kbps: u32,
    /// The ceiling it is choosing within, after any client lowered it.
    pub ceiling_kbps: u32,
    /// What the box's own pipeline cost this frame, in milliseconds, at the
    /// median and the 95th percentile of the last second.
    ///
    /// Capture to the moment the hub handed the frame to the transport, so it
    /// covers encoding and the IPC hop and nothing beyond this machine. The
    /// point is attribution: a client measuring late frames cannot otherwise
    /// tell a stalled encoder from a jittery path, and buffering against the
    /// first is latency spent hiding a fault that should be fixed.
    pub pipeline_p50_ms: u16,
    pub pipeline_p95_ms: u16,
    /// The worst single frame in that second.
    pub pipeline_max_ms: u16,
    /// The ceiling the box itself was given, which no client may exceed.
    ///
    /// Separate from `ceiling_kbps` because a client that lowers the ceiling
    /// would otherwise have nothing left to raise it against: the only number
    /// it can see is the one it just lowered. A control that can be turned down
    /// and not back up is worse than no control.
    pub box_ceiling_kbps: u32,
    /// Why the target is what it is; see the hub's control module.
    pub reason: u8,
    /// 0 when the controller is deciding, 1 when a person set it by hand.
    pub manual: u8,
}

/// `[4B key_bps][4B delta_bps][1B keyframes][4B target][4B ceiling][1B reason]
/// [1B manual][4B box_ceiling][2B pipeline_p50][2B pipeline_p95][2B pipeline_max]`
pub const VIDEO_BREAKDOWN_LEN: usize = 29;

pub fn encode_video_breakdown(buf: &mut Vec<u8>, b: &VideoBreakdown) {
    buf.reserve(VIDEO_BREAKDOWN_LEN);
    buf.extend_from_slice(&b.key_bps.to_le_bytes());
    buf.extend_from_slice(&b.delta_bps.to_le_bytes());
    buf.push(b.keyframes);
    buf.extend_from_slice(&b.target_kbps.to_le_bytes());
    buf.extend_from_slice(&b.ceiling_kbps.to_le_bytes());
    buf.push(b.reason);
    buf.push(b.manual);
    buf.extend_from_slice(&b.box_ceiling_kbps.to_le_bytes());
    buf.extend_from_slice(&b.pipeline_p50_ms.to_le_bytes());
    buf.extend_from_slice(&b.pipeline_p95_ms.to_le_bytes());
    buf.extend_from_slice(&b.pipeline_max_ms.to_le_bytes());
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
    /// `None` from a hub that predates the breakdown.
    pub video: Option<VideoBreakdown>,
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
            if data.len() >= 14 + VIDEO_BREAKDOWN_LEN {
                let d = &data[14..];
                let u32_at = |o: usize| u32::from_le_bytes(d[o..o + 4].try_into().unwrap());
                stats.video = Some(VideoBreakdown {
                    key_bps: u32_at(0),
                    delta_bps: u32_at(4),
                    keyframes: d[8],
                    target_kbps: u32_at(9),
                    ceiling_kbps: u32_at(13),
                    reason: d[17],
                    manual: d[18],
                    box_ceiling_kbps: u32_at(19),
                    pipeline_p50_ms: u16::from_le_bytes([d[23], d[24]]),
                    pipeline_p95_ms: u16::from_le_bytes([d[25], d[26]]),
                    pipeline_max_ms: u16::from_le_bytes([d[27], d[28]]),
                });
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod breakdown_tests {
    use super::*;

    fn breakdown() -> VideoBreakdown {
        VideoBreakdown {
            key_bps: 3_200_000,
            delta_bps: 6_800_000,
            keyframes: 2,
            target_kbps: 6_000,
            ceiling_kbps: 8_000,
            reason: 1,
            manual: 0,
            box_ceiling_kbps: 8_000,
            pipeline_p50_ms: 9,
            pipeline_p95_ms: 24,
            pipeline_max_ms: 61,
        }
    }

    fn hub_packet(with_breakdown: bool) -> Vec<u8> {
        let mut buf = Vec::new();
        encode_hub_stats(&mut buf, 1, 10_000_000, 0.0, 128, 2);
        if with_breakdown {
            encode_video_breakdown(&mut buf, &breakdown());
        }
        buf
    }

    #[test]
    fn a_breakdown_survives_the_wire() {
        let packet = hub_packet(true);
        let mut stats = PipelineStats::default();
        decode_stats(STATS_HUB, &packet[1..], &mut stats);
        assert_eq!(stats.video, Some(breakdown()));
        // The fields that were always there still read correctly beside it.
        assert_eq!(stats.hub_clients, 1);
        assert_eq!(stats.audio_bitrate_kbps, 128);
        assert_eq!(stats.audio_channels, 2);
    }

    #[test]
    fn a_hub_without_the_breakdown_still_reads() {
        // The reason this is appended rather than folded into the layout: a hub
        // that predates it keeps working, and says so by omission rather than by
        // reporting zeroes that look like a stream carrying nothing.
        let packet = hub_packet(false);
        let mut stats = PipelineStats::default();
        decode_stats(STATS_HUB, &packet[1..], &mut stats);
        assert_eq!(stats.video, None);
        assert_eq!(stats.hub_clients, 1);
        assert_eq!(stats.audio_channels, 2);
    }

    #[test]
    fn a_truncated_breakdown_is_left_out_rather_than_half_read() {
        let full = hub_packet(true);
        for n in 15..full.len() - 1 {
            let mut stats = PipelineStats::default();
            decode_stats(STATS_HUB, &full[1..n], &mut stats);
            assert_eq!(stats.video, None, "{n} bytes produced a partial breakdown");
        }
    }

    #[test]
    fn the_split_distinguishes_the_two_ways_a_stream_overshoots() {
        // The whole reason for the split. Same total, opposite causes: an
        // encoder ignoring its target, and a stream that is nearly all
        // keyframes. One counter cannot tell them apart.
        let ignoring_target = VideoBreakdown {
            key_bps: 200_000,
            delta_bps: 9_800_000,
            keyframes: 1,
            ..breakdown()
        };
        let keyframe_storm = VideoBreakdown {
            key_bps: 9_000_000,
            delta_bps: 1_000_000,
            keyframes: 30,
            ..breakdown()
        };
        assert_eq!(
            ignoring_target.key_bps + ignoring_target.delta_bps,
            keyframe_storm.key_bps + keyframe_storm.delta_bps,
        );
        assert!(ignoring_target.delta_bps > ignoring_target.key_bps);
        assert!(keyframe_storm.key_bps > keyframe_storm.delta_bps);
    }
}
