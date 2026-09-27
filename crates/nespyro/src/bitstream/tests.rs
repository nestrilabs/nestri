use super::*;

/// xorshift, so the tests need no dependency and every run is the same.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 16) as u32
    }
}

/// The block-index walk exactly as `bitstream.md` writes it, kept separate
/// from `Layout` so the two can be compared.
fn spec_walk(w: u32, h: u32, chroma: Chroma) -> Vec<(usize, usize, usize, u32)> {
    let aw = w.next_multiple_of(32).max(128);
    let ah = h.next_multiple_of(32).max(128);
    let mut out = Vec::new();
    let mut index = 0;
    for level in (0..5).rev() {
        for component in 0..3 {
            if level == 0 && component != 0 && chroma == Chroma::Yuv420 {
                continue;
            }
            for band in (if level == 4 { 0 } else { 1 })..4 {
                let bw = (aw >> (level + 1)).div_ceil(32);
                let bh = (ah >> (level + 1)).div_ceil(32);
                out.push((component, level, band, index));
                index += bw * bh;
            }
        }
    }
    out.push((9, 9, 9, index));
    out
}

#[test]
fn layout_follows_the_spec_walk() {
    for &(w, h, chroma) in &[
        (128, 128, Chroma::Yuv420),
        (128, 128, Chroma::Yuv444),
        (1920, 1080, Chroma::Yuv420),
        (1366, 768, Chroma::Yuv444),
        (3840, 2160, Chroma::Yuv420),
        (64, 48, Chroma::Yuv420),
    ] {
        let layout = Layout::new(w, h, chroma).unwrap();
        let walk = spec_walk(w, h, chroma);
        for &(c, l, b, index) in &walk[..walk.len() - 1] {
            let band = layout.band(c, l, b).unwrap();
            assert_eq!(
                band.offset_32x32, index,
                "{w}x{h} {chroma:?} c{c} l{l} b{b}"
            );
        }
        assert_eq!(layout.blocks_32x32(), walk.last().unwrap().3);
    }
}

#[test]
fn smallest_frame_block_counts() {
    // 128×128 is the minimum: bands are 64, 32, 16, 8 and 4 wide, so only
    // level 0 has more than one 32×32 block per band (2×2 of them).
    let l420 = Layout::new(128, 128, Chroma::Yuv420).unwrap();
    assert_eq!(l420.blocks_32x32(), 12 + 9 + 9 + 9 + 3 * 4);
    let l444 = Layout::new(128, 128, Chroma::Yuv444).unwrap();
    assert_eq!(l444.blocks_32x32(), 12 + 9 + 9 + 9 + 9 * 4);

    // Level 4 runs Y's four bands, Cb's four, Cr's four; one band deep ends
    // at Cr's LL, two deep at the end of the level.
    assert_eq!(l420.leading_blocks(1), 9);
    assert_eq!(l420.leading_blocks(2), 12);
    assert_eq!(l420.leading_blocks(3), 21);
}

#[test]
fn small_frames_pad_to_the_minimum() {
    let l = Layout::new(40, 20, Chroma::Yuv444).unwrap();
    assert_eq!((l.aligned_width, l.aligned_height), (128, 128));
    let l = Layout::new(1366, 768, Chroma::Yuv420).unwrap();
    assert_eq!((l.aligned_width, l.aligned_height), (1376, 768));
}

#[test]
fn layout_refuses_what_the_format_cannot_carry() {
    assert!(matches!(
        Layout::new(1921, 1080, Chroma::Yuv420),
        Err(BitstreamError::OddYuv420 { .. })
    ));
    assert!(Layout::new(1921, 1081, Chroma::Yuv444).is_ok());
    assert!(matches!(
        Layout::new(0, 10, Chroma::Yuv444),
        Err(BitstreamError::BadDimensions { .. })
    ));
    assert!(matches!(
        Layout::new(16385, 10, Chroma::Yuv444),
        Err(BitstreamError::BadDimensions { .. })
    ));
}

#[test]
fn edge_blocks_cover_fewer_8x8_blocks() {
    // 1366 pads to 1376: level 0 is 688 wide, 86 8×8 blocks, so the last
    // 32×32 block in a row covers 86 - 21·4 = 2 of them.
    let l = Layout::new(1366, 768, Chroma::Yuv420).unwrap();
    let band = l.band(0, 0, 1).unwrap();
    let last_in_row = band.offset_32x32 + band.stride_32x32 - 1;
    let m = l.mapping(last_in_row).unwrap();
    assert_eq!((m.width_8x8, m.height_8x8), (2, 4));
}

