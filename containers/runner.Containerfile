# Container build arguments #
ARG BASE_IMAGE=docker.io/cachyos/cachyos:latest

#******************************************************************************
# Base Builder Stage - Prepares core build environment
#******************************************************************************
FROM ${BASE_IMAGE} AS base-builder

# Environment setup for Rust and Cargo
ENV CARGO_HOME=/usr/local/cargo \
    ARTIFACTS=/artifacts \
    PATH="${CARGO_HOME}/bin:${PATH}" \
    RUSTFLAGS="-C link-arg=-fuse-ld=mold"

# Install build essentials and caching tools
RUN --mount=type=cache,target=/var/cache/pacman/pkg \
    pacman -Sy --noconfirm mold rust && \
    mkdir -p "${ARTIFACTS}"

# Install cargo-chef with proper caching
RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    cargo install -j $(nproc) cargo-chef --locked

#******************************************************************************
# Nestri Server Build Stages
#******************************************************************************
FROM base-builder AS nestri-server-deps
WORKDIR /builder

# Install build dependencies
RUN pacman -Sy --noconfirm meson pkgconf cmake git gcc make \
    gstreamer gst-plugins-base gst-plugins-good gst-plugin-rswebrtc

#--------------------------------------------------------------------
FROM nestri-server-deps AS nestri-server-planner
WORKDIR /builder/nestri
COPY packages/server/Cargo.toml packages/server/Cargo.lock ./

# Prepare recipe for dependency caching
RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    cargo chef prepare --recipe-path recipe.json

#--------------------------------------------------------------------
FROM nestri-server-deps AS nestri-server-cacher
COPY --from=nestri-server-planner /builder/nestri/recipe.json .

ENV CARGO_TARGET_DIR=/builder/target

# Cache dependencies using cargo-chef
RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    --mount=type=cache,target=/builder/target \
    cargo chef cook --release --recipe-path recipe.json

#--------------------------------------------------------------------
FROM nestri-server-deps AS nestri-server-builder
WORKDIR /builder/nestri

ENV CARGO_TARGET_DIR=/builder/target

# Copy cached dependencies and build
COPY --from=nestri-server-cacher ${CARGO_HOME} ${CARGO_HOME}
COPY --from=nestri-server-cacher /builder/target /builder/target
COPY packages/server/ ./packages/server/

# Build and install directly to artifacts
RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    --mount=type=cache,target=/builder/target \
    cargo build --release && \
    cp target/release/nestri-server "${ARTIFACTS}"

#******************************************************************************
# GST-Wayland Plugin Build Stages
#******************************************************************************
FROM base-builder AS gst-wayland-deps
WORKDIR /builder

# Install build dependencies
RUN pacman -Sy --noconfirm meson pkgconf cmake git gcc make \
    libxkbcommon wayland gstreamer gst-plugins-base gst-plugins-good libinput

# Clone repository (layer separated for better cache utilization)
RUN git clone https://github.com/games-on-whales/gst-wayland-display.git

#--------------------------------------------------------------------
FROM gst-wayland-deps AS gst-wayland-planner
WORKDIR /builder/gst-wayland-display

# Prepare recipe for dependency caching
RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    cargo chef prepare --recipe-path recipe.json

#--------------------------------------------------------------------
FROM gst-wayland-deps AS gst-wayland-cacher
COPY --from=gst-wayland-planner /builder/gst-wayland-display/recipe.json .

ENV CARGO_TARGET_DIR=/builder/target

# Cache dependencies using cargo-chef
RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    --mount=type=cache,target=/builder/target \
    cargo chef cook --release --recipe-path recipe.json

#--------------------------------------------------------------------
FROM gst-wayland-deps AS gst-wayland-builder
WORKDIR /builder/gst-wayland-display

ENV CARGO_TARGET_DIR=/builder/target

# Copy cached dependencies and build
COPY --from=gst-wayland-cacher ${CARGO_HOME} ${CARGO_HOME}
COPY --from=gst-wayland-cacher /builder/target /builder/target
COPY . .

# Build and install directly to artifacts
RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    --mount=type=cache,target=/builder/target \
    export CARGO_TARGET_DIR=/builder/target && \
    cargo cinstall --prefix=${ARTIFACTS}/usr --release

#******************************************************************************
# Final Runtime Stage
#******************************************************************************
FROM ${BASE_IMAGE} AS runtime

