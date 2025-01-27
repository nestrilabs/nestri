#!/bin/bash
set -euo pipefail

declare -A vendor_devices=()

function get_gpu_info {
    vendor_devices=()

    local gpu_info=$(lspci -nn | grep -E '\<(0300|0302|0380)\>')

    while IFS= read -r line; do
        # Extract vendor_id from [vendor_id:device_id]
        local vendor_id=$(echo "$line" | sed -nE 's/.*\[([[:xdigit:]]{4}):[[:xdigit:]]{4}\].*/\1/p' | tr '[:upper:]' '[:lower:]')
        local id=$(echo "$line" | awk '{print $1}')

        # Map vendor_id to known vendors
        local vendor="unknown"
        case "$vendor_id" in
        10de) vendor="nvidia" ;;
        8086) vendor="intel" ;;
        1002 | 1022) vendor="amd" ;;
            # Add other vendor IDs as needed
        esac

        if [[ "$vendor" != "unknown" ]]; then
            vendor_devices["$vendor"]+="$id "
        fi
    done <<<"$gpu_info"
}

function debug_gpu_info {
    echo "Detected GPUs:"
    for vendor in "${!vendor_devices[@]}"; do
        echo "  $vendor: ${vendor_devices[$vendor]}"
    done
}

# # Usage example:
# get_gpu_info
# debug_gpu_info

# # Access NVIDIA GPUs specifically
# if [[ -n "${vendor_devices[nvidia]:-}" ]]; then
#     echo "NVIDIA GPUs detected: ${vendor_devices[nvidia]}"
# else
#     echo "No NVIDIA GPUs found"
# fi