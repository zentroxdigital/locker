#!/usr/bin/env bash
# uninstall.sh - removes Locker's CLI and right-click actions for this user (Linux).
# Locked folders are left untouched (unlock them first if needed).
set -uo pipefail

rm -f "$HOME/.local/bin/locker"
rm -f "$HOME/.local/share/nemo/actions/locker.nemo_action"
rm -f "$HOME/.local/share/nautilus/scripts/Open with Locker"
rm -f "$HOME/.local/share/caja/scripts/Open with Locker"
rm -rf "$HOME/.local/share/locker"

echo "Locker uninstall hoye gelo (CLI + right-click sriye deoya holo)."
echo "Locked folder gula age unlock kore nio jodi kono thake."
