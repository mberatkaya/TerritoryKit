# Mobile Cache Policy

`@territory-kit/react-native` has two cache layers:

- Persistent artifact storage through the application-provided storage adapter.
- In-memory LRU cache for viewport query results and decoded installed datasets.

Persistent storage is authoritative for offline startup. Memory cache is opportunistic and can be
cleared at any time.

## Policy Options

```ts
createMobileTerritoryRuntime({
  registryUrl,
  storageAdapter,
  cachePolicy: {
    memoryMaxEntries: 64,
    memoryMaxBytes: 4 * 1024 * 1024,
    backgroundMemoryMaxBytes: 512 * 1024,
    lowMemoryMaxBytes: 0,
    installMaxArtifactBytes: 64 * 1024 * 1024,
    requestTimeoutMs: 30_000,
    fallbackToInstalledOnNetworkError: true
  }
});
```

`memoryMaxEntries` and `memoryMaxBytes` evict least-recently-used viewport query entries. Reads
refresh recency. `backgroundMemoryMaxBytes` is applied when the app moves out of the foreground.
`lowMemoryMaxBytes` is applied when `handleLowMemory()` is called.

## Lifecycle Integration

React Native `AppState` reports foreground/background transitions. iOS can emit `memoryWarning`
through `AppState`; Android usually requires native `onTrimMemory` plumbing if the app wants a
comparable signal.

```ts
AppState.addEventListener("change", (state) => {
  mobileRuntime.setAppState(state);
});

AppState.addEventListener("memoryWarning", () => {
  mobileRuntime.handleLowMemory();
});
```

## Request Cancellation

Every install and query accepts `AbortSignal`. `cancelActiveRequests(reason)` aborts active runtime
operations and normalizes cancellation to `REQUEST_ABORTED`.

Network transports should pass the signal to React Native `fetch` or to the app's native transport.
If an older transport cannot cancel the socket, the runtime still prevents stale results from
committing active state.

## Performance Guidance

- Keep memory limits small enough for low-end Android devices.
- Prefer `.tksi` binary indexes for query artifacts.
- Install render artifacts for the map and query artifacts only for workflows that need polygon
  hit-testing or search.
- Use a native checksum/decompression adapter for large compressed artifacts.
- Measure startup JSON parse and binary index decode time on real devices; simulators do not model
  JS thread pressure reliably.
