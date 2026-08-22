# @territory-kit/generators

## 2.0.0

### Major Changes

- 5ccdbf6: Prepare TerritoryKit V2 for the stable `2.0.0` release handoff.

  This release promotes the Turkey V2 national playable dataset contract to
  `territory-kit-tr-v2-playable@2.0.0`, with the complete 1 ADM0 / 81 ADM1 / 973 ADM2 Turkey
  hierarchy and nationwide playable ADM3 coverage. The ADM3 source policy remains
  official > OSM > generated; generated fallback zones are deterministic, playable, explicitly
  generated, and non-official.

  The release hardens the national build, registry, source-lock, checksum, topology, geometry,
  provenance, attribution, and strict validation gates that protect the resolver-driven external
  artifact model. Large national geometry remains outside npm packages.

  Migration note: `territory-schema@1` is unchanged and legacy `territory-kit-tr` resolution remains
  separate. Consumers opting into `territory-kit-tr-v2-playable` should preserve the generated-zone
  semantics and must not treat generated fallback as official Turkish mahalle/koy administrative
  data.

### Patch Changes

- Updated dependencies [5ccdbf6]
  - @territory-kit/core@2.0.0
  - @territory-kit/dataset@2.0.0

## 1.9.3

### Patch Changes

- 66f1c77: Harden Turkey V2 national publish-ready geometry validation, representative centers, level artifacts,
  and topology-safe simplification fallback for the full national verification rebuild.
- Updated dependencies [66f1c77]
  - @territory-kit/dataset@1.9.3
  - @territory-kit/core@1.9.3

## 1.9.2

### Patch Changes

- 3f26da7: Harden topology-safe simplification reporting with report v2. The topology audit now verifies
  actual shared-boundary relationships across simplified output geometries instead of treating shared
  segment reduction as mismatches, includes geometry validation summaries and structured issues, and
  marks the overall report failed when any requested tier fails. The CLI now returns exit code 1 for
  completed simplification runs whose topology or geometry quality audit fails while preserving the
  diagnostic report.
  - @territory-kit/core@1.9.2
  - @territory-kit/dataset@1.9.2

## 1.9.1

### Patch Changes

- 5b62b10: Fix topology-safe geometry simplification so shared polygon boundaries are simplified once as
  canonical arcs and reused by adjacent polygons instead of being independently simplified per ring.
  - @territory-kit/core@1.9.1
  - @territory-kit/dataset@1.9.1

## 1.9.0

### Minor Changes

- 8173c2b: Harden Turkey V2 national publish-ready validation and artifact integrity checks.

  Adds strict 1/81/973 national completeness metadata, separates diagnostic `quality.ok` from
  `quality.publishReady`, removes placeholder registry artifact checksums, validates registry artifacts
  against real SHA-256 and byte sizes, and upgrades `territory tr v2 national validate` with
  machine-readable strict publish-ready failures.

### Patch Changes

- @territory-kit/core@1.9.0
- @territory-kit/dataset@1.9.0

## 1.8.0

### Minor Changes

- 1a93d2f: Add the Turkey V2 national playable dataset build pipeline, CLI commands, resolver metadata, rich
  checksum loader support, reports, docs, and validation coverage.

### Patch Changes

- Updated dependencies [1a93d2f]
  - @territory-kit/core@1.8.0
  - @territory-kit/dataset@1.8.0

## 1.7.0

### Minor Changes

- f1aa280: Add the Turkey V2 hybrid coverage pipeline with deterministic official > OSM > generated source
  priority. Real polygon provenance and stable identity are preserved, OSM keeps ODbL attribution, and
  the Sprint 2 game-zone generator fills only uncovered district geometry. The CLI can now write
  district and batch hybrid artifacts with coverage, quality, provenance, attribution, rejection,
  migration, adjacency, configuration, source-lock summary, and checksums.

### Patch Changes

- @territory-kit/core@1.7.0
- @territory-kit/dataset@1.7.0

## 1.6.0

### Minor Changes

- 6414bd1: Add the Turkey V2 KapRota-compatible generated game-zone workflow with
  `tr-adm3-game-zone-v2`, urban/suburban/rural/auto/custom profiles, deterministic stable generation,
  coverage and quality reports, adjacency integration, benchmark/smoke reporting, and a
  `territory tr adm3 generate` CLI path. The legacy V1 generated-zone API remains available.

### Patch Changes

