# Offline Datasets

Offline mode uses the cached registry snapshot and cached artifacts only:

```ts
import { createNodeTerritoryRegistryClient } from "@territory-kit/registry/node";

const registry = createNodeTerritoryRegistryClient({
  registryUrl: "./dist/registry.json",
  cacheDir: "./.cache/territory",
  offline: true
});
```

Run one online install before switching to offline mode. If the registry snapshot or a selected
artifact is absent, TerritoryKit throws an explicit offline cache error and does not attempt a
network request.
