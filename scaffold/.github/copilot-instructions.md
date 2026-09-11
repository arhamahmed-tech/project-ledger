# Copilot instructions

Follow **`AGENTS.md`** and **`docs/agent-protocol.md`** in this repository.

## Lifecycle

- **Setup / product change:** sources → formalize → ADR if needed → plans/tasks  
- **Normal task:** `context` → focus/next → `preflight` → implement → verify → `done` → `review`  
- Use `onboard` when phase/setup is unclear — do not regenerate valid artifacts for every small fix.

## Must

- New chat: `node scripts/ledger.mjs context` first  
- Before coding: `node scripts/ledger.mjs preflight` (plan must be approved when required; SPEC pin is not approval)  
- Verify: `ledger new evd "…" --run RUN-#### --result pass --task TASK-####`  
- List edited paths on task `files:`  
- Scope change: `ledger revise` (new revision); do not rewrite history  
- Security review for auth/payments/PII/admin changes  
- Do not invent secrets or skip validation at trust boundaries  
