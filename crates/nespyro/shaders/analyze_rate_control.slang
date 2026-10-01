// Rate control, first half: sort every block's possible quantization steps
// into buckets by how much distortion they add per byte they save.
//
// Ported from PyroWave's analyze_rate_control.comp and
// analyze_rate_control_finalize.comp (Copyright (c) 2025 Hans-Kristian
// Arntzen, MIT). One workgroup per 32×32 block sums its sixteen 8×8 blocks'
// statistics, turns each extra quantization step into a (saving, bucket)
// pair, and adds the saving to its bucket. The finalize pass prefix-sums the
// buckets, so resolve can find how many buckets it must spend.

import glsl;
#include "common.slang"

struct Registers
{
    // The bucket buffer: two counters, then the per-bucket savings from byte
    // 64, then the list of operations.
    uint *buckets;
    uint *total_savings_per_bucket;
    RDOperation *rdo_operations;
    BlockStats *block_stats;
    int2 resolution;
    int2 resolution_8x8_blocks;
    int block_offset_8x8;
    int block_stride_8x8;
    int block_offset_32x32;
    int block_stride_32x32;
    uint total_wg_count;
    uint num_blocks_aligned;
    uint block_index_shamt;
};
[[vk::push_constant]] ConstantBuffer<Registers> registers;

groupshared uint shared_rate_cost[16];
groupshared float shared_distortion[16];

// Operations that add less distortion per byte go first.
uint distortion_to_bucket_index(float d, float cost, float d_base, float cost_base)
{
    if (cost == cost_base)
        return 0;

    // A large range compressed into buckets of about 1.5 dB each: the greedy
    // pass chases the least weighted distortion added per byte removed.
    float index = 60.0 + 2.0 * log2(max(d - d_base, 0.0) / (cost_base - cost));
    return uint(max(index + 0.5, 0.0));
}

uint inclusive_max_clustered16(uint v)
{
    // Never above 127.
    v = min(v, 128 - 16 + gl_SubgroupInvocationID);

    for (uint i = 1; i < 16; i *= 2)
    {
        // Buckets progress monotonically, and each quant level sits at least
        // one bucket above the one before.
        uint up = subgroupShuffleUp(v, i) + i;
        v = max(v, gl_SubgroupInvocationID >= i ? up : 0);
    }

    return v;
}

RDOperation rd_operation(int quant, uint block_offset_saving)
{
    RDOperation op;
    op.quant = quant;
    op.block_offset_saving = block_offset_saving;
    return op;
}

void emit_rdo_operations()
{
    // Lanes past 16 exist on wider subgroups and only carry dummy values.
    // Upstream reads shared_rate_cost at their lane index, past the end of the
    // array; the value is never used, so the index is clamped instead.
    uint lane = min(gl_SubgroupInvocationID, 15u);
    float cost = float(shared_rate_cost[lane]);
    float distortion = gl_SubgroupInvocationID < 16 ? shared_distortion[lane] : 1e30;

    uint bucket_index = distortion_to_bucket_index(distortion, cost, shared_distortion[0], float(shared_rate_cost[0]));
    if (gl_SubgroupInvocationID == 0)
        bucket_index = 0;

    // Bucket index for Q1 is below Q2's if Q1 < Q2. When a high quant sees
    // very favourable rate-distortion, lower quants get lower buckets too.
    uint inclusive_bucket_index = inclusive_max_clustered16(bucket_index);

    if (gl_SubgroupInvocationID == 0)
    {
        uint unquantized_cost = shared_rate_cost[0];
        uint ignored;
        InterlockedAdd(registers.buckets[1], unquantized_cost, ignored);
    }
    else if (gl_SubgroupInvocationID < 16)
    {
        uint saving = shared_rate_cost[gl_SubgroupInvocationID - 1] - shared_rate_cost[gl_SubgroupInvocationID];

        if (saving != 0)
        {
            int2 block32x32_index = int2(gl_WorkGroupID.xy);
            int block_index = registers.block_offset_32x32 +
                block32x32_index.y * registers.block_stride_32x32 + block32x32_index.x;
            uint subdivision = uint(block_index) >> registers.block_index_shamt;
            uint ignored;
            InterlockedAdd(
                registers.total_savings_per_bucket[inclusive_bucket_index * BLOCK_SPACE_SUBDIVISION + subdivision],
                saving, ignored);
            registers.rdo_operations[uint(block_index) + inclusive_bucket_index * registers.num_blocks_aligned] =
                rd_operation(int(gl_SubgroupInvocationID), uint(block_index) | (saving << 16));
        }
    }
}

