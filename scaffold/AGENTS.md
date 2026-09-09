# AGENTS.md

**Canonical agent instructions for every harness** (Cursor, Claude Code, Codex, Copilot, etc.).

Full protocol: [`docs/agent-protocol.md`](docs/agent-protocol.md)

## Must follow

1. **New chat / resume work** → run `node scripts/ledger.mjs context` (or `npx project-ledger context`) **first**. Use only the paths it prints; do not rescan every task file.
2. **User product originals** → live in `docs/product/sources/{sow,specs,briefs,misc}/`. Read them before creating formal SOW/SPEC. **Never rewrite** those originals; derive with `ledger new sow|spec`. List with `ledger sources`.
3. **Start / switch work** → `ledger focus TASK-####` (or EPIC/PLAN/SPEC/REQ). Persist notes with `--notes "..."`.
4. **Create entities** → `ledger new epic|req|sow|spec|plan|task|adr|run|chg|evd "title" …` (not hand-copied templates when avoidable).
5. **Skills** first → read project `.cursor/skills/` / `.claude/skills/` (includes **find-skills**) → **`/find-skills`** or `npx skills find` if unsure
6. **MCP** for live external systems (inspect schemas; auth when needed)
7. **Hooks** when present (Cursor and/or Claude)
8. **Security / code review** on sensitive changes
9. **Match this repo’s existing code style**
10. **Project Ledger** — `node scripts/ledger.mjs validate` before claiming ledger work done

Do not invent a parallel process. Read `docs/agent-protocol.md`.
