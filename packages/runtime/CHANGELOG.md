# @territory-kit/runtime

## 1.8.0

### Patch Changes

- Updated dependencies [1a93d2f]
  - @territory-kit/core@1.8.0
  - @territory-kit/adapter-core@1.8.0
  - @territory-kit/dataset@1.8.0
  - @territory-kit/registry@1.8.0

## 1.7.0

### Patch Changes

- @territory-kit/adapter-core@1.7.0
- @territory-kit/core@1.7.0
- @territory-kit/dataset@1.7.0
- @territory-kit/registry@1.7.0

## 1.6.0

### Patch Changes

- @territory-kit/adapter-core@1.6.0
- @territory-kit/core@1.6.0
- @territory-kit/dataset@1.6.0
- @territory-kit/registry@1.6.0

## 1.5.0

### Patch Changes

- Updated dependencies [e605ffc]
  - @territory-kit/dataset@1.5.0
  - @territory-kit/registry@1.5.0
  - @territory-kit/adapter-core@1.5.0
  - @territory-kit/core@1.5.0

## 1.4.0

### Patch Changes

- @territory-kit/adapter-core@1.4.0
- @territory-kit/core@1.4.0
- @territory-kit/dataset@1.4.0
- @territory-kit/registry@1.4.0

## 1.3.0

### Patch Changes

- @territory-kit/adapter-core@1.3.0
- @territory-kit/core@1.3.0
- @territory-kit/dataset@1.3.0
- @territory-kit/registry@1.3.0

## 1.2.0

### Minor Changes

- 6a151c1: Add Sprint 13 catalog, binary spatial index, engine pool, worker loading, and CLI index artifact
  support.
- f905c34: Add Sprint 11 runtime and adapter architecture foundations with shared coded errors,
  renderer-independent adapter contracts, minimal runtime lifecycle events, deprecated core registry
  compatibility exports, MapLibre adapter conformance, package boundary enforcement, and architecture
  documentation.
- 03974c1: Add the Sprint 12 runtime viewport lifecycle with request orchestration, scheduler and clock
  injection, cancellation, stale-response guards, timeout errors, async memory LRU cache, lazy engine
  reuse, resolver injection, committed-state restoration after cancellation, cache ownership policy,
  managed adapter source binding, async adapter operation context, and renderer-independent adapter
  updates.

### Patch Changes

- ecb8c81: Add Leaflet and OpenLayers renderer adapters, shared GeoJSON adapter serialization helpers, and a
  shared renderer adapter contract exercise for MapLibre, Leaflet, and OpenLayers tests.
- Updated dependencies [6a151c1]
- Updated dependencies [03b4c95]
- Updated dependencies [c491ef4]
- Updated dependencies [e9181ec]
- Updated dependencies [998c806]
- Updated dependencies [8f7995e]
- Updated dependencies [f905c34]
- Updated dependencies [bd112bf]
- Updated dependencies [e9ce6f8]
- Updated dependencies [ecb8c81]
  - @territory-kit/core@1.2.0
  - @territory-kit/registry@1.2.0
  - @territory-kit/dataset@1.2.0
  - @territory-kit/adapter-core@1.2.0

## 1.2.0 - Unreleased

### Minor Changes

- Add the minimal runtime lifecycle foundation with state inspection, deterministic event
  subscriptions, listener error isolation, and idempotent disposal.
- Add viewport request orchestration with debounce, cancellation, stale-response guards, timeout
  errors, lazy engine reuse, async memory LRU cache, and renderer-independent adapter updates.
- Preserve committed viewport state after cancellation, bind adapter source IDs through the
  renderer-neutral adapter contract, and keep injected cache disposal external by default.
- Add multi-dataset catalog resolution, engine pooling, binary-index-aware runtime queries, and
  injectable worker loading contracts.
