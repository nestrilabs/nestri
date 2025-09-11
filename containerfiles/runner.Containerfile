# Container build arguments #
ARG BASE_IMAGE=docker.io/cachyos/cachyos:latest

#******************************************************************************
# Base Stage - Updates system packages
#******************************************************************************
FROM ${BASE_IMAGE} AS base

RUN --mount=type=cache,target=/var/cache/pacman/pkg \
    pacman --noconfirm -Syu

#******************************************************************************
# Base Builder Stage - Prepares core build environment
#******************************************************************************
FROM base AS base-builder

# Environment setup for Rust and Cargo
ENV CARGO_HOME=/usr/local/cargo \
    ARTIFACTS=/artifacts \
    PATH="${CARGO_HOME}/bin:${PATH}" \
    RUSTFLAGS="-C link-arg=-fuse-ld=mold"

# Install build essentials and caching tools
RUN --mount=type=cache,target=/var/cache/pacman/pkg \
    pacman -Sy --noconfirm mold rustup && \
    mkdir -p "${ARTIFACTS}"

# Install latest Rust using rustup
RUN rustup default stable

# Install cargo-chef with proper caching
RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    cargo install -j $(nproc) cargo-chef cargo-c --locked

#******************************************************************************
# Nestri Server Build Stages
#******************************************************************************
FROM base-builder AS nestri-server-deps
WORKDIR /builder

# Install build dependencies
RUN --mount=type=cache,target=/var/cache/pacman/pkg \
    pacman -Sy --noconfirm meson pkgconf cmake git gcc make \
    gstreamer gst-plugins-base gst-plugins-good gst-plugin-rswebrtc

#--------------------------------------------------------------------
FROM nestri-server-deps AS nestri-server-planner
WORKDIR /builder/nestri

COPY packages/server/Cargo.toml packages/server/Cargo.lock ./

# Prepare recipe for dependency caching
RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    cargo chef prepare --recipe-path recipe.json

#--------------------------------------------------------------------
FROM nestri-server-deps AS nestri-server-cached-builder
WORKDIR /builder/nestri

COPY --from=nestri-server-planner /builder/nestri/recipe.json .

# Cache dependencies using cargo-chef
RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    cargo chef cook --release --recipe-path recipe.json


ENV CARGO_TARGET_DIR=/builder/target

COPY packages/server/ ./

# Build and install directly to artifacts
RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    --mount=type=cache,target=/builder/target \
    cargo build --release && \
    cp "${CARGO_TARGET_DIR}/release/nestri-server" "${ARTIFACTS}"

#******************************************************************************
# GST-Wayland Plugin Build Stages
#******************************************************************************
FROM base-builder AS gst-wayland-deps
WORKDIR /builder

# Install build dependencies
RUN --mount=type=cache,target=/var/cache/pacman/pkg \
    pacman -Sy --noconfirm meson pkgconf cmake git gcc make \
    libxkbcommon wayland gstreamer gst-plugins-base gst-plugins-good libinput

# Clone repository
RUN git clone --depth 1 -b "stable" https://github.com/games-on-whales/gst-wayland-display.git

#--------------------------------------------------------------------
FROM gst-wayland-deps AS gst-wayland-planner
WORKDIR /builder/gst-wayland-display

# Prepare recipe for dependency caching
RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    cargo chef prepare --recipe-path recipe.json

#--------------------------------------------------------------------
FROM gst-wayland-deps AS gst-wayland-cached-builder
WORKDIR /builder/gst-wayland-display

COPY --from=gst-wayland-planner /builder/gst-wayland-display/recipe.json .

# Cache dependencies using cargo-chef
RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    cargo chef cook --release --recipe-path recipe.json


ENV CARGO_TARGET_DIR=/builder/target

COPY --from=gst-wayland-planner /builder/gst-wayland-display/ .

# Build and install directly to artifacts
RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    --mount=type=cache,target=/builder/target \
    cargo cinstall --prefix=${ARTIFACTS} --release

#******************************************************************************
# Final Runtime Stage
#******************************************************************************
FROM base AS runtime

