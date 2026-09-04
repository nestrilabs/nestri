#!/usr/bin/env bash
# Verify the capture chain end to end on this machine's GPU.
#
# Runs a Vulkan workload under the compositor with the layer active, then checks
# the encoded result against the compositor's own readback of the same frames.
# Two independent paths see the same content: the compositor reads the surface
# back to the CPU, the layer exports it as a DMA-BUF and encodes it on the GPU.
# Agreement between them is the evidence; a single path cannot tell a correct
# frame from a plausible-looking wrong one.
#
# The failure this is really aimed at is silent: a black or mis-levelled frame
# arrives as a valid stream at the right frame rate, and every liveness check
# passes. So the checks below are about pixel values, not about whether bytes
# moved.
#
# This covers the SDR path only. The HDR arms need a swapchain this workload
# cannot ask for, and the check that matters there is a different one — absolute
# sample values against the standard, rather than two instruments against each
# other. See verify-hdr.sh.
#
# Usage: apps/nescapture/scripts/verify-chain.sh [seconds]
set -euo pipefail

SECS="${1:-16}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; kill $(jobs -p) 2>/dev/null || true' EXIT

: "${XDG_RUNTIME_DIR:=/run/user/$(id -u)}"
export XDG_RUNTIME_DIR

for tool in ffmpeg ffprobe vkcube python3; do
  command -v "$tool" >/dev/null || { echo "missing required tool: $tool" >&2; exit 1; }
done

echo "building…"
cargo build --release -p nescope -p nescapture --manifest-path "$ROOT/Cargo.toml" >/dev/null

LAYER="$ROOT/target/release/libnescapture_layer.so"
MANIFEST_DIR="$WORK/implicit_layer.d"
mkdir -p "$MANIFEST_DIR"
sed "s#\"library_path\": \".*\"#\"library_path\": \"$LAYER\"#" \
  "$ROOT/apps/nescapture/manifest/VK_LAYER_nescapture.json" > "$MANIFEST_DIR/VK_LAYER_nescapture.json"
export VK_ADD_IMPLICIT_LAYER_PATH="$MANIFEST_DIR"

VIDEO_SOCK="$WORK/video.sock"
SHOT_SOCK="$WORK/shot.sock"
STREAM="$WORK/capture.h264"

cat > "$WORK/recv.py" <<'PY'
import os, socket, struct, sys, time
sock, out, secs = sys.argv[1], sys.argv[2], float(sys.argv[3])
s = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 8 << 20)
s.bind(sock); os.chmod(sock, 0o777); s.settimeout(1.0)
n = 0; end = time.time() + secs
with open(out, "wb") as f:
    while time.time() < end:
        try: buf = s.recv(8 << 20)
        except socket.timeout: continue
        if len(buf) < 20 or buf[:4] != b"NSTR" or buf[4] != 0: continue
        (_, _, _, dl) = struct.unpack("<IHHI", buf[8:20])
        f.write(buf[20:20 + dl]); n += 1
print(n)
PY

echo "capturing for ${SECS}s…"
"$ROOT/target/release/nescope-shot" --socket "$SHOT_SOCK" --watch --interval 1000 \
  --keep 3 --out "$WORK/shot.ppm" >/dev/null 2>&1 &
python3 "$WORK/recv.py" "$VIDEO_SOCK" "$STREAM" "$SECS" > "$WORK/frames.txt" &
RECV=$!
sleep 1

NESCAPTURE_ENABLE=1 NESCAPTURE_CODEC=h264 NESCAPTURE_BITRATE=20000 NESCAPTURE_FPS=60 \
NESCAPTURE_IPC_PATH="$VIDEO_SOCK" RUST_LOG=nescapture_layer=debug \
timeout "$((SECS - 2))" "$ROOT/target/release/nescope" \
  --width 1280 --height 720 --fps 60 --screenshot-ipc "$SHOT_SOCK" \
  -- vkcube --c 100000 > "$WORK/run.log" 2>&1 || true
wait $RECV || true

FRAMES="$(cat "$WORK/frames.txt")"
echo
echo "frames encoded:   $FRAMES"
grep -m1 "First import" "$WORK/run.log" || echo "  (no DMA-BUF import logged)"

