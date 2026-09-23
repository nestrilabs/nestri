#!/usr/bin/env bash
# Builds the guest kernel and installs it at "${KERNEL_OUTPUT}". Runs on the
# host, as yourself: nothing here needs root.
#
# The tree is CachyOS's fork, taken for its patches rather than its config.
# Theirs is a desktop distro config with thousands of modules; this guest has
# no /lib/modules at all. What must hold is kernel/nestri.fragment, merged onto
# whatever .config the tree has and then verified, so a version bump that
# quietly drops an option fails here instead of in a booted box.
set -euo pipefail

: "${KERNEL_GIT:?}"
: "${KERNEL_REF:?}"
: "${KERNEL_SRC:?}"
: "${KERNEL_OUTPUT:?}"

JOBS="${JOBS:-$(nproc)}"
KERNEL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../kernel" && pwd)"
FRAGMENT="${KERNEL_DIR}/nestri.fragment"
SEED="${KERNEL_DIR}/base.config"

# Resolved now, because everything below runs from inside the tree.
mkdir -p "$(dirname "${KERNEL_OUTPUT}")"
KERNEL_OUTPUT="$(cd "$(dirname "${KERNEL_OUTPUT}")" && pwd)/$(basename "${KERNEL_OUTPUT}")"

# ── Source ──────────────────────────────────────────────
if [[ ! -f "${KERNEL_SRC}/Makefile" ]]; then
    echo "kernel: cloning ${KERNEL_REF} into ${KERNEL_SRC}"
    mkdir -p "$(dirname "${KERNEL_SRC}")"
    git clone --depth=1 --branch "${KERNEL_REF}" "${KERNEL_GIT}" "${KERNEL_SRC}"
else
    have="$(git -C "${KERNEL_SRC}" describe --tags --exact-match 2>/dev/null || echo unknown)"
    if [[ "${have}" != "${KERNEL_REF}" ]]; then
        # Not fatal: a bisect or a local patch is a legitimate reason to be off
        # the pinned ref, and silently checking it out would throw that away.
        echo "kernel: tree is at '${have}', KERNEL_REF pins '${KERNEL_REF}'; building what is there" >&2
    fi
fi

cd "${KERNEL_SRC}"

# ── Infinity scheduler (experimental) ───────────────────
# Applied once per tree, and recorded, because `patch -N` on an already patched
# tree does not skip cleanly: it rejects every hunk. The whole series goes in or
# none of it does -- upstream is explicit that a partial series misbehaves -- so
# every patch is dry-run against the stacked result before any is applied.
#
# In this guest only the fair and rt halves do anything. virtio-gpu does not
# use the DRM scheduler, so the gpu patch is compiled out with the rest of
# drivers/gpu/drm/scheduler; it is applied anyway to keep the series whole.
if [[ -n "${KERNEL_INFINITY:-}" ]]; then
    : "${INFINITY_GIT:?}" "${INFINITY_REV:?}" "${INFINITY_SERIES:?}" "${INFINITY_WORK:?}"
    stamp=".nestri-infinity-rev"

    if [[ "$(git -C "${INFINITY_WORK}" rev-parse HEAD 2>/dev/null)" != "${INFINITY_REV}" ]]; then
        echo "kernel: fetching infinity-sched ${INFINITY_REV}"
        rm -rf "${INFINITY_WORK}"
        git init -q "${INFINITY_WORK}"
        git -C "${INFINITY_WORK}" fetch -q --depth=1 "${INFINITY_GIT}" "${INFINITY_REV}"
        git -C "${INFINITY_WORK}" checkout -q FETCH_HEAD
    fi
    series_dir="${INFINITY_WORK}/${INFINITY_SERIES}"
    [[ -f "${series_dir}/series" ]] || {
        echo "kernel: infinity-sched has no series at ${INFINITY_SERIES} for ${KERNEL_REF}" >&2
        exit 1
    }

    have="$(cat "${stamp}" 2>/dev/null || true)"
    if [[ "${have}" == "${INFINITY_REV}" ]]; then
        echo "kernel: infinity series already applied"
    elif [[ -n "${have}" ]]; then
        echo "kernel: tree carries infinity ${have}, INFINITY_REV pins ${INFINITY_REV}" >&2
        echo "kernel: start the tree over with \`make kernel-clean\`" >&2
        exit 1
    else
        if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
            echo "kernel: ${KERNEL_SRC} has local changes; not applying the series over them" >&2
            exit 1
        fi
        mapfile -t patches < <(grep -v '^[[:space:]]*\(#\|$\)' "${series_dir}/series")
        # git apply --check takes the whole list and checks each patch against
        # the result of the ones before it, which a per-file `patch --dry-run`
        # cannot do.
        git apply --check "${patches[@]/#/${series_dir}/}"
        for p in "${patches[@]}"; do
            echo "kernel: applying ${p}"
            # -F 0: zero fuzz. Offsets are fine; a hunk that only fits
            # approximately is a scheduler change landing somewhere it was not
            # written for.
            patch -p1 -N -F 0 --quiet < "${series_dir}/${p}"
        done
        echo "${INFINITY_REV}" > "${stamp}"
    fi
