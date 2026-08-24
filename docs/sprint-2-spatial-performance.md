# Sprint 2 Spatial Performance

Sprint 2 adds route, viewport delivery, MapLibre GeoJSON payload, mobile offline, and PostGIS route
query contracts. This report records the local validation run and the remaining live PostGIS
blocker.

## Environment

- Date: 2026-08-24
- Host: macOS Darwin 25.5.0 arm64
- Node.js: 24.14.0
- pnpm: 11.7.0
- PostgreSQL detected: 16.12 Homebrew

## Dataset

Benchmarks used `createTurkeyAdm3DemoDataset()`, a synthetic Istanbul ADM3 fixture with 6 total
zones and 3 visible ADM3 neighbourhood polygons in the representative west-Istanbul viewport. This
is useful for correctness and payload sanity, not a nationwide Turkey performance claim.

## In-Memory Queries

Times are milliseconds from local Node.js runs against built packages.

| Query             |  Count |    p50 |    p95 |    p99 | Result                               |
| ----------------- | -----: | -----: | -----: | -----: | ------------------------------------ |
| Point lookup ADM3 |    100 | 0.0026 | 0.0153 | 0.2838 | 1 zone                               |
| Point lookup ADM3 |  1,000 | 0.0012 | 0.0026 | 0.0067 | 1 zone                               |
| Point lookup ADM3 | 10,000 | 0.0005 | 0.0008 | 0.0014 | 1 zone                               |
| Viewport ADM3     |  1,000 | 0.0017 | 0.0030 | 0.0087 | 3 zones                              |
| Route exact ADM3  |  1,000 | 0.0064 | 0.0177 | 0.0497 | 3 territories / 3 traversal segments |

## Payload Size

Payload uses the same 3-zone ADM3 viewport.

| Payload                            | JSON bytes | gzip bytes |
| ---------------------------------- | ---------: | ---------: |
| Raw GeoJSON                        |      2,612 |        518 |
| Minimal GeoJSON + geometryVersion  |      1,454 |        363 |
| Minimal + simplifyTolerance 0.0005 |      1,454 |        363 |

The fixture polygons are already rectangles, so simplification does not reduce them further. The
minimal-property mode still cuts uncompressed JSON by about 44%.

## Mobile Artifact Size

| Artifact                     | Bytes | gzip bytes |
| ---------------------------- | ----: | ---------: |
| Query JSON dataset           | 5,999 |        986 |
| `.tksi` binary spatial index | 1,044 |        407 |

React Native validation covers installed query artifacts, binary index loading, offline viewport
query, offline point lookup, stale-version detection, rollback, cancellation, and memory eviction.

## PostGIS Route Query

Implemented SQL contract:

- route input is GeoJSON `LineString`
- filter by `dataset_id`, optional `dataset_version`, and optional `level`
- GiST-friendly prefilter: `territory_zones.geometry && ST_Envelope(route.geometry)`
- exact predicate: `ST_Intersects(territory_zones.geometry, route.geometry)`
- metadata: `ST_Intersection`, `ST_Length`, route fraction, and closest route point

CI-safe tests snapshot the SQL, parameter order, controller endpoint, repository mapper, and route
response shape.

## Live PostGIS Validation

Status: BLOCKED

Attempted:

- `docker --version` succeeded with Docker 29.2.1.
- Starting `postgis/postgis:16-3.4` failed because the Docker daemon socket was unavailable:
  `/Users/mbkaya/.docker/run/docker.sock`.
- Local PostgreSQL 16.12 accepted connections on `127.0.0.1:5432`.
- `pg_available_extensions` did not list `postgis`; `pg_extension` did not contain `postgis`.

Because this environment has neither a running Docker daemon nor a local PostGIS extension, live
`EXPLAIN (ANALYZE, BUFFERS)` evidence and real GiST plan verification could not be produced in this
run.

Follow-up command once PostGIS is available:

```sql
EXPLAIN (ANALYZE, BUFFERS)
with route as (
  select ST_SetSRID(
    ST_GeomFromGeoJSON('{"type":"LineString","coordinates":[[28.94,41.01],[29.07,41.01]]}'),
    4326
  )::geometry(LineString, 4326) as geometry
)
select id
from territory_zones
cross join route
where dataset_id = 'territorykit-tr-adm3-demo'
  and level = 3
  and geometry && ST_Envelope(route.geometry)
  and ST_Intersects(geometry, route.geometry);
```

Expected plan characteristic: bitmap or index scan using `territory_zones_geometry_gist_idx`,
followed by exact `ST_Intersects` filtering.

## MVT Decision

Status: DEFERRED

For the measured 3-zone viewport, minimal GeoJSON is small enough. The repo already supports
registry MVT render artifacts and MapLibre vector source selection. A new live tile server or
`ST_AsMVT` endpoint is deferred until a nationwide ADM3 viewport benchmark shows GeoJSON is too
large for target mobile devices.

## Known Limitations

- Synthetic ADM3 fixture numbers are correctness and payload sanity evidence only.
- Live PostGIS EXPLAIN and GiST verification require Docker Desktop or a local PostGIS extension.
- PostGIS route results include ordered territory-level route metadata; repeated enter/exit
  decomposition for the same territory remains covered by core exact mode.
- Core route exact mode returns reusable spatial metadata; GPS noise filtering and claim scoring
  remain application logic.
