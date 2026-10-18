#!/usr/bin/env sh
# Nestri host installer — https://api.nestri.io/install.sh
#
# This file is the source of what that URL serves, kept in the public
# repository so anyone about to pipe it into a shell can read it first.
#
#   bash <(curl -fsSL https://api.nestri.io/install.sh)
#   bash <(curl -fsSL https://api.nestri.io/install.sh) <install-token>
#   bash <(curl -fsSL https://api.nestri.io/install.sh) -u
#
# Piping it works the same way: `curl -fsSL … | sh -s -- -u`.
#
# What it does, in order: check this is 64-bit Linux, ask where box images
# should live, download the host agent for this platform, verify it against the
# published SHA256SUMS, install it to /usr/local/bin, and hand over to the
# agent's own onboarding, which checks the machine, registers it and starts the
# agent as a systemd service.
#
# It runs as root because the agent does: each box's VMM is jailed under a uid
# of its own, which only root can give it, and a box's network needs
# CAP_NET_ADMIN. The agent keeps its state in /var/lib/nestri. Started as
# anyone else, it asks sudo for root once, before it changes anything.
#
# The token is optional. Without one, the agent signs in instead: it shows a
# code and a link, and the machine is registered once somebody approves that
# code in a browser, on any device. A token from the dashboard's Installation
# page skips the browser; it registers one machine, works once and lapses after
# an hour.
#
# `-u` (`--update`) registers nothing: on a machine that is already a host, it installs
# the current agent and restarts it, and the agent picks up whatever a new
# release changed about its images on its own. It touches nothing else -- the
# machine keeps its registration, its box store and its Steam sign-ins.

set -eu

API="${NESTRI_API:-https://api.nestri.io}"
# Pinned, not "latest", so the script and the binary it installs are a pair
# somebody chose. Bump when cutting a release; NESTRI_HOST_VERSION overrides it.
DEFAULT_VERSION="0.2.21"
VERSION="${NESTRI_HOST_VERSION:-$DEFAULT_VERSION}"
BIN_DIR="${NESTRI_BIN_DIR:-/usr/local/bin}"
STATE_DIR=/var/lib/nestri

say() { printf '%s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

usage() {
  cat >&2 <<USAGE
Nestri host installer.

  bash <(curl -fsSL $API/install.sh)                   make this machine a host, approving it in a browser
  bash <(curl -fsSL $API/install.sh) <install-token>   make this machine a host with a token from the dashboard
  bash <(curl -fsSL $API/install.sh) -u                update the host agent here

  -u, --update   install the current host agent on a machine that is already a host
  -h, --help     this
USAGE
}

MODE=install
TOKEN="${NESTRI_INSTALL_TOKEN:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    -u|--update) MODE=update ;;
    -h|--help) usage; exit 0 ;;
    --) ;;
    -*) usage; die "unknown option $1" ;;
    *) TOKEN="$1" ;;
  esac
  shift
done
# --- fetch ------------------------------------------------------------------
if command -v curl >/dev/null 2>&1; then
  get() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  get() { wget -qO "$2" "$1"; }
else
  die "need curl or wget"
fi

# --- platform ---------------------------------------------------------------
[ "$(uname -s)" = Linux ] || die "a host has to run Linux (with KVM); this is $(uname -s)."
case "$(uname -m)" in
  x86_64|amd64) target=x86_64-unknown-linux-gnu ;;
  *) die "no host build for $(uname -m) yet." ;;
