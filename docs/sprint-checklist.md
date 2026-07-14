# TerritoryKit Master Sprint Checklist

Last updated: 2026-07-14

This is the source of truth for the sprint roadmap from `TerritoryKit_Teknik_Sprint_Dokumani.pdf`.
A checkbox is marked only when the repo contains implementation, documentation, tests, or an
ADR that proves the item is done. Baseline work can stay checked, but the matching hardening item
must remain open until the sprint is genuinely complete.

## Ready-To-Tick Rules

- [ ] Code exists in the correct package boundary.
- [ ] Public API changes have TypeScript types.
- [ ] Public API changes are documented.
- [ ] Unit or integration tests cover the behavior.
- [ ] Examples or fixtures prove the intended flow where relevant.
- [ ] Benchmark impact is checked for performance-sensitive work.
- [ ] Security, license, and data-source impact is reviewed where relevant.
- [ ] Checklist, README, docs roadmap, and changelog stay consistent.

## Version Track

- [x] `0.0.1` - Sprint 0 - Alpha foundation.
- [x] `0.1.0-alpha.1` - Sprint 1 - Dataset layer.
- [x] `0.1.0` - Sprint 2 - Core zone engine.
- [x] `0.2.0-alpha.1` - Sprint 3 - Spatial index and coordinate lookup.
- [ ] `0.2.0` - Sprint 4 - Hierarchy and adjacency graph.
- [x] `0.3.0` - Sprint 5 - Zoom level and viewport queries.
- [ ] `0.4.0` - Sprint 6 - First MapLibre adapter.
- [ ] `0.5.0` - Sprint 7 - NestJS and PostGIS integration.
- [ ] `0.6.0` - Sprint 8 - Generator and CLI tools.
- [ ] `0.9.0-rc.1` - Sprint 9 - Quality, security, performance, docs.
- [ ] `1.0.0` - Sprint 10 - Stable open source release.

## MVP Scope

- [x] GeoJSON dataset loading baseline.
- [x] GeoJSON dataset validation baseline.
- [x] Coordinate-to-zone lookup baseline.
- [x] Zone boundary, center, and bbox output baseline.
- [x] Parent-child hierarchy baseline.
- [x] Neighbor graph traversal baseline.
- [x] Zoom-to-level strategy baseline.
- [x] Viewport-based zone query baseline.
- [x] MapLibre package boundary baseline.
- [x] NestJS package boundary baseline.
- [x] Turkey, Istanbul, and Fatih sample datasets.
- [x] Real-world GeoJSON import hardening.
- [ ] Full MapLibre runtime adapter.
- [ ] NestJS endpoint and PostGIS integration tests.
- [x] CLI dataset pipeline for validate/index/adjacency/import/simplify/generate.

## Out Of MVP

- [x] Do not bundle a complete global administrative dataset in MVP.
- [x] Do not operate satellite imagery or map tile servers.
- [x] Do not write a custom projection engine.
- [x] Do not attempt H3-grade global geodesic math in MVP.
- [x] Do not build a full visual map editor in MVP.
- [x] Do not embed game rules into `@territory-kit/core`.

## Design Principles

- [x] Core package is map-renderer independent.
- [x] Dynamic ownership and score state stay separate from geometry.
- [x] Zone IDs should remain stable when boundaries change where possible.
- [x] Packages and datasets use explicit versions.
- [x] Spatial index is required for production lookup.
- [x] GeoJSON remains the external API format.
- [ ] Add automated dependency-boundary checks so adapters cannot leak into core.
- [ ] Add license/data-source review workflow before real dataset imports.

## Target Architecture Package Map

- [x] `packages/core`.
- [x] `packages/dataset`.
- [x] `packages/generators`.
- [x] `packages/nestjs`.
- [x] `packages/maplibre`.
- [x] `packages/cli`.
- [x] `packages/shared-testkit`.
- [ ] `packages/game`.
- [ ] `packages/leaflet`.
- [ ] `packages/openlayers`.
- [ ] `packages/react-native-maps`.
- [x] `examples/web-maplibre`.
- [x] `examples/nestjs-postgis`.
- [x] `examples/node-basic`.
- [ ] `examples/react-native`.
- [ ] `datasets/world-example`.
- [x] `datasets/turkey-example`.
- [x] `datasets/istanbul-example`.
- [x] `datasets/fatih-example`.
- [x] `docs`.
- [x] `adr`.

