# syntax=docker/dockerfile:1
# =============================================================================
# Nestri – Unified Multi-stage Build
# =============================================================================
#
# Build graph (BuildKit runs independent branches in parallel):
#
#   initial ─► builder ──┬─► libkrunfw-build ─► libkrun-build ──┐
#                        ├─► virgl-build ───────────────────────┤
#                        ├─► mesa-build ─► lib32-mesa-build     │
#                        │                                      │
#                        └─► rust-builder ─┬─► gst-wayland-build
#                                         ├─► wl-proxy-build
#                                         ├─► nestrisink-build
#                                         └─► muvm-build ◄─────┘
#
#   initial ─► runner ◄── all build stages
#
# Build:
#   docker buildx build --target runtime -t nestri:latest .
#
# =============================================================================


#******************************************************************************
#                                                                      initial
#******************************************************************************
# Minimal updated Arch Linux base. Every other stage inherits from here.
FROM docker.io/archlinux/archlinux:base-20260329.0.507017 AS initial

RUN --mount=type=cache,sharing=locked,target=/var/cache/pacman/pkg \
    pacman -Syu --noconfirm


#******************************************************************************
#                                                                      builder
#******************************************************************************
# builder has C/C++ tooling, makepkg, and a non-root build user.
FROM initial AS builder

RUN --mount=type=cache,sharing=locked,target=/var/cache/pacman/pkg \
    pacman -S --noconfirm \
        base-devel \
        clang \
        cmake \
        git \
        meson \
        ninja \
        python \
        pkg-config

WORKDIR /scratch

ENV ARTIFACTS=/artifacts
RUN mkdir -p "$ARTIFACTS"

# makepkg refuses to run as root
RUN useradd -m builder \
    && echo "builder ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers

# Maximise build parallelism
RUN sed -i "s/#MAKEFLAGS=.*/MAKEFLAGS=\"-j$(nproc)\"/" /etc/makepkg.conf

# Let the builder user write to /scratch and /artifacts
RUN chgrp builder /scratch "$ARTIFACTS" \
    && chmod g+ws /scratch "$ARTIFACTS"


#******************************************************************************
#                                                                 rust-builder
#******************************************************************************
# rust-builder adds the Rust toolchain and common crate build deps.
FROM builder AS rust-builder

ENV CARGO_HOME=/usr/local/cargo
ENV PATH="${CARGO_HOME}/bin:${PATH}"

RUN --mount=type=cache,sharing=locked,target=/var/cache/pacman/pkg \
    pacman -S --noconfirm \
        rust \
        cargo \
        gstreamer \
        gst-plugins-base \
        gst-plugins-good \
        gst-plugins-bad \
        libdrm \
        libxkbcommon \
        wayland \
        wayland-protocols \
        libinput \
        libseccomp \
        libcap

# cargo-c is needed by gst-wayland-display (cargo cinstall)
RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    --mount=type=cache,target=${CARGO_HOME}/git \
    cargo install cargo-c


#******************************************************************************
#                                                            libkrunfw-build
#******************************************************************************
# Build libkrunfw package with 32-bit support.
FROM builder AS libkrunfw-build

RUN --mount=type=cache,sharing=locked,target=/var/cache/pacman/pkg \
    pacman -S --noconfirm --needed \
        bc \
        python-pyelftools \
        cpio \
        curl \
        wget

COPY build/packages/libkrunfw/ /scratch/libkrunfw/
WORKDIR /scratch/libkrunfw

RUN chown -R builder:builder .
USER builder
RUN makepkg --syncdeps --noconfirm --skippgpcheck \
    && cp *.zst "$ARTIFACTS"


#******************************************************************************
#                                                              libkrun-build
#******************************************************************************
# Build libkrun package (depends on libkrunfw).
FROM builder AS libkrun-build

