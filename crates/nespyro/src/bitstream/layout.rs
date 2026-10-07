//! Where every block of a frame lives.
//!
//! The block index of a 32×32 block is its position in a fixed walk: levels
//! from coarsest to finest, then Y, Cb, Cr, then band, then row-major within
//! the band (`bitstream.md`, "Block index ordering"). Low frequencies come
//! first, which is what lets a packetizer put the blocks that matter most in
//! the first packets.
//!
//! 8×8 blocks are numbered the same way and index the encoder's per-block
//! statistics. They never appear on the wire.

use super::{
    ALIGNMENT, BitstreamError, Chroma, DECOMPOSITION_LEVELS, MAXIMUM_IMAGE_SIZE,
    MINIMUM_IMAGE_SIZE, NUM_BANDS, NUM_COMPONENTS,
};

/// One sub-band of one component at one level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct BandLayout {
    /// Size of the band in coefficients.
    pub width: u32,
    pub height: u32,
    /// Index of the band's first 8×8 block, and 8×8 blocks per row.
    pub offset_8x8: u32,
    pub stride_8x8: u32,
    /// Index of the band's first 32×32 block, 32×32 blocks per row, and how
    /// many it has.
    pub offset_32x32: u32,
    pub stride_32x32: u32,
    pub count_32x32: u32,
}

impl BandLayout {
    /// 8×8 blocks across and down.
    pub fn blocks_8x8(&self) -> (u32, u32) {
        (self.width.div_ceil(8), self.height.div_ceil(8))
    }

    /// 32×32 blocks across and down.
    pub fn blocks_32x32(&self) -> (u32, u32) {
        (self.width.div_ceil(32), self.height.div_ceil(32))
    }
}

/// The 8×8 blocks a 32×32 block covers. Edge blocks cover fewer than 4×4.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BlockMapping {
    pub offset_8x8: u32,
    pub stride_8x8: u32,
    pub width_8x8: u32,
    pub height_8x8: u32,
}

/// Every band's position in the block numbering, for one frame size and
/// chroma format.
#[derive(Debug, Clone)]
pub struct Layout {
    pub width: u32,
    pub height: u32,
    pub chroma: Chroma,
    /// `width` and `height` padded to [`ALIGNMENT`] and at least
    /// [`MINIMUM_IMAGE_SIZE`].
    pub aligned_width: u32,
    pub aligned_height: u32,
    bands: [[[Option<BandLayout>; NUM_BANDS]; DECOMPOSITION_LEVELS]; NUM_COMPONENTS],
    mapping: Vec<BlockMapping>,
    blocks_8x8: u32,
}

impl Layout {
    pub fn new(width: u32, height: u32, chroma: Chroma) -> Result<Self, BitstreamError> {
        if !(1..=MAXIMUM_IMAGE_SIZE).contains(&width) || !(1..=MAXIMUM_IMAGE_SIZE).contains(&height)
        {
            return Err(BitstreamError::BadDimensions { width, height });
        }
        if chroma == Chroma::Yuv420 && (!width.is_multiple_of(2) || !height.is_multiple_of(2)) {
            return Err(BitstreamError::OddYuv420 { width, height });
        }

        let aligned_width = width.next_multiple_of(ALIGNMENT).max(MINIMUM_IMAGE_SIZE);
        let aligned_height = height.next_multiple_of(ALIGNMENT).max(MINIMUM_IMAGE_SIZE);

        let mut layout = Self {
            width,
            height,
            chroma,
            aligned_width,
            aligned_height,
            bands: Default::default(),
            mapping: Vec::new(),
            blocks_8x8: 0,
        };

        for level in (0..DECOMPOSITION_LEVELS).rev() {
            for component in 0..NUM_COMPONENTS {
                if !chroma.has_level(component, level) {
                    continue;
                }
                for band in first_band(level)..NUM_BANDS {
                    let (w, h) = layout.level_size(level);
                    let blocks_x_8x8 = w.div_ceil(8);
                    let blocks_y_8x8 = h.div_ceil(8);
                    let blocks_x_32x32 = w.div_ceil(32);
                    let blocks_y_32x32 = h.div_ceil(32);

                    layout.bands[component][level][band] = Some(BandLayout {
                        width: w,
                        height: h,
                        offset_8x8: layout.blocks_8x8,
                        stride_8x8: blocks_x_8x8,
                        offset_32x32: layout.mapping.len() as u32,
                        stride_32x32: blocks_x_32x32,
                        count_32x32: blocks_x_32x32 * blocks_y_32x32,
                    });

                    for y in 0..blocks_y_32x32 {
                        for x in 0..blocks_x_32x32 {
                            layout.mapping.push(BlockMapping {
                                offset_8x8: layout.blocks_8x8 + 4 * y * blocks_x_8x8 + 4 * x,
                                stride_8x8: blocks_x_8x8,
                                width_8x8: 4.min(blocks_x_8x8 - 4 * x),
                                height_8x8: 4.min(blocks_y_8x8 - 4 * y),
                            });
                        }
                    }
                    layout.blocks_8x8 += blocks_x_8x8 * blocks_y_8x8;
                }
            }
        }

        Ok(layout)
    }

