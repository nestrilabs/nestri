# ═══════════════════════════════════════════════════════════
#  nestri guest rootfs — the open half
#
#  Builds a bootable Artix/OpenRC image containing Mesa (virtio-gpu native
#  context) and the four open guest components: nescope, neshub, neswire,
#  nescapture. Two leaf targets, selected with `--target`:
#
#    runtime_prod    stripped, root locked          (default: `make build`)
#    runtime_debug    debug tools, autologin root    (`make build-debug`)
#
#  What is deliberately NOT here: Proton, Valve's steamclient.so, or anything
#  else closed. nestri/CLAUDE.md is explicit that nothing closed enters this
#  repo. Whatever layers those on top of runtime_prod is a closed build
#  outside this repo — see build/README.md.
#
#  Build from the repo root, not from build/:
#    docker build -f build/Dockerfile --target runtime_prod -t nestri-guest .
#  (`make build` in this directory does exactly that.)
# ═══════════════════════════════════════════════════════════


# ───────────────────────────────────────────────────────────
#  initial / builder — Arch, not Artix
#
#  The guest is Artix, but Artix's repos are Arch-derived and the toolchain/
#  glibc generation is the same, while the archlinux image is the
#  better-maintained of the two for actually compiling things. Only build
#  artifacts leave these stages.
# ───────────────────────────────────────────────────────────
FROM docker.io/archlinux:base-devel AS initial
RUN pacman -Syu --noconfirm

FROM initial AS builder
RUN pacman -S --noconfirm --needed \
        cmake meson ninja git pkgconf \
        python python-mako python-yaml python-packaging python-ply \
        bison flex \
        libpciaccess libepoxy libglvnd \
        libx11 libxext libxrandr libxshmfence libxfixes libxxf86vm libxcb \
        xcb-util-keysyms xorgproto \
        wayland wayland-protocols \
        expat zlib zstd libxml2 lm_sensors \
        llvm clang libclc spirv-tools spirv-llvm-translator glslang \
        elfutils libva libdrm directx-headers \
        rust rust-bindgen cbindgen \
        curl openssl \
        pixman libxkbcommon \
        vulkan-headers vulkan-icd-loader \
        pipewire shaderc opus \
        libinput \
    && pacman -Scc --noconfirm
WORKDIR /build
ENV ARTIFACTS=/artifacts


# ───────────────────────────────────────────────────────────
#  Mesa — the only piece still fetched from outside this tree
# ───────────────────────────────────────────────────────────
FROM builder AS mesa-build

ARG MESA_GIT=https://gitlab.freedesktop.org/mesa/mesa.git
ARG MESA_COMMIT=b78fc73dd898a7dfa87448a4b5ff4459a870e21a

RUN git clone --depth=1 --revision="${MESA_COMMIT}" "${MESA_GIT}" /build/mesa-src && \
    cd /build/mesa-src && \
    meson setup builddir \
        -Dprefix=/usr \
        -Dbuildtype=release \
        -Dplatforms=wayland,x11 \
        -Dgallium-drivers=zink,radeonsi,iris \
        -Dvulkan-drivers=amd,intel \
        -Damdgpu-virtio=true \
        -Dintel-virtio-experimental=true \
        -Dvideo-codecs=all \
        -Degl=enabled \
        -Dglx=dri \
        -Dgles1=enabled \
        -Dgles2=enabled \
        -Dgbm=enabled \
        -Dgallium-va=enabled \
        -Db_ndebug=true && \
    ninja -C builddir && \
    DESTDIR=/artifacts/mesa ninja -C builddir install && \
    rm -rf /build/mesa-src && \
    find /artifacts/mesa -type f -printf '/%P\n' > /artifacts/mesa/.manifest


# ───────────────────────────────────────────────────────────
#  nestri workspace — same repo now, so this is COPY, not a private clone
#
#  One `cargo build --release --workspace` rather than one stage per binary:
#  that per-repo splitting existed because nescope/neswire/nescapture/the hub
#  were four separate private repos and a stage boundary was the only way to
#  stop bumping one from invalidating the others' build cache. They are one
#  Cargo workspace with one Cargo.lock now, so a BuildKit cache mount on
#  target/ gives the same isolation — cargo's own incremental compiler
#  already knows nescope changing does not touch nesprotocol's .rlib — without
#  four copies of every shared dependency getting compiled once per stage.
# ───────────────────────────────────────────────────────────
FROM builder AS nestri-src
WORKDIR /build/nestri
COPY Cargo.toml Cargo.lock ./
COPY crates/nesprotocol crates/nesprotocol
COPY apps/nescope apps/nescope
COPY apps/neshub apps/neshub
COPY apps/neswire apps/neswire
COPY apps/nescapture apps/nescapture

