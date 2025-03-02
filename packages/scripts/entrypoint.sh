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

echo "Detecting GPU vendor..."
source /etc/nestri/gpu_helpers.sh

get_gpu_info

# Check for NVIDIA so we can apply a workaround
if [[ -n "${vendor_devices[nvidia]:-}" ]]; then
    echo "NVIDIA GPU detected, applying driver fix..."
    # Determine NVIDIA driver version from host
    if [ -f "/proc/driver/nvidia/version" ]; then
        NVIDIA_DRIVER_VERSION=$(head -n1 /proc/driver/nvidia/version | awk '{for(i=1;i<=NF;i++) if ($i ~ /^[0-9]+\.[0-9\.]+/) {print $i; exit}}')
    elif command -v nvidia-smi &> /dev/null; then
        NVIDIA_DRIVER_VERSION=$(nvidia-smi --version | grep -i 'driver version' | cut -d: -f2 | tr -d ' ')
    else
        echo "Failed to determine NVIDIA driver version. Exiting."
        exit 1
    fi

    NVIDIA_DRIVER_ARCH=$(uname -m)
    filename="NVIDIA-Linux-${NVIDIA_DRIVER_ARCH}-${NVIDIA_DRIVER_VERSION}.run"

    cd /tmp/
    if [ ! -f "${filename}" ]; then
        # Attempt multiple download sources
        if ! wget "https://international.download.nvidia.com/XFree86/Linux-${NVIDIA_DRIVER_ARCH}/${NVIDIA_DRIVER_VERSION}/${filename}"; then
            if ! wget "https://international.download.nvidia.com/tesla/${NVIDIA_DRIVER_VERSION}/${filename}"; then
                echo "Failed to download NVIDIA driver from both XFree86 and Tesla repositories"
                exit 1
            fi
        fi

        chmod +x "${filename}"
        # Install driver components without kernel modules
        sudo ./"${filename}" --silent --no-kernel-module --install-compat32-libs --no-nouveau-check --no-nvidia-modprobe --no-systemd --no-rpms --no-backup --no-check-for-alternate-installs
    fi
fi

echo "Switching to nestri user for application startup..."
exec sudo -E -u nestri /etc/nestri/entrypoint_nestri.sh
