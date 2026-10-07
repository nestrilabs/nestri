// Turn one band's received blocks back into wavelet coefficients.
//
// Ported from PyroWave's wavelet_dequant.comp (Copyright (c) 2025
// Hans-Kristian Arntzen, MIT), storage mode 0: the payload is read straight
// from a buffer with 8- and 16-bit loads. Upstream's texel-buffer and linear
// image modes exist for mobile GPUs without 8-bit storage; this crate targets
// desktop GPUs and does not carry them.
//
// A workgroup of 128 lanes decodes one 32×32 block, 8 coefficients a lane. A
// block whose offset is ~0 never arrived and decodes as zeros.

import glsl;
#include "common.slang"

[[vk::binding(0, 0)]] [[vk::image_format("unknown")]] WTexture2DArray<float4> uDequantImg;

struct Registers
{
    uint *payload_offsets;
    // One payload buffer, addressed as words, halves and bytes.
    uint *payload_data_u32;
    uint16_t *payload_data_u16;
    uint8_t *payload_data_u8;
    int2 resolution;
    int output_layer;
    int block_offset_32x32;
    int block_stride_32x32;
};
[[vk::push_constant]] ConstantBuffer<Registers> registers;

float4 decode_payload(uint code_word, uint q_bits, uint offset, uint block_index, out float4 m1)
{
    bool empty_block = code_word == 0;
    if (empty_block)
    {
        m1 = float4(0.0);
        return float4(0.0);
    }

    int bit_offset = 2 * int(block_index);

    // Where this 4×2 subblock's planes start.
    uint lsbs = code_word & 0x5555u;
    uint msbs = code_word & 0xaaaau;
    uint msbs_shift = msbs >> 1;
    msbs |= msbs_shift;

    uint byte_offset =
        bitCount(bitfieldExtract(lsbs, 0, bit_offset)) +
        bitCount(bitfieldExtract(msbs, 0, bit_offset)) +
        q_bits * block_index + offset;

    // Load early to keep latency down.
    uint payload = uint(registers.payload_data_u8[byte_offset]);

    uint local_control_word = bitfieldExtract(code_word, bit_offset, 2);
    int decoded_abs[8] = { 0, 0, 0, 0, 0, 0, 0, 0 };
    int plane_iterations = int(q_bits + local_control_word);

    for (int q = plane_iterations - 1; q >= 0; q--)
    {
        for (int b = 0; b < 8; b++)
        {
            int decoded = int(bitfieldExtract(payload, b, 1));
            decoded_abs[b] = bitfieldInsert(decoded_abs[b], decoded, q, 1);
        }
        byte_offset++;
        payload = uint(registers.payload_data_u8[byte_offset]);
    }

    // Columns 0 and 1 of upstream's mat2x4: coefficient i*2+j goes to column
    // j, row i.
    float4 m[2];
    for (int i = 0; i < 4; i++)
    {
        for (int j = 0; j < 2; j++)
        {
            float v = float(decoded_abs[i * 2 + j]);
            if (v != 0.0)
                v += 0.5;
            m[j][i] = v;
        }
    }

    m1 = m[1];
    return m[0];
}

groupshared uint shared_sign_offset;
groupshared uint shared_plane_byte_offsets[16];
groupshared uint shared_sign_scan[128 / 4];

uint scan_subgroups(uint v)
{
    for (uint i = 1; i < gl_NumSubgroups; i *= 2)
    {
        uint up = subgroupShuffleUp(v, i);
        v += gl_SubgroupInvocationID >= i ? up : 0;
    }
    return v;
}

void scan_subgroups_fallback(uint local_index)
{
    barrier();

    // Slow shared-memory fallback for subgroups narrower than 16.
    bool active_lane = local_index < gl_NumSubgroups;

    uint v = 0;
    if (active_lane)
        v = shared_sign_scan[local_index];

    for (uint i = 1; i < gl_NumSubgroups; i *= 2)
    {
        uint up = 0;
        bool do_work = local_index >= i && active_lane;
        if (do_work)
            up = shared_sign_scan[local_index - i];

        // Resolve the write-after-read hazard.
        barrier();

        if (do_work)
        {
            v += up;
            shared_sign_scan[local_index] = v;
        }

        barrier();
    }
}