# ## Install Graphics, Media, and Audio packages ##
# RUN  sed -i '/#\[multilib\]/,/#Include = \/etc\/pacman.d\/mirrorlist/ s/#//' /etc/pacman.conf && \
#     sed -i "s/#Color/Color/" /etc/pacman.conf && \
#     pacman --noconfirm -Syu archlinux-keyring && \
#     dirmngr </dev/null > /dev/null 2>&1 && \
#     # Install mesa-git before Steam for simplicity
#     pacman --noconfirm -Sy mesa && \
#     # Install Steam
#     pacman --noconfirm -Sy steam steam-native-runtime && \
#     # Clean up pacman cache
#     paccache -rk1 && \
#     rm -rf /usr/share/info/* && \
#     rm -rf /usr/share/man/* && \
#     rm -rf /usr/share/doc/
    
# RUN pacman -Sy --noconfirm --needed \
#     # Graphics packages
#     sudo xorg-xwayland labwc wlr-randr mangohud \
#     # GStreamer and plugins
#     gstreamer gst-plugins-base gst-plugins-good \
#     gst-plugins-bad gst-plugin-pipewire \
#     gst-plugin-rswebrtc gst-plugin-rsrtp \
#     # Audio packages
#     pipewire pipewire-pulse pipewire-alsa wireplumber \
#     # Non-latin fonts
#     noto-fonts-cjk \
#     # Other requirements
#     supervisor jq chwd lshw pacman-contrib && \
#     # Clean up pacman cache
#     paccache -rk1 && \
#     rm -rf /usr/share/info/* && \
#     rm -rf /usr/share/man/* && \
#     rm -rf /usr/share/doc/*

# #Install our backup manager
# ARG LUDUSAVI_VERSION="0.28.0"
# RUN pacman -Sy --noconfirm --needed curl &&\
#     curl -fsSL -o ludusavi.tar.gz "https://github.com/mtkennerly/ludusavi/releases/download/v${LUDUSAVI_VERSION}/ludusavi-v${LUDUSAVI_VERSION}-linux.tar.gz" &&\
#     tar -xzvf ludusavi.tar.gz &&\
#     mv ludusavi /usr/bin/ &&\
#     #Clean up
#     rm *.tar.gz

#     # Regenerate locale
# RUN locale-gen

# ## User ##
# # Create and setup user #
# ENV USER="nestri" \
# 	UID=1000 \
# 	GID=1000 \
# 	USER_PWD="nestri1234"

# RUN mkdir -p /home/${USER} && \
#     groupadd -g ${GID} ${USER} && \
#     useradd -d /home/${USER} -u ${UID} -g ${GID} -s /bin/bash ${USER} && \
#     chown -R ${USER}:${USER} /home/${USER} && \
#     echo "${USER} ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers && \
#     echo "${USER}:${USER_PWD}" | chpasswd

# # Run directory #
# RUN mkdir -p /run/user/${UID} && \
# 	chown ${USER}:${USER} /run/user/${UID}

# # Groups #
# RUN usermod -aG input root && usermod -aG input ${USER} && \
#     usermod -aG video root && usermod -aG video ${USER} && \
#     usermod -aG render root && usermod -aG render ${USER} && \
#     usermod -aG seat root && usermod -aG seat ${USER}

# Copy built artifacts from builders
COPY --from=nestri-server-builder /artifacts/nestri-server /usr/bin/
COPY --from=gst-wayland-builder /artifacts/usr/ /usr/

# Verification commands
RUN gst-inspect-1.0 waylanddisplay && \
    which nestri-server

# ## Copy scripts ##
# COPY packages/scripts/ /etc/nestri/
# # Set scripts as executable #
# RUN chmod +x /etc/nestri/envs.sh /etc/nestri/entrypoint.sh /etc/nestri/entrypoint_nestri.sh

# ## Set runtime envs ##
# ENV XDG_RUNTIME_DIR=/run/user/${UID} \
#     HOME=/home/${USER}

# # Required for NVIDIA.. they want to be special like that #
# ENV NVIDIA_DRIVER_CAPABILITIES=all
# ENV NVIDIA_VISIBLE_DEVICES=all

# # DBus run directory creation #
# RUN mkdir -p /run/dbus

# # Wireplumber disable suspend #
# # Remove suspend node
# RUN sed -z -i 's/{[[:space:]]*name = node\/suspend-node\.lua,[[:space:]]*type = script\/lua[[:space:]]*provides = hooks\.node\.suspend[[:space:]]*}[[:space:]]*//g' /usr/share/wireplumber/wireplumber.conf
# # Remove "hooks.node.suspend" want
# RUN sed -i '/wants = \[/{s/hooks\.node\.suspend\s*//; s/,\s*\]/]/}' /usr/share/wireplumber/wireplumber.conf

# ENTRYPOINT ["supervisord", "-c", "/etc/nestri/supervisord.conf"]
