#!/usr/bin/env bash
# install.sh - per-user install of Locker on Linux (no sudo). Adds:
#  - a copy of the tool under ~/.local/share/locker
#  - a `locker` CLI in ~/.local/bin
#  - a right-click "Open with Locker" action (Nemo = Mint Cinnamon; also Nautilus/Caja if present)
# Run:  bash install.sh
set -euo pipefail

SRC="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
DEST="$HOME/.local/share/locker"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js install kora nei. Age cholao:  sudo apt install nodejs"
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm install kora nei. Node.js/npm install kore abar install.sh cholao."
  exit 1
fi
if ! node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>22||(a===22&&b>=12)?0:1)"; then
  echo "Locker desktop app-er jonno Node.js 22.12 ba notun version lagbe. Node.js LTS update koro."
  exit 1
fi

echo "-> Copying files to $DEST"
mkdir -p "$DEST"
cp "$SRC/locker-engine.js" "$SRC/app-server.js" "$SRC/desktop-main.js" "$SRC/package.json" "$SRC/package-lock.json" "$SRC/locker-app.sh" "$SRC/locker" "$DEST/"
chmod +x "$DEST/locker-app.sh" "$DEST/locker"

echo "-> Installing Electron desktop runtime"
npm install --omit=dev --no-audit --no-fund --prefix "$DEST"
node "$DEST/node_modules/electron/install.js"
[ -d "$DEST/node_modules/electron/dist" ] || { echo "Electron desktop runtime download hoyni."; exit 1; }

echo "-> Installing 'locker' CLI to ~/.local/bin"
mkdir -p "$HOME/.local/bin"
ln -sf "$DEST/locker" "$HOME/.local/bin/locker"
case ":$PATH:" in
  *":$HOME/.local/bin:"*) : ;;
  *) echo "   NOTE: ~/.local/bin PATH e nei. .bashrc e jog koro:  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
esac

install_action() { # $1 = actions dir, $2 = format (nemo|desktop)
  mkdir -p "$1"
  if [ "$2" = "nemo" ]; then
    cat > "$1/locker.nemo_action" <<EOF
[Nemo Action]
Name=Open with Locker
Comment=Lock or unlock this folder with Locker
Exec=$DEST/locker-app.sh %F
Icon-Name=security-high
Selection=s
Mimetypes=inode/directory;
EOF
  fi
}

DONE=""
if command -v nemo >/dev/null 2>&1 || [ -d "$HOME/.local/share/nemo" ]; then
  install_action "$HOME/.local/share/nemo/actions" nemo
  echo "-> Nemo right-click action added (Mint Cinnamon)."
  DONE=1
fi
# Nautilus / Caja: use their 'scripts' folders as a fallback
for FM in nautilus caja; do
  if command -v "$FM" >/dev/null 2>&1; then
    SDIR="$HOME/.local/share/$FM/scripts"
    mkdir -p "$SDIR"
    cat > "$SDIR/Open with Locker" <<EOF
#!/usr/bin/env bash
"$DEST/locker-app.sh" "\$1"
EOF
    chmod +x "$SDIR/Open with Locker"
    echo "-> $FM script added (right-click -> Scripts -> Open with Locker)."
    DONE=1
  fi
done
[ -z "$DONE" ] && echo "   (Kono chena file manager pai ni; CLI ba locker-app.sh diye cholao.)"

echo ""
echo "Done! Ekhon:"
echo "  * Nemo/Files e folder e right-click -> 'Open with Locker'"
echo "  * Terminal/code theke:  locker lock /path/to/folder"
echo "  * Ekbar notun terminal khulo (PATH update-er jonno)."
