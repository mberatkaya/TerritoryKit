# Migration Guide

## `1.0.0`

The `1.0.0` release freezes the current public APIs for `@territory-kit/dataset`,
`@territory-kit/core`, `@territory-kit/maplibre`, `@territory-kit/nestjs`,
`@territory-kit/generators`, and `@territory-kit/cli`. No dataset migration is required for
this release because `territory-schema@1` remains unchanged.

### Lower Administrative Levels

`TerritoryAdminLevel` now includes `ADM5`. Existing ADM0-ADM2 ids and manifests remain valid.
Optional metadata fields such as `sourceAdminLevel`, `semanticType`, `localTypeName`,
`hierarchyDepth`, `semanticReviewStatus`, and `coverageStatus` are additive.

Coverage registries no longer use `municipality` or `neighbourhood` as pseudo-level keys. Consumers
should read ADM keys (`ADM0` through `ADM5`) and inspect `semanticType` for local meaning.

Registry fallback is opt-in. Code that wants broader fallback should call
`resolveDeepestAvailableTerritoryArtifact` or pass `fallback: "deepest-available"` through the
MapLibre helper, then display `renderedLevel` separately from `requestedLevel`.

## Before `1.0.0`

Public APIs may still change during prerelease sprint work. Breaking changes must be recorded
in `CHANGELOG.md`, and dataset schema changes must be documented in Schema Migrations.

Before the stable release, additive API changes must include TypeScript exports, API docs,
tests, and a changelog note. Breaking API changes require a new migration section and should
not be mixed with release-hardening fixes.

## Dataset Schema

`territory-schema@1` is the current schema. Geometry updates should change `datasetVersion`,
`sourceDate`, and `geometryHash`; shape-breaking changes require a new schema id and migration
notes.

## H3 Non-Goal

TerritoryKit does not migrate H3 indexes or hex cells. H3-like ergonomics map to dataset zone
APIs such as `latLngToZone`, `zoneToBoundary`, `zoneNeighbors`, and `polygonToZones`.
