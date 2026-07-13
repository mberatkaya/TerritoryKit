export { createTerritoryDatasetFromGeoJson, loadTerritoryDatasetFromGeoJson } from "./geojson.js";
export {
  computeGeometryBBox,
  computeGeometryCenter,
  geometryToPolygons,
  hasRingSelfIntersection
} from "./geometry.js";
export { TerritoryDatasetValidationError } from "./errors.js";
export { TERRITORY_SCHEMA_VERSION, territoryDatasetJsonSchema } from "./schema.js";
export {
  assertValidTerritoryDataset,
  loadTerritoryDataset,
  validateTerritoryDataset
} from "./validation.js";
export type {
  LngLat,
  TerritoryBBox,
  TerritoryDataset,
  TerritoryDatasetCompatibility,
  TerritoryDatasetManifest,
  TerritoryGeoJsonImportOptions,
  TerritoryGeometry,
  TerritorySchemaVersion,
  TerritoryValidationCode,
  TerritoryValidationIssue,
  TerritoryValidationResult,
  TerritoryValidationSeverity,
  TerritoryZone
} from "./types.js";
