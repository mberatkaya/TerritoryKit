# @territory-kit/cli

## 1.2.0

### Minor Changes

- 6a151c1: Add Sprint 13 catalog, binary spatial index, engine pool, worker loading, and CLI index artifact
  support.
- 03b4c95: Add the Sprint 6 dataset registry package with schema validation, registry-backed artifact
  installation, verified Node cache, core loader integration, and CLI registry/dataset/cache commands.
- c491ef4: Add hosted registry publishing and verification support with provider-neutral local, HTTP, and
  S3-compatible adapter boundaries, immutable version manifests, inventory/rollback metadata, and
  CLI publish/verify commands.
- e9181ec: Add the Sprint 5 pilot country dataset pipeline with source locks, deterministic country builds,
  hierarchy and identity reports, ADM1/ADM2 adjacency artifacts, resolver-driven country loader
  packages, CLI country commands, documentation, and smoke coverage.
- 998c806: Add exact polygon adjacency artifacts with shared-border, point-touch, maritime, and logical
  relations, including generator builds, CLI build/validate/inspect commands, artifact validation,
  manual overrides, and core typed neighbor queries.
- e6f9546: Add benchmark run/compare commands for fixture and local-real benchmark smoke workflows.
- 8f7995e: Add Sprint 7 query/render artifact separation with MVT render artifact generation, query dataset
  loading, registry render descriptors, MapLibre registry-backed sources, CLI render commands, and
  compatibility coverage.
- d16ae5a: Add province-scoped Turkey ADM3 ingestion with source catalog adapters, source-lock extension
  metadata, partial coverage reports, ADM3 quality gates, provenance reports, and CLI flags for
  `--adm3-provinces`, `--adm3-catalog`, and `--allow-partial` builds.

### Patch Changes

- e9ce6f8: Optimize large Turkey ADM0-ADM2 production builds by bounding adjacency and MVT candidates, speeding
  large geometry validation/serialization paths, and adding country build performance reports with a
  phase timeout flag.
- d2edde2: Add Turkey national ADM0-ADM2 source catalog support, topology-aware simplification artifacts,
  country query/render/binary build flags, and updated resolver metadata for the Turkey loader.
- Updated dependencies [6a151c1]
- Updated dependencies [03b4c95]
- Updated dependencies [c491ef4]
- Updated dependencies [e9181ec]
- Updated dependencies [998c806]
- Updated dependencies [8f7995e]
- Updated dependencies [f905c34]
- Updated dependencies [d16ae5a]
- Updated dependencies [bd112bf]
- Updated dependencies [e9ce6f8]
- Updated dependencies [d2edde2]
  - @territory-kit/core@1.2.0
  - @territory-kit/registry@1.2.0
  - @territory-kit/generators@1.2.0
  - @territory-kit/dataset@1.2.0

## 1.2.0 - Unreleased

### Minor Changes

- Add `territory index build`, `territory index inspect`, and `territory index validate` for
  versioned binary spatial index artifacts.

## 1.1.0

### Minor Changes

- 0e48877: Add the geometry quality pipeline with validate-only reports, safe audited repair, source pipeline
  integration, and `territory geometry validate|repair` CLI commands.
- 43a3fee: Add a shared source adapter pipeline with Natural Earth, geoBoundaries, and generic GeoJSON import commands.
- 97c3860: Add a Natural Earth ADM0 world-countries artifact builder, CLI command, and deterministic checksums.

### Patch Changes

- Updated dependencies [0e48877]
- Updated dependencies [dabf1f1]
- Updated dependencies [43a3fee]
- Updated dependencies [97c3860]
  - @territory-kit/dataset@1.1.0
  - @territory-kit/generators@1.1.0
  - @territory-kit/core@1.1.0

## 1.0.0

### Major Changes

- Prepare TerritoryKit 1.0.0 stable release with the current public API surface frozen.

### Patch Changes

- Updated dependencies
  - @territory-kit/core@1.0.0
  - @territory-kit/dataset@1.0.0
  - @territory-kit/generators@1.0.0
