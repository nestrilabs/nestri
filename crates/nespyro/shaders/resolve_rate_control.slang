// Rate control, second half: spend the cheapest buckets until the frame fits.
//
// Ported from PyroWave's resolve_rate_control.comp (Copyright (c) 2025
// Hans-Kristian Arntzen, MIT). One workgroup per bucket and block-space
// subdivision, in order of rising distortion per byte. A workgroup whose
// bucket the earlier ones already cover does nothing; the one where the
// running total crosses the target applies just enough of its operations.
// Applying an operation raises its block's quant, so a block ends at the
// hardest quant any bucket asked of it.
//
// The workgroup is exactly one subgroup. Upstream sets its size with a
// specialisation constant; here it is compiled once per size as WG_SIZE, and
// the pipeline requires that subgroup size.

import glsl;
#include "common.slang"

struct Registers
{
    uint *buckets;
    int *total_savings_per_bucket;
    RDOperation *rdo_operations;
    int *quant_data;
    // What changes per frame, written by the frame's own commands so the
    // rest can be recorded once: [1] is the target size in words.
    uint *frame_params;
    uint num_blocks_per_subdivision;
};
[[vk::push_constant]] ConstantBuffer<Registers> registers;

[shader("compute")]
[numthreads(WG_SIZE, 1, 1)]
void resolve_rate_control()
{
    int required_savings_per_bucket = int(registers.buckets[1]) - int(registers.frame_params[1]);
    if (gl_WorkGroupID.x != 0)
    {
        int prev_bucket_total = registers.total_savings_per_bucket[gl_WorkGroupID.x - 1];
        // This bucket is empty.
        if (registers.total_savings_per_bucket[gl_WorkGroupID.x] == prev_bucket_total)
            return;

        required_savings_per_bucket -= prev_bucket_total;
    }
    else
    {
        // This bucket is empty.
        if (registers.total_savings_per_bucket[gl_WorkGroupID.x] == 0)
            return;
    }

    // Earlier buckets already do the job.
    if (required_savings_per_bucket <= 0)
        return;

    uint total_saved = 0;

    for (uint i = 0; i < registers.num_blocks_per_subdivision && total_saved < uint(required_savings_per_bucket);
         i += gl_SubgroupSize)
    {
        RDOperation op = { 0, 0 };
        if (i + gl_SubgroupInvocationID < registers.num_blocks_per_subdivision)
            op = registers.rdo_operations[gl_WorkGroupID.x * registers.num_blocks_per_subdivision + i + gl_SubgroupInvocationID];

        uint saving = bitfieldExtract(op.block_offset_saving, 16, 16);
        uint block_offset = bitfieldExtract(op.block_offset_saving, 0, 16);

        uint scan_saving = subgroupInclusiveAdd(saving);

        bool should_apply_quant = total_saved + scan_saving - saving < uint(required_savings_per_bucket);
        if (should_apply_quant && saving != 0)
        {
            int ignored;
            InterlockedMax(registers.quant_data[block_offset], op.quant, ignored);
        }

        total_saved += subgroupShuffle(scan_saving, gl_SubgroupSize - 1);
    }
}