fi

# ── Config ──────────────────────────────────────────────
# A fresh tree has no .config. The seed is a known-good minimal config that
# olddefconfig migrates to whatever version the tree is at; it only saves a
# fresh tree from `make defconfig`, whose driver set is enormous next to what a
# microVM needs. An existing .config is always preferred.
if [[ ! -f .config ]]; then
    echo "kernel: seeding .config from kernel/base.config"
    cp "${SEED}" .config
fi

echo "kernel: merging kernel/nestri.fragment"
# -m merges without running a config target, so olddefconfig resolves
# dependencies once, in one place.
./scripts/kconfig/merge_config.sh -m .config "${FRAGMENT}" >/dev/null
make olddefconfig >/dev/null

# ── Verify the fragment actually took ───────────────────
# merge_config.sh warns about overridden symbols but exits 0, and olddefconfig
# will happily drop an option whose dependencies are unmet. Neither is loud
# enough for a setting whose failure mode is silent audio, so check the result
# rather than the intent. Both halves count: an option that must be on, and one
# that must be off.
missing=()
total=0
while read -r want; do
    total=$((total + 1))
    case "${want}" in
        CONFIG_*) grep -qx "${want}" .config || missing+=("${want%%=*}") ;;
        "# "*)    grep -qx "${want}" .config || missing+=("${want:2} (must be off)") ;;
    esac
done < <(grep -E '^(CONFIG_[A-Z0-9_]+=|# CONFIG_[A-Z0-9_]+ is not set)' "${FRAGMENT}" \
         | sed -E 's/^(CONFIG_[A-Z0-9_]+=[^[:space:]#]+)[[:space:]]*#.*/\1/')

if (( ${#missing[@]} )); then
    echo "kernel: these fragment entries did not survive olddefconfig:" >&2
    printf '%s\n' "${missing[@]}" >&2
    exit 1
fi
echo "kernel: all ${total} fragment entries hold"

# ── Build ───────────────────────────────────────────────
# -march goes in through KCFLAGS because mainline has no Kconfig for
# microarchitecture levels. It is safe for the kernel even at x86-64-v3:
# arch/x86/Makefile passes -mno-sse -mno-mmx -mno-sse2 -mno-avx and friends,
# and gcc applies those as a mask over -march regardless of flag order, so the
# kernel gets v3's integer ISA (BMI2, LZCNT, MOVBE) and its scheduling model
# and never touches a vector register.
make_args=()
if [[ -n "${KERNEL_MARCH:-}" ]]; then
    make_args+=("KCFLAGS=-march=${KERNEL_MARCH}")
    echo "kernel: building with -march=${KERNEL_MARCH}"
fi

# vmlinux, not bzImage: the guest is booted by an ELF loader with no
# bootloader in the path, and a bzImage is a self-decompressing image behind a
# real-mode setup header, not an ELF.
make -j"${JOBS}" "${make_args[@]}" vmlinux

cp vmlinux "${KERNEL_OUTPUT}"
echo "kernel: installed ${KERNEL_OUTPUT} ($(numfmt --to=iec "$(stat -c %s "${KERNEL_OUTPUT}")"))"