## Versioning Strategy

- [x] npm packages use Semantic Versioning.
- [x] Changesets is configured for `@territory-kit/*`.
- [x] Dataset manifest includes `datasetId`.
- [x] Dataset manifest includes `datasetVersion`.
- [x] Dataset manifest includes `schemaVersion`.
- [x] Dataset manifest includes `sourceDate`.
- [x] Dataset manifest includes `geometryHash`.
- [x] Dataset compatibility policy is documented.
- [x] Schema migration policy is documented.
- [x] Changelog policy is automated in release workflow.
- [x] npm provenance is configured.

## Public API Checklist

- [x] `createTerritoryEngine({ dataset, levelStrategy })`.
- [x] `latLngToZone({ lat, lng }, options)`.
- [x] `latLngToZones([{ lat, lng }], options)`.
- [x] `zoneToBoundary(zoneId)`.
- [x] `zoneToCenter(zoneId)`.
- [x] `zoneNeighbors(zoneId, { distance })`.
- [x] `zoneToParent(zoneId)`.
- [x] `zoneToChildren(zoneId)`.
- [x] `getAncestors(zoneId)`.
- [x] `getDescendants(zoneId)`.
- [x] `isValidZone(zoneId)`.
- [x] `getZonesInBounds({ west, south, east, north, level })`.
- [x] `getVisibleZones({ bounds, zoom })`.
- [x] `polygonToZones`.
- [ ] Stable spatial index interface.
- [x] Debug-only brute-force lookup option.
- [x] Transition payload API for parent fade-out and child fade-in.
- [x] Typed adjacency connection metadata.

## H3 Equivalence Table

- [x] `latLngToCell` maps to `latLngToZone`.
- [x] `cellToBoundary` maps to `zoneToBoundary`.
- [x] `gridDisk` maps to `zoneNeighbors`.
- [x] `cellToParent` maps to `zoneToParent`.
- [x] `cellToChildren` maps to `zoneToChildren`.
- [x] `polygonToCells` maps to `polygonToZones`.
- [x] `isValidCell` maps to `isValidZone`.
- [x] Document H3 comparison with tradeoffs and non-goals.

## Test Strategy

- [x] Unit test baseline for dataset validation.
- [x] Unit test baseline for core engine behavior.
- [x] Unit test baseline for MapLibre layer specs.
- [x] Unit test baseline for NestJS module creation.
- [x] Unit test baseline for CLI smoke flow.
- [x] Fixture tests for Polygon and hierarchy baseline.
- [x] Fixture tests for MultiPolygon, holes, islands, and boundary points.
- [ ] Property-based tests for random coordinates and polygon combinations.
- [ ] Integration tests for NestJS + PostGIS + example dataset.
- [ ] Adapter tests for visual snapshots and event behavior.
- [ ] Benchmark tests for 10K, 100K, and 1M feature scenarios.
- [ ] Backward compatibility tests for dataset schema and public API.
- [ ] Cross-runtime test matrix for Node and browser builds.

## Performance Targets

- [x] `getZoneById` uses map lookup.
- [x] `getZoneById` p95 `< 1 ms` benchmark is recorded.
- [x] `latLngToZone` on 10K polygons p95 `< 10 ms`.
- [x] Viewport query on 10K polygons p95 `< 20 ms`.
- [ ] Dataset load for 10K polygons `< 500 ms` on reference machine.
- [ ] Map render target of 60 FPS is verified in adapter examples.
- [x] Bundle size budget is defined.
- [ ] Memory benchmark is recorded.

## Risk Management

- [x] Dirty or malformed GeoJSON is tracked as a high/high risk.
- [x] World-scale dataset size is tracked as a high/medium risk.
- [x] Map adapter API differences are tracked as a medium/high risk.
- [x] Hierarchy inconsistency is tracked as a high/medium risk.
- [x] Game logic leaking into core is tracked as a medium/medium risk.
- [x] Early API breakage is tracked as a high/medium risk.
- [x] License and data-source mismatch is tracked as a high/medium risk.
- [x] Add validation repair suggestions for dirty GeoJSON.
- [ ] Add viewport, simplification, and MVT roadmap for world-scale data.
- [x] Add adapter capability interface and fallback style policy.
- [ ] Add cycle/orphan validator docs and schema rules.
- [ ] Add `game` package boundary before any game state feature.
- [ ] Add experimental labels during `0.x`.
- [ ] Separate code and dataset license review.

