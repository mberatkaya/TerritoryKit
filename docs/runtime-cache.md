# Runtime Cache

`createMemoryTerritoryRuntimeCache(options?)` provides the Sprint 12 cache implementation for
viewport query results.

## API

```ts
const cache = createMemoryTerritoryRuntimeCache({
  maxEntries: 128,
  maxBytes: 8 * 1024 * 1024
});
```

The cache implements:

- `get(key, context): Promise<Uint8Array | undefined>`
- `set(key, bytes, context): Promise<void>`
- `delete(key, context): Promise<void>`
- `clear(): Promise<void>`
- `getSummary(): TerritoryRuntimeCacheSummary`
- `dispose(): void`

## Eviction

Entries are evicted least-recently-used first. Reads refresh recency. `maxEntries` and `maxBytes`
are enforced after each write. An entry larger than `maxBytes` is not retained.

## Byte Accounting

The cache tracks stored byte length, hit/miss counts, set/delete counts, and eviction count. The
runtime exposes those values on `state.cache`.

## Mutation Policy

By default the cache copies `Uint8Array` values on write and on read. This makes cache behavior
deterministic even if callers mutate their original buffers or mutate returned buffers.

Callers can opt out with `copyOnWrite: false` or `copyOnRead: false` when they own the buffers and
want to avoid copies.

## Scope

Sprint 12 intentionally does not add IndexedDB, filesystem, or service-worker caches. Those belong
behind the same async cache contract in later browser/Node-specific work.
