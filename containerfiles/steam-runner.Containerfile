# Container build arguments #
ARG RUNNER_COMMON_IMAGE=runner-common:latest

#*********************#
# Final Runtime Stage #
#*********************#
FROM ${RUNNER_COMMON_IMAGE}

### FLAVOR/VARIANT CONFIGURATION ###
## STEAM ##
RUN --mount=type=cache,target=/var/cache/pacman/pkg \
    pacman -S --noconfirm --assume-installed bubblewrap \
    steam \
    lib32-mesa lib32-vulkan-mesa-layers lib32-vulkan-intel lib32-vulkan-radeon && \
    # Cleanup
    paccache -rk1 && \
    rm -rf /usr/share/{info,man,doc}/*

## Steam Configs - Proton (Experimental flavor) ##
RUN mkdir -p "${NESTRI_HOME}/.local/share/Steam/config"
COPY packages/configs/steam/config.vdf "${NESTRI_HOME}/.local/share/Steam/config/"

## FLAVOR/VARIANT LAUNCH COMMAND ##
ENV NESTRI_LAUNCH_COMPOSITOR="gamescope --backend wayland --force-grab-cursor -g -f -W \$WIDTH -H \$HEIGHT -r \$FRAMERATE --mangoapp -e"
ENV NESTRI_LAUNCH_CMD="env DISPLAY=:0 steam -tenfoot -cef-force-gpu"
### END OF FLAVOR/VARIANT CONFIGURATION ###
