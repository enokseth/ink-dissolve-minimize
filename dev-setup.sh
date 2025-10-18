#!/usr/bin/env bash
set -euo pipefail

# dev-setup.sh - helper for building, linking, installing, compiling schemas and reloading the GNOME extension
# Usage: ./dev-setup.sh {link|install|build|compile-schemas|reload|logs|check|full}

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
UUID=$(jq -r '.uuid' "$REPO_DIR/metadata.json")
TARGET="$HOME/.local/share/gnome-shell/extensions/$UUID"

if [ -z "$UUID" ] || [ "$UUID" = "null" ]; then
  echo "❌ Could not read UUID from metadata.json"
  exit 1
fi

function compile_schemas() {
  if [ -d "$TARGET/schemas" ]; then
    echo "🔧 Compiling schemas in $TARGET/schemas..."
    glib-compile-schemas "$TARGET/schemas"
  else
    echo "⚠️ No schemas directory found at $TARGET/schemas"
  fi
}

function reload_ext() {
  echo "🔄 Reloading extension $UUID..."
  if command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions disable "$UUID" || true
    sleep 0.3
    gnome-extensions enable "$UUID" || true
  else
    echo "⚠️ gnome-extensions CLI not found."
    if [ "$XDG_SESSION_TYPE" = "x11" ]; then
      echo "💡 You can press Alt+F2, type 'r' and press Enter to reload GNOME Shell."
    else
      echo "💡 On Wayland, please log out/in or toggle the extension via GNOME Extensions app."
    fi
  fi
}

function show_logs() {
  echo "📜 Showing GNOME Shell logs for $UUID (Ctrl+C to stop)..."
  journalctl --user -f -g "$UUID|gnome-shell"
}

case "${1-}" in
  link|symlink)
    echo "🔗 Creating symlink: $TARGET → $REPO_DIR"
    rm -rf "$TARGET"
    mkdir -p "$(dirname "$TARGET")"
    ln -s "$REPO_DIR" "$TARGET"
    ;;

  install|copy)
    echo "📦 Copying files to $TARGET..."
    rm -rf "$TARGET"
    mkdir -p "$TARGET"
    cp -a "$REPO_DIR/." "$TARGET/"
    ;;

  compile-schemas|schemas)
    compile_schemas
    ;;

  reload)
    reload_ext
    ;;

  logs)
    show_logs
    ;;

  check)
    echo "ℹ️  UUID: $UUID"
    echo "📂 Target: $TARGET"
    echo
    if [ -L "$TARGET" ]; then
      echo "🔗 Linked to repo:"
      readlink -f "$TARGET"
    elif [ -d "$TARGET" ]; then
      echo "📦 Installed copy found."
    else
      echo "⚠️ Target not found."
    fi
    echo
    ls -la "$TARGET" || true
    ;;

  build|full)
    echo "🏗️  Building and reloading full extension pipeline..."
    rm -rf "$TARGET"
    mkdir -p "$TARGET"
    cp -a "$REPO_DIR/." "$TARGET/"
    compile_schemas
    reload_ext
    echo
    echo "✅ Build completed. Watching logs..."
    echo "---------------------------------------------"
    show_logs
    ;;

  *)
    echo "Usage: $0 {link|install|build|compile-schemas|reload|logs|check|full}"
    echo
    echo "Examples:"
    echo "  ./dev-setup.sh link           # symlink to live repo"
    echo "  ./dev-setup.sh build          # copy, compile schemas, reload, and show logs"
    echo "  ./dev-setup.sh reload         # disable/enable quickly"
    echo "  ./dev-setup.sh logs           # tail GNOME Shell logs"
    exit 1
    ;;
esac

echo "✅ Done."
