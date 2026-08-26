import type { MultiPolygon, Polygon } from "geojson";

export type TerritorySchemaVersion = "territory-schema@1";

export type TerritoryAdminLevel = "ADM0" | "ADM1" | "ADM2" | "ADM3" | "ADM4" | "ADM5";

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
  | "subdistrict"
  | "city"
  | "municipality"
  | "borough"
  | "commune"
  | "ward"
  | "neighbourhood"
  | "village"
  | "locality"
  | "local"
  | "special-administrative-area"
  | "administrative-unit"
  | "generated-zone"
  | "game-region"
  | "unknown";

export type TerritorySemanticReviewStatus =
  "reviewed" | "review-required" | "mapping-review-required" | "not-applicable";

export type TerritoryCoverageStatus =
  | "verified"
  | "generated"
  | "generated-with-warnings"
  | "partial"
  | "source-unavailable"
  | "licence-restricted"
  | "semantic-review-required"
  | "deprecated";

export type TerritorySourceClass = "official" | "osm" | "generated";

export type TerritoryBoundaryKind = "administrative" | "estimated";

export type TerritoryBoundarySourceClass =
  | "official-national"
  | "official-local"
  | "osm-administrative"
  | "smart-derived"
  | "synthetic-test";

export type TerritoryBoundaryConfidence = "authoritative" | "high" | "medium" | "low";

export type TerritoryLicenseState = "approved" | "pending" | "restricted" | "unknown";

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
  sourceClass?: TerritorySourceClass;
  boundarySourceClass?: TerritoryBoundarySourceClass;
  providerId?: string;
  providerName?: string;
  sourceDatasetId?: string;
  sourceId?: string;
  sourceNativeId?: string;
  sourceUrl?: string;
  sourceDate?: string;
  sourceVersion?: string;
  sourceSnapshotId?: string;
  sourceSnapshotChecksum?: string;
  importedAt?: string;
  licenseState?: TerritoryLicenseState;
  license?: string;
  attribution?: string;
}

export interface TerritoryGeneratedZoneMetadata {
  algorithm?: string;
  algorithmVersion: string;
  seed?: string;
  generationSeed?: string;
  localKey?: string;
  targetAreaKm2?: number;
  minAreaKm2?: number;
  maxAreaKm2?: number;
  maxZonesPerDistrict?: number;
  minFragmentAreaKm2?: number;
}

export interface TerritoryGlobalMetadata {
  adminLevel?: TerritoryAdminLevel;
  sourceAdminLevel?: TerritoryAdminLevel;
  semanticType?: TerritorySemanticAdminType;
  localType?: string;
  localTypeName?: string;
  hierarchyDepth?: number;
  parentId?: string;
  sourceParentId?: string;
  countryCode?: string;
  provinceCode?: string;
  districtCode?: string;
  sourceClass?: TerritorySourceClass;
  boundaryKind?: TerritoryBoundaryKind;
  boundarySourceClass?: TerritoryBoundarySourceClass;
  confidence?: TerritoryBoundaryConfidence;
  administrative?: boolean;
  providerId?: string;
  providerName?: string;
  sourceProvider?: string;
  sourceId?: string;
  sourceDatasetId?: string;
  sourceNativeId?: string;
  sourceDate?: string;
  sourceVersion?: string;
  sourceUrl?: string;
  sourceSnapshotId?: string;
  sourceSnapshotChecksum?: string;
  licenseState?: TerritoryLicenseState;
  license?: string;
  attribution?: string;
  official?: boolean;
  generated?: boolean;
  algorithmVersion?: string;
  generationSeed?: string;
  stableId?: string;
  geometryVersion?: string;
  geometryHash?: string;
  originalGeometryHash?: string;
  effectiveGeometryHash?: string;
  revision?: string;
  areaM2?: number;
  representativePoint?: LngLat;
  semanticReviewStatus?: TerritorySemanticReviewStatus;
  coverageStatus?: TerritoryCoverageStatus;
  codes?: TerritoryCodes;
  names?: TerritoryNames;
  source?: TerritorySourceMetadata;
  generatedZone?: TerritoryGeneratedZoneMetadata;
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
  | "COORDINATE_RANGE"
  | "INVALID_SOURCE_CLASS"
  | "SOURCE_FLAG_CONFLICT"
  | "MISSING_GENERATOR_VERSION"
  | "INVALID_GENERATED_SEMANTIC_TYPE"
  | "MISSING_SOURCE_PROVENANCE"
  | "INVALID_BOUNDARY_METADATA"
  | "MISSING_BOUNDARY_PROVENANCE"
  | "LICENSE_GATE_FAILED"
  | "SYNTHETIC_SOURCE_NOT_PUBLISHABLE"
  | "INVALID_PARENT_LEVEL"
  | "ADM3_ORPHAN"
  | "HIERARCHY_CODE_MISMATCH"
  | "DUPLICATE_STABLE_ID"
  | "INVALID_COVERAGE_STATUS"
  | "INVALID_SEMANTIC_REVIEW_STATUS";

export interface TerritoryValidationIssue {
  code: TerritoryValidationCode;
  message: string;
  path: string;
  severity: TerritoryValidationSeverity;
  datasetId?: string;
  zoneId?: string;
  parentId?: string;
  featureId?: string;
  field?: string;
  expected?: unknown;
  actual?: unknown;
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
