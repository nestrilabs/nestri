#!/bin/bash
set -euo pipefail

declare container_runtime="none"
declare -A container_info=()

function get_container_info {
    container_runtime="none"
    container_info=()

    # Check for Apptainer/Singularity first (most specific)
    if [[ -n "${SINGULARITY_CONTAINER:-}" ]] || [[ -n "${APPTAINER_CONTAINER:-}" ]] || [[ -d "/.singularity.d" ]]; then
        container_runtime="apptainer"
        container_info["runtime"]="apptainer"
        container_info["version"]="${SINGULARITY_VERSION:-${APPTAINER_VERSION:-unknown}}"
        container_info["image"]="${SINGULARITY_CONTAINER:-${APPTAINER_CONTAINER:-unknown}}"
        return
    fi

    # Check for Podman
    if [[ "${container:-}" == "podman" ]] || [[ -f "/run/.containerenv" ]]; then
        container_runtime="podman"
        container_info["runtime"]="podman"

        # Try to get additional info from .containerenv
        if [[ -f "/run/.containerenv" ]]; then
            if grep -q "name=" "/run/.containerenv" 2>/dev/null; then
                container_info["name"]=$(grep "name=" "/run/.containerenv" | cut -d'=' -f2- | tr -d '"')
            fi
            if grep -q "image=" "/run/.containerenv" 2>/dev/null; then
                container_info["image"]=$(grep "image=" "/run/.containerenv" | cut -d'=' -f2- | tr -d '"')
            fi
        fi
        return
    fi

    # Check for Docker
    if [[ -f "/.dockerenv" ]] || grep -q "docker\|containerd" "/proc/1/cgroup" 2>/dev/null; then
        container_runtime="docker"
        container_info["runtime"]="docker"

        # Try to get hostname as container ID approximation
        if [[ -f "/etc/hostname" ]]; then
            container_info["hostname"]=$(cat /etc/hostname)
        fi

        # Check if we can detect if it's actually Docker vs other OCI runtime
        if grep -q "docker" "/proc/1/cgroup" 2>/dev/null; then
            container_info["detected_via"]="cgroup"
        elif [[ -f "/.dockerenv" ]]; then
            container_info["detected_via"]="dockerenv"
        fi
        return
    fi

    # If none of the above, check for general containerization signs
    if [[ -f "/proc/1/cgroup" ]] && grep -qE "docker|lxc|kubepods|containerd" "/proc/1/cgroup" 2>/dev/null; then
        container_runtime="unknown"
        container_info["runtime"]="unknown"
        container_info["detected_via"]="cgroup_generic"
        return
    fi
}

function debug_container_info {
    echo "Container Detection Results:"
    echo "> Runtime: $container_runtime"

    if [[ "$container_runtime" != "none" ]]; then
        for key in "${!container_info[@]}"; do
            echo ">> $key: ${container_info[$key]}"
        done
    else
        echo "> Status: Not running in a known container"
    fi
}

# # Usage examples:
# get_container_info
# debug_container_info

# # Get runtime
# echo "Container runtime: $container_runtime"
