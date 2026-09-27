//! Encode, packetize, depacketize and decode on a real GPU, and compare what
//! comes out with what went in.

mod common;

use ash::vk;
use common::{Content, Gpu, plane_values, psnr, reference_ycbcr, rgba8};
use nespyro::bitstream::Push;
use nespyro::{Chroma, DecodeConfig, Decoder, Depth, EncodeConfig, EncodedFrame, Encoder};

fn encode(gpu: &Gpu, config: EncodeConfig, rgba: &[u8]) -> EncodedFrame {
    let image = gpu.upload(
        vk::Format::R8G8B8A8_UNORM,
        config.width,
        config.height,
        rgba,
    );
    let mut encoder = Encoder::new(gpu.ctx(), config).unwrap();
    let future = encoder
        .encode_after(image.image, image.format, vk::ImageLayout::GENERAL, &[])
        .unwrap();
    pollster::block_on(future).unwrap()
}

/// Decodes `frame`, delivering only the packets `keep` allows, and returns
/// the three planes as floats with the frame's missing-block count.
fn decode(
    gpu: &Gpu,
    config: &EncodeConfig,
    depth: Depth,
    frame: &EncodedFrame,
    keep: impl Fn(usize) -> bool,
) -> ([Vec<f32>; 3], u32) {
    let mut decoder = Decoder::new(
        gpu.ctx(),
        DecodeConfig::new(config.width, config.height, config.chroma, depth),
    )
    .unwrap();
    for (i, p) in frame.packets.iter().enumerate() {
        if keep(i) {
            assert_eq!(
                decoder.push_packet(&frame.data[p.clone()]).unwrap(),
                Push::Accepted
            );
        }
    }
    let decoded = decoder.decode_after(&[]).unwrap();
    gpu.wait(decoded.ready);
    let planes = [
        plane_values(gpu, &decoded.y),
        plane_values(gpu, &decoded.cb),
        plane_values(gpu, &decoded.cr),
    ];
    (planes, decoded.missing_blocks)
}

#[test]
#[ignore = "needs a Vulkan 1.3 GPU that can run nespyro"]
fn round_trip_quality() {
    let gpu = Gpu::new();
    for &(w, h, chroma) in &[
        (1920, 1080, Chroma::Yuv420),
        (1366, 768, Chroma::Yuv444),
        (64, 48, Chroma::Yuv420),
    ] {
        for depth in [Depth::Eight, Depth::Sixteen] {
            for content in [
                Content::Gradient,
                Content::Noise,
                Content::Edges,
                Content::Flat,
            ] {
                let rgba = rgba8(content, w, h);
                let config = EncodeConfig::new(w, h)
                    .with_chroma(chroma)
                    .with_depth(depth);
                let frame = encode(&gpu, config.clone(), &rgba);
                let (planes, missing) = decode(&gpu, &config, depth, &frame, |_| true);
                assert_eq!(missing, 0);
                let reference = reference_ycbcr(&rgba, w, h, chroma == Chroma::Yuv420, false);
                let db: Vec<f64> = (0..3).map(|i| psnr(&planes[i], &reference[i])).collect();
                eprintln!(
                    "{w}x{h} {chroma:?} {depth:?} {content:?}: {} bytes, Y {:.1} Cb {:.1} Cr {:.1} dB",
                    frame.data.len(),
                    db[0],
                    db[1],
                    db[2]
                );
                // A frame that fit its budget comes back as well as its depth
                // can hold. For 8-bit output that floor is half a code off
                // everywhere, 20·log10(255 / 0.5) = 54.2 dB: grey chroma sits
                // at exactly 0.5, between two codes. Frames the budget
                // constrained are rate_control's business.
                let target = frame.stats.target_bytes as usize;
                if frame.data.len() * 100 < target * 95 {
                    let floor = match depth {
                        Depth::Eight => 54.0,
                        Depth::Sixteen => 60.0,
                    };
                    assert!(
                        db.iter().all(|&d| d >= floor),
                        "{w}x{h} {chroma:?} {depth:?} {content:?}: {db:?} below {floor}"
                    );
                }
                gpu.assert_clean();
            }
        }
    }
}

