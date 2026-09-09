# Codebase style

**Mandatory** when editing application code.

1. Read `docs/conventions/code-style.md` and `.project/conventions.yaml`.
2. Default naming: camelCase variables/functions, PascalCase classes, UPPER_SNAKE_CASE constants, kebab-case files — **or match this repo** if it already differs.
3. Read adjacent files first; smallest diff.
4. No new frameworks or folder layouts without user request or ADR.

Run `node scripts/ledger.mjs preflight` before coding — it prints active style rules.
