# @territory-kit/openlayers

OpenLayers adapter utilities for rendering TerritoryKit viewport results with `VectorSource` and
`VectorLayer`. The package keeps OpenLayers as a peer dependency and is safe to import in SSR
environments.

## Installation

```sh
pnpm add @territory-kit/openlayers @territory-kit/runtime @territory-kit/registry ol
```

## Basic Usage

```ts
import GeoJSON from "ol/format/GeoJSON.js";
import VectorLayer from "ol/layer/Vector.js";
import VectorSource from "ol/source/Vector.js";
import { createOpenLayersTerritoryAdapter } from "@territory-kit/openlayers";
import { createTerritoryRuntime } from "@territory-kit/runtime";

const adapter = createOpenLayersTerritoryAdapter({
  geoJsonFormat: new GeoJSON(),
  vectorSource: new VectorSource(),
  vectorLayer: new VectorLayer(),
  featureProjection: "EPSG:3857",
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

Vector tiles are supported only when `createVectorTileSource` and `createVectorTileLayer` are
provided by the application, keeping `ol` renderer details out of the shared adapter contract.

`createTerritoryOpenLayersAdapter` is kept as an equivalent alias for codebases that prefer the
package-prefixed factory name.

## License

Apache-2.0
