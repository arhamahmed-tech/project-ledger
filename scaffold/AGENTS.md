# AGENTS.md

**Canonical agent instructions for every harness** (Cursor, Claude Code, Codex, Copilot, etc.).

Full protocol: [`docs/agent-protocol.md`](docs/agent-protocol.md)

## Lifecycle (not 13 steps every time)

- **Setup / product change:** sources → formalize → ADR if needed → plans/tasks  
- **Normal task:** `context` → focus/next → `preflight` → implement → verify → `done` → `review`  
- **Safeguards:** hooks/CI → `validate` / `check` (local hooks bypassable; CI when configured)  
- Use `onboard` when phase/setup is unclear — do not regenerate valid artifacts for every small fix.

## Must follow

1. **New chat** → run `node scripts/ledger.mjs context` first. If empty / setup unclear → `onboard`.
2. **Before coding** → `preflight` (must pass). SPEC pin ≠ plan approval. Out of scope / missing deps → STOP and ask. Match `docs/conventions/code-style.md`.
3. **Find work** → `ledger next` (optionally `--focus`); `ledger handoff` for a new chat.
4. **User originals** → `docs/product/sources/…` — never rewrite; `ledger sources`.
5. **Verify** → `ledger new evd "…" --run RUN-#### --result pass --task TASK-####` (fresh `code_state`).
6. **Finish** → `ledger done TASK-####` then `ledger review` before PR.
7. **Scope change** → revise SPEC/SOW (new revision); do not rewrite history; create follow-up tasks for new pins.
8. **Create entities** → `ledger new …`
9. **Skills / MCP / hooks / security / style** as in `docs/agent-protocol.md`
10. **Validate** before claiming ledger completion — records ≠ working software.

Do not invent a parallel process. Read `docs/agent-protocol.md`.
