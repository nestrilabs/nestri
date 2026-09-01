# Nestri user environment — sourced for nestri user logins and su -
if [ "$(id -u)" = "1000" ]; then
    export XDG_RUNTIME_DIR="/run/user/1000"
    export XDG_CONFIG_HOME="${HOME}/.config"
    export XDG_DATA_HOME="${HOME}/.local/share"
    export XDG_CACHE_HOME="${HOME}/.cache"
    export XDG_STATE_HOME="${HOME}/.local/state"

    export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/bus"

    # Portal backend selection. "GTK" matches xdg-desktop-portal-gtk.
    # Once nescope supports wlr portals, change to "wlroots" or similar.
    #export XDG_CURRENT_DESKTOP="${XDG_CURRENT_DESKTOP:-GTK}"
    export XDG_SESSION_TYPE="${XDG_SESSION_TYPE:-wayland}"
    export XDG_SESSION_DESKTOP="${XDG_SESSION_DESKTOP:-nestri}"

    # Ensure proper VAAPI driver is used
    #export LIBVA_DRIVER_NAME="radeonsi"

    # Force zink usage for OpenGL -> Vulkan translation
    #export __GLX_VENDOR_LIBRARY_NAME=mesa
    #export MESA_LOADER_DRIVER_OVERRIDE=zink
    #export GALLIUM_DRIVER=zink

    # Ensure standard XDG dirs exist
    mkdir -p "${XDG_CONFIG_HOME}" "${XDG_DATA_HOME}" "${XDG_CACHE_HOME}" "${XDG_STATE_HOME}" 2>/dev/null || true
fi
