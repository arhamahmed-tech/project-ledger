#!/usr/bin/env bash
# Shared across Cursor + Claude Code hooks. Fail-open for the reminder text only.
set -euo pipefail
cat >/dev/null 2>&1 || true
printf '%s\n' "Project Ledger: context → onboard/auto if needed → preflight → code → postflight → done. auto --yes formalizes from sources (never rewrites originals). Stop hooks strict (LEDGER_STRICT=0 softens). conventions/code-style.md + host eslint/prettier."
