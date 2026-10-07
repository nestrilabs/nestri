//! Turning the encoder's GPU output into a frame.
//!
//! The GPU writes finished 32×32 blocks wherever an atomic counter puts them,
//! so their order in its output buffer changes from run to run. Beside them it
//! writes a table giving each block's position. Packetizing walks that table
//! in block-index order, which is what makes the result deterministic: the same
//! input gives the same bytes however the GPU scheduled its work.

use std::ops::Range;

use super::{BitstreamError, BlockHeader, HEADER_SIZE, Header, Layout, SequenceHeader};

/// One entry of the GPU's block table: where block `i` landed, in 32-bit
/// words, and how many words it is. Zero words means the block quantized to
/// nothing and is not sent. Matches `BitstreamPacket` in `block_packing`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(C)]
pub struct GpuPacket {
    pub offset_words: u32,
    pub num_words: u32,
}

/// A frame, ready for the network.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Packetized {
    /// The start-of-frame header, then every non-empty block in index order.
    pub data: Vec<u8>,
    /// `data` cut into packets. Every one parses on its own; none splits a
    /// block, and none exceeds the packet size unless a single block does.
    pub packets: Vec<Range<usize>>,
    /// How many leading packets carry the two coarsest bands, whose loss the
    /// decoder cannot mask. These deserve the most reliable delivery.
    pub critical_packets: usize,
    /// Non-empty blocks in the frame.
    pub blocks: u32,
}

/// The bands whose loss is not maskable: the coarsest LL and the high-pass
/// bands of the same level. Upstream's decoder refuses a partial frame without
/// them, and so does [`super::Readiness::is_complete_enough`].
pub(crate) const CRITICAL_BANDS: usize = 2;

/// Builds a frame from the GPU's block table and bitstream.
///
/// `bitstream` is the part of the GPU's output that was read back. A block
/// lying outside it is an error rather than a truncated frame: it means the
/// read-back was too small for what rate control produced.
pub fn packetize(
    layout: &Layout,
    header: SequenceHeader,
    table: &[GpuPacket],
    bitstream: &[u32],
    packet_size: usize,
) -> Result<Packetized, BitstreamError> {
    assert_eq!(table.len(), layout.blocks_32x32() as usize);
    assert!(packet_size >= HEADER_SIZE);

    let mut blocks = 0u32;
    for (index, entry) in table.iter().enumerate() {
        let index = index as u32;
        if entry.num_words == 0 {
            continue;
        }
        let words = block_words(index, entry, bitstream)?;
        let Header::Block(block) = Header::parse(bytes_of(&words[..2]))? else {
            return Err(BitstreamError::EncoderOutput {
                index,
                what: "block has its extended bit set",
            });
        };
        check_block(index, entry, &block, header.sequence)?;
        blocks += 1;
    }

    let total_bytes: usize = HEADER_SIZE
        + table
            .iter()
            .map(|e| e.num_words as usize * 4)
            .sum::<usize>();
    let mut data = Vec::with_capacity(total_bytes);
    data.extend_from_slice(
        &SequenceHeader {
            total_blocks: blocks,
            ..header
        }
        .to_bytes(),
    );

    let critical_limit = layout.leading_blocks(CRITICAL_BANDS);
    let mut packets = Vec::new();
    let mut critical_packets = 1;
    let mut packet_start = 0;

    for (index, entry) in table.iter().enumerate() {
        if entry.num_words == 0 {
            continue;
        }
        let size = entry.num_words as usize * 4;
        if data.len() - packet_start + size > packet_size && data.len() > packet_start {
            packets.push(packet_start..data.len());
            packet_start = data.len();
            if (index as u32) < critical_limit {
                critical_packets = packets.len() + 1;
            }
        }
        let words = block_words(index as u32, entry, bitstream)?;
        data.extend_from_slice(bytes_of(words));
    }
    if data.len() > packet_start {
        packets.push(packet_start..data.len());
    }

    Ok(Packetized {
        data,
        packets,
        critical_packets,
        blocks,
    })
}

fn block_words<'a>(
    index: u32,
    entry: &GpuPacket,
    bitstream: &'a [u32],
) -> Result<&'a [u32], BitstreamError> {
    let start = entry.offset_words as usize;
    let end = start + entry.num_words as usize;
    if entry.num_words < 2 {
        return Err(BitstreamError::BlockTooSmall(entry.num_words));
    }
    bitstream
        .get(start..end)
        .ok_or(BitstreamError::EncoderOutput {
            index,
            what: "block lies past the end of the read-back bitstream",
        })
}

/// The checks upstream's packetizer makes in debug builds, made always: a
/// table and a bitstream that disagree mean a GPU-side bug, and sending the
/// result would hand the client a stream it cannot parse.
fn check_block(
    index: u32,
    entry: &GpuPacket,
    block: &BlockHeader,
    sequence: u8,
) -> Result<(), BitstreamError> {
    if block.block_index != index {
        return Err(BitstreamError::EncoderOutput {
            index,
            what: "header names a different block index",
        });
    }
    if u32::from(block.payload_words) != entry.num_words {
        return Err(BitstreamError::EncoderOutput {
            index,
            what: "header and table disagree on the block's size",
        });
    }
    if block.sequence != sequence {
        return Err(BitstreamError::EncoderOutput {
            index,
            what: "header carries another frame's sequence number",
        });
    }
    Ok(())
}

fn bytes_of(words: &[u32]) -> &[u8] {
    // SAFETY: u32 has no padding and any bit pattern is a valid u8; the length
    // is exact. The wire format is little-endian, as every target this crate
    // builds for is.
    const _: () = assert!(cfg!(target_endian = "little"));
    unsafe { std::slice::from_raw_parts(words.as_ptr().cast(), std::mem::size_of_val(words)) }
}
