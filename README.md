# project-ledger

Git-native **Project Ledger** for any existing repo — works with **any agent harness**.

| Harness | What `init` installs |
|---------|----------------------|
| **Any / Codex** | `AGENTS.md` + `docs/agent-protocol.md` |
| **Claude Code** | `CLAUDE.md` + `.claude/settings.json` + `.claude/rules/*` |
| **Cursor** | `.cursor/rules/*.mdc` + `.cursor/hooks.json` |
| **GitHub Copilot** | `.github/copilot-instructions.md` |

Shared hooks live in `.project/harness/` and are called from both Cursor and Claude.

## Install

```bash
cd /path/to/your-app
npm i -D project-ledger   # or path/tarball
npx project-ledger init --name your-app
npx project-ledger validate
```

## Publish

```bash
cd /var/www/projects/project-ledger
npm pack          # → project-ledger-0.4.0.tgz
npm publish --access public
```

## Canonical policy

**One protocol file:** `docs/agent-protocol.md`  
Harness files only adapt — they must not invent conflicting rules.

Includes: Project Ledger · skills/`find-skills` · MCP · hooks · **security/code review** · **host codebase style**.
