#!/bin/bash
set -euo pipefail

# Wait for dbus socket to be ready
echo "Waiting for DBus system bus socket..."
DBUS_SOCKET="/run/dbus/system_bus_socket"
for _ in {1..10}; do # Wait up to 10 seconds
    if [ -e "$DBUS_SOCKET" ]; then
        echo "DBus system bus socket is ready."
        break
    fi
    sleep 1
done
if [ ! -e "$DBUS_SOCKET" ]; then
    echo "Error: DBus system bus socket did not appear. Exiting."
    exit 1
fi

# Wait for PipeWire to be ready
echo "Waiting for PipeWire socket..."
PIPEWIRE_SOCKET="/run/user/${UID}/pipewire-0"
for _ in {1..10}; do # Wait up to 10 seconds
    if [ -e "$PIPEWIRE_SOCKET" ]; then
        echo "PipeWire socket is ready."
        break
    fi
    sleep 1
done
if [ ! -e "$PIPEWIRE_SOCKET" ]; then
    echo "Error: PipeWire socket did not appear. Exiting."
    exit 1
fi

echo "Detecting GPU vendor and installing necessary GStreamer plugins..."
source /etc/nestri/gpu_helpers.sh

get_gpu_info

# Check vendors in priority order
if [[ -n "${vendor_devices[nvidia]:-}" ]]; then
    echo "NVIDIA GPU detected. Assuming drivers are linked"
elif [[ -n "${vendor_devices[intel]:-}" ]]; then
    echo "Intel GPU detected, installing required packages..."
    pacman -Sy --noconfirm gstreamer-vaapi gst-plugin-va gst-plugin-qsv
    pacman -Sy --noconfirm vpl-gpu-rt
elif [[ -n "${vendor_devices[amd]:-}" ]]; then
    echo "AMD GPU detected, installing required packages..."
    pacman -Sy --noconfirm gstreamer-vaapi gst-plugin-va
else
    echo "Unknown GPU vendor. No additional packages will be installed"
fi

# Clean up remainders
echo "Cleaning up old package cache..."
paccache -rk1

echo "Switching to nestri user for application startup..."
# Make sure user home dir is owned properly
chown ${USER}:${USER} /home/${USER}
exec sudo -E -u nestri /etc/nestri/entrypoint_nestri.sh
