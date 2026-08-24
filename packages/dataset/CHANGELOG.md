# @territory-kit/dataset

## 2.1.0

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

## 1.9.3

### Patch Changes

- 66f1c77: Harden Turkey V2 national publish-ready geometry validation, representative centers, level artifacts,
  and topology-safe simplification fallback for the full national verification rebuild.

## 1.9.2

## 1.9.1

## 1.9.0

## 1.8.0

## 1.7.0

## 1.6.0

## 1.5.0

### Minor Changes

- e605ffc: Establish the Turkey V2 ADM3 data contract with source-class metadata, strict TR V2 validation,
  stable official/OSM/generated identity helpers, CLI profile support, and Turkey loader/registry
  metadata for generated-zone compatibility.

## 1.4.0

## 1.3.0

## 1.2.0

### Minor Changes

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
- bd112bf: Add the official partial Turkey ADM3 Gaziantep neighbourhood pilot, with locked source metadata,
  GEOS/Shapely repair reporting, query/render artifacts, partial registry coverage, parent-scoped
  fallback resolution, and Turkey loader coverage helpers.

### Patch Changes

- e9ce6f8: Optimize large Turkey ADM0-ADM2 production builds by bounding adjacency and MVT candidates, speeding
  large geometry validation/serialization paths, and adding country build performance reports with a
  phase timeout flag.

## 1.1.0

### Minor Changes

- 0e48877: Add the geometry quality pipeline with validate-only reports, safe audited repair, source pipeline
  integration, and `territory geometry validate|repair` CLI commands.
- dabf1f1: Add global dataset metadata types, deterministic global ID helpers, and opt-in manifest validation.

## 1.0.0

### Major Changes

- Prepare TerritoryKit 1.0.0 stable release with the current public API surface frozen.
