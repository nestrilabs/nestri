# Container build arguments #
ARG BASE_IMAGE=docker.io/cachyos/cachyos:latest

#******************************************************************************
#                                                                                                          nestri-server-builder
#******************************************************************************
FROM ${BASE_IMAGE} AS gst-builder
WORKDIR /builder/

# Install system dependencies first (layer caching)
RUN pacman -Sy --noconfirm meson pkgconf cmake git gcc make rustup \
    gstreamer gst-plugins-base gst-plugins-good gst-plugin-rswebrtc && \
    rustup default stable && \
    cargo install sccache

# Cache dependencies using cargo-chef
FROM gst-builder AS planner
WORKDIR /builder/nestri/
COPY packages/server/Cargo.toml packages/server/Cargo.lock ./
RUN cargo install cargo-chef && \
    cargo chef prepare --recipe-path recipe.json

# Build stage with cached dependencies
FROM gst-builder AS builder
WORKDIR /builder/nestri/
COPY --from=planner /builder/nestri/recipe.json recipe.json
RUN --mount=type=cache,target=/usr/local/cargo/git/db \
    --mount=type=cache,target=/usr/local/cargo/registry/ \
    --mount=type=cache,target=/root/.cache/sccache \
    cargo chef cook --release --recipe-path recipe.json

# Copy source and build
COPY packages/server/ ./packages/server/
RUN --mount=type=cache,target=/usr/local/cargo/git/db \
    --mount=type=cache,target=/usr/local/cargo/registry/ \
    --mount=type=cache,target=/root/.cache/sccache \
    --mount=type=cache,target=/builder/nestri/target/ \
    export RUSTC_WRAPPER=sccache && \
    export SCCACHE_DIR=/root/.cache/sccache && \
    cargo build --release && \
    cp target/release/nestri-server /artifacts/

#******************************************************************************
#                                                                                                            gstwayland-builder
#******************************************************************************
FROM ${BASE_IMAGE} AS gstwayland-builder
WORKDIR /builder/

RUN pacman -Sy --noconfirm meson pkgconf cmake git gcc make rustup \
    libxkbcommon wayland gstreamer gst-plugins-base gst-plugins-good libinput && \
    rustup default stable && \
    cargo install sccache cargo-c

# Clone and build gst-wayland-display with caching
RUN --mount=type=cache,target=/root/.cache/sccache \
    --mount=type=cache,target=/usr/local/cargo/registry/ \
    --mount=type=cache,target=/usr/local/cargo/git/db \
    git clone https://github.com/games-on-whales/gst-wayland-display.git && \
    cd gst-wayland-display && \
    export RUSTC_WRAPPER=sccache && \
    cargo cinstall --prefix=/builder/plugin/ --release && \
    cp -r /builder/plugin/ /artifacts/

#******************************************************************************
#                                                                                                                             runtime
#******************************************************************************
FROM ${BASE_IMAGE} AS runtime

## Install Graphics, Media, and Audio packages ##
RUN  sed -i '/#\[multilib\]/,/#Include = \/etc\/pacman.d\/mirrorlist/ s/#//' /etc/pacman.conf && \
    sed -i "s/#Color/Color/" /etc/pacman.conf && \
    pacman --noconfirm -Syu archlinux-keyring && \
    dirmngr </dev/null > /dev/null 2>&1 && \
    # Install mesa-git before Steam for simplicity
    pacman --noconfirm -Sy mesa && \
    # Install Steam
    pacman --noconfirm -Sy steam steam-native-runtime && \
    # Clean up pacman cache
    paccache -rk1 && \
    rm -rf /usr/share/info/* && \
    rm -rf /usr/share/man/* && \
    rm -rf /usr/share/doc/
    
RUN pacman -Sy --noconfirm --needed \
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

#Install our backup manager
ARG LUDUSAVI_VERSION="0.28.0"
RUN pacman -Sy --noconfirm --needed wget &&\
    wget "https://github.com/mtkennerly/ludusavi/releases/download/v${LUDUSAVI_VERSION}/ludusavi-v${LUDUSAVI_VERSION}-linux.tar.gz" -O "ludusavi.tar.gz" &&\
    tar -xzvf ludusavi.tar.gz &&\
    mv ludusavi /usr/bin/ &&\
    #Clean up
    rm *.tar.gz

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
ENV NVIDIA_VISIBLE_DEVICES=all

# DBus run directory creation #
RUN mkdir -p /run/dbus

# Wireplumber disable suspend #
# Remove suspend node
RUN sed -z -i 's/{[[:space:]]*name = node\/suspend-node\.lua,[[:space:]]*type = script\/lua[[:space:]]*provides = hooks\.node\.suspend[[:space:]]*}[[:space:]]*//g' /usr/share/wireplumber/wireplumber.conf
# Remove "hooks.node.suspend" want
RUN sed -i '/wants = \[/{s/hooks\.node\.suspend\s*//; s/,\s*\]/]/}' /usr/share/wireplumber/wireplumber.conf

ENTRYPOINT ["supervisord", "-c", "/etc/nestri/supervisord.conf"]
