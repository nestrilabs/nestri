// Inverse CDF 9/7 wavelet transform: four bands of one level back into a
// 32×32 tile of the level above.
//
// Ported from PyroWave's idwt.comp (Copyright (c) 2025 Hans-Kristian Arntzen,
// MIT), the compute path. Upstream also has a fragment-shader path for
// mobile GPUs; this crate targets desktop GPUs and does not carry it.
//
// Everything here is transposed: the input is sampled with x and y swapped,
// dispatched over the transposed resolution, and written back swapped, which
// lets the same lifting code serve both directions.

import glsl;
#include "dwt_common.slang"

[[vk::binding(0, 0)]] Sampler2DArray uTexture;
[[vk::binding(1, 0)]] [[vk::image_format("unknown")]] WTexture2D<float4> uOutput;

// The final transform of a plane moves it back from [-0.5, 0.5] to [0, 1].
[[vk::constant_id(0)]] const bool DCShift = false;

struct Registers
{
    int2 resolution;
    float2 inv_resolution;
};
[[vk::push_constant]] ConstantBuffer<Registers> registers;

static uint local_index;

float2 generate_mirror_uv(int2 coord, bool even_x, bool even_y)
{
    coord -= int2(band(bool2(even_x, even_y), coord < int2(0)));
    coord += 1;
    coord += int2(band(bool2(!even_x, !even_y), coord >= registers.resolution));
    float2 uv = float2(coord) * registers.inv_resolution;
    return uv.yx; // Transpose on load.
}

void write_shared_4x4(int2 coord, float4 texels0, float4 texels1, float4 texels2, float4 texels3)
{
    store_shared(coord.y + 0, 2 * coord.x + 0, float2(texels0.x, texels2.x));
    store_shared(coord.y + 0, 2 * coord.x + 1, float2(texels1.x, texels3.x));
    store_shared(coord.y + 0, 2 * coord.x + 2, float2(texels0.y, texels2.y));
    store_shared(coord.y + 0, 2 * coord.x + 3, float2(texels1.y, texels3.y));
    store_shared(coord.y + 1, 2 * coord.x + 0, float2(texels0.z, texels2.z));
    store_shared(coord.y + 1, 2 * coord.x + 1, float2(texels1.z, texels3.z));
    store_shared(coord.y + 1, 2 * coord.x + 2, float2(texels0.w, texels2.w));
    store_shared(coord.y + 1, 2 * coord.x + 3, float2(texels1.w, texels3.w));
}

// The four bands of the 2×2 quad at `coord`: LL, HL, LH and HH are layers 0,
// 1, 2 and 3, and the parity of each band decides which way its edge mirrors.
void load_quad(int2 coord)
{
    float4 texels0 = uTexture.Gather(float3(generate_mirror_uv(coord, true, true), 0.0)).wxzy;
    float4 texels1 = uTexture.Gather(float3(generate_mirror_uv(coord, false, true), 2.0)).wxzy;
    float4 texels2 = uTexture.Gather(float3(generate_mirror_uv(coord, true, false), 1.0)).wxzy;
    float4 texels3 = uTexture.Gather(float3(generate_mirror_uv(coord, false, false), 3.0)).wxzy;
    write_shared_4x4(coord - (int2(gl_WorkGroupID.xy) * int2(BLOCK_SIZE_HALF) - APRON_HALF),
                     texels0, texels1, texels2, texels3);
}

void load_image_with_apron()
{
    int2 base_coord = int2(gl_WorkGroupID.xy) * int2(BLOCK_SIZE_HALF) - APRON_HALF;
    int2 local_coord0 = 2 * unswizzle8x8(local_index);
    load_quad(base_coord + local_coord0);

    int2 local_coord_horiz = int2(BLOCK_SIZE_HALF + 2 * int(local_index % 2u), 2 * int(local_index / 2u));
    if (local_coord_horiz.y < BLOCK_SIZE_HALF + 2 * APRON_HALF)
        load_quad(base_coord + local_coord_horiz);

    int2 local_coord_vert = local_coord_horiz.yx;
    if (local_coord_vert.x < BLOCK_SIZE_HALF)
        load_quad(base_coord + local_coord_vert);

    barrier();
}

// The inverse lifting steps over one padded line, then a transposing write
// back, so the next pass lifts the other direction.
void lift_and_transpose<let SIZE : int>(bool active_lane, int2 local_coord)
{
    const int PADDED_SIZE = SIZE + 2 * APRON;
    const int PADDED_SIZE_HALF = PADDED_SIZE / 2;
    // Zeroed only so the compiler can see it is never read uninitialised;
    // inactive lanes write nothing back.
    float2 values[SIZE + 2 * APRON] = {};

    if (active_lane)
    {
        for (int i = 0; i < PADDED_SIZE; i += 2)
        {
            float2 v0 = load_shared(local_coord.y, local_coord.x + i + 0);
            float2 v1 = load_shared(local_coord.y, local_coord.x + i + 1);
            values[i + 0] = v0 * K;
            values[i + 1] = v1 * inv_K;
        }

        for (int i = 2; i < PADDED_SIZE - 1; i += 2)
            values[i] -= DELTA * (values[i - 1] + values[i + 1]);
        for (int i = 3; i < PADDED_SIZE - 2; i += 2)
            values[i] -= GAMMA * (values[i - 1] + values[i + 1]);
        for (int i = 4; i < PADDED_SIZE - 3; i += 2)
            values[i] -= BETA * (values[i - 1] + values[i + 1]);
        for (int i = 5; i < PADDED_SIZE - 4; i += 2)
            values[i] -= ALPHA * (values[i - 1] + values[i + 1]);
    }

    // Everyone has read before anyone writes.
    barrier();

    if (active_lane)
    {
        for (int i = APRON_HALF; i < PADDED_SIZE_HALF - APRON_HALF; i++)
        {
            float2 a = values[2 * i + 0];
            float2 b = values[2 * i + 1];

            // Transpose the 2×2 block.
            float2 t0 = float2(a.x, b.x);
            float2 t1 = float2(a.y, b.y);

            int y_coord = (local_coord.x >> 1) + (i - APRON_HALF);
            store_shared(y_coord, 2 * local_coord.y + 0, t0);
            store_shared(y_coord, 2 * local_coord.y + 1, t1);
        }
    }
}

void inverse_transform8x2()
{
    lift_and_transpose<8>(true, int2(8 * int(local_index % 4u), int(local_index / 4u)));
}

void inverse_transform4x2(bool active_lane, int y_offset)
{
    lift_and_transpose<4>(active_lane, int2(4 * int(local_index % 8u), int(local_index / 8u) + y_offset));
}

[shader("compute")]
[numthreads(64, 1, 1)]
void idwt()
{
    local_index = gl_LocalInvocationIndex;

    load_image_with_apron();

    // Horizontal transform.
    inverse_transform8x2();

    // The apron needs transforming too.
    inverse_transform4x2(local_index < 32, BLOCK_SIZE_HALF);

    barrier();

    // Vertical transform.
    inverse_transform8x2();

    barrier();

    int2 local_coord = unswizzle8x8(local_index);

    for (int y = local_coord.y; y < BLOCK_SIZE_HALF; y += 8)
    {
        for (int x = local_coord.x; x < BLOCK_SIZE; x += 8)
        {
            float2 v = load_shared(y, x);
            if (DCShift)
                v += 0.5;
            int2 base = BLOCK_SIZE * int2(gl_WorkGroupID.yx);
            uOutput.Store(int2(2 * y + 0, x) + base, v.xxxx);
            uOutput.Store(int2(2 * y + 1, x) + base, v.yyyy);
        }
    }
}