### Package Installation ###
# Core system components
RUN --mount=type=cache,target=/var/cache/pacman/pkg \
    pacman -Sy --needed --noconfirm \
        vulkan-intel lib32-vulkan-intel vpl-gpu-rt \
        vulkan-radeon lib32-vulkan-radeon \
        mesa steam-native-runtime proton-cachyos lib32-mesa \
        steam gtk3 lib32-gtk3 \
        sudo xorg-xwayland seatd libinput gamescope mangohud wlr-randr \
        libssh2 curl wget \
        pipewire pipewire-pulse pipewire-alsa wireplumber \
        noto-fonts-cjk supervisor jq chwd lshw pacman-contrib \
        hwdata openssh \
    # GStreamer stack
        gstreamer gst-plugins-base gst-plugins-good \
        gst-plugins-bad gst-plugin-pipewire \
        gst-plugin-webrtchttp gst-plugin-rswebrtc gst-plugin-rsrtp \
        gst-plugin-va gst-plugin-qsv \
    # lib32 GStreamer stack to fix some games with videos
        lib32-gstreamer lib32-gst-plugins-base lib32-gst-plugins-good && \
    # Cleanup
    paccache -rk1 && \
    rm -rf /usr/share/{info,man,doc}/*

### User Configuration ###
ARG NESTRI_USER_PWD=""
ENV NESTRI_USER="nestri" \
    NESTRI_UID=1000 \
    NESTRI_GID=1000 \
    NESTRI_LANG=en_US.UTF-8 \
    NESTRI_XDG_RUNTIME_DIR=/run/user/1000 \
    NESTRI_HOME=/home/nestri \
    NVIDIA_DRIVER_CAPABILITIES=all

RUN mkdir -p /home/${NESTRI_USER} && \
    groupadd -g ${NESTRI_GID} ${NESTRI_USER} && \
    useradd -d /home/${NESTRI_USER} -u ${NESTRI_UID} -g ${NESTRI_GID} -s /bin/bash ${NESTRI_USER} && \
    chown -R ${NESTRI_USER}:${NESTRI_USER} /home/${NESTRI_USER} && \
    echo "${NESTRI_USER} ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers && \
    NESTRI_USER_PWD="${NESTRI_USER_PWD:-$(openssl rand -base64 12)}" && \
    echo "Setting password for ${NESTRI_USER} as: ${NESTRI_USER_PWD}" && \
    echo "${NESTRI_USER}:${NESTRI_USER_PWD}" | chpasswd && \
    mkdir -p ${NESTRI_XDG_RUNTIME_DIR} && \
    chown ${NESTRI_USER} ${NESTRI_XDG_RUNTIME_DIR} && \
    usermod -aG input,video,render,seat ${NESTRI_USER}

### System Services Configuration ###
RUN mkdir -p /run/dbus && \
    # Wireplumber suspend disable
    sed -i -z \
        -e 's/{[[:space:]]*name = node\/suspend-node\.lua,[[:space:]]*type = script\/lua[[:space:]]*provides = hooks\.node\.suspend[[:space:]]*}[[:space:]]*//g' \
        -e '/wants = \[/{s/hooks\.node\.suspend\s*//; s/,\s*\]/]/}' \
        /usr/share/wireplumber/wireplumber.conf

### PipeWire Latency Optimizations (1-5ms instead of 20ms) ###
RUN mkdir -p /etc/pipewire/pipewire.conf.d && \
    echo "[audio]\
    \n  default.clock.rate = 48000\
    \n  default.clock.quantum = 128\
    \n  default.clock.min-quantum = 128\
    \n  default.clock.max-quantum = 256" > /etc/pipewire/pipewire.conf.d/low-latency.conf && \
    mkdir -p /etc/wireplumber/wireplumber.conf.d && \
    echo '{\
    \n"wireplumber.rules": [\
    \n    {\
    \n      "matches": [\
    \n        {\
    \n          "node.name": "matches",\
    \n          "value": ".*"\
    \n        }\
    \n      ],\
    \n      "apply_properties": {\
    \n        "audio.format": "S16LE",\
    \n        "audio.rate": 48000,\
    \n        "audio.channels": 2,\
    \n        "api.alsa.period-size": 128,\
    \n        "api.alsa.headroom": 0,\
    \n        "session.suspend-timeout-seconds": 0\
    \n      }\
    \n    }\
    \n  ]\
    \n}' > /etc/wireplumber/wireplumber.conf.d/nestri-low-latency.conf && \
    echo "default-fragments = 2\
    \ndefault-fragment-size-msec = 2" >> /etc/pulse/daemon.conf && \
    echo "load-module module-loopback latency_msec=1" >> /etc/pipewire/pipewire.conf.d/loopback.conf


### Artifacts and Verification ###
COPY --from=nestri-server-cached-builder /artifacts/nestri-server /usr/bin/
COPY --from=gst-wayland-cached-builder /artifacts/lib/ /usr/lib/
COPY --from=gst-wayland-cached-builder /artifacts/include/ /usr/include/
RUN which nestri-server && ls -la /usr/lib/ | grep 'gstwaylanddisplay'

### Scripts and Final Configuration ###
COPY packages/scripts/ /etc/nestri/
RUN chmod +x /etc/nestri/{envs.sh,entrypoint*.sh} && \
    LANG=en_US.UTF-8 locale-gen

# Root for most container engines, apptainer uses nestri user but it works for some reason *shrug*
USER root
ENTRYPOINT ["supervisord", "-c", "/etc/nestri/supervisord.conf"]
