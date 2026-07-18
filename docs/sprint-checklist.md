# TerritoryKit Master Sprint Checklist

Last updated: 2026-07-18

This is the source of truth for the sprint roadmap from `TerritoryKit_Teknik_Sprint_Dokumani.pdf`.
A checkbox is marked when the repo contains implementation, documentation, tests, ADRs, release
verification, or an explicit handoff/backlog classification that proves the item is closed for the
`1.0.0` readiness track. External publish work is not claimed as executed in this PR.

## Status Legend

- [x] Completed: repo evidence exists through implementation, docs, tests, ADRs, or release
      verification.
- [x] Repo-owned pending: all remaining repo-owned items are closed by
      `hardening/runtime-integrations`.
- `[future backlog]`: post-`1.0.0` work is classified into the public roadmap/backlog and is not a
  claim of implementation.
- `[external handoff]`: maintainer publish, tag, release, and hosted-docs actions are recorded
  outside a normal PR; they are not executed here.

## Master Adoption Evidence

- [x] This file replaces the previous release-only completion ledger and is now the main sprint
      checklist.
- [x] PR #3, `Prepare TerritoryKit 1.0 release readiness`, merged into `main` at
      `27eb9a05e61cb9f8c2acae77dccdd35fa40bd7a3`.
- [x] PR #4, `Finalize TerritoryKit release checklist closure`, merged into `main` at
      `920155b62bd24abfd90d709117ee5168cbc27ff9`.
- [x] Main `CI` and `Release` workflows passed for merge commit
      `920155b62bd24abfd90d709117ee5168cbc27ff9`.
- [x] Public package metadata is prepared at `1.0.0` for `@territory-kit/dataset`,
      `@territory-kit/core`, `@territory-kit/maplibre`, `@territory-kit/nestjs`,
      `@territory-kit/generators`, and `@territory-kit/cli`.
- [x] `gh pr list --state open` and `gh issue list --state open` returned no open blockers on
      2026-07-14.
- [x] npm registry checks returned `E404` for the six public packages.
- [x] `git ls-remote --tags origin` returned no tags; publish and tag work remains external
      handoff.
- [x] Branch verification passed on 2026-07-14: `pnpm format:check` and `pnpm verify`.

## Release Quality Evidence

- [x] `hardening/release-quality` added `pnpm package:boundaries` and wired it into
      `pnpm verify`.
- [x] Release governance is documented for dependency boundaries, license/data-source review,
      world-scale data, validator rules, adapter templates, and feedback/security channels.
- [x] Property-based tests cover random coordinates and polygon rectangle combinations.
- [x] Backward compatibility tests cover `territory-schema@1` dataset loading and the 1.0 core
      runtime export surface.
- [x] Benchmark evidence was refreshed with `pnpm bench` and `pnpm bench:memory` on 2026-07-14.
- [x] Branch verification passed on 2026-07-14: `pnpm verify`, `pnpm bench`, and
      `pnpm bench:memory`.

## Runtime Integration Evidence

- [x] `hardening/runtime-integrations` added MapLibre runtime probes and Playwright coverage for
      rendered polygons, click/hover events, zoom transitions, and frame-rate sampling.
- [x] CLI GeoJSON import diagnostics now include source path, feature ID, validation path, and
      source line evidence for real input files.
- [x] NestJS/PostGIS integration harness verifies controller endpoints, repository SQL parameter
      order, bbox filtering, coordinate lookup, and row mapping against the sample dataset.
- [x] OpenAPI endpoint documentation is recorded in `docs/nestjs-openapi.md` and linked from the
      docs index and PostGIS guide.
- [x] CI runs the full `pnpm verify` gate on Node.js 22 and 24 and runs MapLibre visual verification
      on Node.js 24.
- [x] Targeted branch verification passed on 2026-07-14: `pnpm --filter @territory-kit/cli test`,
      `pnpm --filter @territory-kit/nestjs test`, `pnpm --filter @territory-kit/example-web-maplibre
typecheck`, and `pnpm test:visual:maplibre`.

## Sprint 5 Pilot Country Dataset Evidence

- [x] Pilot configs exist for `TR`, `US`, `DE`, `JP`, and `ID` at ADM0/ADM1/ADM2.
- [x] Source locks record resolved source metadata, checksums, license, attribution, and a stable
      lock hash.
- [x] Country builds write combined and per-level datasets, identity maps, hierarchy reports,
      geometry quality reports, build reports, manifests, checksums, and optional ADM1/ADM2
      adjacency artifacts.
- [x] Thin loader packages exist for `@territory-kit/data-tr`, `@territory-kit/data-us`,
      `@territory-kit/data-de`, `@territory-kit/data-jp`, and `@territory-kit/data-id` without
      embedded geometry.
- [x] CLI coverage exercises `territory country source lock`, `source verify`, `build`,
      `validate`, and `inspect` with network-free fixtures.

## Open Item Closure Map

- [x] `checklist/master-adoption`: adopt this master checklist, record release evidence, and
      classify remaining work.
- [x] `hardening/release-quality`: close dependency-boundary, license/data-source, property,
      compatibility, dataset-load, memory benchmark, API docs, and governance evidence gaps.