#[test]
#[ignore = "needs a Vulkan 1.3 GPU that can run nespyro"]
fn rate_control_limits_and_spends() {
    let gpu = Gpu::new();
    let (w, h) = (1920, 1080);
    for content in [Content::Noise, Content::Edges] {
        let rgba = rgba8(content, w, h);
        let reference = reference_ycbcr(&rgba, w, h, true, false);
        let mut curve: Vec<f64> = Vec::new();
        for mbps in [25, 50, 100, 200, 400, 800, 1600, 3200] {
            let config = EncodeConfig::new(w, h).with_target_bitrate(mbps * 1_000_000);
            let frame = encode(&gpu, config.clone(), &rgba);
            let target = frame.stats.target_bytes as usize;
            let (planes, _) = decode(&gpu, &config, Depth::Eight, &frame, |_| true);
            let db = psnr(&planes[0], &reference[0]);
            eprintln!(
                "{content:?} {mbps} Mbit/s: {} bytes, Y {db:.1} dB",
                frame.data.len()
            );

            // Never over the target.
            assert!(
                frame.data.len() <= target,
                "{content:?} {mbps}: {} > {target}",
                frame.data.len()
            );
            // And spent, until the picture is as good as 8 bits can carry: a
            // frame that came out nearly empty and decoded to grey fails
            // here, not only one that overshot.
            let saturated = db >= 50.0;
            assert!(
                saturated || frame.data.len() * 100 >= target * 95,
                "{content:?} {mbps}: {} bytes of {target} at {db:.1} dB",
                frame.data.len()
            );
            // Each doubling buys quality until it saturates.
            if let Some(&last) = curve.last() {
                assert!(
                    db > last + 0.2 || last >= 50.0,
                    "{content:?}: {db:.1} dB at {mbps} after {last:.1}"
                );
            }
            curve.push(db);
        }
        assert!(
            curve.last().unwrap() - curve[0] > 10.0,
            "{content:?}: 128 times the rate bought {:.1} dB",
            curve.last().unwrap() - curve[0]
        );
        gpu.assert_clean();
    }
}

#[test]
#[ignore = "needs a Vulkan 1.3 GPU that can run nespyro"]
fn the_same_input_encodes_to_the_same_bytes() {
    let gpu = Gpu::new();
    for &(w, h, chroma) in &[(1920, 1080, Chroma::Yuv420), (1366, 768, Chroma::Yuv444)] {
        let rgba = rgba8(Content::Edges, w, h);
        let image = gpu.upload(vk::Format::R8G8B8A8_UNORM, w, h, &rgba);
        let mut encoder =
            Encoder::new(gpu.ctx(), EncodeConfig::new(w, h).with_chroma(chroma)).unwrap();
        let mut frames = Vec::new();
        for _ in 0..3 {
            let f = encoder
                .encode_after(image.image, image.format, vk::ImageLayout::GENERAL, &[])
                .unwrap();
            frames.push(pollster::block_on(f).unwrap());
        }
        // Consecutive frames differ only in the 3-bit sequence number, which
        // sits in the top of each header's first word; masked out, the
        // bytes must match exactly, however the GPU ordered its atomics.
        let masked = |f: &EncodedFrame| {
            let mut d = f.data.clone();
            let mut at = 0;
            while at < d.len() {
                let w0 = u32::from_le_bytes(d[at..at + 4].try_into().unwrap());
                let size = if w0 >> 31 != 0 {
                    8
                } else {
                    ((w0 >> 16) & 0xfff) as usize * 4
                };
                d[at + 3] &= 0x8f;
                at += size;
            }
            d
        };
        assert_ne!(frames[0].sequence, frames[1].sequence);
        assert_eq!(masked(&frames[0]), masked(&frames[1]), "{w}x{h} {chroma:?}");
        assert_eq!(masked(&frames[1]), masked(&frames[2]), "{w}x{h} {chroma:?}");
        drop(encoder);
        gpu.assert_clean();
    }
}

