#!/bin/bash

export USER=${NESTRI_USER}
export LANG=${NESTRI_LANG}
export HOME=${NESTRI_HOME}
export XDG_RUNTIME_DIR=${NESTRI_XDG_RUNTIME_DIR}

# Causes some setups to break
export PROTON_NO_FSYNC=1

# Skip first core automatically, to allow nestri-server to work as best as it can
export PROTON_CPU_TOPOLOGY=$(nproc | awk '{print $1-1 ":"}')$({ seq 1 $(($(nproc) - 1)) | paste -sd, -; })
export WINE_CPU_TOPOLOGY=$(nproc | awk '{print $1-1 ":"}')$({ seq 1 $(($(nproc) - 1)) | paste -sd, -; })

# Make gstreamer GL elements work without display output (NVIDIA issue..)
export GST_GL_API=gles2
export GST_GL_WINDOW=surfaceless

# Gamescope does not respect MangoHud default config location
export MANGOHUD_CONFIGFILE=/etc/nestri/configs/MangoHud/MangoHud.conf
