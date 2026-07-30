# Migration Guide

## `1.2.0`

The `1.2.0` release proposal is additive and does not require a dataset schema migration.
`territory-schema@1`, registry schema contracts, and `territory-migration-plan@1` remain the
active compatibility lines.

### Package Imports

Prefer package-specific imports for new code:

```ts
import { createTerritoryRuntime } from "@territory-kit/runtime";
import { createMapLibreTerritoryAdapter } from "@territory-kit/maplibre";
import { createNodeTerritoryRegistryClient } from "@territory-kit/registry/node";
```

The `@territory-kit/core/legacy-registry` subpath remains available for compatibility with
older core registry re-export usage. New browser or React Native code should use the
browser-safe root `@territory-kit/registry` entry point and keep filesystem/cache helpers under
`@territory-kit/registry/node`.

### Dataset Migrations

Use the migration-plan command when moving game or application state between dataset versions:

```sh
territory dataset migration-plan old-dataset.json new-dataset.json --json
```

Review mappings that require manual approval before applying them to game snapshots or
application ownership state. Critical migration scenarios are covered by dataset diff tests,
CLI migration-plan tests, and game snapshot migration tests.

### Turkey Data

No consumer migration is required for Turkey ADM0-ADM2. The current production evidence
confirms ADM0, ADM1, and ADM2 from generated artifacts and source locks. ADM3 remains
Gaziantep-only partial coverage and must not be treated as nationwide neighbourhood data.

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
