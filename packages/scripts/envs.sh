#!/bin/bash
set -euo pipefail

export XDG_RUNTIME_DIR=/run/user/${UID}/
export XDG_SESSION_TYPE=x11
export DISPLAY=:0
export $(dbus-launch)

# Causes some setups to break
export PROTON_NO_FSYNC=1

# Sleeker Mangohud preset :)
export MANGOHUD_CONFIG=preset=2
