#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLAYWRIGHT_DEPS_DIR="$ROOT_DIR/.playwright-deps"
PLAYWRIGHT_DEPS_ROOT="$PLAYWRIGHT_DEPS_DIR/root"

cd "$ROOT_DIR"

bash -ic 'npm install'
bash -ic 'npx playwright install chromium'

mkdir -p "$PLAYWRIGHT_DEPS_DIR"
(
  cd "$PLAYWRIGHT_DEPS_DIR"
  apt download libnspr4 libnss3 libasound2t64 libasound2-data
)

rm -rf "$PLAYWRIGHT_DEPS_ROOT"
mkdir -p "$PLAYWRIGHT_DEPS_ROOT"
for deb in "$PLAYWRIGHT_DEPS_DIR"/*.deb; do
  dpkg-deb -x "$deb" "$PLAYWRIGHT_DEPS_ROOT"
done

echo "Setup complete for $ROOT_DIR"
