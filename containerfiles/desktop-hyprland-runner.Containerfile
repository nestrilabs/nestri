# Container build arguments #
ARG RUNNER_COMMON_IMAGE=runner-common:latest

#*********************#
# Final Runtime Stage #
#*********************#
FROM ${RUNNER_COMMON_IMAGE}

### FLAVOR/VARIANT CONFIGURATION ###
## Hyprland Desktop ##p
RUN --mount=type=cache,target=/var/cache/pacman/pkg \
    pacman -S --noconfirm --needed hyprland hyprpaper hyprlock hypridle hyprpicker waybar waypaper xdg-desktop-portal-gtk xdg-desktop-portal-hyprland && \
    # Cleanup
    paccache -rk1 && \
    rm -rf /usr/share/{info,man,doc}/*

## FLAVOR/VARIANT LAUNCH COMMAND ##
ENV NESTRI_LAUNCH_COMPOSITOR="Hyprland"
### END OF FLAVOR/VARIANT CONFIGURATION ###

### REQUIRED DEFAULT ENTRYPOINT FOR FLAVOR/VARIANT ###
USER root
ENTRYPOINT ["supervisord", "-c", "/etc/nestri/supervisord.conf"]
