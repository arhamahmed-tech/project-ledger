#!/usr/bin/env bash
# Shared across Cursor + Claude Code hooks. Fail-open.
set -euo pipefail
# Drain stdin if present (Cursor/Claude may pipe JSON)
cat >/dev/null 2>&1 || true
printf '%s\n' "Project Ledger: run \`node scripts/ledger.mjs context\` first in a new chat. Then AGENTS.md + docs/agent-protocol.md. Use ledger focus / ledger new. Skills first; MCP for live systems; security review for sensitive changes; match host codebase style."
