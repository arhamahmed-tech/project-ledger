#!/usr/bin/env bash
# Shared across Cursor + Claude Code hooks. Fail-open.
set -euo pipefail
# Drain stdin if present (Cursor/Claude may pipe JSON)
cat >/dev/null 2>&1 || true
printf '%s\n' "Project Ledger toolkit: follow AGENTS.md + docs/agent-protocol.md. Skills first; /find-skills if unsure; MCP for live systems; security review for sensitive changes; match host codebase style."
