# Changelog

All notable changes to **project-ledger** are documented here.

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
