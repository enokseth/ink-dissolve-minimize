#!/usr/bin/env bash
# Quick syntax check for GNOME Shell extension JS using gjs if available
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FILE="$ROOT_DIR/extension.js"

if command -v gjs >/dev/null 2>&1; then
    echo "Using gjs to check syntax:"
    # Call gjs with the filename so it parses the file; avoid -c which treats the argument as code
    if gjs "$FILE"; then
        echo "Syntax OK"
    else
        echo "gjs reported errors while executing/parsing the file (see output above)." >&2
        echo "Falling back to node/acorn syntax check..."
        if command -v node >/dev/null 2>&1; then
            node "$ROOT_DIR/tools/check-syntax-node.js" || exit $?;
        else
            echo "node not found to run fallback syntax checker." >&2
            exit 1
        fi
    fi
else
    echo "gjs not found in PATH. Falling back to node/acorn if available..." >&2
    if command -v node >/dev/null 2>&1; then
        node "$ROOT_DIR/tools/check-syntax-node.js" || exit $?;
    else
        echo "node not found to run fallback syntax checker." >&2
        exit 2
    fi
fi
