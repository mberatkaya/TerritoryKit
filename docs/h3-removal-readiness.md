# H3 Removal Readiness

## Executive Summary

Final decision: **READY FOR RUSH&CLAIM MIGRATION**.

TerritoryKit now has production evidence for the spatial capabilities needed to remove H3 as the
Rush&Claim gameplay spatial layer. Sprint 3 added reusable H3-to-territory migration tooling,
mobile version-mixing protection, live PostGIS validation, CI PostGIS coverage, and regression tests
for stable identity and geometry versions.

Rush&Claim production code was not modified in this sprint.

## Live PostGIS Results

Evidence file: `reports/postgis-live-validation.json`.

Environment:

- PostgreSQL: 16.4, PostGIS image `postgis/postgis:16-3.4`
- PostGIS: 3.4.3
- Host runtime: Node.js 24.14.0, macOS arm64
- Dataset: `territory-kit-tr-v2-playable@2.0.0`
- Imported subset: Turkey V2 benchmark 100, 4,551 zones, level 3

Validated on a real database:

- dataset import
- dataset/version persistence
- geometry persistence
- point lookup
- bounds lookup
- route lookup
- territory by ID
- hierarchy
- adjacency
- identity, dataset/version, parent, geometry GiST, and bbox GiST indexes

## Query Plans

All P0 spatial query plans used indexes and avoided sequential scans in the live run.

| Query                 | Index evidence                                  | Execution |
| --------------------- | ----------------------------------------------- | --------: |
| Point to territory    | `territory_zones_geometry_gist_idx`, Index Scan |  0.234 ms |
| Bounds to territories | `territory_zones_bbox_gist_idx`, Index Scan     |  0.554 ms |
| Route to territories  | `territory_zones_geometry_gist_idx`, Index Scan |  0.410 ms |
| Territory by ID       | btree index scan                                |  0.228 ms |
| Hierarchy             | btree parent index scan                         |  5.452 ms |

## Performance

Measured application round trip times against the live local PostGIS container.

| Workload                     |      p50 |      p95 |      p99 |
| ---------------------------- | -------: | -------: | -------: |
| Point lookup, 10,000 queries | 0.491 ms | 0.556 ms | 0.614 ms |
| Bounds, city viewport        | 1.959 ms | 2.326 ms | 6.588 ms |
| Route, medium                | 0.823 ms | 0.953 ms | 1.019 ms |

This is not an SLA. It is production-readiness evidence that the implemented query contracts are
practical for single GPS lookup, activity route lookup, and viewport delivery workloads.

## Dataset Quality

Turkey V2 national publish-ready reports are present under `reports/tr-v2-national`.

- ADM0: 1
- ADM1: 81
- ADM2: 973
- ADM3 final playable zones: 42,210
- Full dataset zones: 43,265
- Failed districts: 0
- Final coverage: 99.999998 percent
- Quality report: `ok: true`, `publishReady: true`
- Hard gate failures: 0
- Orphans: 0
- Hierarchy cycles: 0
- Duplicate stable IDs: 0
- Invalid final geometries: 0
- Effective sibling overlaps: 0
- Parent containment errors: 0
- Generated metadata errors: 0

Official ADM3 coverage remains low at 2,094 zones, with 40,116 generated zones. This is a product
semantics risk, not a H3 removal blocker, because generated zones are explicitly marked as generated
and the final playable coverage is effectively complete.

## Cross-runtime Validation

Sprint 3 regression tests cover:

- Node point, bounds, hierarchy, and adjacency deterministic behavior
- stable geometry version under ring orientation and ring-start changes
- geometry version change when geometry actually changes
- stable `territoryId` across geometry changes
- React Native offline point and viewport lookup
- stale mobile dataset detection
- checksum mismatch, interrupted download, partial install cleanup, and rollback behavior
- mobile query artifact `datasetId` and `datasetVersion` mismatch rejection

Real Expo/Hermes execution was not available in this repo. Hermes remains **not fully verified**,
but the React Native package stays free of Node-only imports in source boundary checks.

## Migration Tooling

Added package: `@territory-kit/migration`.

Added CLI:

```bash
territory migrate-spatial \
  --source source-zones.json \
  --target-dataset dataset.json \
  --strategy max-overlap \
  --target-level 3 \
  --source-system rushandclaim-h3 \
  --output migration-plan.json
```

Supported strategies:

- `centroid`: uses the source center and `latLngToZone`.
- `max-overlap`: intersects source polygon geometry with target territory polygons and chooses the
  largest overlap while preserving multi-target evidence.

Outputs include:

- `sourceSpatialId`
- `targetTerritoryId`
- `strategy`
- `confidence`: `EXACT`, `HIGH`, `AMBIGUOUS`, `NO_MATCH`
- `overlapAreaM2`
- `overlapRatio`
- all candidate target overlaps
- dry-run manifest
- ownership conflict report

Rush-specific scoring and ownership winner rules are intentionally not implemented in TerritoryKit.

## Rush&Claim Dependency Mapping