- @territory-kit/core@1.6.0
- @territory-kit/dataset@1.6.0

## 1.5.0

### Minor Changes

- e605ffc: Establish the Turkey V2 ADM3 data contract with source-class metadata, strict TR V2 validation,
  stable official/OSM/generated identity helpers, CLI profile support, and Turkey loader/registry
  metadata for generated-zone compatibility.

### Patch Changes

- Updated dependencies [e605ffc]
  - @territory-kit/dataset@1.5.0
  - @territory-kit/core@1.5.0

## 1.4.0

### Minor Changes

- d54d314: Add Turkey ADM3 production evidence tooling: official ADM3 catalog ingestion, OSM PBF extraction support, priority-clipped effective geometry, spatial QA reports, national/province artifacts, and production smoke commands.

### Patch Changes

- @territory-kit/core@1.4.0
- @territory-kit/dataset@1.4.0

## 1.3.0

### Minor Changes

- 8dd6dd3: Replaces Turkey ADM3 fallback-policy coverage with geometry-built coverage reporting for generated fill, adds arbitrary Polygon/MultiPolygon generated-zone clipping, priority-aware geodesic coverage measurement, real `territory tr adm3 build` artifacts, district-specific provider resolution, and bounded network provider health checks.

### Patch Changes

- @territory-kit/core@1.3.0
- @territory-kit/dataset@1.3.0

## 1.2.0

### Minor Changes

- e9181ec: Add the Sprint 5 pilot country dataset pipeline with source locks, deterministic country builds,
  hierarchy and identity reports, ADM1/ADM2 adjacency artifacts, resolver-driven country loader
  packages, CLI country commands, documentation, and smoke coverage.
- 998c806: Add exact polygon adjacency artifacts with shared-border, point-touch, maritime, and logical
  relations, including generator builds, CLI build/validate/inspect commands, artifact validation,
  manual overrides, and core typed neighbor queries.
- 8f7995e: Add Sprint 7 query/render artifact separation with MVT render artifact generation, query dataset
  loading, registry render descriptors, MapLibre registry-backed sources, CLI render commands, and
  compatibility coverage.
- d16ae5a: Add province-scoped Turkey ADM3 ingestion with source catalog adapters, source-lock extension
  metadata, partial coverage reports, ADM3 quality gates, provenance reports, and CLI flags for
  `--adm3-provinces`, `--adm3-catalog`, and `--allow-partial` builds.
- bd112bf: Add the official partial Turkey ADM3 Gaziantep neighbourhood pilot, with locked source metadata,
  GEOS/Shapely repair reporting, query/render artifacts, partial registry coverage, parent-scoped
  fallback resolution, and Turkey loader coverage helpers.

### Patch Changes

- e9ce6f8: Optimize large Turkey ADM0-ADM2 production builds by bounding adjacency and MVT candidates, speeding
  large geometry validation/serialization paths, and adding country build performance reports with a
  phase timeout flag.
- d2edde2: Add Turkey national ADM0-ADM2 source catalog support, topology-aware simplification artifacts,
  country query/render/binary build flags, and updated resolver metadata for the Turkey loader.
- Updated dependencies [6a151c1]
- Updated dependencies [03b4c95]
- Updated dependencies [e9181ec]
- Updated dependencies [998c806]
- Updated dependencies [8f7995e]
- Updated dependencies [f905c34]
- Updated dependencies [bd112bf]
- Updated dependencies [e9ce6f8]
  - @territory-kit/core@1.2.0
  - @territory-kit/dataset@1.2.0

## 1.1.0

### Minor Changes

- 0e48877: Add the geometry quality pipeline with validate-only reports, safe audited repair, source pipeline
  integration, and `territory geometry validate|repair` CLI commands.
- 43a3fee: Add a shared source adapter pipeline with Natural Earth, geoBoundaries, and generic GeoJSON import commands.
- 97c3860: Add a Natural Earth ADM0 world-countries artifact builder, CLI command, and deterministic checksums.

### Patch Changes

- Updated dependencies [0e48877]
- Updated dependencies [dabf1f1]
  - @territory-kit/dataset@1.1.0
  - @territory-kit/core@1.1.0

## 1.0.0

### Major Changes

- Prepare TerritoryKit 1.0.0 stable release with the current public API surface frozen.

### Patch Changes

- Updated dependencies
  - @territory-kit/core@1.0.0
  - @territory-kit/dataset@1.0.0
