#!/usr/bin/env bash
# Shared across Cursor + Claude Code hooks. Fail-open.
set -euo pipefail
cat >/dev/null 2>&1 || true
printf '%s\n' "Project Ledger: context → preflight (SPEC/deps/style). Read docs/conventions/code-style.md + conventions.yaml (camelCase etc.). sources/ for user originals. AGENTS.md. Skills → MCP → hooks. Validate before done."
