# Turkey Neighbourhood MapLibre Example

Turkey ADM3 neighbourhood rendering is partial. Request the Gaziantep ADM3 artifact with a covered
ADM2 parent so the registry can distinguish an available neighbourhood tile set from a parent
outside the pilot scope.

```ts
import {
  createTerritoryMapLibreLevelLayers,
  createTerritoryMapLibreSource
} from "@territory-kit/maplibre";

const source = await createTerritoryMapLibreSource({
  registry,
  country: "TR",
  level: "ADM3",
  parentId: "tr:adm2:54988432b26387222249237",
  fallback: "deepest-available",
  formatPreference: ["mvt", "geojson"]
});

map.addSource(source.source.id, source.source.spec);
for (const layer of createTerritoryMapLibreLevelLayers({
  sourceId: source.source.id,
  sourceLayer: source.sourceLayer
})) {
  map.addLayer(layer);
}

console.log({
  requested: source.requestedLevel,
  rendered: source.renderedLevel,
  fallbackReason: source.fallbackReason,
  coverageStatus: source.coverageStatus
});
```

For covered Gaziantep parents, `renderedLevel` is `ADM3` and the source uses the generated MVT
tiles under `datasets/generated/countries/TR/levels/ADM3/render/tiles`. For an uncovered Turkey
ADM2 parent, deepest-available fallback resolves ADM2 with
`fallbackReason: "requested-level-unavailable-for-area"`.
