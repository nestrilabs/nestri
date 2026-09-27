//! Encode and decode latency on the GPU, ours beside the C++ reference's.
//!
//! GPU time from timestamps, not command recording: an earlier measurement in
//! this project counted CPU time spent recording and called it the cost of a
//! pass. Reports only; the numbers depend on the GPU, and the reference's are
//! printed by the reference itself.
//!
//!   NESPYRO_REFERENCE=<harness> cargo test -p nespyro --release --test bench -- --ignored --nocapture

mod common;

use std::process::Command;
use std::time::Instant;

use ash::vk;
use common::{Content, Gpu, reference_ycbcr, rgba8};
use nespyro::{Chroma, DecodeConfig, Decoder, Depth, EncodeConfig, Encoder};

const FRAMES: usize = 120;

fn median(mut v: Vec<f64>) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[v.len() / 2]
}

#[test]
#[ignore = "needs a Vulkan 1.3 GPU and the reference harness (NESPYRO_REFERENCE)"]
fn latency_beside_the_reference() {
    let harness = std::env::var("NESPYRO_REFERENCE")
        .expect("NESPYRO_REFERENCE must name the harness reference/build.sh built");
    let gpu = Gpu::new();
    for &(w, h, chroma) in &[
        (1920, 1080, Chroma::Yuv420),
        (3840, 2160, Chroma::Yuv420),
        (1920, 1080, Chroma::Yuv444),
    ] {
        let rgba = rgba8(Content::Edges, w, h);
        let config = EncodeConfig::new(w, h).with_chroma(chroma);
        let image = gpu.upload(vk::Format::R8G8B8A8_UNORM, w, h, &rgba);
        let mut encoder = Encoder::new(gpu.ctx(), config.clone()).unwrap();
        let mut decoder =
            Decoder::new(gpu.ctx(), DecodeConfig::new(w, h, chroma, Depth::Eight)).unwrap();

        let mut passes: Vec<[f64; 6]> = Vec::new();
        let mut encode_ms = Vec::new();
        let mut encode_cpu_ms = Vec::new();
        let mut decode_ms = Vec::new();
        let mut decode_cpu_ms = Vec::new();
        let mut decode_gpu: Vec<[f64; 3]> = Vec::new();
        for _ in 0..FRAMES {
            let start = Instant::now();
            let f = encoder
                .encode_after(image.image, image.format, vk::ImageLayout::GENERAL, &[])
                .unwrap();
            encode_cpu_ms.push(start.elapsed().as_secs_f64() * 1e3);
            let frame = pollster::block_on(f).unwrap();
            encode_ms.push(start.elapsed().as_secs_f64() * 1e3);
            let s = frame.stats;
            passes.push([
                s.convert_ns,
                s.dwt_ns,
                s.quant_ns,
                s.analyze_ns,
                s.resolve_ns,
                s.packing_ns,
            ]);

            for p in &frame.packets {
                decoder.push_packet(&frame.data[p.clone()]).unwrap();
            }
            let start = Instant::now();
            let decoded = decoder.decode_after(&[]).unwrap();
            decode_cpu_ms.push(start.elapsed().as_secs_f64() * 1e3);
            gpu.wait(decoded.ready);
            decode_ms.push(start.elapsed().as_secs_f64() * 1e3);
            let d = decoder
                .stats()
                .unwrap()
                .expect("the decode is done, so its stats are");
            decode_gpu.push([d.upload_ns, d.dequant_ns, d.idwt_ns]);
        }
        let names = ["convert", "dwt", "quant", "analyze", "resolve", "packing"];
        let medians: Vec<f64> = (0..6)
            .map(|i| median(passes.iter().map(|p| p[i]).collect()) / 1000.0)
            .collect();
        eprintln!("ours {w}x{h} {chroma:?}, median of {FRAMES} frames, GPU µs:");
        for (n, m) in names.iter().zip(&medians) {
            eprintln!("  {n:8} {m:8.1}");
        }
        eprintln!(
            "  encode   {:8.1} (without convert {:.1}); {:.1} submit to packetized, wall clock, of which {:.1} in encode_after",
            medians.iter().sum::<f64>(),
            medians[1..].iter().sum::<f64>(),
            median(encode_ms) * 1000.0,
            median(encode_cpu_ms) * 1000.0
        );
        let d: Vec<f64> = (0..3)
            .map(|i| median(decode_gpu.iter().map(|p| p[i]).collect()) / 1000.0)
            .collect();
        eprintln!("  upload   {:8.1}", d[0]);
        eprintln!("  dequant  {:8.1}", d[1]);
        eprintln!("  idwt     {:8.1}", d[2]);
        eprintln!(
            "  decode   {:8.1} (GPU); {:.1} submit to ready, wall clock, of which {:.1} in decode_after",
            d.iter().sum::<f64>(),
            median(decode_ms) * 1000.0,
            median(decode_cpu_ms) * 1000.0
        );
        drop((encoder, decoder));

        // The reference encodes the same content, converted on the CPU.
        let yuv = std::env::temp_dir().join(format!("nespyro-bench-{}.yuv", std::process::id()));
        let planes = reference_ycbcr(&rgba, w, h, chroma == Chroma::Yuv420, false);
        let bytes: Vec<u8> = planes
            .iter()
            .flatten()
            .map(|v| (v * 255.0).round() as u8)
            .collect();
        std::fs::write(&yuv, bytes).unwrap();
        let target = (config.target_bitrate / 60 / 8) & !3;
        let out = Command::new(&harness)
            .args([
                "bench",
                &w.to_string(),
                &h.to_string(),
                if chroma == Chroma::Yuv420 {
                    "420"
                } else {
                    "444"
                },
                &target.to_string(),
                &FRAMES.to_string(),
                yuv.to_str().unwrap(),
            ])
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        eprintln!(
            "reference {w}x{h} {chroma:?}:\n{}",
            String::from_utf8_lossy(&out.stdout)
        );
    }
    gpu.assert_clean();
}
