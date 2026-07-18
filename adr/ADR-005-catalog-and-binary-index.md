# ADR-005: Catalog and Binary Spatial Index

## Status

Accepted for Sprint 13.

## Context

Phase 1 turned runtime into a viewport orchestration engine, but it still resolved one dataset per
request and built spatial indexes from JSON geometry at runtime. Sprint 13 needs country-split
viewport resolution, reusable engines, prebuilt binary spatial indexes, and worker-backed loading
without leaking renderer, filesystem, or network code into browser-safe packages.

## Decision

- `@territory-kit/runtime` owns catalog resolution, engine pooling, deterministic result merging,
  and worker transport contracts.
- `@territory-kit/core` owns binary spatial index encode/decode/validate APIs and accepts a
  prebuilt index through `createTerritoryEngine({ spatialIndex })`.
- `@territory-kit/cli` exposes `territory index build|inspect|validate` for `.tksi` artifacts.
- Flatbush remains the default core fallback when no binary index is provided.
- Runtime rejects stale catalog plans by comparing the request-captured catalog revision with the
  current catalog revision before commit.
- Worker loading is injectable. Runtime sends message-schema objects and transferables through a
  transport interface instead of importing a concrete Worker implementation.

## Consequences

- Catalog entries can represent exact coverage, fallback coverage, partial coverage, priority, and
  artifact purpose without requiring registry or renderer coupling.
- A viewport can select multiple country datasets and query/merge them deterministically.
- Binary index artifacts are portable across browser and Node consumers because the format uses
  `ArrayBuffer`, `DataView`, `TextEncoder`, and `TextDecoder`.
- The v1 binary format is level-partitioned bbox records, not a persisted Flatbush tree. Future
  schema versions can add tree pages without changing the rejection behavior for unsupported
  versions.
- Worker tests use deterministic fake transports; applications can bind the same contract to real
  browser Workers.
