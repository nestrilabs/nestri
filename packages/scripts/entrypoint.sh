#!/bin/bash
set -euo pipefail

# Configuration
CACHE_DIR="/home/nestri/.cache/nvidia"
NVIDIA_INSTALLER_DIR="/tmp"
TIMEOUT_SECONDS=10

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

# Ensures user directory ownership
chown_user_directory() {
    local user_group="${USER}:${GID}"
    if ! chown -R -h --no-preserve-root "$user_group" "${HOME}" 2>/dev/null; then
        echo "Error: Failed to change ownership of ${HOME} to ${user_group}" >&2
        return 1
    fi
    return 0
}

# Waits for a given socket to be ready
wait_for_socket() {
    local socket_path="$1"
    local name="$2"
    log "Waiting for $name socket at $socket_path..."
    for ((i=1; i<=TIMEOUT_SECONDS; i++)); do
        if [[ -e "$socket_path" ]]; then
            log "$name socket is ready."
            return 0
        fi
        sleep 1
    done
    log "Error: $name socket did not appear after ${TIMEOUT_SECONDS}s."
    return 1
}

# Ensures cache directory exists
setup_cache() {
    log "Setting up NVIDIA driver cache directory at $CACHE_DIR..."
    mkdir -p "$CACHE_DIR" || {
        log "Warning: Failed to create cache directory, continuing without cache."
        return 1
    }
    chown nestri:nestri "$CACHE_DIR" 2>/dev/null || {
        log "Warning: Failed to set cache directory ownership, continuing..."
    }
}

# Grabs NVIDIA driver installer
get_nvidia_installer() {
    local driver_version="$1"
    local arch="$2"
    local filename="NVIDIA-Linux-${arch}-${driver_version}.run"
    local cached_file="${CACHE_DIR}/${filename}"
    local tmp_file="${NVIDIA_INSTALLER_DIR}/${filename}"

    # Check cache
    if [[ -f "$cached_file" ]]; then
        log "Found cached NVIDIA installer at $cached_file."
        cp "$cached_file" "$tmp_file" || {
            log "Warning: Failed to copy cached installer, proceeding with download."
            rm -f "$cached_file" 2>/dev/null
        }
    fi

    # Download if not in tmp
    if [[ ! -f "$tmp_file" ]]; then
        log "Downloading NVIDIA driver installer ($filename)..."
        local urls=(
            "https://international.download.nvidia.com/XFree86/Linux-${arch}/${driver_version}/${filename}"
            "https://international.download.nvidia.com/tesla/${driver_version}/${filename}"
        )
        local success=0
        for url in "${urls[@]}"; do
            if wget -q --show-progress "$url" -O "$tmp_file"; then
                success=1
                break
            fi
            log "Failed to download from $url, trying next source..."
        done

        if [[ "$success" -eq 0 ]]; then
            log "Error: Failed to download NVIDIA driver from all sources."
            return 1
        fi

        # Cache the downloaded file
        cp "$tmp_file" "$cached_file" 2>/dev/null && \
            chown nestri:nestri "$cached_file" 2>/dev/null || \
            log "Warning: Failed to cache NVIDIA driver, continuing..."
    fi

    chmod +x "$tmp_file" || {
        log "Error: Failed to make NVIDIA installer executable."
        return 1
    }
    return 0
}

# Installs the NVIDIA driver
install_nvidia_driver() {
    local filename="$1"
    log "Installing NVIDIA driver components from $filename..."
    sudo ./"$filename" \
        --silent \
        --no-kernel-module \
        --install-compat32-libs \
        --no-nouveau-check \
        --no-nvidia-modprobe \
        --no-systemd \
        --no-rpms \
        --no-backup \
        --no-check-for-alternate-installs || {
        log "Error: NVIDIA driver installation failed."
        return 1
    }
    log "NVIDIA driver installation completed."
    return 0
}

function log_gpu_info {
    log "Detected GPUs:"
    for vendor in "${!vendor_devices[@]}"; do
        log "> $vendor: ${vendor_devices[$vendor]}"
    done
}

