# project-ledger

Git-native **Project Ledger** for any existing repo. Works with **Cursor, Claude Code, Copilot, Codex**, and anything that reads `AGENTS.md`.

## Why 0.5 is better

- **Offline-first** — `init` vendors `scripts/ledger.mjs` into the target repo (hooks never call the npm registry)
- **`doctor`** — diagnoses missing files / CLI resolution
- **Harness-agnostic** — one protocol (`docs/agent-protocol.md`), thin adapters per tool
- **Security + codebase style** rules included
- Empty dirs fixed with README placeholders

## Install into any project (no npm publish needed)

```bash
# from the package folder
cd /var/www/projects/project-ledger
npm pack   # → project-ledger-0.5.0.tgz

# into your app
cd /path/to/your-app
npm i -D /var/www/projects/project-ledger
# or: npm i -D /var/www/projects/project-ledger/project-ledger-0.5.0.tgz

npx project-ledger init --name your-app
node scripts/ledger.mjs doctor
node scripts/ledger.mjs validate
```

Or without adding a dependency:

```bash
node /var/www/projects/project-ledger/bin/project-ledger.js init --name your-app
node scripts/ledger.mjs validate
```

## Daily commands

```bash
node scripts/ledger.mjs status
node scripts/ledger.mjs validate
node scripts/ledger.mjs drift
node scripts/ledger.mjs why src/foo.ts
node scripts/ledger.mjs impact SPEC-0010
node scripts/ledger.mjs ui
# if package.json scripts were merged:
pnpm ledger validate
```

## Harness map

| Harness | Files |
|---------|--------|
| Any | `AGENTS.md`, `docs/agent-protocol.md` |
| Claude Code | `CLAUDE.md`, `.claude/settings.json`, `.claude/rules/` |
| Cursor | `.cursor/rules/`, `.cursor/hooks.json` |
| Copilot | `.github/copilot-instructions.md` |
| Shared hooks | `.project/harness/` |

## Publish (optional)

```bash
cd /var/www/projects/project-ledger
npm publish --access public
```

Until published, always install from **path** or **tarball**.
