#!/usr/bin/env bash
# Fetches proton-cachyos' source and its bundled runtimes. Container-only.
#
# Deliberately its own script, and its own layer: the submodule checkout runs
# well past ten minutes, and it must not be redone every time a build flag or a
# missing dependency changes. Keep everything that can fail *fast* in
# proton-build.sh instead.
set -euo pipefail

: "${PROTON_GIT:?}"
: "${PROTON_TAG:?}"
: "${GECKO_VER:?}"
: "${MONO_VER:?}"
: "${XALIA_VER:?}"

SRC_DIR="/build/proton-cachyos"

git clone --branch "${PROTON_TAG}" --depth=1 "${PROTON_GIT}" "${SRC_DIR}"
cd "${SRC_DIR}"
# Relative submodule paths resolve against origin, so it has to be the real URL
# even though we cloned by tag.
git remote set-url origin "${PROTON_GIT}"
# No --depth here: submodules are pinned to commits that are often not a branch
# tip. --filter=tree:0 keeps the download down instead.
git submodule update --init --filter=tree:0 --recursive

# Still needed with wow64: these are PE-side, and a 32-bit Windows program wants
# the 32-bit gecko and mono regardless of how wine is built.
mkdir -p contrib
for url in \
    "https://dl.winehq.org/wine/wine-gecko/${GECKO_VER}/wine-gecko-${GECKO_VER}-x86.tar.xz" \
    "https://dl.winehq.org/wine/wine-gecko/${GECKO_VER}/wine-gecko-${GECKO_VER}-x86_64.tar.xz" \
    "https://github.com/madewokherd/wine-mono/releases/download/wine-mono-${MONO_VER}/wine-mono-${MONO_VER}-x86.tar.xz" \
    "https://github.com/madewokherd/xalia/releases/download/xalia-${XALIA_VER}/xalia-${XALIA_VER}-net48-mono.zip" \
; do
    curl -fL --retry 3 -o "contrib/$(basename "$url")" "$url"
done

# Proton's cargo rule runs `cargo build --locked --offline`, so every crate has
# to be in CARGO_HOME before the build starts — including the git dependencies,
# which is what the "you are in the offline mode" failure is really saying. The
# error names a URL that is perfectly reachable; the build simply refuses to go
# out and get it.
#
# gst-plugins-rs is the only cargo component in the tree. Both targets are
# fetched: wow64 should mean nothing builds the i386 unix side, but a fetch is
# metadata only and costs almost nothing next to being wrong about that.
#
# CARGO_HOME is left at its default so it lands in this layer and the build
# layer inherits it.
export CARGO_NET_GIT_FETCH_WITH_CLI=true
export RUSTUP_TOOLCHAIN=stable
cd "${SRC_DIR}/gst-plugins-rs"
cargo fetch --locked --target x86_64-unknown-linux-gnu
cargo fetch --locked --target i686-unknown-linux-gnu

echo "proton: source at ${SRC_DIR}"
