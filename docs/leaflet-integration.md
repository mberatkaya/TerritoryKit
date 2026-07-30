# Leaflet Integration

`@territory-kit/leaflet` adapts runtime viewport results to Leaflet native GeoJSON layers. The
package keeps `leaflet` as a peer dependency and imports it only as a type, so the adapter module is
safe to import in SSR environments.

## Runtime Viewport Loading

```ts
import * as L from "leaflet";
import { createTerritoryRuntime } from "@territory-kit/runtime";
import { createLeafletTerritoryAdapter } from "@territory-kit/leaflet";

const adapter = createLeafletTerritoryAdapter({
  leaflet: L,
  sourceId: "territory-kit-zones",
  zones: [],
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

await runtime.setViewport({
  bounds: {
    west: map.getBounds().getWest(),
    south: map.getBounds().getSouth(),
    east: map.getBounds().getEast(),
    north: map.getBounds().getNorth()
  },
  zoom: map.getZoom()
});
```

Runtime owns dataset installation, ADM selection, cache hits, duplicate viewport dedupe, request
cancellation, and error propagation. The Leaflet adapter only owns renderer state: layer creation,
GeoJSON replacement, style refresh, territory click/hover events, and cleanup.

## GeoJSON And MVT

Leaflet has native GeoJSON support. TerritoryKit sends runtime viewport updates as
`FeatureCollection` sources with stable `territoryId`, `id`, `datasetId`, `adminLevel`, `level`,
`name`, and `parentId` properties.

Leaflet does not ship native MVT rendering. If an application wants MVT, pass a
`createVectorTileLayer(source, context)` factory that uses the plugin of your choice. The adapter
then reports `capabilities.vectorTiles: true`; otherwise a vector tile source fails with
`CAPABILITY_UNSUPPORTED`.

```ts
const adapter = createLeafletTerritoryAdapter({
  leaflet: L,
  createVectorTileLayer(source) {
    return createLayerWithYourLeafletMvtPlugin(source.tiles ?? []);
  }
});
```

## Registry Render Sources

Use `createTerritoryLeafletSource()` when you need render artifact metadata from a registry without
installing query geometry. It supports dataset-level and country/level resolution, including
`requestedLevel`, `renderedLevel`, `coverageStatus`, and fallback reason reporting.

```ts
const source = await createTerritoryLeafletSource({
  registry,
  country: "TR",
  level: "ADM3",
  parentId: "tr:adm2:fatih",
  fallback: "deepest-available",
  formatPreference: ["geojson", "mvt"]
});

console.log(source.requestedLevel, source.renderedLevel, source.fallbackReason);
```

Leaflet GeoJSON sources are expected to use EPSG:4326/CRS84 coordinates. A different source CRS is
rejected with `RUNTIME_CONFIGURATION_INVALID`.

## Example

`examples/web-leaflet-turkey` runs with the synthetic Turkey fixture by default. Set
`VITE_TERRITORY_REGISTRY_URL` and optionally `VITE_TERRITORY_DATASET_ID` to use a hosted registry.

```bash
pnpm --filter @territory-kit/example-web-leaflet-turkey dev
```
