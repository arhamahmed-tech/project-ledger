# AGENTS.md

**Canonical agent instructions for every harness** (Cursor, Claude Code, Codex, Copilot, etc.).

Full protocol: [`docs/agent-protocol.md`](docs/agent-protocol.md)

## Must follow

1. **Skills** first → **`/find-skills`** if unsure  
2. **MCP** for live external systems (inspect schemas; auth when needed)  
3. **Hooks** when present (Cursor and/or Claude)  
4. **Security / code review** on sensitive changes  
5. **Match this repo’s existing code style**  
6. **Project Ledger** — `npx project-ledger validate` before claiming ledger work done  

Do not invent a parallel process. Read `docs/agent-protocol.md`.
