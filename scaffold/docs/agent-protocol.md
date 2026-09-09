# Agent protocol (harness-agnostic)

This file is the **canonical** instruction set for any coding agent harness
(Cursor, Claude Code, Codex, Copilot, Windsurf, OpenCode, etc.).

Harness-specific files (`CLAUDE.md`, `.cursor/rules/*`, `.github/copilot-instructions.md`)
should point here — do not fork conflicting policy.

## Decision order

1. Matching **skill** → read `SKILL.md` and follow it  
2. Unsure a skill exists → **`/find-skills`** / `npx skills find <query>`  
3. Live external system → **MCP**: discover schema → authenticate if needed → call  
4. Repeated policy → **hooks** (Cursor `.cursor/hooks.json`, Claude `.claude/settings.json`)  
5. Else implement  

## Project Ledger

Git is the source of truth for intent and history.

| Layer | Path |
|-------|------|
| Constitution | `.project/project.yaml` |
| Human docs | `docs/` |
| Engineering history | `.engineering/` |
| Audit | `.audit/events.jsonl` |
| Agent attribution | `.agent-trace/` |

CLI (any of):

```bash
npx project-ledger validate
npx project-ledger status
npx project-ledger drift
npx project-ledger why <path>
npx project-ledger ui
```

Before non-trivial work: REQ → SPEC@rev → ADR → PLAN → TASK → RUN → evidence.  
Never rewrite immutable SOW/SPEC revisions or accepted ADRs — supersede.  
Never claim completion without verification + evidence.

## Security & code review

Required for auth, payments, PII, admin, uploads, webhooks, secrets, risky deps.

- Prefer `/review-security` or `/review-bugbot` when the harness supports them  
- Record review evidence as `EVD-*` (kind `review`) for ledger-tracked work  
- Check AuthZ, injection, secrets, validation, least privilege, fail-closed defaults  

## Codebase style (host project)

Match **this** repository’s existing patterns:

1. Read adjacent files of the same kind  
2. Reuse naming, folders, validation, logging, tests, imports  
3. Do not introduce new frameworks/libs/folder conventions unless asked or an ADR requires it  
4. Smallest diff; no drive-by refactors  

## Harness adapters (installed by `project-ledger init`)

| Harness | Entry |
|---------|--------|
| Any / Codex / generic | `AGENTS.md` |
| Claude Code | `CLAUDE.md` + `.claude/settings.json` (+ `.claude/rules/`) |
| Cursor | `.cursor/rules/*.mdc` + `.cursor/hooks.json` |
| GitHub Copilot | `.github/copilot-instructions.md` |

Shared hook scripts: `.project/harness/`
