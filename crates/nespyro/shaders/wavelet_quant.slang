// Quantize one band's coefficients and record, for every 8×8 block, what each
// possible further quantization would cost and save.
//
// Ported from PyroWave's wavelet_quant.comp (Copyright (c) 2025 Hans-Kristian
// Arntzen, MIT). A workgroup of 128 lanes covers a 32×32 region; each lane
// holds 8 coefficients and 8 lanes form an 8×8 block, so an 8×8 block's
// reductions are clustered subgroup operations of width 8.
//
// Bit planes go to a scratch payload in their final order, but sign bits are
// kept per 4×2 subblock for now: which coefficients stay significant is not
// known until rate control has chosen how hard to quantize.
//
// One addition: the scratch payload has a capacity. Upstream sizes it by
// estimate and trusts content never to exceed it. Here it is reached through
// a raw device address with no bounds checking, so an 8×8 block whose
// allocation would not fit is recorded as all zero instead of being written;
// the counter still counts every byte asked for, which is how the host sees
// it happened.

import glsl;
#include "common.slang"

[[vk::binding(0, 0)]] Sampler2DArray uTexture;

[[vk::constant_id(1)]] const bool SkipQuantScale = false;

struct Registers
{
    BlockMeta *block_meta;
    BlockStats *block_stats;
    // Two counters, then the scratch payload bytes from offset 8.
    uint *payload_counter;
    uint8_t *payload_data;
    int2 resolution;
    int2 resolution_8x8_blocks;
    float2 inv_resolution;
    float input_layer;
    float quant_resolution;
    int block_offset;
    int block_stride;
    float rdo_distortion_scale;
    uint payload_capacity;
};
[[vk::push_constant]] ConstantBuffer<Registers> registers;

float max4(float4 v)
{
    float2 v2 = max(v.xy, v.zw);
    return max(v2.x, v2.y);
}

int scan_clustered8(int v)
{
    for (uint i = 1; i < 8; i *= 2)
    {
        int up = subgroupShuffleUp(v, i);
        v += (gl_SubgroupInvocationID & 7u) >= i ? up : 0;
    }
    return v;
}

void compute_quant_scale(float max_wave_texels, out uint quant_code, out float quant_scale)
{
    if (SkipQuantScale || max_wave_texels < 1.0)
    {
        quant_code = ENCODE_QUANT_IDENTITY;
        quant_scale = 1.0;
    }
    else
    {
        int e;
        frexp(max_wave_texels - 0.25, e);
        float target_max = float(1 << e) - 0.25;
        float inv_scale = max_wave_texels / target_max;
        quant_code = encode_quant_scale(inv_scale);
        quant_scale = 1.0 / decode_quant_scale(quant_code);
    }
}

float compute_square_error(float4 v[2], int q, out uint num_significant_values)
{
    v[0] = abs(v[0]);
    v[1] = abs(v[1]);
    float4 iv[2] = { floor(ldexp(v[0], int4(-q))), trunc(ldexp(v[1], int4(-q))) };
    num_significant_values = 0;
    for (int j = 0; j < 2; j++)
        for (int i = 0; i < 4; i++)
            if (iv[j][i] != 0.0)
                num_significant_values++;
    iv[0] += select(iv[0] != float4(0.0), float4(0.5), float4(0.0));
    iv[1] += select(iv[1] != float4(0.0), float4(0.5), float4(0.0));
    iv[0] = trunc(ldexp(iv[0], int4(q)));
    iv[1] = trunc(ldexp(iv[1], int4(q)));
    float4 err0 = v[0] - iv[0];
    float4 err1 = v[1] - iv[1];
    num_significant_values = subgroupClusteredAdd(num_significant_values, 8u);
    return (dot(err0, err0) + dot(err1, err1)) * registers.rdo_distortion_scale;
}

struct QuantResult
{
    float square_error;
    int encode_cost_early;
    int block4x2_shifted;
    int encode_cost_late_bits;
    int quality_planes;
};

