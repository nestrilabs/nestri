mod args;
mod enc_helper;
mod gpu;
mod latency;
mod messages;
mod nestrisink;
mod p2p;
mod proto;

use crate::args::encoding_args;
use crate::enc_helper::{EncoderAPI, EncoderType};
use crate::gpu::{GPUInfo, GPUVendor};
use crate::nestrisink::NestriSignaller;
use crate::p2p::p2p::NestriP2P;
use gstreamer::prelude::*;
use gstrswebrtc::signaller::Signallable;
use gstrswebrtc::webrtcsink::BaseWebRTCSink;
use std::error::Error;
use std::str::FromStr;
use std::sync::Arc;
use tokio_stream::StreamExt;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::filter::LevelFilter;

// Handles gathering GPU information and selecting the most suitable GPU
fn handle_gpus(args: &args::Args) -> Result<Vec<gpu::GPUInfo>, Box<dyn Error>> {
    tracing::info!("Gathering GPU information..");
    let mut gpus = gpu::get_gpus();
    if gpus.is_empty() {
        return Err("No GPUs found".into());
    }
    for (i, gpu) in gpus.iter().enumerate() {
        tracing::info!(
            "> [GPU:{}]  Vendor: '{}', Card Path: '{}', Render Path: '{}', Device Name: '{}'",
            i,
            gpu.vendor_string(),
            gpu.card_path(),
            gpu.render_path(),
            gpu.device_name()
        );
    }

    // Additional GPU filtering
    if !args.device.gpu_card_path.is_empty() {
        if let Some(gpu) = gpu::get_gpu_by_card_path(&gpus, &args.device.gpu_card_path) {
            return Ok(Vec::from([gpu]));
        }
    } else {
        // Run all filters that are not empty
        let mut filtered_gpus = gpus.clone();
        if !args.device.gpu_vendor.is_empty() {
            filtered_gpus = gpu::get_gpus_by_vendor(&filtered_gpus, &args.device.gpu_vendor);
        }
        if !args.device.gpu_name.is_empty() {
            filtered_gpus = gpu::get_gpus_by_device_name(&filtered_gpus, &args.device.gpu_name);
        }
        if args.device.gpu_index > -1 {
            // get single GPU by index
            let gpu_index = args.device.gpu_index as usize;
            if gpu_index >= filtered_gpus.len() {
                return Err(format!(
                    "GPU index {} is out of bounds for available GPUs (0-{})",
                    gpu_index,
                    filtered_gpus.len() - 1
                )
                .into());
            }
            gpus = Vec::from([filtered_gpus[gpu_index].clone()]);
        } else {
            // Filter out unknown vendor GPUs
            gpus = filtered_gpus
                .into_iter()
                .filter(|gpu| *gpu.vendor() != GPUVendor::UNKNOWN)
                .collect();
        }
    }
    if gpus.is_empty() {
        return Err(format!(
            "No GPU(s) found with the specified parameters: vendor='{}', name='{}', index='{}', card_path='{}'",
            args.device.gpu_vendor,
            args.device.gpu_name,
            args.device.gpu_index,
            args.device.gpu_card_path
        ).into());
    }
    Ok(gpus)
}

// Handles picking video encoder
fn handle_encoder_video(
    args: &args::Args,
    gpus: &Vec<GPUInfo>,
) -> Result<enc_helper::VideoEncoderInfo, Box<dyn Error>> {
    tracing::info!("Getting compatible video encoders..");
    let video_encoders = enc_helper::get_compatible_encoders(gpus);
    if video_encoders.is_empty() {
        return Err("No compatible video encoders found".into());
    }
    for encoder in &video_encoders {
        tracing::info!(
            "> [Video Encoder] Name: '{}', Codec: '{}', API: '{}', Type: '{}', Device: '{}'",
            encoder.name,
            encoder.codec.as_str(),
            encoder.encoder_api.to_str(),
            encoder.encoder_type.as_str(),
            if let Some(gpu) = &encoder.gpu_info {
                gpu.device_name()
            } else {
                "CPU"
            },
        );
    }
    // Pick most suitable video encoder based on given arguments
    let video_encoder;
    if !args.encoding.video.encoder.is_empty() {
        video_encoder =
            enc_helper::get_encoder_by_name(&video_encoders, &args.encoding.video.encoder)?;
    } else {
        video_encoder = enc_helper::get_best_working_encoder(
            &video_encoders,
            &args.encoding.video.codec,
            &args.encoding.video.encoder_type,
            args.app.dma_buf,
        )?;
    }
    tracing::info!("Selected video encoder: '{}'", video_encoder.name);
    Ok(video_encoder)
}

