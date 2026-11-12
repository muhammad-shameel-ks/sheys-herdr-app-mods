#!/bin/sh
# Installs the herdr-rail layout: Herdr's main layout whose folded sidebar is a
# rail of space avatars and agent icons with breathing status glows, folding
# and unfolding animated.
# Copies the herdr-rail* mods to <home>/mods/ and the layout (+ preview)
# to <home>/layouts/, then switches to it when Herdr is running.
# Home: $HERDR_APP_HOME, else ~/.config/herdr-app. Herdr applies it live.
# Run from a checkout, or straight from GitHub:
#   curl -fsSL https://raw.githubusercontent.com/muhammad-shameel-ks/sheys-herdr-app-mods/main/sidebar-rail/install.sh | sh
set -eu

base=https://raw.githubusercontent.com/muhammad-shameel-ks/sheys-herdr-app-mods/main/sidebar-rail
home=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
files="mods/herdr-rail/main.js mods/herdr-rail/mod.json mods/herdr-rail-chrome/main.js mods/herdr-rail-chrome/mod.json mods/herdr-rail/plus.svg mods/herdr-rail/expand.svg layouts/herdr-rail.json layouts/herdr-rail.svg"

[ -d "$home" ] || { echo "install.sh: no Herdr app home at $home" >&2; exit 1; }

# Files come from the checkout beside this script, else from GitHub (curl | sh).
if [ -f "$0" ] && [ -f "$(dirname "$0")/layouts/herdr-rail.json" ]; then
  here=$(cd "$(dirname "$0")" && pwd)
else
  command -v curl >/dev/null 2>&1 || { echo "install.sh: curl is required" >&2; exit 1; }
  here=$(mktemp -d)
  trap 'rm -rf "$here"' EXIT
  for f in $files; do
    mkdir -p "$here/$(dirname "$f")"
    curl -fsSL "$base/$f" -o "$here/$f"
  done
fi

# Mods before the layout that names them (the list is in that order).
for f in $files; do
  mkdir -p "$home/$(dirname "$f")"
  cp "$here/$f" "$home/$f"
done

if command -v herdr-app >/dev/null 2>&1; then
  for m in herdr-rail herdr-rail-chrome; do
    herdr-app check "$home/mods/$m"
  done
  herdr-app do layout.switch --name herdr-rail >/dev/null 2>&1 \
    || echo "Herdr isn't running: pick herdr-rail in Settings > Look, or press ctrl-shift-l"
fi

echo "installed herdr-rail -> $home/layouts/herdr-rail.json"
