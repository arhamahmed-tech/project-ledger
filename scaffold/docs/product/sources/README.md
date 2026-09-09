# Product sources (user-provided originals)

Drop the **customer / stakeholder originals** here. This is full product knowledge
*before* (or beside) formal ledger entities.

| Folder | Put here |
|--------|----------|
| `sow/` | Original statements of work, contracts, engagement docs |
| `specs/` | Original product specs, PRDs, Figma exports, ProductSpec drafts |
| `briefs/` | One-pagers, discovery notes, emails turned into briefs |
| `misc/` | Anything else (roadmaps, competitor notes, research) |

## Rules

1. **User owns these files** — agents must not rewrite or “clean up” originals. Copy/derive into formal `docs/product/sow/` and `docs/product/specs/` instead.
2. **Before `ledger new sow` / `ledger new spec`:** read matching files under `docs/product/sources/`.
3. Formal versioned SOW/SPEC remain the **implementation source of truth**; sources remain the **provenance**.
4. Prefer markdown when possible; PDFs/images are fine — note the path in the formal SPEC/SOW body.

```bash
node scripts/ledger.mjs new sow "Engagement"   # after reading sources/sow/
node scripts/ledger.mjs new spec "Checkout" --req REQ-0001
```