// Handles picking preferred settings for video encoder
fn handle_encoder_video_settings(
    args: &args::Args,
    video_encoder: &enc_helper::VideoEncoderInfo,
) -> enc_helper::VideoEncoderInfo {
    let mut optimized_encoder = enc_helper::encoder_low_latency_params(
        &video_encoder,
        &args.encoding.video.rate_control,
        args.app.framerate,
    );
    // Handle rate-control method
    match &args.encoding.video.rate_control {
        encoding_args::RateControl::CQP(cqp) => {
            optimized_encoder = enc_helper::encoder_cqp_params(&optimized_encoder, cqp.quality);
        }
        encoding_args::RateControl::VBR(vbr) => {
            optimized_encoder = enc_helper::encoder_vbr_params(
                &optimized_encoder,
                vbr.target_bitrate,
                vbr.max_bitrate,
            );
        }
        encoding_args::RateControl::CBR(cbr) => {
            optimized_encoder =
                enc_helper::encoder_cbr_params(&optimized_encoder, cbr.target_bitrate);
        }
    }
    tracing::info!(
        "Selected video encoder settings: '{}'",
        optimized_encoder.get_parameters_string()
    );
    optimized_encoder
}

// Handles picking audio encoder
// TODO: Expand enc_helper with audio types, for now just opus
fn handle_encoder_audio(args: &args::Args) -> String {
    let audio_encoder = if args.encoding.audio.encoder.is_empty() {
        "opusenc".to_string()
    } else {
        args.encoding.audio.encoder.clone()
    };
    tracing::info!("Selected audio encoder: '{}'", audio_encoder);
    audio_encoder
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // Parse command line arguments
    let mut args = args::Args::new();

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::builder()
                .with_default_directive(LevelFilter::INFO.into())
                .from_env()?,
        )
        .init();

    if args.app.verbose {
        args.debug_print();
    }

    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("Failed to install ring crypto provider");

    // Get relay URL from arguments
    let relay_url = args.app.relay_url.trim();

    // Initialize libp2p (logically the sink should handle the connection to be independent)
    let nestri_p2p = Arc::new(NestriP2P::new().await?);
    let p2p_conn = nestri_p2p.connect(relay_url).await?;

    gstreamer::init()?;
    let _ = gstrswebrtc::plugin_register_static(); // Might be already registered, so we'll pass..

    if args.app.dma_buf {
        if args.encoding.video.encoder_type != EncoderType::HARDWARE {
            tracing::warn!("DMA-BUF is only supported with hardware encoders, disabling DMA-BUF..");
            args.app.dma_buf = false;
        } else {
            tracing::warn!(
                "DMA-BUF is experimental, it may or may not improve performance, or even work at all."
            );
        }
    }

    // Handle GPU selection
    let gpus = match handle_gpus(&args) {
        Ok(gpu) => gpu,
        Err(e) => {
            tracing::error!("Failed to find a suitable GPU: {}", e);
            return Err(e);
        }
    };

    // Handle video encoder selection
    let mut video_encoder_info = match handle_encoder_video(&args, &gpus) {
        Ok(encoder) => encoder,
        Err(e) => {
            tracing::error!("Failed to find a suitable video encoder: {}", e);
            return Err(e);
        }
    };

    // Handle video encoder settings
    video_encoder_info = handle_encoder_video_settings(&args, &video_encoder_info);

    // Handle audio encoder selection
    let audio_encoder = handle_encoder_audio(&args);

    /*** PIPELINE CREATION ***/
    // Create the pipeline
    let pipeline = Arc::new(gstreamer::Pipeline::new());

    /* Audio */
    // Audio Source Element
    let audio_source = match args.encoding.audio.capture_method {
        encoding_args::AudioCaptureMethod::PULSEAUDIO => {
            gstreamer::ElementFactory::make("pulsesrc").build()?
        }
        encoding_args::AudioCaptureMethod::PIPEWIRE => {
            gstreamer::ElementFactory::make("pipewiresrc").build()?
        }
        encoding_args::AudioCaptureMethod::ALSA => {
            gstreamer::ElementFactory::make("alsasrc").build()?
        }
    };

    // Audio Converter Element
    let audio_converter = gstreamer::ElementFactory::make("audioconvert").build()?;

    // Audio Rate Element
    let audio_rate = gstreamer::ElementFactory::make("audiorate").build()?;

    // Required to fix gstreamer opus issue, where quality sounds off (due to wrong sample rate)
    let audio_capsfilter = gstreamer::ElementFactory::make("capsfilter").build()?;
    let audio_caps = gstreamer::Caps::from_str("audio/x-raw,rate=48000,channels=2").unwrap();
    audio_capsfilter.set_property("caps", &audio_caps);

    // Audio Encoder Element
    let audio_encoder = gstreamer::ElementFactory::make(audio_encoder.as_str()).build()?;
    audio_encoder.set_property(
        "bitrate",
        &match &args.encoding.audio.rate_control {
            encoding_args::RateControl::CBR(cbr) => cbr.target_bitrate.saturating_mul(1000) as i32,
            encoding_args::RateControl::VBR(vbr) => vbr.target_bitrate.saturating_mul(1000) as i32,
            _ => 128000i32,
        },
    );
    // If has "frame-size" (opus), set to 10 for lower latency (below 10 seems to be too low?)
    if audio_encoder.has_property("frame-size", None) {
        audio_encoder.set_property_from_str("frame-size", "10");
    }

    // Audio parse Element
    let mut audio_parser = None;
    if audio_encoder.name() == "opusenc" {
        // Opus encoder requires a parser
        audio_parser = Some(gstreamer::ElementFactory::make("opusparse").build()?);
    }

    /* Video */
    // Video Source Element
    let video_source = Arc::new(gstreamer::ElementFactory::make("waylanddisplaysrc").build()?);
    if let Some(gpu_info) = &video_encoder_info.gpu_info {
        video_source.set_property_from_str("render-node", gpu_info.render_path());
    }

    // Caps Filter Element (resolution, fps)
    let caps_filter = gstreamer::ElementFactory::make("capsfilter").build()?;
    let caps = gstreamer::Caps::from_str(&format!(
        "{},width={},height={},framerate={}/1{}",
        if args.app.dma_buf {
            "video/x-raw(memory:DMABuf)"
        } else {
            "video/x-raw"
        },
        args.app.resolution.0,
        args.app.resolution.1,
        args.app.framerate,
        if args.app.dma_buf { "" } else { ",format=RGBx" }
    ))?;
    caps_filter.set_property("caps", &caps);

    // GL and CUDA elements (NVIDIA only..)
    let mut glupload = None;
    let mut glconvert = None;
    let mut gl_caps_filter = None;
    let mut cudaupload = None;
    if args.app.dma_buf && video_encoder_info.encoder_api == EncoderAPI::NVENC {
        // GL upload element
        glupload = Some(gstreamer::ElementFactory::make("glupload").build()?);
        // GL color convert element
        glconvert = Some(gstreamer::ElementFactory::make("glcolorconvert").build()?);
        // GL color convert caps
        let caps_filter = gstreamer::ElementFactory::make("capsfilter").build()?;
        let gl_caps = gstreamer::Caps::from_str("video/x-raw(memory:GLMemory),format=NV12")?;
        caps_filter.set_property("caps", &gl_caps);
        gl_caps_filter = Some(caps_filter);
        // CUDA upload element
        cudaupload = Some(gstreamer::ElementFactory::make("cudaupload").build()?);
    }

    // vapostproc for VA compatible encoders
    let mut vapostproc = None;
    let mut va_caps_filter = None;
    if video_encoder_info.encoder_api == EncoderAPI::VAAPI
        || video_encoder_info.encoder_api == EncoderAPI::QSV
    {
        vapostproc = Some(gstreamer::ElementFactory::make("vapostproc").build()?);
        // VA caps filter
        let caps_filter = gstreamer::ElementFactory::make("capsfilter").build()?;
        let va_caps = gstreamer::Caps::from_str("video/x-raw(memory:VAMemory),format=NV12")?;
        caps_filter.set_property("caps", &va_caps);
        va_caps_filter = Some(caps_filter);
    }

    // Video Converter Element
    let mut video_converter = None;
    if !args.app.dma_buf {
        video_converter = Some(gstreamer::ElementFactory::make("videoconvert").build()?);
    }

    // Video Encoder Element
    let video_encoder =
        gstreamer::ElementFactory::make(video_encoder_info.name.as_str()).build()?;
    video_encoder_info.apply_parameters(&video_encoder, args.app.verbose);

    // Video parser Element
    let video_parser;
    match video_encoder_info.codec {
        enc_helper::VideoCodec::H264 => {
            video_parser = Some(
                gstreamer::ElementFactory::make("h264parse")
                    .property("config-interval", -1i32)
                    .build()?,
            );
        }
        enc_helper::VideoCodec::H265 => {
            video_parser = Some(
                gstreamer::ElementFactory::make("h265parse")
                    .property("config-interval", -1i32)
                    .build()?,
            );
        }
        _ => {
            video_parser = None;
        }
    }

    /* Output */
    // WebRTC sink Element
    let signaller =
        NestriSignaller::new(args.app.room, p2p_conn.clone(), video_source.clone()).await?;
    let webrtcsink = BaseWebRTCSink::with_signaller(Signallable::from(signaller.clone()));
    webrtcsink.set_property_from_str("stun-server", "stun://stun.l.google.com:19302");
    webrtcsink.set_property_from_str("congestion-control", "disabled");
    webrtcsink.set_property("do-retransmission", false);

    /* Queues */
    let video_queue = gstreamer::ElementFactory::make("queue2")
        .property("max-size-buffers", 3u32)
        .property("max-size-time", 0u64)
        .property("max-size-bytes", 0u32)
        .build()?;

    let audio_queue = gstreamer::ElementFactory::make("queue2")
        .property("max-size-buffers", 3u32)
        .property("max-size-time", 0u64)
        .property("max-size-bytes", 0u32)
        .build()?;

    /* Clock Sync */
    let video_clocksync = gstreamer::ElementFactory::make("clocksync")
        .property("sync-to-first", true)
        .build()?;

    let audio_clocksync = gstreamer::ElementFactory::make("clocksync")
        .property("sync-to-first", true)
        .build()?;

    // Add elements to the pipeline
    pipeline.add_many(&[
        webrtcsink.upcast_ref(),
        &video_encoder,
        &caps_filter,
        &video_queue,
        &video_clocksync,
        &video_source,
        &audio_encoder,
        &audio_capsfilter,
        &audio_queue,
        &audio_clocksync,
        &audio_rate,
        &audio_converter,
        &audio_source,
    ])?;

    if let Some(video_converter) = &video_converter {
        pipeline.add(video_converter)?;
    }

    if let Some(parser) = &audio_parser {
        pipeline.add(parser)?;
    }

    if let Some(parser) = &video_parser {
        pipeline.add(parser)?;
    }

    // If DMA-BUF..
    if args.app.dma_buf {
        // VA-API / QSV pipeline
        if let (Some(vapostproc), Some(va_caps_filter)) = (&vapostproc, &va_caps_filter) {
            pipeline.add_many(&[vapostproc, va_caps_filter])?;
        } else {
            // NVENC pipeline
            if let (Some(glupload), Some(glconvert), Some(gl_caps_filter), Some(cudaupload)) =
                (&glupload, &glconvert, &gl_caps_filter, &cudaupload)
            {
                pipeline.add_many(&[glupload, glconvert, gl_caps_filter, cudaupload])?;
            }
        }
    }

    // Link main audio branch
    gstreamer::Element::link_many(&[
        &audio_source,
        &audio_converter,
        &audio_rate,
        &audio_capsfilter,
        &audio_queue,
        &audio_clocksync,
        &audio_encoder,
    ])?;

    // Link audio parser to audio encoder if present, otherwise just webrtcsink
    if let Some(parser) = &audio_parser {
        gstreamer::Element::link_many(&[&audio_encoder, parser, webrtcsink.upcast_ref()])?;
    } else {
        gstreamer::Element::link_many(&[&audio_encoder, webrtcsink.upcast_ref()])?;
    }

    // With DMA-BUF..
    if args.app.dma_buf {
        // VA-API / QSV pipeline
        if let (Some(vapostproc), Some(va_caps_filter)) = (&vapostproc, &va_caps_filter) {
            gstreamer::Element::link_many(&[
                &video_source,
                &caps_filter,
                &video_queue,
                &video_clocksync,
                &vapostproc,
                &va_caps_filter,
                &video_encoder,
            ])?;
        } else {
            // NVENC pipeline
            if let (Some(glupload), Some(glconvert), Some(gl_caps_filter), Some(cudaupload)) =
                (&glupload, &glconvert, &gl_caps_filter, &cudaupload)
            {
                gstreamer::Element::link_many(&[
                    &video_source,
                    &caps_filter,
                    &video_queue,
                    &video_clocksync,
                    &glupload,
                    &glconvert,
                    &gl_caps_filter,
                    &cudaupload,
                    &video_encoder,
                ])?;
            }
        }
    } else {
        gstreamer::Element::link_many(&[
            &video_source,
            &caps_filter,
            &video_queue,
            &video_clocksync,
            &video_converter.unwrap(),
            &video_encoder,
        ])?;
    }

    // Link video parser if present with webrtcsink, otherwise just link webrtc sink
    if let Some(parser) = &video_parser {
        gstreamer::Element::link_many(&[&video_encoder, parser, webrtcsink.upcast_ref()])?;
    } else {
        gstreamer::Element::link_many(&[&video_encoder, webrtcsink.upcast_ref()])?;
    }

    // Set QOS
    video_encoder.set_property("qos", true);

    // Optimize latency of pipeline
    video_source
        .sync_state_with_parent()
        .expect("failed to sync with parent");
    video_source.set_property("do-timestamp", &true);
    audio_source.set_property("do-timestamp", &true);

    pipeline.set_property("latency", &0u64);
    pipeline.set_property("async-handling", true);
    pipeline.set_property("message-forward", true);

    // Run both pipeline and websocket tasks concurrently
    let result = run_pipeline(pipeline.clone()).await;

    match result {
        Ok(_) => tracing::info!("All tasks finished"),
        Err(e) => {
            tracing::error!("Error occurred in one of the tasks: {}", e);
            return Err("Error occurred in one of the tasks".into());
        }
    }

    // Clean up
    tracing::info!("Exiting gracefully..");

    Ok(())
}