[shader("compute")]
[numthreads(128, 1, 1)]
void wavelet_dequant()
{
    uint local_index = gl_SubgroupID * gl_SubgroupSize + gl_SubgroupInvocationID;

    int block_index_32x32 = int(uint(registers.block_offset_32x32) +
        gl_WorkGroupID.y * uint(registers.block_stride_32x32) +
        gl_WorkGroupID.x);

    uint block_local_index = bitfieldExtract(local_index, 0, 3);
    uint block_x = bitfieldExtract(local_index, 3, 2);
    uint block_y = bitfieldExtract(local_index, 5, 2);
    uint linear_block = block_y * 4 + block_x;

    // Each lane decodes 8 values.
    int2 local_coord = unswizzle8x8(block_local_index << 3);

    int2 coord = int2(gl_WorkGroupID.xy) * 32;
    coord += 8 * int2(int(block_x), int(block_y));
    coord += local_coord;

    uint offset_u32 = registers.payload_offsets[block_index_32x32];

    if (offset_u32 == ~0u)
    {
        for (int j = 0; j < 2; j++)
            for (int i = 0; i < 4; i++)
                uDequantImg.Store(int3(coord + int2(i, j), registers.output_layer), float4(0.0));
        return;
    }

    uint ballot = registers.payload_data_u32[offset_u32] & 0xffff;
    uint q_code = registers.payload_data_u32[offset_u32 + 1] & 0xff;

    if (local_index < 16)
    {
        uint control_word = 0;
        uint q_bits = 0;

        if (bitfieldExtract(ballot, int(local_index), 1) != 0)
        {
            uint local_code_offset = bitCount(bitfieldExtract(ballot, 0, int(local_index)));
            control_word = uint(registers.payload_data_u16[offset_u32 * 2 + 4 + local_code_offset]);
            q_bits = uint(registers.payload_data_u8[offset_u32 * 4 + 8 + bitCount(ballot) * 2 + local_code_offset]) & 0xfu;
        }

        uint lsbs = control_word & 0x5555u;
        uint msbs = control_word & 0xaaaau;
        uint msbs_shift = msbs >> 1;
        msbs |= msbs_shift;
        uint byte_cost = bitCount(lsbs) + bitCount(msbs) + q_bits * 8;

        uint byte_scan = offset_u32 * 4 + 8 + 3 * bitCount(ballot) + subgroupInclusiveAdd(byte_cost);
        if (local_index == 15)
            shared_sign_offset = 8 * byte_scan;
        shared_plane_byte_offsets[local_index] = byte_scan - byte_cost;
    }

    barrier();

    float4 v0, v1;
    int significant_count;

    if (bitfieldExtract(ballot, int(linear_block), 1) != 0)
    {
        uint local_code_offset = bitCount(bitfieldExtract(ballot, 0, int(linear_block)));

        uint control_word = uint(registers.payload_data_u16[offset_u32 * 2 + 4 + local_code_offset]);
        uint control_word2 = uint(registers.payload_data_u8[offset_u32 * 4 + 8 + bitCount(ballot) * 2 + local_code_offset]);

        v0 = decode_payload(control_word, control_word2 & 0xfu,
            shared_plane_byte_offsets[linear_block], block_local_index, v1);

        significant_count = 0;
        for (int i = 0; i < 4; i++)
            significant_count += int(v0[i] != 0.0) + int(v1[i] != 0.0);

        float q = decode_quant(q_code);
        float inv_scale = q * decode_quant_scale(bitfieldExtract(control_word2, QUANT_SCALE_OFFSET - 16, QUANT_SCALE_BITS));

        v0 *= inv_scale;
        v1 *= inv_scale;
    }
    else
    {
        v0 = float4(0.0);
        v1 = float4(0.0);
        significant_count = 0;
    }

    // How many significant coefficients come before this lane.
    int significant_scan = subgroupInclusiveAdd(significant_count);
    if (gl_SubgroupInvocationID == gl_SubgroupSize - 1)
        shared_sign_scan[gl_SubgroupID] = uint(significant_scan);

    if (gl_NumSubgroups <= 8)
    {
        barrier();
        if (gl_SubgroupSize <= 32)
        {
            // More robust: not every compiler understands the shuffle-up pattern.
            if (local_index < gl_NumSubgroups)
                shared_sign_scan[local_index] = subgroupInclusiveAdd(shared_sign_scan[local_index]);
        }
        else
        {
            if (local_index < gl_NumSubgroups)
                shared_sign_scan[local_index] = scan_subgroups(shared_sign_scan[local_index]);
        }
        barrier();
    }
    else
    {
        scan_subgroups_fallback(local_index);
    }

    // Where this lane's sign bits start.
    uint sign_offset = shared_sign_offset + uint(significant_scan - significant_count);
    if (gl_SubgroupID != 0)
        sign_offset += shared_sign_scan[gl_SubgroupID - 1];

    // Every sign bit this lane could need.
    uint sign_word = registers.payload_data_u32[sign_offset / 32 + 0];
    uint sign_word_upper = registers.payload_data_u32[sign_offset / 32 + 1];

    uint masked_sign_offset = sign_offset & 31u;
    if (masked_sign_offset != 0)
    {
        sign_word >>= masked_sign_offset;
        sign_word |= sign_word_upper << (32 - masked_sign_offset);
    }

    int sign_counter = 0;

    // Clock out the sign bits, in upstream's order: row i, then column j.
    for (int i = 0; i < 4; i++)
    {
        if (v0[i] != 0.0)
        {
            v0[i] *= 1.0 - 2.0 * float(bitfieldExtract(sign_word, sign_counter, 1));
            sign_counter++;
        }
        if (v1[i] != 0.0)
        {
            v1[i] *= 1.0 - 2.0 * float(bitfieldExtract(sign_word, sign_counter, 1));
            sign_counter++;
        }
    }

    for (int i = 0; i < 4; i++)
    {
        uDequantImg.Store(int3(coord + int2(i, 0), registers.output_layer), float4(v0[i]));
        uDequantImg.Store(int3(coord + int2(i, 1), registers.output_layer), float4(v1[i]));
    }
}
