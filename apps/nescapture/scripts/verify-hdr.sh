#!/usr/bin/env bash
# Verify that the HDR path *converts*, not merely that it says it did.
#
# The defect this exists to catch: the colour space reached the encoder's
# configuration and its VUI, but not the conversion shader. The stream then
# declares BT.2020 NCL while the samples under it were written with the BT.709
# matrix, and nothing downstream can tell.
#
# Two rules follow from that, and they are the whole design:
#
#   1. Compare raw Y/U/V samples, never a decode to RGB. If the shader and the
#      VUI agree on the *wrong* matrix, an RGB round trip inverts exactly what
#      it applied and returns the original colour. It scores the broken build
#      perfect.
#   2. Use a saturated colour, never grey. Achromatic input gives identical
#      results under every matrix here, so a grey patch cannot see this defect
#      at any tolerance.
#
# `ffprobe` output is byte-identical between a correct and a broken build --
# it reads the declaration, which is the half that was already right.
#
# Needs a probe that can drive an HDR swapchain on purpose. It is not vendored:
# it pulls winit and ash, which is a lot of build for a test fixture. Point
# HDRPROBE at one that accepts `--color R,G,B`, `--width`, `--height`, `--sdr`.
#
# Usage: HDRPROBE=/path/to/hdrprobe apps/nescapture/scripts/verify-hdr.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK="$(mktemp -d /tmp/nshdr.XXXXXX)"   # short path: an AF_UNIX socket has ~108 bytes
trap 'rm -rf "$WORK"; kill $(jobs -p) 2>/dev/null || true' EXIT

: "${XDG_RUNTIME_DIR:=/run/user/$(id -u)}"
export XDG_RUNTIME_DIR
: "${SECS:=12}"
W=1920; H=1080

if [ -z "${HDRPROBE:-}" ] || [ ! -x "${HDRPROBE:-}" ]; then
  echo "set HDRPROBE to a probe that can present a known colour in a chosen colour space" >&2
  exit 2
fi
for t in ffmpeg python3; do
  command -v "$t" >/dev/null || { echo "missing required tool: $t" >&2; exit 1; }
done
python3 -c "import numpy" 2>/dev/null || { echo "missing python numpy" >&2; exit 1; }

echo "building…"
cargo build --release -p nescope -p nescapture --manifest-path "$ROOT/Cargo.toml" >/dev/null

# Point the loader at this build. A stale layer installed system-wide otherwise
# wins the lookup and the run silently measures whatever is in /usr/lib.
mkdir -p "$WORK/lay"
sed "s#\"library_path\": \".*\"#\"library_path\": \"$ROOT/target/release/libnescapture_layer.so\"#" \
  "$ROOT/apps/nescapture/manifest/VK_LAYER_nescapture.json" > "$WORK/lay/VK_LAYER_nescapture.json"
export VK_ADD_IMPLICIT_LAYER_PATH="$WORK/lay"

run_case() {
  local tag=$1 color=$2 mode=$3
  local sock="$WORK/$tag.sock" out="$WORK/$tag.h264"
  local hdrflag="" probeflag=""
  [ "$mode" = "hdr" ] && hdrflag="--hdr" || probeflag="--sdr"

  python3 - "$sock" "$out" "$SECS" > "$WORK/$tag.frames" <<'PY' &
import os, socket, struct, sys, time
sock, out, secs = sys.argv[1], sys.argv[2], float(sys.argv[3])
s = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 8 << 20)
s.bind(sock); os.chmod(sock, 0o777); s.settimeout(1.0)
n = 0; end = time.time() + secs
with open(out, "wb") as f:
    while time.time() < end:
        try: b = s.recv(8 << 20)
        except socket.timeout: continue
        if len(b) < 20 or b[:4] != b"NSTR" or b[4] != 0: continue
        f.write(b[20:20 + struct.unpack("<I", b[16:20])[0]]); n += 1
print(n)
PY
  local recv=$!
  sleep 1
  NESCAPTURE_ENABLE=1 NESCAPTURE_CODEC=h264 NESCAPTURE_BITRATE=20000 NESCAPTURE_FPS=60 \
  NESCAPTURE_IPC_PATH="$sock" RUST_LOG=nescapture_layer=info \
  timeout "$((SECS - 2))" "$ROOT/target/release/nescope" \
    --width $W --height $H --fps 60 $hdrflag \
    -- "$HDRPROBE" --width $W --height $H --color "$color" $probeflag --frames 100000 \
    > "$WORK/$tag.log" 2>&1 || true
  wait $recv || true

  # Decode to raw planes in the format the stream already is, so ffmpeg inserts
  # no scaler and applies no matrix. What is compared is what the shader wrote.
  ffmpeg -v error -y -i "$out" -pix_fmt yuv420p -f rawvideo "$WORK/$tag.yuv" 2>/dev/null || true
  printf "  %-10s %s frames, %s\n" "$tag" "$(cat "$WORK/$tag.frames")" \
    "$(grep -m1 -o 'CHOSEN: .*' "$WORK/$tag.log" || echo 'no format line')"
}

