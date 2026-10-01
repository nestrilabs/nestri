// Write the final bitstream: apply rate control's quant to every block and
// pack it into its finished form.
//
// Ported from PyroWave's block_packing.comp (Copyright (c) 2025 Hans-Kristian
// Arntzen, MIT). A workgroup of 64 lanes handles 2×2 blocks of 32×32, 16
// lanes per block, one lane per 8×8 block. Each block reserves its space with
// an atomic, so blocks land in the output in whatever order the GPU runs
// them, and a table records where each went; the host packetizes in block
// order from that table.
//
// Two additions. First, bytes the format ignores are written as zero rather
// than left as they were: the unused bits of a block's last sign byte, which
// upstream takes from uninitialised shared memory, and the padding to a word
// boundary, which upstream leaves holding whatever an earlier frame put
// there. Decoders ignore both, so the stream is the same format; it is also
// deterministic, and carries no stale memory onto the network.
//
// Second, the output has a capacity. Upstream relies on rate control
// never overshooting its buffer. Here the buffer is reached through a raw
// device address with no bounds checking, so a block that would not fit is
// recorded as empty instead of being written, and the host sees the overflow
// from the counter, which still counts every word asked for.

import glsl;
#include "common.slang"

struct Registers
{
    // One output buffer, addressed as words, halves and bytes.
    uint *bitstream_data;
    uint16_t *bitstream_data_16b;
    uint8_t *bitstream_data_8b;
    BitstreamPacket *bitstream_meta;
    BlockMeta *block_meta;
    // Two counters: the quantizer's scratch allocation, then this pass's.
    uint *payload_counter;
    uint8_t *payload_data;
    BlockStats *block_stats;
    int *quant_data;
    // What changes per frame, written by the frame's own commands so the
    // rest can be recorded once: [0] is the 3-bit sequence number.
    uint *frame_params;
    int2 resolution;
    int2 resolution_32x32_blocks;
    int2 resolution_8x8_blocks;
    uint quant_resolution_code;
    int block_offset_32x32;
    int block_stride_32x32;
    int block_offset_8x8;
    int block_stride_8x8;
    uint bitstream_capacity_words;
};
[[vk::push_constant]] ConstantBuffer<Registers> registers;

uint compute_required_8x8_size(uint control_word)
{
    int q_bits = int(bitfieldExtract(control_word, Q_PLANES_OFFSET, Q_PLANES_BITS));
    uint lsbs = control_word & 0x5555u;
    uint msbs = control_word & 0xaaaau;
    uint msbs_shift = msbs >> 1;
    msbs |= msbs_shift;
    return bitCount(lsbs) + bitCount(msbs) + uint(q_bits) * 8;
}

uint quantize_code_word(uint control_word, int quant)
{
    if (quant != 0 && control_word != 0)
    {
        int q_bits = int(bitfieldExtract(control_word, Q_PLANES_OFFSET, Q_PLANES_BITS));
        int sub_quant = min(q_bits, quant);
        q_bits -= sub_quant;
        quant -= sub_quant;

        if (quant != 0)
        {
            quant = min(quant, 3);

            uint plane0 = control_word & 0x5555u;
            uint plane1 = (control_word & 0xaaaau) >> 1;
            uint plane2 = plane0 & plane1;

            do
            {
                plane0 = plane1;
                plane1 = plane2;
                plane2 = 0;
                quant--;
            } while (quant != 0);

            plane0 &= ~plane1;

            uint new_control_word = plane0 | (plane1 << 1);
            control_word = bitfieldInsert(control_word, new_control_word, 0, 16);
        }

        control_word = bitfieldInsert(control_word, uint(q_bits), Q_PLANES_OFFSET, Q_PLANES_BITS);
    }

    return control_word;
}

uint copy_bytes(inout uint output_offset, uint input_offset, uint count)
{
    uint significant_mask = 0;

    do
    {
        uint in_data = uint(registers.payload_data[input_offset]);
        // Any 1 in the non-sign planes means it was not deadzone quantized.
        significant_mask |= in_data;
        registers.bitstream_data_8b[output_offset++] = uint8_t(in_data);
        count--;
        input_offset++;
    } while (count > 0);

    return significant_mask;
}

uint modify_quant_code(uint code, int quant)
{
    int e = int(bitfieldExtract(code, 3, 5));
    e = max(e - quant, 0);
    code = bitfieldInsert(code, uint(e), 3, 5);
    return code;
}

uint inclusive_add_clustered16(uint v)
{
    for (uint i = 1; i < 16; i *= 2)
    {
        uint up = subgroupShuffleUp(v, i);
        v += (gl_SubgroupInvocationID & 15) >= i ? up : 0;
    }
    return v;
}

groupshared uint shared_sign_bank[4][1024 / 32];
static uint pending_sign_write = 0;
static uint pending_sign_mask = 0;

