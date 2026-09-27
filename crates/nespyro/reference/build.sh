#!/usr/bin/env bash
# Builds the C++ reference harness the cross-check tests run against.
#
#   crates/nespyro/reference/build.sh <build dir>
#
# Clones PyroWave and Granite at the commits nespyro is frozen at into the
# build directory, builds PyroWave's C API, and links the harness against
# it. Prints the harness's path; point NESPYRO_REFERENCE at it.
#
# It builds with two jobs by default, so it can share a machine; set JOBS to
# change that.
set -euo pipefail

PYROWAVE_COMMIT=89f7e47d4abbf650c91fae766728af866c5e32a0
PYROWAVE_REPO=${PYROWAVE_REPO:-https://github.com/Themaister/pyrowave}
JOBS=${JOBS:-2}

here=$(cd "$(dirname "$0")" && pwd)
out=${1:?usage: build.sh <build dir>}
mkdir -p "$out"
out=$(cd "$out" && pwd)

if [ ! -d "$out/pyrowave/.git" ]; then
	git clone "$PYROWAVE_REPO" "$out/pyrowave"
fi
git -C "$out/pyrowave" fetch -q origin
git -C "$out/pyrowave" checkout -q "$PYROWAVE_COMMIT"
# The script pins Granite's commit itself.
(cd "$out/pyrowave" && ./checkout_granite.sh)

cmake -S "$out/pyrowave" -B "$out/build" -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build "$out/build" --target pyrowave-shared -j "$JOBS"

lib=$(find "$out/build" -maxdepth 2 -name 'libpyrowave-shared.so*' -type f | head -n1)
c++ -std=c++17 -O2 "$here/harness.cpp" -o "$out/harness" \
	-I "$out/pyrowave" \
	-I "$out/pyrowave/Granite/third_party/khronos/vulkan-headers/include" \
	-L "$(dirname "$lib")" -lpyrowave-shared -Wl,-rpath,"$(dirname "$lib")"

echo "$out/harness"
