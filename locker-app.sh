#!/usr/bin/env bash
# locker-app.sh - opens the Locker desktop app for a folder on Linux.
# Usage: locker-app.sh [folder] | locker-app.sh --guard [guard-state-folder]
# Uses Electron, so the UI is an application window rather than a browser window.
set -euo pipefail

DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
MODE="folder"
if [ "${1:-}" = "--guard" ]; then
  MODE="guard"
  shift
fi
TARGET="${1:-$PWD}"

ELECTRON="$DIR/node_modules/.bin/electron"
if [ ! -x "$ELECTRON" ]; then
  command -v zenity >/dev/null 2>&1 && zenity --error --text="Locker desktop dependency install kora nei. install.sh cholao (ba npm install cholao)." || echo "Locker desktop dependency install kora nei."
  exit 1
fi

exec env -u ELECTRON_RUN_AS_NODE "$ELECTRON" "$DIR" "--locker-target=$TARGET" "--locker-mode=$MODE"
