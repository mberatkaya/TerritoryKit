# @territory-kit/runtime

Viewport request orchestration for TerritoryKit datasets, core engines, runtime caches, and
renderer-independent adapters.

```bash
pnpm add @territory-kit/runtime
```

## Usage

```ts
import { createTerritoryRuntime } from "@territory-kit/runtime";
import { dataset } from "./dataset.js";

const runtime = createTerritoryRuntime({ dataset, debounceMs: 50 });

runtime.subscribe((event) => {
  console.log(event.sequence, event.type, event.state.status);
});

await runtime.setViewport({
  bounds: { west: 28.9, south: 40.9, east: 29.2, north: 41.2 },
  zoom: 9,
  level: 1
});
```

## Runtime API

- `setViewport(viewport, options?)` validates the viewport, schedules or starts a request, resolves
  a dataset, creates/reuses an engine, reads/writes cache bytes, queries visible zones, and updates
  an attached capable adapter.
- `refresh(options?)` reruns the current viewport with `force: true`.
- `cancelActiveRequest(reason?)` aborts scheduled or active work as a normal lifecycle result.
- `getState()` and `state` return immutable snapshots.
- `subscribe(listener)` and `unsubscribe(listener)` provide deterministic event delivery.
- `dispose()` aborts active work, clears listeners, disposes runtime-owned caches, and enters
  `disposed`.

Cancellation restores the last successfully committed viewport when one exists. If the first
request is cancelled before a viewport commits, the runtime returns to `idle` with no active
viewport.

Attached adapters use `options.adapterSourceId` first, then `adapter.managedSourceId`. Async
adapter operations receive `{ requestId, revision, signal }`; adapters should check the signal
before committing renderer-visible source changes.

## Catalog, Pool, and Worker Loading

```ts
import {
  createTerritoryCatalog,
  createTerritoryEnginePool,
  createTerritoryRuntime
} from "@territory-kit/runtime";

const catalog = createTerritoryCatalog([
  {
    dataset,
    country: "TR",
    levels: ["ADM2", "ADM3"],
    fallbackLevel: "ADM2",
    priority: 10,
    spatialIndex: indexBuffer,
    indexHash: "..."
  }
]);

const runtime = createTerritoryRuntime({
  catalog,
  enginePool: createTerritoryEnginePool({ maxActiveEngines: 4 }),
  workerTransport,
  zoneIdCollisionPolicy: "namespace"
});
```

Catalog mode resolves every dataset that intersects a viewport, supports exact and fallback level
matches, selects priority winners, and rejects stale plans if the catalog changes before commit.
Registration rejects manifest override conflicts, unknown levels, invalid fallback levels,
non-finite priorities, bounds that exclude dataset coverage, and binary index metadata/hash
mismatches. Re-registering an identical entry id is idempotent; conflicting registrations with the
same entry id fail with `RUNTIME_CONFIGURATION_INVALID`.

Priority selection treats overlapping same-country/parent/level artifacts as alternatives while
allowing disjoint shards to be selected together. Use `selectionGroup` when disjoint artifacts are
intentional variants that should still compete.

Runtime rejects duplicate zone ids by default before adapter updates. Set
`zoneIdCollisionPolicy: "namespace"` to emit deterministic ids as
`<entryId>::<sourceZoneId>` and preserve `sourceZoneId`, `sourceDatasetId`, and `sourceEntryId`
properties.

`createTerritoryEnginePool` provides per-dataset engine reuse, max-active LRU eviction, pinned
engines, memory estimates, concurrent same-key creation dedupe, and disposal. Custom pool keys are
validated against dataset id, dataset version, geometry hash, and index hash to avoid accidental
engine reuse across incompatible artifacts. `createTerritoryWorkerClient` defines the injectable
worker transport used for binary-index-backed catalog artifacts and validates response request ids,
types, and dataset ids.

## Cache

```ts
import { createMemoryTerritoryRuntimeCache } from "@territory-kit/runtime";

const cache = createMemoryTerritoryRuntimeCache({
  maxEntries: 128,
  maxBytes: 8 * 1024 * 1024
});
```

The memory cache is async, deterministic, LRU-based, byte-counted, and copies `Uint8Array` values
on read/write by default. `maxEntries` and `maxBytes` must be finite non-negative integers; `0`
creates a zero-capacity policy for that dimension.

Runtime-created caches are disposed by `runtime.dispose()`. Injected caches are external by default
and remain usable after runtime disposal; pass `cacheOwnership: "runtime"` when a runtime should
own an injected cache.

## Boundaries

Runtime imports `@territory-kit/adapter-core`, `@territory-kit/core`,
`@territory-kit/dataset`, and `@territory-kit/registry`. It does not import MapLibre, Node
filesystem helpers, renderer targets, or worker implementations.

See [runtime viewport lifecycle](../../docs/architecture/runtime-viewport-lifecycle.md),
[runtime cache](../../docs/runtime-cache.md), and
[catalog](../../docs/catalog.md), [worker loading](../../docs/worker-loading.md), and
[runtime viewport audit](../../docs/architecture/runtime-viewport-audit.md) for architecture notes.