QuantResult compute_quant_stats(float4 v[2], int q, int msb, int block4x2_max, float inv_quant_squared)
{
    block4x2_max >>= q;

    uint wave8_num_significants;
    QuantResult result;

    result.square_error = compute_square_error(v, q, wave8_num_significants) * inv_quant_squared;
    result.block4x2_shifted = block4x2_max;

    result.encode_cost_early = block4x2_max > 0 ? 1 : 0;
    msb -= q;

    result.quality_planes = 0;

    if (msb >= 3)
    {
        result.quality_planes = msb - 2;
        // The sign plane must be coded if there are quality planes.
        result.encode_cost_early = result.quality_planes + 1;
        result.block4x2_shifted >>= result.quality_planes;
    }

    result.encode_cost_early += findMSB(result.block4x2_shifted) + 1;
    result.encode_cost_late_bits =
        8 * subgroupClusteredAdd(max(result.encode_cost_early - 1, 0), 8u) + int(wave8_num_significants);
    return result;
}

QuantStats quant_stats(float square_error, uint cost)
{
    QuantStats s;
    s.square_error = half(square_error);
    s.payload_cost = uint16_t(cost);
    return s;
}

BlockMeta block_meta(uint code_word, uint offset)
{
    BlockMeta m;
    m.code_word = code_word;
    m.offset = offset;
    return m;
}

void encode_payload(int2 block_index_8x8, float4 texels[2])
{
    precise float max_subblock_texel = max(max4(abs(texels[0])), max4(abs(texels[1])));
    precise float max_wave_texels = subgroupClusteredMax(max_subblock_texel, 8u);
    float quant_scale;
    uint quant_code;
    compute_quant_scale(max_wave_texels, quant_code, quant_scale);
    texels[0] *= quant_scale;
    texels[1] *= quant_scale;
    max_wave_texels *= quant_scale;
    max_subblock_texel *= quant_scale;

    float overall_quant_scale = registers.quant_resolution * quant_scale;
    float inv_quant = 1.0 / overall_quant_scale;
    float inv_quant_squared = inv_quant * inv_quant;
    int4 abs_quant_texels0 = abs(int4(texels[0]));
    int4 abs_quant_texels1 = abs(int4(texels[1]));
    int max_absolute_value = int(max_wave_texels);
    int block4x2_max = int(max_subblock_texel);

    uint block_index = uint(registers.block_offset + block_index_8x8.y * registers.block_stride + block_index_8x8.x);

    // The entire block quantizes to zero.
    if (max_absolute_value == 0)
    {
        if ((gl_SubgroupInvocationID & 7) == 0)
        {
            registers.block_meta[block_index] = block_meta(0, 0);
            registers.block_stats[block_index].num_planes = 0;
            registers.block_stats[block_index].errors[0] = quant_stats(0.0, 0);
        }
        return;
    }

    int msb = findMSB(max_absolute_value);

    QuantResult result = compute_quant_stats(texels, 0, msb, block4x2_max, inv_quant_squared);
    int scan = scan_clustered8(result.encode_cost_early);

    uint global_offset = 0;

    // Allocate the block's payload, and report where it went.
    if ((gl_SubgroupInvocationID & 7u) == 7u)
        InterlockedAdd(registers.payload_counter[0], uint(scan), global_offset);
    global_offset = subgroupShuffle(global_offset, gl_SubgroupInvocationID | 7u);
    uint block_bytes = uint(subgroupShuffle(scan, gl_SubgroupInvocationID | 7u));

    // Past the scratch capacity: the block is dropped whole, as if it had
    // quantized to zero. All 8 lanes of the block agree.
    if (global_offset + block_bytes > registers.payload_capacity)
    {
        if ((gl_SubgroupInvocationID & 7) == 0)
        {
            registers.block_meta[block_index] = block_meta(0, 0);
            registers.block_stats[block_index].num_planes = 0;
            registers.block_stats[block_index].errors[0] = quant_stats(0.0, 0);
        }
        return;
    }

    scan -= result.encode_cost_early;

    // First, the code word.
    int quality_planes = result.quality_planes;
    uint code_word = uint(quality_planes) << Q_PLANES_OFFSET;
    code_word = bitfieldInsert(code_word, quant_code, QUANT_SCALE_OFFSET, QUANT_SCALE_BITS);
    uint plane_code = uint(findMSB(result.block4x2_shifted) + 1);

    uint merged_plane_code = plane_code << ((gl_SubgroupInvocationID & 7u) * 2u);
    merged_plane_code |= shuffle_xor(merged_plane_code, 1u);
    merged_plane_code |= shuffle_xor(merged_plane_code, 2u);
    merged_plane_code |= shuffle_xor(merged_plane_code, 4u);
    code_word |= merged_plane_code;

    if ((gl_SubgroupInvocationID & 7u) == 0u)
    {
        registers.block_meta[block_index] = block_meta(code_word, global_offset);
        registers.block_stats[block_index].num_planes = uint(msb + 1);
        // No distortion for quant 0: that decision has been made already.
        registers.block_stats[block_index].errors[0] = quant_stats(0.0, uint(result.encode_cost_late_bits));
    }

    for (int q = 1; q <= msb; q++)
    {
        QuantResult quant_result = compute_quant_stats(texels, q, msb, block4x2_max, inv_quant_squared);
        float square_error = subgroupClusteredAdd(quant_result.square_error, 8u);

        if ((gl_SubgroupInvocationID & 7u) == 0)
        {
            registers.block_stats[block_index].errors[q] =
                quant_stats(min(square_error, 60000.0), uint(quant_result.encode_cost_late_bits));
        }
    }

    // The distortion of throwing everything away.
    float square_error = subgroupClusteredAdd(
        (dot(texels[0], texels[0]) + dot(texels[1], texels[1])) * inv_quant_squared, 8u);
    if ((gl_SubgroupInvocationID & 7u) == 0)
        registers.block_stats[block_index].errors[msb + 1] = quant_stats(min(60000.0, square_error), 0);

    uint byte_offset = uint(scan) + global_offset;
    bool need_sign = result.block4x2_shifted != 0 || quality_planes != 0;

    // Signs are not packed until the final pass, when the quantization is known.
    if (need_sign)
    {
        uint4 s0 = uint4(texels[0] < float4(0.0)) << uint4(0, 1, 2, 3);
        uint4 s1 = uint4(texels[1] < float4(0.0)) << uint4(4, 5, 6, 7);
        uint s = s0.x | s0.y | s0.z | s0.w | s1.x | s1.y | s1.z | s1.w;
        registers.payload_data[byte_offset++] = uint8_t(s);

        int plane_iterations = quality_planes + int(plane_code);
        int q = plane_iterations - 1;
        do
        {
            s0 = uint4(
                bitfieldExtract(uint(abs_quant_texels0.x), q, 1),
                bitfieldExtract(uint(abs_quant_texels0.y), q, 1),
                bitfieldExtract(uint(abs_quant_texels0.z), q, 1),
                bitfieldExtract(uint(abs_quant_texels0.w), q, 1));
            s1 = uint4(
                bitfieldExtract(uint(abs_quant_texels1.x), q, 1),
                bitfieldExtract(uint(abs_quant_texels1.y), q, 1),
                bitfieldExtract(uint(abs_quant_texels1.z), q, 1),
                bitfieldExtract(uint(abs_quant_texels1.w), q, 1));
            s0 <<= uint4(0, 1, 2, 3);
            s1 <<= uint4(4, 5, 6, 7);
            s = s0.x | s0.y | s0.z | s0.w | s1.x | s1.y | s1.z | s1.w;
            registers.payload_data[byte_offset++] = uint8_t(s);
            q--;
        } while (q >= 0);
    }
}

