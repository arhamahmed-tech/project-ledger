# Copilot instructions

Follow **`AGENTS.md`** and **`docs/agent-protocol.md`** in this repository.

- New chat: run `node scripts/ledger.mjs context` first; do not rescan all tasks  
- Switch work: `node scripts/ledger.mjs focus TASK-####`  
- Prefer existing project patterns over new abstractions  
- Use Project Ledger for non-trivial product work (`node scripts/ledger.mjs …`)  
- Security review for auth/payments/PII/admin changes  
- Do not invent secrets or skip validation at trust boundaries  
