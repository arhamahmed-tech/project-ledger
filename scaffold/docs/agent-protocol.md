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

### Lifecycle (do not treat as 13 manual steps every task)

**Setup / product change** (when sources or requirements change):

`sources → formalize SOW/REQ/SPEC → ADR if needed → epic/plan/task`

**Normal task execution** (when the board already has an approved plan + task):

`context → focus/next → preflight → implement → verify (EVD) → postflight → done → review`

**Automatic safeguards**:

`hooks / CI → validate + check` — stop hooks **hard-fail by default** (`LEDGER_STRICT=0` to soften). `git commit --no-verify` can still bypass local hooks; enable required CI checks on the host.

Use `onboard` when phase diagnosis or missing setup needs it. Do **not** regenerate valid SOW/SPEC/plans for every small task.

### Gate contracts (accurate enforcement claims)

| Command | What it proves | What it does **not** prove |
|---------|----------------|----------------------------|
| `preflight` | Task has plan, SPEC@rev, deps ready; plan approved when required; prints scope | Later code is correct or still in scope |
| `postflight` | Current tree: readiness still true, no file drift vs `task.files`, fresh passing evidence | Product quality beyond recorded checks |
| `validate` | Ledger structure + reference integrity (+ audit hash chain) | Software works |
| `check` | Changed implementation paths are listed on TASK/CHG `files:` | Tests passed |
| `done` | Same as postflight, then sets status=done | Re-ran your suite automatically |
| `review` | validate + check (+ preflight + postflight if focused) | Host CI green |

A **SPEC pin is not approval**. When `rules.implementation_requires_approval: true`, plan `status` must be `approved` / `in_progress` / `done` (not `draft`). Agent-generated docs do not imply human approval.

### Evidence / verification

```bash
ledger new run "implement TASK-0001" --plan PLAN-0001
ledger new evd "npm test" --run RUN-0001 --result pass --task TASK-0001
ledger done TASK-0001
```

`result` values: `pass` | `fail` | `not_run` | `blocked` | `waived`.  
Only `pass` (or explicit `waived`) can satisfy `done`. `fail` / `not_run` / `blocked` never count as pass.

`code_state` hashes the task’s `files:` working tree. If those files change after evidence was recorded, `done` fails with `EVIDENCE_STALE`. Writing EVD under `.engineering/` does **not** invalidate that hash. Empty `files: []` fails `done` with `TASK_FILES_EMPTY` when evidence is required.

Legacy EVD without `code_state` is **not** treated as fresh verification — re-record.

### Scope / requirement changes (preserve history)

1. Update or add user originals under `docs/product/sources/` (do not rewrite prior formal revisions in place).
2. Identify impact: `ledger impact <EPIC|PLAN|SPEC>` / `ledger drift` / re-read affected plans.
3. Obtain approval when required (plan/ADR status — not inferred from a new SPEC file existing).
4. `ledger revise SPEC-####` or `ledger revise SOW-####` — creates a **new** revision; old revisions stay immutable.
5. Reassess tasks: keep tasks done against the old pin historically meaningful; create follow-up tasks for the new revision (update plan.spec to `SPEC@newRev` for new work only).

### Product knowledge (user → ledger)

1. User drops full SOW / specs / briefs into **`docs/product/sources/`** (do not overwrite).
2. Agent runs `node scripts/ledger.mjs sources`, reads those files.
3. Agent creates formal immutable SOW/SPEC with `ledger new sow|spec` / `ledger revise` — derived from sources, not invented.
4. Implementation follows formal SPEC@rev only.

```bash
node scripts/ledger.mjs sources
```

### Before coding a task (mandatory)

```bash
node scripts/ledger.mjs context
# onboard only if focus empty / setup unclear
node scripts/ledger.mjs preflight          # or: preflight TASK-0003
```

`preflight` fails closed when:

| Check | Fail meaning |
|-------|----------------|
| No / missing SPEC@rev | Cannot implement without a pinned spec |
| SPEC revision missing | Pin is broken |
| Plan still `draft` (approval required) | SPEC pin ≠ approval — set plan status to approved |
| Task `blocked` / `cancelled` | Do not code |
| `depends_on` not ready | Unfinished TASK / proposed ADR / missing entity |
| Proposed ADR on plan (approval required) | Resolve decision first |
| Stale SPEC pin | Warn — re-read current revision |

It also prints **In scope / Out of scope** from the SPEC. Edge cases:

- User asks for something **out of scope** → STOP, confirm with user (do not silently expand).
- Work **depends on** another task/system not listed → add `depends_on` or create a blocker task first.
- Spec pin behind `current_revision` → re-read current SPEC before coding.

Task frontmatter supports: `depends_on: []`, `blocks: []`, `out_of_scope_risk:`.

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
Valid ledger records alone do not prove working software.

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

## Codebase style (host project) — mandatory

When `rules.follow_existing_codebase_style: true` (default), agents **must** follow:

| Doc | Purpose |
|-----|---------|
| `docs/conventions/code-style.md` | Naming, formatting, patterns |
| `docs/conventions/structure.md` | Folder layout, where new code goes |
| `.project/conventions.yaml` | Machine-readable naming (e.g. `variables: camelCase`) |

`preflight` prints the active naming rules before coding.

1. Read adjacent files of the same kind  
2. Reuse naming, folders, validation, logging, tests, imports  
3. Default naming: **camelCase** vars/functions, **PascalCase** classes, **UPPER_SNAKE_CASE** constants, **kebab-case** files — override in `conventions.yaml` or match the repo if it already differs  
4. Do not introduce new frameworks/libs/folder conventions unless asked or an ADR requires it  
5. Smallest diff; no drive-by refactors  

Ledger does not run ESLint/Prettier — enforcement is **agent rules + preflight reminder + your CI linters** on the host repo.

## Harness adapters (installed by `project-ledger init`)

| Harness | Entry |
|---------|--------|
| Any / Codex / generic | `AGENTS.md` |
| Claude Code | `CLAUDE.md` + `.claude/settings.json` (+ `.claude/rules/`) |
| Cursor | `.cursor/rules/*.mdc` + `.cursor/hooks.json` |
| GitHub Copilot | `.github/copilot-instructions.md` |

Shared hook scripts: `.project/harness/`