[shader("compute")]
[numthreads(128, 1, 1)]
void wavelet_quant()
{
    uint local_index = gl_SubgroupID * gl_SubgroupSize + gl_SubgroupInvocationID;
    uint block_local_index = bitfieldExtract(local_index, 0, 3);
    uint block_x = bitfieldExtract(local_index, 3, 2);
    uint block_y = bitfieldExtract(local_index, 5, 2);

    // Each lane encodes 8 values.
    int2 local_coord = unswizzle8x8(block_local_index << 3);

    int2 coord = int2(gl_WorkGroupID.xy) * 32;
    coord += 8 * int2(int(block_x), int(block_y));
    coord += local_coord;

    int2 block_index = 4 * int2(gl_WorkGroupID.xy) + int2(int(block_x), int(block_y));

    float3 uv = float3(float2(coord) * registers.inv_resolution, registers.input_layer);
    float4 texels0 = uTexture.Gather(uv, int2(1, 1)).wxzy;
    float4 texels1 = uTexture.Gather(uv, int2(3, 1)).wxzy;
    precise float4 scaled_texels0 = texels0 * registers.quant_resolution;
    precise float4 scaled_texels1 = texels1 * registers.quant_resolution;
    bool in_bounds = all(block_index < registers.resolution_8x8_blocks);
    if (in_bounds)
    {
        float4 scaled[2] = { scaled_texels0, scaled_texels1 };
        encode_payload(block_index, scaled);
    }
}
