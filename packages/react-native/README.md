# @territory-kit/react-native

React Native mobile runtime for installing TerritoryKit registry artifacts into app storage,
querying installed datasets by viewport, and handing render metadata to native map renderers.

## Install

```sh
pnpm add @territory-kit/react-native
```

`react` and `react-native` are peer dependencies. MapLibre React Native is optional and only needed
when importing `@territory-kit/react-native/maplibre`.

## Runtime

```ts
import { createMobileTerritoryRuntime } from "@territory-kit/react-native";

const mobileRuntime = createMobileTerritoryRuntime({
  registryUrl,
  storageAdapter,
  cachePolicy: {
    memoryMaxBytes: 4 * 1024 * 1024,
    fallbackToInstalledOnNetworkError: true
  }
});

await mobileRuntime.installDataset({
  datasetId: "territory-kit-tr",
  version: "1.0.0",
  levels: ["ADM0", "ADM1", "ADM2"]
});

const result = await mobileRuntime.queryViewport({
  datasetId: "territory-kit-tr",
  viewport: {
    bounds: { west: 25, south: 35, east: 45, north: 43 },
    zoom: 7
  }
});
```

The package does not import Node filesystem APIs, browser workers, IndexedDB, Cache API, `window`,
or `document`. Storage, fetch, and checksum behavior are adapter boundaries.

## MapLibre Native

```ts
import { createTerritoryMapLibreNativeMvtBundle } from "@territory-kit/react-native/maplibre";
```

The MapLibre entry point returns structural props for `VectorSource`, `FillLayer`, and `LineLayer`.
Applications own map style URLs, tokens, and native project setup.
