#!/usr/bin/env bash
# Local verification only: never pushes, deploys, loads real data or creates services.
set -euo pipefail
cd "$(dirname "$0")/.."
export npm_config_cache="/workspace/.npm-cache"
export PLAYWRIGHT_BROWSERS_PATH="/workspace/.browser-cache"
npm ci --fetch-retries=0 --fetch-timeout=15000 --no-audit --no-fund
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run build
npm run test:server
npx --no-install playwright install chromium
npm test
