# Container build arguments #
ARG RUNNER_BASE_IMAGE=runner-base:latest

#*********************#
# Final Runtime Stage #
#*********************#
FROM ${RUNNER_BASE_IMAGE} AS runtime
ARG RUNNER_BUILDER_IMAGE=runner-builder:latest

### Package Installation ###
# Core system components
RUN --mount=type=cache,target=/var/cache/pacman/pkg \
    pacman -Sy --needed --noconfirm \
        vulkan-intel lib32-vulkan-intel vpl-gpu-rt \
        vulkan-radeon lib32-vulkan-radeon \
        mesa lib32-mesa \
        steam steam-native-runtime gtk3 \
        sudo xorg-xwayland seatd libinput gamescope mangohud wlr-randr \
        libssh2 curl wget libevdev libc++abi \
        pipewire pipewire-pulse pipewire-alsa wireplumber \
        noto-fonts-cjk supervisor jq chwd lshw pacman-contrib \
        hwdata openssh \
    # GStreamer stack
        gstreamer gst-plugins-base gst-plugins-good \
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

## Steam Configs - Proton (Experimental flavor) ##
RUN mkdir -p "${NESTRI_HOME}/.local/share/Steam/config"

COPY packages/configs/steam/config.vdf "${NESTRI_HOME}/.local/share/Steam/config/"

### Artifacts from Builder ###
COPY --from=${RUNNER_BUILDER_IMAGE} /artifacts/bin/nestri-server /usr/bin/
COPY --from=${RUNNER_BUILDER_IMAGE} /artifacts/bin/bwrap /usr/bin/
COPY --from=${RUNNER_BUILDER_IMAGE} /artifacts/lib/ /usr/lib/
COPY --from=${RUNNER_BUILDER_IMAGE} /artifacts/lib32/ /usr/lib32/
COPY --from=${RUNNER_BUILDER_IMAGE} /artifacts/lib64/ /usr/lib64/
COPY --from=${RUNNER_BUILDER_IMAGE} /artifacts/include/ /usr/include/
COPY --from=${RUNNER_BUILDER_IMAGE} /artifacts/bin/vimputti-manager /usr/bin/

### Scripts and Final Configuration ###
COPY packages/scripts/ /etc/nestri/
RUN chmod +x /etc/nestri/{envs.sh,entrypoint*.sh} && \
    chown -R "${NESTRI_USER}:${NESTRI_USER}" "${NESTRI_HOME}" && \
    sed -i 's/^#\(en_US\.UTF-8\)/\1/' /etc/locale.gen && \
    setcap cap_net_admin+ep /usr/bin/vimputti-manager && \
    dbus-uuidgen > /etc/machine-id && \
    LANG=en_US.UTF-8 locale-gen

# Root for most container engines, nestri-user compatible for apptainer without fakeroot
USER root
ENTRYPOINT ["supervisord", "-c", "/etc/nestri/supervisord.conf"]
