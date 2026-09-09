# Code style (host project)

**Mandatory for agents** when `rules.follow_existing_codebase_style: true` in `.project/project.yaml`.

Machine-readable summary: `.project/conventions.yaml`  
Preflight prints these rules before coding.

## Before you edit

1. Read **adjacent files** of the same kind (same folder, same language).
2. Follow **existing** patterns — do not introduce a second style in the same codebase.
3. Smallest diff; no drive-by refactors or unrelated formatting.

## Naming (default — override in `.project/conventions.yaml`)

| Kind | Convention | Example |
|------|------------|---------|
| Variables | camelCase | `userId`, `orderTotal` |
| Functions / methods | camelCase | `fetchOrder`, `validateInput` |
| Classes / types | PascalCase | `OrderService`, `PaymentIntent` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRIES`, `API_BASE_URL` |
| Files | kebab-case | `order-service.js`, `payment-utils.ts` |
| Directories | kebab-case | `src/lib/`, `docs/product/` |

If this repo already uses a different convention (e.g. snake_case in Python), **match the repo**, not this table.

## Structure

See [`structure.md`](structure.md) for folder layout and where new code belongs.

## Do not

- Add a new framework, ORM, or folder layout without user request or an ADR
- Mix naming styles in the same module
- Rename unrelated symbols “for consistency” outside the task scope
- Skip tests or evidence because style-only — still run verification before `ledger done`

## Customize

Edit `.project/conventions.yaml` and this file for your stack (Python, Go, React, etc.).  
Run `node scripts/ledger.mjs preflight` — it will print the active naming rules.
