#!/usr/bin/env bash
# Builds proton-ge wow64-only and leaves the finished tree in "${PROTON_WORK}/obj/dist".
# Runs on the host, not in a container.
#
# It has to run on the host because proton-ge's build is itself container-driven:
# `make` runs outside, and every step runs in the Steam Runtime SDK image, where
# the toolchains live, through the engine it is configured with. There is no
# mode without a container, and a container engine inside `podman build` is
# nested containers, which is a lot of fragile setup for no gain. So the only
# thing this script needs from the host is git, make and the engine. The
# Makefile packages the result afterwards.
#
# The one thing we change is the arch list: it becomes wow64-only, and that
# change is the reason this is our own build and not a download. wow64 runs
# 32-bit Windows code inside a 64-bit unix process. Without it Proton needs a
# complete 32-bit host stack: lib32 glibc, a second Mesa built for i686, and a
# second nescapture layer, because a 32-bit game would load the 32-bit Vulkan
# loader and our 64-bit capture layer would be invisible to it. The released
# builds carry an i386 unix side, which is exactly why they need lib32-*.
#
# Everything else is proton-ge's own recipe: the same SDK image, the same flags
# and the same patch set. The one addition is patches/proton-ge/: fixes for the
# places its makefile assumes a 32-bit unix side that wow64 does not have, and
# for things a tag pinned that have since moved out from under it.
set -euo pipefail

: "${PROTON_GIT:?}"
: "${PROTON_TAG:?}"
: "${PROTON_WORK:?}"
: "${BUILD_NAME:?}"

ENGINE="${CONTAINER_ENGINE:-podman}"
JOBS="${JOBS:-$(nproc)}"

mkdir -p "${PROTON_WORK}"
PROTON_WORK="$(cd "${PROTON_WORK}" && pwd)"
SRC="${PROTON_WORK}/src"
OBJ="${PROTON_WORK}/obj"
STAMP_TAG="${PROTON_WORK}/.tag"
STAMP_PATCHED="${PROTON_WORK}/.patched"
PATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../patches/proton-ge" && pwd)"

# Two builds in one tree do not fail cleanly. They race on the same objects and
# leave half-written files that a later build trusts. A failed make also keeps
# running its in-flight jobs for a while after it reports the error, so the
# first build is often still running when the second one starts.
exec 9>"${PROTON_WORK}/.lock"
flock -n 9 || { echo "proton: another build is using ${PROTON_WORK}" >&2; exit 1; }

# ccache and cargo's downloads are kept outside src/ and obj/, so a new tag or
# FORCE_REBUILD throws away the build and keeps the parts that are correct to
# reuse. proton-ge's makefile mounts both into the container from these
# variables.
export CCACHE_DIR="${PROTON_WORK}/ccache"
export CARGO_HOME="${PROTON_WORK}/cargo"
mkdir -p "${CCACHE_DIR}" "${CARGO_HOME}"

if [[ -n "${FORCE_REBUILD:-}" || "$(cat "${STAMP_TAG}" 2>/dev/null)" != "${PROTON_TAG}" ]]; then
    echo "proton: fresh tree for ${PROTON_TAG}"
    rm -rf "${SRC}" "${OBJ}" "${STAMP_TAG}" "${STAMP_PATCHED}"
fi

# ── Fetch ───────────────────────────────────────────────
if [[ ! -e "${STAMP_TAG}" ]]; then
    rm -rf "${SRC}"
    git clone --branch "${PROTON_TAG}" --depth=1 "${PROTON_GIT}" "${SRC}"
    # No --depth here: submodules are pinned to commits that are often not a
    # branch tip. --filter=tree:0 keeps the download down instead.
    git -C "${SRC}" submodule update --init --filter=tree:0 --recursive
    echo "${PROTON_TAG}" > "${STAMP_TAG}"
fi

# The SDK image is pinned by proton-ge's own makefile, per tag. Asking it keeps
# the patch step below and the build on the same image.
SDK_IMAGE="$(make --silent --no-print-directory -f "${SRC}/Makefile.in" \
    SRCDIR="${SRC}" get-steamrt-image)"

# ── Patch ───────────────────────────────────────────────
# The patch script edits the tree in place and is not idempotent: it resets
# some submodules first and not others. So a tree is patched once, and one that
# was interrupted halfway is reset to the commits the tag pins before trying
# again.
#
# It is run in the SDK image rather than on the host, so it does not depend on
# the host's python, patch or wget.
#
# The script carries on past a patch that does not apply and exits 0 anyway.
# The upstream instructions are to grep its output for failures, so that is
# what happens here. The alternative is an image that looks fine and is missing
# a fix.
#
# A build tree does not survive its source being re-patched. Changing
# Makefile.in re-syncs every component's source copy, but a component's
# configure step depends on that sync order-only, so it does not rerun, and its
# old build directory is left pointing at generated autotools files the sync
# just removed. So patching starts obj/ over too. ccache keeps that cheap.
if [[ ! -e "${STAMP_PATCHED}" ]]; then
    rm -rf "${OBJ}"
    git -C "${SRC}" reset -q --hard
    git -C "${SRC}" submodule foreach -q --recursive 'git reset -q --hard && git clean -qfdx'
    "${ENGINE}" run --rm -v "${SRC}:${SRC}" -w "${SRC}" "${SDK_IMAGE}" \
        ./patches/protonprep-valve-staging.sh 2>&1 | tee "${PROTON_WORK}/patch.log"
    if grep -Ei 'hunk .* failed|saving rejects|can.t find file|malformed patch|skipping patch|^error' \
            "${PROTON_WORK}/patch.log"; then
        echo "proton: patches did not apply cleanly, see ${PROTON_WORK}/patch.log" >&2
        exit 1
    fi
    # Ours go on top. They are paths from the root of the tree, submodules
    # included. `git apply` fails outright on a patch that no longer applies,
    # which is what a tag bump should do: each one says why it exists, so the
    # question is only whether upstream fixed it.
    for p in "${PATCH_DIR}"/*.patch; do
        [[ -e "$p" ]] || continue
        echo "proton: applying $(basename "$p")"
        git -C "${SRC}" apply "$p"
    done
    touch "${STAMP_PATCHED}"
fi

# ── Configure ───────────────────────────────────────────
# configure.sh refuses an in-tree build, and it test-runs the SDK image to work
# out how the engine maps file ownership, so it is also where a broken engine
# setup shows up first.
mkdir -p "${OBJ}"
if [[ ! -e "${OBJ}/Makefile" ]]; then
    (cd "${OBJ}" && "${SRC}/configure.sh" \
        --build-name="${BUILD_NAME}" \
        --container-engine="${ENGINE}")
fi

# ── Build ───────────────────────────────────────────────
# ARCHS drops i386-unix, which leaves wine configured for x86_64 unix with an
# i386 PE side. That is wow64. Every component rule is gated on ARCHS, so the
# 32-bit unix builds of everything else go with it. ENABLE_WOW64 makes the
# proton script ask wine for a wow64 prefix. proton-ge ships it as a switch
# but never turns it on.
#
# A command-line variable reaches the container build too: the outer make
# hands its overrides to the inner one.
#
# SOURCE_DATE_EPOCH is the tag's commit time rather than now, so two builds of
# one tag stamp the same dates into their output.
make -C "${OBJ}" \
    J="${JOBS}" \
    ARCHS="i386-windows x86_64-windows x86_64-unix" \
    ENABLE_WOW64=1 \
    SOURCE_DATE_EPOCH="$(git -C "${SRC}" log -1 --format=%ct)" \
    dist

echo "proton: built ${OBJ}/dist"
