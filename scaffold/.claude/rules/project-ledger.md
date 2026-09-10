# Project Ledger — follow docs/agent-protocol.md

You are in a Project Ledger repository. Canonical rules: `docs/agent-protocol.md` and `AGENTS.md`.

**Lifecycle:** setup (sources → formalize → plans) vs normal task (`context` → preflight → implement → evd → done → review). Use `onboard` only when phase/setup is unclear.

**New chat:** run `node scripts/ledger.mjs context` first; if empty/setup unclear, run `onboard`.
**Before coding:** `preflight` — SPEC pin ≠ plan approval; out of scope → ask.
**Finish:** fresh `ledger new evd … --result pass --task …` then `done` then `review`.
Never rewrite immutable history. Run `validate` before claiming ledger completion (records ≠ working software).
