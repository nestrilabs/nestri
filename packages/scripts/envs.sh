#!/bin/bash

export XDG_RUNTIME_DIR=/run/user/${UID}/
export XDG_SESSION_TYPE=x11
export DISPLAY=:0
export $(dbus-launch)

# Causes some setups to break
export PROTON_NO_FSYNC=1

# Sleeker Mangohud preset :)
export MANGOHUD_CONFIG=preset=2

# Make gstreamer GL elements work without display output (NVIDIA issue..)
export GST_GL_API=gles2
export GST_GL_WINDOW=surfaceless
