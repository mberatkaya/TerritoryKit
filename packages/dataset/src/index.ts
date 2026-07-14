export { createTerritoryDatasetFromGeoJson, loadTerritoryDatasetFromGeoJson } from "./geojson.js";
export {
  computeGeometryBBox,
  computeGeometryCenter,
  geometryToPolygons,
  hasRingSelfIntersection
} from "./geometry.js";
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
  TerritoryGlobalIdParts,
  TerritoryGlobalValidationIssue,
  TerritoryGlobalValidationResult
} from "./global.js";
