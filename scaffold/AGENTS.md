# AGENTS.md

**Canonical agent instructions for every harness** (Cursor, Claude Code, Codex, Copilot, etc.).

Full protocol: [`docs/agent-protocol.md`](docs/agent-protocol.md)

## Must follow

1. **New chat / resume work** → run `node scripts/ledger.mjs context` (or `npx project-ledger context`) **first**. Use only the paths it prints; do not rescan every task file.
2. **Start / switch work** → `ledger focus TASK-####` (or EPIC/PLAN/SPEC/REQ). Persist notes with `--notes "..."`.
3. **Create entities** → `ledger new epic|req|plan|task|adr|run|chg|evd "title" …` (not hand-copied templates when avoidable).
4. **Skills** first → read project `.cursor/skills/` / `.claude/skills/` (includes **find-skills**) → **`/find-skills`** or `npx skills find` if unsure
5. **MCP** for live external systems (inspect schemas; auth when needed)
6. **Hooks** when present (Cursor and/or Claude)
7. **Security / code review** on sensitive changes
8. **Match this repo’s existing code style**
9. **Project Ledger** — `node scripts/ledger.mjs validate` before claiming ledger work done

Do not invent a parallel process. Read `docs/agent-protocol.md`.