#[test]
fn largest_block_fits_the_size_field() {
    assert_eq!(LARGEST_BLOCK_WORDS, 622);
}

#[test]
fn block_header_bytes() {
    let h = BlockHeader {
        ballot: 0x8001,
        payload_words: 0xabc,
        sequence: 5,
        quant_code: 0x3d,
        block_index: 0x12_3456,
    };
    let b = h.to_bytes();
    // ballot, then payload_words:12 | sequence:3 | extended:1.
    assert_eq!(b[..4], (0x8001u32 | 0xabc << 16 | 5 << 28).to_le_bytes());
    assert_eq!(b[4..], (0x3du32 | 0x12_3456 << 8).to_le_bytes());
    assert_eq!(Header::parse(&b).unwrap(), Header::Block(h));
}

#[test]
fn sequence_header_bytes() {
    let h = SequenceHeader {
        width: 1920,
        height: 1080,
        sequence: 3,
        total_blocks: 4242,
        chroma: Chroma::Yuv444,
        colour: ColourDescription::bt2020_pq(),
    };
    let b = h.to_bytes();
    assert_eq!(
        b[..4],
        (1919u32 | 1079 << 14 | 3 << 28 | 1 << 31).to_le_bytes()
    );
    // chroma 444, primaries 2020, transfer PQ, matrix 2020, full, centre.
    assert_eq!(
        b[4..],
        (4242u32 | 1 << 26 | 1 << 27 | 1 << 28 | 1 << 29).to_le_bytes()
    );
    assert_eq!(Header::parse(&b).unwrap(), Header::Sequence(h));

    // Every colour field must round-trip on its own, not just as a bundle.
    let odd = ColourDescription {
        primaries: Primaries::Bt709,
        transfer: Transfer::Pq,
        matrix: Matrix::Bt709,
        range: Range::Limited,
        siting: Siting::Left,
    };
    let h = SequenceHeader { colour: odd, ..h };
    assert_eq!(Header::parse(&h.to_bytes()).unwrap(), Header::Sequence(h));
}

#[test]
fn reserved_extended_codes_are_refused() {
    let mut b = SequenceHeader {
        width: 128,
        height: 128,
        sequence: 0,
        total_blocks: 0,
        chroma: Chroma::Yuv420,
        colour: ColourDescription::bt709(),
    }
    .to_bytes();
    b[7] |= 1; // code = 1
    assert_eq!(
        Header::parse(&b),
        Err(BitstreamError::UnknownExtendedCode(1))
    );
}

/// One structurally valid block, built independently of `validate_block`.
///
/// For each present 8×8 block: a code word of random 2-bit plane deltas, a
/// random q_bits, the plane bytes, and one sign bit per coefficient that any
/// plane marks significant.
fn make_block(layout: &Layout, index: u32, sequence: u8, rng: &mut Rng) -> Vec<u8> {
    let m = layout.mapping(index).unwrap();
    let mut ballot = 0u16;
    for y in 0..m.height_8x8 {
        for x in 0..m.width_8x8 {
            if !rng.next().is_multiple_of(3) {
                ballot |= 1 << (y * 4 + x);
            }
        }
    }
    if ballot == 0 {
        ballot = 1;
    }
    let n = ballot.count_ones() as usize;
    let mut code_words = Vec::new();
    let mut q_scales = Vec::new();
    let mut planes = Vec::new();
    let mut significant = 0;
    for _ in 0..n {
        let code_word = rng.next() as u16;
        let q_bits = rng.next() % 4;
        code_words.extend_from_slice(&code_word.to_le_bytes());
        q_scales.push(q_bits as u8 | ((rng.next() % 16) as u8) << 4);
        for sub in 0..8 {
            let count = q_bits as u16 + (code_word >> (2 * sub) & 3);
            let mut union = 0u8;
            for _ in 0..count {
                let b = rng.next() as u8;
                union |= b;
                planes.push(b);
            }
            significant += union.count_ones();
        }
    }
    let mut body = Vec::new();
    body.extend(code_words);
    body.extend(q_scales);
    body.extend(planes);
    body.extend((0..significant.div_ceil(8)).map(|_| rng.next() as u8));
    let words = (HEADER_SIZE + body.len()).div_ceil(4);
    body.resize(words * 4 - HEADER_SIZE, 0);

    let header = BlockHeader {
        ballot,
        payload_words: words as u16,
        sequence,
        quant_code: (rng.next() & 0xff) as u8,
        block_index: index,
    };
    let mut out = header.to_bytes().to_vec();
    out.extend(body);
    out
}

