# Runtime Viewport Audit

Branch: `feat/runtime-viewport-lifecycle`

## Existing Runtime API

Sprint 11 introduced `@territory-kit/runtime` as an isolated lifecycle boundary with
`createTerritoryRuntime`, immutable state snapshots, event subscription, listener error isolation,
and deterministic disposal. It intentionally did not execute viewport requests.

Sprint 12 keeps those lifecycle APIs and adds active viewport orchestration:

- `setViewport(viewport, options?)`
- `refresh(options?)`
- `cancelActiveRequest(reason?)`
- `getState()`
- `subscribe(listener)`
- `dispose()`
- `createMemoryTerritoryRuntimeCache(options?)`

## State Model

The runtime state is an immutable snapshot containing `status`, `revision`, `eventSequence`,
`disposed`, active request identifiers, the active viewport and level, active dataset id,
last completed request id, last error, last result summary, and cache summary.

The active statuses are:

- `idle`
- `scheduled`
- `resolving`
- `loading`
- `querying`
- `updating-adapter`
- `ready`
- `error`
- `disposed`

## Cache Contract

`TerritoryRuntimeCache` is asynchronous and browser-safe:

- `get(key, context)`
- `set(key, bytes, context)`
- optional `delete`, `clear`, `getSummary`, and `dispose`

The in-memory implementation tracks entries, bytes, hits, misses, sets, deletes, and evictions. It
uses deterministic LRU eviction, supports `maxEntries` and `maxBytes`, and copies `Uint8Array`
values on read/write by default so callers cannot mutate cached values accidentally.

## Registry Integration

Runtime supports direct `dataset` and `engine` options first. Resolver-backed loading is available
through `datasetResolver.resolveDataset`, `datasetResolver.installDataset`, or
`registry.installDataset` with `datasetId`.

Registry resolution remains in `@territory-kit/registry`; runtime only coordinates it. Runtime does
not import Node filesystem helpers, transports, or package-specific country loaders.

## Adapter Integration

Runtime accepts an optional `TerritoryRendererAdapter` from `@territory-kit/adapter-core`.
Detached or missing adapters do not fail viewport requests. Attached adapters must support
`geoJson` and `sourceReplacement`; failures become coded `request-failed` events.

Runtime emits renderer-neutral GeoJSON sources and does not import MapLibre.

## Engine Creation And Reuse

Direct dataset mode lazily creates a core engine on the first viewport request. Engines are cached
by `datasetId`, `datasetVersion`, and `geometryHash`. A caller can inject `createEngine` for tests,
custom engine options, or future engine-pool integration.

## Request Race Risks

The runtime guards these races:

- newer viewport requests can abort older requests
- stale responses cannot update state or adapters
- late resolver/query responses are converted to normal request aborts
- timeout aborts produce stable `DOWNLOAD_TIMEOUT` errors
- duplicate active request keys are deduplicated unless `force: true`
- dispose aborts active work before the runtime enters `disposed`

## State Machine

```mermaid
stateDiagram-v2
  [*] --> idle
  idle --> scheduled: debounced setViewport
  idle --> resolving: immediate setViewport
  scheduled --> resolving: scheduler fires
  resolving --> loading: dataset resolved
  loading --> querying: engine ready
  querying --> updating-adapter: attached adapter
  querying --> ready: no adapter
  updating-adapter --> ready: adapter updated
  resolving --> error: failure or timeout
  loading --> error: failure or timeout
  querying --> error: failure or timeout
  updating-adapter --> error: adapter failure
  scheduled --> idle: cancel
  resolving --> idle: cancel
  loading --> idle: cancel
  querying --> idle: cancel
  ready --> resolving: force refresh or new viewport
  error --> resolving: new viewport
  idle --> disposed
  ready --> disposed
  error --> disposed
```

## Sprint 13 Integration Points

Sprint 13 should plug into existing seams without changing the request lifecycle:

- replace single-dataset resolution with catalog resolution plans
- replace per-dataset engine reuse with an engine pool
- let `createEngine` accept prebuilt binary indexes
- move request cancellation into worker transports
- extend cache keys with catalog plan and binary index hashes
- merge multi-engine results before adapter updates
