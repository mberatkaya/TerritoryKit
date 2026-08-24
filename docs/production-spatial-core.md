# Production Spatial Core

Sprint 1 hardens TerritoryKit as a polygon-first spatial engine for applications that persist
scores, ownership, claims, history, analytics, or other domain state against stable territories.
It does not add a hex grid, fixed cell index, H3 clone, route scoring, mobile tile delivery, or
Rush&Claim-specific business logic.

## Stable Territory Identity

`zone.id` is the canonical `territoryId`. It is the value applications should persist in their own
tables. Dataset rebuilds must not change it for the same logical territory.

`createTerritoryIdentity(dataset, zone)` and `engine.getIdentity(territoryId)` expose:

- `territoryId`: logical TerritoryKit identity, equal to `zone.id`.
- `datasetId`: dataset namespace.
- `datasetVersion`: dataset release.
- `geometryVersion`: boundary revision for that territory.
- `geometryHash`: geometry content signal used for the version when no explicit revision exists.
- `stableId`: optional upstream or custom semantic identifier preserved from
  `properties.territory.stableId`.

Administrative, generated, and custom datasets should all keep `zone.id` deterministic. Generated
datasets should derive IDs from stable inputs such as algorithm version, seed, parent, and local key.
Custom datasets should write the caller's durable ID into `zone.id`; `stableId` can preserve an
external system ID without replacing the canonical TerritoryKit ID.

## Dataset Versioning

`engine.getDatasetVersionInfo()` returns the manifest release identity:

- `datasetId`
- `datasetVersion`
- `geometryHash`
- `sourceDate`
- optional `buildDate`, `sourceProvider`, and `artifactChecksum`

`datasetVersion` changes when a dataset release changes. It is separate from `territoryId`, so the
same logical territory can appear in version N and N+1 with the same `territoryId`.

## Geometry Versioning

Geometry identity is not territory identity. Boundary changes should update `geometryVersion` or a
metadata hash such as `properties.territory.effectiveGeometryHash`.

When no explicit geometry metadata is present, core computes a deterministic version with
`createTerritoryGeometryVersion(geometry)`. The canonicalizer normalizes ring start coordinate,
ring orientation, hole ordering, and MultiPolygon component ordering so equivalent GeoJSON ordering
does not create accidental geometry revisions.

## Spatial Query API

`createTerritoryEngine()` now exposes production-oriented helpers while preserving legacy names:

- `findTerritoryAtPoint(point, options)` returns the deepest matching territory by default.
- `findTerritoriesAtPoint(point, options)` returns all matches sorted deepest-first.
- `findTerritoriesInBounds(bounds, options)` returns stable bbox-intersecting results with optional
  `level`, `levels`, and `limit`.
- `getById`, `getGeometry`, `getMetrics`, `getHierarchy`, `getParent`, `getChildren`, and
  `getAdjacentTerritories` expose a provider-style API without leaking dataset internals.

`level` and `levels` accept numeric levels or administrative labels such as `"ADM3"`.

## Point Lookup Semantics

Point lookup uses polygon geometry, not generated cells. The default `boundaryMode` is `"covers"`,
matching PostGIS `ST_Covers`: points on outer boundaries are included. `"contains"` excludes
boundary points.

Holes are handled explicitly. A point inside a hole is not covered. A point on a hole boundary is
covered in `"covers"` mode and excluded in `"contains"` mode, matching the boundary contract.

Longitude values outside `[-180, 180]` are wrapped before lookup. Latitude must remain finite and
within `[-90, 90]`; invalid coordinates return no match.

## Geometry Metrics

`engine.getMetrics(territoryId)` and lookup results include:

- `areaM2`
- `areaKm2`
- `centroid`
- `representativePoint`
- `bbox`

Area uses a spherical geodesic calculation, not a planar latitude/longitude approximation. The
representative point is selected on the surface when the centroid falls outside the polygon or in a
hole, so it is suitable for map labels.

## Hierarchy

`getHierarchy(territoryId)` returns `parentId`, `ancestorIds`, `childIds`, root-to-leaf `pathIds`,
and root/orphan flags. Existing programmer-error APIs such as `zoneToParent` and `getAncestors`
remain available.

Hierarchy is persisted as IDs. Do not infer parentage in PostGIS by running expensive containment
queries at request time.

## Adjacency

`getAdjacentTerritories(territoryId)` returns real polygon neighbors from `neighborIds`, adjacency
artifacts, and optional logical/manual connections. It is not an H3 `gridDisk()` clone.

