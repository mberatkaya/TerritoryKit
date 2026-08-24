# NestJS And PostGIS

The NestJS package can serve TerritoryKit zones from the in-memory engine or from a repository
implementation backed by PostGIS. The runtime public API stays unchanged for the 1.0 readiness
work.

## Module Contract

```ts
TerritoryKitModule.forRoot({
  dataset,
  repository
});
```

- `dataset` is always required and is used to construct the core engine.
- `repository` is optional. When present, controller endpoints call it after request validation.
- Invalid query or body input is rejected with `BadRequestException` before repository methods are
  called.

## Endpoints

The OpenAPI contract for these endpoints is documented in
[NestJS OpenAPI contract](./nestjs-openapi.md).

`GET /territories`

Required query parameters:

- `west`, `south`, `east`, `north`

Optional query parameters:

- `level`, `zoom`

Response shape:

```json
{
  "zones": [],
  "cacheKey": "territorykit-sample:..."
}
```

The controller also sets an `ETag` header derived from the viewport cache key.

`POST /territories/locate`

Request body:

```json
{
  "lat": 41.01,
  "lng": 28.95,
  "level": 3
}
```

Response shape:

```json
{
  "zoneId": "tr:34:fatih"
}
```

## PostGIS Baseline

The example migration at `examples/nestjs-postgis/src/001_create_territory_zones.sql` creates the
`territory_zones` table and the indexes expected by `createPostgisTerritoryRepository`.

The repository schema stores version-aware production rows:

- `id` as the stable logical territory ID.
- `dataset_id` and `dataset_version` as the release namespace.
- `geometry_version` as the per-territory boundary revision.
- `geometry geometry(MultiPolygon, 4326)` with Polygon inputs normalized on import.
- `bbox`, `area_m2`, and `representative_point` for indexed viewport and map-label workflows.

The repository SQL contract uses:

- `ST_Intersects` with `&& ST_MakeEnvelope(...)` for viewport queries.
- `ST_Covers` for point lookup so boundary points match core default lookup semantics.
- Stable `order by level asc, id asc` bounds ordering and deepest-first point lookup.
- Optional `datasetVersion` filtering. Production callers should set it when multiple releases can
  coexist.

`importTerritoryDatasetToPostgis(client, dataset, options)` wraps imports in a transaction, ensures
schema/indexes by default, deletes stale rows for the same dataset version, and batch upserts zones
with `on conflict (dataset_id, dataset_version, id)`.

The SQL exports from `@territory-kit/nestjs` are a baseline for consumers that want to inspect,
snapshot, or adapt the generated queries.

## Test Gates

- Unit tests cover controller request/response contracts, invalid input handling before repository
  calls, SQL text expectations, row mapping, import batching, and version-aware idempotent upserts.
- The PostGIS integration harness covers the controller, repository, bbox query, coordinate
  endpoint, row mapping, and SQL parameter order against the sample dataset.
- Live PostGIS verification remains an optional maintainer check: apply the migration, import a
  validated dataset into `territory_zones`, then run viewport and locate calls against a NestJS app
  instance.
