#!/usr/bin/env bash
# Shared across Cursor + Claude Code hooks. Fail-open.
set -euo pipefail
cat >/dev/null 2>&1 || true
printf '%s\n' "Project Ledger: context + onboard phase are auto-run by hooks. Before coding run preflight (SPEC/deps/style) for the focused task. Read docs/conventions/code-style.md + conventions.yaml (camelCase etc.). sources/ for user originals. AGENTS.md. Skills → MCP → hooks. Validate before done."
