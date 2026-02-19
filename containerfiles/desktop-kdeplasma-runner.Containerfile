# Container build arguments #
ARG RUNNER_COMMON_IMAGE=runner-common:latest

#*********************#
# Final Runtime Stage #
#*********************#
FROM ${RUNNER_COMMON_IMAGE}

### FLAVOR/VARIANT CONFIGURATION ###
## KDE Plasma Desktop ##
RUN --mount=type=cache,target=/var/cache/pacman/pkg \
    pacman -S --noconfirm --needed plasma-desktop plasma-wayland-protocols kscreen konsole && \
    # Cleanup
    paccache -rk1 && \
    rm -rf /usr/share/{info,man,doc}/*

## Custom wrapper launch script
COPY <<-'EOT' /tmp/nestri/plasmadesktop-launcher
#!/bin/bash
set -euo pipefail

mkdir -p /tmp/nestri
sudo -E chown -R "${NESTRI_USER}:${NESTRI_USER}" /tmp/nestri
cat <<EOF > /tmp/nestri/kwin_wayland_wrapper
#!/bin/sh
/usr/bin/kwin_wayland_wrapper --no-lockscreen --width $WIDTH --height $HEIGHT --xwayland \$@
EOF
chmod a+x /tmp/nestri/kwin_wayland_wrapper
export PATH=/tmp/nestri/:$PATH

dbus-launch startplasma-wayland

rm /tmp/nestri/kwin_wayland_wrapper
EOT
RUN chmod +x /tmp/nestri/plasmadesktop-launcher

## FLAVOR/VARIANT LAUNCH COMMAND ##
ENV NESTRI_LAUNCH_COMPOSITOR="/tmp/nestri/plasmadesktop-launcher"
### END OF FLAVOR/VARIANT CONFIGURATION ###
