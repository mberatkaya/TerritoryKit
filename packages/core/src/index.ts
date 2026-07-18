export { createTerritoryEngine } from "./engine.js";
export { TerritoryZoneNotFoundError } from "./errors.js";
export {
  TERRITORY_BINARY_SPATIAL_INDEX_FORMAT,
  TERRITORY_BINARY_SPATIAL_INDEX_MAGIC,
  TERRITORY_BINARY_SPATIAL_INDEX_SCHEMA_VERSION,
  createTerritoryBinarySpatialIndex,
  decodeTerritoryBinarySpatialIndex,
  encodeTerritoryBinarySpatialIndex,
  inspectTerritoryBinarySpatialIndex,
  isTerritoryBinarySpatialIndex,
  validateTerritoryBinarySpatialIndex
} from "./binary-index.js";
export {
  createTerritoryCountryDatasetDescriptor,
  loadTerritoryCountryDataset
} from "./country-loader.js";
export { loadTerritoryQueryDataset } from "./query-loader.js";
export { defaultZoomLevelStrategy, zoomToDefaultLevel } from "./zoom.js";
/**
 * @deprecated Import registry APIs from `@territory-kit/registry` or
 * `@territory-kit/core/legacy-registry` for compatibility-only code.
 */
export { createTerritoryRegistryClient } from "./legacy-registry.js";
export type {
  TerritoryDatasetRegistry,
  TerritoryInstalledDatasetHandle,
  TerritoryInstalledDatasetSummary,
  TerritoryRegistryArtifact,
  TerritoryRegistryArtifactFormat,
  TerritoryRegistryArtifactPurpose,
  TerritoryRegistryCache,
  TerritoryRegistryClient,
  TerritoryRegistryClientOptions,
  TerritoryRegistryDataset,
  TerritoryRegistryInstallOptions,
  TerritoryRegistryResolveDeepestAvailableTerritoryArtifactOptions,
  TerritoryRegistryResolveArtifactOptions,
  TerritoryRegistryResolvedTerritoryArtifact,
  TerritoryRegistryResolveTerritoryArtifactOptions,
  TerritoryRegistryResolvedArtifact,
  TerritoryRegistryTerritoryArtifactFallback,
  TerritoryRegistryTransport
} from "./legacy-registry.js";
export type {
  TerritoryCountryDatasetDescriptor,
  TerritoryCountryDatasetHandle,
  TerritoryCountryDatasetLoadOptions,
  TerritoryDatasetArtifactResolver,
  TerritoryInstalledDatasetArtifactResolver,
  TerritoryRegistryInstallDatasetOptions,
  TerritoryRegistryLike
} from "./country-loader.js";
export type {
  TerritoryQueryDatasetHandle,
  TerritoryQueryDatasetLoadOptions
} from "./query-loader.js";
export type {
  BoundaryMode,
  BoundsQuery,
  LatLng,
  LevelTransitionPayload,
  LevelTransitionQuery,
  LocateOptions,
  NeighborOptions,
  PolygonToZonesMode,
  PolygonToZonesOptions,
  TerritoryAdjacencyConnection,
  TerritoryAdjacencyConnectionType,
  TerritoryBounds,
  TerritoryEngineSpatialIndexSummary,
  TerritoryEngine,
  TerritoryEngineDebugOptions,
  TerritoryEngineOptions,
  ViewportCacheKeyQuery,
  VisibleZonesQuery,
  ZoomLevelStrategy
} from "./types.js";
export type {
  TerritoryBinarySpatialIndex,
  TerritoryBinarySpatialIndexBBoxRecord,
  TerritoryBinarySpatialIndexBuffer,
  TerritoryBinarySpatialIndexByteOrder,
  TerritoryBinarySpatialIndexLevelRecord,
  TerritoryBinarySpatialIndexMetadata,
  TerritoryBinarySpatialIndexValidationIssue,
  TerritoryBinarySpatialIndexValidationOptions,
  TerritoryBinarySpatialIndexValidationResult
} from "./binary-index.js";
