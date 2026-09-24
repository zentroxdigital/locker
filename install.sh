#!/usr/bin/env bash
# install.sh - per-user install of Locker on Linux (no sudo). Adds:
#  - a copy of the tool under ~/.local/share/locker
#  - a `locker` CLI in ~/.local/bin
#  - a right-click "Open with Locker" action (Nemo = Mint Cinnamon; also Nautilus/Caja if present)
#  - an X session guard and a locked-folder open watcher
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
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 install kora nei. Cholao: sudo apt install python3"
  exit 1
fi
if ! command -v espeak-ng >/dev/null 2>&1 && ! command -v spd-say >/dev/null 2>&1; then
  echo "WARNING: Female voice-er jonno install koro:  sudo apt install espeak-ng"
fi
if ! node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>22||(a===22&&b>=12)?0:1)"; then
  echo "Locker desktop app-er jonno Node.js 22.12 ba notun version lagbe. Node.js LTS update koro."
  exit 1
fi

echo "-> Copying files to $DEST"
mkdir -p "$DEST"
cp "$SRC/locker-engine.js" "$SRC/app-server.js" "$SRC/desktop-main.js" "$SRC/folder-watch.py" "$SRC/session-guard.sh" "$SRC/package.json" "$SRC/package-lock.json" "$SRC/locker-app.sh" "$SRC/uninstall.sh" "$SRC/locker" "$DEST/"
chmod +x "$DEST/locker-app.sh" "$DEST/session-guard.sh" "$DEST/folder-watch.py" "$DEST/uninstall.sh" "$DEST/locker"

echo "-> Installing Electron desktop runtime"
npm install --omit=dev --no-audit --no-fund --prefix "$DEST"
node "$DEST/node_modules/electron/install.js"
[ -d "$DEST/node_modules/electron/dist" ] || { echo "Electron desktop runtime download hoyni."; exit 1; }

echo "-> Preparing clear Bengali female voice"
VOICE_ENV="$DEST/.voice-venv"
VOICE_CACHE="$DEST/voice-cache"
if python3 -m venv "$VOICE_ENV" >/dev/null 2>&1; then
  if "$VOICE_ENV/bin/pip" install --disable-pip-version-check --no-cache-dir "edge-tts==7.2.8" >/dev/null; then
    mkdir -p "$VOICE_CACHE"
    if "$VOICE_ENV/bin/edge-tts" \
      --voice "bn-BD-NabanitaNeural" \
      --text "হাই রায়াত স্যার, আপনি এসেছেন? আমার জন্য কী এনেছেন?" \
      --write-media "$VOICE_CACHE/greeting-bn.mp3"; then
      echo "   Clear female greeting ready (Nabanita)."
    else
      echo "   WARNING: Neural greeting cache hoyni; internet check koro. Native voice fallback cholbe."
    fi
  else
    echo "   WARNING: edge-tts install hoyni; native voice fallback cholbe."
  fi
else
  echo "   WARNING: Clear voice-er jonno cholao: sudo apt install python3-venv; tarpor install.sh abar cholao."
fi

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

echo "-> Installing Cinnamon/XDG session startup"
AUTOSTART="$HOME/.config/autostart"
mkdir -p "$AUTOSTART"
cat > "$AUTOSTART/locker-session-guard.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Locker Session Guard
Comment=Ask for the Locker key when the desktop session starts
Exec="$DEST/session-guard.sh" --autostart
Terminal=false
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=0
EOF

# With `startx`, run the guard before the desktop session itself. Existing .xinitrc content is
# preserved; uninstall.sh removes only this managed block.
XINIT="$HOME/.xinitrc"
if ! grep -Fq '# >>> Locker Kit session guard >>>' "$XINIT" 2>/dev/null; then
  XINIT_TMP="$(mktemp)"
  if [ -f "$XINIT" ]; then
    XINIT_FIRST="$(head -n 1 "$XINIT")"
    case "$XINIT_FIRST" in
      '#!'*) head -n 1 "$XINIT" > "$XINIT_TMP"; tail -n +2 "$XINIT" > "$XINIT_TMP.original" ;;
      *) cp "$XINIT" "$XINIT_TMP.original" ;;
    esac
  else
    : > "$XINIT_TMP.original"
  fi
  cat >> "$XINIT_TMP" <<'EOF'
# >>> Locker Kit session guard >>>
if ! "$HOME/.local/share/locker/session-guard.sh" --xinit; then
  echo "Locker guard did not grant access."
  exit 1
fi
# <<< Locker Kit session guard <<<
EOF
  cat "$XINIT_TMP.original" >> "$XINIT_TMP"
  rm -f "$XINIT_TMP.original"
  if [ ! -f "$XINIT" ]; then
    cat >> "$XINIT_TMP" <<'EOF'
exec /etc/X11/Xsession
EOF
  fi
  mv "$XINIT_TMP" "$XINIT"
  chmod +x "$XINIT"
fi
cat > "$AUTOSTART/locker-folder-watch.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Locker Folder Watch
Comment=Open Ms Minute when a locked folder is entered
Exec=python3 "$DEST/folder-watch.py"
Terminal=false
NoDisplay=true
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=1
EOF

# Make folder-open detection work in the current graphical session too.
if [ -n "${DISPLAY:-}" ] && ! pgrep -f "^python3 $DEST/folder-watch.py$" >/dev/null 2>&1; then
  nohup python3 "$DEST/folder-watch.py" >/dev/null 2>&1 &
fi

echo ""
echo "Done! Ekhon:"
echo "  * Nemo/Files e folder e right-click -> 'Open with Locker'"
echo "  * Locked folder-e dhukle Ms Minute auto open hobe"
echo "  * Porer startx/Cinnamon session-e login guard auto open hobe"
echo "  * Ms Minute ekhon 2x boro, transparent, ebong clear female voice use korbe"
echo "  * Terminal/code theke:  locker lock /path/to/folder"
echo "  * Ekbar notun terminal khulo (PATH update-er jonno)."