Current Rush&Claim scan found active H3 usage in backend Prisma schema, backend zone service,
activity scoring, seed data, API DTOs, and mobile map fallback/rendering. A source scan of backend
`src`, backend `prisma`, and mobile `src` found 302 H3-related matches.

| Rush responsibility | Current H3        | TerritoryKit replacement                                                 | Ready   |
| ------------------- | ----------------- | ------------------------------------------------------------------------ | ------- |
| GPS to zone         | `latLngToCell`    | point lookup / `findAtPoint`                                             | PASS    |
| Route to zones      | point to H3 cells | route territories                                                        | PASS    |
| Map polygon         | `cellToBoundary`  | territory geometry / MapLibre GeoJSON                                    | PASS    |
| Viewport            | `polygonToCells`  | bounds query                                                             | PASS    |
| Nearby              | `gridDisk`        | adjacency plus spatial nearby query                                      | PARTIAL |
| Identity            | `h3Index`         | `territoryId`                                                            | PASS    |
| Mobile fallback     | local `h3-js`     | offline cached territory dataset                                         | PASS    |
| Persistence         | `Zone.h3Index`    | `territoryId`, `datasetId`, `datasetVersion`, optional `geometryVersion` | PASS    |

Nearby is partial because TerritoryKit has adjacency and bounds primitives, but Rush must define the
product radius semantics for irregular polygons.

## Database Migration Plan

Recommended Rush phases:

1. Add nullable fields on `Zone`: `territoryId`, `datasetId`, `datasetVersion`,
   `geometryVersion`.
2. Add unique index on `(datasetId, datasetVersion, territoryId)` while retaining `h3Index`.
3. Export existing H3 zones with `h3Index`, polygon boundary, center, scores, and owner metadata.
4. Run `territory migrate-spatial` with `max-overlap`.
5. Review `AMBIGUOUS`, `NO_MATCH`, and ownership conflict diagnostics.
6. Backfill territory fields and keep dual reads.
7. Run shadow mode and compare H3 and TerritoryKit outputs.
8. Switch writes to TerritoryKit IDs.
9. Remove H3 fields only after rollback window closes.

## API Migration Plan

Replace H3-facing fields:

- `h3Index` -> `territoryId`
- `resolution` -> `datasetVersion` plus `level`
- `boundary` from `cellToBoundary` -> TerritoryKit geometry
- viewport H3 cell responses -> territory viewport responses

During the transition, keep old fields readable and add new fields first. Mobile clients can then
switch without requiring a hard cutover.

## Mobile Migration Plan

Replace:

- local `h3-js` current-cell lookup with cached point lookup
- local H3 viewport fallback with cached viewport query
- H3 boundary fallback with territory geometry
- selected H3 zone state with selected `territoryId`

Keep offline install, stale-version detection, checksum validation, partial-install cleanup, and
rollback as migration safety rails.

## Shadow Mode

Recommended Rush production migration mode:

- calculate H3 result and TerritoryKit result side by side
- keep production output on H3 initially
- log territory match, route territory count, latency, missing territory, dataset gaps, and errors
- promote TerritoryKit writes only after diagnostics are clean

## Rollback

Rollback requires:

- feature flag for read/write source
- retained `h3Index` data during transition
- dual persistence until verification completes
- mobile dataset version pinning
- ability to reactivate the previous mobile dataset version

## MVT

Decision: **MVT NOT REQUIRED FOR H3 REMOVAL**.

GeoJSON delivery and PostGIS viewport performance are sufficient for the measured workloads. MVT
can remain a follow-up for very dense nationwide map views or server-side tile hosting.

## Remaining Risks

1. Real Expo/Hermes runtime was not fully verified in this repo.
2. Official Turkey ADM3 coverage is low; generated zones must be acceptable for Rush gameplay.
3. Dateline-crossing polygons remain a known global limitation, but they are not a Turkey/Rush
   migration blocker.
4. Rush nearby semantics need product definition for irregular polygon adjacency or radius queries.

## H3 Removal Gate

P0 gates passed: 21/21.

- Point to territory production-ready: PASS
- Route to territories production-ready: PASS
- Bounds to territories production-ready: PASS
- Geometry and MapLibre production-ready: PASS
- Stable territory IDs production-ready: PASS
- Dataset versioning production-ready: PASS
- Geometry versioning production-ready: PASS
- Hierarchy production-ready: PASS
- Adjacency production-ready: PASS
- PostGIS live tested: PASS
- GiST usage verified: PASS
- Performance acceptable: PASS
- Mobile/offline validated: PASS
- Dataset validation acceptable: PASS
- Turkey coverage acceptable: PASS
- Migration tooling implemented: PASS
- Ambiguous mappings reportable: PASS
- Historical migration dry-run available: PASS
- Rush DB migration plan complete: PASS
- Rush API migration plan complete: PASS
- Rush mobile migration plan complete: PASS

## Final Readiness Decision

**READY FOR RUSH&CLAIM MIGRATION**
