#!/usr/bin/env bash
# Shared stop/validate hook for Cursor + Claude Code.
# Prefer local CLI — never hit npm registry unless LEDGER_ALLOW_NPX=1.
# Hard-fail by default. Soften with: LEDGER_STRICT=0
set -euo pipefail
cat >/dev/null 2>&1 || true

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT"

# Default strict (0.13+). Opt out: LEDGER_STRICT=0
STRICT="${LEDGER_STRICT:-1}"

run_ledger() {
  local cmd="$1"
  shift || true
  if [ -f "$ROOT/scripts/ledger.mjs" ]; then
    node "$ROOT/scripts/ledger.mjs" "$cmd" "$@"
    return
  fi
  if [ -f "$ROOT/node_modules/project-ledger/bin/project-ledger.js" ]; then
    node "$ROOT/node_modules/project-ledger/bin/project-ledger.js" "$cmd" "$@"
    return
  fi
  if [ -f "$ROOT/package.json" ] && grep -q '"ledger"' "$ROOT/package.json" 2>/dev/null; then
    if command -v pnpm >/dev/null 2>&1; then
      pnpm ledger "$cmd" "$@"
      return
    fi
    if command -v npm >/dev/null 2>&1; then
      npm run ledger -- "$cmd" "$@"
      return
    fi
  fi
  if command -v project-ledger >/dev/null 2>&1; then
    project-ledger "$cmd" "$@"
    return
  fi
  if [ -f "$ROOT/../project-ledger/bin/project-ledger.js" ]; then
    node "$ROOT/../project-ledger/bin/project-ledger.js" "$cmd" "$@"
    return
  fi
  if [ "${LEDGER_ALLOW_NPX:-}" = "1" ]; then
    npx --yes project-ledger "$cmd" "$@"
    return
  fi
  echo "No local project-ledger CLI found."
  return 1
}

fail_detail=""
if ! run_ledger validate >/tmp/ledger-harness-validate.txt 2>&1; then
  fail_detail=$(tr '\n' ' ' </tmp/ledger-harness-validate.txt | sed 's/"/\\"/g' | cut -c1-400)
  printf '%s\n' "{\"followup_message\":\"Ledger validate FAILED. ${fail_detail}\"}"
  if [ "$STRICT" = "0" ]; then
    exit 0
  fi
  exit 1
fi

# Also check implementation drift when in a git repo with code changes
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if ! run_ledger check >/tmp/ledger-harness-check.txt 2>&1; then
    fail_detail=$(tr '\n' ' ' </tmp/ledger-harness-check.txt | sed 's/"/\\"/g' | cut -c1-400)
    printf '%s\n' "{\"followup_message\":\"Ledger check FAILED. ${fail_detail}\"}"
    if [ "$STRICT" = "0" ]; then
      exit 0
    fi
    exit 1
  fi
fi

printf '%s\n' '{}'
exit 0
