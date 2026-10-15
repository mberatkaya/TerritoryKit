# ADR 0015 — Turkey settlement semantic association layer (Alternative B)

## Status

Accepted (Sprint 2C).

## Context

Sprint 2B.4 hybrid watershed partitioning did not meet Fatih Pareto gates (PR #117, NO-GO). Changing gameplay polygons would alter stable `tr:adm3:*` zone IDs and invalidate Rush&Claim scoring surfaces.

Mahalle/köy labels from OSM locality seeds still carry consumer value when presented as **semantic associations**, not as replacements for gameplay geometry.

## Decision

Introduce a versioned artifact schema `territorykit-tr-settlement-association@1` that:

- References existing `territory-schema@1` gameplay datasets by `datasetId`, `datasetVersion`, and `canonicalGeometryHash`.
- Emits 0..N settlement associations per gameplay zone and allows multi-zone links for the same `settlementRefId`.
- Uses `settlementRefId` namespaces qualified by `sourceSnapshotChecksum`; display names are never stable IDs.
- Separates zone-level geometric status (`SINGLE_SEED_MATCH`, `AMBIGUOUS_REVIEW_REQUIRED`, `UNSEEDED`) from record-level source review (`SOURCE_REVIEW_REQUIRED`) and verified official boundaries (`VERIFIED_BOUNDARY_MATCH`).
- Invalidates and rebuilds when `canonicalGeometryHash` or `sourceSnapshotChecksum` changes.
- `contentHash` is deterministic over semantic payload and **excludes** `builtAt`; full JSON file SHA-256 still changes when `builtAt` changes.
- `licenseIdentified` (upstream license name present) is separate from `publicationRightsStatus` (explicit redistribution/publication approval). Knowing `ODbL-1.0` does not imply approved publication rights.
- `VERIFIED_BOUNDARY_MATCH` is fail-closed: requires `official-boundary-overlay`, governed provenance, approved publication rights, per-record snapshot checksum, and spatial boundary evidence token — OSM seed point-in-zone rows remain geometric/semantic only.

Implementation lives in `@territory-kit/dataset/tr-settlement-association` (build + validate) and `@territory-kit/core` (`loadTrSettlementAssociationConsumer`, `createTrSettlementAssociationQuery`).

## Consequences

- No national rebuild, no new generated polygons, no rc.7/rc.8 overwrites.
- Consumers (e.g. Rush&Claim) keep `zoneId` for claims; settlement names are optional display metadata with explicit ambiguity handling.
- Official mahalle boundary claims remain blocked until licensed polygon sources are ingested and verified.

## Evidence

- Fatih builder: `scripts/tr-fatih-settlement-association.mjs`
- Reports: `reports/tr-adm3/mahalle-first-program/fatih-settlement-association*.json`
- Consumer contract: `docs/contracts/rushclaim-settlement-association.md`
