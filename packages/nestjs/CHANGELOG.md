# @territory-kit/nestjs

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

- Updated dependencies [66f1c77]
  - @territory-kit/dataset@1.9.3
  - @territory-kit/core@1.9.3

## 1.9.2

### Patch Changes

- @territory-kit/core@1.9.2
- @territory-kit/dataset@1.9.2

## 1.9.1

### Patch Changes

- @territory-kit/core@1.9.1
- @territory-kit/dataset@1.9.1

## 1.9.0

### Patch Changes

- @territory-kit/core@1.9.0
- @territory-kit/dataset@1.9.0

## 1.8.0

### Patch Changes

- Updated dependencies [1a93d2f]
  - @territory-kit/core@1.8.0
  - @territory-kit/dataset@1.8.0

## 1.7.0

### Patch Changes

- @territory-kit/core@1.7.0
- @territory-kit/dataset@1.7.0

## 1.6.0

### Patch Changes

- @territory-kit/core@1.6.0
- @territory-kit/dataset@1.6.0

## 1.5.0

### Patch Changes

- Updated dependencies [e605ffc]
  - @territory-kit/dataset@1.5.0
  - @territory-kit/core@1.5.0

## 1.4.0

### Patch Changes

- @territory-kit/core@1.4.0
- @territory-kit/dataset@1.4.0

## 1.3.0

### Patch Changes

- @territory-kit/core@1.3.0
- @territory-kit/dataset@1.3.0

## 1.2.0

### Patch Changes

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