Adjacency artifacts already distinguish `shared-border`, `point-touch`, `maritime`, and `logical`
relations. The production default for gameplay should prefer `shared-border`; point-touch and
manual edges should be requested explicitly when the application wants them.

## Bounds Query

Bounds queries are bbox-intersection primitives for backend/core use. They support level filtering,
multi-level filtering, stable ordering, invalid-bounds no-match behavior, and max result limits.

`queryTerritoriesInViewport()` builds on this primitive for map delivery. It resolves a level from
zoom when the caller does not provide one, applies a default page limit, returns `hasMore` and
`nextCursor`, and splits dateline-crossing bounds into two indexed lookups. Full global antimeridian
geometry normalization is still a dataset-build responsibility; the query helper prevents the
common mobile viewport case from expanding into an unintended nearly-global bbox.

## Route Query

`findTerritoriesAlongRoute(route, options)` accepts GeoJSON `LineString`, `[lng, lat][]`, or
`{ lng, lat }[]` input. Invalid coordinates, malformed routes, and routes with no non-zero segment
return an empty result.

The default `mode: "exact"` performs LineString-to-polygon intersection semantics in core by
splitting route segments at polygon ring crossings and testing interval midpoints against Polygon,
MultiPolygon, and hole-aware containment. Results include:

- `territories`: unique territory results sorted by first route contact.
- `traversal`: ordered route segments that preserve repeated entries such as `A -> B -> A`.
- `intersectionLengthM`, `firstIntersection`, `lastIntersection`, and route fractions for exact
  results.

`mode: "sampled"` is an explicit fallback for lightweight clients. It samples route points and runs
normal point lookup. Sampled results carry `method: "sampled"` and do not report
`intersectionLengthM`, so approximate output is not confused with exact intersection metadata.

## PostGIS Setup

The NestJS package exports:

- `POSTGIS_SCHEMA_SQL`
- `POSTGIS_INDEX_SQL`
- `POSTGIS_IMPORT_ZONES_SQL`
- `POSTGIS_DELETE_STALE_VERSION_SQL`
- `POSTGIS_BOUNDS_SQL`
- `POSTGIS_POINT_LOOKUP_SQL`
- `createPostgisTerritoryRepository(client, options)`
- `importTerritoryDatasetToPostgis(client, dataset, options)`

The production table stores `geometry(MultiPolygon, 4326)`, `bbox`, `area_m2`,
`representative_point`, `dataset_version`, and `geometry_version`. The primary key is
`(dataset_id, dataset_version, id)`, which allows version N and N+1 of the same logical territory to
coexist when desired.

## PostGIS Import

`importTerritoryDatasetToPostgis()` validates the in-memory dataset shape through the normal
TerritoryKit loader path before repository use, wraps import in a transaction, optionally ensures
schema/indexes, deletes stale rows for the same `(datasetId, datasetVersion)`, and batch upserts
zones. Re-importing the same dataset version is idempotent.

Polygon inputs are normalized to MultiPolygon with SRID 4326 at insert time.

## PostGIS Indexing And Queries

Indexes:

- btree on `(dataset_id, dataset_version, level)`
- btree on `(dataset_id, dataset_version, parent_id)`
- btree on `id`
- GiST on `geometry`
- GiST on `bbox`

Point lookup uses `ST_Covers` plus a GiST-friendly `&&` prefilter. Bounds lookup uses `bbox &&
ST_MakeEnvelope(...)`, `geometry && ST_MakeEnvelope(...)`, and `ST_Intersects(...)`.

Production callers should pass `datasetVersion` in `PostgisRepositoryOptions`. Omitting it is
supported for compatibility but can be ambiguous if multiple versions are stored.

## API Changes

This sprint is additive for TypeScript consumers. Existing core methods and NestJS endpoints remain.
The example PostGIS migration changes the recommended table schema; existing tables should be
migrated before using version-aware imports.

## Known Limitations

- Live PostGIS container CI is still optional; tests cover SQL contracts and repository behavior
  with deterministic query-client harnesses.
- Full temporal history and rollback policy are application choices. The schema can store multiple
  dataset versions, but no temporal API is added in Sprint 1.
- GPS noise filtering and scoring remain application concerns. TerritoryKit returns reusable route
  metadata but does not decide claim thresholds, cooldowns, or score rules.
- A live MVT tile server is not added here. Existing registry MVT artifacts remain the preferred
  delivery path for large ADM3+ render datasets.
