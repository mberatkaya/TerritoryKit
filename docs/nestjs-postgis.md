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

The repository SQL contract uses:

- `ST_Intersects` with `&& ST_MakeEnvelope(...)` for viewport queries.
- `ST_Covers` for point lookup so boundary points match core default lookup semantics.
- Stable `order by id asc` ordering for deterministic responses.

The SQL exports in `examples/nestjs-postgis/src/postgis-queries.ts` are a baseline for consumers
that want to inspect, snapshot, or adapt the generated queries.

## Test Gates

- Unit tests cover controller request/response contracts, invalid input handling before repository
  calls, SQL text expectations, and row mapping.
- The PostGIS integration harness covers the controller, repository, bbox query, coordinate
  endpoint, row mapping, and SQL parameter order against the sample dataset.
- Live PostGIS verification remains an optional maintainer check: apply the migration, import a
  validated dataset into `territory_zones`, then run viewport and locate calls against a NestJS app
  instance.
