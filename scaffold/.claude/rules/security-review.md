# Security & code review

For auth, payments, PII, admin, uploads, webhooks, secrets, or risky dependencies:

- Run a security-minded review (prefer `/review-security` / `/review-bugbot` when available)
- Check AuthZ, injection, secrets, validation, least privilege, fail-closed defaults
- Record evidence when work is ledger-tracked

See `docs/agent-protocol.md` § Security.