# Install previously-built libkrunfw
WORKDIR /scratch
COPY --from=libkrunfw-build /artifacts/*.zst pkgs/
RUN pacman -U --noconfirm pkgs/*.zst && rm -rf pkgs

RUN --mount=type=cache,sharing=locked,target=/var/cache/pacman/pkg \
    pacman -S --noconfirm --needed \
        rust \
        cargo \
        patchelf \
        clang \
        clang18 \
        pipewire \
        virglrenderer

COPY build/packages/libkrun/ /scratch/libkrun/
WORKDIR /scratch/libkrun

RUN chown -R builder:builder .
USER builder
# NOTE: clang18 required – newer versions fail to build libkrun
RUN LIBCLANG_PATH=/usr/lib/llvm18/lib \
    makepkg --syncdeps --noconfirm --skippgpcheck \
    && cp *.zst "$ARTIFACTS"


#******************************************************************************
#                                                               virgl-build
#******************************************************************************
# Build virglrenderer package.
FROM builder AS virgl-build

RUN --mount=type=cache,sharing=locked,target=/var/cache/pacman/pkg \
    pacman -S --noconfirm --needed \
        python-yaml \
        libepoxy \
        mesa \
        libva \
        libdrm \
        vulkan-headers \
        vulkan-icd-loader \
        libx11 \
        glu

COPY build/virglrenderer/ /scratch/virglrenderer/
WORKDIR /scratch/virglrenderer

RUN chown -R builder:builder .
USER builder
RUN makepkg --syncdeps --noconfirm --skippgpcheck --skipinteg \
    && cp *.zst "$ARTIFACTS"


#******************************************************************************
#                                                               mesa-build
#******************************************************************************
# Build Mesa packages (64-bit).
FROM builder AS mesa-build

RUN --mount=type=cache,sharing=locked,target=/var/cache/pacman/pkg \
    pacman -S --noconfirm --needed \
        git \
        python-mako \
        python-packaging \
        python-yaml \
        llvm \
        rust \
        rust-bindgen \
        cbindgen \
        clang \
        glslang \
        wayland-protocols \
        libvdpau \
        libva \
        libxrandr

COPY build/mesa/ /scratch/mesa/
WORKDIR /scratch/mesa

RUN chown -R builder:builder .
USER builder
RUN makepkg --syncdeps --noconfirm --skippgpcheck --skipinteg \
    && cp *.zst "$ARTIFACTS"


#******************************************************************************
#                                                          lib32-mesa-build
#******************************************************************************
# Build 32-bit Mesa packages (depends on 64-bit mesa).
FROM builder AS lib32-mesa-build

# Enable multilib repository for 32-bit dependencies
RUN echo -e "\n[multilib]\nInclude = /etc/pacman.d/mirrorlist" \
    >> /etc/pacman.conf

# Install 64-bit mesa packages first
WORKDIR /scratch
COPY --from=mesa-build /artifacts/*.zst pkgs/
RUN --mount=type=cache,sharing=locked,target=/var/cache/pacman/pkg \
    pacman -Syu --noconfirm \
    && pacman -U --noconfirm pkgs/*.zst \
    && rm -rf pkgs

RUN --mount=type=cache,sharing=locked,target=/var/cache/pacman/pkg \
    pacman -S --noconfirm --needed \
        git \
        python-mako \
        python-packaging \
        python-yaml \
        llvm \
        rust \
        rust-bindgen \
        cbindgen \
        clang \
        glslang \
        wayland-protocols \
        libvdpau \
        libva \
        libxrandr \
        lib32-gcc-libs \
        lib32-libx11 \
        lib32-libdrm \
        lib32-llvm \
        lib32-expat \
        lib32-libelf \
        lib32-zstd \
        lib32-wayland

COPY build/packages/lib32-mesa/ /scratch/lib32-mesa/
WORKDIR /scratch/lib32-mesa

RUN chown -R builder:builder .
USER builder
RUN makepkg --syncdeps --noconfirm --skippgpcheck --skipinteg \
    && cp *.zst "$ARTIFACTS"


#******************************************************************************
#                                                        gst-wayland-build
#******************************************************************************
# Build gst-wayland-display plugin.
FROM rust-builder AS gst-wayland-build

WORKDIR /scratch/gst-wayland-display
RUN git clone https://github.com/games-on-whales/gst-wayland-display.git . \
    && git checkout 67b1183997fd7aaf57398e4b01bd64c4d2433c45

RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    --mount=type=cache,target=${CARGO_HOME}/git \
    --mount=type=cache,target=/scratch/gst-wayland-display/target \
    cargo cinstall --prefix="${ARTIFACTS}/usr" --release --features cuda


#******************************************************************************
#                                                         wl-proxy-build
#******************************************************************************
# Build wl-cross-domain-proxy.
FROM rust-builder AS wl-proxy-build

WORKDIR /scratch/wl-cross-domain-proxy
RUN git clone https://codeberg.org/drakulix/wl-cross-domain-proxy.git . \
    && git checkout c6ce1ca89fb4d6f4f18d3aaf88324d40d4589177

RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    --mount=type=cache,target=${CARGO_HOME}/git \
    --mount=type=cache,target=/scratch/wl-cross-domain-proxy/target \
    cargo build --release \
    && install -Dm755 target/release/wl-cross-domain-proxy \
       "${ARTIFACTS}/usr/bin/wl-cross-domain-proxy"


#******************************************************************************
#                                                       nestrisink-build
#******************************************************************************
# Build nestri GStreamer sink plugin.
FROM rust-builder AS nestrisink-build

WORKDIR /scratch/nestrisink
COPY Cargo.toml Cargo.lock ./
COPY crates/ ./crates/
COPY apps/  ./apps/

RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    --mount=type=cache,target=${CARGO_HOME}/git \
    --mount=type=cache,target=/scratch/nestrisink/target \
    cargo build -p nestri-gst --release \
    && mkdir -p "${ARTIFACTS}/usr/lib/gstreamer-1.0" \
    && cp target/release/libgstnestri.so \
       "${ARTIFACTS}/usr/lib/gstreamer-1.0/"


#******************************************************************************
#                                                           muvm-build
#******************************************************************************
# Build muvm binary (depends on libkrun + virgl packages).
FROM rust-builder AS muvm-build

# Install custom-built packages that muvm links against
WORKDIR /scratch
COPY --from=libkrunfw-build /artifacts/*.zst pkgs/
COPY --from=libkrun-build   /artifacts/*.zst pkgs/
COPY --from=virgl-build     /artifacts/*.zst pkgs/
RUN --mount=type=cache,sharing=locked,target=/var/cache/pacman/pkg \
    pacman -S --noconfirm --needed pipewire \
    && pacman -U --noconfirm pkgs/*.zst \
    && rm -rf pkgs

WORKDIR /scratch/muvm
COPY Cargo.toml Cargo.lock ./
COPY crates/ ./crates/
COPY apps/  ./apps/
COPY share/ ./share/

RUN --mount=type=cache,target=${CARGO_HOME}/registry \
    --mount=type=cache,target=${CARGO_HOME}/git \
    --mount=type=cache,target=/scratch/muvm/target \
    cargo build -p muvm --release \
    && install -Dm755 target/release/muvm      "${ARTIFACTS}/usr/bin/muvm" \
    && install -Dm755 target/release/muvm-guest "${ARTIFACTS}/usr/bin/muvm-guest"


#******************************************************************************
#                                                                       runner
#******************************************************************************
# The final runtime image – kept as simple as possible.
FROM initial AS runtime

# ---- Enable multilib for 32-bit packages ----
RUN echo -e "\n[multilib]\nInclude = /etc/pacman.d/mirrorlist" \
    >> /etc/pacman.conf

# ---- Collect and install custom-built .zst packages ----
COPY --from=mesa-build       /artifacts/*.zst /tmp/pkgs/
COPY --from=lib32-mesa-build /artifacts/*.zst /tmp/pkgs/
COPY --from=libkrunfw-build  /artifacts/*.zst /tmp/pkgs/
COPY --from=libkrun-build    /artifacts/*.zst /tmp/pkgs/
COPY --from=virgl-build      /artifacts/*.zst /tmp/pkgs/

RUN --mount=type=cache,sharing=locked,target=/var/cache/pacman/pkg \
    pacman -Syu --noconfirm \
    && pacman -U --noconfirm /tmp/pkgs/*.zst \
    && rm -rf /tmp/pkgs

# ---- System runtime packages (single transaction for consistency) ----
RUN --mount=type=cache,sharing=locked,target=/var/cache/pacman/pkg \
    pacman -S --noconfirm \
        # Core
        base systemd sudo bash \
        # Steam & Gaming
        steam gamescope mangohud seatd \
        # Vulkan / Mesa / VA-API
        vulkan-icd-loader vulkan-tools lib32-vulkan-icd-loader \
        libva-mesa-driver libva-utils \
        # Wayland / X
        wayland libdrm libxkbcommon \
        xorg-xwayland xwayland-satellite \
        libinput \
        # Audio
        pipewire pipewire-pulse pipewire-alsa wireplumber \
        lib32-libpulse \
        # GStreamer runtime plugins
        gstreamer gst-plugins-base \
        gst-plugins-good gst-plugins-bad \
        gst-plugin-isobmff gst-plugin-va \
        gst-plugin-pipewire gst-plugin-qsv \
        # Video acceleration
        vpl-gpu-rt \
        # GUI / Fonts
        gtk3 lib32-gtk3 \
        ttf-liberation noto-fonts-cjk \
        # Networking & System
        dbus curl passt openssh hwdata \
        jq pacman-contrib lib32-libvdpau

# ---- Copy artifacts from Rust build stages ----
COPY --from=wl-proxy-build     /artifacts/usr/ /usr/
COPY --from=gst-wayland-build  /artifacts/usr/ /usr/
COPY --from=nestrisink-build   /artifacts/usr/ /usr/
COPY --from=muvm-build         /artifacts/usr/ /usr/

# ---- muvm-guest multi-call symlinks ----
RUN mkdir -p /opt/bin \
    && ln -sf /usr/bin/muvm-guest /opt/bin/muvm-remote \
    && ln -sf /usr/bin/muvm-guest /opt/bin/muvm-configure-network \
    && ln -sf /usr/bin/muvm-guest /opt/bin/muvm-pwbridge

# ---- User setup ----
ARG NESTRI_USER_PWD=""
ENV NESTRI_USER="nestri" \
    NESTRI_UID=1000 \
    NESTRI_GID=1000 \
    NESTRI_LANG=en_US.UTF-8 \
    NESTRI_XDG_RUNTIME_DIR=/run/user/1000 \
    NESTRI_HOME=/home/nestri \
    NVIDIA_DRIVER_CAPABILITIES=all

RUN mkdir -p "/home/${NESTRI_USER}" \
    && groupadd -g "${NESTRI_GID}" "${NESTRI_USER}" \
    && useradd -d "/home/${NESTRI_USER}" \
       -u "${NESTRI_UID}" -g "${NESTRI_GID}" \
       -s /bin/bash "${NESTRI_USER}" \
    && echo "${NESTRI_USER} ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers \
    && NESTRI_USER_PWD="${NESTRI_USER_PWD:-$(openssl rand -base64 12)}" \
    && echo "Setting password for ${NESTRI_USER}" \
    && echo "${NESTRI_USER}:${NESTRI_USER_PWD}" | chpasswd \
    && mkdir -p "${NESTRI_XDG_RUNTIME_DIR}" \
    && chown "${NESTRI_USER}:${NESTRI_USER}" "${NESTRI_XDG_RUNTIME_DIR}" \
    && usermod -aG input,video,render,seat,wheel,systemd-journal "${NESTRI_USER}"

# ---- Wireplumber suspend disable ----
RUN mkdir -p /run/dbus \
    && sed -i -z \
       -e 's/{[[:space:]]*name = node\/suspend-node\.lua,[[:space:]]*type = script\/lua[[:space:]]*provides = hooks\.node\.suspend[[:space:]]*}[[:space:]]*//g' \
       -e '/wants = \[/{s/hooks\.node\.suspend\s*//; s/,\s*\]/]/}' \
       /usr/share/wireplumber/wireplumber.conf

# ---- Audio & config directories ----
COPY etc/ /etc/

# ---- Steam config ----
RUN mkdir -p "${NESTRI_HOME}/.local/share/Steam/config"
COPY build/steam/config.vdf "${NESTRI_HOME}/.local/share/Steam/config/"

# ---- Mask noisy/broken services ----
RUN systemctl mask \
    dm-event.socket \
    systemd-firstboot.service \
    systemd-homed.service \
    systemd-hwdb-update.service \
    systemd-network-generator.service \
    systemd-networkd.service \
    systemd-networkd-wait-online.service \
    systemd-remount-fs.service \
    systemd-resolved.service \
    systemd-timesyncd.service \
    systemd-userdbd.service \
    getty@tty1.service \
    serial-getty@.service

# ---- Systemd units ----
RUN systemctl enable dbus.service \
    && systemctl set-default microvm.target

# ---- Scripts (copied last – they change the most) ----
COPY build/usr/bin/ /usr/bin/

# ---- Smoke test ----
RUN command -v steam muvm muvm-guest wl-cross-domain-proxy \
              nestri-entry nestri-init

# ---- Final cleanup ----
RUN rm -rf /tmp/*
