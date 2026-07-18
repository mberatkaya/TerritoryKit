# ADR-004: Runtime Viewport Lifecycle

## Status

Accepted for Sprint 12.

## Context

Sprint 11 created the runtime and adapter boundaries. The runtime now needs to coordinate actual
viewport requests while preserving package boundaries:

- runtime may import adapter-core, core, dataset, and registry
- runtime must not import MapLibre or Node-only registry helpers
- core must remain an in-memory engine, not a request or renderer coordinator

## Decision

Implement viewport request orchestration inside `@territory-kit/runtime`.

The runtime owns:

- viewport validation
- request ids, revisions, and event sequencing
- debounce and scheduler injection
- request cancellation, stale-response rejection, and timeout errors
- direct dataset, resolver, and registry install coordination
- lazy engine creation and reuse
- async runtime cache reads/writes
- renderer-neutral adapter source updates

The runtime does not own:

- renderer-specific behavior
- Node filesystem cache
- network transports
- multi-dataset catalog planning
- binary spatial index encoding
- worker transport implementation

## Consequences

- Consumers can drive viewport updates through one runtime object instead of hand-wiring engines,
  caches, cancellation, and adapters.
- Runtime requests are deterministic enough for fake-clock and fake-scheduler tests.
- Sprint 13 can add catalogs, engine pools, binary indexes, and worker loading behind the existing
  resolver, engine factory, cache, and cancellation contracts.

## Alternatives Considered

- Put viewport orchestration in `@territory-kit/core`. Rejected because core must remain renderer,
  request, filesystem, and network independent.
- Put orchestration in MapLibre. Rejected because the lifecycle must serve future adapters.
- Add IndexedDB or filesystem cache now. Rejected to keep Sprint 12 browser-safe and deterministic.
