# ADR-008: Turkey V2 Game-Zone Generator

## Status

Accepted

## Context

KapRota needs deterministic game regions that behave like an H3 replacement for route scoring, but
Turkey V2 ADM3 generated zones must remain Polygon/MultiPolygon territories inside ADM2 district
boundaries. Sprint 1 established the generated-zone metadata and stable-ID contract. Sprint 2 adds a
new production-oriented generator without removing the legacy V1 fallback generator.

## Decision

The Turkey V2 game-zone algorithm version is `tr-adm3-game-zone-v2`.

V2 uses deterministic recursive spatial partitioning:

- normalize the ADM2 Polygon/MultiPolygon input
- subtract optional occupied real zones from the district geometry
- select or resolve one of `urban`, `suburban`, `rural`, `auto`, or `custom`
- recursively split the missing geometry by deterministic bbox-aware cuts
- clip every piece back to the target geometry
- merge small fragments by nearest deterministic neighbour unless configured otherwise
- sort by stable spatial keys and canonical geometry hashes
- create IDs with `createTurkeyV2Adm3TerritoryId`
- compute coverage, overlap, containment, area distribution, compactness, and deterministic hashes
- optionally run the existing exact adjacency builder for generated siblings

The legacy `tr-adm3-generated-zone-v1` generator remains available through
`buildTurkeyAdm3GeneratedZones`. V2 is additive and is exposed through `buildTurkeyGameZones`,
`buildTurkeyGameZonesWithAdjacency`, and `territory tr adm3 generate`.

## Consequences

- V2 generated IDs intentionally differ from V1 IDs because `algorithmVersion` participates in the
  stable key.
- Any KapRota persisted ownership, scores, route summaries, or migration state must use explicit
  old-to-new mapping before switching from V1 to V2.
- Generated zones keep `sourceClass: "generated"`, `official: false`, `generated: true`, and
  `semanticType: "generated-zone"`.
- Generated zones must not be displayed as official mahalle or köy records.
- This generator does not build or publish a final national 973-district Turkey artifact.
- Auto profile works without population data; when density metadata is missing it falls back to
  deterministic geometry heuristics.
