# Rush&Claim — settlement semantic association consumer contract (preview)

This document describes how Rush&Claim should consume Turkey settlement associations **without** changing gameplay geometry or claim IDs.

## Touch flow

1. User taps a gameplay zone on the map.
2. **Claim/scoring** uses the existing `zoneId` from `territory-schema@1` (unchanged).
3. Load `territorykit-tr-settlement-association@1` sidecar for the district shard.
4. **Fail-closed:** `loadTrSettlementAssociationConsumer({ dataset, artifact, expectedSourceSnapshotChecksum })` — do not query until `ok === true` (schema/datasetVersion/geometryHash/contentHash and optional seed snapshot must match).
5. Query via `consumer.query.getAssociationsForZone(zoneId)` and inspect `zoneResolution`:
   - `associated` — zone is in artifact scope with seed linkage.
   - `unseeded` — known gameplay zone with no seeds (distinct from invalid IDs).
   - `unknown-zone` — zone id not in dataset scope or outside artifact parent ADM2.

## Display rules

| `associationStatus` (zone summary) | UI behavior                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| `SINGLE_SEED_MATCH`                | May show one settlement label as **informational** copy; include provenance tooltip.           |
| `AMBIGUOUS_REVIEW_REQUIRED`        | Do **not** pick a single mahalle name; show neutral zone label + “multiple settlements” state. |
| `UNSEEDED`                         | No settlement label; gameplay zone name only.                                                  |
| `VERIFIED_BOUNDARY_MATCH`          | Allowed only when official licensed boundary evidence exists (not expected for OSM seeds).     |

## API surface (TerritoryKit)

```ts
import { loadTrSettlementAssociationConsumer } from "@territory-kit/core";

const consumer = loadTrSettlementAssociationConsumer({
  dataset,
  artifact,
  expectedSourceSnapshotChecksum: expectedSeedSnapshotSha256
});
if (!consumer.ok) {
  throw new Error("Settlement association artifact failed validation");
}
const result = consumer.query.getAssociationsForZone(zoneId);
// result.associationStatus, result.zoneResolution, result.reasonCodes, result.provenance
const zones = consumer.query.getZonesForSettlement(settlementRefId);
```

## Determinism note

- `contentHash` covers semantic association payload and excludes `builtAt`.
- Shipping JSON byte checksums (`.sha256` on report files) include `builtAt` and formatting — do not use file SHA-256 as a substitute for `contentHash`.

## Non-goals (this sprint)

- No Rush&Claim backend/frontend PRs.
- No production CDN/npm publish of new datasets.
- No claim that OSM seed points equal legal mahalle boundaries.
