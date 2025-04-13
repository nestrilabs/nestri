#!/bin/bash
set -euo pipefail

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

# Ensures user directory ownership
chown_user_directory() {
    local user_group="$(id -nu):$(id -ng)"
    chown -f "$user_group" ~ 2>/dev/null ||
        sudo chown -f "$user_group" ~ 2>/dev/null ||
        chown -R -f -h --no-preserve-root "$user_group" ~ 2>/dev/null ||
        sudo chown -R -f -h --no-preserve-root "$user_group" ~ 2>/dev/null ||
        log "Warning: Failed to change user directory permissions, there may be permission issues, continuing..."
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

# Starts compositor (labwc)
start_compositor() {
    kill_if_running "${COMPOSITOR_PID:-}" "compositor"

    log "Pre-configuring compositor..."
    mkdir -p "${HOME}/.config/labwc/"
    cat > ~/.config/labwc/rc.xml << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<labwc_config>
    <keyboard><default/></keyboard>
    <mouse><default/>
        <context name="Root">
            <mousebind button="Left" action="Press"/>
            <mousebind button="Right" action="Press"/>
            <mousebind button="Middle" action="Press"/>
        </context>
    </mouse>
</labwc_config>
EOF
    echo '<?xml version="1.0" encoding="UTF-8"?><openbox_menu></openbox_menu>' > ~/.config/labwc/menu.xml

    log "Starting compositor..."
    rm -rf /tmp/.X11-unix && mkdir -p /tmp/.X11-unix && chown nestri:nestri /tmp/.X11-unix
    WAYLAND_DISPLAY=wayland-1 WLR_BACKENDS=wayland labwc &
    COMPOSITOR_PID=$!

    log "Waiting for compositor to initialize..."
    COMPOSITOR_SOCKET="${XDG_RUNTIME_DIR}/wayland-0"
    for ((i=1; i<=15; i++)); do
        if [[ -e "$COMPOSITOR_SOCKET" ]]; then
            log "Compositor initialized, wayland-0 ready."
            sleep 2
            start_wlr_randr
            return
        fi
        sleep 1
    done

    log "Error: Compositor did not initialize."
    increment_retry "compositor"
    start_compositor
}

# Configures resolution with wlr-randr
start_wlr_randr() {
    log "Configuring resolution with wlr-randr..."
    OUTPUT_NAME=$(WAYLAND_DISPLAY=wayland-0 wlr-randr --json | jq -r '.[] | select(.enabled == true) | .name' | head -n 1)
    if [[ -z "$OUTPUT_NAME" ]]; then
        log "Error: No enabled outputs detected."
        exit 1
    fi

    local WLR_RETRIES=0
    while ! WAYLAND_DISPLAY=wayland-0 wlr-randr --output "$OUTPUT_NAME" --custom-mode "$RESOLUTION"; do
        log "Error: Failed to configure wlr-randr. Retrying..."
        ((WLR_RETRIES++))
        if [[ "$WLR_RETRIES" -ge "$MAX_RETRIES" ]]; then
            log "Error: Max retries reached for wlr-randr."
            exit 1
        fi
        sleep 2
    done
    log "wlr-randr configuration successful."
    sleep 2
}

# Starts Steam
start_steam() {
    kill_if_running "${STEAM_PID:-}" "Steam"

    log "Starting Steam with -tenfoot..."
    steam-native -tenfoot &
    STEAM_PID=$!

    sleep 2
    if ! kill -0 "$STEAM_PID" 2>/dev/null; then
        log "Error: Steam failed to start."
        return 1
    fi
    log "Steam started successfully."
    return 0
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
    kill_if_running "${STEAM_PID:-}" "Steam"
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
            start_steam || increment_retry "Steam"
        # Check compositor
        elif [[ -n "${COMPOSITOR_PID:-}" ]] && ! kill -0 "${COMPOSITOR_PID}" 2>/dev/null; then
            log "compositor died."
            increment_retry "compositor"
            start_compositor
            start_steam || increment_retry "Steam"
        # Check Steam
        elif [[ -n "${STEAM_PID:-}" ]] && ! kill -0 "${STEAM_PID}" 2>/dev/null; then
            log "Steam died."
            increment_retry "Steam"
            start_steam || increment_retry "Steam"
        fi
    done
}

main() {
    chown_user_directory
    load_envs
    #parse_resolution "${RESOLUTION:-1920x1080}" || exit 1 # Not used currently
    restart_chain
    start_steam || increment_retry "Steam"
    main_loop
}

main