#!/bin/sh
# Installs the Nestri desktop app for the calling user: one binary in
# ~/.local/bin and a launcher entry. No root, nothing outside $HOME.
#
#   curl -fsSL https://api.nestri.io/desktop.sh | sh
set -eu

API="${NESTRI_API:-https://api.nestri.io}"
BIN="${XDG_BIN_HOME:-$HOME/.local/bin}"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"

case "$(uname -s)-$(uname -m)" in
	Linux-x86_64) ;;
	*) echo "Nestri runs on x86_64 Linux and Windows for now." >&2; exit 1 ;;
esac

mkdir -p "$BIN" "$APPS"
tmp="$BIN/.nestri.$$"
trap 'rm -f "$tmp"' EXIT
echo "Downloading Nestri..."
curl -fSL --progress-bar "$API/download/linux" -o "$tmp"
chmod 755 "$tmp"
mv "$tmp" "$BIN/nestri"

cat > "$APPS/nestri.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Nestri
Comment=Play your games on our GPUs
Exec=$BIN/nestri
Terminal=false
Categories=Game;
DESKTOP

echo "Installed. Open Nestri from your app launcher, or run: $BIN/nestri"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "($BIN is not on your PATH.)" ;; esac