#[test]
#[ignore = "needs a Vulkan 1.3 GPU that can run nespyro"]
fn losing_packets_blurs_but_decodes() {
    let gpu = Gpu::new();
    let (w, h) = (1920, 1080);
    let rgba = rgba8(Content::Gradient, w, h);
    let reference = reference_ycbcr(&rgba, w, h, true, false);
    let config = EncodeConfig::new(w, h);
    let frame = encode(&gpu, config.clone(), &rgba);
    let critical = frame.critical_packets;
    assert!(critical >= 1 && critical < frame.packets.len());

    // Drop one in twenty of the packets after the critical ones.
    let dropped = |i: usize| i >= critical && i % 20 == 3;
    let lost: usize = (0..frame.packets.len()).filter(|&i| dropped(i)).count();
    assert!(lost > 0);
    let (whole, missing_whole) = decode(&gpu, &config, Depth::Eight, &frame, |_| true);
    let (partial, missing) = decode(&gpu, &config, Depth::Eight, &frame, |i| !dropped(i));
    assert_eq!(missing_whole, 0);

    // Exactly the blocks in the dropped packets are reported missing.
    let blocks_in = |i: usize| {
        let bytes = &frame.data[frame.packets[i].clone()];
        let mut at = 0;
        let mut n = 0;
        while at < bytes.len() {
            let w0 = u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
            if w0 >> 31 != 0 {
                at += 8;
            } else {
                at += ((w0 >> 16) & 0xfff) as usize * 4;
                n += 1;
            }
        }
        n
    };
    let expected: u32 = (0..frame.packets.len())
        .filter(|&i| dropped(i))
        .map(blocks_in)
        .sum();
    assert_eq!(missing, expected);

    let whole_db = psnr(&whole[0], &reference[0]);
    let partial_db = psnr(&partial[0], &reference[0]);
    eprintln!(
        "{lost} packets, {missing} blocks lost: Y {whole_db:.1} dB whole, {partial_db:.1} dB partial"
    );
    // Worse, but a picture: the coarse bands all arrived.
    assert!(partial_db < whole_db);
    assert!(partial_db > 25.0, "{partial_db:.1} dB");
    gpu.assert_clean();
}

/// Linear light from an sRGB signal.
fn srgb_to_linear(c: f32) -> f32 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

fn linear_to_pq(l: f32) -> f32 {
    // ST 2084's constants, as the standard defines them.
    let (m1, m2) = (2610.0 / 16384.0, 2523.0 / 4096.0 * 128.0);
    let (c1, c2, c3) = (
        3424.0 / 4096.0,
        2413.0 / 4096.0 * 32.0,
        2392.0 / 4096.0 * 32.0,
    );
    let lm1 = l.max(0.0).powf(m1);
    ((c1 + c2 * lm1) / (1.0 + c3 * lm1)).powf(m2)
}

