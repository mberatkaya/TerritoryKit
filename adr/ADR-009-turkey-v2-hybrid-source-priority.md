# ADR-009: Turkey V2 Hybrid Source Priority

## Status

Accepted

## Context

KapRota needs a single non-overlapping playable layer for Turkey districts. Real mahalle and köy
polygons should be preserved where available, OSM administrative boundary polygons can improve
coverage where official sources are absent, and generated game zones should fill only the remaining
uncovered district geometry.

Sprint 1 defined the Turkey V2 source-class and stable identity contract. Sprint 2 added the
`tr-adm3-game-zone-v2` generator. Sprint 3 combines those pieces without publishing the final
national artifact.

## Decision

Turkey V2 hybrid district builds use fixed source priority:

```text
official > osm > generated
```

The pipeline clips official candidates to the ADM2 district, subtracts official effective coverage
from OSM, computes the missing real-coverage gap, then calls Sprint 2 `buildTurkeyGameZones` only
for that missing geometry.

Final zone `sourceClass` is limited to `official`, `osm`, or `generated`. Provider access policy is
kept separately as `providerClass`, so a runtime-only official source is represented as
`providerClass: "runtime"` and `sourceClass: "official"`. Experimental sources are excluded unless
explicitly enabled.

Official and OSM IDs are preserved when clipping changes geometry within the same parent district.
Generated IDs continue to use the Sprint 2 algorithm version. Migration artifacts record
replacement, split, merge, parent-change, geometry-change, and source-class-change evidence; they do
not execute application ownership or score transfers.

ODbL and official source licenses are not collapsed into the repository code license. Hybrid
artifacts carry per-zone provenance, grouped attribution, license, and distribution policy
manifests.

## Consequences

- Real polygons have priority over generated coverage and remain distinguishable at runtime.
- OSM coverage can be included without marking it official or losing ODbL attribution.
- Generated zones cannot be shown as mahalle or köy records.
- Strict quality gates can fail a district even when generated fallback fills geometry, for example
  when provenance or license metadata is missing.
- National 81-province build work remains a later source-acquisition and release task.
