//! The encoder on a real GPU, checked without the decoder: every block it
//! writes must pass the depacketizer's structural check, which recomputes
//! each block's size from its own contents.

mod common;

use ash::vk;
use common::{Content, Gpu, rgba8};
use nespyro::bitstream::{Depacketizer, Layout, Push};
use nespyro::{Chroma, EncodeConfig, Encoder};

#[test]
#[ignore = "needs a Vulkan 1.3 GPU that can run nespyro"]
fn encoder_output_is_a_valid_stream() {
    let gpu = Gpu::new();
    for &(w, h, chroma) in &[
        (1920, 1080, Chroma::Yuv420),
        (1366, 768, Chroma::Yuv444),
        (64, 48, Chroma::Yuv420),
    ] {
        for content in [
            Content::Gradient,
            Content::Noise,
            Content::Edges,
            Content::Flat,
        ] {
            let image = gpu.upload(vk::Format::R8G8B8A8_UNORM, w, h, &rgba8(content, w, h));
            let config = EncodeConfig::new(w, h).with_chroma(chroma);
            let mut encoder = Encoder::new(gpu.ctx(), config.clone()).unwrap();
            let future = encoder
                .encode_after(image.image, image.format, vk::ImageLayout::GENERAL, &[])
                .unwrap();
            let frame = pollster::block_on(future).unwrap();

            let mut d = Depacketizer::new(Layout::new(w, h, chroma).unwrap());
            for p in &frame.packets {
                assert_eq!(
                    d.push(&frame.data[p.clone()]).unwrap(),
                    Push::Accepted,
                    "{w}x{h} {chroma:?} {content:?}"
                );
            }
            let r = d.readiness();
            assert!(r.is_complete(), "{w}x{h} {chroma:?} {content:?}: {r:?}");
            assert_eq!(frame.stats.dropped_blocks, 0);
            eprintln!(
                "{w}x{h} {chroma:?} {content:?}: {} bytes of {} target, {} packets, {:.1} µs GPU",
                frame.data.len(),
                frame.stats.target_bytes,
                frame.packets.len(),
                frame.stats.gpu_ns() / 1000.0
            );
            drop(encoder);
            gpu.assert_clean();
        }
    }
}
