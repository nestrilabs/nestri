// The CDF 9/7 lifting constants and the shared tile the forward and inverse
// transforms work in.
//
// Ported from PyroWave's dwt_common.h (Copyright (c) 2025 Hans-Kristian
// Arntzen, MIT) at precision level 1, upstream's default: the lifting maths is
// FP32 and the shared tile is FP16. `FP16` says how the tile is stored: as
// native half2 where the device has shaderFloat16, packed into a uint through
// packHalf2x16 where it does not. The values held are the same either way.

#pragma once

#include "common.slang"

static const int APRON = 4;
static const int APRON_HALF = APRON / 2;
static const int BLOCK_SIZE = 32;
static const int BLOCK_SIZE_HALF = BLOCK_SIZE >> 1;

static const float ALPHA = -1.586134342059924;
static const float BETA = -0.052980118572961;
static const float GAMMA = 0.882911075530934;
static const float DELTA = 0.443506852043971;
static const float K = 1.230174104914001;
static const float inv_K = 1.0 / 1.230174104914001;

// Two image rows packed side by side in each element, so one lane lifts two
// lines at once.
#if FP16
groupshared half2 shared_block[(BLOCK_SIZE + 2 * APRON) / 2][(BLOCK_SIZE + 2 * APRON) + 1];
float2 load_shared(uint y, uint x) { return float2(shared_block[y][x]); }
void store_shared(uint y, uint x, float2 v) { shared_block[y][x] = half2(v); }
#else
groupshared uint shared_block[(BLOCK_SIZE + 2 * APRON) / 2][(BLOCK_SIZE + 2 * APRON) + 1];
float2 load_shared(uint y, uint x) { return unpackHalf2x16(shared_block[y][x]); }
void store_shared(uint y, uint x, float2 v) { shared_block[y][x] = packHalf2x16(v); }
#endif

bool2 band(bool2 a, bool2 b)
{
    return bool2(a.x && b.x, a.y && b.y);
}
