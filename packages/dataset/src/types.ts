import type { MultiPolygon, Polygon } from "geojson";

export type TerritorySchemaVersion = "territory-schema@1";

export type TerritoryAdminLevel = "ADM0" | "ADM1" | "ADM2" | "ADM3" | "ADM4";

export type TerritoryGeometryDetailLevel = "low" | "medium" | "high" | "source";

export type TerritorySemanticAdminType =
  | "world"
  | "country"
  | "state"
  | "province"
  | "region"
  | "governorate"
  | "prefecture"
  | "county"
  | "district"
  | "city"
  | "municipality"
  | "borough"
  | "ward"
  | "neighbourhood"
  | "village"
  | "local"
  | "game-region"
  | "unknown";

export type LngLat = [longitude: number, latitude: number];

export type TerritoryBBox = [west: number, south: number, east: number, north: number];

export type TerritoryGeometry = Polygon | MultiPolygon;

export interface TerritoryDatasetManifest {
  datasetId: string;
  datasetVersion: string;
  schemaVersion: TerritorySchemaVersion;
  sourceDate: string;
  geometryHash: string;
  adminLevels?: TerritoryAdminLevel[];
  artifactChecksum?: string;
  attribution?: string;
  boundaryPolicy?: string;
  buildDate?: string;
  compatibility?: TerritoryDatasetCompatibility;
  countryCodes?: string[];
  crs?: string;
  disputedAreaPolicy?: string;
  geometryDetail?: TerritoryGeometryDetailLevel;
  license?: string;
  name?: string;
  description?: string;
  sourceProvider?: string;
  worldview?: string;
}

export interface TerritoryGlobalDatasetManifest extends TerritoryDatasetManifest {
  adminLevels: TerritoryAdminLevel[];
  artifactChecksum: string;
  attribution: string;
  boundaryPolicy: string;
  buildDate: string;
  countryCodes: string[];
  crs: string;
  disputedAreaPolicy: string;
  geometryDetail: TerritoryGeometryDetailLevel;
  license: string;
  sourceProvider: string;
  worldview: string;
}

export interface TerritoryDatasetCompatibility {
  minCoreVersion?: string;
  maxCoreVersion?: string;
  notes?: string[];
}

export interface TerritoryZone {
  id: string;
  datasetId: string;
  countryCode?: string;
  level: number;
  sourceAdminLevel?: string;
  semanticType?: TerritorySemanticAdminType;
  name?: string;
  localName?: string;
  parentId?: string;
  childIds?: string[];
  neighborIds: string[];
  geometry: TerritoryGeometry;
  center: LngLat;
  bbox: TerritoryBBox;
  properties: Record<string, unknown>;
}

export interface TerritoryDataset {
  manifest: TerritoryDatasetManifest;
  zones: TerritoryZone[];
}

export interface TerritoryCodes {
  iso3166_1?: string;
  iso3166_2?: string;
  official?: string;
  source?: string;
}

export interface TerritoryNames {
  default: string;
  [locale: string]: string;
}

export interface TerritorySourceMetadata {
  provider: string;
  sourceId?: string;
  sourceUrl?: string;
  sourceDate?: string;
  importedAt?: string;
  license?: string;
  attribution?: string;
}

export interface TerritoryGlobalMetadata {
  adminLevel?: TerritoryAdminLevel;
  localType?: string;
  codes?: TerritoryCodes;
  names?: TerritoryNames;
  source?: TerritorySourceMetadata;
}

export type TerritoryValidationSeverity = "error" | "warning";

export type TerritoryValidationCode =
  | "DATASET_SHAPE"
  | "FEATURE_COLLECTION_SHAPE"
  | "FEATURE_ID"
  | "DUPLICATE_FEATURE_ID"
  | "MANIFEST_FIELD"
  | "ZONE_FIELD"
  | "DUPLICATE_ZONE_ID"
  | "DATASET_ID_MISMATCH"
  | "GEOMETRY_TYPE"
  | "GEOMETRY_COORDINATES"
  | "GEOMETRY_RING"
  | "SELF_INTERSECTION"
  | "BBOX_FIELD"
  | "CENTER_FIELD"
  | "BBOX_MISMATCH"
  | "CENTER_OUT_OF_BOUNDS"
  | "PARENT_MISSING"
  | "PARENT_LEVEL"
  | "CHILD_MISSING"
  | "CHILD_PARENT_MISMATCH"
  | "NEIGHBOR_MISSING"
  | "NEIGHBOR_NOT_RECIPROCAL"
  | "HIERARCHY_CYCLE"
  | "COORDINATE_RANGE";

export interface TerritoryValidationIssue {
  code: TerritoryValidationCode;
  message: string;
  path: string;
  severity: TerritoryValidationSeverity;
  zoneId?: string;
  featureId?: string;
  sourcePath?: string;
  line?: number;
  column?: number;
  repairSuggestion?: string;
}

export interface TerritoryValidationResult {
  ok: boolean;
  issues: TerritoryValidationIssue[];
  dataset?: TerritoryDataset;
}

export interface TerritoryGeoJsonImportOptions {
  manifest: TerritoryDatasetManifest;
  idProperty?: string;
  levelProperty?: string;
  parentIdProperty?: string;
  childIdsProperty?: string;
  neighborIdsProperty?: string;
  sourcePath?: string;
}
