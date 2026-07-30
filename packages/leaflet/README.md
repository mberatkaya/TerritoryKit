# @territory-kit/leaflet

Leaflet adapter utilities for rendering TerritoryKit viewport results with native GeoJSON layers.
The package keeps Leaflet as a peer dependency and is safe to import in SSR environments.

## Installation

```sh
pnpm add @territory-kit/leaflet @territory-kit/runtime @territory-kit/registry leaflet
```

## Basic Usage

```ts
import * as L from "leaflet";
import { createLeafletTerritoryAdapter } from "@territory-kit/leaflet";
import { createTerritoryRuntime } from "@territory-kit/runtime";

const adapter = createLeafletTerritoryAdapter({
  leaflet: L,
  sourceId: "territory-kit-zones",
  zones: [],
  onTerritoryClick: ({ territoryId }) => {
    adapter.updateState({ selectedTerritoryIds: [territoryId] });
  },
  onTerritoryHover: ({ territoryId }) => {
    adapter.updateState({ hoverTerritoryId: territoryId });
  }
});

adapter.attach(map);

const runtime = createTerritoryRuntime({
  adapter,
  adapterSourceId: "territory-kit-zones",
  registry,
  datasetId: "territory-kit-tr"
});
```

Leaflet does not include native MVT support. Pass `createVectorTileLayer` to enable a plugin-backed
vector tile path; otherwise `vectorTiles` is reported as unsupported.

`createTerritoryLeafletAdapter` is kept as an equivalent alias for codebases that prefer the
package-prefixed factory name.

## License

Apache-2.0
