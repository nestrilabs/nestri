//! nespyro against the C++ reference it is a port of.
//!
//! Needs the harness `reference/build.sh` builds, named by
//! `NESPYRO_REFERENCE`. Unset or missing, the test fails: a cross-check that
//! quietly does not run is indistinguishable from one that passed.
//!
//! Decoding is floating point, so two decoders of one stream may differ by
//! rounding. The tolerance is upstream's own, from
//! `pyrowave_device_validation.cpp`: one step of luma, two of chroma.

mod common;

use std::path::PathBuf;
use std::process::Command;

use ash::vk;
use common::{Content, Gpu, plane_values, psnr, reference_ycbcr, rgba8};
use nespyro::bitstream::Push;
use nespyro::{Chroma, DecodeConfig, Decoder, Depth, EncodeConfig, EncodedFrame, Encoder};

fn harness() -> PathBuf {
    let path = std::env::var_os("NESPYRO_REFERENCE").unwrap_or_else(|| {
        panic!(
            "NESPYRO_REFERENCE is not set. Build the reference with \
             crates/nespyro/reference/build.sh <dir> and point it at the harness it prints."
        )
    });
    let path = PathBuf::from(path);
    assert!(
        path.is_file(),
        "NESPYRO_REFERENCE names {path:?}, which does not exist"
    );
    path
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("nespyro-reference-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join(name)
}

fn chroma_arg(c: Chroma) -> &'static str {
    match c {
        Chroma::Yuv420 => "420",
        Chroma::Yuv444 => "444",
    }
}

