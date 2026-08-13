# ADR-007: Turkey V2 ADM3 Stable Identity

## Status

Accepted

## Context

Turkey V2 must allow official, OpenStreetMap, and generated ADM3-like zones to coexist without
claiming that generated game zones are official neighbourhoods. IDs must stay deterministic across
source feature order, ring coordinate order, Unicode normalization differences, and Turkish
dotted/dotless `i` casing.

## Decision

Turkey V2 ADM3 IDs use `territorykit-tr-v2-adm3-stable-id@1`.

The stable key contains:

- country `TR`
- province plate code
- district code
- source class: `official`, `osm`, or `generated`
- source-native identity for real sources
- generated algorithm version plus deterministic local key or seed-derived key for generated zones

The public helper is `createTurkeyV2Adm3TerritoryId()` in `@territory-kit/generators`.

Example canonical IDs:

- `tr:adm3:tr-il-34-ilce-003-official-123456`
- `tr:adm3:tr-il-34-ilce-003-osm-relation-987654`
- `tr:adm3:tr-il-34-ilce-003-generated-tr-adm3-generated-zone-v1-000042`

When a real source-native ID exists, name changes do not change the TerritoryKit ID. When generated
algorithm version changes, the generated ID changes intentionally because the generator contract has
changed. Geometry hashes are retained as build evidence, but geometry changes alone do not define
stable identity.

## Consequences

- The same source-native ID may safely appear in different districts.
- Official, OSM, and generated records cannot collide by hiding source class.
- Legacy Turkey schema-v1 IDs are not rewritten automatically.
- Migration artifacts must map old IDs to new IDs explicitly before applications update persisted
  claims, scores, ownership, or route summaries.
- Generated zones remain game coverage units, not official mahalle or köy records.
