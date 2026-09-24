#!/usr/bin/env bash
# locker-app.sh - opens the Locker GUI for a folder on Linux.
# Usage: locker-app.sh [folder]   (defaults to current dir)
# Reuses app-server.js (cross-platform Node). Closes the local server when the window closes.
set -euo pipefail

DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
TARGET="${1:-$PWD}"

if ! command -v node >/dev/null 2>&1; then
  command -v zenity >/dev/null 2>&1 && zenity --error --text="Node.js install kora nei. Cholao: sudo apt install nodejs" || echo "Node.js install kora nei."
  exit 1
fi

PORT=$(( (RANDOM % 700) + 8800 ))
TOKEN="$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"

node "$DIR/app-server.js" "$PORT" "$TOKEN" "$TARGET" &
SRV=$!
trap 'kill "$SRV" 2>/dev/null || true' EXIT

# wait until the server port is open
for _ in $(seq 1 60); do
  (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null && { exec 3>&- 3<&- ; break; }
  sleep 0.2
done
URL="http://127.0.0.1:$PORT/?t=$TOKEN"

# open a chromeless app window if a Chromium-family browser exists, else a normal Firefox window
open_browser() {
  local b
  for b in chromium chromium-browser google-chrome google-chrome-stable brave-browser microsoft-edge; do
    if command -v "$b" >/dev/null 2>&1; then
      "$b" --app="$URL" --window-size=470,660 --user-data-dir="$HOME/.cache/locker-profile" >/dev/null 2>&1
      return 0
    fi
  done
  if command -v firefox >/dev/null 2>&1; then
    firefox --new-window "$URL" >/dev/null 2>&1
    return 0
  fi
  xdg-open "$URL" >/dev/null 2>&1
}
open_browser &

# the server exits itself when the window closes (auto-lock beacon); wait for that
wait "$SRV" 2>/dev/null || true
