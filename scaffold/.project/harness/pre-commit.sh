#!/usr/bin/env bash
# Optional pre-commit gate — install with: node scripts/ledger.mjs hooks install
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
node scripts/ledger.mjs validate
node scripts/ledger.mjs check
