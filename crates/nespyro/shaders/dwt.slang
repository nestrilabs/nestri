// Forward CDF 9/7 wavelet transform of one 32×32 tile into the four bands of
// the next level.
//
// Ported from PyroWave's dwt.comp (Copyright (c) 2025 Hans-Kristian Arntzen,
// MIT). One workgroup of 64 lanes reads its tile plus a 4-texel apron through
// a mirrored-repeat sampler, lifts rows, then columns, and writes a 16×16
// quarter to each band layer. Edges mirror through the sampler rather than
// through branches; `generate_mirror_uv` bends the coordinates so the
// padding past the real image mirrors the way the format expects.

import glsl;
#include "dwt_common.slang"

[[vk::binding(0, 0)]] Sampler2D uTexture;
[[vk::binding(1, 0)]] [[vk::image_format("unknown")]] WTexture2DArray<float4> uOutput;

// The first transform of a plane moves it from [0, 1] to [-0.5, 0.5].
[[vk::constant_id(0)]] const bool DCShift = false;

struct Registers
{
    int2 resolution;
    float2 inv_resolution;
    int2 aligned_resolution;
};
[[vk::push_constant]] ConstantBuffer<Registers> registers;

static uint local_index;

float2 generate_mirror_uv(int2 coord)
{
    coord -= int2(coord < int2(0));
    coord += 1;
    int2 end_mirrored_clamp = (2 * registers.aligned_resolution) - registers.resolution;
    int2 past_wrapped_coord = coord + 2 * (registers.resolution - registers.aligned_resolution) + 1;
    coord = select(coord >= end_mirrored_clamp, past_wrapped_coord, min(coord, registers.resolution));
    return float2(coord) * registers.inv_resolution;
}

float4 gather(int2 coord)
{
    float4 texels = uTexture.Gather(generate_mirror_uv(coord)).wzxy;
    if (DCShift)
        texels -= 0.5;
    return texels;
}

void load_image_with_apron()
{
    int2 base_coord = int2(gl_WorkGroupID.xy) * int2(BLOCK_SIZE, BLOCK_SIZE) - APRON;
    int2 local_coord0 = 2 * unswizzle8x8(local_index);
    int2 coord0 = base_coord + local_coord0;

    float4 texels0 = gather(coord0);
    float4 texels1 = gather(coord0 + int2(16, 0));
    float4 texels2 = gather(coord0 + int2(0, 16));
    float4 texels3 = gather(coord0 + int2(16, 16));

    int local_coord0_y_half = local_coord0.y >> 1;

    // Pack two lines together in one vec2, so packed maths processes two lines
    // in parallel.
    store_shared(local_coord0_y_half + 0, local_coord0.x + 0, texels0.xz);
    store_shared(local_coord0_y_half + 0, local_coord0.x + 1, texels0.yw);
    store_shared(local_coord0_y_half + 0, local_coord0.x + 16, texels1.xz);
    store_shared(local_coord0_y_half + 0, local_coord0.x + 17, texels1.yw);
    store_shared(local_coord0_y_half + 8, local_coord0.x + 0, texels2.xz);
    store_shared(local_coord0_y_half + 8, local_coord0.x + 1, texels2.yw);
    store_shared(local_coord0_y_half + 8, local_coord0.x + 16, texels3.xz);
    store_shared(local_coord0_y_half + 8, local_coord0.x + 17, texels3.yw);

    // The top-right apron.
    {
        int2 local_coord = int2(BLOCK_SIZE + 2 * int(local_index % 4u), 2 * int(local_index / 4u));
        float4 texels = gather(base_coord + local_coord);
        store_shared(local_coord.y >> 1, local_coord.x + 0, texels.xz);
        store_shared(local_coord.y >> 1, local_coord.x + 1, texels.yw);
    }

    // The bottom-left apron.
    {
        int2 local_coord = int2(2 * int(local_index % 16u), BLOCK_SIZE + 2 * int(local_index / 16u));
        float4 texels = gather(base_coord + local_coord);
        store_shared(local_coord.y >> 1, local_coord.x + 0, texels.xz);
        store_shared(local_coord.y >> 1, local_coord.x + 1, texels.yw);
    }

    if (local_index < 16)
    {
        // The bottom-right apron.
        int2 local_coord = int2(BLOCK_SIZE + 2 * int(local_index % 4u), BLOCK_SIZE + 2 * int(local_index / 4u));
        float4 texels = gather(base_coord + local_coord);
        store_shared(local_coord.y >> 1, local_coord.x + 0, texels.xz);
        store_shared(local_coord.y >> 1, local_coord.x + 1, texels.yw);
    }
}

