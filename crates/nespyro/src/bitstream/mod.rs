//! PyroWave's bitstream, with no Vulkan in it.
//!
//! Everything here is the format as upstream defines it in
//! `bitstream/bitstream.md` at PyroWave `89f7e47`, byte for byte: a stream this
//! crate writes decodes in upstream's decoder, and one upstream writes decodes
//! here. Nothing is added to it. The format has no version field of its own, so
//! the version travels in nesprotocol instead.
//!
//! A frame is a start-of-frame header followed by independently decodable
//! 32×32 coefficient blocks. A block needs no context from any other block,
//! which is what makes the format loss tolerant: a missing block decodes as
//! zeros and only blurs its own region.

mod depacketize;
mod layout;
mod packetize;

pub use depacketize::{Depacketizer, Push, Readiness, StreamInfo};
pub use layout::{BandLayout, BlockMapping, Layout};
pub use packetize::{GpuPacket, Packetized, packetize};

use thiserror::Error;

/// Wavelet decomposition levels. Fixed by the format.
pub const DECOMPOSITION_LEVELS: usize = 5;
/// Y, Cb and Cr.
pub const NUM_COMPONENTS: usize = 3;
/// LL, HL, LH and HH.
pub const NUM_BANDS: usize = 4;
/// Image dimensions are padded to a multiple of this, one per decomposition level.
pub const ALIGNMENT: u32 = 1 << DECOMPOSITION_LEVELS;
/// Below this the coarsest band is so small that the mirrored edge extension
/// starts mirroring twice, so smaller images are padded up to it.
pub const MINIMUM_IMAGE_SIZE: u32 = 4 << DECOMPOSITION_LEVELS;
/// Width and height are 14-bit fields holding the value minus one.
pub const MAXIMUM_IMAGE_SIZE: u32 = 1 << 14;
/// The frame counter is three bits wide.
pub const SEQUENCE_MASK: u8 = 0x7;
/// Both header kinds are eight bytes.
pub const HEADER_SIZE: usize = 8;
/// `payload_words` is a 12-bit field.
pub const MAX_BLOCK_WORDS: u32 = (1 << 12) - 1;

/// The largest a 32×32 block can possibly be, in 32-bit words.
///
/// Sixteen 8×8 blocks, each with a 2-byte code word, a 1-byte scale, eight
/// 4×2 subblocks of at most 15 + 3 bit planes one byte each, and one sign bit
/// per coefficient, after the 8-byte header. It is far below
/// [`MAX_BLOCK_WORDS`], which is why an encoder never has to cap a block to
/// fit the field.
pub const LARGEST_BLOCK_WORDS: u32 = {
    let bytes = HEADER_SIZE as u32 + 16 * (2 + 1 + 8 * 18) + (32 * 32) / 8;
    bytes.div_ceil(4)
};
const _: () = assert!(LARGEST_BLOCK_WORDS <= MAX_BLOCK_WORDS);

/// Chroma resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Chroma {
    /// Chroma at half resolution in both directions. Needs even dimensions.
    Yuv420,
    /// Chroma at full resolution.
    Yuv444,
}

impl Chroma {
    /// Whether this component is present at this decomposition level.
    ///
    /// 4:2:0 chroma planes are half size, so they enter the transform at level
    /// 1 and have no level 0 bands at all.
    pub fn has_level(self, component: usize, level: usize) -> bool {
        !(self == Chroma::Yuv420 && component != 0 && level == 0)
    }
}

/// Colour primaries, as the sequence header signals them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Primaries {
    Bt709,
    Bt2020,
}

/// Transfer function, as the sequence header signals it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Transfer {
    Bt709,
    Pq,
}

/// YCbCr matrix. BT.2020 is the non-constant-luminance variant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Matrix {
    Bt709,
    Bt2020Ncl,
}

/// YCbCr range.
///
/// This crate only ever writes [`Range::Full`]. `Limited` exists because a
/// stream from elsewhere can say so, and a decoder must report what the stream
/// says rather than what it expected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Range {
    Full,
    Limited,
}

