# NestJS OpenAPI Contract

The `@territory-kit/nestjs` controller exposes a small OpenAPI surface for viewport and coordinate
lookup workflows. The decorators in the package provide query parameter metadata, request body
metadata, success response schemas, and bad-request responses for invalid input.

## Tags

- `territories`

## `GET /territories`

Returns territories intersecting a viewport. The controller sets `Cache-Control:
public, max-age=30` and an `ETag` derived from the viewport cache key.

Query parameters:

- `west` number, required. Western longitude bound.
- `south` number, required. Southern latitude bound.
- `east` number, required. Eastern longitude bound.
- `north` number, required. Northern latitude bound.
- `level` number, optional. Explicit territory level.
- `zoom` number, optional. Zoom resolved by the configured level strategy when `level` is not set.

Success response:

```json
{
  "zones": [
    {
      "id": "tr:34:fatih",
      "datasetId": "territorykit-sample",
      "level": 3,
      "parentId": "tr:34",
      "neighborIds": ["tr:34:kadikoy"],
      "geometry": {
        "type": "Polygon",
        "coordinates": []
      },
      "center": [28.965, 41.025],
      "bbox": [28.93, 41, 29, 41.05],
      "properties": {
        "name": "Fatih"
      }
    }
  ],
  "cacheKey": "territorykit-sample:..."
}
```

Failure response:

- `400` when bounds are missing, non-finite, out of geographic range, or unordered.

## `POST /territories/locate`

Returns the territory ID covering one coordinate.

Request body:

```json
{
  "lat": 41.01,
  "lng": 28.95,
  "level": 3
}
```

Success response:

```json
{
  "zoneId": "tr:34:fatih"
}
```

`zoneId` is `null` when no territory covers the coordinate.

Failure response:

- `400` when latitude or longitude is missing, non-finite, or out of geographic range.
- `400` when `level` is present but is not a non-negative integer.

## PostGIS Backing

When `TerritoryKitModule.forRoot({ dataset, repository })` receives a repository, both endpoints
call the repository after request validation. `createPostgisTerritoryRepository` binds the same
endpoint contract to the PostGIS SQL used by the example migration:

- `GET /territories` uses `ST_Intersects` with a `&& ST_MakeEnvelope(...)` prefilter.
- `POST /territories/locate` uses `ST_Covers` against `ST_MakePoint(...)`.
- Results are ordered by `id asc` for deterministic API responses.

The integration harness in `packages/nestjs/test/postgis-integration.test.ts` verifies the
controller, repository, bbox query, coordinate lookup, row mapping, and SQL parameter order against
the sample dataset.
