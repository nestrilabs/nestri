#!/usr/bin/env bash
# Pack a built container image into a raw ext4 disk for nesbox's virtio-blk.
#
# Docker/Buildx has no native "export a raw disk image" step, so this is the
# one part of the pipeline that still has to run outside the Dockerfile.
#
# Run this as yourself, not under sudo. Only mkfs/mount/umount actually need
# root, and those are escalated individually below — `sudo bash mkimage.sh`
# for the whole script is exactly the wrong shape for rootless Podman: the
# image `make build` produced lives in *your* rootless storage, and running
# `podman create` as root afterwards looks in root's separate storage, where
# the tag does not exist. `sudo -v` up front just avoids being prompted
# mid-script for the escalated calls that follow.
set -euo pipefail

IMAGE="${1:?usage: mkimage.sh <image-tag> <output-path> [size]}"
OUT="${2:?usage: mkimage.sh <image-tag> <output-path> [size]}"
SIZE="${3:-5G}"

if [[ "$(id -u)" -eq 0 ]]; then
    echo "mkimage.sh should run as yourself, not root/sudo — see the comment at the top of this script" >&2
    exit 1
fi

CONTAINER_RT="$(command -v docker || command -v podman || true)"
[[ -n "$CONTAINER_RT" ]] || { echo "Neither docker nor podman found in PATH" >&2; exit 1; }

sudo -v   # cache credentials once, rather than prompting mid-pipeline

WORK="$(mktemp -d)"
cleanup() {
    mountpoint -q "$WORK/mnt" 2>/dev/null && sudo umount "$WORK/mnt"
    rm -rf "$WORK"
}
trap cleanup EXIT

echo "Exporting ${IMAGE}..."
cid="$("$CONTAINER_RT" create "$IMAGE")"
"$CONTAINER_RT" export "$cid" -o "$WORK/rootfs.tar"
"$CONTAINER_RT" rm -f "$cid" >/dev/null

echo "Creating ${SIZE} ext4 image at ${OUT}..."
mkdir -p "$(dirname "$OUT")"
truncate -s "$SIZE" "$OUT"
sudo mkfs.ext4 -q -L nestri-root "$OUT"

mkdir -p "$WORK/mnt"
sudo mount -o loop "$OUT" "$WORK/mnt"
# Same excludes as the old bootstrap extraction: .dockerenv is Docker's own
# marker file, and /dev is devtmpfs at boot, populated by the kernel — a
# tarred copy of the build container's /dev would just be dead weight.
#
# Root, deliberately: the rootfs's own files are owned by root (that is
# correct — it is the guest's root filesystem), and only root can write
# root-owned files onto the loop-mounted ext4.
sudo tar -xf "$WORK/rootfs.tar" -C "$WORK/mnt" --exclude='.dockerenv' --exclude='dev/*'
sudo umount "$WORK/mnt"

# The image *file* itself was created by `truncate` above as the invoking
# user and never needs to change hands — mkfs/mount/umount touch its
# contents, not its ownership. Asserted, not assumed, since a stray `sudo`
# reordering above would silently hand root ownership of a file the rest of
# this pipeline expects to read and delete without sudo.
[[ "$(stat -c '%U' "$OUT")" == "$(id -un)" ]] || {
    echo "warning: ${OUT} is not owned by $(id -un) — sudo chown $(id -un) ${OUT}" >&2
}
echo "Wrote ${OUT}"
