#!/usr/bin/env bash
# uninstall.sh - removes Locker's CLI and right-click actions for this user (Linux).
# Locked folders are left untouched (unlock them first if needed).
set -uo pipefail

rm -f "$HOME/.local/bin/locker"
rm -f "$HOME/.local/share/nemo/actions/locker.nemo_action"
rm -f "$HOME/.local/share/nautilus/scripts/Open with Locker"
rm -f "$HOME/.local/share/caja/scripts/Open with Locker"
rm -f "$HOME/.config/autostart/locker-session-guard.desktop"
rm -f "$HOME/.config/autostart/locker-folder-watch.desktop"
pkill -f "^python3 $HOME/.local/share/locker/folder-watch.py$" 2>/dev/null || true

XINIT="$HOME/.xinitrc"
if [ -f "$XINIT" ] && grep -Fq '# >>> Locker Kit session guard >>>' "$XINIT"; then
  XINIT_TMP="$(mktemp)"
  awk '
    /# >>> Locker Kit session guard >>>/ { skip=1; next }
    /# <<< Locker Kit session guard <<</ { skip=0; next }
    !skip { print }
  ' "$XINIT" > "$XINIT_TMP"
  mv "$XINIT_TMP" "$XINIT"
  chmod +x "$XINIT"
fi
rm -rf "$HOME/.config/locker-kit"
rm -rf "$HOME/.local/share/locker"

echo "Locker uninstall hoye gelo (CLI + right-click sriye deoya holo)."
echo "Locked folder gula age unlock kore nio jodi kono thake."