void append_sign_plane(uint bank, inout uint local_sign_offset, uint sign_mask, uint significant_mask)
{
    // One bit at a time.
    while (significant_mask != 0)
    {
        int bit = findLSB(significant_mask);
        significant_mask &= significant_mask - 1;
        int out_bit = int(local_sign_offset & 31u);
        pending_sign_write = bitfieldInsert(pending_sign_write, bitfieldExtract(sign_mask, bit, 1), out_bit, 1);
        pending_sign_mask = bitfieldInsert(pending_sign_mask, 1u, out_bit, 1);

        if (out_bit == 31)
        {
            if (pending_sign_mask == ~0u)
            {
                shared_sign_bank[bank][local_sign_offset / 32] = pending_sign_write;
            }
            else
            {
                atomicAnd(shared_sign_bank[bank][local_sign_offset / 32], ~pending_sign_mask);
                atomicOr(shared_sign_bank[bank][local_sign_offset / 32], pending_sign_write & pending_sign_mask);
            }

            pending_sign_mask = 0;
        }

        local_sign_offset++;
    }
}

void flush_sign_plane(uint bank, uint local_sign_offset)
{
    if (pending_sign_mask != 0)
    {
        atomicAnd(shared_sign_bank[bank][local_sign_offset / 32], ~pending_sign_mask);
        atomicOr(shared_sign_bank[bank][local_sign_offset / 32], pending_sign_write & pending_sign_mask);
        pending_sign_mask = 0;
    }
}

BitstreamPacket bitstream_packet(uint offset, uint num_words)
{
    BitstreamPacket p;
    p.offset = offset;
    p.num_words = num_words;
    return p;
}

