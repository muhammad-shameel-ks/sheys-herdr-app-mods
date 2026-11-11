#!/bin/sh
# Installs omp's icon into Herdr's program table.
# Copies omp.svg to <home>/program-icons/ and deep-merges programs.json into
# <home>/programs.json (other entries are kept; omp's fields are overwritten).
# Home: $HERDR_APP_HOME, else ~/.config/herdr-app. Herdr applies it live.
# Run from a checkout, or straight from GitHub:
#   curl -fsSL https://raw.githubusercontent.com/muhammad-shameel-ks/sheys-herdr-app-mods/main/omp-icon/install.sh | sh
set -eu

base=https://raw.githubusercontent.com/muhammad-shameel-ks/sheys-herdr-app-mods/main/omp-icon
home=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
target="$home/programs.json"

command -v jq >/dev/null 2>&1 || { echo "install.sh: jq is required" >&2; exit 1; }
[ -d "$home" ] || { echo "install.sh: no Herdr app home at $home" >&2; exit 1; }

# Files come from the checkout beside this script, else from GitHub (curl | sh).
if [ -f "$0" ] && [ -f "$(dirname "$0")/omp.svg" ]; then
  here=$(cd "$(dirname "$0")" && pwd)
else
  command -v curl >/dev/null 2>&1 || { echo "install.sh: curl is required" >&2; exit 1; }
  here=$(mktemp -d)
  trap 'rm -rf "$here"' EXIT
  curl -fsSL "$base/omp.svg" -o "$here/omp.svg"
  curl -fsSL "$base/programs.json" -o "$here/programs.json"
fi

mkdir -p "$home/program-icons"
cp "$here/omp.svg" "$home/program-icons/omp.svg"

if [ -f "$target" ]; then
  tmp=$(mktemp "$home/.programs.json.XXXXXX")
  jq -s '.[0] * .[1]' "$target" "$here/programs.json" >"$tmp"
  mv "$tmp" "$target"
else
  cp "$here/programs.json" "$target"
fi

echo "installed omp icon -> $target"
