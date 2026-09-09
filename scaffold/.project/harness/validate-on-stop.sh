#!/usr/bin/env bash
# Shared stop/validate hook for Cursor + Claude Code.
# Prefer local CLI — never hit npm registry unless LEDGER_ALLOW_NPX=1.
set -euo pipefail
cat >/dev/null 2>&1 || true

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT"

run_validate() {
  if [ -f "$ROOT/scripts/ledger.mjs" ]; then
    node "$ROOT/scripts/ledger.mjs" validate
    return
  fi

  if [ -f "$ROOT/node_modules/project-ledger/bin/project-ledger.js" ]; then
    node "$ROOT/node_modules/project-ledger/bin/project-ledger.js" validate
    return
  fi

  if [ -f "$ROOT/package.json" ] && grep -q '"ledger"' "$ROOT/package.json" 2>/dev/null; then
    if command -v pnpm >/dev/null 2>&1; then
      pnpm ledger validate
      return
    fi
    if command -v npm >/dev/null 2>&1; then
      npm run ledger -- validate
      return
    fi
  fi

  if command -v project-ledger >/dev/null 2>&1; then
    project-ledger validate
    return
  fi
  if command -v ledger >/dev/null 2>&1; then
    ledger validate
    return
  fi

  if [ -f "$ROOT/../project-ledger/bin/project-ledger.js" ]; then
    node "$ROOT/../project-ledger/bin/project-ledger.js" validate
    return
  fi

  if [ "${LEDGER_ALLOW_NPX:-}" = "1" ]; then
    npx --yes project-ledger validate
    return
  fi

  echo "No local project-ledger CLI found."
  echo "Use one of:"
  echo "  node scripts/ledger.mjs validate"
  echo "  npm i -D ../project-ledger   # or path to tarball"
  echo "  LEDGER_ALLOW_NPX=1  (only after publishing to npm)"
  return 1
}

if ! run_validate >/tmp/ledger-harness-validate.txt 2>&1; then
  detail=$(tr '\n' ' ' </tmp/ledger-harness-validate.txt | sed 's/"/\\"/g' | cut -c1-400)
  printf '%s\n' "{\"followup_message\":\"Ledger validate FAILED. ${detail}\"}"
  exit 0
fi

printf '%s\n' '{}'
exit 0
