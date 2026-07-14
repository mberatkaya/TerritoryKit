import type {
  GeometryQualityReport,
  TerritoryAdminLevel,
  TerritoryAdjacencyArtifact,
  TerritoryDataset,
  TerritoryGeometry,
  TerritorySemanticAdminType,
  TerritoryZone
} from "@territory-kit/dataset";

export type TerritoryIdentityStability =
  "official-code" | "source-stable-code" | "source-id" | "name-parent-fallback";

export interface TerritoryIdentityStrategyConfig {
  officialCodeProperties: readonly string[];
  sourceStableCodeProperties: readonly string[];
  sourceIdProperties: readonly string[];
}

export interface TerritoryHierarchyStrategyConfig {
  parentIdProperties: readonly string[];
  parentCodeProperties: readonly string[];
  spatialContainmentTolerance: number;
}

export interface TerritoryCountryQualityPolicy {
  rejectGeometryErrors: boolean;
  rejectUnresolvedParents: boolean;
  rejectAmbiguousParents: boolean;
  maximumFallbackIdentityRatio?: number;
  maximumGeometryWarningCount?: number;
  maximumSiblingOverlapCount?: number;
}

export interface TerritoryCountryAdjacencyPolicy {
  levels: readonly TerritoryAdminLevel[];
  includePointTouches: boolean;
  minimumSharedBoundaryMeters: number;
  overridesPath?: string;
}

export interface TerritoryCountryLicensePolicy {
  allowedReleaseTypes: readonly string[];
  requireAttribution: boolean;
  rejectUnknownLicense: boolean;
  allowNonRedistributableSource: boolean;
}

export interface TerritoryCountryLevelConfig {
  adminLevel: TerritoryAdminLevel;
  expectedLocalTypes: readonly string[];
  semanticType: TerritorySemanticAdminType;
  label?: string;
  sourceNameProperty?: string;
  sourceIdProperty?: string;
  sourceCodeProperties?: readonly string[];
  sourceParentProperties?: readonly string[];
  required: boolean;
  reviewRequired?: boolean;
}

export interface TerritoryCountryDatasetConfig {
  datasetId: string;
  countryCodeAlpha2: string;
  countryCodeAlpha3: string;
  displayName: string;
  defaultLocale?: string;
  sourceProvider: string;
  defaultReleaseType?: string;
  loaderPackageName: string;
  requestedLevels: readonly TerritoryAdminLevel[];
  levelMappings: Partial<Record<TerritoryAdminLevel, TerritoryCountryLevelConfig>>;
  localeNames?: Record<string, string>;
  notes?: string[];
  reviewRequired?: boolean;
  identityStrategy: TerritoryIdentityStrategyConfig;
  hierarchyStrategy: TerritoryHierarchyStrategyConfig;
  qualityPolicy: TerritoryCountryQualityPolicy;
  adjacencyPolicy: TerritoryCountryAdjacencyPolicy;
  licensePolicy: TerritoryCountryLicensePolicy;
}

export interface TerritoryResolvedBoundarySource {
  provider: string;
  releaseType?: string;
  countryCodeAlpha2: string;
  countryCodeAlpha3: string;
  adminLevel: TerritoryAdminLevel;
  boundaryId?: string;
  boundaryName?: string;
  boundaryYearRepresented?: string;
  sourceVersion?: string;
  sourceUrl: string;
  metadataUrl?: string;
  sourceLicense?: string;
  licenseDetail?: string;
  attribution: string;
  sourceDate?: string;
  buildDate?: string;
  expectedSha256?: string;
  sizeBytes?: number;
}

export interface TerritoryCountrySourceLockLevel {
  adminLevel: TerritoryAdminLevel;
  status: "available" | "unavailable";
  boundaryId?: string;
  boundaryName?: string;
  boundaryYearRepresented?: string;
  sourceUrl?: string;
  sourcePath?: string;
  metadataUrl?: string;
  sourceVersion?: string;
  sourceDate?: string;
  license?: string;
  licenseDetail?: string;
  attribution?: string;
  sha256?: string;
  sizeBytes?: number;
  unavailableReason?: string;
}

export interface TerritoryCountrySourceLock {
  lockVersion: "1";
  country: {
    alpha2: string;
    alpha3: string;
  };
  provider: string;
  releaseType?: string;
  resolvedAt: string;
  createdBy: {
    package: string;
    version: string;
  };
  levels: Partial<Record<TerritoryAdminLevel, TerritoryCountrySourceLockLevel>>;
  contentHash: string;
}

export interface TerritorySourceLockCreateOptions {
  country: string;
  levels: readonly TerritoryAdminLevel[];
  releaseType?: string;
  outputPath?: string;
  metadataPath?: string;
  metadataUrl?: string;
  buildDate?: string;
  cacheDir?: string;
  noCache?: boolean;
  refresh?: boolean;
  force?: boolean;
  cwd?: string;
}

export interface TerritoryCountryBuildIssue {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  level?: TerritoryAdminLevel;
  zoneId?: string;
  details?: Record<string, unknown>;
}

export interface TerritoryIdentityMapEntry {
  territoryId: string;
  adminLevel: TerritoryAdminLevel;
  parentId?: string;
  sourceId?: string;
  officialCodes: Record<string, string>;
  names: Record<string, string>;
  stability: TerritoryIdentityStability;
  sourceDatasetVersion?: string;
}

export interface TerritoryIdentityMap {
  identityVersion: "1";
  entries: TerritoryIdentityMapEntry[];
}

export interface TerritoryIdentityAmbiguity {
  previousTerritoryId: string;
  candidateTerritoryIds: string[];
}

