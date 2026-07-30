# OpenLayers Integration

`@territory-kit/openlayers` adapts runtime viewport results to OpenLayers `VectorSource` and
`VectorLayer` instances. The package keeps `ol` as a peer dependency and exposes structural adapter
types so OpenLayers is not bundled by applications that do not import this renderer package.

## Runtime Viewport Loading

```ts
import GeoJSON from "ol/format/GeoJSON.js";
import VectorLayer from "ol/layer/Vector.js";
import VectorSource from "ol/source/Vector.js";
import { transformExtent } from "ol/proj.js";
import { createTerritoryRuntime } from "@territory-kit/runtime";
import { createOpenLayersTerritoryAdapter } from "@territory-kit/openlayers";

const vectorSource = new VectorSource();
const vectorLayer = new VectorLayer({ source: vectorSource });
const adapter = createOpenLayersTerritoryAdapter({
  geoJsonFormat: new GeoJSON(),
  vectorSource,
  vectorLayer,
  featureProjection: "EPSG:3857",
  onTerritoryClick(event) {
    adapter.updateState({ selectedTerritoryIds: [event.territoryId] });
  },
  onTerritoryHover(event) {
    adapter.updateState({ hoverTerritoryId: event.territoryId });
  }
});

adapter.attach(map);

const runtime = createTerritoryRuntime({
  adapter,
  adapterSourceId: "territory-kit-zones",
  registry,
  datasetId: "territory-kit-tr",
  engineOptions: { levelStrategy }
});

const view = map.getView();
const extent = transformExtent(view.calculateExtent(map.getSize()), "EPSG:3857", "EPSG:4326");
await runtime.setViewport({
  bounds: { west: extent[0], south: extent[1], east: extent[2], north: extent[3] },
  zoom: view.getZoom() ?? 0
});
```

Runtime owns dataset installation, ADM selection, cache hits, duplicate viewport dedupe, request
cancellation, and error propagation. The OpenLayers adapter owns renderer state: vector source
replacement, style callback invocation, feature picking, map listener cleanup, projection checks,
and dispose.

## Projection Contract

TerritoryKit GeoJSON data is WGS84 by default. If your OpenLayers view projection differs from the
data projection, pass `featureProjection`. Without it, attach fails with
`RUNTIME_CONFIGURATION_INVALID`.

```ts
createOpenLayersTerritoryAdapter({
  geoJsonFormat: new GeoJSON(),
  vectorSource,
  vectorLayer,
  dataProjection: "EPSG:4326",
  featureProjection: "EPSG:3857"
});
```

## Vector Tiles

Vector tiles are optional because applications often configure OpenLayers tile formats, tile grids,
decluttering, and styles differently. Pass both factories to enable the capability:

```ts
const adapter = createOpenLayersTerritoryAdapter({
  geoJsonFormat: new GeoJSON(),
  vectorSource,
  vectorLayer,
  createVectorTileSource(source) {
    return new VectorTileSource({
      format: new MVT(),
      url: source.tiles?.[0]
    });
  },
  createVectorTileLayer(source) {
    return new VectorTileLayer({ source });
  }
});
```

If those factories are omitted, `capabilities.vectorTiles` is `false` and vector tile source
replacement fails with `CAPABILITY_UNSUPPORTED`.

## Style Callback

The optional `style(feature, state)` callback receives the picked OpenLayers feature plus merged
TerritoryKit state. `state.selected` and `state.hover` are derived from `updateState()` and any
initial `stateByZoneId` entries.

## Example

`examples/web-openlayers-turkey` runs with the synthetic Turkey fixture by default. Set
`VITE_TERRITORY_REGISTRY_URL` and optionally `VITE_TERRITORY_DATASET_ID` to use a hosted registry.

```bash
pnpm --filter @territory-kit/example-web-openlayers-turkey dev
```