/// A GPU table and word buffer holding `blocks`, scattered in the buffer in
/// an order unrelated to their index, as the GPU's atomics would leave them.
fn gpu_output(
    layout: &Layout,
    blocks: &[(u32, Vec<u8>)],
    rng: &mut Rng,
) -> (Vec<GpuPacket>, Vec<u32>) {
    let mut table = vec![GpuPacket::default(); layout.blocks_32x32() as usize];
    let mut order: Vec<usize> = (0..blocks.len()).collect();
    for i in (1..order.len()).rev() {
        order.swap(i, rng.next() as usize % (i + 1));
    }
    let mut words = Vec::new();
    for i in order {
        let (index, bytes) = &blocks[i];
        table[*index as usize] = GpuPacket {
            offset_words: words.len() as u32,
            num_words: (bytes.len() / 4) as u32,
        };
        words.extend(
            bytes
                .chunks_exact(4)
                .map(|w| u32::from_le_bytes(w.try_into().unwrap())),
        );
    }
    (table, words)
}

fn seq(layout: &Layout, sequence: u8) -> SequenceHeader {
    SequenceHeader {
        width: layout.width,
        height: layout.height,
        sequence,
        total_blocks: 0,
        chroma: layout.chroma,
        colour: ColourDescription::bt709(),
    }
}

fn sample_frame(
    layout: &Layout,
    sequence: u8,
    keep: impl Fn(u32) -> bool,
    rng: &mut Rng,
) -> Vec<(u32, Vec<u8>)> {
    (0..layout.blocks_32x32())
        .filter(|&i| keep(i))
        .map(|i| (i, make_block(layout, i, sequence, rng)))
        .collect()
}

#[test]
fn a_hand_built_block_validates() {
    // One 8×8 block present. Its code word gives subblock 0 one plane and the
    // rest none, q_bits 0. The plane byte has two bits set, so two sign bits,
    // one byte. 8 header + 2 code word + 1 scale + 1 plane + 1 sign = 13
    // bytes, 4 words.
    let layout = Layout::new(128, 128, Chroma::Yuv420).unwrap();
    let header = BlockHeader {
        ballot: 1,
        payload_words: 4,
        sequence: 0,
        quant_code: 0,
        block_index: 40,
    };
    let mut b = header.to_bytes().to_vec();
    b.extend([0b01, 0, 0x60, 0b1010_0000, 0b10, 0, 0, 0]);
    depacketize::validate_block(&layout, &header, &b).unwrap();

    let wrong = BlockHeader {
        payload_words: 5,
        ..header
    };
    assert_eq!(
        depacketize::validate_block(&layout, &wrong, &[b.clone(), vec![0; 4]].concat()),
        Err(BitstreamError::BlockSizeMismatch {
            index: 40,
            computed: 4,
            declared: 5
        })
    );
}

#[test]
fn packetize_then_parse_reproduces_every_block() {
    let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
    for &(w, h, chroma) in &[
        (1920, 1080, Chroma::Yuv420),
        (1366, 768, Chroma::Yuv444),
        (128, 128, Chroma::Yuv420),
    ] {
        let layout = Layout::new(w, h, chroma).unwrap();
        let blocks = sample_frame(&layout, 2, |i| i % 7 != 3, &mut rng);
        let (table, words) = gpu_output(&layout, &blocks, &mut rng);
        let frame = packetize(&layout, seq(&layout, 2), &table, &words, 1200).unwrap();

        assert_eq!(frame.blocks as usize, blocks.len());
        // The frame is the header and the blocks in index order, nothing else.
        let mut expected = seq(&layout, 2);
        expected.total_blocks = blocks.len() as u32;
        let mut concat = expected.to_bytes().to_vec();
        for (_, b) in &blocks {
            concat.extend(b);
        }
        assert_eq!(frame.data, concat);

        // Packets tile the frame exactly.
        assert_eq!(frame.packets.first().unwrap().start, 0);
        assert_eq!(frame.packets.last().unwrap().end, frame.data.len());
        for pair in frame.packets.windows(2) {
            assert_eq!(pair[0].end, pair[1].start);
        }

        let mut d = Depacketizer::new(layout.clone());
        for p in &frame.packets {
            assert!(p.len() <= 1200 || p.len() <= LARGEST_BLOCK_WORDS as usize * 4 + 8);
            assert_eq!(d.push(&frame.data[p.clone()]).unwrap(), Push::Accepted);
        }
        let r = d.readiness();
        assert!(r.is_complete(), "{r:?}");
        assert_eq!(d.missing_blocks(), 0);

        // Every block comes back byte for byte at the offset the table says.
        let (offsets, payload) = d.take_for_decode();
        for (index, bytes) in &blocks {
            let at = offsets[*index as usize] as usize;
            let got: Vec<u8> = payload[at..at + bytes.len() / 4]
                .iter()
                .flat_map(|w| w.to_le_bytes())
                .collect();
            assert_eq!(&got, bytes);
        }
        let absent = offsets
            .iter()
            .filter(|&&o| o == depacketize::MISSING)
            .count();
        assert_eq!(absent, layout.blocks_32x32() as usize - blocks.len());
        assert!(!d.readiness().is_complete_enough(), "decoded twice");
    }
}

