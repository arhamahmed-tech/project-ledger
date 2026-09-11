# project-ledger

[![npm version](https://img.shields.io/npm/v/project-ledger.svg)](https://www.npmjs.com/package/project-ledger)
[![node](https://img.shields.io/node/v/project-ledger.svg)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/project-ledger.svg)](./LICENSE)

**Git-native Project Ledger** — durable SDLC source of truth in any repo, with production gates (CI, pre-commit, audit chain).

Track epics, requirements, SOW/spec revisions, ADRs, plans, tasks, agent runs, and evidence in Git — plus an **active context** file so a new chat can resume work without re-reading every task. Ships a CLI plus agent adapters for **Cursor**, **Claude Code**, **GitHub Copilot**, **Codex**, and anything that reads `AGENTS.md`.

> Not another SDLC SaaS. A thin protocol + tools around your repo. See [CHANGELOG.md](./CHANGELOG.md).

---

## Install

```bash
npm install --save-dev project-ledger
# or
pnpm add -D project-ledger
# or
yarn add -D project-ledger
```

Requires **Node.js ≥ 18**.

### Initialize a new project

```bash
cd /path/to/your-app
npx project-ledger init --name your-app
npx project-ledger doctor
npx project-ledger validate
```

### Adopt an existing / mid-build project

Already have code (and maybe docs)? Use **adopt** — it fills missing ledger files without overwriting yours, copies existing docs into `docs/product/sources/`, writes an adoption checklist, and inventories untraced code dirs:

```bash
cd /path/to/existing-app
npm i -D /path/to/project-ledger   # or published package
npx project-ledger adopt --name your-app
npx project-ledger inventory
npx project-ledger hooks install
npx project-ledger doctor
```

Then: formalize SOW/SPEC from `docs/product/sources/`, create tasks with `files:` for areas you still change.

### Upgrade an already-ledgered project

```bash
npx project-ledger upgrade
```

`init` will:

- Scaffold `.project/`, `docs/`, `.engineering/`, `.audit/`
- Install harness adapters (`AGENTS.md`, Cursor rules, Claude Code config, Copilot instructions)
- Vendor a local CLI at `scripts/ledger.mjs` (hooks work even if `npx` is offline)
- Add npm scripts: `ledger`, `ledger:validate`, `ledger:status`, …

---

## Quick start

```bash
npx project-ledger status
npx project-ledger context          # resume active epic/plan/task in a new chat
npx project-ledger validate
npx project-ledger drift
npx project-ledger why src/payments/refund.ts
npx project-ledger impact EPIC-0001
npx project-ledger new epic "Checkout hardening"
npx project-ledger new task "Wire refund API" --plan PLAN-0001
npx project-ledger focus TASK-0001 --notes "edge cases"
npx project-ledger ui
```

After init you can also use the vendored CLI (recommended in CI / hooks):

```bash
node scripts/ledger.mjs validate
pnpm ledger validate   # if package.json scripts were merged
```

### Lifecycle (v0.12+)

Not thirteen mandatory steps for every task:

| Mode | Flow |
|------|------|
| Setup / product change | `sources` → formalize SOW/REQ/SPEC → ADR if needed → plans/tasks |
| Normal task | `context` → focus/next → `preflight` → implement → verify (`evd`) → `postflight`/`done` → `review` |
| Safeguards | hooks/CI → `validate` / `check` (strict by default; `LEDGER_STRICT=0` softens stop hooks) |

`preflight` / `postflight` / `done` respect plan approval (`implementation_requires_approval`). A SPEC pin is not approval. Evidence must be `result=pass` with a fresh `code_state` of the task’s `files:`. `postflight` fails on implementation drift (changed code outside `task.files`).

---

## CLI reference

| Command | Description |
|---------|-------------|
| `project-ledger init [--name <app>] [--force]` | Scaffold ledger + harness files; vendor `scripts/ledger.mjs` |
| `project-ledger upgrade` | Refresh missing scaffold files, vendor CLI, bump `ledger_version` |
| `project-ledger doctor` | Check setup + run validate |
| `project-ledger status` | Focus + entity counts + drift summary |
| `project-ledger context` | Print active epic/plan/task paths for a new chat |
| `project-ledger onboard` | Phase diagnosis when setup/focus is unclear |
| `project-ledger preflight [TASK]` | Readiness before coding (SPEC, approval, deps, scope print) |
| `project-ledger postflight [TASK]` | After coding: no drift + fresh evidence (same gates as done) |
| `project-ledger next [--focus]` | Next ready task |
| `project-ledger done <TASK-*>` | Complete if postflight gates pass |
| `project-ledger review` | validate + check (+ preflight/postflight if focused) before PR |
| `project-ledger focus <id>` | Set active context (`EPIC`/`PLAN`/`TASK`/`SPEC`/`REQ`); `--clear` to reset |
| `project-ledger new <kind> <title>` | Create epic/req/spec/sow/plan/task/adr/run/chg/evd/test/rel |
| `project-ledger revise <SPEC-\|SOW-*>` | New immutable revision + `content_hash` |
| `project-ledger validate` | Ledger structure + reference integrity (not “software works”) |
| `project-ledger check` | Git diff vs TASK/CHG `files:` (CI / pre-commit) |
| `project-ledger hooks install` | Install `.git/hooks/pre-commit` (validate + check) |
| `project-ledger trace <note>` | Append `.agent-trace/traces.jsonl` |
| `project-ledger history <id>` | Audit events for an entity |
| `project-ledger why <path>` | Trace file → EPIC / REQ / SPEC / ADR / PLAN / RUN |
| `project-ledger who <path>` | Actors linked to a file |
| `project-ledger drift` | Stale runs, broken links, unresolved decisions, rule violations |
| `project-ledger impact <id>` | Impact for `EPIC-*` / `ADR-*` / `REQ-*` / `SPEC-*` / `SOW-*` |
| `project-ledger timeline [n]` | Recent audit events |
| `project-ledger decisions` | List ADRs |
| `project-ledger event <action> <target>` | Append audit event |
| `project-ledger hash <path>` | Content hash (spec body) |
| `project-ledger ui [--port 3847]` | Local dashboard |

Binary aliases: `project-ledger` and `ledger`.

---

## What you get

| Area | Details |
|------|---------|
| **Intent** | Epics, versioned SOW / REQ / ProductSpec-compatible SPEC revisions (immutable history) |
| **Decisions** | ADRs (supersede, never rewrite) |
| **Execution** | Plans, tasks, agent runs, change records, evidence |
| **Context** | `.project/context.yaml` + `ledger context` / `ledger focus` for chat handoff |
| **Gates** | CI workflow, `ledger check`, optional `hooks install`, `LEDGER_STRICT=1` |
| **Audit** | Append-only `.audit/events.jsonl` + `.agent-trace/traces.jsonl` |
| **Agents** | Skills / find-skills, MCP, hooks, security review, host codebase style |
| **Harnesses** | Cursor · Claude Code · Copilot · generic `AGENTS.md` |

Canonical agent policy (all tools): `docs/agent-protocol.md`

---

## Agent harness support

| Harness | Installed by `init` |
|---------|---------------------|
| Any / Codex | `AGENTS.md`, `docs/agent-protocol.md` |
| Claude Code | `CLAUDE.md`, `.claude/settings.json`, `.claude/rules/*` |
| Cursor | `.cursor/rules/*.mdc`, `.cursor/hooks.json` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Shared hooks | `.project/harness/*` |

---

## Usage in package.json

After `init`, scripts typically look like:

```json
{
  "scripts": {
    "ledger": "node scripts/ledger.mjs",
    "ledger:status": "node scripts/ledger.mjs status",
    "ledger:context": "node scripts/ledger.mjs context",
    "ledger:validate": "node scripts/ledger.mjs validate",
    "ledger:check": "node scripts/ledger.mjs check",
    "ledger:doctor": "node scripts/ledger.mjs doctor",
    "ledger:drift": "node scripts/ledger.mjs drift",
    "ledger:upgrade": "node scripts/ledger.mjs upgrade",
    "ledger:ui": "node scripts/ledger.mjs ui"
  }
}
```

---

## Environment

| Variable | Purpose |
|----------|---------|
| `LEDGER_ROOT` | Override project root (default: `cwd`) |
| `LEDGER_PKG_ROOT` | Override package root when resolving `scaffold/` |
| `LEDGER_PORT` | Dashboard port (default: `3847`) |
| `LEDGER_ALLOW_NPX` | Set to `1` only if you want hooks to fall back to `npx` |
| `LEDGER_STRICT` | Set to `1` so stop hooks exit non-zero on validate failure |
| `LEDGER_DIFF_RANGE` | Git range for `check` (e.g. `main...HEAD` in CI) |

---

## Install from path / tarball

Useful before or instead of the public registry:

```bash
npm install --save-dev /path/to/project-ledger
npm install --save-dev ./project-ledger-0.5.0.tgz
```

---

## Development

```bash
git clone <this-repo>
cd project-ledger
npm test
npm pack
```

---

## License

MIT © Project Ledger contributors
