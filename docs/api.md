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
- `classifyTerritoryGeometryRelation(left, right, options)` classifies exact polygon relations.
- `computeSharedBoundaryMeters(left, right, options)` measures shared boundary length.
- `validateTerritoryAdjacencyArtifact(dataset, artifact)` validates adjacency artifact integrity.
- `createTerritoryAdjacencyIndex(artifact)` creates typed neighbor and relation queries.
- `TerritoryError`, `TerritoryErrorCode`, `serializeTerritoryError`,
  `deserializeTerritoryError`, and `isTerritoryError` provide the shared coded error model.

## `@territory-kit/core`

- `createTerritoryEngine({ dataset, adjacency, levelStrategy, spatialIndex })`
- `engine.findTerritoryAtPoint({ lat, lng }, { level, levels, boundaryMode })`
- `engine.findTerritoriesAtPoint({ lat, lng }, { level, levels, boundaryMode })`
- `engine.findTerritoriesInBounds({ west, south, east, north }, { level, levels, limit })`
- `engine.findTerritoriesAlongRoute(route, { level, levels, mode })` returns exact or sampled
  route-to-territory results with unique territories and ordered traversal segments.
- `engine.queryTerritoriesInViewport({ bounds, zoom, level, levels, limit, cursor })` returns a
  production viewport page with `hasMore`, `nextCursor`, `totalEstimate`, and dateline split
  metadata.
- `engine.getById(territoryId)`
- `engine.getIdentity(territoryId)`
- `engine.getDatasetVersionInfo()`
- `engine.getGeometry(territoryId)`
- `engine.getMetrics(territoryId)`
- `engine.getHierarchy(territoryId)`
- `engine.getParent(territoryId)`
- `engine.getChildren(territoryId)`
- `engine.getAdjacentTerritories(territoryId)`
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
- `engine.zoneNeighbors(zoneId, { types })`
- `engine.getAdjacencyConnections(zoneId, { connectionTypes })`
- `engine.getAdjacencyRelations(zoneId, { types })`
- `engine.getZonesInBounds({ west, south, east, north, level })`
- `engine.getVisibleZones({ bounds, zoom })`
- `engine.getViewportCacheKey({ bounds, zoom, level })`
- `engine.getLevelTransition({ bounds, fromZoom, toZoom })`
- `engine.getSpatialIndexSummary()` reports `flatbush` or `binary` index usage.
- `engine.polygonToZones(geometry, { level })`
- `createTerritoryIdentity(dataset, zone)`,
  `createTerritoryDatasetVersionInfo(dataset)`,
  `createTerritoryGeometryVersion(geometry)`,
  `computeLngLatDistanceM(left, right)`,
  `computeLineStringBounds(route)`,
  `intersectLineStringWithGeometry(route, geometry, boundaryMode)`,
  `computeTerritoryAreaM2(geometry)`, and
  `computeTerritoryRepresentativePoint(geometry)` expose production identity, version, and geometry
  metric helpers.
- `encodeTerritoryBinarySpatialIndex(dataset)`,
  `decodeTerritoryBinarySpatialIndex(buffer, expected)`,
  `inspectTerritoryBinarySpatialIndex(buffer)`, and
  `validateTerritoryBinarySpatialIndex(buffer, expected)` expose the versioned `.tksi` contract.
- `defaultZoomLevelStrategy` and `zoomToDefaultLevel(zoom)` expose the default zoom mapping.
- `TerritoryZoneNotFoundError` is thrown by programmer-error APIs when a zone id is missing.
- Registry re-exports from the core root are deprecated. Import registry APIs from
  `@territory-kit/registry` or use `@territory-kit/core/legacy-registry` for compatibility-only
  migration work.

## `@territory-kit/adapter-core`

- `TerritoryRendererAdapter<TTarget>` defines attach/detach/source/state/theme methods and optional
  `managedSourceId` source ownership.
- `TerritoryAdapterOperationContext` carries `requestId`, `revision`, and optional `AbortSignal`
  into renderer source operations.
- `defineTerritoryAdapterCapabilities`, `hasTerritoryAdapterCapability`, and
  `assertTerritoryAdapterCapability` model immutable renderer capabilities.
- `createTerritoryAdapterLifecycle` and `assertTerritoryAdapterAttached` provide shared lifecycle
  guards.
- `territoryZonesToFeatureCollection(zones, options)` supports stable feature IDs, minimal or full
  properties, optional `datasetVersion`/`geometryVersion`, and conservative per-ring simplification
  for small GeoJSON payloads.

## `@territory-kit/runtime`

- `createTerritoryRuntime(options)` creates an isolated viewport orchestration runtime.
- `setViewport({ bounds, zoom, level, metadata }, options)` validates bounds, debounces when
  configured, resolves a dataset, creates/reuses an engine, uses the runtime cache, queries visible
  zones, and updates an attached capable adapter.
- `refresh(options)` reruns the active viewport with `force: true`.
- `cancelActiveRequest(reason)` aborts scheduled or active work and reports a normal
  `REQUEST_ABORTED` lifecycle result. Cancellation restores the previous committed viewport when
  one exists, otherwise the runtime returns to `idle`.
- `getState()` returns immutable snapshots with status, revision, event sequence, active request
  metadata, last result/error, and cache summary.
- `subscribe`, `unsubscribe`, and `dispose` provide deterministic lifecycle events with
  `occurredAt` sourced from the injected runtime clock.
- `adapterSourceId` overrides adapter source binding; otherwise runtime uses
  `adapter.managedSourceId` for attached adapter updates.
- `cacheOwnership: "runtime" | "external"` controls injected cache disposal. Injected caches are
  external by default; runtime-created caches are runtime-owned.
