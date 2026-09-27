// The caller's RGB image to the three full-range YCbCr planes PyroWave codes.
//
// Not a port: upstream's C API does this in Granite's video scaler, which is
// not part of PyroWave. The colour maths follows pixelforge's
// color_convert.comp, so a stream looks the same whichever of the two
// encoded it, with one difference: output is always full range. Limited
// range is never produced.
//
// Each lane converts a 2×2 quad. For 4:2:0 the quad's four chroma samples
// are averaged into one, which sites chroma at the centre of the quad; the
// sequence header says so.

import glsl;

[[vk::binding(0, 0)]] Texture2D<float4> uInput;
[[vk::binding(1, 0)]] [[vk::image_format("unknown")]] WTexture2D<float4> uY;
[[vk::binding(2, 0)]] [[vk::image_format("unknown")]] WTexture2D<float4> uCb;
[[vk::binding(3, 0)]] [[vk::image_format("unknown")]] WTexture2D<float4> uCr;

[[vk::constant_id(0)]] const bool Chroma420 = true;

// What the input already is. The discriminants match nespyro's `Source`.
static const uint SOURCE_SRGB = 0;
static const uint SOURCE_BT709_LINEAR = 1;
static const uint SOURCE_BT2020_LINEAR = 2;
static const uint SOURCE_BT2020_PQ = 3;

struct Registers
{
    uint width;
    uint height;
    uint source;
    // Zero for SDR BT.709, one for HDR10: BT.2020 NCL with PQ.
    uint hdr;
    // Luminance of source value 1.0, in nits. Unused when the source is PQ.
    float reference_white_nits;
};
[[vk::push_constant]] ConstantBuffer<Registers> registers;

static const float PQ_M1 = 0.1593017578125;
static const float PQ_M2 = 78.84375;
static const float PQ_C1 = 0.8359375;
static const float PQ_C2 = 18.8515625;
static const float PQ_C3 = 18.6875;

// Linear light, 1.0 = 10 000 nits, to a PQ signal.
float3 linear_to_pq(float3 l)
{
    l = max(l, float3(0.0));
    float3 lm1 = pow(l, float3(PQ_M1));
    return pow((PQ_C1 + PQ_C2 * lm1) / (1.0 + PQ_C3 * lm1), float3(PQ_M2));
}

float3 srgb_to_linear(float3 srgb)
{
    // Clamped first: FP16 sources can carry values pow() turns into NaN.
    srgb = clamp(srgb, 0.0, 1.0);
    return select(srgb <= float3(0.04045), srgb / 12.92, pow((srgb + 0.055) / 1.055, float3(2.4)));
}

// BT.709 to BT.2020 primaries, in linear light.
float3 bt709_to_bt2020(float3 c)
{
    return float3(
        0.6274 * c.r + 0.3293 * c.g + 0.0433 * c.b,
        0.0691 * c.r + 0.9195 * c.g + 0.0114 * c.b,
        0.0164 * c.r + 0.0880 * c.g + 0.8956 * c.b);
}

// The signal to put through the matrix.
float3 read_rgb(int2 coord)
{
    float3 rgb = uInput.Load(int3(coord, 0)).rgb;

    if (registers.hdr != 0)
    {
        if (registers.source == SOURCE_BT2020_PQ)
            return rgb;

        float3 l = rgb;
        if (registers.source == SOURCE_SRGB)
            l = srgb_to_linear(l);
        if (registers.source != SOURCE_BT2020_LINEAR)
            l = bt709_to_bt2020(l);
        return linear_to_pq(l * (registers.reference_white_nits / 10000.0));
    }

    // An SDR target only ever sees an sRGB source; the host refuses the rest.
    return rgb;
}

// Full range: Y in [0, 1], Cb and Cr in [0, 1] centred on 0.5.
float3 matrix(float3 rgb)
{
    float3 y_row, cb_row, cr_row;
    if (registers.hdr != 0)
    {
        // BT.2020 NCL.
        y_row = float3(0.2627, 0.6780, 0.0593);
        cb_row = float3(-0.1396, -0.3604, 0.5000);
        cr_row = float3(0.5000, -0.4598, -0.0402);
    }
    else
    {
        // BT.709.
        y_row = float3(0.2126, 0.7152, 0.0722);
        cb_row = float3(-0.1146, -0.3854, 0.5000);
        cr_row = float3(0.5000, -0.4542, -0.0458);
    }
    float3 ycbcr = float3(dot(y_row, rgb), 0.5 + dot(cb_row, rgb), 0.5 + dot(cr_row, rgb));
    return clamp(ycbcr, 0.0, 1.0);
}

[shader("compute")]
[numthreads(8, 8, 1)]
void rgb_to_ycbcr()
{
    int2 quad = int2(gl_GlobalInvocationID.xy);
    int2 base = 2 * quad;
    if (base.x >= int(registers.width) || base.y >= int(registers.height))
        return;

    int2 last = int2(int(registers.width) - 1, int(registers.height) - 1);
    float2 chroma_sum = float2(0.0);

    for (int dy = 0; dy < 2; dy++)
    {
        for (int dx = 0; dx < 2; dx++)
        {
            int2 p = base + int2(dx, dy);
            // A quad past an odd edge repeats the edge pixel, which only a
            // 4:4:4 stream can have.
            float3 ycbcr = matrix(read_rgb(min(p, last)));
            if (all(p <= last))
            {
                uY.Store(p, float4(ycbcr.x));
                if (!Chroma420)
                {
                    uCb.Store(p, float4(ycbcr.y));
                    uCr.Store(p, float4(ycbcr.z));
                }
            }
            chroma_sum += ycbcr.yz;
        }
    }

    if (Chroma420)
    {
        float2 c = chroma_sum * 0.25;
        uCb.Store(quad, float4(c.x));
        uCr.Store(quad, float4(c.y));
    }
}
