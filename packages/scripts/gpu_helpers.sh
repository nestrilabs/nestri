#!/bin/bash
set -euo pipefail

declare -a vendor_full_map=()
declare -a vendor_id_map=()
declare -A vendor_index_map=()

function get_gpu_info {
    # Initialize arrays/maps to avoid unbound variable errors
    vendor_full_map=()
    vendor_id_map=()
    vendor_index_map=()

    # Use lspci to detect GPU info, using class codes for VGA, 3D and Display
    gpu_info=$(lspci -nn | grep -E '\<(0300|0302|0380)\>')

    # Parse each line of GPU info
    while IFS= read -r line; do
        # Extract vendor name and ID from lspci output
        vendor=$(echo "$line" | awk -F: '{print $3}' | sed -E 's/^[[:space:]]+//g' | tr '[:upper:]' '[:lower:]')
        id=$(echo "$line" | awk '{print $1}')

        # Normalize vendor name
        if [[ $vendor =~ .*nvidia.* ]]; then
            vendor="nvidia"
        elif [[ $vendor =~ .*intel.* ]]; then
            vendor="intel"
        elif [[ $vendor =~ .*advanced[[:space:]]micro[[:space:]]devices.* ]]; then
            vendor="amd"
        elif [[ $vendor =~ .*ati.* ]]; then
            vendor="amd"
        else
            vendor="unknown"
        fi

        # Add to arrays/maps if unique
        if ! [[ "${vendor_index_map[$vendor]:-}" ]]; then
            vendor_index_map[$vendor]="${#vendor_full_map[@]}"
            vendor_full_map+=("$vendor")
        fi
        vendor_id_map+=("$id")
    done <<< "$gpu_info"
}

function debug_gpu_info {
    echo "Vendor Full Map: ${vendor_full_map[*]}"
    echo "Vendor ID Map: ${vendor_id_map[*]}"
    echo "Vendor Index Map:"
    for key in "${!vendor_index_map[@]}"; do
        echo "  $key: ${vendor_index_map[$key]}"
    done
}
