# Sprint 2F — technical decisions

## Contract separation

- **Gameplay territory**: rc.8 zone IDs and geometry pins are authoritative for claim/scoring surfaces.
- **Settlement identity**: human semantic labels are versioned in `human-review-decision-ledger.json` and never overwrite gameplay geometry.
- **Official administrative geometry**: separate acquisition matrix; 0 verified mahalle polygons in this sprint.

## Stale review protection

Decisions are invalid when pinned context drifts: zone ID, per-zone geometry hash, settlement IDs, OSM snapshot checksum, identity layer version/checksum, gameplay dataset version, parent ADM2.

## Distribution

- `autoDisplayNameAllowed` remains **false** for all 173 baseline records.
- Attributed human decisions in ledger history: **0** (expected 0 at generation time).
