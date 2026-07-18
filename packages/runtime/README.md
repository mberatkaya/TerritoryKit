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
- `dispose()` aborts active work, clears listeners, disposes the owned memory cache, and enters
  `disposed`.

## Cache

```ts
import { createMemoryTerritoryRuntimeCache } from "@territory-kit/runtime";

const cache = createMemoryTerritoryRuntimeCache({
  maxEntries: 128,
  maxBytes: 8 * 1024 * 1024
});
```

The memory cache is async, deterministic, LRU-based, byte-counted, and copies `Uint8Array` values
on read/write by default.

## Boundaries

Runtime imports `@territory-kit/adapter-core`, `@territory-kit/core`,
`@territory-kit/dataset`, and `@territory-kit/registry`. It does not import MapLibre, Node
filesystem helpers, renderer targets, or worker implementations.

See [runtime viewport lifecycle](../../docs/architecture/runtime-viewport-lifecycle.md),
[runtime cache](../../docs/runtime-cache.md), and
[runtime viewport audit](../../docs/architecture/runtime-viewport-audit.md) for architecture notes.
