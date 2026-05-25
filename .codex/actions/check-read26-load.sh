#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
READ26_URL="${READ26_URL:-http://127.0.0.1:4173/read-26.html}"
PLAYWRIGHT_LIB_DIR="$ROOT_DIR/.playwright-deps/root/usr/lib/x86_64-linux-gnu"

cd "$ROOT_DIR"

exec bash -ic "LD_LIBRARY_PATH='$PLAYWRIGHT_LIB_DIR'\${LD_LIBRARY_PATH:+:\"\$LD_LIBRARY_PATH\"} READ26_URL='$READ26_URL' npm run verify:read26"