async fn run_pipeline(pipeline: Arc<gstreamer::Pipeline>) -> Result<(), Box<dyn Error>> {
    let bus = { pipeline.bus().ok_or("Pipeline has no bus")? };

    {
        if let Err(e) = pipeline.set_state(gstreamer::State::Playing) {
            tracing::error!("Failed to start pipeline: {}", e);
            return Err("Failed to start pipeline".into());
        }
    }

    // Wait for EOS or error (don't lock the pipeline indefinitely)
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            tracing::info!("Pipeline interrupted via Ctrl+C");
        }
        result = listen_for_gst_messages(bus) => {
            match result {
                Ok(_) => tracing::info!("Pipeline finished with EOS"),
                Err(err) => tracing::error!("Pipeline error: {}", err),
            }
        }
    }

    {
        pipeline.set_state(gstreamer::State::Null)?;
    }

    Ok(())
}

async fn listen_for_gst_messages(bus: gstreamer::Bus) -> Result<(), Box<dyn Error>> {
    let bus_stream = bus.stream();

    tokio::pin!(bus_stream);

    while let Some(msg) = bus_stream.next().await {
        match msg.view() {
            gstreamer::MessageView::Eos(_) => {
                tracing::info!("Received EOS");
                break;
            }
            gstreamer::MessageView::Error(err) => {
                let err_msg = format!(
                    "Error from {:?}: {:?}",
                    err.src().map(|s| s.path_string()),
                    err.error()
                );
                return Err(err_msg.into());
            }
            _ => (),
        }
    }

    Ok(())
}
