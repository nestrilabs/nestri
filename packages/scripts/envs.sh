#!/bin/bash

export USER=${NESTRI_USER}
export LANG=${NESTRI_LANG}
export HOME=${NESTRI_HOME}
export XDG_RUNTIME_DIR=${NESTRI_XDG_RUNTIME_DIR}

# Causes some setups to break
export PROTON_NO_FSYNC=1

# Make gstreamer GL elements work without display output (NVIDIA issue..)
export GST_GL_API=gles2
export GST_GL_WINDOW=surfaceless

# Gamescope does not respect MangoHud default config location
export MANGOHUD_CONFIGFILE=${NESTRI_HOME}/.config/MangoHud/MangoHud.conf
