#!/bin/bash

# Common helpers as requirement
if [[ -f /etc/nestri/common.sh ]]; then
    source /etc/nestri/common.sh
else
    echo "Error: Common script not found at /etc/nestri/common.sh" >&2
    exit 1
fi

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

# Configuration
MAX_RETRIES=3
RETRY_COUNT=0
WAYLAND_READY_DELAY=3

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

# Starts up Steam namespace-less live-patcher
start_steam_namespaceless_patcher() {
    kill_if_running "${PATCHER_PID:-}" "steam-patcher"

    local entrypoints=(
        "${HOME}/.local/share/Steam/steamrt64/steam-runtime-steamrt/_v2-entry-point"
        "${HOME}/.local/share/Steam/steamapps/common/SteamLinuxRuntime_soldier/_v2-entry-point"
        "${HOME}/.local/share/Steam/steamapps/common/SteamLinuxRuntime_sniper/_v2-entry-point"
        # < Add more entrypoints here if needed >
    )
    local custom_entrypoint="/etc/nestri/_v2-entry-point"
    local temp_entrypoint="/tmp/_v2-entry-point.padded"

    if [[ ! -f "$custom_entrypoint" ]]; then
        log "Error: Custom _v2-entry-point not found at $custom_entrypoint"
        exit 1
    fi

    log "Starting Steam _v2-entry-point patcher..."
    (
        while true; do
            for i in "${!entrypoints[@]}"; do
                local steam_entrypoint="${entrypoints[$i]}"

                if [[ -f "$steam_entrypoint" ]]; then
                    # Get original file size
                    local original_size
                    original_size=$(stat -c %s "$steam_entrypoint" 2>/dev/null)
                    if [[ -z "$original_size" ]] || [[ "$original_size" -eq 0 ]]; then
                        log "Warning: Could not determine size of $steam_entrypoint, retrying..."
                        continue
                    fi

                    # Copy custom entrypoint to temp location
                    cp "$custom_entrypoint" "$temp_entrypoint" 2>/dev/null || {
                        log "Warning: Failed to copy custom entrypoint to $temp_entrypoint"
                        continue
                    }

                    # Pad the temporary file to match original size
                    if (( $(stat -c %s "$temp_entrypoint") < original_size )); then
                        truncate -s "$original_size" "$temp_entrypoint" 2>/dev/null || {
                            log "Warning: Failed to pad $temp_entrypoint to $original_size bytes"
                            continue
                        }
                    fi

                    # Copy padded file to Steam's entrypoint, if contents differ
                    if ! cmp -s "$temp_entrypoint" "$steam_entrypoint"; then
                        cp "$temp_entrypoint" "$steam_entrypoint" 2>/dev/null || {
                            log "Warning: Failed to patch $steam_entrypoint"
                        }
                    fi
                fi
            done

            # Sleep for 1s
            sleep 1
        done
    ) &
    PATCHER_PID=$!
    log "Steam _v2-entry-point patcher started (PID: $PATCHER_PID)"
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
            log "Wayland display 'wayland-1' ready"
            sleep "${WAYLAND_READY_DELAY:-3}"
            start_compositor
            return
        fi
        sleep 1
    done

    log "Error: Wayland display 'wayland-1' not available"
    
    # Workaround for gstreamer being bit slow at times
    log "Clearing gstreamer cache.."
    rm -rf "${HOME}/.cache/gstreamer-1.0" 2>/dev/null || true

    increment_retry "nestri-server"
    restart_chain
}