FROM nestri-src AS nestri-build
RUN --mount=type=cache,target=/root/.cargo/registry \
    --mount=type=cache,target=/build/nestri/target \
    cargo build --release --workspace && \
    mkdir -p /artifacts/nestri/usr/bin /artifacts/nestri/usr/lib \
             /artifacts/nestri/usr/share/vulkan/implicit_layer.d && \
    install -Dm755 target/release/nescope  /artifacts/nestri/usr/bin/nescope && \
    install -Dm755 target/release/neshub   /artifacts/nestri/usr/bin/neshub && \
    install -Dm755 target/release/neswire  /artifacts/nestri/usr/bin/neswire && \
    install -Dm755 target/release/libnescapture_layer.so \
        /artifacts/nestri/usr/lib/libnescapture_layer.so && \
    install -Dm644 apps/nescapture/manifest/VK_LAYER_nescapture.json \
        /artifacts/nestri/usr/share/vulkan/implicit_layer.d/VK_LAYER_nescapture.json && \
    find /artifacts/nestri -type f -printf '/%P\n' > /artifacts/nestri/.manifest


# ───────────────────────────────────────────────────────────
#  os-base — the Artix rootfs itself
#
#  `FROM artixlinux/artixlinux:base-openrc` directly, and `pacman -S` as plain
#  RUN steps — not a privileged host `chroot` into a hand-extracted tarball,
#  which would need /proc, /sys and /dev bind-mounted in first (they don't
#  exist inside a chroot target until something puts them there). A
#  Dockerfile RUN step already executes inside a real container with its own
#  /proc, /sys, /dev, so there is no bind-mount step to write at all.
# ───────────────────────────────────────────────────────────
FROM docker.io/artixlinux/artixlinux:base-openrc AS os-base

RUN pacman -Syu --noconfirm --needed \
        base openrc udev dbus dbus-openrc \
        iptables iproute2 \
        mesa libglvnd libdrm libepoxy libxxf86vm libinput wayland \
        expat zlib llvm-libs elfutils libva shaderc vulkan-icd-loader \
        pixman libxkbcommon xcb-util-keysyms xorg-xwayland \
        pipewire pipewire-audio wireplumber dbus logrotate opus \
    && pacman -Scc --noconfirm

# groupadd -f so this is idempotent whether or not udev's rules already
# created these.
RUN groupadd -f audio && groupadd -f video && groupadd -f input && groupadd -f render && \
    useradd -m -u 1000 -s /bin/bash nestri && \
    for g in audio video input render; do gpasswd -a nestri "$g" >/dev/null; done


# ───────────────────────────────────────────────────────────
#  runtime — everything common to debug and prod
# ───────────────────────────────────────────────────────────
FROM os-base AS runtime

# Our own builds, overlaid on the distro's mesa. The distro package landed
# first (above) so every runtime dependency of *a* Mesa is present and
# correctly versioned; this overwrites its .so files with ours.
#
# COPY --from runs as root inside this build with no invoking-user uid to
# stamp onto / or /usr/bin, unlike a host-side `podman cp` + `cp -a` — so
# there is no ownership-sanity-check to write here. Nothing to catch, on
# purpose, not an oversight.
COPY --from=mesa-build   /artifacts/mesa/.manifest   /tmp/mesa.manifest
COPY --from=nestri-build /artifacts/nestri/.manifest /tmp/nestri.manifest
RUN cat /tmp/mesa.manifest /tmp/nestri.manifest > /tmp/.strip-manifest && \
    rm -f /tmp/mesa.manifest /tmp/nestri.manifest
COPY --from=mesa-build   /artifacts/mesa   /
COPY --from=nestri-build /artifacts/nestri /
RUN ldconfig

