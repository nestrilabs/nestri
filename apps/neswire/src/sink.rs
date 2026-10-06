use anyhow::Result;
use crossbeam_channel::Sender;
use pipewire::{self as pw, loop_::Signal, spa, stream::*};
use spa::param::audio::{AudioFormat, AudioInfoRaw};

/// Frames the graph clock moved past without this stream receiving them.
///
/// `expected` is where the previous cycle's data ended, `now` where this
/// cycle's begins. Zero on the first cycle, when either position is unknown,
/// and when the clock went backwards -- a restart, which is followed rather
/// than filled.
fn missed_frames(expected: Option<u64>, now: Option<u64>) -> u64 {
    match (expected, now) {
        (Some(expected), Some(now)) => now.saturating_sub(expected),
        _ => 0,
    }
}

pub fn run(sample_rate: u32, channels: u32, frame_size: u32, tx: Sender<Vec<f32>>) -> Result<()> {
    pw::init();
    tracing::info!("pipewire init ok");

    let mainloop =
        pw::main_loop::MainLoopRc::new(None).map_err(|e| anyhow::anyhow!("mainloop: {e}"))?;
    tracing::info!("mainloop created");

    let context = pw::context::ContextRc::new(&mainloop, None)
        .map_err(|e| anyhow::anyhow!("context: {e}"))?;
    tracing::info!("context created");

    let core = context
        .connect_rc(None)
        .map_err(|e| anyhow::anyhow!("core connect: {e}"))?;
    tracing::info!("core connected");

    let stream = pw::stream::StreamRc::new(
        core,
        "neswire",
        pw::properties::properties! {
            *pw::keys::MEDIA_TYPE => "Audio",
            *pw::keys::MEDIA_CATEGORY => "Capture",
            *pw::keys::MEDIA_CLASS => "Audio/Sink",
            *pw::keys::NODE_NAME => "neswire",
            *pw::keys::NODE_DESCRIPTION => "Neswire Cloud Gaming Audio Sink",
            // Prevent session manager from suspending us
            "node.always-process" => "true",
            // Desired latency in samples
            "node.latency" => format!("{}/{}", frame_size, sample_rate),
        },
    )
    .map_err(|e| anyhow::anyhow!("stream create: {e}"))?;

    // Accumulation buffer for collecting enough samples before sending a frame
    let samples_per_frame = (frame_size * channels) as usize;

    struct State {
        tx: Sender<Vec<f32>>,
        accum: Vec<f32>,
        samples_per_frame: usize,
        channels: usize,
        sample_rate: u32,
        /// The graph position the next cycle's data starts at, if the stream
        /// has run a cycle yet. See `process` for what it is for.
        next_ticks: Option<u64>,
    }

    let state = State {
        tx,
        accum: Vec::with_capacity(samples_per_frame * 2),
        samples_per_frame,
        channels: channels as usize,
        sample_rate,
        next_ticks: None,
    };

    let _listener = stream
        .add_local_listener_with_user_data(state)
        .param_changed(move |_, _state, id, pod| {
            if id != spa::param::ParamType::Format.as_raw() {
                return;
            }
            // You can parse the negotiated format here if needed
            // For now we're requesting a fixed format so it should match
            if let Some(_pod) = pod {
                tracing::info!("format negotiated");
            }
        })
        .process(move |stream, state| {
            // Where the graph clock is this cycle, in frames. Read before the
            // buffer: it is this cycle's position whatever the buffer holds.
            let ticks = stream
                .time()
                .ok()
                .filter(|t| t.rate().denom == state.sample_rate)
                .map(|t| t.ticks());
            // Dequeue the buffer from PipeWire
            if let Some(mut buffer) = stream.dequeue_buffer() {
                let datas = buffer.datas_mut();
                if let Some(data) = datas.first_mut() {
                    let chunk = data.chunk();
                    let offset = chunk.offset() as usize;
                    let size = chunk.size() as usize;

                    if let Some(slice) = data.data() {
                        let audio_bytes = &slice[offset..offset + size];

                        // Reinterpret as f32 samples (we requested F32LE)
                        let samples: &[f32] = bytemuck::cast_slice(audio_bytes);

                        // **A cycle this stream missed is time the stream
                        // still has to account for.** When the graph runs a
                        // cycle and neswire does not get to it in time -- an
                        // xrun -- that cycle's audio never arrives here, but
                        // the graph clock moves on. Sending only what arrived
                        // made the stream run short of realtime by exactly the
                        // missed cycles, about 3.5% measured, and the client,
                        // which plays at its own sound card's 48 kHz, drained
                        // its buffer and underran every few seconds.
                        //
                        // So the gap is filled with exactly the frames the clock
                        // says were missed, as silence: an xrun is a hole of the
                        // size it really was, and the stream stays at 48 kHz.
                        // A position that went backwards is a clock restart,
                        // not a gap, and is simply followed.
                        let frames = (samples.len() / state.channels) as u64;
                        let missed = missed_frames(state.next_ticks, ticks) as usize;
                        if missed > 0 {
                            state
                                .accum
                                .resize(state.accum.len() + missed * state.channels, 0.0);
                            tracing::debug!(missed, "graph cycle missed; filled with silence");
                        }
                        state.next_ticks = ticks.map(|t| t + frames);

                        state.accum.extend_from_slice(samples);

                        tracing::trace!(
                            "pw delivered {} samples, accum now {}, frame size {}",
                            samples.len(),
                            state.accum.len(),
                            state.samples_per_frame,
                        );

                        // Drain complete frames
                        while state.accum.len() >= state.samples_per_frame {
                            let frame: Vec<f32> =
                                state.accum.drain(..state.samples_per_frame).collect();

                            if state.tx.try_send(frame).is_err() {
                                tracing::warn!("encoder falling behind, dropping frame");
                            }
                        }
                    }
                }
            }
        })
        .register()
        .map_err(|e| anyhow::anyhow!("stream register: {e}"))?;

    let mut position = [0u32; 64];
    let channel_map: &[u32] = match channels {
        2 => &[
            spa::sys::SPA_AUDIO_CHANNEL_FL,
            spa::sys::SPA_AUDIO_CHANNEL_FR,
        ],
        6 => &[
            spa::sys::SPA_AUDIO_CHANNEL_FL,
            spa::sys::SPA_AUDIO_CHANNEL_FC,
            spa::sys::SPA_AUDIO_CHANNEL_FR,
            spa::sys::SPA_AUDIO_CHANNEL_RL,
            spa::sys::SPA_AUDIO_CHANNEL_RR,
            spa::sys::SPA_AUDIO_CHANNEL_LFE,
        ],
        8 => &[
            spa::sys::SPA_AUDIO_CHANNEL_FL,
            spa::sys::SPA_AUDIO_CHANNEL_FC,
            spa::sys::SPA_AUDIO_CHANNEL_FR,
            spa::sys::SPA_AUDIO_CHANNEL_SL,
            spa::sys::SPA_AUDIO_CHANNEL_SR,
            spa::sys::SPA_AUDIO_CHANNEL_RL,
            spa::sys::SPA_AUDIO_CHANNEL_RR,
            spa::sys::SPA_AUDIO_CHANNEL_LFE,
        ],
        _ => anyhow::bail!("unsupported channel count: {channels}"),
    };
    position[..channel_map.len()].copy_from_slice(channel_map);

    // Build the format we want: f32le, 48kHz, N channels
    let mut audio_info = AudioInfoRaw::new();
    audio_info.set_format(AudioFormat::F32LE);
    audio_info.set_rate(sample_rate);
    audio_info.set_channels(channels);
    audio_info.set_position(position);

    let values: Vec<u8> = pw::spa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &pw::spa::pod::Value::Object(pw::spa::pod::Object {
            type_: pw::spa::utils::SpaTypes::ObjectParamFormat.as_raw(),
            id: pw::spa::param::ParamType::EnumFormat.as_raw(),
            properties: audio_info.into(),
        }),
    )?
    .0
    .into_inner();

    let mut params = [pw::spa::pod::Pod::from_bytes(&values).unwrap()];

    stream
        .connect(
            spa::utils::Direction::Input, // We receive audio (we're a sink)
            Some(pw::constants::ID_ANY),
            StreamFlags::AUTOCONNECT | StreamFlags::MAP_BUFFERS | StreamFlags::RT_PROCESS,
            &mut params,
        )
        .map_err(|e| anyhow::anyhow!("stream connect: {e}"))?;
    tracing::info!("stream connected");

    tracing::info!(
        "neswire sink running — {}ch, {}Hz, {} samples/frame",
        channels,
        sample_rate,
        frame_size
    );

    let weak = mainloop.downgrade();
    let _sigint = mainloop.loop_().add_signal_local(Signal::INT, move || {
        if let Some(mainloop) = weak.upgrade() {
            mainloop.quit();
        }
    });

    mainloop.run();

    tracing::info!("shutting down");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::missed_frames;

    #[test]
    fn a_gap_is_exactly_the_frames_the_clock_moved_past() {
        // One 240-frame cycle delivered, the next started 480 later: one missed.
        assert_eq!(missed_frames(Some(240), Some(480)), 240);
        assert_eq!(missed_frames(Some(240), Some(240)), 0);
    }

    #[test]
    fn nothing_is_filled_without_two_positions_or_when_the_clock_restarts() {
        assert_eq!(missed_frames(None, Some(10_000)), 0);
        assert_eq!(missed_frames(Some(240), None), 0);
        assert_eq!(missed_frames(Some(10_000), Some(0)), 0);
    }
}
