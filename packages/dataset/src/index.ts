export { createTerritoryDatasetFromGeoJson, loadTerritoryDatasetFromGeoJson } from "./geojson.js";
export {
  computeGeometryBBox,
  computeGeometryCenter,
  geometryToPolygons,
  hasRingSelfIntersection
} from "./geometry.js";
export {
  applyTerritoryAdjacencyOverrides,
  canonicalTerritoryAdjacencyPair,
  classifyTerritoryGeometryRelation,
  compareTerritoryAdjacencyEdges,
  computeSharedBoundaryMeters,
  computeTerritoryAdjacencyContentHash,
  createTerritoryAdjacencyIndex,
  createTerritoryAdjacencyTolerance,
  getTerritoryBoundarySegments,
  normalizeTerritoryAdjacencyEdge,
  normalizeTerritoryAdjacencyEdges,
  validateTerritoryAdjacencyArtifact
} from "./adjacency.js";
export {
  BASIC_GEOMETRY_QUALITY_CHECKS,
  FULL_GEOMETRY_QUALITY_CHECKS,
  hashTerritoryGeometry,
  normalizeGeometryQualityChecks,
  repairGeometryDataset,
  typescriptGeometryQualityBackend,
  validateGeometryDataset
} from "./quality.js";
export { TerritoryDatasetValidationError } from "./errors.js";
export {
  TERRITORY_ADMIN_LEVELS,
  TERRITORY_GEOMETRY_DETAIL_LEVELS,
  createTerritoryGlobalId,
  normalizeTerritoryAdminLevel,
  normalizeTerritoryCountryCode,
  slugifyTerritoryIdPart,
  validateGlobalDatasetManifest,
  validateTerritoryGlobalId,
  validateTerritoryGlobalMetadata
} from "./global.js";
export { TERRITORY_SCHEMA_VERSION, territoryDatasetJsonSchema } from "./schema.js";
export {
  assertValidTerritoryDataset,
  loadTerritoryDataset,
  validateTerritoryDataset
} from "./validation.js";
export {
  DEFAULT_TERRITORY_RENDER_LEVEL_POLICY,
  createTerritoryQueryArtifact,
  createTerritoryRenderArtifactManifest,
  createTerritoryRenderFeatureCollection,
  normalizeRenderPolicies,
  validateTerritoryQueryRenderCompatibility,
  zoneToAdminLevel
} from "./artifacts.js";
export type {
  TerritoryAdjacencyArtifact,
  TerritoryAdjacencyBuildOptions,
  TerritoryAdjacencyBuildStatistics,
  TerritoryAdjacencyEdge,
  TerritoryAdjacencyIndex,
  TerritoryAdjacencyOverrides,
  TerritoryAdjacencyPair,
  TerritoryAdjacencyProgress,
  TerritoryAdjacencyQueryOptions,
  TerritoryAdjacencySource,
  TerritoryAdjacencyTolerance,
  TerritoryAdjacencyType,
  TerritoryAdjacencyValidationCode,
  TerritoryAdjacencyValidationIssue,
  TerritoryAdjacencyValidationReport,
  TerritoryAdjacencyValidationSeverity,
  TerritoryBoundarySegment,
  TerritoryGeometryRelation,
  TerritoryGeometryRelationOptions,
  TerritoryGeometryRelationResult,
  TerritoryManualAdjacencyAdd,
  TerritoryManualAdjacencyRemove
} from "./adjacency.js";
export type {
  TerritoryAdminLevel,
  LngLat,
  TerritoryBBox,
  TerritoryCodes,
  TerritoryDataset,
  TerritoryDatasetCompatibility,
  TerritoryDatasetManifest,
  TerritoryGeoJsonImportOptions,
  TerritoryGeometry,
  TerritoryGeometryDetailLevel,
  TerritoryGlobalDatasetManifest,
  TerritoryGlobalMetadata,
  TerritoryNames,
  TerritorySchemaVersion,
  TerritorySourceMetadata,
  TerritoryValidationCode,
  TerritoryValidationIssue,
  TerritoryValidationResult,
  TerritoryValidationSeverity,
  TerritoryZone
} from "./types.js";
export type {
  TerritoryQueryArtifact,
  TerritoryQueryRenderCompatibilityIssue,
  TerritoryQueryRenderCompatibilityResult,
  TerritoryRenderArtifactManifest,
  TerritoryRenderFeatureProperties,
  TerritoryRenderLayerManifest,
  TerritoryRenderLevelPolicy
} from "./artifacts.js";
export type {
  TerritoryGlobalIdParts,
  TerritoryGlobalValidationIssue,
  TerritoryGlobalValidationResult
} from "./global.js";
export type {
  GeometryQualityBackend,
  GeometryQualityBackendId,
  GeometryQualityCheckName,
  GeometryQualityCheckPreset,
  GeometryQualityChecks,
  GeometryQualityIssue,
  GeometryQualityIssueCode,
  GeometryQualityMode,
  GeometryQualityOptions,
  GeometryQualityPerformance,
  GeometryQualityReport,
  GeometryQualitySeverity,
  GeometryQualitySummary,
  GeometryRepairDatasetResult,
  GeometryRepairOperation,
  GeometryRepairOperationType,
  GeometryRepairOptions,
  GeometryRepairRecord,
  GeometryRepairStrategy,
  GeometryRepairSummary,
  NormalizedGeometryQualityChecks
} from "./quality.js";