COPY build/etc/ /etc/
RUN chmod +x /etc/init.d/*

# dbus-session, pipewire and wireplumber carry no conf.d of their own — they
# just want the shared environment, so their conf.d is a symlink to it rather
# than a copy. nescope, neshub and neswire are deliberately absent from this
# loop: each has a conf.d file of its own (already landed by the COPY above)
# that sources nestri-user-env, because each needs settings the shared file
# does not carry. Symlinking them here would overwrite those.
RUN for svc in dbus-session pipewire wireplumber; do \
        ln -sf nestri-user-env "/etc/conf.d/${svc}"; \
    done

RUN echo nesbox > /etc/hostname && dbus-uuidgen --ensure=/etc/machine-id

# Session mount points. The guest root is read-only at runtime, so a runtime
# mkdir gets EROFS and takes a service down before it starts — these have to
# already exist in the image.
RUN mkdir -p /nestri/install /nestri/user /nestri/work /nestri/game /nestri/logs && \
    chmod 0755 /nestri /nestri/install /nestri/user /nestri/work /nestri/game /nestri/logs && \
    mkdir -p /dev/shm && chmod 1777 /dev/shm && \
    rm -f /etc/network/interfaces

# Serial console: the only way into a guest that will not boot.
RUN rm -f /etc/inittab && \
    ln -sf agetty /etc/init.d/agetty.hvc0 && \
    { grep -qx hvc0 /etc/securetty || echo hvc0 >> /etc/securetty; }

# Every init.d script calling nestri_export_env needs a conf.d that actually
# defines it. Worth a build-time check: the failure at runtime is nearly
# invisible — OpenRC sources the script, the undefined function is a
# "command not found" on stderr, sourcing still returns 0, and the service
# starts anyway with HOME and every XDG_* unset.
RUN missing=""; \
    for svc_script in /etc/init.d/*; do \
        grep -qE '^[[:space:]]*nestri_export_env\b' "$svc_script" 2>/dev/null || continue; \
        svc="$(basename "$svc_script")"; \
        . "/etc/conf.d/$svc" >/dev/null 2>&1; \
        command -v nestri_export_env >/dev/null 2>&1 || missing="$missing $svc"; \
    done; \
    [ -z "$missing" ] || { echo "init scripts call nestri_export_env with no conf.d providing it:$missing" >&2; exit 1; }

# ── OpenRC service registration ──
# sysinit
RUN rc-update add devfs sysinit && \
    rc-update add dmesg sysinit && \
    rc-update add udev sysinit && \
    rc-update add udev-trigger sysinit && \
    (rc-update del kmod-static-nodes sysinit || true)

# boot — guest-net replaces the distro's networking scripts entirely; it
# declares `provide net` and brings up lo itself.
RUN (rc-update del networking boot || true) && \
    (rc-update del network-async boot || true) && rm -f /etc/init.d/network-async && \
    rc-update add guest-net boot && \
    (rc-update del net.lo boot || true) && \
    (rc-update del netmount boot || true) && \
    (rc-update del netmount default || true) && \
    rc-update add hostname boot && \
    rc-update add xdg-runtime boot && \
    rc-update add cgroups boot && \
    (rc-update del syslog boot || true)

# Boot-runlevel services with nothing to do in a freshly-built microVM: no
# physical console, no swap, and fsck would be checking a filesystem nobody
# has touched.
RUN for svc in fsck keymaps save-keymaps termencoding save-termencoding swap binfmt seedrng hwclock swclock; do \
        (rc-update del "$svc" boot || true); \
        (rc-update del "$svc" shutdown || true); \
    done

# default — the user-facing stack. nescope is registered in plain-compositor
# mode (no payload after `--`): it comes up and waits for something to
# connect. Actually starting a payload is nesinit's job, and nesinit is not
# open code yet — see build/README.md.
RUN rc-update add agetty.hvc0 default && \
    for n in 1 2 3 4 5 6; do (rc-update del "agetty.tty${n}" default || true); done && \
    rc-update add dbus default && \
    rc-update add dbus-session default && \
    rc-update add pipewire default && \
    rc-update add wireplumber default && \
    rc-update add neshub default && \
    rc-update add neswire default && \
    rc-update add nescope default && \
    rm -f /etc/init.d/shared-root && (rc-update del shared-root boot || true)


# ───────────────────────────────────────────────────────────
#  runtime_prod — the default: `make build`
# ───────────────────────────────────────────────────────────
FROM runtime AS runtime_prod

RUN passwd -l root
COPY build/etc/conf.d/agetty.hvc0.prod /etc/conf.d/agetty.hvc0

RUN while IFS= read -r f; do \
        [ -f "$f" ] && strip --strip-unneeded "$f" 2>/dev/null || true; \
    done < /tmp/.strip-manifest; \
    rm -rf /tmp/.strip-manifest /var/cache/pacman/pkg/* /tmp/* /root/.cache \
        /usr/share/man /usr/share/doc /usr/share/locale \
        /usr/lib/cmake /usr/lib/pkgconfig /usr/share/pkgconfig /usr/include

RUN echo "NESTRI_STAGE=runtime_prod" >> /etc/os-release


# ───────────────────────────────────────────────────────────
#  runtime_debug — `make build-debug`
# ───────────────────────────────────────────────────────────
FROM runtime AS runtime_debug

RUN pacman -Syu --noconfirm --needed vulkan-tools mesa-utils libva-utils && \
    pacman -Scc --noconfirm
RUN echo 'root:nestri' | chpasswd
COPY build/etc/conf.d/agetty.hvc0.debug /etc/conf.d/agetty.hvc0

RUN echo "NESTRI_STAGE=runtime_debug" >> /etc/os-release
