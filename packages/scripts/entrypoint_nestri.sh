#!/bin/bash
set -euo pipefail

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

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

# Loads environment variables
load_envs() {
    if [[ -f /etc/nestri/envs.sh ]]; then
        log "Sourcing environment variables from envs.sh..."
        source /etc/nestri/envs.sh
    else
        log "Error: envs.sh not found at /etc/nestri/envs.sh"
        exit 1
    fi
}

# Configuration
MAX_RETRIES=3
RETRY_COUNT=0

# Kills process if running
kill_if_running() {
    local pid="$1"
    local name="$2"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        log "Killing existing $name process (PID: $pid)..."
        kill "$pid"
        wait "$pid" 2>/dev/null || true
    fi
}

# Starts nestri-server
start_nestri_server() {
    kill_if_running "${NESTRI_PID:-}" "nestri-server"

    log "Starting nestri-server..."
    nestri-server $NESTRI_PARAMS &
    NESTRI_PID=$!

    log "Waiting for Wayland display 'wayland-1'..."
    WAYLAND_SOCKET="${XDG_RUNTIME_DIR}/wayland-1"
    for ((i=1; i<=15; i++)); do
        if [[ -e "$WAYLAND_SOCKET" ]]; then
            log "Wayland display 'wayland-1' ready."
            sleep 3
            start_compositor
            return
        fi
        sleep 1
    done

    log "Error: Wayland display 'wayland-1' not available."
    increment_retry "nestri-server"
    restart_chain
}

# Starts compositor (gamescope) with Steam
start_compositor() {
    kill_if_running "${COMPOSITOR_PID:-}" "compositor"

    log "Starting compositor with Steam..."
    rm -rf /tmp/.X11-unix && mkdir -p /tmp/.X11-unix && chown nestri:nestri /tmp/.X11-unix
    WAYLAND_DISPLAY=wayland-1 gamescope --backend wayland -g -f -e --rt --mangoapp -W "${WIDTH}" -H "${HEIGHT}" -- steam-native -tenfoot -cef-force-gpu &
    COMPOSITOR_PID=$!

    log "Waiting for compositor to initialize..."
    COMPOSITOR_SOCKET="${XDG_RUNTIME_DIR}/gamescope-0"
    for ((i=1; i<=15; i++)); do
        if [[ -e "$COMPOSITOR_SOCKET" ]]; then
            log "Compositor initialized, gamescope-0 ready."
            sleep 2
            return
        fi
        sleep 1
    done

    log "Error: Compositor did not initialize."
    increment_retry "compositor"
    start_compositor
}

# Increments retry counter
increment_retry() {
    local component="$1"
    ((RETRY_COUNT++))
    if [[ "$RETRY_COUNT" -ge "$MAX_RETRIES" ]]; then
        log "Error: Max retries reached for $component."
        exit 1
    fi
}

# Restarts the chain
restart_chain() {
    log "Restarting nestri-server and compositor..."
    RETRY_COUNT=0
    start_nestri_server
}

# Cleans up processes
cleanup() {
    log "Terminating processes..."
    kill_if_running "${NESTRI_PID:-}" "nestri-server"
    kill_if_running "${COMPOSITOR_PID:-}" "compositor"
    exit 0
}

# Monitor processes for unexpected exits
main_loop() {
    trap cleanup SIGINT SIGTERM

    while true; do
        sleep 1
        # Check nestri-server
        if [[ -n "${NESTRI_PID:-}" ]] && ! kill -0 "${NESTRI_PID}" 2>/dev/null; then
            log "nestri-server died."
            increment_retry "nestri-server"
            restart_chain
        # Check compositor
        elif [[ -n "${COMPOSITOR_PID:-}" ]] && ! kill -0 "${COMPOSITOR_PID}" 2>/dev/null; then
            log "compositor died."
            increment_retry "compositor"
            start_compositor
        fi
    done
}

main() {
    load_envs
    parse_resolution "${RESOLUTION:-1920x1080}" || exit 1
    restart_chain
    main_loop
}

main