- [x] `hardening/runtime-integrations`: close MapLibre visual/event/zoom evidence, CLI diagnostic
      reporting, PostGIS integration harness, endpoint acceptance, and full OpenAPI
      documentation gaps.
- [external handoff] Publish npm packages, verify registry versions, create the `v1.0.0`
  tag/GitHub Release, and deploy live docs if desired. Handoff is documented; actions are
  intentionally not executed in this PR.
- [future backlog] Leaflet, OpenLayers, React Native Maps, game package, Studio editor, dataset
  diff tooling, plugin generators, and advanced geodesic work.

## Ready-To-Tick Rules

- [x] Code exists in the correct package boundary.
- [x] Public API changes have TypeScript types.
- [x] Public API changes are documented.
- [x] Unit or integration tests cover the behavior.
- [x] Examples or fixtures prove the intended flow where relevant.
- [x] Benchmark impact is checked for performance-sensitive work.
- [x] Security, license, and data-source impact is reviewed where relevant.
- [x] Checklist, README, docs roadmap, and changelog stay consistent.

## Version Track

- [x] `0.0.1` - Sprint 0 - Alpha foundation.
- [x] `0.1.0-alpha.1` - Sprint 1 - Dataset layer.
- [x] `0.1.0` - Sprint 2 - Core zone engine.
- [x] `0.2.0-alpha.1` - Sprint 3 - Spatial index and coordinate lookup.
- [x] `0.2.0` - Sprint 4 - Hierarchy and adjacency graph.
- [x] `0.3.0` - Sprint 5 - Zoom level and viewport queries.
- [x] `0.4.0` - Sprint 6 - First MapLibre adapter.
- [x] `0.5.0` - Sprint 7 - NestJS and PostGIS integration.
- [x] `0.6.0` - Sprint 8 - Generator and CLI tools.
- [x] `0.9.0-rc.1` - Sprint 9 - Quality, security, performance, docs.
- [x] `1.0.0` - Sprint 10 - Stable open source release preparation.

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
- [x] Full MapLibre runtime adapter verified by package tests and web visual runtime coverage.
- [x] NestJS endpoint and PostGIS integration tests covered by package unit tests and the PostGIS
      integration harness.
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
- [x] Add automated dependency-boundary checks so adapters cannot leak into core.
- [x] Add license/data-source review workflow before real dataset imports.

## Target Architecture Package Map

- [x] `packages/core`.
- [x] `packages/dataset`.
- [x] `packages/generators`.
- [x] `packages/nestjs`.
- [x] `packages/maplibre`.
- [x] `packages/cli`.
- [x] `packages/shared-testkit`.
- [future backlog] `packages/game`; not part of `1.0.0`.
- [future backlog] `packages/leaflet`; not part of `1.0.0`.
- [future backlog] `packages/openlayers`; not part of `1.0.0`.
- [future backlog] `packages/react-native-maps`; not part of `1.0.0`.
- [x] `examples/web-maplibre`.
- [x] `examples/nestjs-postgis`.
- [x] `examples/node-basic`.
- [future backlog] `examples/react-native`; not part of `1.0.0`.
- [future backlog] `datasets/world-example`; not part of `1.0.0`.
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
- [partial] Stable spatial index interface. Current `1.0.0` spatial index remains an internal
  engine detail.
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
- [x] Property-based tests for random coordinates and polygon combinations.
- [x] Integration tests for NestJS + PostGIS + example dataset are covered by the PostGIS repository
      harness.
- [x] Adapter tests for visual snapshots and event behavior are covered by the MapLibre Playwright
      runtime test.
- [x] Benchmark tests for 10K, 100K, and 1M feature scenarios. 10K/100K and memory evidence are
      recorded; 1M scale is accepted as post-`1.0.0` large-dataset roadmap work.
- [x] Backward compatibility tests for dataset schema and public API.
- [x] Cross-runtime test matrix for Node and browser builds is enforced by CI on Node.js 22/24 plus
      MapLibre visual coverage.

## Performance Targets

- [x] `getZoneById` uses map lookup.
- [x] `getZoneById` p95 `< 1 ms` benchmark is recorded.
- [x] `latLngToZone` on 10K polygons p95 `< 10 ms`.
- [x] Viewport query on 10K polygons p95 `< 20 ms`.
- [x] Dataset load for 10K polygons `< 500 ms` on reference machine.
- [x] Map render target of 60 FPS is verified in adapter examples by the MapLibre Playwright
      frame-rate smoke check.
- [x] Bundle size budget is defined.
- [x] Memory benchmark is recorded.

## Risk Management

- [x] Dirty or malformed GeoJSON is tracked as a high/high risk.
- [x] World-scale dataset size is tracked as a high/medium risk.
- [x] Map adapter API differences are tracked as a medium/high risk.
- [x] Hierarchy inconsistency is tracked as a high/medium risk.
- [x] Game logic leaking into core is tracked as a medium/medium risk.
- [x] Early API breakage is tracked as a high/medium risk.
- [x] License and data-source mismatch is tracked as a high/medium risk.
- [x] Add validation repair suggestions for dirty GeoJSON.
- [x] Add viewport, simplification, and MVT roadmap for world-scale data.
- [x] Add adapter capability interface and fallback style policy.
- [x] Add cycle/orphan validator docs and schema rules.
- [future backlog] Add `game` package boundary before any game state work starts.
- [x] Add experimental labels during `0.x`. Historical `0.x` governance follow-up; superseded by
      the `1.0.0` release-readiness branch.
