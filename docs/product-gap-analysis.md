# Product Gap Analysis

Last updated: 2026-08-22

This maps the original TerritoryKit technical sprint intent to repository evidence. Status values
are `implemented`, `partial`, `missing`, or `future roadmap`.

| Requirement                                                              | Status         | Repository Evidence                                                                                                                  |
| ------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Renderer-independent TypeScript SDK for Polygon/MultiPolygon territories | implemented    | `packages/core`, `packages/dataset`, `packages/maplibre`                                                                             |
| Coordinate-to-territory lookup                                           | implemented    | `packages/core/src/engine.ts`, `packages/core/test/engine.test.ts`                                                                   |
| Boundary, center, bbox queries                                           | implemented    | `packages/core/src/engine.ts`, `packages/dataset/src/types.ts`                                                                       |
| Parent/child hierarchy                                                   | implemented    | `packages/core/test/engine.test.ts`, generated `hierarchy-report.json` artifacts                                                     |
| Adjacency traversal                                                      | implemented    | `packages/dataset/src/adjacency.ts`, `packages/generators/src/adjacency.ts`                                                          |
| Zoom-based level selection                                               | implemented    | `packages/core/src/level-strategy.ts`, `packages/maplibre/src/index.ts`                                                              |
| Viewport-based loading                                                   | implemented    | `packages/runtime`, `examples/web-maplibre`, `examples/web-leaflet-turkey`                                                           |
| Stable territory IDs                                                     | implemented    | `packages/generators/src/turkey-adm3-pilot.ts`, `createTurkeyV2Adm3TerritoryId`, generated `identity-map.json`                       |
| Registry-backed datasets                                                 | partial        | `packages/registry`, `datasets/registry`; hosted production registry is not implemented                                              |
| Partial coverage and fallback metadata                                   | implemented    | `packages/registry/src/client.ts`, `packages/data-tr/src/index.ts`                                                                   |
| Renderer adapters                                                        | partial        | MapLibre, Leaflet, and OpenLayers exist; React Native remains future roadmap                                                         |
| Backend integration                                                      | implemented    | `packages/nestjs`, `examples/nestjs-postgis`                                                                                         |
| Optional game state outside core                                         | partial        | Core keeps state separate; `@territory-kit/game` is future roadmap                                                                   |
| Production lower-admin source ingestion                                  | partial        | Turkey V2 national playable ADM3 exists through official/OSM/generated policy; nationwide official ADM3 remains blocked              |
| Full production geometry quality gates                                   | implemented    | `reports/tr-v2-national/quality-report.json` and topology reports verify the Turkey V2 publish-ready artifact                        |
| Shared-boundary-aware simplification tiers                               | partial        | `territory geometry simplify --strategy topology-safe` emits audited real tiers only                                                 |
| MVT render artifacts                                                     | partial        | Country build can emit render artifacts; full national tile-budget policy still needs ops QA                                         |
| Real Turkey MapLibre demo                                                | partial        | `examples/web-maplibre-turkey` loads registry-backed Turkey MVT artifacts when provided                                              |
| Hosted live production demo                                              | future roadmap | No hosted production deployment exists in this repository                                                                            |
| Dataset diff/migration tooling                                           | partial        | Generic migration plans exist; RC-to-stable evidence is release-specific, while future source promotions still need migration review |
| Turkey V2 data contract                                                  | implemented    | `docs/datasets/turkey-v2-data-contract.md`, `@territory-kit/dataset/turkey-v2`, `--profile tr-v2`                                    |
| KapRota-style Turkey V2 generated game-zone generator                    | implemented    | `buildTurkeyGameZones`, `territory tr adm3 generate`, `docs/datasets/turkey-v2-game-zone-generator.md`                               |
| Turkey V2 hybrid ADM3 source-priority pipeline                           | implemented    | `buildTurkeyV2HybridDistrict`, `buildTurkeyV2HybridBatch`, `territory tr adm3 hybrid build`, ADR-009                                 |

Turkey ADM0-ADM2 has a reviewed national source path, and Turkey V2 now has nationwide playable
ADM3 coverage through reviewed real sources where available plus deterministic generated fallback.
This is not nationwide official mahalle/koy coverage. Generated fallback remains non-official, and
ADM4 remains source-model blocked.