fn run(args: &[&str]) {
    let out = Command::new(harness()).args(args).output().unwrap();
    assert!(
        out.status.success(),
        "harness {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn write_packets(path: &PathBuf, packets: &[&[u8]]) {
    let mut out = Vec::new();
    for p in packets {
        out.extend((p.len() as u32).to_le_bytes());
        out.extend(*p);
    }
    std::fs::write(path, out).unwrap();
}

fn read_packets(path: &PathBuf) -> Vec<Vec<u8>> {
    let data = std::fs::read(path).unwrap();
    let mut at = 0;
    let mut packets = Vec::new();
    while at < data.len() {
        let len = u32::from_le_bytes(data[at..at + 4].try_into().unwrap()) as usize;
        packets.push(data[at + 4..at + 4 + len].to_vec());
        at += 4 + len;
    }
    packets
}

/// Planes as 8-bit samples, Y then Cb then Cr.
fn to_u8(planes: &[Vec<f32>; 3]) -> Vec<u8> {
    planes
        .iter()
        .flatten()
        .map(|v| (v * 255.0).round() as u8)
        .collect()
}

fn our_decode(gpu: &Gpu, w: u32, h: u32, chroma: Chroma, packets: &[&[u8]]) -> Vec<u8> {
    try_our_decode(gpu, w, h, chroma, packets).unwrap()
}

fn try_our_decode(
    gpu: &Gpu,
    w: u32,
    h: u32,
    chroma: Chroma,
    packets: &[&[u8]],
) -> Result<Vec<u8>, nespyro::Error> {
    let mut decoder =
        Decoder::new(gpu.ctx(), DecodeConfig::new(w, h, chroma, Depth::Eight)).unwrap();
    for p in packets {
        assert_eq!(decoder.push_packet(p)?, Push::Accepted);
    }
    assert!(decoder.readiness().is_complete());
    let frame = decoder.decode_after(&[]).unwrap();
    gpu.wait(frame.ready);
    Ok(to_u8(&[
        plane_values(gpu, &frame.y),
        plane_values(gpu, &frame.cb),
        plane_values(gpu, &frame.cr),
    ]))
}

fn their_decode(w: u32, h: u32, chroma: Chroma, packets: &[&[u8]]) -> Vec<u8> {
    let pkts = scratch("in.pkts");
    let yuv = scratch("out.yuv");
    write_packets(&pkts, packets);
    run(&[
        "decode",
        &w.to_string(),
        &h.to_string(),
        chroma_arg(chroma),
        pkts.to_str().unwrap(),
        yuv.to_str().unwrap(),
    ]);
    std::fs::read(yuv).unwrap()
}

/// The largest difference per plane between two decodes of one stream.
fn max_difference(a: &[u8], b: &[u8], w: u32, h: u32, chroma: Chroma) -> [u8; 3] {
    assert_eq!(a.len(), b.len());
    let luma = (w * h) as usize;
    let c = match chroma {
        Chroma::Yuv420 => luma / 4,
        Chroma::Yuv444 => luma,
    };
    let ranges = [0..luma, luma..luma + c, luma + c..luma + 2 * c];
    ranges.map(|r| {
        a[r.clone()]
            .iter()
            .zip(&b[r])
            .map(|(x, y)| x.abs_diff(*y))
            .max()
            .unwrap()
    })
}

fn within_tolerance(diff: [u8; 3]) -> bool {
    diff[0] <= 1 && diff[1] <= 2 && diff[2] <= 2
}

const CASES: &[(u32, u32, Chroma)] = &[(1920, 1080, Chroma::Yuv420), (1366, 768, Chroma::Yuv444)];
const CONTENT: [Content; 3] = [Content::Gradient, Content::Edges, Content::Noise];

fn our_encode(gpu: &Gpu, w: u32, h: u32, chroma: Chroma, rgba: &[u8]) -> EncodedFrame {
    let image = gpu.upload(vk::Format::R8G8B8A8_UNORM, w, h, rgba);
    let mut encoder = Encoder::new(gpu.ctx(), EncodeConfig::new(w, h).with_chroma(chroma)).unwrap();
    let f = encoder
        .encode_after(image.image, image.format, vk::ImageLayout::GENERAL, &[])
        .unwrap();
    pollster::block_on(f).unwrap()
}

#[test]
#[ignore = "needs a Vulkan 1.3 GPU and the reference harness (NESPYRO_REFERENCE)"]
fn their_decoder_reads_our_stream() {
    let gpu = Gpu::new();
    for &(w, h, chroma) in CASES {
        for content in CONTENT {
            let frame = our_encode(&gpu, w, h, chroma, &rgba8(content, w, h));
            let packets: Vec<&[u8]> = frame
                .packets
                .iter()
                .map(|p| &frame.data[p.clone()])
                .collect();
            // Their decoder refuses a packet it cannot parse and a frame it
            // considers incomplete, so getting planes back at all is half of
            // the check.
            let theirs = their_decode(w, h, chroma, &packets);
            let ours = our_decode(&gpu, w, h, chroma, &packets);
            let diff = max_difference(&ours, &theirs, w, h, chroma);
            eprintln!("ours → theirs {w}x{h} {chroma:?} {content:?}: max difference {diff:?}");
            assert!(
                within_tolerance(diff),
                "{w}x{h} {chroma:?} {content:?}: {diff:?}"
            );
        }
    }
    gpu.assert_clean();
}

#[test]
#[ignore = "needs a Vulkan 1.3 GPU and the reference harness (NESPYRO_REFERENCE)"]
fn our_decoder_reads_their_stream_and_our_encoder_keeps_up() {
    let gpu = Gpu::new();
    for &(w, h, chroma) in CASES {
        for content in CONTENT {
            let rgba = rgba8(content, w, h);
            // The same conversion our encoder makes, done on the CPU and
            // rounded to 8 bits, is their input.
            let reference = reference_ycbcr(&rgba, w, h, chroma == Chroma::Yuv420, false);
            let yuv = scratch("in.yuv");
            let pkts = scratch("out.pkts");
            std::fs::write(&yuv, to_u8(&reference)).unwrap();

            // Both encoders get exactly these planes.
            let input = to_u8(&reference);
            let luma = (w * h) as usize;
            let (cw, ch) = match chroma {
                Chroma::Yuv420 => (w / 2, h / 2),
                Chroma::Yuv444 => (w, h),
            };
            let c = (cw * ch) as usize;
            let y_img = gpu.upload(vk::Format::R8_UNORM, w, h, &input[..luma]);
            let cb_img = gpu.upload(vk::Format::R8_UNORM, cw, ch, &input[luma..luma + c]);
            let cr_img = gpu.upload(vk::Format::R8_UNORM, cw, ch, &input[luma + c..]);
            let mut encoder =
                Encoder::new(gpu.ctx(), EncodeConfig::new(w, h).with_chroma(chroma)).unwrap();
            let f = encoder
                .encode_planes_after(
                    [y_img.image, cb_img.image, cr_img.image],
                    vk::ImageLayout::GENERAL,
                    &[],
                )
                .unwrap();
            let ours_frame = pollster::block_on(f).unwrap();
            drop(encoder);
            let target = ours_frame.stats.target_bytes;
            run(&[
                "encode",
                &w.to_string(),
                &h.to_string(),
                chroma_arg(chroma),
                &target.to_string(),
                "1200",
                yuv.to_str().unwrap(),
                pkts.to_str().unwrap(),
            ]);
            let their_packets = read_packets(&pkts);
            let their_refs: Vec<&[u8]> = their_packets.iter().map(|p| p.as_slice()).collect();
            let their_bytes: usize = their_packets.iter().map(Vec::len).sum();

            // Upstream sizes its quantizer scratch at aligned width × height
            // × 2 bytes, and high-entropy content needs more. Ours asks for
            // nearly the same amount on the same planes, so it says when
            // theirs overflowed; its encoder then packs blocks from bytes it
            // never wrote, and a block's contents stop matching its header.
            let layout = nespyro::bitstream::Layout::new(w, h, chroma).unwrap();
            let upstream_scratch = layout.aligned_width * layout.aligned_height * 2;
            let upstream_overflowed = ours_frame.stats.scratch_bytes > upstream_scratch;
            let by_them = their_decode(w, h, chroma, &their_refs);
            let by_us = match try_our_decode(&gpu, w, h, chroma, &their_refs) {
                Ok(planes) => planes,
                Err(nespyro::Error::Bitstream(e)) if upstream_overflowed => {
                    // Refused, not decoded: the stream is malformed.
                    eprintln!(
                        "theirs → ours {w}x{h} {chroma:?} {content:?}: upstream's scratch overflowed \
                         ({} of {upstream_scratch} bytes) and our decoder refused its stream: {e}",
                        ours_frame.stats.scratch_bytes
                    );
                    continue;
                }
                Err(e) => {
                    panic!("{w}x{h} {chroma:?} {content:?}: our decoder refused their stream: {e}")
                }
            };
            let diff = max_difference(&by_us, &by_them, w, h, chroma);

            // Our encoder beside theirs, each judged against the 8-bit input.
            let ours_packets: Vec<&[u8]> = ours_frame
                .packets
                .iter()
                .map(|p| &ours_frame.data[p.clone()])
                .collect();
            let our_decoded = our_decode(&gpu, w, h, chroma, &ours_packets);
            let as_f32 = |v: &[u8]| v.iter().map(|&x| f32::from(x) / 255.0).collect::<Vec<_>>();
            let our_db = psnr(&as_f32(&our_decoded[..luma]), &as_f32(&input[..luma]));
            let their_db = psnr(&as_f32(&by_them[..luma]), &as_f32(&input[..luma]));
            let same_blocks = identical_blocks(&ours_frame.data, &their_packets);

            eprintln!(
                "theirs → ours {w}x{h} {chroma:?} {content:?}: max difference {diff:?}; \
                 encoders: ours {} bytes {our_db:.2} dB, theirs {their_bytes} bytes {their_db:.2} dB, \
                 {:.1}% of blocks identical",
                ours_frame.data.len(),
                same_blocks * 100.0
            );
            assert!(
                within_tolerance(diff),
                "{w}x{h} {chroma:?} {content:?}: {diff:?}"
            );
            // Slang and glslang may round floating point differently, so the
            // encoders need not agree byte for byte; ours must not be
            // measurably worse.
            assert!(
                our_db >= their_db - 0.5,
                "{w}x{h} {chroma:?} {content:?}: ours {our_db:.2} dB, theirs {their_db:.2} dB"
            );
        }
    }
    gpu.assert_clean();
}

/// The fraction of their blocks that also appear, byte for byte, in ours.
/// Sequence numbers are masked, since the two encoders count separately.
fn identical_blocks(ours: &[u8], theirs: &[Vec<u8>]) -> f64 {
    let blocks = |bytes: &[u8]| {
        let mut out = std::collections::HashMap::new();
        let mut at = 0;
        while at + 8 <= bytes.len() {
            let w0 = u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
            if w0 >> 31 != 0 {
                at += 8;
                continue;
            }
            let size = ((w0 >> 16) & 0xfff) as usize * 4;
            let w1 = u32::from_le_bytes(bytes[at + 4..at + 8].try_into().unwrap());
            let mut b = bytes[at..at + size].to_vec();
            b[3] &= 0x8f;
            out.insert(w1 >> 8, b);
            at += size;
        }
        out
    };
    let ours = blocks(ours);
    let theirs: std::collections::HashMap<_, _> = theirs.iter().flat_map(|p| blocks(p)).collect();
    let same = theirs
        .iter()
        .filter(|(k, v)| ours.get(*k) == Some(*v))
        .count();
    same as f64 / theirs.len().max(1) as f64
}
