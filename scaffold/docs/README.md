# Project Ledger

This repository uses **Project Ledger** — Git-native source of truth for intent, decisions, plans, agent runs, and evidence.

Install / refresh:

```bash
npx project-ledger init
npx project-ledger validate
npx project-ledger ui
```

| Layer | Path |
|-------|------|
| Constitution | `.project/` |
| Human docs | `docs/` |
| Engineering history | `.engineering/` |
| Audit | `.audit/events.jsonl` |
| Cursor rules/hooks | `.cursor/` |
| Claude | `CLAUDE.md` |

Agent rules also require: **skills / find-skills**, **MCP**, **security review**, and **matching this project's code style**.
