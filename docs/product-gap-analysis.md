# Product Gap Analysis

Last updated: 2026-07-18

This maps the original TerritoryKit technical sprint intent to repository evidence. Status values
are `implemented`, `partial`, `missing`, or `future roadmap`.

| Requirement                                                              | Status         | Repository Evidence                                                                         |
| ------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------- |
| Renderer-independent TypeScript SDK for Polygon/MultiPolygon territories | implemented    | `packages/core`, `packages/dataset`, `packages/maplibre`                                    |
| Coordinate-to-territory lookup                                           | implemented    | `packages/core/src/engine.ts`, `packages/core/test/engine.test.ts`                          |
| Boundary, center, bbox queries                                           | implemented    | `packages/core/src/engine.ts`, `packages/dataset/src/types.ts`                              |
| Parent/child hierarchy                                                   | implemented    | `packages/core/test/engine.test.ts`, generated `hierarchy-report.json` artifacts            |
| Adjacency traversal                                                      | implemented    | `packages/dataset/src/adjacency.ts`, `packages/generators/src/adjacency.ts`                 |
| Zoom-based level selection                                               | implemented    | `packages/core/src/level-strategy.ts`, `packages/maplibre/src/index.ts`                     |
| Viewport-based loading                                                   | implemented    | `packages/core/src/engine.ts`, `examples/web-maplibre/src/main.ts`                          |
| Stable territory IDs                                                     | implemented    | `packages/generators/src/turkey-adm3-pilot.ts`, generated `identity-map.json`               |
| Registry-backed datasets                                                 | partial        | `packages/registry`, `datasets/registry`; hosted production registry is not implemented     |
| Partial coverage and fallback metadata                                   | implemented    | `packages/registry/src/client.ts`, `packages/data-tr/src/index.ts`                          |
| Renderer adapters                                                        | partial        | MapLibre exists; Leaflet, OpenLayers, and React Native adapters are future roadmap          |
| Backend integration                                                      | implemented    | `packages/nestjs`, `examples/nestjs-postgis`                                                |
| Optional game state outside core                                         | partial        | Core keeps state separate; `@territory-kit/game` is future roadmap                          |
| Production lower-admin source ingestion                                  | partial        | Gaziantep ADM3 source lock and generated pilot exist; nationwide Turkey ADM3 is not claimed |
| Full production geometry quality gates                                   | partial        | `production-quality-report.json` exposes failed strict findings; merge readiness is blocked |
| Shared-boundary-aware simplification tiers                               | missing        | `simplification-report.json` omits `medium`/`low` until a topology-safe simplifier exists   |
| MVT render artifacts                                                     | partial        | Gaziantep ADM3 emits z12 MVT only; z13/z14 are not claimed                                  |
| Real Gaziantep MapLibre demo                                             | missing        | Existing `examples/web-maplibre` remains synthetic; real MVT demo is next-PR work           |
| Hosted live production demo                                              | future roadmap | No hosted production deployment exists in this repository                                   |
| Dataset diff/migration tooling                                           | future roadmap | Not implemented; tracked as post-1.0 roadmap                                                |

Gaziantep is therefore a useful end-to-end data hardening pilot, but not a merge-ready proof of
complete production lower-admin operations until the strict geometry findings, real MVT demo, and
topology-safe simplification story are closed.
