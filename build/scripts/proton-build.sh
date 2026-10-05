#!/usr/bin/env bash
# Builds proton-cachyos from the tree proton-fetch.sh laid down. Container-only.
#
# The one thing that matters here is --enable-wow64: it builds wine so that
# 32-bit Windows code runs inside a 64-bit unix process, thunking down to the
# 64-bit host libraries. Without it, Proton needs a complete 32-bit host stack —
# lib32 glibc, a second Mesa built for i686, and a second nescapture layer,
# because a 32-bit game would load the 32-bit Vulkan loader and our 64-bit
# capture layer would be invisible to it. With it, none of that exists.
#
# The cost is that the distro package cannot be used: proton-cachyos-native is
# packaged without the flag, which is exactly why it depends on lib32-*.
set -euo pipefail

: "${GECKO_VER:?}"
: "${MONO_VER:?}"

JOBS="${JOBS:-$(nproc)}"
BUILD_NAME="proton-cachyos"
SRC_DIR="/build/proton-cachyos"
BUILD_DIR="/build/build"
OUT_DIR="/artifacts/proton/usr/share/steam/compatibilitytools.d/${BUILD_NAME}"

[[ -d "${SRC_DIR}" ]] || { echo "no source tree — proton-fetch.sh did not run"; exit 1; }

# ── Toolchain wrappers ──────────────────────────────────
# Proton's build calls the compiler by GNU triplet. Arch's gcc does not install
# under those names, so stand in for them. The i686 set is generated too: with
# wow64 nothing should reach for it, and if something does, failing on a missing
# 32-bit header beats silently building a 32-bit unix library we then have to
# ship libraries for.
WRAP=/build/wrappers
rm -rf "$WRAP" && mkdir -p "$WRAP"
_wrappers() {
    local arch="$1" gccflag="$2" ldflag="$3" asflag="$4" stripfmt="$5"
    local l t
    for l in ar ranlib nm; do
        ln -sf "/usr/bin/gcc-${l}" "${WRAP}/${arch}-pc-linux-gnu-${l}"
    done
    for t in gcc g++; do
        printf '#!/usr/bin/bash\n/usr/bin/%s %s "$@"\n' "$t" "$gccflag" \
            > "${WRAP}/${arch}-pc-linux-gnu-${t}"
        chmod 755 "${WRAP}/${arch}-pc-linux-gnu-${t}"
    done
    printf '#!/usr/bin/bash\n/usr/bin/ld %s "$@"\n' "$ldflag" > "${WRAP}/${arch}-pc-linux-gnu-ld"
    printf '#!/usr/bin/bash\n/usr/bin/as %s "$@"\n' "$asflag" > "${WRAP}/${arch}-pc-linux-gnu-as"
    printf '#!/usr/bin/bash\n/usr/bin/strip -F %s "$@"\n' "$stripfmt" > "${WRAP}/${arch}-pc-linux-gnu-strip"
    chmod 755 "${WRAP}/${arch}-pc-linux-gnu-"{ld,as,strip}
}
_wrappers x86_64 "-m64" "-melf_x86_64" "--64" "elf64-x86-64"
_wrappers i686   "-m32" "-melf_i386"   "--32" "elf32-i386"
export PATH="${WRAP}:${PATH}"

# ── Build ───────────────────────────────────────────────
# -march=nocona matches the distro packaging: Proton has to run on whatever CPU
# the guest is given, and the VMM does not promise a feature level.
export CFLAGS="-O3 -march=nocona -mtune=core-avx2"
export CXXFLAGS="${CFLAGS}"
export RUSTFLAGS="-C opt-level=3 -C target-cpu=nocona"
export LDFLAGS="-Wl,-O1,--sort-common,--as-needed"
export RUSTUP_TOOLCHAIN=stable

mkdir -p "${BUILD_DIR}"
cd "${BUILD_DIR}"

ROOTLESS_CONTAINER="" \
"${SRC_DIR}/configure.sh" \
    --container-engine="none" \
    --proton-sdk-image="" \
    --build-name="${BUILD_NAME}" \
    --without-extras=all \
    --without-vklayers=all \
    --without-steamrt-depends \
    --without-tts \
    --without-nvidia-libs \
    --enable-wow64

# The top-level make is serial by design; SUBJOBS is what it hands to each
# component's build.
SUBJOBS="${JOBS}" make -j1 dist

# ── Install ─────────────────────────────────────────────
mkdir -p "${OUT_DIR}"
cp -a "${BUILD_DIR}/dist/." "${OUT_DIR}/"

# Debug symbols in the bundled PE runtimes are dead weight in a guest image.
cd "${OUT_DIR}/files"
find "share/wine/gecko/wine-gecko-${GECKO_VER}-x86" -name '*.dll' -o -name '*.exe' 2>/dev/null \
    | xargs -r i686-w64-mingw32-strip --strip-debug 2>/dev/null || true
find "share/wine/gecko/wine-gecko-${GECKO_VER}-x86_64" -name '*.dll' -o -name '*.exe' 2>/dev/null \
    | xargs -r x86_64-w64-mingw32-strip --strip-debug 2>/dev/null || true
find "share/wine/mono/wine-mono-${MONO_VER}" -name '*.dll' -o -name '*.exe' 2>/dev/null \
    | xargs -r i686-w64-mingw32-strip --strip-debug 2>/dev/null || true

rm -rf "${BUILD_DIR}"
echo "proton: installed to ${OUT_DIR}"