#[test]
fn every_packet_parses_on_its_own_in_any_order() {
    let mut rng = Rng(7);
    let layout = Layout::new(1920, 1080, Chroma::Yuv420).unwrap();
    let blocks = sample_frame(&layout, 6, |_| true, &mut rng);
    let (table, words) = gpu_output(&layout, &blocks, &mut rng);
    let frame = packetize(&layout, seq(&layout, 6), &table, &words, 1400).unwrap();
    assert!(frame.packets.len() > 10);

    let mut d = Depacketizer::new(layout);
    for p in frame.packets.iter().rev() {
        assert_eq!(d.push(&frame.data[p.clone()]).unwrap(), Push::Accepted);
    }
    assert!(d.readiness().is_complete());
}

#[test]
fn packetizing_does_not_depend_on_the_gpu_order() {
    let layout = Layout::new(1366, 768, Chroma::Yuv444).unwrap();
    let blocks = sample_frame(&layout, 1, |i| i % 3 != 0, &mut Rng(99));
    let (t1, w1) = gpu_output(&layout, &blocks, &mut Rng(1));
    let (t2, w2) = gpu_output(&layout, &blocks, &mut Rng(2));
    assert_ne!(
        w1, w2,
        "the two scatters must differ for this to mean anything"
    );
    let a = packetize(&layout, seq(&layout, 1), &t1, &w1, 1200).unwrap();
    let b = packetize(&layout, seq(&layout, 1), &t2, &w2, 1200).unwrap();
    assert_eq!(a, b);
}

#[test]
fn packets_never_split_a_block_and_respect_the_size() {
    let mut rng = Rng(3);
    let layout = Layout::new(1920, 1080, Chroma::Yuv420).unwrap();
    let blocks = sample_frame(&layout, 0, |_| true, &mut rng);
    let (table, words) = gpu_output(&layout, &blocks, &mut rng);
    for size in [64, 300, 1200, 9000] {
        let frame = packetize(&layout, seq(&layout, 0), &table, &words, size).unwrap();
        for p in &frame.packets {
            let bytes = &frame.data[p.clone()];
            // Walking the packet's headers must land exactly on its end.
            let mut at = 0;
            let mut count = 0;
            while at < bytes.len() {
                match Header::parse(&bytes[at..]).unwrap() {
                    Header::Sequence(_) => at += HEADER_SIZE,
                    Header::Block(b) => at += usize::from(b.payload_words) * 4,
                }
                count += 1;
            }
            assert_eq!(at, bytes.len());
            assert!(
                bytes.len() <= size || count == 1 || (count == 2 && p.start == 0),
                "packet of {} bytes over {size} holds {count} headers",
                bytes.len()
            );
        }
    }
}

#[test]
fn critical_packets_cover_the_coarse_bands() {
    let mut rng = Rng(11);
    let layout = Layout::new(3840, 2160, Chroma::Yuv420).unwrap();
    let blocks = sample_frame(&layout, 0, |_| true, &mut rng);
    let (table, words) = gpu_output(&layout, &blocks, &mut rng);
    let frame = packetize(&layout, seq(&layout, 0), &table, &words, 1200).unwrap();
    let limit = layout.leading_blocks(2);
    assert!(frame.critical_packets > 1 && frame.critical_packets < frame.packets.len());

    // Delivering only the critical packets gives every coarse block;
    // delivering all but the last of them does not.
    let mut d = Depacketizer::new(layout.clone());
    for p in &frame.packets[..frame.critical_packets] {
        d.push(&frame.data[p.clone()]).unwrap();
    }
    assert!(d.readiness().critical_complete);
    assert!(d.readiness().received >= limit);

    let mut d = Depacketizer::new(layout);
    for p in &frame.packets[..frame.critical_packets - 1] {
        d.push(&frame.data[p.clone()]).unwrap();
    }
    assert!(!d.readiness().critical_complete);
}