[shader("compute")]
[numthreads(64, 1, 1)]
void block_packing()
{
    uint index = gl_SubgroupInvocationID + gl_SubgroupSize * gl_SubgroupID;
    uint linear_block_32x32_index = index >> 4;
    int2 block32x32_index = 2 * int2(gl_WorkGroupID.xy);
    block32x32_index.x += int(bitfieldExtract(index, 4, 1));
    block32x32_index.y += int(bitfieldExtract(index, 5, 1));
    int2 local_block_index = int2(int(bitfieldExtract(index, 0, 2)), int(bitfieldExtract(index, 2, 2)));
    int2 block8x8_index = 4 * block32x32_index + local_block_index;

    // Each 32×32 block's 16 lanes share one bank and sit in one subgroup, so a
    // subgroup barrier orders this before the bank is used.
    shared_sign_bank[linear_block_32x32_index][2 * (index & 15u) + 0] = 0;
    shared_sign_bank[linear_block_32x32_index][2 * (index & 15u) + 1] = 0;
    subgroupBarrier();

    BlockMeta meta;
    int quant;

    bool in_range_8x8 = all(block8x8_index < registers.resolution_8x8_blocks);
    bool in_range_32x32 = all(block32x32_index < registers.resolution_32x32_blocks);
    uint num_bits_for_q = 0;

    if (in_range_32x32)
    {
        int block_index = registers.block_offset_32x32 +
            registers.block_stride_32x32 * block32x32_index.y +
            block32x32_index.x;
        quant = registers.quant_data[block_index];
    }
    else
    {
        quant = 0;
    }

    if (in_range_8x8)
    {
        int block_index = registers.block_offset_8x8 +
            registers.block_stride_8x8 * block8x8_index.y +
            block8x8_index.x;
        meta = registers.block_meta[block_index];
        uint num_planes = registers.block_stats[block_index].num_planes;
        num_bits_for_q = uint(registers.block_stats[block_index].errors[min(num_planes, uint(quant))].payload_cost);
    }
    else
    {
        meta.code_word = 0;
        meta.offset = 0;
    }

    uint code_word = quantize_code_word(meta.code_word, quant);
    bool active_code_word = (code_word & 0xffffu) != 0;

    uint4 code_word_ballot = subgroupBallot(active_code_word);
    uint local_ballot = gl_SubgroupSize >= 64 && linear_block_32x32_index >= 2 ? code_word_ballot.y : code_word_ballot.x;
    local_ballot = gl_SubgroupSize >= 32 ? bitfieldExtract(local_ballot, int(16u * (linear_block_32x32_index & 1u)), 16) : local_ballot;

    uint required_plane_bytes = compute_required_8x8_size(code_word);
    uint required_sign_bits = num_bits_for_q - required_plane_bytes * 8;

    uint required_bits_with_meta = num_bits_for_q;
    if (required_bits_with_meta != 0)
        required_bits_with_meta += 24;

    static const uint HeaderSize = 2;
    bool writes_header =
        all(block32x32_index < registers.resolution_32x32_blocks) && (index & 15u) == 15u;

    uint payload_total_bits = subgroupClusteredAdd(required_bits_with_meta, 16u);
    uint payload_total_words = (payload_total_bits + 31) / 32;
    if (payload_total_words != 0)
        payload_total_words += HeaderSize;

    uint global_payload_offset = 0;
    if (writes_header && payload_total_words != 0)
        InterlockedAdd(registers.payload_counter[1], payload_total_words, global_payload_offset);
    global_payload_offset = subgroupShuffle(global_payload_offset, gl_SubgroupInvocationID | 15u);

    // Every lane of the block agrees on this: both terms are the same across
    // its 16 lanes.
    bool fits = global_payload_offset + payload_total_words <= registers.bitstream_capacity_words;

    if (writes_header)
    {
        uint block_index = uint(registers.block_offset_32x32 +
            block32x32_index.y * registers.block_stride_32x32 + block32x32_index.x);

        if (payload_total_words != 0 && fits)
        {
            registers.bitstream_data[global_payload_offset + 0] =
                local_ballot | (payload_total_words << 16) | (registers.frame_params[0] << 28);
            registers.bitstream_data[global_payload_offset + 1] =
                modify_quant_code(registers.quant_resolution_code, quant) | (block_index << 8);
        }

        registers.bitstream_meta[block_index] =
            bitstream_packet(global_payload_offset, fits ? payload_total_words : 0);
    }

    uint total_subblocks = bitCount(local_ballot);

    uint total_sign_bits = inclusive_add_clustered16(required_sign_bits);
    uint local_planes_offset = inclusive_add_clustered16(required_plane_bytes) - required_plane_bytes;
    uint local_sign_offset = total_sign_bits - required_sign_bits;
    uint global_planes_offset = 4 * global_payload_offset + 3 * total_subblocks + 4 * HeaderSize;
    uint global_sign_offset = global_planes_offset + subgroupClusteredAdd(required_plane_bytes, 16u);
    global_planes_offset += local_planes_offset;

    uint total_sign_bytes = (subgroupShuffle(total_sign_bits, gl_SubgroupInvocationID | 15u) + 7) / 8;

    // Then N code words, one per active 8×8 block in ballot order.
    if (active_code_word && fits)
    {
        uint block_header_offset = bitCount(bitfieldExtract(
            local_ballot, 0, local_block_index.y * 4 + local_block_index.x));

        uint in_q_bits = bitfieldExtract(meta.code_word, Q_PLANES_OFFSET, Q_PLANES_BITS);
        uint out_q_bits = bitfieldExtract(code_word, Q_PLANES_OFFSET, Q_PLANES_BITS);
        uint input_offset = meta.offset;
        uint output_offset = global_planes_offset;

        for (int bit_offset = 0; bit_offset < 16; bit_offset += 2)
        {
            uint out_planes = bitfieldExtract(code_word, bit_offset, 2) + out_q_bits;
            uint in_planes = bitfieldExtract(meta.code_word, bit_offset, 2) + in_q_bits;
            if (in_planes != 0)
                in_planes++;

            uint sign_plane = uint(registers.payload_data[input_offset]);

            if (out_planes != 0)
            {
                uint significant_mask = copy_bytes(output_offset, input_offset + 1, out_planes);
                append_sign_plane(linear_block_32x32_index, local_sign_offset, sign_plane, significant_mask);
            }

            input_offset += in_planes;
        }

        flush_sign_plane(linear_block_32x32_index, local_sign_offset);

        registers.bitstream_data_16b[2 * global_payload_offset + block_header_offset + 2 * HeaderSize] =
            uint16_t(code_word);
        registers.bitstream_data_8b[4 * global_payload_offset + 2 * total_subblocks + block_header_offset + 4 * HeaderSize] =
            uint8_t(code_word >> 16);
    }

    subgroupBarrier();

    if (!fits)
        return;

    // Copy out every sign plane of the block.
    for (uint i = index & 15u; i < total_sign_bytes / 4; i += 16)
    {
        uint sign_word = shared_sign_bank[linear_block_32x32_index][i];
        uint offset_8b = global_sign_offset + 4 * i;
        registers.bitstream_data_8b[offset_8b + 0] = uint8_t(sign_word >> 0);
        registers.bitstream_data_8b[offset_8b + 1] = uint8_t(sign_word >> 8);
        registers.bitstream_data_8b[offset_8b + 2] = uint8_t(sign_word >> 16);
        registers.bitstream_data_8b[offset_8b + 3] = uint8_t(sign_word >> 24);
    }

    // And any stragglers.
    for (uint i = (total_sign_bytes & ~3u) + (index & 15u); i < total_sign_bytes; i += 16)
    {
        uint sign_word = shared_sign_bank[linear_block_32x32_index][i / 4];
        uint offset_8b = global_sign_offset + i;
        registers.bitstream_data_8b[offset_8b] = uint8_t(sign_word >> (8 * (i & 3u)));
    }

    // Zero the padding up to the block's last word.
    uint block_end = 4 * (global_payload_offset + payload_total_words);
    if (payload_total_words != 0 && (index & 15u) == 0u)
        for (uint b = global_sign_offset + total_sign_bytes; b < block_end; b++)
            registers.bitstream_data_8b[b] = uint8_t(0);
}
