//! The wavelet coefficient images both halves of the codec work in.
//!
//! Upstream's precision level 1: levels 0 and 1, the large ones, are stored
//! as FP16, and levels 2 to 4, where the energy of the image concentrates and
//! the bandwidth is trivial, as FP32. Each image is an array of 12 layers,
//! four bands for each of three components, with one mip per level.

use ash::vk;

use crate::bitstream::{DECOMPOSITION_LEVELS, Layout, NUM_COMPONENTS};
use crate::device::Context;
use crate::error::Result;
use crate::gpu::{Image, ImageDesc, Sampler};

/// Levels stored as FP16; the rest are FP32.
const FP16_LEVELS: usize = 2;

pub(crate) struct Wavelet {
    high: Image,
    low: Image,
    /// Per component and level, the four bands as a 2D array.
    pub bands: [[vk::ImageView; DECOMPOSITION_LEVELS]; NUM_COMPONENTS],
    /// Per component and level, the LL band alone as a 2D image.
    pub ll: [[vk::ImageView; DECOMPOSITION_LEVELS]; NUM_COMPONENTS],
    /// Edges of every transform mirror through this.
    pub mirror: Sampler,
    /// The quantizer reads past a band's edge as zero through this.
    pub border: Sampler,
}

impl Wavelet {
    pub fn new(ctx: &Context, layout: &Layout) -> Result<Self> {
        let (w, h) = layout.level_size(0);
        let usage = vk::ImageUsageFlags::SAMPLED | vk::ImageUsageFlags::STORAGE;
        let layers = 4 * NUM_COMPONENTS as u32;
        let mut high = Image::new(
            ctx,
            &ImageDesc {
                format: vk::Format::R16_SFLOAT,
                width: w,
                height: h,
                layers,
                mips: FP16_LEVELS as u32,
                usage,
                families: &[],
            },
        )?;
        let mut low = Image::new(
            ctx,
            &ImageDesc {
                format: vk::Format::R32_SFLOAT,
                width: w >> FP16_LEVELS,
                height: h >> FP16_LEVELS,
                layers,
                mips: (DECOMPOSITION_LEVELS - FP16_LEVELS) as u32,
                usage,
                families: &[],
            },
        )?;

        let mut bands = [[vk::ImageView::null(); DECOMPOSITION_LEVELS]; NUM_COMPONENTS];
        let mut ll = bands;
        for level in 0..DECOMPOSITION_LEVELS {
            let (image, mip) = if level < FP16_LEVELS {
                (&mut high, level as u32)
            } else {
                (&mut low, (level - FP16_LEVELS) as u32)
            };
            for component in 0..NUM_COMPONENTS {
                let base = 4 * component as u32;
                bands[component][level] =
                    image.view(vk::ImageViewType::TYPE_2D_ARRAY, mip, base, 4)?;
                ll[component][level] = image.view(vk::ImageViewType::TYPE_2D, mip, base, 1)?;
            }
        }

        Ok(Self {
            high,
            low,
            bands,
            ll,
            mirror: Sampler::new(ctx, vk::SamplerAddressMode::MIRRORED_REPEAT)?,
            border: Sampler::new(ctx, vk::SamplerAddressMode::CLAMP_TO_BORDER)?,
        })
    }

    /// Both images, for a transition out of `UNDEFINED`: a frame never reads
    /// what the previous one left.
    pub fn images(&self) -> [vk::Image; 2] {
        [self.high.image, self.low.image]
    }
}