echo "running ${SECS}s per case…"
run_case red_hdr   255,0,0 hdr
run_case green_hdr 0,255,0 hdr
run_case red_sdr   255,0,0 sdr

python3 - "$WORK" "$W" "$H" <<'PY'
import os, sys
import numpy as np

work, W, H = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
FRAME = W * H * 3 // 2

# Luma coefficients are the published ones (ITU-R BT.709-6, BT.2020-2 Table 4).
# Cb/Cr come from the standard relations rather than from the shader's own
# constants, so agreement is a cross-check and not a restatement.
KR_KB = {"bt709": (0.2126, 0.0722), "bt2020": (0.2627, 0.0593)}

def expect(rgb, matrix):
    kr, kb = KR_KB[matrix]
    r, g, b = (c / 255.0 for c in rgb)
    y = kr * r + (1.0 - kr - kb) * g + kb * b
    q = lambda x: min(255.0, max(0.0, x * 255.0))
    return q(y), q((b - y) / (2 * (1 - kb)) + 0.5), q((r - y) / (2 * (1 - kr)) + 0.5)

def centre(a):
    h, w = a.shape
    return a[h // 2 - 100:h // 2 + 100, w // 2 - 100:w // 2 + 100]

def decide(tag, rgb, want):
    path = f"{work}/{tag}.yuv"
    n = os.path.getsize(path) // FRAME if os.path.exists(path) else 0
    if n < 3:
        return tag, "INCONCLUSIVE", f"only {n} decoded frames"
    ys, us, vs = [], [], []
    for i in (n - 3, n - 2, n - 1):
        buf = np.fromfile(path, dtype=np.uint8, count=FRAME, offset=i * FRAME)
        ys.append(centre(buf[:W * H].reshape(H, W).astype(float)))
        us.append(centre(buf[W * H:W * H + W * H // 4].reshape(H // 2, W // 2).astype(float)))
        vs.append(centre(buf[W * H + W * H // 4:].reshape(H // 2, W // 2).astype(float)))
    y = float(np.mean([p.mean() for p in ys]))
    std = max(p.std() for p in ys)
    u = float(np.mean([p.mean() for p in us]))
    v = float(np.mean([p.mean() for p in vs]))

    e709, e2020 = expect(rgb, "bt709"), expect(rgb, "bt2020")
    d709, d2020 = abs(y - e709[0]), abs(y - e2020[0])
    print(f"  {tag:10} Y={y:7.2f} U={u:6.2f} V={v:6.2f}  (std {std:.2f})")
    print(f"  {'':10} BT.709 Y={e709[0]:6.2f} off {d709:5.2f} | "
          f"BT.2020 Y={e2020[0]:6.2f} off {d2020:5.2f}")

    # The shader quantises with uint(), which truncates rather than rounds, so a
    # correct sample sits up to one code low. The two hypotheses are ~13 codes
    # apart, so a 2-code window cannot admit both.
    if std >= 2.0:
        return tag, "INCONCLUSIVE", f"centre patch not flat (std {std:.2f})"
    hit, miss = (d2020, d709) if want == "bt2020" else (d709, d2020)
    other = "bt709" if want == "bt2020" else "bt2020"
    if hit < 2.0 and miss > 6.0:
        return tag, "PASS", f"converted on the {want} matrix (off {hit:.2f})"
    if miss < 2.0:
        return tag, "FAIL", f"converted with the {other} matrix (off {miss:.2f}), not {want}"
    return tag, "INCONCLUSIVE", f"near neither (off {hit:.2f} / {miss:.2f})"

print()
results = [
    decide("red_hdr",   (255, 0, 0), "bt2020"),
    decide("green_hdr", (0, 255, 0), "bt2020"),
    decide("red_sdr",   (255, 0, 0), "bt709"),
]
print("-" * 60)
for tag, verdict, why in results:
    print(f"  {verdict:13} {tag:10} {why}")
print()
if all(v == "PASS" for _, v, _ in results):
    print("PASS")
    sys.exit(0)
print("FAIL")
sys.exit(1)
PY
