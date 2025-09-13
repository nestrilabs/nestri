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
