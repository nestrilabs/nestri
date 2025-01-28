mod args;
mod enc_helper;
mod gpu;
mod latency;
mod messages;
mod nestrisink;
mod websocket;
mod proto;

use crate::args::encoding_args;
use crate::nestrisink::NestriSignaller;
use crate::websocket::NestriWebSocket;
use futures_util::StreamExt;
use gst::prelude::*;
use gstrswebrtc::signaller::Signallable;
use gstrswebrtc::webrtcsink::BaseWebRTCSink;
use std::error::Error;
use std::str::FromStr;
use std::sync::Arc;

// Handles gathering GPU information and selecting the most suitable GPU
fn handle_gpus(args: &args::Args) -> Option<gpu::GPUInfo> {
    println!("Gathering GPU information..");
    let gpus = gpu::get_gpus();
    if gpus.is_empty() {
        println!("No GPUs found");
        return None;
    }
    for gpu in &gpus {
        println!(
            "> [GPU] Vendor: '{}', Card Path: '{}', Render Path: '{}', Device Name: '{}'",
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
        if args.device.gpu_index != 0 {
            // get single GPU by index
            gpu = filtered_gpus.get(args.device.gpu_index as usize).cloned();
        } else {
            // get first GPU
            gpu = filtered_gpus.get(0).cloned();
        }
    }
    if gpu.is_none() {
        println!("No GPU found with the specified parameters: vendor='{}', name='{}', index='{}', card_path='{}'",
                 args.device.gpu_vendor, args.device.gpu_name, args.device.gpu_index, args.device.gpu_card_path);
        return None;
    }
    let gpu = gpu.unwrap();
    println!("Selected GPU: '{}'", gpu.device_name());
    Some(gpu)
}

// Handles picking video encoder
fn handle_encoder_video(args: &args::Args) -> Option<enc_helper::VideoEncoderInfo> {
    println!("Getting compatible video encoders..");
    let video_encoders = enc_helper::get_compatible_encoders();
    if video_encoders.is_empty() {
        println!("No compatible video encoders found");
        return None;
    }
    for encoder in &video_encoders {
        println!(
            "> [Video Encoder] Name: '{}', Codec: '{}', API: '{}', Type: '{}'",
            encoder.name,
            encoder.codec.to_str(),
            encoder.encoder_api.to_str(),
            encoder.encoder_type.to_str()
        );
    }
    // Pick most suitable video encoder based on given arguments
    let video_encoder;
    if !args.encoding.video.encoder.is_empty() {
        video_encoder =
            enc_helper::get_encoder_by_name(&video_encoders, &args.encoding.video.encoder);
    } else {
        video_encoder = enc_helper::get_best_compatible_encoder(
            &video_encoders,
            enc_helper::VideoCodec::from_str(&args.encoding.video.codec),
            enc_helper::EncoderType::from_str(&args.encoding.video.encoder_type),
        );
    }
    if video_encoder.is_none() {
        println!("No video encoder found with the specified parameters: name='{}', vcodec='{}', type='{}'",
                 args.encoding.video.encoder, args.encoding.video.codec, args.encoding.video.encoder_type);
        return None;
    }
    let video_encoder = video_encoder.unwrap();
    println!("Selected video encoder: '{}'", video_encoder.name);
    Some(video_encoder)
}

// Handles picking preferred settings for video encoder
fn handle_encoder_video_settings(
    args: &args::Args,
    video_encoder: &enc_helper::VideoEncoderInfo,
) -> enc_helper::VideoEncoderInfo {
    let mut optimized_encoder = enc_helper::encoder_low_latency_params(&video_encoder);
    // Handle rate-control method
    match &args.encoding.video.rate_control {
        encoding_args::RateControl::CQP(cqp) => {
            optimized_encoder = enc_helper::encoder_cqp_params(&optimized_encoder, cqp.quality);
        }
        encoding_args::RateControl::VBR(vbr) => {
            optimized_encoder = enc_helper::encoder_vbr_params(
                &optimized_encoder,
                vbr.target_bitrate as u32,
                vbr.max_bitrate as u32,
            );
        }
        encoding_args::RateControl::CBR(cbr) => {
            optimized_encoder =
                enc_helper::encoder_cbr_params(&optimized_encoder, cbr.target_bitrate as u32);
        }
    }
    println!(
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
    println!("Selected audio encoder: '{}'", audio_encoder);
    audio_encoder
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // Parse command line arguments
    let args = args::Args::new();
    if args.app.verbose {
        args.debug_print();
    }

    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("Failed to install ring crypto provider");

    // Begin connection attempt to the relay WebSocket endpoint
    // replace any http/https with ws/wss
    let replaced_relay_url = args
        .app
        .relay_url
        .replace("http://", "ws://")
        .replace("https://", "wss://");
    let ws_url = format!("{}/api/ws/{}", replaced_relay_url, args.app.room,);

    // Setup our websocket
    let nestri_ws = Arc::new(NestriWebSocket::new(ws_url).await?);
    log::set_max_level(log::LevelFilter::Info);
    log::set_boxed_logger(Box::new(nestri_ws.clone())).unwrap();

    gst::init()?;
    gstrswebrtc::plugin_register_static()?;

    // Handle GPU selection
    let gpu = handle_gpus(&args);
    if gpu.is_none() {
        log::error!("Failed to find a suitable GPU. Exiting..");
        return Err("Failed to find a suitable GPU. Exiting..".into());
    }
    let gpu = gpu.unwrap();

    // Handle video encoder selection
    let video_encoder_info = handle_encoder_video(&args);
    if video_encoder_info.is_none() {
        log::error!("Failed to find a suitable video encoder. Exiting..");
        return Err("Failed to find a suitable video encoder. Exiting..".into());
    }
    let mut video_encoder_info = video_encoder_info.unwrap();
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
        encoding_args::AudioCaptureMethod::PulseAudio => {
            gst::ElementFactory::make("pulsesrc").build()?
        }
        encoding_args::AudioCaptureMethod::PipeWire => {
            gst::ElementFactory::make("pipewiresrc").build()?
        }
        _ => gst::ElementFactory::make("alsasrc").build()?,
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
            encoding_args::RateControl::CBR(cbr) => cbr.target_bitrate * 1000i32,
            encoding_args::RateControl::VBR(vbr) => vbr.target_bitrate * 1000i32,
            _ => 128i32,
        },
    );

    /* Video */
    // Video Source Element
    let video_source = gst::ElementFactory::make("waylanddisplaysrc").build()?;
    video_source.set_property("render-node", &gpu.render_path());

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

    // GL Upload Element
    let glupload = gst::ElementFactory::make("glupload").build()?;

    // GL upload caps filter
    let gl_caps_filter = gst::ElementFactory::make("capsfilter").build()?;
    let gl_caps = gst::Caps::from_str("video/x-raw(memory:VAMemory)")?;
    gl_caps_filter.set_property("caps", &gl_caps);

    // Video Converter Element
    let video_converter = gst::ElementFactory::make("videoconvert").build()?;

    // Video Encoder Element
    let video_encoder = gst::ElementFactory::make(video_encoder_info.name.as_str()).build()?;
    video_encoder_info.apply_parameters(&video_encoder, &args.app.verbose);

    /* Output */
    // WebRTC sink Element
    let signaller = NestriSignaller::new(nestri_ws.clone(), pipeline.clone());
    let webrtcsink = BaseWebRTCSink::with_signaller(Signallable::from(signaller.clone()));
    webrtcsink.set_property_from_str("stun-server", "stun://stun.l.google.com:19302");
    webrtcsink.set_property_from_str("congestion-control", "disabled");

    // Add elements to the pipeline
    pipeline.add_many(&[
        webrtcsink.upcast_ref(),
        &video_encoder,
        &video_converter,
        &caps_filter,
        &video_source,
        &audio_encoder,
        &audio_capsfilter,
        &audio_rate,
        &audio_converter,
        &audio_source,
    ])?;

    // If DMA-BUF is enabled, add glupload and gl caps filter
    if args.app.dma_buf {
        pipeline.add_many(&[&glupload, &gl_caps_filter])?;
    }

    // Link main audio branch
    gst::Element::link_many(&[
        &audio_source,
        &audio_converter,
        &audio_rate,
        &audio_capsfilter,
        &audio_encoder,
        webrtcsink.upcast_ref(),
    ])?;

    // With DMA-BUF, also link glupload and it's caps
    if args.app.dma_buf {
        // Link video source to caps_filter, glupload, gl_caps_filter, video_converter, video_encoder, webrtcsink
        gst::Element::link_many(&[
            &video_source,
            &caps_filter,
            &glupload,
            &gl_caps_filter,
            &video_converter,
            &video_encoder,
            webrtcsink.upcast_ref(),
        ])?;
    } else {
        // Link video source to caps_filter, video_converter, video_encoder, webrtcsink
        gst::Element::link_many(&[
            &video_source,
            &caps_filter,
            &video_converter,
            &video_encoder,
            webrtcsink.upcast_ref(),
        ])?;
    }

    // Optimize latency of pipeline
    video_source.sync_state_with_parent().expect("failed to sync with parent");
    video_source.set_property("do-timestamp", &true);
    audio_source.set_property("do-timestamp", &true);
    pipeline.set_property("latency", &0u64);

    // Run both pipeline and websocket tasks concurrently
    let result = run_pipeline(pipeline.clone()).await;

    match result {
        Ok(_) => log::info!("All tasks completed successfully"),
        Err(e) => {
            log::error!("Error occurred in one of the tasks: {}", e);
            return Err("Error occurred in one of the tasks".into());
        }
    }

    Ok(())
}

async fn run_pipeline(pipeline: Arc<gst::Pipeline>) -> Result<(), Box<dyn Error>> {
    let bus = { pipeline.bus().ok_or("Pipeline has no bus")? };

    {
        if let Err(e) = pipeline.set_state(gst::State::Playing) {
            log::error!("Failed to start pipeline: {}", e);
            return Err("Failed to start pipeline".into());
        }
    }

    // Wait for EOS or error (don't lock the pipeline indefinitely)
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            log::info!("Pipeline interrupted via Ctrl+C");
        }
        result = listen_for_gst_messages(bus) => {
            match result {
                Ok(_) => log::info!("Pipeline finished with EOS"),
                Err(err) => log::error!("Pipeline error: {}", err),
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
                log::info!("Received EOS");
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