python3 - "$WORK" "$STREAM" "$FRAMES" <<'PY'
import glob, subprocess, sys
import numpy as np
from PIL import Image

work, stream, frames = sys.argv[1], sys.argv[2], int(sys.argv[3])
fails = []

if frames < 30:
    fails.append(f"only {frames} frames encoded (want >= 30)")

probe = subprocess.run(
    ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
     "stream=color_range", "-of", "default=noprint_wrappers=1:nokey=1", stream],
    capture_output=True, text=True).stdout.strip()
print(f"declared range:   {probe or '(none)'}")
if probe != "pc":
    fails.append(f"stream declares color_range={probe or 'unset'}; the converter "
                 "writes full-range samples, so the tag must be 'pc'")

subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", stream, "-vf",
                r"select='eq(n\,120)+eq(n\,240)'", "-fps_mode", "passthrough",
                f"{work}/dec_%02d.png"], check=True)

def luma(a):
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]

dec = [np.asarray(Image.open(p).convert("RGB")).astype(float)
       for p in sorted(glob.glob(f"{work}/dec_*.png"))]
shots = [np.asarray(Image.open(p).convert("RGB")).astype(float)
         for p in sorted(glob.glob(f"{work}/shot-*.ppm"))]

if not dec:
    fails.append("nothing decoded from the stream")
if not shots:
    fails.append("compositor readback produced no frames")

if dec:
    worst = min(luma(d).std() for d in dec)
    print(f"decoded luma std: {worst:.2f}")
    # An absolute floor only has to catch a blank frame, which sits near zero.
    # How much structure a *correct* frame carries depends entirely on what the
    # workload drew, so the real check is the relative one below, against the
    # readback of the same content.
    if worst < 5.0:
        fails.append(f"decoded frames are near-uniform (luma std {worst:.2f}) — "
                     "the classic silent failure is a blank frame at full frame rate")

if dec and shots:
    ds, ss = min(luma(d).std() for d in dec), min(luma(s).std() for s in shots)
    print(f"readback luma std:{ss:.2f}")
    if ss > 1.0 and abs(ds - ss) / ss > 0.25:
        fails.append(f"decoded structure {ds:.2f} vs readback {ss:.2f} — the two "
                     "paths saw the same frames, so they should carry the same detail")

if dec and shots:
    # Compare a corner, not the whole frame. The two instruments sample at
    # different moments -- the readback is on a 1 s timer, the decoded frames are
    # picked by index -- so any whole-frame statistic also carries whatever the
    # workload was doing at each instant. The workload draws a centred object on
    # a flat background, so a corner patch is the same colour in every frame and
    # the comparison stops depending on lining them up.
    #
    # This is the measurement that catches a range or matrix error: a flat patch
    # of known colour, decoded, against the same patch read back from the
    # compositor. It is where a full-range/limited-range mismatch shows up as a
    # constant offset.
    def corner(a):
        return a[8:72, 8:72]

    def spread(patches):
        m = [luma(p).mean() for p in patches]
        return max(m) - min(m)

    dc, sc = [corner(d) for d in dec], [corner(s) for s in shots]
    a = float(np.mean([luma(p).mean() for p in sc]))
    b = float(np.mean([luma(p).mean() for p in dc]))
    print(f"readback corner:  {a:.2f}")
    print(f"decoded corner:   {b:.2f}")
    print(f"difference:       {abs(a - b):.2f}")

    # If the corner is not actually flat across frames, the assumption above does
    # not hold for this workload and the comparison would be measuring animation.
    # Say so rather than reporting a number that means nothing.
    drift = max(spread(dc), spread(sc))
    if drift > 3.0:
        fails.append(f"the corner patch varies by {drift:.2f} between frames, so it "
                     "is not background here; the brightness check assumes a "
                     "workload that leaves its corners alone")
    elif abs(a - b) > 4.0:
        fails.append(f"the two paths disagree on brightness by {abs(a-b):.2f}; "
                     "they are looking at the same content, so one of them is wrong")

print()
if fails:
    print("FAIL")
    for f in fails:
        print(f"  - {f}")
    sys.exit(1)
print("PASS")
PY
