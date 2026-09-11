---
id: EVD-0000
kind: test
agent_run: RUN-0000
task: TASK-0000
command: "npm test"
result: pass
code_state: pending
git_head: null
path: .engineering/evidence/EVD-0000.md
recorded_at: 2026-01-01T00:00:00Z
---

# EVD-0000

## Verification

- Prefer: `ledger new evd "…" --run RUN-#### --result pass --task TASK-####`
- `result` must be one of: pass | fail | not_run | blocked | waived
- `code_state` is a hash of TASK `files:` (working tree). Changing those files invalidates this evidence for `done`.
- Recording this EVD file itself does not change `code_state`.
- Legacy evidence without `code_state` is not treated as fresh verification.
