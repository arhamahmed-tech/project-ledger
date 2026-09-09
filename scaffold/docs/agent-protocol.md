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
| Active context | `.project/context.yaml` |
| **User originals** | `docs/product/sources/{sow,specs,briefs,misc}/` |
| Formal product docs | `docs/product/` (SOW / REQ / SPEC revisions) |
| Human docs | `docs/` |
| Engineering history | `.engineering/` |
| Audit | `.audit/events.jsonl` |
| Agent attribution | `.agent-trace/` |

### Product knowledge (user → ledger)

1. User drops full SOW / specs / briefs into **`docs/product/sources/`** (do not overwrite).
2. Agent runs `node scripts/ledger.mjs sources`, reads those files.
3. Agent creates formal immutable SOW/SPEC with `ledger new sow|spec` / `ledger revise` — derived from sources, not invented.
4. Implementation follows formal SPEC@rev only.

```bash
node scripts/ledger.mjs sources
```

### New chat bootstrap (any harness)

```bash
node scripts/ledger.mjs context
# or: npx project-ledger context
```

That prints the focused epic/plan/task/spec and **only the files to read**. Do not walk all of `docs/plans/tasks/`.

Set or switch focus:

```bash
node scripts/ledger.mjs focus TASK-0003 --notes "refund edge case"
node scripts/ledger.mjs new task "Wire refund API" --plan PLAN-0001   # auto-focuses
node scripts/ledger.mjs focus --clear
```

Hard gates (**required for production use**):

```bash
node scripts/ledger.mjs hooks install          # pre-commit: validate + check
# CI: .github/workflows/project-ledger.yml must stay enabled (fails PRs on validate/check)
LEDGER_STRICT=1                                # stop hooks exit non-zero on validate fail
```

Do not claim ledger completion without `validate` OK. Do not merge PRs that fail the ledger workflow.

CLI (any of):

```bash
node scripts/ledger.mjs validate
node scripts/ledger.mjs check
node scripts/ledger.mjs status
node scripts/ledger.mjs drift
node scripts/ledger.mjs why <path>
node scripts/ledger.mjs impact EPIC-0001
node scripts/ledger.mjs ui
```

Chain: **EPIC → REQ → SPEC@rev → ADR → PLAN → TASK → RUN → evidence**.  
Never rewrite immutable SOW/SPEC revisions or accepted ADRs — supersede via `ledger revise`.  
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