## Sprint 0 - Product Definition, Research, Technical Decisions

Target version: `0.0.1`
Estimated duration: 1 week

### Technical Tasks

- [x] Finalize H3 and TerritoryKit comparison document.
- [x] Decide first supported runtime and Node.js versions.
- [x] Choose pnpm workspace and Turborepo/Nx approach.
- [x] Define GeoJSON RFC compatibility boundary.
- [x] Decide license: Apache-2.0.
- [x] Set code style, lint, format, commit, and release policy.
- [x] Create risk register and ADR folder.

### Deliverables

- [x] Product requirements document.
- [x] ADR-001 architecture decision.
- [x] Monorepo scaffold.
- [x] CI draft.
- [x] Roadmap and issue tracking baseline.

### Acceptance Criteria

- [x] Package responsibilities are documented.
- [x] MVP and out-of-MVP scope are documented.
- [x] Repo builds and tests with single commands.

## Sprint 1 - GeoJSON Schema and Dataset Layer

Target version: `0.1.0-alpha.1`
Estimated duration: 2 weeks

### Technical Tasks

- [x] Add `TerritoryZone` and `TerritoryDataset` types.
- [x] Define Polygon, MultiPolygon, and hole support baseline.
- [x] Add JSON Schema baseline and TypeScript validator.
- [x] Define ID, level, `parentId`, `childIds`, and `neighborIds` rules.
- [x] Add dataset metadata and `schemaVersion`.
- [x] Add Turkey, Istanbul, and Fatih example fixtures.
- [x] Harden real-world GeoJSON feature import validation.
- [x] Add feature-level validation issue paths.
- [x] Add validation repair suggestions.
- [x] Add antimeridian and coordinate-range notes.

### Deliverables

- [x] `@territory-kit/dataset`.
- [x] JSON Schema baseline.
- [x] Example datasets.
- [x] Validation error model.
- [x] Import-ready validation model.

### Acceptance Criteria

- [x] Valid dataset loads.
- [x] Self-intersection, missing ID, and invalid hierarchy are reported.
- [x] Duplicate IDs are rejected.
- [x] MultiPolygon, holes, islands, and dirty input cases are covered.
- [x] Same ID cannot appear twice across imported FeatureCollections.

## Sprint 2 - Core Zone Engine Basics

Target version: `0.1.0`
Estimated duration: 2 weeks

### Technical Tasks

- [x] Add `createTerritoryEngine`.
- [x] Add `getZoneById`, `zoneToBoundary`, `zoneToCenter`, and `getZoneLevel`.
- [x] Add `isValidZone` and dataset registry baseline.
- [x] Add bbox and centroid helpers.
- [x] Define typed error behavior.
- [x] Add unit test baseline.
- [x] Add benchmark infrastructure.
- [x] Add coverage reporting and threshold.
- [x] Add bundle-size check.
- [x] Add centroid accuracy decision or ADR.

### Deliverables

- [x] `@territory-kit/core` first alpha.
- [x] Basic API docs.
- [x] At least 85% unit test coverage.
- [x] Benchmark harness.

### Acceptance Criteria

- [x] ID-based zone access is O(1)-style through a map.
- [x] Polygon and MultiPolygon boundaries are returned correctly.
- [x] Node.js and browser package builds are produced.
- [x] Spherical centroid accuracy is evaluated.
- [x] Bundle size is measured.

## Sprint 3 - Spatial Index and Coordinate-to-Zone Lookup

Target version: `0.2.0-alpha.1`
Estimated duration: 2 weeks

### Technical Tasks

