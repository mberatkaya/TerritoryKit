# Rush&Claim — settlement semantic association consumer contract (preview)

This document describes how Rush&Claim should consume Turkey settlement associations **without** changing gameplay geometry or claim IDs.

## Touch flow

1. User taps a gameplay zone on the map.
2. **Claim/scoring** uses the existing `zoneId` from `territory-schema@1` (unchanged).
3. Load `territorykit-tr-settlement-association@1` sidecar for the district shard.
4. Query via `createTrSettlementAssociationQuery(artifact).getAssociationsForZone(zoneId)`.

## Display rules

| `associationStatus` (zone summary) | UI behavior                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| `SINGLE_SEED_MATCH`                | May show one settlement label as **informational** copy; include provenance tooltip.           |
| `AMBIGUOUS_REVIEW_REQUIRED`        | Do **not** pick a single mahalle name; show neutral zone label + “multiple settlements” state. |
| `UNSEEDED`                         | No settlement label; gameplay zone name only.                                                  |
| `VERIFIED_BOUNDARY_MATCH`          | Allowed only when official licensed boundary evidence exists (not expected for OSM seeds).     |

## API surface (TerritoryKit)

```ts
import { createTrSettlementAssociationQuery } from "@territory-kit/core";

const query = createTrSettlementAssociationQuery(artifact);
const result = query.getAssociationsForZone(zoneId);
// result.associationStatus, result.reasonCodes, result.provenance
const zones = query.getZonesForSettlement(settlementRefId);
```

## Non-goals (this sprint)

- No Rush&Claim backend/frontend PRs.
- No production CDN/npm publish of new datasets.
- No claim that OSM seed points equal legal mahalle boundaries.