#[test]
#[ignore = "needs a Vulkan 1.3 GPU that can run nespyro"]
fn colour_reaches_the_planes_and_the_header() {
    use nespyro::{ColourDescription, Source};
    let gpu = Gpu::new();
    let (w, h) = (256, 128);
    let rgba = rgba8(Content::Gradient, w, h);

    // SDR: BT.709 in the header, BT.709 in the planes.
    let config = EncodeConfig::new(w, h).with_chroma(Chroma::Yuv444);
    let frame = encode(&gpu, config.clone(), &rgba);
    let mut decoder = Decoder::new(
        gpu.ctx(),
        DecodeConfig::new(w, h, Chroma::Yuv444, Depth::Eight),
    )
    .unwrap();
    for p in &frame.packets {
        decoder.push_packet(&frame.data[p.clone()]).unwrap();
    }
    let decoded = decoder.decode_after(&[]).unwrap();
    assert_eq!(decoded.colour, ColourDescription::bt709());
    gpu.wait(decoded.ready);
    let reference = reference_ycbcr(&rgba, w, h, false, false);
    let y = plane_values(&gpu, &decoded.y);
    let cb = plane_values(&gpu, &decoded.cb);
    assert!(psnr(&y, &reference[0]) > 50.0 && psnr(&cb, &reference[1]) > 50.0);
    drop(decoded);

    // HDR from an sRGB source: into BT.2020 linear light at the reference
    // white, PQ encoded, through the BT.2020 matrix; the header says so.
    let nits = 203.0;
    let config = EncodeConfig::new(w, h)
        .with_chroma(Chroma::Yuv444)
        .with_depth(Depth::Sixteen)
        .with_colour(ColourDescription::bt2020_pq(), Source::Srgb)
        .with_reference_white(nits);
    let frame = encode(&gpu, config, &rgba);
    let mut decoder = Decoder::new(
        gpu.ctx(),
        DecodeConfig::new(w, h, Chroma::Yuv444, Depth::Sixteen),
    )
    .unwrap();
    for p in &frame.packets {
        decoder.push_packet(&frame.data[p.clone()]).unwrap();
    }
    let decoded = decoder.decode_after(&[]).unwrap();
    assert_eq!(decoded.colour, ColourDescription::bt2020_pq());
    gpu.wait(decoded.ready);
    let pq: Vec<u8> = rgba
        .as_chunks::<4>()
        .0
        .iter()
        .flat_map(|p| {
            let l = [p[0], p[1], p[2]].map(|v| srgb_to_linear(f32::from(v) / 255.0));
            let m = [
                0.6274 * l[0] + 0.3293 * l[1] + 0.0433 * l[2],
                0.0691 * l[0] + 0.9195 * l[1] + 0.0114 * l[2],
                0.0164 * l[0] + 0.0880 * l[1] + 0.8956 * l[2],
            ];
            let e = m.map(|c| (linear_to_pq(c * nits / 10000.0) * 255.0).round() as u8);
            [e[0], e[1], e[2], 255]
        })
        .collect();
    // The reference is rounded through 8 bits on the way, so the comparison
    // is looser than the codec itself.
    let reference = reference_ycbcr(&pq, w, h, false, true);
    let y = plane_values(&gpu, &decoded.y);
    let cr = plane_values(&gpu, &decoded.cr);
    let (dy, dcr) = (psnr(&y, &reference[0]), psnr(&cr, &reference[2]));
    eprintln!("PQ: Y {dy:.1} dB, Cr {dcr:.1} dB against an 8-bit reference");
    assert!(dy > 45.0 && dcr > 45.0, "{dy:.1} {dcr:.1}");
    // And it really is PQ, not SDR relabelled: SDR white at 203 nits sits
    // near 0.58 in PQ, far from 1.0.
    let brightest = y.iter().cloned().fold(0.0f32, f32::max);
    assert!(
        (0.5..0.65).contains(&brightest),
        "brightest PQ luma {brightest}"
    );
    drop(decoded);
    gpu.assert_clean();
}

#[test]
#[ignore = "needs a Vulkan 1.3 GPU that can run nespyro"]
fn configurations_the_encoder_cannot_honour_are_refused() {
    use nespyro::{ColourDescription, Error, Source};
    let gpu = Gpu::new();
    let sdr_from_linear =
        EncodeConfig::new(128, 128).with_colour(ColourDescription::bt709(), Source::Bt709Linear);
    assert!(matches!(
        Encoder::new(gpu.ctx(), sdr_from_linear),
        Err(Error::Config(_))
    ));
    let limited = ColourDescription {
        range: nespyro::Range::Limited,
        ..ColourDescription::bt709()
    };
    assert!(matches!(
        Encoder::new(
            gpu.ctx(),
            EncodeConfig::new(128, 128).with_colour(limited, Source::Srgb)
        ),
        Err(Error::Config(_))
    ));
    assert!(Encoder::new(gpu.ctx(), EncodeConfig::new(1921, 1080)).is_err());

    // An sRGB-format view would be linearised by the sampler.
    let image = gpu.upload(
        vk::Format::R8G8B8A8_SRGB,
        128,
        128,
        &rgba8(Content::Flat, 128, 128),
    );
    let mut encoder = Encoder::new(gpu.ctx(), EncodeConfig::new(128, 128)).unwrap();
    assert!(matches!(
        encoder.encode_after(image.image, image.format, vk::ImageLayout::GENERAL, &[]),
        Err(Error::Config(_))
    ));
    drop(encoder);
    gpu.assert_clean();
}
