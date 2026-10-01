//! Collecting a frame's blocks as its packets arrive.
//!
//! Packets can come in any order, some never, and a newer frame's can arrive
//! before an older frame is done. The 3-bit sequence number decides which frame
//! a packet belongs to, exactly as upstream's decoder does: a packet from an
//! older frame is dropped, one from a newer frame abandons the current one.
//!
//! Every block is checked here, on the CPU, before it can reach the GPU. The
//! dequantizer reads plane bytes and sign bits at offsets computed from each
//! block's own code words, so a block whose contents disagree with its
//! declared size would make it read past its end. This is network input; the
//! check is what keeps a corrupt or hostile packet from becoming an
//! out-of-bounds read on the device.

use super::{
    BitstreamError, BlockHeader, Chroma, ColourDescription, HEADER_SIZE, Header, Layout,
    SEQUENCE_MASK, SequenceHeader, packetize::CRITICAL_BANDS,
};

/// The parts of a sequence header that fix the decoder's resources.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StreamInfo {
    pub width: u32,
    pub height: u32,
    pub chroma: Chroma,
}

/// What became of a packet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Push {
    /// Its blocks were taken.
    Accepted,
    /// It belongs to a frame older than the one being collected, and was
    /// dropped.
    Stale,
    /// Its sequence header describes a different size or chroma format than
    /// this decoder was built for. Nothing was taken; the caller rebuilds the
    /// decoder for `StreamInfo` and pushes the packet again.
    Reconfigure(StreamInfo),
}

/// How much of the current frame has arrived.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Readiness {
    /// Whether a start-of-frame header has been seen for this frame.
    pub has_header: bool,
    /// Distinct blocks received.
    pub received: u32,
    /// Non-empty blocks the frame has, from its header, or every possible
    /// block if the header has not arrived.
    pub expected: u32,
    /// Whether every block of the two coarsest bands is here.
    ///
    /// A guess, and a pessimistic one: a block the encoder quantized to
    /// nothing is never sent, and this cannot tell it from a lost one. The
    /// coarse high-pass bands of noisy content are often empty, so this reads
    /// false on frames that arrived complete. A transport that knows which
    /// packets were critical should say so instead, through
    /// [`Readiness::is_complete_enough_with`].
    pub critical_complete: bool,
    /// Whether this frame was already decoded.
    pub decoded: bool,
}

impl Readiness {
    /// Every block has arrived.
    pub fn is_complete(&self) -> bool {
        !self.decoded && self.has_header && self.received >= self.expected
    }

    /// Upstream's rule for decoding a partial frame: everything, or more than
    /// 90% of it with the two coarsest bands intact. Losing blocks from finer
    /// bands only blurs their region; losing the coarse ones does not mask.
    pub fn is_complete_enough(&self) -> bool {
        self.is_complete_enough_with(self.critical_complete)
    }

    /// The same rule, with whether the coarse bands are whole decided by the
    /// caller: by a transport that knows which packets carried them, which
    /// this cannot know. See [`Readiness::critical_complete`].
    pub fn is_complete_enough_with(&self, critical_complete: bool) -> bool {
        if self.decoded || !self.has_header {
            return false;
        }
        self.received >= self.expected
            || (critical_complete && self.received as f32 > self.expected as f32 * 0.9)
    }
}

/// Collects blocks for one frame at a time.
pub struct Depacketizer {
    layout: Layout,
    sequence: Option<u8>,
    header: Option<SequenceHeader>,
    /// Word offset of each block within `payload`, or `u32::MAX` if missing.
    /// Uploaded as is: the dequantizer reads `u32::MAX` as "decode zeros".
    offsets: Vec<u32>,
    payload: Vec<u32>,
    received: u32,
    decoded: bool,
}

/// The dequantizer marks a missing block this way.
pub(crate) const MISSING: u32 = u32::MAX;

impl Depacketizer {
    pub fn new(layout: Layout) -> Self {
        let blocks = layout.blocks_32x32() as usize;
        let mut this = Self {
            layout,
            sequence: None,
            header: None,
            offsets: vec![MISSING; blocks],
            payload: Vec::with_capacity(256 * 1024),
            received: 0,
            decoded: false,
        };
        this.clear();
        this
    }

    pub fn layout(&self) -> &Layout {
        &self.layout
    }

    /// Takes one packet: any mix of start-of-frame headers and blocks.
    ///
    /// A packet that fails to parse is rejected whole, but blocks taken from
    /// it before the failure stay: each was checked on its own and is sound.
    pub fn push(&mut self, packet: &[u8]) -> Result<Push, BitstreamError> {
        let mut rest = packet;
        while !rest.is_empty() {
            match Header::parse(rest)? {
                Header::Sequence(seq) => {
                    if self.is_stale(seq.sequence) {
                        return Ok(Push::Stale);
                    }
                    let info = StreamInfo {
                        width: seq.width,
                        height: seq.height,
                        chroma: seq.chroma,
                    };
                    if info.width != self.layout.width
                        || info.height != self.layout.height
                        || info.chroma != self.layout.chroma
                    {
                        return Ok(Push::Reconfigure(info));
                    }
                    self.enter(seq.sequence);
                    self.header = Some(seq);
                    rest = &rest[HEADER_SIZE..];
                }
                Header::Block(block) => {
                    let size = usize::from(block.payload_words) * 4;
                    if size < HEADER_SIZE {
                        return Err(BitstreamError::BlockTooSmall(block.payload_words.into()));
                    }
                    if size > rest.len() {
                        return Err(BitstreamError::Truncated {
                            needed: size,
                            left: rest.len(),
                        });
                    }
                    if self.is_stale(block.sequence) {
                        return Ok(Push::Stale);
                    }
                    self.enter(block.sequence);
                    self.take(&block, &rest[..size])?;
                    rest = &rest[size..];
                }
            }
        }
        Ok(Push::Accepted)
    }

