# @territory-kit/data-tr

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

## 1.9.3

### Patch Changes

- @territory-kit/core@1.9.3

## 1.9.2

### Patch Changes

- @territory-kit/core@1.9.2

## 1.9.1

### Patch Changes

- @territory-kit/core@1.9.1

## 1.9.0

### Patch Changes

- @territory-kit/core@1.9.0

## 1.8.0

### Minor Changes

- 1a93d2f: Add the Turkey V2 national playable dataset build pipeline, CLI commands, resolver metadata, rich
  checksum loader support, reports, docs, and validation coverage.

### Patch Changes

- Updated dependencies [1a93d2f]
  - @territory-kit/core@1.8.0

## 1.7.0

### Patch Changes

- @territory-kit/core@1.7.0

## 1.6.0

### Patch Changes

- @territory-kit/core@1.6.0

## 1.5.0

### Minor Changes

- e605ffc: Establish the Turkey V2 ADM3 data contract with source-class metadata, strict TR V2 validation,
  stable official/OSM/generated identity helpers, CLI profile support, and Turkey loader/registry
  metadata for generated-zone compatibility.

### Patch Changes

- @territory-kit/core@1.5.0

## 1.4.0

### Patch Changes

- @territory-kit/core@1.4.0

## 1.3.0

### Patch Changes

- @territory-kit/core@1.3.0

## 1.2.0

### Minor Changes

- e9181ec: Add the Sprint 5 pilot country dataset pipeline with source locks, deterministic country builds,
  hierarchy and identity reports, ADM1/ADM2 adjacency artifacts, resolver-driven country loader
  packages, CLI country commands, documentation, and smoke coverage.
- bd112bf: Add the official partial Turkey ADM3 Gaziantep neighbourhood pilot, with locked source metadata,
  GEOS/Shapely repair reporting, query/render artifacts, partial registry coverage, parent-scoped
  fallback resolution, and Turkey loader coverage helpers.

### Patch Changes

- c491ef4: Add hosted registry publishing and verification support with provider-neutral local, HTTP, and
  S3-compatible adapter boundaries, immutable version manifests, inventory/rollback metadata, and
  CLI publish/verify commands.
- d2edde2: Add Turkey national ADM0-ADM2 source catalog support, topology-aware simplification artifacts,
  country query/render/binary build flags, and updated resolver metadata for the Turkey loader.
- Updated dependencies [6a151c1]
- Updated dependencies [03b4c95]
- Updated dependencies [e9181ec]
- Updated dependencies [998c806]
- Updated dependencies [8f7995e]
- Updated dependencies [f905c34]
  - @territory-kit/core@1.2.0