- [x] Add R-tree/Flatbush bbox index baseline.
- [x] Integrate point-in-polygon lookup.
- [x] Configure boundary behavior with `covers` and `contains`.
- [x] Add same-point multi-level selection baseline.
- [x] Add batch `latLngToZones` API.
- [x] Add benchmark fixtures for 10K and 100K polygons.
- [x] Add benchmark report generation.
- [x] Formalize debug-only brute-force fallback.
- [x] Document antimeridian and projection limits.

### Deliverables

- [x] Spatial index module baseline.
- [x] `latLngToZone` API.
- [x] Benchmark report.
- [x] Spatial lookup behavior docs.

### Acceptance Criteria

- [x] 10,000 polygon dataset single-query target p95 `< 10 ms`.
- [x] Boundary point behavior is locked with tests.
- [x] Brute-force fallback exists only in debug mode.

## Sprint 4 - Hierarchy and Adjacency Graph

Target version: `0.2.0`
Estimated duration: 2 weeks

### Technical Tasks

- [x] Add `zoneToParent` and `zoneToChildren`.
- [x] Add `getAncestors` and `getDescendants`.
- [x] Add `zoneNeighbors(distance)` graph traversal baseline.
- [x] Add typed adjacency connection model.
- [x] Add geometric adjacency extraction tool.
- [x] Support manual bridge, tunnel, sea, and portal connection types.
- [x] Add cycle and orphan validation baseline.
- [ ] Add deterministic large-graph memory tests.

### Deliverables

- [x] Hierarchy module baseline.
- [x] Adjacency graph module baseline.
- [x] Adjacency CLI prototype baseline.
- [x] Logical connection fixtures.

### Acceptance Criteria

- [x] Hierarchy cycles are rejected.
- [x] `distance=2` neighbor behavior is deterministic.
- [x] Logical connections work independently from geometric touch.

## Sprint 5 - Zoom-Based Level Selection and Viewport Queries

Target version: `0.3.0`
Estimated duration: 2 weeks

### Technical Tasks

- [x] Add `ZoomLevelStrategy` interface.
- [x] Add default zoom-to-level mapping.
- [x] Add `getZonesInBounds` and `getVisibleZones`.
- [x] Produce parent fade-out and child fade-in transition data.
- [x] Add viewport cache keys and invalidation rule.
- [x] Define cross-level overlap rules.
- [x] Add fast pan/zoom race-condition guidance.

### Deliverables

- [x] Level selection module baseline.
- [x] Viewport query module baseline.
- [x] World-Turkey-Istanbul-Fatih demo data flow baseline.
- [x] Transition payload docs and tests.

### Acceptance Criteria

- [x] Zoom changes select only the target level.
- [x] Out-of-viewport polygons are not returned.
- [x] During transitions, the same area is not double-painted.

## Sprint 6 - First Map Adapter: MapLibre

Target version: `0.4.0`
Estimated duration: 2 weeks

### Technical Tasks

- [x] Create adapter capability/package boundary baseline.
- [x] Produce GeoJSON source, fill, and line layer specs.
- [x] Expose adapter lifecycle methods: attach, detach, updateData, updateTheme.
- [x] Bind region click and hover/press events.
- [x] Add selected, neutral, and faction state data shape baseline.
- [x] Bind zoom changes to core level strategy in a real map runtime.
- [ ] Define shared code boundary for web and React Native variants.
- [x] Add Playwright visual verification for web map.

### Deliverables

- [x] `@territory-kit/maplibre` package baseline.
- [x] Web demo baseline.
- [x] Real MapLibre web demo.
- [ ] React Native example screen.

### Acceptance Criteria

- [ ] Polygons align correctly on a real base map.
- [ ] Zoom-level transitions work on the map.
- [x] Theme changes apply without restarting the map.

## Sprint 7 - NestJS and PostGIS Integration

Target version: `0.5.0`
Estimated duration: 2 weeks

### Technical Tasks

- [x] Create `TerritoryKitModule` and provider baseline.
- [x] Add `GET /territories` viewport endpoint example.
- [x] Add `POST /territories/locate` coordinate lookup.
- [x] Add PostGIS geometry and GiST index migration example.
- [x] Add `ST_Covers`, `ST_Intersects`, and bbox SQL examples.
- [x] Add repository implementation for PostGIS.
- [x] Add cache and ETag strategy.
- [x] Add OpenAPI decorators and generated docs.
- [ ] Add integration test harness with PostGIS.

