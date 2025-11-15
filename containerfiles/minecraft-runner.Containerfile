# Container build arguments #
ARG RUNNER_COMMON_IMAGE=runner-common:latest

#*********************#
# Final Runtime Stage #
#*********************#
FROM ${RUNNER_COMMON_IMAGE}

### FLAVOR/VARIANT CONFIGURATION ###
## MINECRAFT ##
RUN --mount=type=cache,target=/var/cache/pacman/pkg \
    pacman -S --noconfirm paru && \
    sudo -H -u ${NESTRI_USER} paru -S --noconfirm aur/minecraft-launcher && \
    # Cleanup
    paccache -rk1 && \
    rm -rf /usr/share/{info,man,doc}/*

## FLAVOR/VARIANT LAUNCH COMMAND ##
ENV NESTRI_LAUNCH_CMD="minecraft-launcher"
### END OF FLAVOR/VARIANT CONFIGURATION ###

### REQUIRED DEFAULT ENTRYPOINT FOR FLAVOR/VARIANT ###
USER root
ENTRYPOINT ["supervisord", "-c", "/etc/nestri/supervisord.conf"]