- `createTerritoryCatalog`, `registerDataset`, `unregisterDataset`, `resolveViewport`,
  `resolveTerritory`, `getCoverage`, and `createResolutionPlan` provide multi-dataset catalog
  resolution with strict registration invariants, disjoint shard selection, priority variants, and
  optional `selectionGroup` handling.
- `zoneIdCollisionPolicy: "error" | "namespace"` controls catalog result ID collisions. The
  default rejects duplicate IDs; namespace mode emits `<entryId>::<sourceZoneId>`.
- `createTerritoryEnginePool({ maxActiveEngines })` provides per-dataset engine reuse, LRU
  eviction, pinned entries, memory estimates, concurrent creation dedupe, custom-key signature
  checks, and disposal.
- `createTerritoryWorkerClient(workerTransport)` provides `initialize`, `query`, `cancel`, and
  `dispose` message handling with response correlation and abort-aware initialize/query support.
- `createMemoryTerritoryRuntimeCache({ maxEntries, maxBytes })` creates an async LRU cache with
  byte tracking, hit/miss/eviction stats, and default `Uint8Array` copy-on-read/write protection.
  `maxEntries` and `maxBytes` must be finite non-negative integers.

## `@territory-kit/game`

- `createGameEngine({ territory, repository, context, ruleConfig, rules })` creates a
  renderer-independent game domain engine on top of a core territory source.
- `execute(command)` supports `claim-territory`, `capture-territory`, `set-territory-owner`,
  `start-contest`, and `adjust-territory-score` commands.
- `expectedVersion` is the snapshot-level optimistic concurrency token.
- `idempotencyKey` returns the original successful result for safe command retries.
- `createInMemoryGameRepository()` provides a clone-on-read/write repository for tests and demos.
- `serializeGameSnapshot(snapshot)` and `deserializeGameSnapshot(json)` handle snapshot restore.
- `migrateGameSnapshotTerritories(snapshot, migrationPlan)` applies
  `TerritoryDatasetMigrationPlan` mappings from `@territory-kit/dataset`.
- `ActionRule` plugins run deterministically by `priority` and `id`.

## `@territory-kit/maplibre`

- `zonesToFeatureCollection(zones, stateByZoneIdOrOptions)`
- `createTerritoryMapLibreLayers(zones, options)` supports initial `stateByZoneId`.
- GeoJSON options include `propertyMode: "minimal"`, `datasetVersion`, `includeGeometryVersion`,
  and `simplifyTolerance`; `feature.id` and source `promoteId` remain stable for feature-state.
- `createTerritoryMapLibreAdapter({ zones, onZoneClick, onZoneHover })`
- Adapter lifecycle: `attach`, `detach`, `setSource`, `updateState`, `updateData`, `updateTheme`
- Adapter conformance: `capabilities`, `lifecycleState`, and `managedSourceId`
- `setSource` replaces the configured existing GeoJSON source data and throws coded errors for
  missing, mismatched, invalid, or unsupported sources.

## `@territory-kit/nestjs`

- `TerritoryKitModule.forRoot({ dataset, repository })`
- `TerritoryKitController` exposes `GET /territories`, `POST /territories/locate`, and
  `POST /territories/route`
- Controller query/body parsing rejects invalid numeric input before repository calls.
- `createPostgisTerritoryRepository(client, options)` uses `ST_Intersects`, `ST_Covers`, and
  GiST-friendly bbox prefilters.
- `repository.findAlongRoute({ route, level })` uses a LineString GeoJSON route, `ST_Intersects`,
  `ST_Intersection`, and `ST_Length` to return exact route territory metadata.
- `importTerritoryDatasetToPostgis(client, dataset, options)` batch upserts a validated dataset into
  the production PostGIS schema with `(dataset_id, dataset_version, id)` identity.
- `POSTGIS_SCHEMA_SQL`, `POSTGIS_INDEX_SQL`, and query SQL constants are exported for migration and
  snapshot testing.

## `@territory-kit/react-native`

- `createMobileTerritoryRuntime(options)`
- `installDataset({ datasetId, version, levels, purposes })` installs checksum-verified artifacts.
- `queryViewport({ datasetId, viewport })` queries visible territories from installed artifacts.
- `queryPoint({ datasetId, coordinate, level })` performs offline-capable point lookup from the
  installed polygon dataset.
- `checkDatasetStatus({ datasetId })` compares the active installed version with the registry or
  offline registry snapshot and reports `stale` / `updateAvailable`.
- `rollbackDataset({ datasetId })`, `listInstalledDatasets()`, `cleanupPartialDownloads()`,
  `setAppState()`, and `handleLowMemory()` manage mobile lifecycle and cache behavior.

## `@territory-kit/generators`

- `generateGridTerritoryDataset(options)` creates deterministic rectangular fixtures.
- `generateVoronoiTerritoryDataset(options)` creates deterministic Voronoi-style fixtures.
- `generateWeightedVoronoiTerritoryDataset(options)` accepts weighted seed points.
- `buildTerritoryAdjacency(dataset, options)` builds exact polygon adjacency artifacts.
- `buildTerritoryAdjacencyPath(inputPath, options)` reads a dataset file or directory and writes
  `adjacency.json`, `build-report.json`, and `checksums.json`.
- `inferBBoxAdjacency(zones, options)` remains a bounding-box development helper.

## `@territory-kit/cli`

- JSON-first commands: `validate`, `index`, `adjacency build`, `adjacency validate`,
- JSON-first commands: `validate`, `index`, `index build`, `index inspect`, `index validate`,
  `adjacency build`, `adjacency validate`, `adjacency inspect`, `import`, `simplify`, `generate`
- `import` emits a deterministic `manifest.geometryHash` in the returned dataset.
