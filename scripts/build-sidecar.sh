#!/usr/bin/env bash
# Builds the self-contained Python sidecar that ships inside MarkItDown.app.
# The user never installs Python - this bundle IS the runtime.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE="$ROOT/service"
VENV="$SERVICE/.venv"

cd "$SERVICE"

if [ ! -x "$VENV/bin/python" ]; then
  echo "==> Creating virtualenv"
  python3 -m venv "$VENV"
  "$VENV/bin/python" -m pip install --quiet --upgrade pip setuptools wheel
fi

if ! "$VENV/bin/python" -c "import markitdown" 2>/dev/null; then
  echo "==> Installing dependencies"
  "$VENV/bin/python" -m pip install -r requirements.txt
fi

echo "==> Building sidecar with PyInstaller"
rm -rf build dist
"$VENV/bin/python" -m PyInstaller --clean --noconfirm markitdown_service.spec

BIN="$SERVICE/dist/markitdown-service/markitdown-service"
if [ ! -x "$BIN" ]; then
  echo "!! Build did not produce $BIN" >&2
  exit 1
fi

# Apple Silicon refuses to execute unsigned binaries, so ad-hoc sign even though
# we have no Developer ID. PyInstaller usually does this, but be explicit.
codesign --force --sign - "$BIN" 2>/dev/null || true

echo "==> Built $(du -sh "$SERVICE/dist/markitdown-service" | cut -f1) at $BIN"
