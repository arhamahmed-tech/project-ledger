# project-ledger

[![npm version](https://img.shields.io/npm/v/project-ledger.svg)](https://www.npmjs.com/package/project-ledger)
[![node](https://img.shields.io/node/v/project-ledger.svg)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/project-ledger.svg)](./LICENSE)

**Git-native Project Ledger** — drop a durable source of truth into any existing repository.

Track requirements, SOW/spec revisions, ADRs, plans, agent runs, and evidence in Git. Ships a CLI plus agent adapters for **Cursor**, **Claude Code**, **GitHub Copilot**, **Codex**, and anything that reads `AGENTS.md`.

> Not another SDLC SaaS. A thin protocol + tools around your repo.

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

### Initialize a project

```bash
cd /path/to/your-app
npx project-ledger init --name your-app
npx project-ledger doctor
npx project-ledger validate
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
npx project-ledger validate
npx project-ledger drift
npx project-ledger why src/payments/refund.ts
npx project-ledger impact SPEC-0001
npx project-ledger ui
```

After init you can also use the vendored CLI (recommended in CI / hooks):

```bash
node scripts/ledger.mjs validate
pnpm ledger validate   # if package.json scripts were merged
```

---

## CLI reference

| Command | Description |
|---------|-------------|
| `project-ledger init [--name <app>] [--force]` | Scaffold ledger + harness files; vendor `scripts/ledger.mjs` |
| `project-ledger doctor` | Check setup + run validate |
| `project-ledger status` | Entity counts + drift summary |
| `project-ledger validate` | Structural + referential checks |
| `project-ledger history <id>` | Audit events for an entity |
| `project-ledger why <path>` | Trace file → REQ / SPEC / ADR / PLAN / RUN |
| `project-ledger who <path>` | Actors linked to a file |
| `project-ledger drift` | Stale runs, broken links, unresolved decisions |
| `project-ledger impact <id>` | Impact for `ADR-*` / `REQ-*` / `SPEC-*` / `SOW-*` |
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
| **Intent** | Versioned SOW / REQ / ProductSpec-compatible SPEC revisions (immutable history) |
| **Decisions** | ADRs (supersede, never rewrite) |
| **Execution** | Plans, tasks, agent runs, change records, evidence |
| **Audit** | Append-only `.audit/events.jsonl` |
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
    "ledger:validate": "node scripts/ledger.mjs validate",
    "ledger:doctor": "node scripts/ledger.mjs doctor",
    "ledger:drift": "node scripts/ledger.mjs drift",
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
