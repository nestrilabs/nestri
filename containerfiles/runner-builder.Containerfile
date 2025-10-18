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
RUN git clone --depth 1 --rev "9e8bfd0217eeab011c5afc368d3ea67a4c239e81" https://github.com/DatCaptainHorse/vimputti.git

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

# Grab cudart from NVIDIA..
RUN wget https://developer.download.nvidia.com/compute/cuda/redist/cuda_cudart/linux-x86_64/cuda_cudart-linux-x86_64-13.0.96-archive.tar.xz -O cuda_cudart.tar.xz && \
    mkdir cuda_cudart && tar -xf cuda_cudart.tar.xz -C cuda_cudart --strip-components=1 && \
    cp cuda_cudart/lib/libcudart.so cuda_cudart/lib/libcudart.so.* /usr/lib/ && \
    rm -r cuda_cudart && \
    rm cuda_cudart.tar.xz

# Grab cuda lib from NVIDIA (it's in driver package of all things..)
RUN wget https://developer.download.nvidia.com/compute/cuda/redist/nvidia_driver/linux-x86_64/nvidia_driver-linux-x86_64-580.95.05-archive.tar.xz -O nvidia_driver.tar.xz && \
    mkdir nvidia_driver && tar -xf nvidia_driver.tar.xz -C nvidia_driver --strip-components=1 && \
    cp nvidia_driver/lib/libcuda.so.* /usr/lib/libcuda.so && \
    ln -s /usr/lib/libcuda.so /usr/lib/libcuda.so.1 && \
    rm -r nvidia_driver && \
    rm nvidia_driver.tar.xz

# Clone repository
RUN git clone --depth 1 --rev "afa853fa03e8403c83bbb3bc0cf39147ad46c266" https://github.com/games-on-whales/gst-wayland-display.git

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
COPY --from=gst-wayland-deps /usr/lib/libcuda.so /usr/lib/libcuda.so.* /artifacts/lib/
COPY --from=bubblewrap-builder /artifacts/bin/bwrap /artifacts/bin/
