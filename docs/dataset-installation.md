# Dataset Installation

Use the CLI to inspect, install, update, verify, and remove registry-backed datasets:

```bash
territory registry inspect --registry ./dist/registry.json
territory dataset search tr --registry ./dist/registry.json
territory dataset info territory-kit-tr --registry ./dist/registry.json
territory dataset install territory-kit-tr --registry ./dist/registry.json --levels ADM0,ADM1 --load-adjacency
territory dataset update territory-kit-tr --registry ./dist/registry.json --refresh-registry --remove-old
territory dataset verify territory-kit-tr --cache-dir ~/.territory-kit
territory dataset remove territory-kit-tr --cache-dir ~/.territory-kit
territory dataset list-installed --cache-dir ~/.territory-kit
```

Thin country loaders accept either the existing `resolveArtifact` function or a registry client:

```ts
import { loadTurkeyDataset } from "@territory-kit/data-tr";
import { createNodeTerritoryRegistryClient } from "@territory-kit/registry/node";

const registry = createNodeTerritoryRegistryClient({
  registryUrl: "./dist/registry.json",
  cacheDir: "./.cache/territory"
});

const dataset = await loadTurkeyDataset({
  registry,
  levels: ["ADM0", "ADM1"],
  loadAdjacency: true,
  verifyChecksums: true
});
```