#[test]
fn readiness_follows_upstreams_partial_rule() {
    let mut rng = Rng(5);
    let layout = Layout::new(1920, 1080, Chroma::Yuv420).unwrap();
    let blocks = sample_frame(&layout, 0, |_| true, &mut rng);
    let (table, words) = gpu_output(&layout, &blocks, &mut rng);
    let frame = packetize(&layout, seq(&layout, 0), &table, &words, 1200).unwrap();
    let n = frame.packets.len();

    // Drop 5% of the non-critical packets: decodable, not complete.
    let mut d = Depacketizer::new(layout.clone());
    for (i, p) in frame.packets.iter().enumerate() {
        if i < frame.critical_packets || i % 20 != 7 {
            d.push(&frame.data[p.clone()]).unwrap();
        }
    }
    let r = d.readiness();
    assert!(!r.is_complete() && r.is_complete_enough(), "{r:?}");
    assert!(d.missing_blocks() > 0);

    // Drop a quarter: not decodable yet.
    let mut d = Depacketizer::new(layout.clone());
    for (i, p) in frame.packets.iter().enumerate() {
        if i < frame.critical_packets || i % 4 != 1 {
            d.push(&frame.data[p.clone()]).unwrap();
        }
    }
    assert!(!d.readiness().is_complete_enough());

    // Everything but the start-of-frame header: nothing is decodable, because
    // nothing says how many blocks the frame has.
    let mut d = Depacketizer::new(layout);
    let first = &frame.data[frame.packets[0].clone()];
    d.push(&first[HEADER_SIZE..]).unwrap();
    for p in &frame.packets[1..n] {
        d.push(&frame.data[p.clone()]).unwrap();
    }
    assert!(!d.readiness().has_header);
    assert!(!d.readiness().is_complete_enough());
}

#[test]
fn sequence_numbers_wrap_and_stale_frames_drop() {
    let mut rng = Rng(21);
    let layout = Layout::new(128, 128, Chroma::Yuv420).unwrap();
    let packet = |s: u8, rng: &mut Rng| {
        let mut p = seq(&layout, s).to_bytes().to_vec();
        p.extend(make_block(&layout, 0, s, rng));
        p
    };
    let mut d = Depacketizer::new(layout.clone());
    assert_eq!(d.push(&packet(7, &mut rng)).unwrap(), Push::Accepted);
    assert_eq!(d.readiness().received, 1);
    // 7 → 0 is one frame forward across the wrap: the old frame is abandoned.
    assert_eq!(d.push(&packet(0, &mut rng)).unwrap(), Push::Accepted);
    assert_eq!(d.readiness().received, 1);
    // 6 is behind 0: stale, and it must not disturb the current frame.
    assert_eq!(d.push(&packet(6, &mut rng)).unwrap(), Push::Stale);
    assert_eq!(d.readiness().received, 1);
    // A duplicate block is allowed and counted once.
    let dup = make_block(&layout, 0, 0, &mut rng);
    assert_eq!(d.push(&dup).unwrap(), Push::Accepted);
    assert_eq!(d.readiness().received, 1);
}

#[test]
fn a_different_stream_asks_for_a_new_decoder() {
    let layout = Layout::new(1920, 1080, Chroma::Yuv420).unwrap();
    let mut d = Depacketizer::new(layout);
    let other = SequenceHeader {
        width: 1280,
        height: 720,
        sequence: 0,
        total_blocks: 1,
        chroma: Chroma::Yuv444,
        colour: ColourDescription::bt709(),
    };
    assert_eq!(
        d.push(&other.to_bytes()).unwrap(),
        Push::Reconfigure(StreamInfo {
            width: 1280,
            height: 720,
            chroma: Chroma::Yuv444
        })
    );
    assert!(!d.readiness().has_header);
}