esac
# --- root ------------------------------------------------------------------
# Asked for once, here, before anything changes. A script read from a pipe or
# from `bash <(curl …)` has no file sudo could run again -- the descriptor it
# came on is this shell's, and sudo starts a fresh one -- so this fetches the
# same script to a private file and runs that as root, with the same mode and
# token. Only the settings somebody actually set are carried across.
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || die "this needs root and there is no sudo here. Run it as root."
  self="$(mktemp)"
  get "$API/install.sh" "$self" || die "could not fetch $API/install.sh to run it as root"
  if [ "$MODE" = update ]; then set -- -u
  elif [ -n "$TOKEN" ]; then set -- "$TOKEN"
  else set --; fi
  say "The host agent runs as root, so this needs sudo."
  exec sudo env NESTRI_SELF="$self" NESTRI_API="$API" \
    ${NESTRI_HOST_VERSION:+NESTRI_HOST_VERSION="$NESTRI_HOST_VERSION"} \
    ${NESTRI_BIN_DIR:+NESTRI_BIN_DIR="$NESTRI_BIN_DIR"} \
    ${NESTRI_BOX_STORE:+NESTRI_BOX_STORE="$NESTRI_BOX_STORE"} \
    sh "$self" "$@"
fi
# The copy fetched above, now open as this shell's script: removing the name
# leaves what is being read intact and leaves nothing behind.
if [ -n "${NESTRI_SELF:-}" ]; then rm -f "$NESTRI_SELF"; fi

# --- update: only where there is something to update -------------------------
# Checked before anything is downloaded, so a mistaken run costs nothing.
if [ "$MODE" = update ]; then
  # Registered means the agent has a machine identity. Without one there is
  # nothing to update, and installing would need the token this skips.
  [ -f "$STATE_DIR/machine.json" ] || die "this machine is not a Nestri host yet, so there is nothing to update. Install it with the command from the dashboard's Installation page."
  # Updating restarts the agent, and the agent stopping stops every box. A
  # session somebody is playing would end in the middle, so wait for it.
  if pgrep -x nesbox >/dev/null 2>&1; then
    die "a box is running on this machine right now, and updating would stop it. Run this again when nobody is playing."
  fi
  current="$("$BIN_DIR/nestri-host" --version 2>/dev/null | awk '{print $NF}')" || current=""
  if [ "$current" = "$VERSION" ]; then
    say "The host agent is already $VERSION. Nothing to do."
    exit 0
  fi
  say "Updating the host agent from ${current:-an unknown version} to $VERSION…"
fi

# --- an install from before the agent ran as root ---------------------------
# Hosts used to run the agent as the user who installed it, from a state
# directory in their home and a user unit. That user is the one sudo was run by. Their state is copied,
# never moved: the machine keeps its identity and what it already downloaded,
# and the old directory stays as it was.
OLD_HOME=""
if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then
  OLD_HOME="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
fi
OLD_STATE="${OLD_HOME:+$OLD_HOME/.nestri}"
if [ -n "$OLD_STATE" ] && [ -f "$OLD_STATE"/onboarding.json ] && [ ! -e "$STATE_DIR" ]; then
  say "Moving this host's agent from $SUDO_USER to a system service…"
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user -M "$SUDO_USER@" disable --now nestri-host.service >/dev/null 2>&1 || true
  fi
  mkdir -p "$(dirname "$STATE_DIR")"
  cp -a "$OLD_STATE" "$STATE_DIR"
  # The box store that install was given, unless this run names another.
  if [ -z "${NESTRI_BOX_STORE:-}" ] && [ -f "$OLD_HOME/.config/nestri-host/env" ]; then
    NESTRI_BOX_STORE="$(sed -n 's/^NESLET_BOX_STORE=//p' "$OLD_HOME/.config/nestri-host/env" | head -n1)"
  fi
  say "Copied $OLD_STATE to $STATE_DIR."
fi

