#!/usr/bin/env bash
# Shared across Cursor + Claude Code hooks. Fail-open.
set -euo pipefail
cat >/dev/null 2>&1 || true
printf '%s\n' "Project Ledger: new chat → \`node scripts/ledger.mjs context\`; before coding → \`node scripts/ledger.mjs preflight\` (SPEC/out-of-scope/deps). sources/ for user originals. AGENTS.md + docs/agent-protocol.md. Skills → MCP → hooks. Validate before done."