// The four CDF 9/7 lifting steps over one padded line, then the rescale and a
// transposing write back, so the next pass lifts the other direction.
void lift_and_transpose<let SIZE : int>(bool active_lane, int2 local_coord)
{
    const int PADDED_SIZE = SIZE + 2 * APRON;
    const int PADDED_SIZE_HALF = PADDED_SIZE / 2;
    // Zeroed only so the compiler can see it is never read uninitialised;
    // inactive lanes write nothing back.
    float2 values[SIZE + 2 * APRON] = {};

    if (active_lane)
    {
        for (int i = 0; i < PADDED_SIZE; i++)
            values[i] = load_shared(local_coord.y, local_coord.x + i);

        for (int i = 1; i < PADDED_SIZE - 1; i += 2)
            values[i] += ALPHA * (values[i - 1] + values[i + 1]);
        for (int i = 2; i < PADDED_SIZE - 2; i += 2)
            values[i] += BETA * (values[i - 1] + values[i + 1]);
        for (int i = 3; i < PADDED_SIZE - 3; i += 2)
            values[i] += GAMMA * (values[i - 1] + values[i + 1]);
        for (int i = 4; i < PADDED_SIZE - 4; i += 2)
            values[i] += DELTA * (values[i - 1] + values[i + 1]);
    }

    // Everyone has read before anyone writes.
    barrier();

    if (active_lane)
    {
        for (int i = APRON_HALF; i < PADDED_SIZE_HALF - APRON_HALF; i++)
        {
            float2 a = values[2 * i + 0];
            float2 b = values[2 * i + 1];

            // Filter kernel rescale.
            a *= inv_K;
            b *= K;

            // Transpose the 2×2 block.
            float2 t0 = float2(a.x, b.x);
            float2 t1 = float2(a.y, b.y);

            int y_coord = (local_coord.x >> 1) + (i - APRON_HALF);
            store_shared(y_coord, 2 * local_coord.y + 0, t0);
            store_shared(y_coord, 2 * local_coord.y + 1, t1);
        }
    }
}

void forward_transform8x2()
{
    lift_and_transpose<8>(true, int2(8 * int(local_index % 4u), int(local_index / 4u)));
}

void forward_transform4x2(bool active_lane, int y_offset)
{
    lift_and_transpose<4>(active_lane, int2(4 * int(local_index % 8u), int(local_index / 8u) + y_offset));
}

[shader("compute")]
[numthreads(64, 1, 1)]
void dwt()
{
    local_index = gl_SubgroupID * gl_SubgroupSize + gl_SubgroupInvocationID;

    load_image_with_apron();

    barrier();

    // Horizontal transform.
    forward_transform8x2();

    // The apron needs transforming too.
    forward_transform4x2(local_index < 32, BLOCK_SIZE_HALF);

    barrier();

    // Vertical transform.
    forward_transform8x2();

    barrier();

    int2 local_coord = unswizzle8x8(local_index);
    for (int y = local_coord.y; y < BLOCK_SIZE_HALF; y += 8)
    {
        for (int x = local_coord.x * 2; x < BLOCK_SIZE; x += 16)
        {
            float2 v0 = load_shared(y, x + 0);
            float2 v1 = load_shared(y, x + 1);

            int img_x = x >> 1;
            int img_y = y;

            int2 base_image_coord = int2(gl_WorkGroupID.xy) * (BLOCK_SIZE / 2) + int2(img_x, img_y);
            uOutput.Store(int3(base_image_coord, 0), v0.xxxx);
            uOutput.Store(int3(base_image_coord, 2), v0.yyyy);
            uOutput.Store(int3(base_image_coord, 1), v1.xxxx);
            uOutput.Store(int3(base_image_coord, 3), v1.yyyy);
        }
    }
}
