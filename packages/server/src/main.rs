mod args;
mod enc_helper;
mod gpu;

use std::sync::Arc;
use gst::prelude::*;
use crate::args::{encoding_args, output_args};
mod room;

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
        video_encoder = enc_helper::get_encoder_by_name(&video_encoders, &args.encoding.video.encoder);
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
fn handle_encoder_video_settings(args: &args::Args, video_encoder: &enc_helper::VideoEncoderInfo) -> enc_helper::VideoEncoderInfo {
    let mut optimized_encoder = enc_helper::encoder_low_latency_params(&video_encoder);
    // Handle rate-control method
    match &args.encoding.video.rate_control {
        encoding_args::RateControl::CQP(cqp) => {
            optimized_encoder = enc_helper::encoder_cqp_params(&optimized_encoder, cqp.quality);
        }
        encoding_args::RateControl::VBR(vbr) => {
            optimized_encoder = enc_helper::encoder_vbr_params(&optimized_encoder, vbr.target_bitrate, vbr.max_bitrate);
        }
        encoding_args::RateControl::CBR(cbr) => {
            optimized_encoder = enc_helper::encoder_cbr_params(&optimized_encoder, cbr.target_bitrate);
        }
    }
    println!("Selected video encoder settings: '{}'", optimized_encoder.get_parameters_string());
    optimized_encoder
}

// Handles picking audio encoder
// TODO: Expand enc_helper with audio types, for now just AAC or opus
fn handle_encoder_audio(args: &args::Args, output_option: &output_args::OutputOption) -> String {
    let audio_encoder = if args.encoding.audio.encoder.is_empty() {
        if let output_args::OutputOption::MoQ(_) = output_option {
            "faac".to_string()
        } else {
            "opusenc".to_string()
        }
    } else {
        args.encoding.audio.encoder.clone()
    };
    println!("Selected audio encoder: '{}'", audio_encoder);
    audio_encoder
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let args = args::Args::new();
    if args.app.verbose {
        args.debug_print();
    }

    rustls::crypto::ring::default_provider().install_default()
        .expect("Failed to install ring crypto provider");

    let _ = gst::init();
    let _ = gstmoq::plugin_register_static();

    // Handle GPU selection
    let gpu = handle_gpus(&args);
    if gpu.is_none() {
        println!("Failed to find a suitable GPU. Exiting..");
        return Ok(());
    }
    let gpu = gpu.unwrap();

    // Handle video encoder selection
    let video_encoder = handle_encoder_video(&args);
    if video_encoder.is_none() {
        println!("Failed to find a suitable video encoder. Exiting..");
        return Ok(());
    }
    let mut video_encoder = video_encoder.unwrap();
    // Handle video encoder settings
    video_encoder = handle_encoder_video_settings(&args, &video_encoder);

    // Handle audio encoder selection
    let audio_encoder = handle_encoder_audio(&args, &args.output);


    // Get output option
    let mut output_pipeline: String = "".to_string();
    if let output_args::OutputOption::MoQ(moqargs) = &args.output {
        output_pipeline = format!(
            "
            ! isofmp4mux chunk-duration=1 fragment-duration=1 name=pipend \
            ! moqsink url={} broadcast={}
            ",
            moqargs.relay_url, args.app.room
        );
    } else if let output_args::OutputOption::WHIP(whipargs) = &args.output {
        output_pipeline = format!(
            "
            ! whipclientsink name=pipend signaller::whip-endpoint=\"{}/api/whip/{}\" signaller::auth-token=\"{}\" congestion-control=disabled
            ",
            whipargs.endpoint, args.app.room, whipargs.auth_token
        );
    }

    // Debug-latency
    let mut debug_feed = "";
    if args.app.debug_latency {
        debug_feed = "! timeoverlay halignment=right valignment=bottom"
    }

    // Additional sink for debugging
    let mut debug_sink = "";
    if args.app.debug_feed {
        debug_sink = "dfee. ! queue2 max-size-time=1000000 ! videoconvert ! ximagesink"
    }

    // Audio sub-pipeline
    let audio_pipeline = format!("
        {}
        ! queue2 max-size-time=1000000 ! audioconvert \
        ! {} bitrate={}000 \
        ! pipend.",
        if args.encoding.audio.capture_method == encoding_args::AudioCaptureMethod::PulseAudio {
            "pulsesrc"
        } else if args.encoding.audio.capture_method == encoding_args::AudioCaptureMethod::PipeWire {
            "pipewiresrc"
        } else {
            "alsasrc"
        },
        audio_encoder,
        match &args.encoding.audio.rate_control {
            encoding_args::RateControl::CBR(cbr) => cbr.target_bitrate,
            encoding_args::RateControl::VBR(vbr) => vbr.target_bitrate,
            _ => 128,
        }
    ).to_string();

    // Construct the pipeline string
    let pipeline_str = format!(
        "
        waylanddisplaysrc render-node={} \
        ! video/x-raw,width={},height={},framerate={}/1,format=RGBx \
        {debug_feed} ! tee name=dfee \
        ! queue2 max-size-time=1000000 ! videoconvert \
        ! {} {} \
        {output_pipeline} \
        {audio_pipeline} \
        {debug_sink}
        ",
        gpu.render_path(),
        args.app.resolution.0,
        args.app.resolution.1,
        args.app.framerate,
        video_encoder.name,
        video_encoder.get_parameters_string(),
    );

    // If verbose, print out the pipeline string
    if args.app.verbose {
        println!("Constructed pipeline string: {}", pipeline_str);
    }

    // Create the pipeline
    let pipeline = gst::parse::launch(pipeline_str.as_str())
        .unwrap()
        .downcast::<gst::Pipeline>()
        .unwrap();

    let _ = pipeline.set_state(gst::State::Playing);
    let pipeline_clone = Arc::new(tokio::sync::Mutex::new(pipeline.clone()));

    let pipeline_thread = pipeline.clone();

    std::thread::spawn(move || {
        let bus = pipeline_thread
            .bus()
            .expect("Pipeline without bus. Shouldn't happen!");

        for msg in bus.iter_timed(gst::ClockTime::NONE) {
            use gst::MessageView;

            match msg.view() {
                MessageView::Eos(..) => {
                    println!("EOS");
                    break;
                }
                MessageView::Error(err) => {
                    let _ = pipeline_thread.set_state(gst::State::Null);
                    eprintln!(
                        "Got error from {}: {} ({})",
                        msg.src()
                            .map(|s| String::from(s.path_string()))
                            .unwrap_or_else(|| "None".into()),
                        err.error(),
                        err.debug().unwrap_or_else(|| "".into()),
                    );
                    break;
                }
                _ => (),
            }
        }

        let _ = pipeline.set_state(gst::State::Null);
    });

    // Get a room
    let mut relay_url = "".to_string();
    if let output_args::OutputOption::WHIP(whipargs) = &args.output {
        relay_url = format!(
            "
            {}/api/whep/{}
            ",
            whipargs.endpoint, args.app.room
        );
    }
    let mut room_handler = room::Room::new(relay_url, pipeline_clone).await?;
    room_handler.run().await?;

    Ok(())
}