# --- where box images go ----------------------------------------------------
# Their own device, xfs or ext4, and never `/`: box images are large, and a
# filled root filesystem takes the whole machine down with it. The agent's
# preflight checks this again; asking here is so the default is a good guess.
# An update keeps the store the machine already has, so it is not asked.
tty_ok() { [ -e /dev/tty ] && (exec 3</dev/tty) 2>/dev/null; }
BOX_STORE="${NESTRI_BOX_STORE:-}"
if [ "$MODE" = install ] && [ -z "$BOX_STORE" ]; then
  guess="$(df -P -T -x tmpfs -x devtmpfs -x overlay 2>/dev/null \
    | awk 'NR>1 && ($2=="xfs"||$2=="ext4") && $7!="/" && $7!~/^\/(boot|efi)/ {print $5, $7}' \
    | sort -rn | awk 'NR==1 {print $2}')"
  default="${guess:+$guess/nestri}"
  if tty_ok; then
    printf 'Where should box images go? (xfs or ext4, not /) [%s]: ' "${default:-none found}" >&2
    read -r answer </dev/tty || answer=""
    BOX_STORE="${answer:-$default}"
  else
    BOX_STORE="$default"
  fi
  [ -n "$BOX_STORE" ] || die "no xfs or ext4 filesystem besides / was found. Mount one, or set NESTRI_BOX_STORE."
fi

# --- download and verify ----------------------------------------------------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM
ASSET="nestri-host-$target"
BASE="$API/install/host/$VERSION"

say "Downloading the host agent $VERSION ($target)…"
get "$BASE/$ASSET" "$TMP/$ASSET" || die "download failed: $BASE/$ASSET"

# A checksum fetched from the same place as the binary is not a security
# boundary. It catches a truncated or corrupted download, which is the failure
# that actually happens; the download itself is over TLS from our API.
get "$BASE/SHA256SUMS" "$TMP/SHA256SUMS" || die "no SHA256SUMS for $VERSION"
want="$(grep -F "  $ASSET" "$TMP/SHA256SUMS" | cut -d' ' -f1 | head -n1)"
[ -n "$want" ] || die "no checksum for $ASSET in SHA256SUMS"
if command -v sha256sum >/dev/null 2>&1; then
  have="$(sha256sum "$TMP/$ASSET" | cut -d' ' -f1)"
else
  have="$(shasum -a 256 "$TMP/$ASSET" | cut -d' ' -f1)"
fi
[ "$have" = "$want" ] || die "checksum mismatch — not installing
  expected $want
  got      $have"
say "Checksum OK."

mkdir -p "$BIN_DIR"
chmod +x "$TMP/$ASSET"
mv "$TMP/$ASSET" "$BIN_DIR/nestri-host"
say "Installed $BIN_DIR/nestri-host"
say ""

# --- update: restart on the new binary, and stop -----------------------------
# No onboarding: the machine is registered and configured already. The agent
# reads what its new release needs when it starts -- a raised image layout
# makes it pull the guest and its jail again -- so restarting is the whole of
# it.
if [ "$MODE" = update ]; then
  systemctl restart nestri-host.service || die "the new agent is installed, but restarting nestri-host failed. See: journalctl -u nestri-host"
  say "Updated to $("$BIN_DIR/nestri-host" --version 2>/dev/null | awk '{print $NF}'). If this release changed the box images, the agent is downloading them now:"
  say "  journalctl -fu nestri-host"
  exit 0
fi

# --- upgrade ----------------------------------------------------------------
# On a host that already runs the agent, this is an upgrade: the agent holds
# the host lock, and onboarding refuses to race it. Stopped here, and started
# again by onboarding on the new binary. A host with nothing running is
# unaffected.
if command -v systemctl >/dev/null 2>&1 &&
  systemctl is-active --quiet nestri-host.service 2>/dev/null; then
  say "Stopping the running host agent to upgrade it…"
  systemctl stop nestri-host.service
fi

# --- onboard ----------------------------------------------------------------
# The token goes through the environment rather than argv, so it is not in
# `ps` for the length of the run. With none, it is left out altogether, and
# onboarding signs in through the browser instead.
if [ -n "$TOKEN" ]; then
  export NESTRI_INSTALL_TOKEN="$TOKEN"
else
  unset NESTRI_INSTALL_TOKEN
fi
export NESTRI_BOX_STORE="$BOX_STORE" NESTRI_API="$API" NESLET_STATE_DIR="$STATE_DIR"
if tty_ok; then
  exec "$BIN_DIR/nestri-host" onboard </dev/tty
else
  exec "$BIN_DIR/nestri-host" onboard
fi
