# Dataset Registry

TerritoryKit registries describe installable dataset artifacts without embedding large geometry in
npm packages. A registry is a JSON document with `registryVersion: "1"`, `generatedAt`, an optional
`baseUrl`, and ordered `datasets`.

Each dataset record includes an id, display name, semver version, `territory-schema@1`, supported
admin levels, source metadata, license attribution, and artifacts. Artifact purposes are `query`,
`render`, `metadata`, `adjacency`, and `debug`; Sprint 6 installs query, metadata, and adjacency
artifacts.

```ts
import { createTerritoryRegistryClient } from "@territory-kit/registry";

const registry = createTerritoryRegistryClient({
  registryUrl: "https://cdn.example.test/registry.json"
});

const installed = await registry.installDataset({
  datasetId: "territory-kit-tr",
  levels: ["ADM0", "ADM1"],
  loadAdjacency: true
});
```

The root registry client is browser-safe when a transport and cache are injected. Node filesystem
cache and file/http transport helpers are available from `@territory-kit/registry/node`.
