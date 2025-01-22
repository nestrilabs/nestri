# Container build arguments #
ARG BASE_IMAGE=docker.io/cachyos/cachyos-v3:latest

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
FROM ${BASE_IMAGE} AS gstwayland-builder
WORKDIR /builder/

# Grab build and rust packages #
RUN pacman -Sy --noconfirm meson pkgconf cmake git gcc make rustup \
	libxkbcommon wayland gstreamer gst-plugins-base gst-plugins-good libinput

# Setup stable rust toolchain #
RUN rustup default stable
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

#******************************************************************************
#                                                                                                                             runtime
#******************************************************************************
FROM ${BASE_IMAGE} AS runtime

## Install Graphics, Media, and Audio packages ##
RUN  sed -i '/#\[multilib\]/,/#Include = \/etc\/pacman.d\/mirrorlist/ s/#//' /etc/pacman.conf && \
    sed -i "s/#Color/Color/" /etc/pacman.conf && \
    pacman --noconfirm -Sy archlinux-keyring && \
    dirmngr </dev/null > /dev/null 2>&1 && \
    # Install mesa-git before Steam for simplicity
    pacman --noconfirm -Sy mesa-git && \
    # Install Steam
    pacman --noconfirm -Sy steam steam-native-runtime && \
    pacman -Sy --noconfirm --needed \
    # Graphics packages
    sudo xorg-xwayland labwc wlr-randr mangohud \
    # GStreamer and plugins
    gstreamer gst-plugins-base gst-plugins-good \
    gst-plugins-bad gst-plugin-pipewire \
    gst-plugin-rswebrtc gst-plugin-rsrtp \
    # Audio packages
    pipewire pipewire-pulse pipewire-alsa wireplumber \
    # Non-latin fonts
    noto-fonts-cjk \
    # Other requirements
    supervisor jq chwd lshw pacman-contrib && \
    # Clean up pacman cache
    paccache -rk1 && \
    rm -rf /usr/share/info/* && \
    rm -rf /usr/share/man/* && \
    rm -rf /usr/share/doc/*


# Regenerate locale
RUN locale-gen

## User ##
# Create and setup user #
ENV USER="nestri" \
	UID=1000 \
	GID=1000 \
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
    usermod -aG render root && usermod -aG render ${USER} && \
    usermod -aG seat root && usermod -aG seat ${USER}

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

# DBus run directory creation #
RUN mkdir -p /run/dbus

# Wireplumber disable suspend #
# Remove suspend node
RUN sed -z -i 's/{[[:space:]]*name = node\/suspend-node\.lua,[[:space:]]*type = script\/lua[[:space:]]*provides = hooks\.node\.suspend[[:space:]]*}[[:space:]]*//g' /usr/share/wireplumber/wireplumber.conf
# Remove "hooks.node.suspend" want
RUN sed -i '/wants = \[/{s/hooks\.node\.suspend\s*//; s/,\s*\]/]/}' /usr/share/wireplumber/wireplumber.conf

ENTRYPOINT ["supervisord", "-c", "/etc/nestri/supervisord.conf"]
