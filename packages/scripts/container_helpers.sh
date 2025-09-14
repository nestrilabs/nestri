#!/bin/bash
set -euo pipefail

declare container_runtime="none"
declare -Ag container_info=()

function detect_container_runtime {
    if [[ -n "${SINGULARITY_CONTAINER:-}" ]] || [[ -n "${APPTAINER_CONTAINER:-}" ]] || [[ -d "/.singularity.d" ]]; then
        echo "apptainer"
    elif [[ "${container:-}" == "podman" ]] || [[ -f "/run/.containerenv" ]]; then
        echo "podman"
    elif [[ -f "/.dockerenv" ]]; then
        echo "docker"
    else
        # General check for containerization signs
        if grep -qE "docker|lxc|kubepods|containerd" "/proc/1/cgroup" 2>/dev/null; then
            echo "unknown"
        else
            echo "none"
        fi
    fi
}

function collect_container_info {
    local runtime="$1"
    case "$runtime" in
        apptainer)
            container_info["runtime"]="apptainer"
            container_info["version"]="${SINGULARITY_VERSION:-${APPTAINER_VERSION:-unknown}}"
            container_info["image"]="${SINGULARITY_CONTAINER:-${APPTAINER_CONTAINER:-unknown}}"
            ;;
        podman)
            container_info["runtime"]="podman"
            if [[ -f "/run/.containerenv" ]]; then
                if grep -q "name=" "/run/.containerenv" 2>/dev/null; then
                    container_info["name"]=$(grep "^name=" "/run/.containerenv" | sed 's/^name=//' | tr -d '"' | xargs)
                fi
                if grep -q "image=" "/run/.containerenv" 2>/dev/null; then
                    container_info["image"]=$(grep "^image=" "/run/.containerenv" | sed 's/^image=//' | tr -d '"' | xargs)
                fi
            fi
            ;;
        docker)
            container_info["runtime"]="docker"
            container_info["detected_via"]="dockerenv"
            ;;
        unknown)
            container_info["runtime"]="unknown"
            container_info["detected_via"]="cgroup_generic"
            ;;
    esac
}

function get_container_info {
    container_runtime=$(detect_container_runtime)
    if [[ "${container_runtime}" != "none" ]]; then
        collect_container_info "$container_runtime"
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
# echo "Container runtime: ${container_runtime}"
