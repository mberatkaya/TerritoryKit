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

## Automatic render detail

`resolveTerritoryMapLibreLevelForZoom({ zoom, availableLevels, currentLevel })` returns
`requestedLevel`, `renderedLevel`, `exactMatch`, `changed`, and an unavailable-level fallback reason.
Call it after each completed zoom and replace the active territory source only when `changed` is
true. The default MapLibre render policy enters ADM0 at zoom 0, ADM1 at 5, ADM2 at 8, ADM3 at 12,
ADM4 at 15, and ADM5 at 18. Thus zoom 0–4 shows country geometry, 5–7 provinces, 8–11 districts,
and 12–14 neighbourhood detail. The Turkey example stops at ADM3 because its dataset offers no
deeper level. `availableLevels` caps the rendered level at the deepest available shallower level;
the result reports that fallback rather than claiming the requested level exists.

The default 0.25 zoom hysteresis delays entry until a threshold plus 0.25 and exit until the
threshold minus 0.25. Pass `hysteresis` to tune it. The requested level still reports the raw zoom
policy, while the rendered level is stable around a threshold. This is a rendering detail policy,
not a conversion of administrative semantics. Canonical full geometry remains unchanged.

`zoomToDefaultLevel()` in `@territory-kit/core` retains its existing 2/5/8/11/14 thresholds for
backward compatibility. MapLibre uses its renderer-specific policy above. Dense ADM3 rendering
should use visible MapLibre MVT tiles, while precise territory details should load a verified
district shard only on interaction. A national ADM3 full GeoJSON must not be a browser startup
source. The Turkey demo refuses ADM3 GeoJSON and falls back to an available shallower render level.

For registry query, the demo resolves exact ADM0–ADM2 `levels/<level>/dataset.json` artifacts
and verifies each declared checksum. It never calls broad `installDataset()` during map startup or
search. The national registry generator describes those query artifacts, ADM0–ADM2 derived
GeoJSON render artifacts, and the ADM3 MVT manifest. A registry can provide MVT for shallower
levels as well; the demo prefers it. For the Sprint 7 national delivery manifest, set
`VITE_TERRITORY_DELIVERY_MANIFEST_URL` and optionally pin its content hash with
`VITE_TERRITORY_DELIVERY_MANIFEST_HASH`. Precise ADM3 interaction then uses the runtime resolver
to validate and load only the requested district shard. A registry can alternatively describe
scoped district query artifacts with `coveredParentIds` and SHA-256 metadata.

## Production GeoJSON Payloads

For small installed or backend-filtered viewports, `zonesToFeatureCollection()` can emit minimal
MapLibre-ready GeoJSON:

```ts
const data = zonesToFeatureCollection(zones, {
  propertyMode: "minimal",
  datasetVersion: "2.0.0",
  includeGeometryVersion: true,
  simplifyTolerance: 0.001
});
```

`feature.id` stays equal to `territoryId`, and `createTerritoryMapLibreLayers()` keeps
`promoteId: "id"` for feature-state highlight/selection. `propertyMode: "minimal"` avoids dumping
raw dataset metadata into the client payload. `simplifyTolerance` is conservative per-ring
simplification for small payloads; topology-safe shared-boundary simplification should still happen
at dataset build time for large national artifacts.
