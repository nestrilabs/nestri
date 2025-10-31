# Container build arguments #
ARG RUNNER_BASE_IMAGE=runner-base:latest

#**************#
# builder base #
#**************#
FROM ${RUNNER_BASE_IMAGE} AS base-builder

ENV ARTIFACTS=/artifacts
RUN mkdir -p "${ARTIFACTS}"

# Environment setup for Rust and Cargo
ENV CARGO_HOME=/usr/local/cargo \
    PATH="${CARGO_HOME}/bin:${PATH}"

# Install build essentials and caching tools
RUN --mount=type=cache,target=/var/cache/pacman/pkg \
    pacman -Sy --noconfirm rustup git base-devel mold \
    meson pkgconf cmake git gcc make

# Override various linker with symlink so mold is forcefully used (ld, ld.lld, lld)
RUN ln -sf /usr/bin/mold /usr/bin/ld && \
    ln -sf /usr/bin/mold /usr/bin/ld.lld && \
    ln -sf /usr/bin/mold /usr/bin/lld

# Install latest Rust using rustup
RUN rustup default stable

# Install cargo-chef with proper caching
RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    cargo install -j $(nproc) cargo-chef --locked

#*******************************#
# vimputti manager build stages #
#*******************************#
FROM base-builder AS vimputti-manager-deps
WORKDIR /builder

# Install build dependencies
RUN --mount=type=cache,target=/var/cache/pacman/pkg \
    pacman -Sy --noconfirm lib32-gcc-libs

# Clone repository
RUN git clone --depth 1 --rev "2fde5376b6b9a38cdbd94ccc6a80c9d29a81a417" https://github.com/DatCaptainHorse/vimputti.git

#--------------------------------------------------------------------
FROM vimputti-manager-deps AS vimputti-manager-planner
WORKDIR /builder/vimputti

# Prepare recipe for dependency caching
RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    cargo chef prepare --recipe-path recipe.json

#--------------------------------------------------------------------
FROM vimputti-manager-deps AS vimputti-manager-cached-builder
WORKDIR /builder/vimputti

COPY --from=vimputti-manager-planner /builder/vimputti/recipe.json .

# Cache dependencies using cargo-chef
RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    cargo chef cook --release --recipe-path recipe.json

ENV CARGO_TARGET_DIR=/builder/target
COPY --from=vimputti-manager-planner /builder/vimputti/ .

# Build and install directly to artifacts
RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    --mount=type=cache,target=/builder/target \
    cargo build --release --package vimputti-manager && \
    cargo build --release --package vimputti-shim && \
    rustup target add i686-unknown-linux-gnu && \
    cargo build --release --package vimputti-shim --target i686-unknown-linux-gnu && \
    cp "${CARGO_TARGET_DIR}/release/vimputti-manager" "${ARTIFACTS}" && \
    cp "${CARGO_TARGET_DIR}/release/libvimputti_shim.so" "${ARTIFACTS}/libvimputti_shim_64.so" && \
    cp "${CARGO_TARGET_DIR}/i686-unknown-linux-gnu/release/libvimputti_shim.so" "${ARTIFACTS}/libvimputti_shim_32.so"

#****************************#
# nestri-server build stages #
#****************************#
FROM base-builder AS nestri-server-deps
WORKDIR /builder

# Install build dependencies
RUN --mount=type=cache,target=/var/cache/pacman/pkg \
    pacman -Sy --noconfirm gst-plugins-good gst-plugin-rswebrtc

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

#**********************************#
# gst-wayland-display build stages #
#**********************************#
FROM base-builder AS gst-wayland-deps
WORKDIR /builder

# Install build dependencies
RUN --mount=type=cache,target=/var/cache/pacman/pkg \
    pacman -Sy --noconfirm libxkbcommon wayland \
    gst-plugins-good gst-plugins-bad libinput

RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    cargo install cargo-c

# Clone repository
RUN git clone --depth 1 --rev "a4abcfe2cffe2d33b564d1308b58504a5e3012b1" https://github.com/games-on-whales/gst-wayland-display.git

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

#*********************************#
# Patched bubblewrap build stages #
#*********************************#
FROM base-builder AS bubblewrap-deps
WORKDIR /builder

# Install build dependencies
RUN --mount=type=cache,target=/var/cache/pacman/pkg \
    pacman -Sy --noconfirm libtool libcap libselinux

# Copy patch file from host
COPY packages/patches/bubblewrap/ /builder/patches/

# Clone repository
RUN git clone --depth 1 --rev "9ca3b05ec787acfb4b17bed37db5719fa777834f" https://github.com/containers/bubblewrap.git && \
    cd bubblewrap && \
    # Apply patch to fix user namespace issue
    git apply ../patches/bubbleunheck.patch

#--------------------------------------------------------------------
FROM bubblewrap-deps AS bubblewrap-builder
WORKDIR /builder/bubblewrap

# Build and install directly to artifacts
RUN meson setup build --prefix=${ARTIFACTS} && \
    meson compile -C build && \
    meson install -C build

#*********************************************#
# Final Export Stage - Collects all artifacts #
#*********************************************#
FROM scratch AS artifacts

COPY --from=nestri-server-cached-builder /artifacts/nestri-server /artifacts/bin/
COPY --from=gst-wayland-cached-builder /artifacts/lib/ /artifacts/lib/
COPY --from=gst-wayland-cached-builder /artifacts/include/ /artifacts/include/
COPY --from=vimputti-manager-cached-builder /artifacts/vimputti-manager /artifacts/bin/
COPY --from=vimputti-manager-cached-builder /artifacts/libvimputti_shim_64.so /artifacts/lib64/libvimputti_shim.so
COPY --from=vimputti-manager-cached-builder /artifacts/libvimputti_shim_32.so /artifacts/lib32/libvimputti_shim.so
COPY --from=bubblewrap-builder /artifacts/bin/bwrap /artifacts/bin/