export interface TerritoryIdentityDiff {
  unchanged: string[];
  added: string[];
  removed: string[];
  sourceIdChanged: string[];
  nameChanged: string[];
  parentChanged: string[];
  ambiguousMatches: TerritoryIdentityAmbiguity[];
}

export interface TerritoryHierarchyIssue {
  code: string;
  severity: "warning" | "error";
  message: string;
}

export interface TerritoryHierarchyResolution {
  childId: string;
  parentId?: string;
  method:
    "explicit-source-parent" | "official-code" | "spatial-containment" | "unresolved" | "ambiguous";
  confidence?: number;
  candidateParentIds?: string[];
  issues: TerritoryHierarchyIssue[];
}

export interface TerritoryHierarchyReport {
  hierarchyVersion: "1";
  resolutions: TerritoryHierarchyResolution[];
  summary: {
    explicitParentCount: number;
    officialCodeParentCount: number;
    spatialParentCount: number;
    unresolvedCount: number;
    ambiguousCount: number;
    containmentFailureCount: number;
  };
}

export interface TerritoryCountryQualityReport {
  qualityVersion: "1";
  levels: Partial<Record<TerritoryAdminLevel, GeometryQualityReport>>;
  combined?: GeometryQualityReport;
}

export interface TerritoryCountryBuildStatistics {
  countryCode: string;
  requestedLevels: TerritoryAdminLevel[];
  builtLevels: TerritoryAdminLevel[];
  unavailableLevels: TerritoryAdminLevel[];
  sourceArtifactCount: number;
  sourceBytes: number;
  featureCountByLevel: Record<string, number>;
  polygonCount: number;
  multiPolygonCount: number;
  coordinateCount: number;
  officialCodeIdentityCount: number;
  sourceIdentityCount: number;
  fallbackIdentityCount: number;
  explicitParentCount: number;
  spatialParentCount: number;
  unresolvedParentCount: number;
  ambiguousParentCount: number;
  geometryErrorCount: number;
  geometryWarningCount: number;
  adjacencyEdgeCountByLevel: Record<string, number>;
  artifactBytes: number;
  publishReady: boolean;
}

export interface TerritoryCountryBuildReport {
  reportVersion: "1";
  statistics: TerritoryCountryBuildStatistics;
  issues: TerritoryCountryBuildIssue[];
}

export interface TerritoryCountryDatasetManifest {
  manifestVersion: "1";
  datasetId: string;
  datasetVersion: string;
  schemaVersion: string;
  country: {
    alpha2: string;
    alpha3: string;
    name: string;
  };
  sourceProvider: string;
  releaseType?: string;
  sourceVersion?: string;
  sourceLockHash: string;
  supportedLevels: TerritoryAdminLevel[];
  unavailableLevels: TerritoryAdminLevel[];
  featureCountByLevel: Record<string, number>;
  identityStabilitySummary: Record<TerritoryIdentityStability, number>;
  hierarchySummary: TerritoryHierarchyReport["summary"];
  geometryQualitySummary: {
    errorCount: number;
    warningCount: number;
  };
  adjacencySummary: Record<string, { edgeCount: number }>;
  license: string;
  attribution: string;
  sourceDates: Record<string, string>;
  buildDate: string;
  boundaryPolicy: string;
  worldview: string;
  disputedAreaPolicy: string;
  artifacts: Record<string, string>;
  artifactChecksums: Record<string, string>;
  publishReady: boolean;
  publishReadyFailures: string[];
}

export interface TerritoryCountryBuildResult {
  manifest: TerritoryCountryDatasetManifest;
  levelDatasets: Partial<Record<TerritoryAdminLevel, TerritoryDataset>>;
  combinedDataset?: TerritoryDataset;
  identityMap: TerritoryIdentityMap;
  sourceLock: TerritoryCountrySourceLock;
  qualityReport: TerritoryCountryQualityReport;
  hierarchyReport: TerritoryHierarchyReport;
  adjacencyArtifacts: Partial<Record<TerritoryAdminLevel, TerritoryAdjacencyArtifact>>;
  buildReport: TerritoryCountryBuildReport;
  issues: TerritoryCountryBuildIssue[];
  files: Map<string, string>;
  outputPath?: string;
}

export interface TerritoryCountryBuildOptions {
  country: string;
  sourceLock: TerritoryCountrySourceLock;
  levels?: readonly TerritoryAdminLevel[];
  outputPath?: string;
  buildAdjacency?: boolean;
  strict?: boolean;
  allowNonPublishReady?: boolean;
  buildDate?: string;
  batchSize?: number;
  cacheDir?: string;
  noCache?: boolean;
  refresh?: boolean;
  reportPath?: string;
  force?: boolean;
  cwd?: string;
}

export interface TerritoryCountryValidateResult {
  ok: boolean;
  manifest?: TerritoryCountryDatasetManifest;
  issues: TerritoryCountryBuildIssue[];
}

export interface TerritoryCountryInspectSummary {
  country: string;
  datasetId: string;
  levels: TerritoryAdminLevel[];
  features: Record<string, number>;
  identity: Record<string, number>;
  hierarchy: TerritoryHierarchyReport["summary"];
  quality: {
    errors: number;
    warnings: number;
  };
  adjacency: Record<string, number>;
  publishReady: boolean;
}

export interface ParsedCountryFeature {
  sourceId?: string;
  officialCode?: string;
  stableCode?: string;
  parentSourceId?: string;
  name: string;
  localType: string;
  geometry: TerritoryGeometry;
  rawProperties: Record<string, unknown>;
  rawFeatureId?: string;
}

export interface BuiltCountryZone {
  zone: TerritoryZone;
  identity: TerritoryIdentityMapEntry;
  sourceParentId?: string;
  sourceId?: string;
  officialCode?: string;
}
