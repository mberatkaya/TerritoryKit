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
- `engine.latLngToZones([{ lat, lng }], { level })`
- `engine.zoneToBoundary(zoneId)`
- `engine.zoneToCenter(zoneId)`
- `engine.zoneToParent(zoneId)`
- `engine.zoneToChildren(zoneId)`
- `engine.getAncestors(zoneId)`
- `engine.getDescendants(zoneId)`
- `engine.isValidZone(zoneId)`
- `engine.zoneNeighbors(zoneId, { distance })`
- `engine.getAdjacencyConnections(zoneId, { connectionTypes })`
- `engine.getZonesInBounds({ west, south, east, north, level })`
- `engine.getVisibleZones({ bounds, zoom })`
- `engine.getViewportCacheKey({ bounds, zoom, level })`
- `engine.getLevelTransition({ bounds, fromZoom, toZoom })`
- `engine.polygonToZones(geometry, { level })`
- `defaultZoomLevelStrategy` and `zoomToDefaultLevel(zoom)` expose the default zoom mapping.
- `TerritoryZoneNotFoundError` is thrown by programmer-error APIs when a zone id is missing.

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

## `@territory-kit/generators`

- `generateGridTerritoryDataset(options)` creates deterministic rectangular fixtures.
- `generateVoronoiTerritoryDataset(options)` creates deterministic Voronoi-style fixtures.
- `generateWeightedVoronoiTerritoryDataset(options)` accepts weighted seed points.
- `createAdjacencyConnections(zones, options)` emits typed adjacency connection metadata.

## `@territory-kit/cli`

- JSON-first commands: `validate`, `index`, `adjacency`, `import`, `simplify`, `generate`
- `import` emits a deterministic `manifest.geometryHash` in the returned dataset.