### Deliverables

- [x] `@territory-kit/nestjs` package baseline.
- [x] NestJS + PostGIS example baseline.
- [ ] Full OpenAPI documentation.
- [ ] PostGIS migration and integration tests.

### Acceptance Criteria

- [ ] BBox query returns only visible polygons.
- [ ] Coordinate endpoint returns the correct zone ID.
- [ ] Endpoint and integration tests pass against PostGIS.

## Sprint 8 - Generator and CLI Tools

Target version: `0.6.0`
Estimated duration: 3 weeks

### Technical Tasks

- [x] Add `territory validate` CLI baseline.
- [x] Add `territory index` CLI baseline.
- [x] Add `territory adjacency` CLI baseline.
- [x] Stabilize CLI output as JSON-first APIs.
- [x] Add `territory import`.
- [x] Add `territory simplify`.
- [x] Add `territory generate`.
- [x] Add Voronoi and weighted Voronoi generator MVP.
- [x] Add administrative GeoJSON import and simplification pipeline.
- [x] Add dataset manifest/checksum helper baseline.
- [x] Add feature-aware errors with feature ID and source path.

### Deliverables

- [x] `@territory-kit/cli` package baseline.
- [x] `@territory-kit/generators` package baseline.
- [x] CLI usage docs baseline.
- [x] Import/simplify/generate usage docs.

### Acceptance Criteria

- [x] Dataset validate/index can run from CLI.
- [x] Generated helper outputs are deterministic.
- [ ] Errors are reported by line/feature ID for real input files.

## Sprint 9 - Quality, Security, Performance, Documentation

Target version: `0.9.0-rc.1`
Estimated duration: 2 weeks

### Technical Tasks

- [x] Add quick-start docs baseline.
- [x] Add API reference docs baseline.
- [ ] Add full cross-runtime test matrix.
- [ ] Add fuzz tests and property-based tests.
- [ ] Add bundle size and memory benchmarks.
- [x] Add security policy.
- [x] Add code of conduct.
- [x] Add contribution guide.
- [x] Add migration guide.
- [x] Add changelog.
- [x] Add API docs for every public package.

### Deliverables

- [x] Documentation site baseline.
- [ ] Release candidate.
- [x] Benchmark results.
- [x] Contribution guide.

### Acceptance Criteria

- [ ] All public APIs are documented.
- [ ] Critical test matrix is green.
- [ ] No known blocking issues remain.

## Sprint 10 - 1.0 Release and Community Launch

Target version: `1.0.0`
Estimated duration: 1 week

### Technical Tasks

- [ ] Apply API freeze.
- [x] Configure npm provenance and release workflow.
- [ ] Verify all example projects one final time.
- [ ] Publish GitHub release notes and roadmap.
- [x] Define issue triage and maintenance process.
- [x] Define security channel.
- [ ] Prepare first community adapter template repo.

### Deliverables

- [ ] npm packages.
- [ ] GitHub `1.0.0` release.
- [ ] Live documentation.
- [ ] Public roadmap.

### Acceptance Criteria

- [ ] Clean project install and quick-start work.
- [ ] All packages publish under the same version policy.
- [ ] Feedback and security channels are active.

## Definition of Done

- [ ] Code review completed.
- [x] CI workflow exists.
- [x] Build passes.
- [x] Typecheck passes.
- [x] Lint passes.
- [x] Unit tests pass.
- [ ] Integration tests pass where relevant.
- [x] New public API has TypeScript types.
- [x] New public API has baseline documentation.
- [x] Breaking changes include changelog and migration notes.
- [x] Example dataset has an end-to-end core flow.
- [x] Performance impact is checked with benchmark.
- [ ] Security and license impact are reviewed.

## Post-1.0 Roadmap

- [ ] `1.1` - Leaflet and OpenLayers adapters.
- [ ] `1.2` - React Native Maps adapter.
- [ ] `1.3` - Vector tile/MVT support.
- [ ] `1.4` - Web-based Territory Studio editor.
- [ ] `1.5` - Dataset diff, migration, and zone ID mapping tools.
- [ ] `2.0` - Plugin-based generator system and advanced geodesic operations.
