// Shared by every PyroWave pass.
//
// Ported from PyroWave's constants.h, dwt_swizzle.h and dwt_quant_scale.h
// (Copyright (c) 2025 Hans-Kristian Arntzen, MIT). Upstream's GLSL builtins
// come from Slang's glsl module, so the ports read line for line against the
// originals; only declarations and types change.

#pragma once

// Where a quantizer code word keeps its two extra fields above the 16 bits of
// per-subblock plane deltas.
static const int Q_PLANES_OFFSET = 16;
static const int Q_PLANES_BITS = 4;
static const int QUANT_SCALE_OFFSET = 20;
static const int QUANT_SCALE_BITS = 4;

// subgroupShuffleXor, declaring the capability it needs.
//
// Slang 2026.17's glsl module emits OpGroupNonUniformShuffleXor without
// declaring GroupNonUniformShuffle, so a shader whose only shuffle is an XOR
// one fails spirv-val. This emits the same instruction with the capability.
T shuffle_xor<T : __BuiltinArithmeticType>(T value, uint mask)
{
    return spirv_asm {
        OpCapability GroupNonUniformShuffle;
        result:$$T = OpGroupNonUniformShuffleXor Subgroup $value $mask
    };
}

// Coefficient order inside a 4×8 and an 8×8 block.
int2 unswizzle4x8(uint index)
{
    uint y = bitfieldExtract(index, 0, 1);
    uint x = bitfieldExtract(index, 1, 2);
    y |= bitfieldExtract(index, 3, 2) << 1;
    return int2(int(x), int(y));
}

int2 unswizzle8x8(uint index)
{
    uint y = bitfieldExtract(index, 0, 1);
    uint x = bitfieldExtract(index, 1, 2);
    y |= bitfieldExtract(index, 3, 2) << 1;
    x |= bitfieldExtract(index, 5, 1) << 2;
    return int2(int(x), int(y));
}

// The per-8×8 adaptive scale: a 4-bit code, 0.25 to about 2.2.
float decode_quant_scale(uint code)
{
    return float(code) / 8.0 + 0.25;
}

static const uint ENCODE_QUANT_IDENTITY = 6;

uint encode_quant_scale(float scale)
{
    // Round the scale up so that the quantizer scale effectively rounds down.
    return uint(ceil((scale - 0.25) * 8.0));
}

// The per-32×32 quant code: a small float with a 5-bit exponent and 3-bit
// mantissa, for numbers in (0, 16).
static const int MaxScaleExp = 4;

float decode_quant(uint quant_code)
{
    int e = MaxScaleExp - int(quant_code >> 3);
    int m = int(quant_code) & 0x7;
    float inv_quant = (1.0 / (8.0 * 1024.0 * 1024.0)) * float((8 + m) * (1 << (20 + e)));
    return inv_quant;
}

// Shared layouts. Every one matches a `#[repr(C)]` type on the Rust side.

struct BlockMeta
{
    uint code_word;
    uint offset;
};

struct QuantStats
{
    half square_error;
    uint16_t payload_cost;
};

// 64 bytes: the distortion and cost of dropping 0 to 15 bit planes.
struct BlockStats
{
    uint num_planes;
    QuantStats errors[15];
};

struct RDOperation
{
    int quant;
    uint block_offset_saving;
};

struct BitstreamPacket
{
    uint offset;
    uint num_words;
};

// Rate control sorts savings into this many buckets per subdivision of the
// block space.
static const int BLOCK_SPACE_SUBDIVISION = 16;
static const int NUM_RDO_BUCKETS = 128;
