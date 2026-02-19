#!/bin/bash

function log {
    printf '[%s] %s\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$*"
}

if [[ ! -f /etc/nestri/envs.sh ]]; then
    log "Error: Environment variables script not found at /etc/nestri/envs.sh"
    exit 1
fi
source /etc/nestri/envs.sh || { log "Error: Failed to source /etc/nestri/envs.sh"; exit 1; }

if [[ ! -f /etc/nestri/container_helpers.sh ]]; then
    log "Error: Container helpers script not found at /etc/nestri/container_helpers.sh"
    exit 1
fi
source /etc/nestri/container_helpers.sh || { log "Error: Failed to source /etc/nestri/container_helpers.sh"; exit 1; }

if [[ ! -f /etc/nestri/gpu_helpers.sh ]]; then
    log "Error: GPU helpers script not found at /etc/nestri/gpu_helpers.sh"
    exit 1
fi
source /etc/nestri/gpu_helpers.sh || { log "Error: Failed to source /etc/nestri/gpu_helpers.sh"; exit 1; }

# Parses resolution string
parse_resolution() {
    local resolution="$1"
    if [[ -z "$resolution" ]]; then
        log "Error: No resolution provided"
        return 1
    fi

    IFS='x' read -r width height <<< "$resolution"
    if ! [[ "$width" =~ ^[0-9]+$ ]] || ! [[ "$height" =~ ^[0-9]+$ ]]; then
        log "Error: Invalid resolution format. Expected: WIDTHxHEIGHT (e.g., 1920x1080), got: $resolution"
        return 1
    fi

    export WIDTH="$width"
    export HEIGHT="$height"
    return 0
}
parse_resolution "${RESOLUTION:-1280x720}" || exit 1
