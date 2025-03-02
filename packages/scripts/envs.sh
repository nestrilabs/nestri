#!/bin/bash
set -euo pipefail

export XDG_RUNTIME_DIR=/run/user/${UID}/
export WAYLAND_DISPLAY=wayland-0
export XDG_SESSION_TYPE=wayland
export DISPLAY=:0
export $(dbus-launch)

# Our preferred prefix
export WINEPREFIX=/home/${USER}/.nestripfx/
