# CLAUDE.md — Claude Code

Follow the shared protocol: **[`AGENTS.md`](./AGENTS.md)** and **[`docs/agent-protocol.md`](./docs/agent-protocol.md)**.

## Claude-specific

- Project settings/hooks: `.claude/settings.json`  
- Personal overrides only: `.claude/settings.local.json` (gitignored)  
- Extra rules: `.claude/rules/*.md`  
- Prefer skills under project `.claude/skills/` (ships **find-skills**) and `~/.claude/skills/` when present  
- Use `/find-skills` or `npx skills find <query>` when a specialized workflow might already exist  

## Commands

```bash
node scripts/ledger.mjs context   # first in a new chat
node scripts/ledger.mjs focus TASK-0001
node scripts/ledger.mjs new epic "Outcome"
node scripts/ledger.mjs validate
node scripts/ledger.mjs status
node scripts/ledger.mjs drift
```

Do **not** diverge from `docs/agent-protocol.md` for Cursor-only rules — the protocol is shared.
