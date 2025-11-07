#!/bin/bash

export USER=${NESTRI_USER}
export LANG=${NESTRI_LANG}
export HOME=${NESTRI_HOME}
export XDG_RUNTIME_DIR=${NESTRI_XDG_RUNTIME_DIR}
export XDG_SESSION_TYPE=x11
export DISPLAY=:0

# Causes some setups to break
export PROTON_NO_FSYNC=1

# Make gstreamer GL elements work without display output (NVIDIA issue..)
export GST_GL_API=gles2
export GST_GL_WINDOW=surfaceless
