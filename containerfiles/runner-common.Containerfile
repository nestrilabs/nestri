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
    pacman -S --needed --noconfirm \
        vulkan-intel lib32-vulkan-intel vpl-gpu-rt \
        vulkan-radeon lib32-vulkan-radeon \
        mesa lib32-mesa \
        gtk3 lib32-gtk3 \
        sudo xorg-xwayland seatd libinput gamescope mangohud wlr-randr \
        pipewire pipewire-pulse pipewire-alsa wireplumber \
        noto-fonts-cjk supervisor jq pacman-contrib \
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

COPY packages/configs/wireplumber.conf.d/* /etc/wireplumber/wireplumber.conf.d/
COPY packages/configs/pipewire.conf.d/* /etc/pipewire/pipewire.conf.d/

## MangoHud Config ##
RUN mkdir -p "${NESTRI_HOME}/.config/MangoHud"

COPY packages/configs/MangoHud/MangoHud.conf "${NESTRI_HOME}/.config/MangoHud/"

### Artifacts from Builder ###
COPY --from=builder /artifacts/bin/nestri-server /usr/bin/
COPY --from=builder /artifacts/bin/bwrap /usr/bin/
COPY --from=builder /artifacts/lib/ /usr/lib/
COPY --from=builder /artifacts/lib32/ /usr/lib32/
COPY --from=builder /artifacts/lib64/ /usr/lib64/
COPY --from=builder /artifacts/bin/vimputti-manager /usr/bin/

### Scripts and Final Configuration ###
COPY packages/scripts/ /etc/nestri/
RUN chmod +x /etc/nestri/{envs.sh,entrypoint*.sh} && \
    chown -R "${NESTRI_USER}:${NESTRI_USER}" "${NESTRI_HOME}" && \
    sed -i 's/^#\(en_US\.UTF-8\)/\1/' /etc/locale.gen && \
    setcap cap_net_admin+ep /usr/bin/vimputti-manager && \
    dbus-uuidgen > /etc/machine-id && \
    LANG=en_US.UTF-8 locale-gen