main() {
    # Wait for required sockets
    wait_for_socket "/run/dbus/system_bus_socket" "DBus" || exit 1
    wait_for_socket "/run/user/${UID}/pipewire-0" "PipeWire" || exit 1

    # Load GPU helpers and detect GPU
    log "Detecting GPU vendor..."
    if [[ ! -f /etc/nestri/gpu_helpers.sh ]]; then
        log "Error: GPU helpers script not found at /etc/nestri/gpu_helpers.sh."
        exit 1
    fi
    source /etc/nestri/gpu_helpers.sh
    get_gpu_info || {
        log "Error: Failed to detect GPU information."
        exit 1
    }
    log_gpu_info

    # Handle NVIDIA GPU
    if [[ -n "${vendor_devices[nvidia]:-}" ]]; then
        log "NVIDIA GPU(s) detected, applying driver fix..."

        # Determine NVIDIA driver version
        local nvidia_driver_version=""
        if [[ -f "/proc/driver/nvidia/version" ]]; then
            nvidia_driver_version=$(awk '/NVIDIA/ {for(i=1;i<=NF;i++) if ($i ~ /^[0-9]+\.[0-9\.]+/) {print $i; exit}}' /proc/driver/nvidia/version | head -n1)
        elif command -v nvidia-smi >/dev/null 2>&1; then
            nvidia_driver_version=$(nvidia-smi --version | grep -i 'driver version' | cut -d: -f2 | tr -d ' ')
        fi

        if [[ -z "$nvidia_driver_version" ]]; then
            log "Error: Failed to determine NVIDIA driver version."
            # Check for other GPU vendors before exiting
            if [[ -n "${vendor_devices[amd]:-}" || -n "${vendor_devices[intel]:-}" ]]; then
                log "Other GPUs (AMD or Intel) detected, continuing without NVIDIA driver."
            else
                log "No other GPUs detected, exiting due to NVIDIA driver version failure."
                exit 1
            fi
        else
            log "Detected NVIDIA driver version: $nvidia_driver_version"

            # Set up cache and get installer
            setup_cache
            local arch=$(uname -m)
            local filename="NVIDIA-Linux-${arch}-${nvidia_driver_version}.run"
            cd "$NVIDIA_INSTALLER_DIR" || {
                log "Error: Failed to change to $NVIDIA_INSTALLER_DIR."
                exit 1
            }
            get_nvidia_installer "$nvidia_driver_version" "$arch" || {
                # Check for other GPU vendors before exiting
                if [[ -n "${vendor_devices[amd]:-}" || -n "${vendor_devices[intel]:-}" ]]; then
                    log "Other GPUs (AMD or Intel) detected, continuing without NVIDIA driver."
                else
                    log "No other GPUs detected, exiting due to NVIDIA installer failure."
                    exit 1
                fi
            }

            # Install driver
            install_nvidia_driver "$filename" || {
                # Check for other GPU vendors before exiting
                if [[ -n "${vendor_devices[amd]:-}" || -n "${vendor_devices[intel]:-}" ]]; then
                    log "Other GPUs (AMD or Intel) detected, continuing without NVIDIA driver."
                else
                    log "No other GPUs detected, exiting due to NVIDIA driver installation failure."
                    exit 1
                fi
            }
        fi
    fi

    # Make sure gamescope has CAP_SYS_NICE capabilities if available
    log "Checking for CAP_SYS_NICE availability..."
    if capsh --print | grep -q "Current:.*cap_sys_nice"; then
        log "Giving gamescope compositor CAP_SYS_NICE permissions..."
        setcap 'CAP_SYS_NICE+eip' /usr/bin/gamescope 2>/dev/null || {
            log "Warning: Failed to set CAP_SYS_NICE on gamescope, continuing without it..."
        }
    else
        log "Skipping CAP_SYS_NICE for gamescope, capability not available..."
    fi

    # Handle user directory permissions
    log "Ensuring user directory permissions..."
    chown_user_directory || exit 1

    # Switch to nestri user
    log "Switching to nestri user for application startup..."
    if [[ ! -x /etc/nestri/entrypoint_nestri.sh ]]; then
        log "Error: Entry point script /etc/nestri/entrypoint_nestri.sh not found or not executable."
        exit 1
    fi
    exec sudo -E -u nestri /etc/nestri/entrypoint_nestri.sh
}

# Trap signals for clean exit
trap 'log "Received termination signal, exiting..."; exit 1' SIGINT SIGTERM

main