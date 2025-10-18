#!/usr/bin/env bash
# Hot-reload helper for GNOME Shell extension development.
# Watches the current extension directory for changes and disables/enables the extension
# to force a reload without restarting GNOME Shell.
# Requires: inotifywait (from inotify-tools) and gnome-extensions

set -euo pipefail

UUID="pixel-dissolve-ink@enokseth"
WATCH_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DELAY=${HOT_RELOAD_DELAY:-0.15}

if ! command -v inotifywait >/dev/null 2>&1; then
  echo "inotifywait not found. Install inotify-tools (e.g. sudo apt install inotify-tools)" >&2
  exit 2
fi

echo "Watching $WATCH_DIR for changes. Reloading $UUID on edits. Press Ctrl-C to stop."

# Ignore some files/patterns (node_modules, .git, .swp)
EXCLUDE='(^|/)(\.git|node_modules|\.swp|\.swx)$'

while true; do
  inotifywait -q -r -e close_write,move,create,delete --exclude "$EXCLUDE" "$WATCH_DIR" >/dev/null 2>&1 || true
  echo "Change detected: reloading extension $UUID"
  # compile schemas if present (best-effort)
  if [ -d "$WATCH_DIR/schemas" ]; then
    echo "Compiling schemas..."
    glib-compile-schemas "$WATCH_DIR/schemas" >/dev/null 2>&1 || true
  fi

  gnome-extensions disable "$UUID" || true
  sleep "$DELAY"
  gnome-extensions enable "$UUID" || true
  echo "Reloaded $UUID"
  # small debounce to avoid rapid loops
  sleep 0.2
done
