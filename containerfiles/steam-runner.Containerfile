# Container build arguments #
ARG RUNNER_COMMON_IMAGE=runner-common:latest

#*********************#
# Final Runtime Stage #
#*********************#
FROM ${RUNNER_COMMON_IMAGE}

### FLAVOR/VARIANT CONFIGURATION ###
## STEAM ##
RUN --mount=type=cache,target=/var/cache/pacman/pkg \
    pacman -S --noconfirm steam && \
    # Cleanup
    paccache -rk1 && \
    rm -rf /usr/share/{info,man,doc}/*

## Steam Configs - Proton (Experimental flavor) ##
RUN mkdir -p "${NESTRI_HOME}/.local/share/Steam/config"
COPY packages/configs/steam/config.vdf "${NESTRI_HOME}/.local/share/Steam/config/"

## FLAVOR/VARIANT LAUNCH COMMAND ##
ENV NESTRI_LAUNCH_CMD="steam -tenfoot -cef-force-gpu"
### END OF FLAVOR/VARIANT CONFIGURATION ###

### REQUIRED DEFAULT ENTRYPOINT FOR FLAVOR/VARIANT ###
USER root
ENTRYPOINT ["supervisord", "-c", "/etc/nestri/supervisord.conf"]