/// Where 4:2:0 chroma samples sit relative to luma.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Siting {
    Center,
    Left,
}

/// How to interpret decoded Y, Cb and Cr. Signalled in every frame's sequence
/// header; it does not affect decoding itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ColourDescription {
    pub primaries: Primaries,
    pub transfer: Transfer,
    pub matrix: Matrix,
    pub range: Range,
    pub siting: Siting,
}

impl ColourDescription {
    /// SDR: BT.709 primaries, transfer and matrix, full range.
    pub const fn bt709() -> Self {
        Self {
            primaries: Primaries::Bt709,
            transfer: Transfer::Bt709,
            matrix: Matrix::Bt709,
            range: Range::Full,
            siting: Siting::Center,
        }
    }

    /// HDR10: BT.2020 primaries and matrix, PQ transfer, full range.
    pub const fn bt2020_pq() -> Self {
        Self {
            primaries: Primaries::Bt2020,
            transfer: Transfer::Pq,
            matrix: Matrix::Bt2020Ncl,
            range: Range::Full,
            siting: Siting::Center,
        }
    }

    /// Whether this is an HDR description.
    pub fn is_hdr(&self) -> bool {
        self.transfer == Transfer::Pq
    }
}

impl Default for ColourDescription {
    fn default() -> Self {
        Self::bt709()
    }
}

/// The 8-byte header every 32×32 block starts with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BlockHeader {
    /// One bit per 8×8 block in the 4×4 grid, row major. A zero bit means that
    /// 8×8 block is all zero and is not transmitted.
    pub ballot: u16,
    /// Size of the whole block including this header, in 32-bit words.
    pub payload_words: u16,
    /// Frame counter, modulo 8.
    pub sequence: u8,
    /// How to scale this block's coefficients back to floating point.
    pub quant_code: u8,
    /// The block's position in [`Layout`]'s ordering. 24 bits.
    pub block_index: u32,
}

/// The start-of-frame header, a reinterpretation of the block header when its
/// `extended` bit is set.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SequenceHeader {
    pub width: u32,
    pub height: u32,
    /// Frame counter, modulo 8.
    pub sequence: u8,
    /// Number of non-empty blocks in this frame.
    pub total_blocks: u32,
    pub chroma: Chroma,
    pub colour: ColourDescription,
}

/// Either kind of header, as read from the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Header {
    Block(BlockHeader),
    Sequence(SequenceHeader),
}

/// Start-of-frame is the only extended code the format defines.
const EXTENDED_CODE_START_OF_FRAME: u32 = 0;

fn word(bytes: &[u8], index: usize) -> u32 {
    u32::from_le_bytes(bytes[4 * index..4 * index + 4].try_into().unwrap())
}

impl BlockHeader {
    /// The header as the eight bytes that go on the wire.
    pub fn to_bytes(&self) -> [u8; HEADER_SIZE] {
        let w0 = u32::from(self.ballot)
            | (u32::from(self.payload_words) & 0xfff) << 16
            | (u32::from(self.sequence & SEQUENCE_MASK)) << 28;
        let w1 = u32::from(self.quant_code) | (self.block_index & 0xff_ffff) << 8;
        let mut out = [0; HEADER_SIZE];
        out[..4].copy_from_slice(&w0.to_le_bytes());
        out[4..].copy_from_slice(&w1.to_le_bytes());
        out
    }

    /// Reads a header from two words already known not to be extended.
    fn from_words(w0: u32, w1: u32) -> Self {
        Self {
            ballot: w0 as u16,
            payload_words: ((w0 >> 16) & 0xfff) as u16,
            sequence: ((w0 >> 28) & 0x7) as u8,
            quant_code: w1 as u8,
            block_index: w1 >> 8,
        }
    }
}

