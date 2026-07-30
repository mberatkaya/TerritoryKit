# Product Gap Analysis

Last updated: 2026-07-30

This maps the original TerritoryKit technical sprint intent to repository evidence. Status values
are `implemented`, `partial`, `missing`, or `future roadmap`.

| Requirement                                                              | Status         | Repository Evidence                                                                          |
| ------------------------------------------------------------------------ | -------------- | -------------------------------------------------------------------------------------------- |
| Renderer-independent TypeScript SDK for Polygon/MultiPolygon territories | implemented    | `packages/core`, `packages/dataset`, `packages/maplibre`                                     |
| Coordinate-to-territory lookup                                           | implemented    | `packages/core/src/engine.ts`, `packages/core/test/engine.test.ts`                           |
| Boundary, center, bbox queries                                           | implemented    | `packages/core/src/engine.ts`, `packages/dataset/src/types.ts`                               |
| Parent/child hierarchy                                                   | implemented    | `packages/core/test/engine.test.ts`, generated `hierarchy-report.json` artifacts             |
| Adjacency traversal                                                      | implemented    | `packages/dataset/src/adjacency.ts`, `packages/generators/src/adjacency.ts`                  |
| Zoom-based level selection                                               | implemented    | `packages/core/src/level-strategy.ts`, `packages/maplibre/src/index.ts`                      |
| Viewport-based loading                                                   | implemented    | `packages/runtime`, `examples/web-maplibre`, `examples/web-leaflet-turkey`                   |
| Stable territory IDs                                                     | implemented    | `packages/generators/src/turkey-adm3-pilot.ts`, generated `identity-map.json`                |
| Registry-backed datasets                                                 | partial        | `packages/registry`, `datasets/registry`; hosted production registry is not implemented      |
| Partial coverage and fallback metadata                                   | implemented    | `packages/registry/src/client.ts`, `packages/data-tr/src/index.ts`                           |
| Renderer adapters                                                        | partial        | MapLibre, Leaflet, and OpenLayers exist; React Native remains future roadmap                 |
| Backend integration                                                      | implemented    | `packages/nestjs`, `examples/nestjs-postgis`                                                 |
| Optional game state outside core                                         | partial        | Core keeps state separate; `@territory-kit/game` is future roadmap                           |
| Production lower-admin source ingestion                                  | partial        | HDX/OCHA COD-AB Turkey ADM0-ADM2 lock path exists; ADM3 remains partial/blocker              |
| Full production geometry quality gates                                   | partial        | `production-quality-report.json` exposes failed strict findings; merge readiness is blocked  |
| Shared-boundary-aware simplification tiers                               | partial        | `territory geometry simplify --strategy topology-safe` emits audited real tiers only         |
| MVT render artifacts                                                     | partial        | Country build can emit render artifacts; full national tile-budget policy still needs ops QA |
| Real Turkey MapLibre demo                                                | partial        | `examples/web-maplibre-turkey` loads registry-backed Turkey MVT artifacts when provided      |
| Hosted live production demo                                              | future roadmap | No hosted production deployment exists in this repository                                    |
| Dataset diff/migration tooling                                           | future roadmap | Not implemented; tracked as post-1.0 roadmap                                                 |

Turkey ADM0-ADM2 now has a reviewed national source path, but Gaziantep remains only a partial ADM3
hardening pilot. The repo still must not claim complete production lower-admin operations until
nationwide ADM3/ADM4 source coverage, strict geometry findings, and production tile-budget evidence
are closed.
