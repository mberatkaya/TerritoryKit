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

Lower administrative render artifacts can be resolved by country and level:

```ts
const adm3 = await createTerritoryMapLibreSource({
  registry,
  country: "TR",
  level: "ADM3",
  parentId: "tr:adm2:54988432b26387222249237",
  fallback: "deepest-available"
});

console.log(adm3.requestedLevel, adm3.renderedLevel, adm3.fallbackReason);
```

`requestedLevel` and `renderedLevel` are intentionally separate. If ADM3 is missing and fallback
selects ADM2, the source reports `renderedLevel: "ADM2"` with reason
`requested-level-unavailable`.

For partial artifacts, pass `parentId` when the requested level is only available for selected
parents. Turkey ADM3 currently covers Gaziantep districts; an uncovered parent returns ADM2 with
`fallbackReason: "requested-level-unavailable-for-area"` under deepest-available fallback.

Use `createTerritoryMapLibreLevelLayers()` for ADM0-ADM5 zoom policy defaults. ADM3 and deeper
sources prefer MVT when available; use GeoJSON fallback for small fixtures only.
