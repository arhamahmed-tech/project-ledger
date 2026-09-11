# AGENTS.md

**Canonical agent instructions for every harness** (Cursor, Claude Code, Codex, Copilot, etc.).

Full protocol: [`docs/agent-protocol.md`](docs/agent-protocol.md)

## Primary path

1. `context` — if empty/setup unclear → `onboard` or `auto` (dry-run; `--yes` to apply)  
2. `preflight` before coding · `postflight` after coding · `done` · `review`  
3. Never rewrite `docs/product/sources/` · match `docs/conventions/code-style.md`  
4. Prefer host eslint/prettier/ruff for real style checks  

## Lifecycle

| Mode | Flow |
|------|------|
| Setup | sources → `auto [--yes]` → review formal docs |
| Task | context → next/focus → preflight → implement → evd → postflight → done → review |
| Safeguards | hooks/CI (strict; `LEDGER_STRICT=0` softens stop only) |

## Must

- SPEC pin ≠ plan approval  
- Fresh `evd --result pass --task` with `task.files` set  
- Scope change → `revise` (new revision), don’t rewrite history  
- Secondary tools (`board`, `ui`, `why`, …) only when needed  

Do not invent a parallel process. Read `docs/agent-protocol.md`.
