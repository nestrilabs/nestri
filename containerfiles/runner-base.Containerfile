# Container build arguments #
ARG BASE_IMAGE=docker.io/cachyos/cachyos:latest

#*******************************************#
# Base Stage - Simple with light essentials #
#*******************************************#
FROM ${BASE_IMAGE} AS bases

# Only lightweight stuff needed by both builder and runtime
RUN --mount=type=cache,target=/var/cache/pacman/pkg \
    pacman -Sy --noconfirm \
        libssh2 curl wget libevdev libc++abi \
        gstreamer gst-plugins-base
