import type { MultiPolygon, Polygon } from "geojson";

export type TerritorySchemaVersion = "territory-schema@1";

export type LngLat = [longitude: number, latitude: number];

export type TerritoryBBox = [west: number, south: number, east: number, north: number];

export type TerritoryGeometry = Polygon | MultiPolygon;

export interface TerritoryDatasetManifest {
  datasetId: string;
  datasetVersion: string;
  schemaVersion: TerritorySchemaVersion;
  sourceDate: string;
  geometryHash: string;
  compatibility?: TerritoryDatasetCompatibility;
  license?: string;
  name?: string;
  description?: string;
}

export interface TerritoryDatasetCompatibility {
  minCoreVersion?: string;
  maxCoreVersion?: string;
  notes?: string[];
}

export interface TerritoryZone {
  id: string;
  datasetId: string;
  level: number;
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
  | "PARENT_MISSING"
  | "PARENT_LEVEL"
  | "CHILD_MISSING"
  | "CHILD_PARENT_MISMATCH"
  | "NEIGHBOR_MISSING"
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
