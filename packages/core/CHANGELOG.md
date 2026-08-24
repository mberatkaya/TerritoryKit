# @territory-kit/core

## 2.1.0

### Minor Changes

- c2fd881: Add production spatial provider contracts with stable territory identity,
  dataset/geometry versioning, point and bounds territory queries, and public geometry helpers.

- 5cfc615: Add exact and sampled route-to-territory workflows with traversal metadata, route length
  reporting, repeat-entry handling, and exact polygon intersection utilities.

- 5fce56b: Add H3 removal readiness identity regressions and geometry-version safety coverage.

### Patch Changes

- @territory-kit/dataset@2.1.0
- @territory-kit/registry@2.1.0

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
  - @territory-kit/dataset@2.0.0
  - @territory-kit/registry@2.0.0

## 1.9.3

### Patch Changes

- Updated dependencies [66f1c77]
  - @territory-kit/dataset@1.9.3
  - @territory-kit/registry@1.9.3

## 1.9.2

### Patch Changes

- @territory-kit/dataset@1.9.2
- @territory-kit/registry@1.9.2

## 1.9.1

### Patch Changes

- @territory-kit/dataset@1.9.1
- @territory-kit/registry@1.9.1

## 1.9.0

### Patch Changes

- @territory-kit/dataset@1.9.0
- @territory-kit/registry@1.9.0

## 1.8.0

### Minor Changes

- 1a93d2f: Add the Turkey V2 national playable dataset build pipeline, CLI commands, resolver metadata, rich
  checksum loader support, reports, docs, and validation coverage.

### Patch Changes

- @territory-kit/dataset@1.8.0
- @territory-kit/registry@1.8.0

## 1.7.0

### Patch Changes

- @territory-kit/dataset@1.7.0
- @territory-kit/registry@1.7.0

## 1.6.0

### Patch Changes

- @territory-kit/dataset@1.6.0
- @territory-kit/registry@1.6.0

## 1.5.0

### Patch Changes

- Updated dependencies [e605ffc]
  - @territory-kit/dataset@1.5.0
  - @territory-kit/registry@1.5.0

## 1.4.0

### Patch Changes

- @territory-kit/dataset@1.4.0
- @territory-kit/registry@1.4.0

## 1.3.0

### Patch Changes

- @territory-kit/dataset@1.3.0
- @territory-kit/registry@1.3.0

## 1.2.0

### Minor Changes

- 6a151c1: Add Sprint 13 catalog, binary spatial index, engine pool, worker loading, and CLI index artifact
  support.
- 03b4c95: Add the Sprint 6 dataset registry package with schema validation, registry-backed artifact
  installation, verified Node cache, core loader integration, and CLI registry/dataset/cache commands.
- e9181ec: Add the Sprint 5 pilot country dataset pipeline with source locks, deterministic country builds,
  hierarchy and identity reports, ADM1/ADM2 adjacency artifacts, resolver-driven country loader
  packages, CLI country commands, documentation, and smoke coverage.
- 998c806: Add exact polygon adjacency artifacts with shared-border, point-touch, maritime, and logical
  relations, including generator builds, CLI build/validate/inspect commands, artifact validation,
  manual overrides, and core typed neighbor queries.
- 8f7995e: Add Sprint 7 query/render artifact separation with MVT render artifact generation, query dataset
  loading, registry render descriptors, MapLibre registry-backed sources, CLI render commands, and
  compatibility coverage.
- f905c34: Add Sprint 11 runtime and adapter architecture foundations with shared coded errors,
  renderer-independent adapter contracts, minimal runtime lifecycle events, deprecated core registry
  compatibility exports, MapLibre adapter conformance, package boundary enforcement, and architecture
  documentation.

### Patch Changes

- Updated dependencies [03b4c95]
- Updated dependencies [c491ef4]
- Updated dependencies [998c806]
- Updated dependencies [8f7995e]
- Updated dependencies [f905c34]
- Updated dependencies [bd112bf]
- Updated dependencies [e9ce6f8]
  - @territory-kit/registry@1.2.0
  - @territory-kit/dataset@1.2.0

## 1.2.0 - Unreleased

### Minor Changes

- Add versioned binary spatial index encode/decode/inspect/validate APIs and allow
  `createTerritoryEngine({ spatialIndex })` to use prebuilt bbox records.

## 1.1.0

### Patch Changes

- Updated dependencies [0e48877]
- Updated dependencies [dabf1f1]
  - @territory-kit/dataset@1.1.0

## 1.0.0

### Major Changes

- Prepare TerritoryKit 1.0.0 stable release with the current public API surface frozen.

### Patch Changes

- Updated dependencies
  - @territory-kit/dataset@1.0.0
