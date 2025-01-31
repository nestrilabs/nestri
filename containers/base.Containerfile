# Container build arguments #
ARG BASE_IMAGE=docker.io/cachyos/cachyos:latest

#******************************************************************************
#                                                                                                          nestri-server-builder
#******************************************************************************
FROM ${BASE_IMAGE} AS gst-builder
WORKDIR /builder/

# Grab build and rust packages #
RUN pacman -Sy --noconfirm meson pkgconf cmake git gcc make rustup \
	gstreamer gst-plugins-base gst-plugins-good gst-plugin-rswebrtc

# Setup stable rust toolchain #
RUN rustup default stable

#Copy the whole repo inside the build container
# COPY ./ /builder/nestri/

RUN mkdir -p /artifacts

RUN --mount=type=bind,target=/builder/nestri/,rw \
    --mount=type=cache,target=/builder/nestri/target/   \
    --mount=type=cache,target=/usr/local/cargo/git/db \
    --mount=type=cache,target=/usr/local/cargo/registry/ \
    cd /builder/nestri/packages/server/ \
    && cargo build --release \
    && cp /builder/nestri/target/release/nestri-server /artifacts/

#******************************************************************************
#                                                                                                            gstwayland-builder
#******************************************************************************
# FROM ${BASE_IMAGE} AS gstwayland-builder
# WORKDIR /builder/

# # Grab build and rust packages #
RUN pacman -Sy --noconfirm meson pkgconf cmake git gcc make rustup \
	libxkbcommon wayland gstreamer gst-plugins-base gst-plugins-good libinput

# Setup stable rust toolchain #
# RUN rustup default stable
# Build required cargo-c package #
RUN --mount=type=cache,target=/usr/local/cargo/git/db \
    --mount=type=cache,target=/usr/local/cargo/registry/ \
    --mount=type=cache,target=/root/.cargo/bin/ \
    cargo install cargo-c

# Clone gst plugin source #
RUN git clone https://github.com/games-on-whales/gst-wayland-display.git

# Build gst plugin #
RUN mkdir plugin

RUN mkdir -p /artifacts

WORKDIR /builder/gst-wayland-display

RUN --mount=type=cache,target=/builder/gst-wayland-display/target/  \
    --mount=type=cache,target=/root/.cargo/bin/ \
    --mount=type=cache,target=/builder/plugin/  \
    --mount=type=cache,target=/usr/local/cargo/git/db \
    --mount=type=cache,target=/usr/local/cargo/registry/ \
	cargo cinstall --prefix=/builder/plugin/ \
    && cp -r /builder/plugin/ /artifacts/