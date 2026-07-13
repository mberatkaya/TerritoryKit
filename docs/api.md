# API

## `@territory-kit/dataset`

- `validateTerritoryDataset(input)` returns validation issues without throwing.
- `loadTerritoryDataset(input)` validates and throws `TerritoryDatasetValidationError`
  on invalid input.
- `createTerritoryDatasetFromGeoJson(input, options)` imports GeoJSON FeatureCollections
  into TerritoryKit datasets and reports `featureId`, `sourcePath`, and `repairSuggestion`
  where available.
- `territoryDatasetJsonSchema` exposes the schema baseline for `territory-schema@1`.
- Validation also reports stale geometry metadata with `BBOX_MISMATCH` and
  `CENTER_OUT_OF_BOUNDS`, and warns on `NEIGHBOR_NOT_RECIPROCAL`.

## `@territory-kit/core`

- `createTerritoryEngine({ dataset, levelStrategy })`
- `engine.latLngToZone({ lat, lng }, { level })`
- `engine.zoneToBoundary(zoneId)`
- `engine.zoneToParent(zoneId)`
- `engine.zoneToChildren(zoneId)`
- `engine.zoneNeighbors(zoneId, { distance })`
- `engine.getAdjacencyConnections(zoneId, { connectionTypes })`
- `engine.getZonesInBounds({ west, south, east, north, level })`
- `engine.getVisibleZones({ bounds, zoom })`
- `engine.getViewportCacheKey({ bounds, zoom, level })`
- `engine.getLevelTransition({ bounds, fromZoom, toZoom })`
- `engine.polygonToZones(geometry, { level })`

## `@territory-kit/maplibre`

- `zonesToFeatureCollection(zones, stateByZoneId)`
- `createTerritoryMapLibreLayers(zones, options)` supports initial `stateByZoneId`.
- `createTerritoryMapLibreAdapter({ zones, onZoneClick, onZoneHover })`
- Adapter lifecycle: `attach`, `detach`, `updateData`, `updateTheme`

## `@territory-kit/nestjs`

- `TerritoryKitModule.forRoot({ dataset, repository })`
- `TerritoryKitController` exposes `GET /territories` and `POST /territories/locate`
- Controller query/body parsing rejects invalid numeric input before repository calls.
- `createPostgisTerritoryRepository(client, options)` uses `ST_Intersects`, `ST_Covers`, and
  GiST-friendly bbox prefilters.

## `@territory-kit/cli`

- JSON-first commands: `validate`, `index`, `adjacency`, `import`, `simplify`, `generate`
- `import` emits a deterministic `manifest.geometryHash` in the returned dataset.
