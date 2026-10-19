#!/usr/bin/env bash
# Local verification only: never pushes, deploys, loads real data or creates services.
set -euo pipefail
cd "$(dirname "$0")/.."
# Keep caches outside the repository and permit existing caller configuration.
export npm_config_cache="${npm_config_cache:-${TMPDIR:-/tmp}/biblioteca-npm-cache}"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-${TMPDIR:-/tmp}/biblioteca-browser-cache}"
npm ci --fetch-retries=0 --fetch-timeout=15000 --no-audit --no-fund
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run build
npm run test:server
if [[ -z "${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-}" ]]; then
  if command -v chromium >/dev/null 2>&1; then
    export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$(command -v chromium)"
  else
    npx --no-install playwright install chromium
  fi
fi
npm test
