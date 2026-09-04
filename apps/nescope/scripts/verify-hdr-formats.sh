#!/usr/bin/env bash
# Report the surface formats a client actually sees under nescope.
#
# HDR reaches a game as a (VkFormat, VkColorSpaceKHR) pair on its swapchain
# surface. Everything else -- the colour-management protocol, the dmabuf format
# list, the encoder's matrix and transfer tags -- is downstream of whether that
# pair was ever offered. So this asks the one question directly, from inside a
# real client process, using the loader's own enumeration rather than ours.
#
# It deliberately does not check pixels. verify-hdr.sh in nescapture does that,
# and the two are answering different questions: this one is "was HDR on the
# menu", that one is "did the samples come out where the standard says". A pass
# here and a fail there means we converted wrongly; a fail here means the game
# never had the option and anything downstream is moot.
#
# Two states are worth distinguishing, so there are two modes:
#
#   (default)       Baseline. What works today: 8-bit BGRA carrying
#                   HDR10_ST2084 via Mesa's wp_color_manager_v1 path. Fails if
#                   we regress that.
#
#   --expect-layer  Target. The three formats a WSI layer must inject before a
#                   Proton HDR title can pick one. Expected to fail until that
#                   layer exists; this is the regression target for that work,
#                   not a bug report.
#
# Usage: apps/nescope/scripts/verify-hdr-formats.sh [--expect-layer]
set -euo pipefail

MODE="baseline"
[ "${1:-}" = "--expect-layer" ] && MODE="layer"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

: "${XDG_RUNTIME_DIR:=/run/user/$(id -u)}"
export XDG_RUNTIME_DIR

for tool in vulkaninfo python3; do
  command -v "$tool" >/dev/null || { echo "missing required tool: $tool" >&2; exit 1; }
done

echo "building…"
cargo build --release -p nescope --manifest-path "$ROOT/Cargo.toml" >/dev/null

# The probe runs as nescope's child, so it sees exactly the environment a game
# would. Which display variables it inherits is itself a result -- a child with
# no DISPLAY is a native Wayland client, and that is the path with no HDR -- so
# record them before enumerating anything.
cat > "$WORK/probe.sh" <<'PROBE'
#!/usr/bin/env bash
echo "child_wayland_display=${WAYLAND_DISPLAY:-unset}"
echo "child_display=${DISPLAY:-unset}"
echo "child_enable_gamescope_wsi=${ENABLE_GAMESCOPE_WSI:-unset}"
echo "---VULKANINFO---"
vulkaninfo 2>/dev/null || true
PROBE
chmod +x "$WORK/probe.sh"

echo "enumerating surface formats under nescope…"
timeout 60 "$ROOT/target/release/nescope" --hdr --width 1280 --height 720 \
  -- "$WORK/probe.sh" > "$WORK/probe.out" 2>"$WORK/nescope.log" || true

python3 - "$WORK/probe.out" "$MODE" <<'PY'
import re, sys

path, mode = sys.argv[1], sys.argv[2]
text = open(path, errors="replace").read()

env = dict(re.findall(r"^(child_\w+)=(.*)$", text, re.M))
print()
print(f"child WAYLAND_DISPLAY:  {env.get('child_wayland_display', '?')}")
print(f"child DISPLAY:          {env.get('child_display', '?')}")
print(f"ENABLE_GAMESCOPE_WSI:   {env.get('child_enable_gamescope_wsi', '?')}")

# Pull the format list from the presentable-surface section of the first real
# GPU. llvmpipe is enumerated too and would double every count, so skip any
# adapter that names it -- a software rasteriser's opinion about HDR is not the
# thing under test.
section = text.split("Presentable Surfaces", 1)
formats = []
gpu = None
if len(section) > 1:
    block, cur_fmt = section[1], None
    for line in block.splitlines():
        m = re.match(r"\s*GPU id\s*:\s*\d+\s*\((.+?)\)", line)
        if m:
            gpu = m.group(1)
            continue
        if gpu and "llvmpipe" in gpu:
            continue
        m = re.match(r"\s*format\s*=\s*(\S+)", line)
        if m:
            cur_fmt = m.group(1)
            continue
        m = re.match(r"\s*colorSpace\s*=\s*(\S+)", line)
        if m and cur_fmt:
            formats.append((cur_fmt, m.group(1)))
            cur_fmt = None

fails = []
if not formats:
    fails.append("no surface formats enumerated at all — the probe never reached "
                 "a surface, so this run measured nothing")

print(f"\nsurface formats offered: {len(formats)}")
for f, cs in formats:
    print(f"  {f:<34} {cs}")

spaces = {cs for _, cs in formats}
depth10 = [f for f, _ in formats if "10" in f and "B8G8R8A8" not in f]
depth16 = [f for f, _ in formats if "16G16" in f or "SFLOAT" in f]

print()
print(f"HDR10_ST2084 offered:    {'yes' if any('ST2084' in s for s in spaces) else 'no'}")
print(f"scRGB linear offered:    {'yes' if any('EXTENDED_SRGB_LINEAR' in s for s in spaces) else 'no'}")
print(f"10-bit formats offered:  {'yes' if depth10 else 'no'}")
print(f"FP16 formats offered:    {'yes' if depth16 else 'no'}")

if formats:
    if mode == "baseline":
        # Only what is genuinely working today. The point of this mode is to
        # notice if the colour-management path stops being wired up at all,
        # which would otherwise look identical to plain SDR.
        if not any("ST2084" in s for s in spaces):
            fails.append("HDR10_ST2084_EXT is no longer offered — the "
                         "wp_color_manager_v1 path has stopped being advertised")
    else:
        # The three a WSI layer injects. Until one exists these all fail, and
        # that is the expected reading, not a defect in this script.
        if not any("ST2084" in s for s in spaces):
            fails.append("HDR10_ST2084_EXT not offered")
        if not depth10:
            fails.append("no 10-bit format offered — PQ over 8-bit BGRA bands; a "
                         "WSI layer must inject A2B10G10R10/A2R10G10B10")
        if not any("EXTENDED_SRGB_LINEAR" in s for s in spaces):
            fails.append("EXTENDED_SRGB_LINEAR_EXT not offered — Proton titles on "
                         "the scRGB path find no matching format and fall back to SDR")
        if not depth16:
            fails.append("no FP16 format offered — the scRGB path needs "
                         "R16G16B16A16_SFLOAT")

# The display the child inherited decides which of the two code paths it is on,
# and only one of them can carry HDR today. Worth saying plainly either way,
# because a native-Wayland client failing the layer checks above is failing for
# a reason that has nothing to do with formats.
if env.get("child_display", "unset") == "unset":
    print("\nnote: the child had no DISPLAY, so it ran as a native Wayland client.")
    print("      HDR signalling needs the XWayland path — see the FIXME in")
    print("      apps/nescope/src/hdr.rs for why the Wayland one cannot carry it yet.")

print()
if fails:
    print("FAIL" + (" (expected until the WSI layer lands)" if mode == "layer" else ""))
    for f in fails:
        print(f"  - {f}")
    sys.exit(1)
print("PASS")
PY
