# CLAUDE.md — Claude Code

Follow the shared protocol: **[`AGENTS.md`](./AGENTS.md)** and **[`docs/agent-protocol.md`](./docs/agent-protocol.md)**.

## Claude-specific

- Project settings/hooks: `.claude/settings.json`  
- Personal overrides only: `.claude/settings.local.json` (gitignored)  
- Extra rules: `.claude/rules/*.md`  
- Prefer skills under `~/.claude/skills/` and project `.claude/skills/` when present  
- Use `/find-skills` when a specialized workflow might already exist  

## Commands

```bash
npx project-ledger validate
npx project-ledger status
npx project-ledger drift
```

Do **not** diverge from `docs/agent-protocol.md` for Cursor-only rules — the protocol is shared.