[shader("compute")]
[numthreads(64, 1, 1)]
void analyze_rate_control()
{
    // Each workgroup sums one 32×32 block's cost and distortion at every
    // possible quant step.
    uint index = gl_SubgroupInvocationID + gl_SubgroupSize * gl_SubgroupID;
    int2 block32x32_index = int2(gl_WorkGroupID.xy);
    int2 local_block_index = int2(int(bitfieldExtract(index, 0, 2)), int(bitfieldExtract(index, 2, 2)));
    int2 block8x8_index = 4 * block32x32_index + local_block_index;

    uint num_active_planes = 0;

    bool block8x8_in_range = all(block8x8_index < registers.resolution_8x8_blocks);
    int block_index_8x8 = registers.block_offset_8x8 +
        registers.block_stride_8x8 * block8x8_index.y +
        block8x8_index.x;

    if (block8x8_in_range)
        num_active_planes = registers.block_stats[block_index_8x8].num_planes;

    uint bit_index = index >> 4;

    for (uint i = bit_index; i < 16; i += 4)
    {
        float dist = 0.0;
        uint cost = 0;

        if (block8x8_in_range)
        {
            QuantStats stats = registers.block_stats[block_index_8x8].errors[min(i, num_active_planes)];
            dist = float(stats.square_error);
            cost = uint(stats.payload_cost);
        }

        // 16 bits of control codes and 8 of Q bits and quant scale. Cost is in
        // bits; 8×8 blocks decode in isolation.
        if (cost != 0)
            cost += 24;

        if (gl_SubgroupSize == 16)
        {
            cost = subgroupAdd(cost);
            dist = subgroupAdd(dist);
        }
        else
        {
            cost += shuffle_xor(cost, 1u);
            cost += shuffle_xor(cost, 2u);
            cost += shuffle_xor(cost, 4u);
            cost += shuffle_xor(cost, 8u);

            dist += shuffle_xor(dist, 1u);
            dist += shuffle_xor(dist, 2u);
            dist += shuffle_xor(dist, 4u);
            dist += shuffle_xor(dist, 8u);
        }

        if ((index & 15u) == 0u)
        {
            // A header must be coded, unless everything in the 32×32 block
            // decodes to zero and it can be dropped.
            if (cost != 0)
                cost += 64;

            // Each packet is aligned to 4 bytes.
            shared_rate_cost[i] = (cost + 31) >> 5;
            shared_distortion[i] = dist;
        }
    }

    barrier();

    if (gl_SubgroupID == 0)
        emit_rdo_operations();
}

groupshared uint shared_scan[512];

struct FinalizeRegisters
{
    uint4 *total_savings_per_bucket;
};
[[vk::push_constant]] ConstantBuffer<FinalizeRegisters> finalize_registers;

// Prefix sum over all 128 × 16 buckets, four per lane.
[shader("compute")]
[numthreads(512, 1, 1)]
void analyze_rate_control_finalize()
{
    uint4 v = finalize_registers.total_savings_per_bucket[gl_LocalInvocationIndex];
    v.y += v.x;
    v.z += v.y;
    v.w += v.z;
    shared_scan[gl_LocalInvocationIndex] = v.w;

    barrier();

    // As upstream: the steps stop short of 256, so the running totals of the
    // upper half of the lanes miss the lower half's first contributions and
    // come out low. That makes resolve spend more buckets than it needs, so
    // frames land under their target rather than over. Kept as is so the
    // output stays comparable with the reference; worth raising upstream.
    for (uint step = 1u; step < 512u / 2u; step *= 2u)
    {
        barrier();

        uint shuffled_up = 0;
        if (gl_LocalInvocationIndex >= step)
            shuffled_up = shared_scan[gl_LocalInvocationIndex - step];

        barrier();

        v += shuffled_up;
        shared_scan[gl_LocalInvocationIndex] = v.w;
    }

    finalize_registers.total_savings_per_bucket[gl_LocalInvocationIndex] = v;
}