# Starts compositor with optional application
start_compositor() {
    kill_if_running "${COMPOSITOR_PID:-}" "compositor"
    kill_if_running "${APP_PID:-}" "application"

    # Set default values only if variables are unset (not empty)
    if [[ -z "${NESTRI_LAUNCH_CMD+x}" ]]; then
        NESTRI_LAUNCH_CMD="steam-native -tenfoot -cef-force-gpu"
    fi
    if [[ -z "${NESTRI_LAUNCH_COMPOSITOR+x}" ]]; then
        NESTRI_LAUNCH_COMPOSITOR="gamescope --backend wayland --force-grab-cursor -g -f --rt --mangoapp -W ${WIDTH} -H ${HEIGHT} -r ${FRAMERATE:-60}"
    fi

    # Start Steam patcher only if Steam command is present and if needed for container runtime
    if [[ -n "${NESTRI_LAUNCH_CMD}" ]] && [[ "$NESTRI_LAUNCH_CMD" == *"steam"* ]] && [[ "${container_runtime:-}" != "podman" ]]; then
        start_steam_namespaceless_patcher
    fi

    # Launch compositor if configured
    if [[ -n "${NESTRI_LAUNCH_COMPOSITOR}" ]]; then
        local compositor_cmd="$NESTRI_LAUNCH_COMPOSITOR"
        local is_gamescope=false

        # Check if this is a gamescope command
        if [[ "$compositor_cmd" == *"gamescope"* ]]; then
            is_gamescope=true
            # Append application command for gamescope if needed
            if [[ -n "$NESTRI_LAUNCH_CMD" ]] && [[ "$compositor_cmd" != *" -- "* ]]; then
                # If steam in launch command, enable gamescope integration via -e
                if [[ "$NESTRI_LAUNCH_CMD" == *"steam"* ]]; then
                    compositor_cmd+=" -e"
                fi
                compositor_cmd+=" -- $NESTRI_LAUNCH_CMD"
            fi
        fi

        log "Starting compositor: $compositor_cmd"
        WAYLAND_DISPLAY=wayland-1 /bin/bash -c "$compositor_cmd" &
        COMPOSITOR_PID=$!

        # Wait for appropriate socket based on compositor type
        if $is_gamescope; then
            COMPOSITOR_SOCKET="${XDG_RUNTIME_DIR}/gamescope-0"
            log "Waiting for gamescope socket..."
        else
            COMPOSITOR_SOCKET="${XDG_RUNTIME_DIR}/wayland-0"
            log "Waiting for wayland-0 socket..."
        fi

        for ((i=1; i<=15; i++)); do
            if [[ -e "$COMPOSITOR_SOCKET" ]]; then
                log "Compositor socket ready ($COMPOSITOR_SOCKET)."
                # Patch resolution with wlr-randr for non-gamescope compositors
                if ! $is_gamescope; then
                    local OUTPUT_NAME
                    OUTPUT_NAME=$(WAYLAND_DISPLAY=wayland-0 wlr-randr --json | jq -r '.[] | select(.enabled == true) | .name' | head -n 1)
                    if [ -z "$OUTPUT_NAME" ]; then
                        log "Warning: No enabled outputs detected. Skipping wlr-randr resolution patch"
                        return
                    fi
                    WAYLAND_DISPLAY=wayland-0 wlr-randr --output "$OUTPUT_NAME" --custom-mode "$WIDTH"x"$HEIGHT"
                    log "Patched resolution with wlr-randr"

                    if [[ -n "${NESTRI_LAUNCH_CMD}" ]]; then
                        log "Starting application: $NESTRI_LAUNCH_CMD"
                        WAYLAND_DISPLAY=wayland-0 /bin/bash -c "$NESTRI_LAUNCH_CMD" &
                        APP_PID=$!
                    fi
                fi
                return
            fi
            sleep 1
        done
        log "Warning: Compositor socket not found after 15 seconds ($COMPOSITOR_SOCKET)"
    else
        # Launch standalone application if no compositor
        if [[ -n "${NESTRI_LAUNCH_CMD}" ]]; then
            log "Starting application: $NESTRI_LAUNCH_CMD"
            WAYLAND_DISPLAY=wayland-1 /bin/bash -c "$NESTRI_LAUNCH_CMD" &
            APP_PID=$!
        else
            log "No compositor or application configured"
        fi
    fi
}

# Increments retry counter
increment_retry() {
    local component="$1"
    ((RETRY_COUNT++))
    if [[ "$RETRY_COUNT" -ge "$MAX_RETRIES" ]]; then
        log "Error: Max retries reached for $component"
        exit 1
    fi
}

# Restarts the chain
restart_chain() {
    log "Restarting nestri-server and compositor..."
    start_nestri_server
}

# Cleans up processes
cleanup() {
    local exit_code=$?
    log "Terminating processes..."
    kill_if_running "${NESTRI_PID:-}" "nestri-server"
    kill_if_running "${COMPOSITOR_PID:-}" "compositor"
    kill_if_running "${APP_PID:-}" "application"
    kill_if_running "${PATCHER_PID:-}" "steam-patcher"
    rm -f "/tmp/_v2-entry-point.padded" 2>/dev/null
    exit $exit_code
}

# Monitor processes for unexpected exits
main_loop() {
    trap cleanup SIGINT SIGTERM EXIT

    while true; do
        sleep 1
        # Check nestri-server
        if [[ -n "${NESTRI_PID:-}" ]] && ! kill -0 "${NESTRI_PID}" 2>/dev/null; then
            log "nestri-server died"
            increment_retry "nestri-server"
            restart_chain
        # Check compositor
        elif [[ -n "${COMPOSITOR_PID:-}" ]] && ! kill -0 "${COMPOSITOR_PID}" 2>/dev/null; then
            log "compositor died"
            increment_retry "compositor"
            start_compositor
        # Check application
        elif [[ -n "${APP_PID:-}" ]] && ! kill -0 "${APP_PID}" 2>/dev/null; then
            log "application died"
            increment_retry "application"
            start_compositor
        # Check patcher
        elif [[ -n "${PATCHER_PID:-}" ]] && ! kill -0 "${PATCHER_PID}" 2>/dev/null; then
            log "steam-patcher died"
            increment_retry "steam-patcher"
            start_steam_namespaceless_patcher
        fi
    done
}

main() {
    parse_resolution "${RESOLUTION:-1920x1080}" || exit 1
    get_container_info || {
        log "Warning: Failed to detect container information."
    }

    # Ensure DBus session env exists
    if command -v dbus-launch >/dev/null 2>&1 && [[ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
        eval "$(dbus-launch)"
    fi

    restart_chain
    main_loop
}

main
