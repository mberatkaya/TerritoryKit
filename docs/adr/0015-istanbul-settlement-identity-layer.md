# ADR 0015 — Istanbul settlement identity layer (Alternative B)

## Status

Accepted (Sprint 2D pilot expansion on canonical API from PR #119 / main).

## Context

Sprint 2B.4 compared geometry-changing watershed hybrids (Alternative A) with **semantic association** (Alternative B): keep pinned gameplay zone polygons and stable zone IDs; attach OSM locality seeds as non-authoritative mahalle semantics. Sprint 2C proved the pattern on Fatih using `SettlementIdentityLayer` and fail-closed consumer loading.

Sprint 2D extends the same canonical APIs to seven additional Istanbul pilots without introducing `TrSettlementAssociation` (superseded experimental API from PR #118).

## Decision

1. Use only `buildSettlementIdentityLayer`, `validateSettlementIdentityLayer`, `loadSettlementIdentityConsumer`, and `createSettlementIdentityLookup` from `@territory-kit/dataset` / `@territory-kit/core`.
2. Pin **rc.8 gameplay district shards** (`.territory/national-geometry-remediation/candidate-rc8-impl-rev1`) as the sole gameplay geometry source — no v1.7 replay substitution.
3. Pin OSM barrier locality seeds per ADM2 parent; record source-lock state honestly (`verified` only when lock bytes exist).
4. Version identity artifacts separately from gameplay (`identityLayerVersion`, `contentChecksum`); geometry immutability enforced via zone-ID and geometry-hash set SHA-256 pins.
5. `autoDisplayNameAllowed` remains **false** for automatic seed associations; human review evidence required before display-name promotion.
6. Official municipal polygons (e.g. Kadıköy acquisition) remain **BLOCKED_BY_SOURCE** until structurally valid licensed bundles exist — OSM seeds do not upgrade to official boundaries.

## Consequences

- Rush&Claim and other consumers may load semantic metadata via `loadSettlementIdentityConsumer` without changing claim/scoring/ownership geometry.
- Production / npm / CDN publication remains **NO_GO** until redistribution licenses and hosted delivery gates are accepted separately.
- Cross-district duplicate normalized names are informational; duplicate canonical `settlementId` across parents requires review evidence.

## Evidence

- `reports/tr-adm3/mahalle-identity-layer/istanbul-pilot-matrix.json`
- `reports/tr-adm3/mahalle-identity-layer/sprint-2d-decision.json`
- `docs/datasets/turkey-settlement-identity-consumer-contract.md`
- Rush&Claim handoff: `reports/tr-adm3/sprint-3-national-rc/rushclaim-sprint-4-handoff.md` (geometry vs semantics separation unchanged)
