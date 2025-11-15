# Container build arguments #
ARG RUNNER_COMMON_IMAGE=runner-common:latest

#*********************#
# Final Runtime Stage #
#*********************#
FROM ${RUNNER_COMMON_IMAGE}

### FLAVOR/VARIANT CONFIGURATION ###
## HEROIC LAUNCHER ##
RUN --mount=type=cache,target=/var/cache/pacman/pkg \
    pacman -S --noconfirm heroic-games-launcher-bin && \
    # Cleanup
    paccache -rk1 && \
    rm -rf /usr/share/{info,man,doc}/*

## FLAVOR/VARIANT LAUNCH COMMAND ##
ENV NESTRI_LAUNCH_CMD="heroic"
### END OF FLAVOR/VARIANT CONFIGURATION ###

### REQUIRED DEFAULT ENTRYPOINT FOR FLAVOR/VARIANT ###
USER root
ENTRYPOINT ["supervisord", "-c", "/etc/nestri/supervisord.conf"]