    /// Size of every band at `level`, in coefficients. Level 0 is half the
    /// aligned image; each level halves again.
    pub fn level_size(&self, level: usize) -> (u32, u32) {
        (
            self.aligned_width >> (level + 1),
            self.aligned_height >> (level + 1),
        )
    }

    /// The band, or `None` where the format has none: the LL band exists only
    /// at the coarsest level, and 4:2:0 chroma has no level 0.
    pub fn band(&self, component: usize, level: usize, band: usize) -> Option<&BandLayout> {
        self.bands[component][level][band].as_ref()
    }

    /// Every band that exists, as `(component, level, band, layout)`, in the
    /// order the GPU passes dispatch them: finest level first.
    pub fn bands(&self) -> impl Iterator<Item = (usize, usize, usize, &BandLayout)> {
        (0..DECOMPOSITION_LEVELS).flat_map(move |level| {
            (0..NUM_COMPONENTS).flat_map(move |component| {
                (0..NUM_BANDS).filter_map(move |band| {
                    self.band(component, level, band)
                        .map(|b| (component, level, band, b))
                })
            })
        })
    }

    /// Total 32×32 blocks, the range of valid block indices.
    pub fn blocks_32x32(&self) -> u32 {
        self.mapping.len() as u32
    }

    /// Total 8×8 blocks.
    pub fn blocks_8x8(&self) -> u32 {
        self.blocks_8x8
    }

    /// The 8×8 blocks a 32×32 block covers.
    pub fn mapping(&self, block_index: u32) -> Option<&BlockMapping> {
        self.mapping.get(block_index as usize)
    }

    /// How many leading block indices make up the `bands` coarsest bands, by
    /// upstream's definition (`get_num_active_blocks`).
    ///
    /// The range ends at Cr's last band of that depth, and blocks run
    /// component by component within a level, so `bands = 1` ends at Cr's LL
    /// band and includes Y's and Cb's high-pass bands at the coarsest level
    /// with it. From `bands = 2` on it covers whole levels: 2 is all of the
    /// coarsest level, 3 adds the next level's high-pass bands, and so on.
    pub fn leading_blocks(&self, bands: usize) -> u32 {
        assert!(bands < DECOMPOSITION_LEVELS);
        if bands == 0 {
            return 0;
        }
        let last_level = DECOMPOSITION_LEVELS - (bands - 1).max(1);
        let last_band = if bands == 1 { 0 } else { NUM_BANDS - 1 };
        let b = self
            .band(NUM_COMPONENTS - 1, last_level, last_band)
            .expect("coarse bands exist for every component");
        b.offset_32x32 + b.count_32x32
    }
}

/// The LL band is only coded at the coarsest level; every finer level's LL is
/// reconstructed from the level below it.
pub(crate) fn first_band(level: usize) -> usize {
    if level == DECOMPOSITION_LEVELS - 1 {
        0
    } else {
        1
    }
}
