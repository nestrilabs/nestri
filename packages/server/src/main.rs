mod args;
mod enc_helper;
mod gpu;
mod latency;
mod messages;
mod nestrisink;
mod p2p;
mod proto;

use crate::args::encoding_args;
use crate::enc_helper::EncoderType;
use crate::gpu::GPUVendor;
use crate::nestrisink::NestriSignaller;
use crate::p2p::p2p::NestriP2P;
use futures_util::StreamExt;
use gst::prelude::*;
use gstrswebrtc::signaller::Signallable;
use gstrswebrtc::webrtcsink::BaseWebRTCSink;
use std::error::Error;
use std::str::FromStr;
use std::sync::Arc;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::filter::LevelFilter;

// Handles gathering GPU information and selecting the most suitable GPU
fn handle_gpus(args: &args::Args) -> Result<gpu::GPUInfo, Box<dyn Error>> {
    tracing::info!("Gathering GPU information..");
    let gpus = gpu::get_gpus();
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

    // Based on available arguments, pick a GPU
    let gpu;
    if !args.device.gpu_card_path.is_empty() {
        gpu = gpu::get_gpu_by_card_path(&gpus, &args.device.gpu_card_path);
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
            gpu = gpu::get_gpu_by_index(&filtered_gpus, args.device.gpu_index).or_else(|| {
                tracing::warn!("GPU index {} is out of range", args.device.gpu_index);
                None
            });
        } else {
            // get first GPU
            gpu = filtered_gpus
                .into_iter()
                .find(|g| *g.vendor() != GPUVendor::UNKNOWN);
        }
    }
    if gpu.is_none() {
        return Err(format!(
            "No GPU found with the specified parameters: vendor='{}', name='{}', index='{}', card_path='{}'",
            args.device.gpu_vendor,
            args.device.gpu_name,
            args.device.gpu_index,
            args.device.gpu_card_path
        ).into());
    }
    let gpu = gpu.unwrap();
    tracing::info!("Selected GPU: '{}'", gpu.device_name());
    Ok(gpu)
}

