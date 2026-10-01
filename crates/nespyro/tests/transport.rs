//! Real frames through the PyroWave wire, end to end: the IPC messages
//! nescapture writes, the hub's reassembly and datagram packing, the client's
//! collector, and a depacketizer at the end. What arrives must be what the
//! encoder made.
//!
//! The network itself is not here; neshub's own end-to-end tests carry
//! synthetic packets over a real iroh connection. This is about the bytes
//! being real PyroWave, which those cannot be.

mod common;

use ash::vk;
use common::{Content, Gpu, rgba8};
use nesprotocol::pyrowave::{
    CollectedFrame, FLAG_DUPLICATE, FrameAssembler, FrameMeta, PyroCollector, chunk_frame,
    decode_pyro_datagram, pack_datagrams,
};
use nespyro::bitstream::{Depacketizer, Layout, Push, Readiness};
use nespyro::{Chroma, EncodeConfig, EncodedFrame, Encoder};

/// The datagram size of a typical path, and the packet size the hub would
/// then hand the encoder.
const DATAGRAM: usize = 1200;
const PACKET: usize = DATAGRAM - nesprotocol::pyrowave::PYRO_DGRAM_HDR_LEN;

fn encode(gpu: &Gpu, config: EncodeConfig, content: Content) -> EncodedFrame {
    let rgba = rgba8(content, config.width, config.height);
    let image = gpu.upload(
        vk::Format::R8G8B8A8_UNORM,
        config.width,
        config.height,
        &rgba,
    );
    let mut encoder = Encoder::new(gpu.ctx(), config).unwrap();
    let future = encoder
        .encode_after(image.image, image.format, vk::ImageLayout::GENERAL, &[])
        .unwrap();
    pollster::block_on(future).unwrap()
}

fn readiness<'a>(config: &EncodeConfig, packets: impl Iterator<Item = &'a [u8]>) -> Readiness {
    let mut d = Depacketizer::new(Layout::new(config.width, config.height, config.chroma).unwrap());
    for p in packets {
        assert_eq!(d.push(p).unwrap(), Push::Accepted, "a packet was refused");
    }
    d.readiness()
}

/// The whole wire, with `lose` deciding, by arrival order, which datagrams
/// the network drops.
fn across_the_wire(frame: &EncodedFrame, lose: impl Fn(usize) -> bool) -> CollectedFrame<Vec<u8>> {
    let meta = FrameMeta {
        ts_ms: 16,
        width: 1920,
        height: 1080,
    };
    let messages = chunk_frame(
        frame.index as u32,
        meta,
        &frame.data,
        &frame.packets,
        frame.critical_packets,
    )
    .unwrap();

    let mut hub = FrameAssembler::new();
    let mut whole = None;
    for m in &messages {
        let ipc = nesprotocol::decode_ipc_frame(m).unwrap();
        whole = hub.push(&ipc, 0).unwrap().or(whole);
    }
    let whole = whole.expect("the hub never completed the frame");

    let datagrams = pack_datagrams(0, &whole, DATAGRAM).unwrap();
    let mut client = PyroCollector::<Vec<u8>>::new();
    let mut out = Vec::new();
    let mut at = 0;
    for (n, &len) in datagrams.lens.iter().enumerate() {
        let d = &datagrams.buf[at..at + len];
        at += len;
        assert!(
            len <= DATAGRAM,
            "a {len}-byte datagram on a {DATAGRAM}-byte path"
        );
        let (h, payload) = decode_pyro_datagram(d).unwrap();
        if lose(n) && h.flags & FLAG_DUPLICATE == 0 {
            continue;
        }
        out.extend(client.push(h, payload.to_vec(), 0));
    }
    out.extend(client.poll(u64::MAX));
    assert_eq!(out.len(), 1);
    out.pop().unwrap()
}

#[test]
#[ignore = "needs a Vulkan 1.3 GPU that can run nespyro"]
fn a_frame_crosses_the_wire_as_the_encoder_made_it() {
    let gpu = Gpu::new();
    for chroma in [Chroma::Yuv420, Chroma::Yuv444] {
        for content in [Content::Gradient, Content::Noise, Content::Edges] {
            let config = EncodeConfig::new(1920, 1080)
                .with_chroma(chroma)
                .with_target_bitrate(400_000_000)
                .with_packet_size(PACKET);
            let frame = encode(&gpu, config.clone(), content);
            let direct = readiness(
                &config,
                frame.packets.iter().map(|p| &frame.data[p.clone()]),
            );
            assert!(direct.is_complete(), "{chroma:?} {content:?}: {direct:?}");

            let got = across_the_wire(&frame, |_| false);
            assert!(got.is_whole());
            assert!(got.critical_complete);
            assert_eq!(got.packets.len(), frame.packets.len());
            let wired = readiness(&config, got.packets.iter().map(|p| p.as_ref()));
            assert_eq!(wired, direct, "{chroma:?} {content:?}");
        }
    }
    gpu.assert_clean();
}

/// With datagrams lost, the frame that arrives is short exactly the blocks
/// that were lost and nothing is refused; the critical bands survive on their
/// copies, so the decoder can still show it.
///
/// Whether they survived is the collector's answer, not the depacketizer's:
/// noise leaves coarse high-pass blocks empty, so counting blocks reads a
/// frame with nothing lost as broken. This test is how that was found.
#[test]
#[ignore = "needs a Vulkan 1.3 GPU that can run nespyro"]
fn a_lossy_wire_costs_blocks_and_never_the_coarse_bands() {
    let gpu = Gpu::new();
    let config = EncodeConfig::new(1920, 1080)
        .with_target_bitrate(400_000_000)
        .with_packet_size(PACKET);
    let frame = encode(&gpu, config.clone(), Content::Noise);
    let direct = readiness(
        &config,
        frame.packets.iter().map(|p| &frame.data[p.clone()]),
    );

    // Every critical original lost, and one in fifty of the rest.
    let critical = frame.critical_packets;
    let got = across_the_wire(&frame, |n| n < critical || n % 50 == 49);
    assert!(!got.is_whole());
    assert!(got.critical_complete, "the copies did not stand in");
    let wired = readiness(&config, got.packets.iter().map(|p| p.as_ref()));
    assert!(wired.received < direct.received);
    assert!(
        wired.is_complete_enough_with(got.critical_complete),
        "a 2% loss should leave the frame decodable: {wired:?}"
    );
    gpu.assert_clean();
}
