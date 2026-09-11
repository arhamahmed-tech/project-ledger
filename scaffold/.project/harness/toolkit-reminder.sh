#!/usr/bin/env bash
# Shared across Cursor + Claude Code hooks. Fail-open for the reminder text only.
set -euo pipefail
cat >/dev/null 2>&1 || true
printf '%s\n' "Project Ledger: context (+ onboard if needed). Before coding: preflight. After coding: postflight then done. Stop hooks hard-fail by default (LEDGER_STRICT=0 to soften). Read conventions/code-style.md. sources/ for originals. Validate before claim done."
