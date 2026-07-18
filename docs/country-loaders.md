# Country Loader Packages

The `@territory-kit/data-*` packages are thin runtime loaders:

- `@territory-kit/data-de`
- `@territory-kit/data-id`
- `@territory-kit/data-jp`
- `@territory-kit/data-tr`
- `@territory-kit/data-us`

They do not ship boundary geometry. Applications provide a resolver that reads files from a CDN,
local filesystem bridge, object storage, or bundled app asset directory.

```ts
import { loadTurkeyDataset } from "@territory-kit/data-tr";

const handle = await loadTurkeyDataset({
  resolveArtifact: (path) => fetch(`/territory/tr/${path}`).then((response) => response.text()),
  verifyChecksums: true,
  loadAdjacency: true
});

const adm2 = handle.levels.ADM2;
const neighbors = handle.adjacencyIndexes.ADM2?.getNeighbors("tr:adm2:tr-01-a");
```

`verifyChecksums` reads `checksums.json` before loading artifacts. `loadAdjacency` validates each
requested adjacency artifact against the corresponding level dataset before creating an adjacency
index.

`@territory-kit/data-tr` advertises `ADM3` support for the partial Gaziantep neighbourhood pilot,
but its default levels remain ADM0-ADM2. Use `turkeyAdm3NeighbourhoodCoverage` or
`isTurkeyAdm3ParentCovered(parentId)` before resolving ADM3 artifacts for Turkey.