// Handles picking video encoder
fn handle_encoder_video(args: &args::Args) -> Result<enc_helper::VideoEncoderInfo, Box<dyn Error>> {
    tracing::info!("Getting compatible video encoders..");
    let video_encoders = enc_helper::get_compatible_encoders();
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
        video_encoder = enc_helper::get_best_compatible_encoder(
            &video_encoders,
            &args.encoding.video.codec,
            &args.encoding.video.encoder_type,
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

    gst::init()?;
    gstrswebrtc::plugin_register_static()?;

    // Handle GPU selection
    let gpu = match handle_gpus(&args) {
        Ok(gpu) => gpu,
        Err(e) => {
            tracing::error!("Failed to find a suitable GPU: {}", e);
            return Err(e);
        }
    };

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

    // Handle video encoder selection
    let mut video_encoder_info = match handle_encoder_video(&args) {
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
    let pipeline = Arc::new(gst::Pipeline::new());

    /* Audio */
    // Audio Source Element
    let audio_source = match args.encoding.audio.capture_method {
        encoding_args::AudioCaptureMethod::PULSEAUDIO => {
            gst::ElementFactory::make("pulsesrc").build()?
        }
        encoding_args::AudioCaptureMethod::PIPEWIRE => {
            gst::ElementFactory::make("pipewiresrc").build()?
        }
        encoding_args::AudioCaptureMethod::ALSA => gst::ElementFactory::make("alsasrc").build()?,
    };

    // Audio Converter Element
    let audio_converter = gst::ElementFactory::make("audioconvert").build()?;

    // Audio Rate Element
    let audio_rate = gst::ElementFactory::make("audiorate").build()?;

    // Required to fix gstreamer opus issue, where quality sounds off (due to wrong sample rate)
    let audio_capsfilter = gst::ElementFactory::make("capsfilter").build()?;
    let audio_caps = gst::Caps::from_str("audio/x-raw,rate=48000,channels=2").unwrap();
    audio_capsfilter.set_property("caps", &audio_caps);

    // Audio Encoder Element
    let audio_encoder = gst::ElementFactory::make(audio_encoder.as_str()).build()?;
    audio_encoder.set_property(
        "bitrate",
        &match &args.encoding.audio.rate_control {
            encoding_args::RateControl::CBR(cbr) => cbr.target_bitrate.saturating_mul(1000) as i32,
            encoding_args::RateControl::VBR(vbr) => vbr.target_bitrate.saturating_mul(1000) as i32,
            _ => 128000i32,
        },
    );
    // If has "frame-size" (opus), set to 10 for lower latency (below 10 seems to be too low?)
    if audio_encoder.has_property("frame-size") {
        audio_encoder.set_property_from_str("frame-size", "10");
    }

    /* Video */
    // Video Source Element
    let video_source = Arc::new(gst::ElementFactory::make("waylanddisplaysrc").build()?);
    video_source.set_property_from_str("render-node", gpu.render_path());

    // Caps Filter Element (resolution, fps)
    let caps_filter = gst::ElementFactory::make("capsfilter").build()?;
    let caps = gst::Caps::from_str(&format!(
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

    // GL Upload element
    let glupload = gst::ElementFactory::make("glupload").build()?;

    // GL color convert element
    let glcolorconvert = gst::ElementFactory::make("glcolorconvert").build()?;

    // GL upload caps filter
    let gl_caps_filter = gst::ElementFactory::make("capsfilter").build()?;
    let gl_caps = gst::Caps::from_str("video/x-raw(memory:GLMemory),format=NV12")?;
    gl_caps_filter.set_property("caps", &gl_caps);

    // GL download element (needed only for DMA-BUF outside NVIDIA GPUs)
    let gl_download = gst::ElementFactory::make("gldownload").build()?;

    // Video Converter Element
    let video_converter = gst::ElementFactory::make("videoconvert").build()?;

    // Video Encoder Element
    let video_encoder = gst::ElementFactory::make(video_encoder_info.name.as_str()).build()?;
    video_encoder_info.apply_parameters(&video_encoder, args.app.verbose);

    // Video parser Element, required for GStreamer 1.26 as it broke some things..
    let video_parser;
    if video_encoder_info.codec == enc_helper::VideoCodec::H264 {
        video_parser = Some(
            gst::ElementFactory::make("h264parse")
                .property("config-interval", -1i32)
                .build()?,
        );
    } else {
        video_parser = None;
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
    let video_queue = gst::ElementFactory::make("queue2")
        .property("max-size-buffers", 3u32)
        .property("max-size-time", 0u64)
        .property("max-size-bytes", 0u32)
        .build()?;

    let audio_queue = gst::ElementFactory::make("queue2")
        .property("max-size-buffers", 3u32)
        .property("max-size-time", 0u64)
        .property("max-size-bytes", 0u32)
        .build()?;

    /* Clock Sync */
    let video_clocksync = gst::ElementFactory::make("clocksync")
        .property("sync-to-first", true)
        .build()?;

    let audio_clocksync = gst::ElementFactory::make("clocksync")
        .property("sync-to-first", true)
        .build()?;

    // Add elements to the pipeline
    pipeline.add_many(&[
        webrtcsink.upcast_ref(),
        &video_encoder,
        &video_converter,
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

    if let Some(parser) = &video_parser {
        pipeline.add(parser)?;
    }

    // If DMA-BUF is enabled, add glupload, color conversion and caps filter
    if args.app.dma_buf {
        if *gpu.vendor() == GPUVendor::NVIDIA {
            pipeline.add_many(&[&glupload, &glcolorconvert, &gl_caps_filter])?;
        } else {
            pipeline.add_many(&[&glupload, &glcolorconvert, &gl_caps_filter, &gl_download])?;
        }
    }

    // Link main audio branch
    gst::Element::link_many(&[
        &audio_source,
        &audio_converter,
        &audio_rate,
        &audio_capsfilter,
        &audio_queue,
        &audio_clocksync,
        &audio_encoder,
        webrtcsink.upcast_ref(),
    ])?;

    // With DMA-BUF, also link glupload and it's caps
    if args.app.dma_buf {
        if *gpu.vendor() == GPUVendor::NVIDIA {
            gst::Element::link_many(&[
                &video_source,
                &caps_filter,
                &video_queue,
                &video_clocksync,
                &glupload,
                &glcolorconvert,
                &gl_caps_filter,
                &video_encoder,
            ])?;
        } else {
            gst::Element::link_many(&[
                &video_source,
                &caps_filter,
                &video_queue,
                &video_clocksync,
                &glupload,
                &glcolorconvert,
                &gl_caps_filter,
                &gl_download,
                &video_encoder,
            ])?;
        }
    } else {
        gst::Element::link_many(&[
            &video_source,
            &caps_filter,
            &video_queue,
            &video_clocksync,
            &video_converter,
            &video_encoder,
        ])?;
    }

    // Link video parser if present with webrtcsink, otherwise just link webrtc sink
    if let Some(parser) = &video_parser {
        gst::Element::link_many(&[&video_encoder, parser, webrtcsink.upcast_ref()])?;
    } else {
        gst::Element::link_many(&[&video_encoder, webrtcsink.upcast_ref()])?;
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

    Ok(())
}

async fn run_pipeline(pipeline: Arc<gst::Pipeline>) -> Result<(), Box<dyn Error>> {
    let bus = { pipeline.bus().ok_or("Pipeline has no bus")? };

    {
        if let Err(e) = pipeline.set_state(gst::State::Playing) {
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
        pipeline.set_state(gst::State::Null)?;
    }

    Ok(())
}

async fn listen_for_gst_messages(bus: gst::Bus) -> Result<(), Box<dyn Error>> {
    let bus_stream = bus.stream();

    tokio::pin!(bus_stream);

    while let Some(msg) = bus_stream.next().await {
        match msg.view() {
            gst::MessageView::Eos(_) => {
                tracing::info!("Received EOS");
                break;
            }
            gst::MessageView::Error(err) => {
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
