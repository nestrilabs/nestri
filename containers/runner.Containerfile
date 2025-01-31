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
    cargo install -j $(nproc) cargo-chef cargo-c --locked

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
FROM nestri-server-deps AS nestri-server-cached-builder
WORKDIR /builder/nestri

COPY --from=nestri-server-planner /builder/nestri/recipe.json .

# Cache dependencies using cargo-chef
RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    cargo chef cook --release --recipe-path recipe.json


ENV CARGO_TARGET_DIR=/builder/target

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
RUN --mount=type=cache,target=/var/cache/pacman/pkg \
    pacman -Sy --noconfirm meson pkgconf cmake git gcc make \
    libxkbcommon wayland gstreamer gst-plugins-base gst-plugins-good libinput

# Clone repository with proper directory structure
RUN git clone https://github.com/games-on-whales/gst-wayland-display.git

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

COPY . .

# Build and install directly to artifacts
RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    --mount=type=cache,target=/builder/target \
    cargo cinstall --prefix=${ARTIFACTS}/usr --release

#******************************************************************************
# Final Runtime Stage
#******************************************************************************
FROM ${BASE_IMAGE} AS runtime

### System Configuration ###
RUN sed -i \
    -e '/#\[multilib\]/,/#Include = \/etc\/pacman.d\/mirrorlist/ s/#//' \
    -e "s/#Color/Color/" /etc/pacman.conf && \
    pacman --noconfirm -Sy archlinux-keyring && \
    dirmngr </dev/null > /dev/null 2>&1

### Package Installation ###
RUN pacman --noconfirm -Sy && \
    # Core system components
    pacman -S --needed --noconfirm \
        archlinux-keyring mesa steam steam-native-runtime \
        sudo xorg-xwayland labwc wlr-randr mangohud \
        pipewire pipewire-pulse pipewire-alsa wireplumber \
        noto-fonts-cjk supervisor jq chwd lshw pacman-contrib && \
    # GStreamer stack
    pacman -S --needed --noconfirm \
        gstreamer gst-plugins-base gst-plugins-good \
        gst-plugins-bad gst-plugin-pipewire \
        gst-plugin-rswebrtc gst-plugin-rsrtp && \
    # Cleanup
    paccache -rk1 && \
    rm -rf /usr/share/{info,man,doc}/*

### Application Installation ###
ARG LUDUSAVI_VERSION="0.28.0"
RUN pacman -Sy --noconfirm --needed curl && \
    curl -fsSL -o ludusavi.tar.gz \
        "https://github.com/mtkennerly/ludusavi/releases/download/v${LUDUSAVI_VERSION}/ludusavi-v${LUDUSAVI_VERSION}-linux.tar.gz" && \
    tar -xzvf ludusavi.tar.gz && \
    mv ludusavi /usr/bin/ && \
    rm ludusavi.tar.gz

### User Configuration ###
ENV USER="nestri" \
    UID=1000 \
    GID=1000 \
    USER_PWD="nestri1234" \
    XDG_RUNTIME_DIR=/run/user/1000 \
    HOME=/home/nestri \
    NVIDIA_DRIVER_CAPABILITIES=all \
    NVIDIA_VISIBLE_DEVICES=all

RUN mkdir -p /home/${USER} && \
    groupadd -g ${GID} ${USER} && \
    useradd -d /home/${USER} -u ${UID} -g ${GID} -s /bin/bash ${USER} && \
    chown -R ${USER}:${USER} /home/${USER} && \
    echo "${USER} ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers && \
    echo "${USER}:${USER_PWD}" | chpasswd && \
    mkdir -p /run/user/${UID} && \
    chown ${USER}:${USER} /run/user/${UID} && \
    usermod -aG input,video,render,seat root && \
    usermod -aG input,video,render,seat ${USER}

### System Services Configuration ###
RUN mkdir -p /run/dbus && \
    # Wireplumber suspend disable
    sed -i -z \
        -e 's/{[[:space:]]*name = node\/suspend-node\.lua,[[:space:]]*type = script\/lua[[:space:]]*provides = hooks\.node\.suspend[[:space:]]*}[[:space:]]*//g' \
        -e '/wants = \[/{s/hooks\.node\.suspend\s*//; s/,\s*\]/]/}' \
        /usr/share/wireplumber/wireplumber.conf

### Artifacts and Verification ###
COPY --from=nestri-server-cached-builder /artifacts/nestri-server /usr/bin/
COPY --from=gst-wayland-cached-builder /artifacts/usr/ /usr/
RUN gst-inspect-1.0 waylanddisplaysrc && which nestri-server

### Scripts and Final Configuration ###
COPY packages/scripts/ /etc/nestri/
RUN chmod +x /etc/nestri/{envs.sh,entrypoint*.sh} && \
    locale-gen

ENTRYPOINT ["supervisord", "-c", "/etc/nestri/supervisord.conf"]