#[test]
fn malformed_packets_are_refused_not_skipped() {
    let mut rng = Rng(31);
    let layout = Layout::new(128, 128, Chroma::Yuv420).unwrap();
    let good = make_block(&layout, 5, 0, &mut rng);

    let mut d = Depacketizer::new(layout.clone());
    // A block cut short.
    assert!(matches!(
        d.push(&good[..good.len() - 4]),
        Err(BitstreamError::Truncated { .. })
    ));
    // A stray partial header at the end. The block before it is sound and is
    // kept; only what follows it is refused.
    let mut kept = Depacketizer::new(layout.clone());
    assert!(matches!(
        kept.push(&[good.clone(), vec![1, 2, 3]].concat()),
        Err(BitstreamError::Truncated { .. })
    ));
    assert_eq!(kept.readiness().received, 1);
    // A header claiming fewer words than itself.
    let mut tiny = good.clone();
    tiny[2] = 1;
    tiny[3] &= 0xf0;
    assert_eq!(d.push(&tiny), Err(BitstreamError::BlockTooSmall(1)));
    // A block index past the layout.
    let mut far = good.clone();
    let far_index = layout.blocks_32x32();
    far[5..8].copy_from_slice(&far_index.to_le_bytes()[..3]);
    assert!(matches!(
        d.push(&far),
        Err(BitstreamError::BlockIndexOutOfRange { .. })
    ));
    // An 8×8 block outside the band: level 4 is 4 coefficients wide, one 8×8
    // block, so ballot bit 1 names a block that cannot exist.
    let edge = BlockHeader {
        ballot: 0b11,
        payload_words: 4,
        sequence: 0,
        quant_code: 0,
        block_index: 0,
    };
    let mut b = edge.to_bytes().to_vec();
    b.extend([0u8; 8]);
    assert!(matches!(
        d.push(&b),
        Err(BitstreamError::BallotOutOfBand {
            index: 0,
            x: 1,
            y: 0
        })
    ));
    // Contents longer than the header admits.
    let mut long = good.clone();
    let words = u16::from_le_bytes([long[2], long[3]]) & 0xfff;
    let shrunk = (words - 1) | (u16::from_le_bytes([long[2], long[3]]) & 0xf000);
    long[2..4].copy_from_slice(&shrunk.to_le_bytes());
    assert!(matches!(
        d.push(&long[..long.len() - 4]),
        Err(BitstreamError::BlockSizeMismatch { .. })
    ));

    // None of that left anything behind.
    assert_eq!(d.readiness().received, 0);
    // And the good block still goes in.
    assert_eq!(d.push(&good).unwrap(), Push::Accepted);
    assert_eq!(d.readiness().received, 1);
}

#[test]
fn random_bytes_never_panic_and_never_pass_as_blocks() {
    let mut rng = Rng(0xdead_beef);
    let layout = Layout::new(640, 480, Chroma::Yuv420).unwrap();
    let mut d = Depacketizer::new(layout);
    let mut accepted = 0;
    for _ in 0..20_000 {
        let len = (rng.next() % 64) as usize;
        let bytes: Vec<u8> = (0..len).map(|_| rng.next() as u8).collect();
        if let Ok(Push::Accepted) = d.push(&bytes) {
            accepted += d.readiness().received;
        }
    }
    // Random bytes that happen to form a consistent block are possible but
    // rare; what matters is that nothing panicked and almost nothing passed.
    assert!(accepted < 20, "{accepted} random packets passed validation");
}

#[test]
fn packetize_refuses_inconsistent_gpu_output() {
    let mut rng = Rng(41);
    let layout = Layout::new(128, 128, Chroma::Yuv420).unwrap();
    let blocks = sample_frame(&layout, 4, |i| i < 3, &mut rng);
    let (table, words) = gpu_output(&layout, &blocks, &mut rng);

    // Another frame's sequence number in a block.
    assert!(matches!(
        packetize(&layout, seq(&layout, 5), &table, &words, 1200),
        Err(BitstreamError::EncoderOutput { .. })
    ));
    // A table entry pointing past what was read back.
    let mut t = table.clone();
    t[1].offset_words = words.len() as u32;
    assert!(matches!(
        packetize(&layout, seq(&layout, 4), &t, &words, 1200),
        Err(BitstreamError::EncoderOutput { .. })
    ));
    // A table entry naming a size its header does not.
    let mut t = table.clone();
    t[2].num_words -= 1;
    assert!(matches!(
        packetize(&layout, seq(&layout, 4), &t, &words, 1200),
        Err(BitstreamError::EncoderOutput { .. })
    ));
    // Two table entries pointing at the same block.
    let mut t = table.clone();
    t[0] = t[1];
    assert!(matches!(
        packetize(&layout, seq(&layout, 4), &t, &words, 1200),
        Err(BitstreamError::EncoderOutput { .. })
    ));
}
