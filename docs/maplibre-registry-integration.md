# MapLibre Registry Integration

MapLibre can resolve render artifacts from the registry without downloading query geometry:

```ts
import {
  createTerritoryMapLibreLayer,
  createTerritoryMapLibreSource,
  createTerritoryMapLibreController
} from "@territory-kit/maplibre";

const source = await createTerritoryMapLibreSource({
  registry,
  datasetId: "territory-kit-tr",
  levels: ["ADM1"],
  formatPreference: ["mvt", "geojson"]
});

map.addSource(source.source.id, source.source.spec);
for (const layer of createTerritoryMapLibreLayer({ sourceId: source.source.id })) {
  map.addLayer(layer);
}

const controller = createTerritoryMapLibreController({ registry, datasetId: "territory-kit-tr" });
```

The controller lazy-loads query artifacts only when `resolveTerritory(territoryId)` is called.
