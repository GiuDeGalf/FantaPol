#!/usr/bin/env sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$APP_DIR"

if command -v python3 >/dev/null 2>&1; then
  exec python3 tools/server.py
fi
if command -v python >/dev/null 2>&1; then
  exec python tools/server.py
fi

echo "Python 3 non è installato. Installalo da https://www.python.org/downloads/ e riprova." >&2
exit 1
