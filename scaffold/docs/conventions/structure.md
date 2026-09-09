# Repository structure (host project)

Agents must place work in the **existing** layout. Do not invent parallel trees.

## Ledger-owned (do not freestyle)

| Area | Path | Rule |
|------|------|------|
| Constitution | `.project/` | YAML + schemas only |
| User originals | `docs/product/sources/` | Drop files; never rewrite |
| Formal product | `docs/product/sow`, `requirements`, `specs` | `ledger new` / `revise` only |
| Plans / tasks | `docs/plans/` | `ledger new epic|plan|task|ms` |
| ADRs | `docs/architecture/adr/` | Immutable; supersede with new ADR |
| Runs / evidence | `.engineering/` | Linked from TASK / RUN |
| Audit | `.audit/events.jsonl` | Append-only |

## Application code (host project)

Default expectation (change in `.project/conventions.yaml` if your repo differs):

- **Source:** `src/` (or `lib/`, `app/` — use what already exists)
- **Tests:** `test/` or co-located `*.test.*` — match neighboring files
- **Config:** root or `config/` — match existing files
- **Scripts:** `scripts/` for repo tooling (including `scripts/ledger.mjs`)

When adding a feature:

1. Put files where similar features already live
2. List paths in TASK / CHG frontmatter `files:` so `ledger check` can trace them
3. Do not create `src/new-feature/` if the repo uses flat `src/` modules

## SDLC flow (mandatory)

```
sources → formal SOW/REQ/SPEC → epic/plan/task → preflight → code → run/evidence → done → review
```

Structure without ledger entities is not enough — every non-trivial change needs PLAN + TASK + SPEC pin.
