# Runtime Viewport Lifecycle

`@territory-kit/runtime` coordinates viewport requests without taking ownership of renderers,
network transports, or filesystem access.

## Request Flow

1. `setViewport(viewport, options?)` validates bounds, zoom, and optional level.
2. Duplicate completed viewports are skipped by default.
3. Active requests with the same request key are deduplicated unless `force: true`.
4. Debounced requests enter `scheduled`; immediate requests enter `resolving`.
5. Runtime resolves a dataset from direct options, a resolver, or a registry install.
6. Runtime creates or reuses a core engine.
7. Runtime checks the cache, queries visible zones on miss, and writes cache bytes.
8. Runtime updates an attached capable adapter, when present.
9. Only the latest successful request can publish `adapter-updated`, `viewport-ready`, state, or
   renderer-visible data.

## Viewport Shape

```ts
interface TerritoryRuntimeViewport {
  bounds: { west: number; south: number; east: number; north: number };
  zoom: number;
  level?: number;
  metadata?: Readonly<Record<string, unknown>>;
}
```

Bounds must be finite WGS84 values and must not cross the antimeridian in Sprint 12. Invalid input
throws a `TerritoryError` with `INVALID_BOUNDS`, `INVALID_COORDINATE`, or `INVALID_LEVEL`.

## Event Order

A successful immediate request emits:

1. `viewport-requested`
2. `request-started`
3. `dataset-resolved`
4. `engine-ready`
5. `cache-hit` or `cache-miss`
6. `query-completed`
7. `adapter-updated`, when an attached adapter is updated
8. `viewport-ready`

Debounced requests emit `viewport-scheduled` before the scheduler fires. Cancellation emits
`request-aborted`. Failures emit `request-failed`.

Every event includes a monotonic `sequence`, `occurredAt`, immutable `state`, and request metadata
where applicable.

## Scheduler And Clock

The runtime uses injectable `clock` and `scheduler` options. Tests can provide fake timers without
depending on browser or Node timer globals. Runtime defaults use `Date` and `globalThis.setTimeout`.

## Adapter Policy

Runtime accepts renderer-independent adapters only. It does not import MapLibre, Leaflet, DOM, or
mobile renderer packages. Detached adapters are skipped. Attached adapters must advertise `geoJson`
and `sourceReplacement` capabilities before runtime calls `setSource`.

Runtime resolves adapter source identity in this order:

1. `options.adapterSourceId`
2. `adapter.managedSourceId`
3. no source id when no adapter is present
4. `RUNTIME_CONFIGURATION_INVALID` when an attached adapter has neither source identity.

`setSource(source, context?)` receives a renderer-neutral operation context with `requestId`,
`revision`, and `signal`. Async adapters must check `context.signal` before committing visible
source changes. The runtime checks freshness immediately before and after adapter work; stale
adapter operations cannot emit `adapter-updated` or `viewport-ready`.

## Cancellation Policy

Abort is a normal lifecycle result. `cancelActiveRequest` and superseding viewports emit
`request-aborted` and resolve the request with `status: "aborted"`. Timeouts are failures and use
the shared `DOWNLOAD_TIMEOUT` error code.

When a request is cancelled after an earlier viewport has committed, runtime state returns to
`ready` for that committed viewport, level, dataset, and result summary. If no viewport has
committed yet, cancellation returns the runtime to `idle` and clears active request fields.