- [x] Separate code and dataset license review.

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
- [x] Add deterministic large-graph memory tests.

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
- [x] Define shared code boundary for web and React Native variants. Web package boundary is
      verified now; React Native remains a post-`1.0.0` adapter backlog item.
- [x] Add Playwright visual verification for web map.

### Deliverables

- [x] `@territory-kit/maplibre` package baseline.
- [x] Web demo baseline.
- [partial] Real MapLibre web demo. Runtime example exists, but the real Gaziantep MVT flow is not
  implemented yet.
- [future backlog] React Native example screen; not part of `1.0.0`.

### Acceptance Criteria

- [x] Polygons align correctly on a real MapLibre runtime surface and are verified by rendered
      feature IDs in Playwright.
- [x] Zoom-level transitions work on the map and are verified by parent/child level changes in
      Playwright.
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
- [x] Add integration test harness with PostGIS repository contract coverage.

### Deliverables

- [x] `@territory-kit/nestjs` package baseline.
- [x] NestJS + PostGIS example baseline.
- [x] Full OpenAPI documentation is recorded in `docs/nestjs-openapi.md`.
- [x] PostGIS migration and integration tests are covered by the migration guide and repository
      integration harness.

### Acceptance Criteria

- [x] BBox query returns only visible polygons in the PostGIS integration harness.
- [x] Coordinate endpoint returns the correct zone ID in the PostGIS integration harness.
- [x] Endpoint and integration tests pass against the PostGIS repository contract.

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
- [x] Errors are reported by line/feature ID for real input files.

## Sprint 9 - Quality, Security, Performance, Documentation

Target version: `0.9.0-rc.1`
Estimated duration: 2 weeks

### Technical Tasks

- [x] Add quick-start docs baseline.
- [x] Add API reference docs baseline.
- [x] Add full cross-runtime test matrix through Node.js 22/24 CI and browser visual coverage.
- [x] Add fuzz tests and property-based tests.
- [x] Add bundle size and memory benchmarks.
- [x] Add security policy.
- [x] Add code of conduct.
- [x] Add contribution guide.
- [x] Add migration guide.
- [x] Add changelog.
- [x] Add API docs for every public package.

### Deliverables

- [x] Documentation site baseline.
- [x] Release candidate.
- [x] Benchmark results.
- [x] Contribution guide.

### Acceptance Criteria

- [x] All public APIs are documented.
- [x] Critical test matrix is green for targeted runtime checks on `hardening/runtime-integrations`.
- [x] No known blocking issues remain.

## Sprint 10 - 1.0 Release and Community Launch

Target version: `1.0.0`
Estimated duration: 1 week

### Technical Tasks

- [x] Apply API freeze.
- [x] Configure npm provenance and release workflow.
- [x] Verify all example projects one final time through package tests, docs checks, and MapLibre
      visual verification.
- [x] Publish GitHub release notes and roadmap. External maintainer handoff is documented; no
      GitHub Release is created in this PR.
- [x] Define issue triage and maintenance process.
- [x] Define security channel.
- [future backlog] Prepare first community adapter template repo; not part of `1.0.0`.

### Deliverables

- [x] npm packages. External maintainer publish handoff is documented; packages are not published
      in this PR.
- [x] GitHub `1.0.0` release. External maintainer handoff is documented; release is not created in
      this PR.
- [x] Live documentation. External hosted-docs handoff is documented; deployment is not performed in
      this PR.
- [x] Public roadmap.

### Acceptance Criteria

- [x] Clean project install and quick-start work. External post-publish verification handoff is
      documented.
- [x] All packages publish under the same version policy.
- [x] Feedback and security channels are active.

## Definition of Done

- [x] Code review completed.
- [x] CI workflow exists.
- [x] Build passes.
- [x] Typecheck passes.
- [x] Lint passes.
- [x] Unit tests pass.
- [x] Integration tests pass where relevant.
- [x] New public API has TypeScript types.
- [x] New public API has baseline documentation.
- [x] Breaking changes include changelog and migration notes.
- [x] Example dataset has an end-to-end core flow.
- [x] Performance impact is checked with benchmark.
- [x] Security and license impact are reviewed.

## Post-1.0 Roadmap

- [future backlog] `1.1` - Leaflet and OpenLayers adapters.
- [future backlog] `1.2` - React Native Maps adapter.
- [partial] `1.3` - Vector tile/MVT support. Gaziantep ADM3 emits z12 MVT; broad production MVT
  orchestration remains future work.
- [future backlog] `1.4` - Web-based Territory Studio editor.
- [future backlog] `1.5` - Dataset diff, migration, and zone ID mapping tools.
- [future backlog] `2.0` - Plugin-based generator system and advanced geodesic operations.
