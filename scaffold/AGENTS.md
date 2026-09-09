# AGENTS.md

**Canonical agent instructions for every harness** (Cursor, Claude Code, Codex, Copilot, etc.).

Full protocol: [`docs/agent-protocol.md`](docs/agent-protocol.md)

## Must follow

1. **New chat / resume work** → automatically run `node scripts/ledger.mjs context` **first** (read-only paths to load). If context is empty, automatically run `node scripts/ledger.mjs onboard` for phase + next steps (do not wait for user to request this).
2. **Before coding any task** → automatically run `node scripts/ledger.mjs preflight` (must pass). Out of scope / missing deps → STOP and ask. **Match code style:** `docs/conventions/code-style.md` + `.project/conventions.yaml` (camelCase, structure, adjacent files).
3. **Find work** → `ledger next` (optionally `--focus`); paste `ledger handoff` into a new chat.
4. **User product originals** → `docs/product/sources/…`. Never rewrite. `ledger sources`.
5. **Board / milestones** → `ledger board`; `ledger new ms "Sprint 1"`.
6. **Notes** → `ledger note "..."` on the focused task.
7. **Finish** → `ledger done TASK-####` (enforces runs/evidence/tests rules) then `ledger review` before PR.
8. **Create entities** → `ledger new …`
9. **Skills / MCP / hooks / security / style** as in `docs/agent-protocol.md`
10. **Validate** before claiming done

Do not invent a parallel process. Read `docs/agent-protocol.md`.
