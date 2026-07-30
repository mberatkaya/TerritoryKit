# React Native Runtime

`@territory-kit/react-native` is the mobile runtime package for React Native and Expo-compatible
applications. It installs registry artifacts into application storage, validates checksums, keeps a
small memory cache, and queries installed datasets by viewport.

The package assumes React Native does not provide browser APIs such as `window`, `document`,
Web Worker, IndexedDB, Cache API, or Node `fs`. Storage, fetch, and checksum work sit behind
injected adapters.

## Install

```sh
pnpm add @territory-kit/react-native
```

`react` and `react-native` are peer dependencies. `@maplibre/maplibre-react-native` is an optional
peer dependency used only by the `@territory-kit/react-native/maplibre` integration helpers.

## Runtime

```ts
import { createMobileTerritoryRuntime } from "@territory-kit/react-native";

const mobileRuntime = createMobileTerritoryRuntime({
  registryUrl,
  storageAdapter,
  cachePolicy: {
    memoryMaxBytes: 4 * 1024 * 1024,
    backgroundMemoryMaxBytes: 512 * 1024,
    fallbackToInstalledOnNetworkError: true
  }
});

await mobileRuntime.installDataset({
  datasetId: "territory-kit-tr",
  version: "1.0.0",
  levels: ["ADM0", "ADM1", "ADM2"]
});

const visible = await mobileRuntime.queryViewport({
  datasetId: "territory-kit-tr",
  viewport: {
    bounds: { west: 25, south: 35, east: 45, north: 43 },
    zoom: 7
  }
});
```

`version` is required for install. Mobile offline behavior should be pinned to immutable dataset
versions; mutable "latest" semantics belong in the registry refresh decision before install.

## Storage Adapter

Applications provide a filesystem adapter:

```ts
interface MobileTerritoryStorageAdapter {
  rootDirectory: string;
  readFile(path: string): Promise<Uint8Array | undefined>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  makeDirectory(path: string): Promise<void>;
  moveFile(fromPath: string, toPath: string): Promise<void>;
  deleteFile(path: string, options?: { recursive?: boolean }): Promise<void>;
  listDirectory?(path: string): Promise<readonly string[]>;
}
```

Use app-private document/cache directories. The runtime normalizes Android and iOS path separators
under the adapter boundary and rejects unsafe `..` path segments.

## Lifecycle

Wire React Native `AppState` into `setAppState`. The official React Native API exposes foreground
and background changes, and also a `memoryWarning` event on iOS. Android low-memory trimming usually
needs a native bridge; call `handleLowMemory()` from that bridge if the app has one.

```ts
const sub = AppState.addEventListener("change", (state) => {
  mobileRuntime.setAppState(state);
});
```

## Worker Behavior

React Native does not provide a web worker equivalent for arbitrary TerritoryKit JS queries. The
runtime uses async JS fallback execution and emits `worker-fallback` before the first viewport
query. Binary indexes reduce candidate scans, but large geometry parsing and queries can still
occupy the JS thread. A true off-thread engine requires an application-provided native module or
JSI worker solution and is not represented as complete by this package.

## Hermes

The package avoids Node and browser-only modules and ships pure TypeScript checksum support for
Hermes. For large production artifacts, prefer a native SHA-256 adapter because pure JS checksum
work can be CPU-heavy on the JS thread.

## Unsupported In Core Package

- No bundled Expo FileSystem or RNFS dependency.
- No mandatory MapLibre React Native dependency.
- No native decompression module for gzip or brotli artifacts.
- No real worker thread implementation without native application code.
