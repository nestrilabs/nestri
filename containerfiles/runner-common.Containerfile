# Container build arguments #
ARG RUNNER_BASE_IMAGE=runner-base:latest
ARG RUNNER_BUILDER_IMAGE=runner-builder:latest

#**********************#
# Runtime Common Stage #
#**********************#
FROM ${RUNNER_BASE_IMAGE} AS runtime
FROM ${RUNNER_BUILDER_IMAGE} AS builder
FROM runtime

### Package Installation ###
# Core system components
RUN --mount=type=cache,target=/var/cache/pacman/pkg \
    pacman -S --needed --noconfirm --assume-installed bubblewrap \
    vulkan-intel vpl-gpu-rt \
    vulkan-radeon \
    mesa vulkan-mesa-layers \
    gtk3 \
    sudo xorg-xwayland seatd libinput gamescope mangohud wlr-randr \
    pipewire pipewire-pulse pipewire-alsa wireplumber \
    noto-fonts-cjk jq pacman-contrib \
    hwdata openssh \
    # GStreamer stack
    gst-plugins-good \
    gst-plugins-bad gst-plugin-pipewire \
    gst-plugin-webrtchttp gst-plugin-rswebrtc gst-plugin-rsrtp \
    gst-plugin-va gst-plugin-qsv && \
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
    NESTRI_VIMPUTTI_PATH=/tmp/vimputti-1000 \
    NVIDIA_DRIVER_CAPABILITIES=all

RUN mkdir -p "/home/${NESTRI_USER}" && \
    groupadd -g "${NESTRI_GID}" "${NESTRI_USER}" && \
    useradd -d "/home/${NESTRI_USER}" -u "${NESTRI_UID}" -g "${NESTRI_GID}" -s /bin/bash "${NESTRI_USER}" && \
    echo "${NESTRI_USER} ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers && \
    NESTRI_USER_PWD="${NESTRI_USER_PWD:-$(openssl rand -base64 12)}" && \
    echo "Setting password for ${NESTRI_USER} as: ${NESTRI_USER_PWD}" && \
    echo "${NESTRI_USER}:${NESTRI_USER_PWD}" | chpasswd && \
    mkdir -p "${NESTRI_XDG_RUNTIME_DIR}" && \
    chown "${NESTRI_USER}:${NESTRI_USER}" "${NESTRI_XDG_RUNTIME_DIR}" && \
    usermod -aG input,video,render,seat "${NESTRI_USER}"

### System Services Configuration ###
RUN mkdir -p /run/dbus && \
    # Wireplumber suspend disable
    sed -i -z \
    -e 's/{[[:space:]]*name = node\/suspend-node\.lua,[[:space:]]*type = script\/lua[[:space:]]*provides = hooks\.node\.suspend[[:space:]]*}[[:space:]]*//g' \
    -e '/wants = \[/{s/hooks\.node\.suspend\s*//; s/,\s*\]/]/}' \
    /usr/share/wireplumber/wireplumber.conf

## Audio Systems Configs - Latency optimizations + Loopback ##
RUN mkdir -p /etc/pipewire/pipewire.conf.d && \
    mkdir -p /etc/wireplumber/wireplumber.conf.d

COPY packages/configs/wireplumber.conf.d/*.conf /etc/wireplumber/wireplumber.conf.d/
COPY packages/configs/pipewire.conf.d/*.conf /etc/pipewire/pipewire.conf.d/

## MangoHud Config ##
COPY packages/configs/MangoHud/MangoHud.conf /etc/nestri/configs/MangoHud/

### Artifacts from Builder ###
COPY --from=builder /artifacts/bin/nestri-server /usr/bin/
COPY --from=builder /artifacts/bin/bwrap /usr/sbin/
COPY --from=builder /artifacts/lib/ /usr/lib/
COPY --from=builder /artifacts/lib32/ /usr/lib32/
COPY --from=builder /artifacts/lib64/ /usr/lib64/
COPY --from=builder /artifacts/bin/vimputti-manager /usr/bin/

### Scripts and Final Configuration ###
## Scripts ##
COPY packages/scripts/ /etc/nestri/
RUN chmod +x /etc/nestri/{envs.sh,entrypoint*.sh,pressure-vent.sh} && \
    chown -R "${NESTRI_USER}:${NESTRI_USER}" "${NESTRI_HOME}" && \
    sed -i 's/^#\(en_US\.UTF-8\)/\1/' /etc/locale.gen && \
    setcap cap_mknod+ep /usr/bin/vimputti-manager && \
    dbus-uuidgen > /etc/machine-id && \
    LANG=en_US.UTF-8 locale-gen

## s6-overlay ##
ADD https://github.com/just-containers/s6-overlay/releases/download/v3.2.2.0/s6-overlay-noarch.tar.xz /tmp
ADD https://github.com/just-containers/s6-overlay/releases/download/v3.2.2.0/s6-overlay-x86_64.tar.xz /tmp
RUN tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz && tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz

COPY packages/configs/s6-overlay/ /etc/s6-overlay/s6-rc.d/
RUN chmod +x /etc/s6-overlay/s6-rc.d/*/run

ENTRYPOINT ["/init"]
