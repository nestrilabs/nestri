#!/usr/bin/env sh
# nesdoctor installer — https://doctor.nestri.io/install.sh
#
# This file is the source of what that URL serves. It lives in the public
# repository so that anyone about to pipe it into a shell can read it first:
#
#   https://github.com/nestrilabs/nestri/blob/dev/apps/nesdoctor/install/install.sh
#
# What it does, in order: work out your platform, download the matching
# nesdoctor binary from GitHub Releases, verify it against the published
# SHA256SUMS, run it, and delete it. It installs nothing permanently, touches
# no system directory, and never asks for sudo.
#
# What nesdoctor itself does is printed when it starts.

set -eu

REPO="nestrilabs/nestri"
TAG="${NESDOCTOR_TAG:-}"          # empty means latest
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM

say()  { printf '%s\n' "$*" >&2; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

# --- platform ---------------------------------------------------------------
case "$(uname -s)" in
  Linux)  os=linux ;;
  Darwin) os=macos ;;
  *) die "unsupported OS: $(uname -s). nesdoctor runs on Linux, macOS and Windows." ;;
esac

case "$(uname -m)" in
  x86_64|amd64) arch=x86_64 ;;
  arm64|aarch64) arch=aarch64 ;;
  *) die "unsupported architecture: $(uname -m)" ;;
esac

case "$os/$arch" in
  linux/x86_64)  target=x86_64-unknown-linux-musl ;;
  macos/aarch64) target=aarch64-apple-darwin ;;
  macos/x86_64)  target=x86_64-apple-darwin ;;
  linux/aarch64)
    die "no aarch64 Linux build yet. Building from source takes a minute:
  git clone --depth 1 https://github.com/$REPO && cd nestri
  cargo run --release -p nesdoctor" ;;
  *) die "no build for $os/$arch" ;;
esac

ASSET="nesdoctor-$target"

# --- fetch ------------------------------------------------------------------
# curl or wget, whichever is present. -f so an HTML error page is never
# mistaken for a binary.
if command -v curl >/dev/null 2>&1; then
  get() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  get() { wget -qO "$2" "$1"; }
else
  die "need curl or wget"
fi

if [ -n "$TAG" ]; then
  BASE="https://github.com/$REPO/releases/download/$TAG"
else
  BASE="https://github.com/$REPO/releases/latest/download"
fi

say "Downloading nesdoctor ($target)…"
get "$BASE/$ASSET" "$TMP/$ASSET" || die "download failed. Is there a release yet? $BASE/$ASSET"

# --- verify -----------------------------------------------------------------
# A checksum we fetch from the same place as the binary is not a security
# boundary, and pretending otherwise would be worse than saying so: it catches
# a truncated or corrupted download, which is the failure that actually
# happens. The signed-release version of this is a later job.
if get "$BASE/SHA256SUMS" "$TMP/SHA256SUMS" 2>/dev/null; then
  if command -v sha256sum >/dev/null 2>&1; then
    have="$(sha256sum "$TMP/$ASSET" | cut -d' ' -f1)"
  elif command -v shasum >/dev/null 2>&1; then
    have="$(shasum -a 256 "$TMP/$ASSET" | cut -d' ' -f1)"
  else
    have=""
  fi
  if [ -n "$have" ]; then
    want="$(grep -F "$ASSET" "$TMP/SHA256SUMS" | cut -d' ' -f1 | head -n1)"
    [ -n "$want" ] || die "no checksum for $ASSET in SHA256SUMS"
    [ "$have" = "$want" ] || die "checksum mismatch — do not run this file
  expected $want
  got      $have"
    say "Checksum OK."
  else
    say "No sha256 tool found; skipping verification."
  fi
else
  say "No SHA256SUMS published; skipping verification."
fi

# --- run --------------------------------------------------------------------
chmod +x "$TMP/$ASSET"
say ""

# Reopen stdin on the terminal before handing over.
#
# This matters more than it looks. When this script is run the documented way
# -- `curl -fsSL url | sh` -- the shell's stdin *is* the pipe, and the pipe is
# at end-of-file by the time we get here. nesdoctor inherits that, sees a
# non-terminal stdin, and correctly skips every question. The result is a run
# that completes, looks fine, and answers nothing: the exact failure the whole
# install path exists to avoid, and it would have been invisible in testing
# because running the script from a file works perfectly.
#
# /dev/tty is the controlling terminal regardless of what stdin was piped to.
# Where there is no terminal at all -- CI, a cron job -- the redirect fails and
# we run without it, which is the right behaviour rather than a fallback.
# The probe runs in a subshell on purpose. A failing redirection on `exec` is
# *fatal* to a non-interactive shell rather than merely non-zero, so testing it
# inline killed this script outright on any machine without a controlling
# terminal -- measured, not theorised. The parentheses contain that.
if [ -e /dev/tty ] && (exec 3</dev/tty) 2>/dev/null; then
  exec "$TMP/$ASSET" "$@" < /dev/tty
else
  say "(no terminal available, so the questions will be skipped)"
  exec "$TMP/$ASSET" "$@"
fi
