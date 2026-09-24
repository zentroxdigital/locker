#!/usr/bin/env bash
# Started by the Cinnamon/XDG session immediately after startx/login.
set -euo pipefail

DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
STATE="$DIR/guard-state"
RUNTIME="${XDG_RUNTIME_DIR:-/tmp}"
DISPLAY_ID="$(printf '%s' "${DISPLAY:-display}" | tr '/:' '__')"
MARKER="$RUNTIME/locker-kit-guard-granted-$DISPLAY_ID"
mkdir -p "$STATE"

if [ "${1:-}" = "--autostart" ] && [ -f "$MARKER" ]; then
  rm -f "$MARKER"
  exit 0
fi

if "$DIR/locker-app.sh" --guard "$STATE"; then
  if [ "${1:-}" = "--xinit" ]; then
    : > "$MARKER"
  fi
  exit 0
fi
exit 1