    /// Sequence arithmetic modulo 8, as upstream: anything more than half the
    /// ring behind is from the past.
    fn is_stale(&self, sequence: u8) -> bool {
        match self.sequence {
            None => false,
            Some(current) => {
                let diff = sequence.wrapping_sub(current) & SEQUENCE_MASK;
                diff > SEQUENCE_MASK / 2
            }
        }
    }

    /// Makes `sequence` the frame being collected, abandoning any other.
    fn enter(&mut self, sequence: u8) {
        if self.sequence != Some(sequence) {
            self.clear();
            self.sequence = Some(sequence);
        }
    }

    fn take(&mut self, block: &BlockHeader, bytes: &[u8]) -> Result<(), BitstreamError> {
        let count = self.layout.blocks_32x32();
        if block.block_index >= count {
            return Err(BitstreamError::BlockIndexOutOfRange {
                index: block.block_index,
                count,
            });
        }
        validate_block(&self.layout, block, bytes)?;

        let slot = &mut self.offsets[block.block_index as usize];
        if *slot != MISSING {
            // The format allows duplicates, for crude redundancy.
            return Ok(());
        }
        *slot = self.payload.len() as u32;
        let (words, _) = bytes.as_chunks::<4>();
        self.payload
            .extend(words.iter().map(|w| u32::from_le_bytes(*w)));
        self.received += 1;
        Ok(())
    }

    /// Forgets the current frame.
    pub fn clear(&mut self) {
        self.offsets.fill(MISSING);
        self.payload.clear();
        self.header = None;
        self.sequence = None;
        self.received = 0;
        self.decoded = false;
    }

    pub fn readiness(&self) -> Readiness {
        Readiness {
            has_header: self.header.is_some(),
            received: self.received,
            expected: self
                .header
                .map_or(self.layout.blocks_32x32(), |h| h.total_blocks),
            critical_complete: self.critical_complete(),
            decoded: self.decoded,
        }
    }

    /// Whether every block of the coarsest bands arrived.
    ///
    /// A block missing because the encoder sent nothing for it is
    /// indistinguishable from one lost in transit, so this can reject a frame
    /// whose coarse bands were legitimately empty. Upstream accepts the same
    /// false rejection; in the coarsest bands an all-zero block is vanishingly
    /// rare.
    fn critical_complete(&self) -> bool {
        let limit = self.layout.leading_blocks(CRITICAL_BANDS) as usize;
        self.offsets[..limit].iter().all(|&o| o != MISSING)
    }

    /// The colour the current frame's header describes.
    pub fn colour(&self) -> Option<ColourDescription> {
        self.header.map(|h| h.colour)
    }

    /// Distinct blocks the current frame's header promised but that have not
    /// arrived.
    pub fn missing_blocks(&self) -> u32 {
        self.readiness().expected.saturating_sub(self.received)
    }

    /// The block offsets and payload words to upload, and marks the frame
    /// decoded so it is not decoded twice.
    pub(crate) fn take_for_decode(&mut self) -> (&[u32], &[u32]) {
        self.decoded = true;
        (&self.offsets, &self.payload)
    }
}

/// Checks that a block's contents are exactly as long as its header says.
///
/// The walk is upstream's `validate_bitstream`: for every 8×8 block the ballot
/// says is present, its code word gives the bit planes of each 4×2 subblock;
/// the planes' union gives how many coefficients are significant, and so how
/// many sign bits follow. The total, padded to a word, must equal
/// `payload_words`.
pub(crate) fn validate_block(
    layout: &Layout,
    block: &BlockHeader,
    bytes: &[u8],
) -> Result<(), BitstreamError> {
    let index = block.block_index;
    let mapping = layout
        .mapping(index)
        .expect("block index was range checked");
    let n = block.ballot.count_ones() as usize;
    let declared = u32::from(block.payload_words);

    let mut offset = HEADER_SIZE + 3 * n;
    if offset > bytes.len() {
        return Err(BitstreamError::BlockSizeMismatch {
            index,
            computed: offset.div_ceil(4) as u32,
            declared,
        });
    }
    let code_words = &bytes[HEADER_SIZE..HEADER_SIZE + 2 * n];
    let q_scales = &bytes[HEADER_SIZE + 2 * n..HEADER_SIZE + 3 * n];

    let mut significant = 0u32;
    for (i, bit) in (0..16u32)
        .filter(|b| block.ballot >> b & 1 != 0)
        .enumerate()
    {
        let (x, y) = (bit & 3, bit >> 2);
        if x >= mapping.width_8x8 || y >= mapping.height_8x8 {
            return Err(BitstreamError::BallotOutOfBand { index, x, y });
        }
        let code_word = u16::from_le_bytes([code_words[2 * i], code_words[2 * i + 1]]);
        let q_bits = usize::from(q_scales[i] & 0xf);
        for subblock in 0..8 {
            let planes = q_bits + usize::from(code_word >> (2 * subblock) & 3);
            let Some(plane_bytes) = bytes.get(offset..offset + planes) else {
                return Err(BitstreamError::BlockSizeMismatch {
                    index,
                    computed: (offset + planes).div_ceil(4) as u32,
                    declared,
                });
            };
            let union = plane_bytes.iter().fold(0u8, |a, &b| a | b);
            significant += union.count_ones();
            offset += planes;
        }
    }
    offset += (significant as usize).div_ceil(8);

    let computed = offset.div_ceil(4) as u32;
    if computed != declared {
        return Err(BitstreamError::BlockSizeMismatch {
            index,
            computed,
            declared,
        });
    }
    Ok(())
}
