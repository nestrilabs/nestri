//! The per-band constants rate control starts from, as upstream computes them
//! in `pyrowave_encoder.cpp` at precision level 1.

use crate::bitstream::{Chroma, DECOMPOSITION_LEVELS};

/// Buckets the rate-distortion slopes are sorted into, and how many
/// subdivisions of the block space each has.
pub(crate) const NUM_RDO_BUCKETS: u32 = 128;
pub(crate) const BLOCK_SPACE_SUBDIVISION: u32 = 16;
/// The bucket buffer's two counters are padded to this before the savings.
pub(crate) const RDO_BUCKET_OFFSET: u64 = 64;

/// 32×32 blocks per subdivision, a power of two so a block's subdivision is a
/// shift of its index.
pub(crate) fn blocks_per_subdivision(blocks_32x32: u32) -> u32 {
    blocks_32x32
        .next_multiple_of(BLOCK_SPACE_SUBDIVISION)
        .div_euclid(BLOCK_SPACE_SUBDIVISION)
        .next_power_of_two()
}

/// A flat noise spectrum after the transform: CDF 9/7's low pass gains 6 dB,
/// one bit, per level, so each level and each low-pass direction gets a bit
/// more resolution. Chroma enters a level later and gets one less.
pub(crate) fn noise_power_normalized_quant_resolution(
    level: usize,
    component: usize,
    band: usize,
) -> f32 {
    let mut bits = 8;
    if band == 0 {
        bits += 2;
    } else if band < 3 {
        bits += 1;
    }
    bits += level as i32;
    if component != 0 {
        bits -= 1;
    }
    (1u32 << bits) as f32
}

/// FP16 has limited range, and this is a good enough first estimate.
pub(crate) fn quant_resolution(level: usize, component: usize, band: usize) -> f32 {
    noise_power_normalized_quant_resolution(level, component, band).min(4096.0)
}

/// How much a unit of distortion in this band costs, weighted by the
/// contrast sensitivity function at the band's spatial frequency.
pub(crate) fn rdo_distortion_scale(
    level: usize,
    component: usize,
    band: usize,
    chroma: Chroma,
) -> f32 {
    // Upstream's model: normal PC monitors, viewed between couch and desk.
    let horiz_midpoint = if band & 1 != 0 { 0.75f32 } else { 0.25 };
    let vert_midpoint = if band & 2 != 0 { 0.75f32 } else { 0.25 };
    const DPI: f32 = 96.0;
    const VIEWING_DISTANCE: f32 = 1.0;
    const CPD_NYQUIST: f32 = 0.34 * VIEWING_DISTANCE * DPI;

    let mut cpd = (horiz_midpoint * horiz_midpoint + vert_midpoint * vert_midpoint).sqrt()
        * CPD_NYQUIST
        * (-(level as f32)).exp2();
    // Never quantize the LL band hard.
    cpd = cpd.max(8.0);

    let mut csf = 2.6 * (0.0192 + 0.114 * cpd) * (-(0.114 * cpd).powf(1.1)).exp();

    // Chroma is heavily discounted, less so when not subsampled.
    if component != 0 && level != DECOMPOSITION_LEVELS - 1 && chroma == Chroma::Yuv420 {
        csf *= 0.6;
    }

    // Distortion in lower bands becomes more noise power after filtering;
    // scaling by the resolution evens that out. Distortion is power, so the
    // weight is squared.
    let weighted = csf * noise_power_normalized_quant_resolution(level, component, band);
    weighted * weighted
}

/// The block header's quant code for a decoder-side scale: a small float with
/// a 5-bit negated exponent and a 3-bit mantissa.
pub(crate) fn encode_quant(decoder_q_scale: f32) -> u8 {
    const MAX_SCALE_EXP: i32 = 4;
    let v = decoder_q_scale.to_bits();
    let e = ((v >> 23) & 0xff) as i32 - 127 - MAX_SCALE_EXP;
    let m = ((v >> 20) & 0x7) as i32;
    let e = -e;
    assert!(
        (0..=20).contains(&e),
        "quant scale {decoder_q_scale} outside the code's range"
    );
    ((e << 3) | m) as u8
}

/// The scale a quant code stands for; the shaders' `decode_quant`.
pub(crate) fn decode_quant(code: u8) -> f32 {
    const MAX_SCALE_EXP: i32 = 4;
    let e = MAX_SCALE_EXP - i32::from(code >> 3);
    let m = i32::from(code & 0x7);
    (1.0 / (8.0 * 1024.0 * 1024.0)) * ((8 + m) * (1 << (20 + e))) as f32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quant_codes_round_trip_the_scales_rate_control_uses() {
        for level in 0..DECOMPOSITION_LEVELS {
            for component in 0..3 {
                for band in 0..4 {
                    let res = quant_resolution(level, component, band);
                    let code = encode_quant(1.0 / res);
                    // Every starting resolution is a power of two, which the
                    // code holds exactly.
                    assert_eq!(1.0 / decode_quant(code), res);
                }
            }
        }
    }

    #[test]
    fn resolution_is_capped_for_fp16() {
        assert_eq!(quant_resolution(4, 0, 0), 4096.0);
        assert_eq!(quant_resolution(0, 0, 3), 256.0);
        assert_eq!(quant_resolution(1, 1, 1), 512.0);
    }

    #[test]
    fn subdivisions_are_powers_of_two() {
        assert_eq!(blocks_per_subdivision(1), 1);
        assert_eq!(blocks_per_subdivision(51), 4);
        assert_eq!(blocks_per_subdivision(4000), 256);
    }
}
