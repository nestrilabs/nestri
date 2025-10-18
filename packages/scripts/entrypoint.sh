#!/bin/bash
set -euo pipefail

# Common helpers as requirement
if [[ -f /etc/nestri/common.sh ]]; then
    source /etc/nestri/common.sh
else
    echo "Error: Common script not found at /etc/nestri/common.sh" >&2
    exit 1
fi

# Configuration
CACHE_DIR="${NESTRI_HOME}/.cache/nestri"
NVIDIA_INSTALLER_DIR="/tmp"
TIMEOUT_SECONDS=10
ENTCMD_PREFIX=""

# Ensures user directory ownership
chown_user_directory() {
    if ! $ENTCMD_PREFIX chown "${NESTRI_USER}:${NESTRI_USER}" "${NESTRI_HOME}" 2>/dev/null; then
        echo "Error: Failed to change ownership of ${NESTRI_HOME} to ${NESTRI_USER}:${NESTRI_USER}" >&2
        return 1
    fi
    # Also apply to .cache separately
    if [[ -d "${NESTRI_HOME}/.cache" ]]; then
        if ! $ENTCMD_PREFIX chown "${NESTRI_USER}:${NESTRI_USER}" "${NESTRI_HOME}/.cache" 2>/dev/null; then
            echo "Error: Failed to change ownership of ${NESTRI_HOME}/.cache to ${NESTRI_USER}:${NESTRI_USER}" >&2
            return 1
        fi
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

# Prepares environment for namespace-less applications (like Steam)
setup_namespaceless() {
    $ENTCMD_PREFIX rm -f /run/systemd/container || true
    $ENTCMD_PREFIX mkdir -p /run/pressure-vessel || true
}

# Ensures cache directory exists
setup_cache() {
    log "Setting up cache directory at $CACHE_DIR..."
    mkdir -p "$CACHE_DIR" || {
        log "Warning: Failed to create cache directory, continuing.."
        return 1
    }
    $ENTCMD_PREFIX chown "${NESTRI_USER}:${NESTRI_USER}" "$CACHE_DIR" 2>/dev/null || {
        log "Warning: Failed to set cache directory ownership, continuing.."
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
            $ENTCMD_PREFIX chown "${NESTRI_USER}:${NESTRI_USER}" "$cached_file" 2>/dev/null || \
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
    $ENTCMD_PREFIX bash ./"$filename" \
        --silent \
        --skip-depmod \
        --skip-module-unload \
        --no-kernel-module \
        --install-compat32-libs \
        --no-nouveau-check \
        --no-nvidia-modprobe \
        --no-systemd \
        --no-rpms \
        --no-backup \
        --no-distro-scripts \
        --no-libglx-indirect \
        --no-install-libglvnd \
        --no-check-for-alternate-installs || {
        log "Error: NVIDIA driver installation failed."
        return 1
    }

    log "NVIDIA driver installation completed."
    return 0
}

log_container_info() {
    if ! declare -p container_runtime &>/dev/null; then
        log "Warning: container_runtime is not defined"
        return
    fi

    if [[ "${container_runtime:-none}" != "none" ]]; then
        log "Detected container:"
        log "> ${container_runtime}"
    else
        log "No container runtime detected"
    fi
}

log_gpu_info() {
    if ! declare -p vendor_devices &>/dev/null; then
        log "Warning: vendor_devices array is not defined"
        return
    fi

    log "Detected GPUs:"
    for vendor in "${!vendor_devices[@]}"; do
        log "> $vendor: ${vendor_devices[$vendor]}"
    done
}

configure_ssh() {
    # Return early if SSH not enabled
    if [ -z "${SSH_ENABLE_PORT+x}" ] || [ "${SSH_ENABLE_PORT:-0}" -eq 0 ]; then
        return 0
    fi

    # Check if we have required key
    if [ -z "${SSH_ALLOWED_KEY+x}" ] || [ -z "${SSH_ALLOWED_KEY}" ]; then
        return 0
    fi

    log "Configuring SSH server on port ${SSH_ENABLE_PORT} with public key authentication"

    # Ensure SSH host keys exist
    $ENTCMD_PREFIX ssh-keygen -A 2>/dev/null || {
        log "Error: Failed to generate SSH host keys"
        return 1
    }

    # Create .ssh directory and authorized_keys file for nestri user
    mkdir -p "${NESTRI_HOME}/.ssh"
    echo "${SSH_ALLOWED_KEY}" > "${NESTRI_HOME}/.ssh/authorized_keys"
    chmod 700 "${NESTRI_HOME}/.ssh"
    chmod 600 "${NESTRI_HOME}/.ssh/authorized_keys"
    chown -R "${NESTRI_USER}:${NESTRI_USER}" "${NESTRI_HOME}/.ssh"

    # Configure secure SSH settings
    {
        echo "PasswordAuthentication no"
        echo "PermitRootLogin no"
        echo "ChallengeResponseAuthentication no"
        echo "UsePAM no"
        echo "PubkeyAuthentication yes"
    } | while read -r line; do
        if ! grep -qF "$line" /etc/ssh/sshd_config; then
            printf '%s\n' "$line" | $ENTCMD_PREFIX tee -a /etc/ssh/sshd_config >/dev/null
        fi
    done

    # Start SSH server
    log "Starting SSH server on port ${SSH_ENABLE_PORT}"
    $ENTCMD_PREFIX /usr/sbin/sshd -D -p "${SSH_ENABLE_PORT}" &
    SSH_PID=$!

    # Verify the process started
    if ! ps -p $SSH_PID > /dev/null 2>&1; then
        log "Error: SSH server failed to start"
        return 1
    fi

    log "SSH server started with PID ${SSH_PID}"
    return 0
}

main() {
    # Wait for required sockets
    wait_for_socket "${NESTRI_XDG_RUNTIME_DIR}/dbus-1" "DBus" || exit 1
    wait_for_socket "${NESTRI_XDG_RUNTIME_DIR}/pipewire-0" "PipeWire" || exit 1

    # Start by getting the container we are running under
    get_container_info || {
        log "Warning: Failed to detect container information"
    }
    log_container_info

    if [[ "$container_runtime" != "apptainer" ]]; then
        ENTCMD_PREFIX="sudo -E"
    fi

    # Setup cache now
    setup_cache

    # Configure SSH
    if [ -n "${SSH_ENABLE_PORT+x}" ] && [ "${SSH_ENABLE_PORT:-0}" -ne 0 ] && \
       [ -n "${SSH_ALLOWED_KEY+x}" ] && [ -n "${SSH_ALLOWED_KEY}" ]; then
        if ! configure_ssh; then
            log "Error: SSH configuration failed with given variables - exiting"
            exit 1
        fi
    else
        log "SSH not configured (missing SSH_ENABLE_PORT or SSH_ALLOWED_KEY)"
    fi

    # Get and detect GPU(s)
    get_gpu_info || {
        log "Error: Failed to detect GPU information"
        exit 1
    }
    log_gpu_info

    # Handle NVIDIA GPU
    if [[ -n "${vendor_devices[nvidia]:-}" ]]; then
        log "NVIDIA GPU(s) detected, applying driver fix.."

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
                log "Other GPUs (AMD or Intel) detected, continuing without NVIDIA driver"
            else
                log "No other GPUs detected, exiting due to NVIDIA driver version failure"
                exit 1
            fi
        else
            log "Detected NVIDIA driver version: $nvidia_driver_version"

            # Get installer
            local arch=$(uname -m)
            local filename="NVIDIA-Linux-${arch}-${nvidia_driver_version}.run"
            cd "$NVIDIA_INSTALLER_DIR" || {
                log "Error: Failed to change to $NVIDIA_INSTALLER_DIR."
                exit 1
            }
            get_nvidia_installer "$nvidia_driver_version" "$arch" || {
                # Check for other GPU vendors before exiting
                if [[ -n "${vendor_devices[amd]:-}" || -n "${vendor_devices[intel]:-}" ]]; then
                    log "Other GPUs (AMD or Intel) detected, continuing without NVIDIA driver"
                else
                    log "No other GPUs detected, exiting due to NVIDIA installer failure"
                    exit 1
                fi
            }

            # Install driver
            install_nvidia_driver "$filename" || {
                # Check for other GPU vendors before exiting
                if [[ -n "${vendor_devices[amd]:-}" || -n "${vendor_devices[intel]:-}" ]]; then
                    log "Other GPUs (AMD or Intel) detected, continuing without NVIDIA driver"
                else
                    log "No other GPUs detected, exiting due to NVIDIA driver installation failure"
                    exit 1
                fi
            }
        fi
    fi

    # Make sure gamescope has CAP_SYS_NICE capabilities if available
    log "Checking for CAP_SYS_NICE availability.."
    if capsh --print | grep -q "Current:.*cap_sys_nice"; then
        log "Giving gamescope compositor CAP_SYS_NICE permissions.."
        setcap 'CAP_SYS_NICE+eip' /usr/bin/gamescope 2>/dev/null || {
            log "Warning: Failed to set CAP_SYS_NICE on gamescope, continuing without it.."
        }
    else
        log "Skipping CAP_SYS_NICE for gamescope, capability not available"
    fi

    # Handle user directory permissions
    log "Ensuring user directory permissions..."
    chown_user_directory || exit 1

    # Setup namespaceless env if needed for container runtime
    if [[ "$container_runtime" != "podman" ]]; then
        log "Applying namespace-less configuration"
        setup_namespaceless
    fi

    # Make sure /run/udev/ directory exists with /run/udev/control, needed for virtual controller support
    if [[ ! -d "/run/udev" || ! -e "/run/udev/control" ]]; then
        log "Creating /run/udev directory and control file..."
        $ENTCMD_PREFIX mkdir -p /run/udev || {
            log "Error: Failed to create /run/udev directory"
            exit 1
        }
        $ENTCMD_PREFIX touch /run/udev/control || {
            log "Error: Failed to create /run/udev/control file"
            exit 1
        }
    fi

    # Switch to nestri runner entrypoint
    log "Switching to application startup entrypoint..."
    if [[ ! -f /etc/nestri/entrypoint_nestri.sh ]]; then
        log "Error: Application entrypoint script /etc/nestri/entrypoint_nestri.sh not found"
        exit 1
    fi
    if [[ "$container_runtime" == "apptainer" ]]; then
        exec /etc/nestri/entrypoint_nestri.sh
    else
        exec sudo -E -u "${NESTRI_USER}" /etc/nestri/entrypoint_nestri.sh
    fi
}

# Trap signals for clean exit
trap 'log "Received termination signal, exiting.."; exit 0' SIGINT SIGTERM

main