impl SequenceHeader {
    /// The header as the eight bytes that go on the wire.
    pub fn to_bytes(&self) -> [u8; HEADER_SIZE] {
        debug_assert!((1..=MAXIMUM_IMAGE_SIZE).contains(&self.width));
        debug_assert!((1..=MAXIMUM_IMAGE_SIZE).contains(&self.height));
        let c = &self.colour;
        let w0 = (self.width - 1) & 0x3fff
            | ((self.height - 1) & 0x3fff) << 14
            | u32::from(self.sequence & SEQUENCE_MASK) << 28
            | 1 << 31;
        let w1 = self.total_blocks & 0xff_ffff
            | EXTENDED_CODE_START_OF_FRAME << 24
            | u32::from(self.chroma == Chroma::Yuv444) << 26
            | u32::from(c.primaries == Primaries::Bt2020) << 27
            | u32::from(c.transfer == Transfer::Pq) << 28
            | u32::from(c.matrix == Matrix::Bt2020Ncl) << 29
            | u32::from(c.range == Range::Limited) << 30
            | u32::from(c.siting == Siting::Left) << 31;
        let mut out = [0; HEADER_SIZE];
        out[..4].copy_from_slice(&w0.to_le_bytes());
        out[4..].copy_from_slice(&w1.to_le_bytes());
        out
    }
}

impl Header {
    /// Reads whichever header the first eight bytes hold.
    pub fn parse(bytes: &[u8]) -> Result<Self, BitstreamError> {
        if bytes.len() < HEADER_SIZE {
            return Err(BitstreamError::Truncated {
                needed: HEADER_SIZE,
                left: bytes.len(),
            });
        }
        let w0 = word(bytes, 0);
        let w1 = word(bytes, 1);

        if w0 >> 31 == 0 {
            return Ok(Header::Block(BlockHeader::from_words(w0, w1)));
        }

        let code = (w1 >> 24) & 0x3;
        if code != EXTENDED_CODE_START_OF_FRAME {
            return Err(BitstreamError::UnknownExtendedCode(code));
        }
        let bit = |n: u32| (w1 >> n) & 1 != 0;
        Ok(Header::Sequence(SequenceHeader {
            width: (w0 & 0x3fff) + 1,
            height: ((w0 >> 14) & 0x3fff) + 1,
            sequence: ((w0 >> 28) & 0x7) as u8,
            total_blocks: w1 & 0xff_ffff,
            chroma: if bit(26) {
                Chroma::Yuv444
            } else {
                Chroma::Yuv420
            },
            colour: ColourDescription {
                primaries: if bit(27) {
                    Primaries::Bt2020
                } else {
                    Primaries::Bt709
                },
                transfer: if bit(28) {
                    Transfer::Pq
                } else {
                    Transfer::Bt709
                },
                matrix: if bit(29) {
                    Matrix::Bt2020Ncl
                } else {
                    Matrix::Bt709
                },
                range: if bit(30) { Range::Limited } else { Range::Full },
                siting: if bit(31) {
                    Siting::Left
                } else {
                    Siting::Center
                },
            },
        }))
    }
}

/// Something in a stream that the format does not allow.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum BitstreamError {
    #[error("truncated: needed {needed} bytes, {left} left")]
    Truncated { needed: usize, left: usize },
    #[error("extended header code {0} is reserved")]
    UnknownExtendedCode(u32),
    #[error("block header says {0} words, less than the header itself")]
    BlockTooSmall(u32),
    #[error("block index {index} is out of range (the layout has {count})")]
    BlockIndexOutOfRange { index: u32, count: u32 },
    #[error("block {index}: 8×8 block ({x}, {y}) is outside the band")]
    BallotOutOfBand { index: u32, x: u32, y: u32 },
    #[error("block {index}: its contents need {computed} words, its header says {declared}")]
    BlockSizeMismatch {
        index: u32,
        computed: u32,
        declared: u32,
    },
    #[error("4:2:0 needs even dimensions, got {width}x{height}")]
    OddYuv420 { width: u32, height: u32 },
    #[error("dimensions {width}x{height} are outside 1..={MAXIMUM_IMAGE_SIZE}")]
    BadDimensions { width: u32, height: u32 },
    #[error("the encoder's output for block {index} is inconsistent: {what}")]
    EncoderOutput { index: u32, what: &'static str },
}

#[cfg(test)]
mod tests;
