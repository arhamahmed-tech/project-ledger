# AGENTS.md

**Canonical agent instructions for every harness** (Cursor, Claude Code, Codex, Copilot, etc.).

Full protocol: [`docs/agent-protocol.md`](docs/agent-protocol.md)

## Lifecycle (not 13 steps every time)

- **Setup / product change:** sources → formalize → ADR if needed → plans/tasks  
- **Normal task:** `context` → focus/next → `preflight` → implement → verify → `postflight` / `done` → `review`  
- **Safeguards:** hooks/CI → `validate` / `check` (strict by default; `LEDGER_STRICT=0` softens stop hooks only)  
- Use `onboard` when phase/setup is unclear — do not regenerate valid artifacts for every small fix.

## Must follow

1. **New chat** → run `node scripts/ledger.mjs context` first. If empty / setup unclear → `onboard`.
2. **Before coding** → `preflight` (must pass). SPEC pin ≠ plan approval. Out of scope / missing deps → STOP and ask.
3. **After coding** → `postflight` (drift + fresh evidence) before `done`.
4. **Verify** → `ledger new evd "…" --run RUN-#### --result pass --task TASK-####` with `task.files` set.
5. **Finish** → `ledger done TASK-####` then `ledger review` before PR.
6. **User originals** → `docs/product/sources/…` — never rewrite.
7. **Scope change** → `ledger revise` (new revision); preserve history; follow-up tasks for new pins.
8. **Create entities** → `ledger new …`
9. **Skills / MCP / hooks / security / style** as in `docs/agent-protocol.md`
10. **Validate** before claiming ledger completion — records ≠ working software.

Do not invent a parallel process. Read `docs/agent-protocol.md`.
