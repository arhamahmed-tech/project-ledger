# Changelog

All notable changes to **project-ledger** are documented here.

## 0.11.0 — 2026-09-09

### Fully autonomous agent startup
- Cursor `beforeSubmitPrompt` and Claude `SessionStart` hooks auto-run `ledger context` + `ledger onboard` (no user prompt required)
- AGENTS.md / protocol / always-apply rules: agents **must** self-run context → onboard → preflight before coding
- Toolkit reminder updated for autonomous flow

### Agent onboarding (from 0.10.2)
- `ledger onboard` — SDLC phase (`sources_only`, `specification`, `planning`, `implementation`, `active`) + Done / Not started narrative
- Empty `context` and `adopt` completion point to `onboard`

### Code style enforcement (agent-facing)
- `docs/conventions/code-style.md` + `structure.md` — naming (camelCase, PascalCase, kebab-case files, etc.)
- `.project/conventions.yaml` — machine-readable naming; customize per host repo
- `preflight` prints **CODE STYLE (mandatory)** when `follow_existing_codebase_style: true`
- `validate` / `doctor` require conventions files

## 0.10.2 — 2026-09-09

### Agent onboarding
- `ledger onboard` — single command for SDLC phase (`sources_only`, `specification`, `planning`, `implementation`, `active`) plus Done / Not started narrative (what agents inferred from `status`+`board`+`sources` in 0.10.0)
- Empty `context` and `adopt` completion point to `onboard`

### Code style enforcement (agent-facing)
- `docs/conventions/code-style.md` + `structure.md` — explicit naming (camelCase, PascalCase, kebab-case files, etc.)
- `.project/conventions.yaml` — machine-readable naming; customize per host repo
- `preflight` prints **CODE STYLE (mandatory)** block when `follow_existing_codebase_style: true`
- `validate` / `doctor` require conventions files; Cursor/Claude rules + AGENTS.md updated

## 0.10.1 — 2026-09-09

### Existing / mid-build projects
- `ledger adopt [--name]` — onboard a repo that already has code: init/upgrade without clobbering, seed `docs/product/sources/` from README/docs, write `ADOPTION-CHECKLIST.md`, bootstrap epic, run inventory
- `ledger inventory` — list top-level dirs not covered by any TASK/CHG `files:`
- `init` when already present points to `adopt` / `upgrade` / `inventory`

## 0.10.0 — 2026-09-09

### Agent UX
- `ledger next [--focus]` — next ready task (deps satisfied)
- `ledger handoff` — paste block for a new chat
- `ledger note <text>` — append note to focused task + context

### Delivery
- Milestone entity `MS-*` under `docs/plans/milestones/`
- `ledger new ms "Sprint 1"`; task/release can link `--ms` / `--release`
- `ledger board` — milestones / epics / plans / tasks / releases

### Quality
- `ledger done TASK-####` — enforces `agent_runs` / evidence / tests rules from `project.yaml`
- `ledger review` — validate + check + preflight before PR

## 0.9.3 — 2026-09-09

### Preflight before coding
- New command: `ledger preflight [TASK-id]` — fail-closed gate for SPEC pin, out-of-scope printout, `depends_on`, blocked/cancelled, stale pins, unresolved ADRs
- TASK template/schema: `depends_on`, `blocks`, `out_of_scope_risk` + checklist
- AGENTS.md / agent-protocol / Cursor rule / hooks reminder require preflight before coding
- Edge cases: out-of-scope prompts and missing deps → stop and ask the user

## 0.9.2 — 2026-09-09

### User product sources
- Added `docs/product/sources/{sow,specs,briefs,misc}/` for **user-provided** originals (full SOW/spec knowledge)
- Agents must read sources before formal `ledger new sow|spec`; must **not** rewrite originals
- New command: `ledger sources`
- Wired into AGENTS.md, agent-protocol, Cursor rule, validate/doctor/status/upgrade

## 0.9.1 — 2026-09-09

### Cursor ignore / rules loading
- **Wrong:** many projects had `.cursorignore` hiding `.cursor/`, `docs/`, or `AGENTS.md` — Cursor then silently ignores Project Ledger
- `doctor` now **FAIL**s and prints `WRONG: …` with the blocking patterns
- `init` patches `.cursorignore` with un-ignore rescue rules when conflicts exist
- Only **one** `alwaysApply: true` Cursor rule (`project-ledger.mdc`) — extra alwaysApply rules are often silently downgraded/ignored by Cursor

## 0.9.0 — 2026-09-09

### Production hardening
- Modular CLI: `src/lib/{paths,parse,model}.mjs`; vendored as `scripts/.project-ledger/` + thin `scripts/ledger.mjs`
- Audit chain: `event_hash` / `prev_hash` on new events; `validate` detects tampering / breaks
- Hard-gate defaults: `init` recommends + auto-installs git pre-commit when in a git repo; CI workflow ships in scaffold
- `upgrade` prints migration notes; doctor checks vendored modules + CI workflow
- Broader failure-path tests (hash mismatch, untraced check, audit chain)

### Migration (0.8 → 0.9)
1. `node path/to/project-ledger/bin/project-ledger.js upgrade` (set `LEDGER_PKG_ROOT` if needed)
2. Commit `scripts/ledger.mjs` **and** `scripts/.project-ledger/`
3. `node scripts/ledger.mjs hooks install`
4. Confirm `.github/workflows/project-ledger.yml` is present
5. `node scripts/ledger.mjs doctor && node scripts/ledger.mjs validate`

Legacy audit lines without `event_hash` remain valid; new events extend the chain from the last line.

## 0.8.0 — 2026-09-09

- Epics, active context (`context` / `focus`), `ledger new` / `revise`
- `check` (git diff vs TASK/CHG), CI workflow, hooks install, agent-trace
- `rules:` enforcement in validate/drift; SPEC/SOW content_hash checks
- find-skills scaffold for Cursor + Claude

## 0.7.0 — 2026-09-09

- Epic + context handoff + entity create + rules checks (interim)

## 0.6.0

- Harness-agnostic init, vendored CLI, validate/drift/why/impact/ui
