# Agent Trace

Local JSONL at `traces.jsonl` (gitignored). Written by:

```bash
node scripts/ledger.mjs trace "started refund edge case"
# also auto-appended on: ledger focus / ledger new / ledger revise
```

Keep entries small: timestamp, action, target, optional note. Do not invent a parallel schema.
