# Container build arguments #
ARG BASE_IMAGE=docker.io/cachyos/cachyos-v3:latest

#******************************************************************************
#                                                                                                          nestri-server-builder
#******************************************************************************
FROM ${BASE_IMAGE} AS gst-builder
WORKDIR /builder/

# Grab build and rust packages #
RUN pacman -Syu --noconfirm meson pkgconf cmake git gcc make rustup \
	gstreamer gst-plugins-base gst-plugins-good gst-plugin-rswebrtc

# Setup stable rust toolchain #
RUN rustup default stable
# # Clone nestri source #
#Copy the whole repo inside the build container
COPY ./ /builder/nestri/

WORKDIR /builder/nestri/packages/server/ 

RUN mkdir -p /artifacts

RUN --mount=type=cache,target=/builder/target/   \
    --mount=type=cache,target=/usr/local/cargo/git/db \
    --mount=type=cache,target=/usr/local/cargo/registry/ \
    cargo build --release && cp /build/target/release/nestri-server /artifacts/

#******************************************************************************
#                                                                                                            gstwayland-builder
#******************************************************************************
FROM ${BASE_IMAGE} AS gstwayland-builder
WORKDIR /builder/

# Grab build and rust packages #
RUN pacman -Syu --noconfirm meson pkgconf cmake git gcc make rustup \
	libxkbcommon wayland gstreamer gst-plugins-base gst-plugins-good libinput

# Setup stable rust toolchain #
RUN rustup default stable
# Build required cargo-c package #
RUN --mount=type=cache,target=/builder/target/   \
    --mount=type=cache,target=/usr/local/cargo/git/db \
    --mount=type=cache,target=/usr/local/cargo/registry/ \
    cargo install cargo-c

# Clone gst plugin source #
RUN git clone https://github.com/games-on-whales/gst-wayland-display.git

# Build gst plugin #
RUN mkdir plugin

RUN mkdir -p /artifacts

WORKDIR /builder/gst-wayland-display

RUN --mount=type=cache,target=/builder/target/  \
    --mount=type=cache,target=/builder/plugin/  \
    --mount=type=cache,target=/usr/local/cargo/git/db \
    --mount=type=cache,target=/usr/local/cargo/registry/ \
	cargo cinstall --prefix=/builder/plugin/ && cp -r /builder/plugin/ /artifacts/

#******************************************************************************
#                                                                                                                             runtime
#******************************************************************************
FROM ${BASE_IMAGE} AS runtime

## Install Graphics, Media, and Audio packages ##
RUN pacman -Syu --noconfirm --needed \
    # Graphics packages
    sudo xorg-xwayland labwc wlr-randr mangohud \
    # GStreamer and plugins
    gstreamer gst-plugins-base gst-plugins-good \
    gst-plugins-bad gst-plugin-pipewire \
    gst-plugin-rswebrtc gst-plugin-rsrtp \
    # Audio packages
    pipewire pipewire-pulse pipewire-alsa wireplumber \
    # Other requirements
    supervisor jq chwd lshw pacman-contrib && \
    # Clean up pacman cache
    paccache -rk1

## User ##
# Create and setup user #
ENV USER="nestri" \
	UID=99 \
	GID=100 \
	USER_PWD="nestri1234"

RUN mkdir -p /home/${USER} && \
    groupadd -g ${GID} ${USER} && \
    useradd -d /home/${USER} -u ${UID} -g ${GID} -s /bin/bash ${USER} && \
    chown -R ${USER}:${USER} /home/${USER} && \
    echo "${USER} ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers && \
    echo "${USER}:${USER_PWD}" | chpasswd

# Run directory #
RUN mkdir -p /run/user/${UID} && \
	chown ${USER}:${USER} /run/user/${UID}

# Groups #
RUN usermod -aG input root && usermod -aG input ${USER} && \
    usermod -aG video root && usermod -aG video ${USER} && \
    usermod -aG render root && usermod -aG render ${USER}

## Copy files from builders ##
# this is done here at end to not trigger full rebuild on changes to builder
# nestri
COPY --from=gst-builder /artifacts/nestri-server /usr/bin/nestri-server
# gstwayland
COPY --from=gstwayland-builder /artifacts/plugin/include/libgstwaylanddisplay /usr/include/
COPY --from=gstwayland-builder /artifacts/plugin/lib/*libgstwayland* /usr/lib/
COPY --from=gstwayland-builder /artifacts/plugin/lib/gstreamer-1.0/libgstwayland* /usr/lib/gstreamer-1.0/
COPY --from=gstwayland-builder /artifacts/plugin/lib/pkgconfig/gstwayland* /usr/lib/pkgconfig/
COPY --from=gstwayland-builder /artifacts/plugin/lib/pkgconfig/libgstwayland* /usr/lib/pkgconfig/

## Copy scripts ##
COPY packages/scripts/ /etc/nestri/
# Set scripts as executable #
RUN chmod +x /etc/nestri/envs.sh /etc/nestri/entrypoint.sh /etc/nestri/entrypoint_nestri.sh

## Set runtime envs ##
ENV XDG_RUNTIME_DIR=/run/user/${UID} \
    HOME=/home/${USER}

# Required for NVIDIA.. they want to be special like that #
ENV NVIDIA_DRIVER_CAPABILITIES=all

# Wireplumber disable suspend #
# Remove suspend node
RUN sed -z -i 's/{[[:space:]]*name = node\/suspend-node\.lua,[[:space:]]*type = script\/lua[[:space:]]*provides = hooks\.node\.suspend[[:space:]]*}[[:space:]]*//g' /usr/share/wireplumber/wireplumber.conf
# Remove "hooks.node.suspend" want
RUN sed -i '/wants = \[/{s/hooks\.node\.suspend\s*//; s/,\s*\]/]/}' /usr/share/wireplumber/wireplumber.conf

ENTRYPOINT ["supervisord", "-c", "/etc/nestri/supervisord.conf"]