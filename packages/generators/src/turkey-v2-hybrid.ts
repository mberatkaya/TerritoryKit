import {
  TERRITORY_SCHEMA_VERSION,
  computeGeometryBBox,
  geometryToPolygons,
  validateGeometryDataset
} from "@territory-kit/dataset";
import { validateTurkeyV2Dataset } from "@territory-kit/dataset/turkey-v2";
import type {
  LngLat,
  TerritoryAdjacencyArtifact,
  TerritoryBoundaryConfidence,
  TerritoryBoundaryKind,
  TerritoryBoundarySourceClass,
  TerritoryLicenseState,
  TerritoryDataset,
  TerritoryGeometry,
  TerritorySourceClass,
  TerritoryValidationIssue,
  TerritoryZone
} from "@territory-kit/dataset";
import * as polygonClipping from "polygon-clipping";
import type {
  MultiPolygon as ClippingMultiPolygon,
  Polygon as ClippingPolygon
} from "polygon-clipping";
import { buildTerritoryAdjacency } from "./adjacency.js";
import { computeGeometryRepresentativePoint } from "./geometry-repair.js";
import {
  TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION,
  buildTurkeyGameZones
} from "./turkey-game-zones.js";
import type {
  TurkeyGameZoneBuildResult,
  TurkeyGameZoneFragmentStrategy,
  TurkeyGameZoneProfile
} from "./turkey-game-zones.js";
import {
  createDatasetGeometryHash,
  isRecord,
  serializeJsonStable,
  sha256Hex
} from "./sources/utils.js";

export const TURKEY_V2_HYBRID_COVERAGE_SCHEMA_VERSION =
  "territorykit-tr-v2-hybrid-coverage@1" as const;
export const TURKEY_V2_HYBRID_QUALITY_SCHEMA_VERSION =
  "territorykit-tr-v2-hybrid-quality@1" as const;
export const TURKEY_V2_HYBRID_PROVENANCE_SCHEMA_VERSION =
  "territorykit-tr-v2-hybrid-provenance@1" as const;
export const TURKEY_V2_HYBRID_ATTRIBUTION_SCHEMA_VERSION =
  "territorykit-tr-v2-hybrid-attribution@1" as const;
export const TURKEY_V2_HYBRID_REJECTION_SCHEMA_VERSION =
  "territorykit-tr-v2-hybrid-rejections@1" as const;
export const TURKEY_V2_HYBRID_MIGRATION_SCHEMA_VERSION =
  "territorykit-tr-v2-hybrid-migration@1" as const;
export const TURKEY_V2_HYBRID_BATCH_SCHEMA_VERSION = "territorykit-tr-v2-hybrid-batch@1" as const;

export type TurkeyV2HybridSourceClass = TerritorySourceClass;
export type TurkeyV2HybridProviderClass =
  "official" | "runtime" | "experimental" | "osm" | "generated";
export type TurkeyV2HybridIssueSeverity = "error" | "warning" | "info";
export type TurkeyV2HybridRejectionReason =
  | "outside-parent"
  | "empty-after-clipping"
  | "covered-by-higher-priority"
  | "below-minimum-effective-area"
  | "invalid-geometry"
  | "missing-parent"
  | "ambiguous-parent"
  | "missing-provenance"
  | "license-blocked"
  | "semantic-review-required"
  | "duplicate-source-identity"
  | "duplicate-geometry"
  | "source-internal-overlap"
  | "experimental-not-enabled";
export type TurkeyV2HybridMigrationChangeType =
  | "preserved"
  | "added"
  | "removed"
  | "geometry-changed"
  | "source-replaced"
  | "split"
  | "merged"
  | "parent-changed"
  | "source-class-changed";

export interface TurkeyV2HybridIssue {
  code: string;
  severity: TurkeyV2HybridIssueSeverity;
  message: string;
  zoneId?: string;
  parentId?: string;
  details?: Record<string, unknown>;
}

export interface TurkeyV2HybridGeneratedOptions {
  enabled: boolean;
  profile?: TurkeyGameZoneProfile;
  seed?: string;
  targetAreaKm2?: number;
  targetZoneCount?: number;
  minAreaKm2?: number;
  maxAreaKm2?: number;
  maxZonesPerDistrict?: number;
  minFragmentAreaKm2?: number;
  fragmentStrategy?: TurkeyGameZoneFragmentStrategy;
}

export interface TurkeyV2HybridDistrictBuildOptions {
  district: TerritoryZone;
  provinceCode: string;
  districtCode: string;
  officialZones?: readonly TerritoryZone[];
  osmZones?: readonly TerritoryZone[];
  generated?: TurkeyV2HybridGeneratedOptions;
  sourcePriority?: readonly TurkeyV2HybridSourceClass[];
  minimumEffectiveAreaKm2?: number;
  overlapToleranceKm2?: number;
  gapToleranceKm2?: number;
  parentOutsideToleranceKm2?: number;
  allowExperimental?: boolean;
  buildDate?: string;
  datasetId?: string;
  migrationBaselineZones?: readonly TerritoryZone[];
}

export interface TurkeyV2HybridDistrictBuildResult {
  district: TerritoryZone;
  candidates: {
    official: TerritoryZone[];
    osm: TerritoryZone[];
  };
  effective: {
    official: TerritoryZone[];
    osm: TerritoryZone[];
    generated: TerritoryZone[];
    zones: TerritoryZone[];
  };
  dataset: TerritoryDataset;
  coverage: TurkeyV2HybridCoverageReport;
  quality: TurkeyV2HybridQualityReport;
  provenance: TurkeyV2HybridProvenanceReport;
  attribution: TurkeyV2HybridAttributionManifest;
  licenses: TurkeyV2HybridLicenseManifest;
  distributionPolicy: TurkeyV2HybridDistributionPolicyManifest;
  rejections: TurkeyV2HybridRejectionReport;
  migration: TurkeyV2ZoneMigrationPlan;
  adjacency: TerritoryAdjacencyArtifact;
  adjacencyStatistics: Awaited<ReturnType<typeof buildTerritoryAdjacency>>["statistics"];
  generatedResult?: TurkeyGameZoneBuildResult;
  deterministicHash: string;
  issues: TurkeyV2HybridIssue[];
}

export interface TurkeyV2HybridCoverageReport {
  schemaVersion: typeof TURKEY_V2_HYBRID_COVERAGE_SCHEMA_VERSION;
  districtId: string;
  provinceCode: string;
  districtCode: string;
  districtAreaKm2: number;
  officialCandidateCount: number;
  officialEffectiveCount: number;
  officialCandidateAreaKm2: number;
  officialEffectiveAreaKm2: number;
  officialCoveragePercent: number;
  osmCandidateCount: number;
  osmEffectiveCount: number;
  osmCandidateAreaKm2: number;
  osmClippedByOfficialAreaKm2: number;
  osmEffectiveAreaKm2: number;
  osmCoveragePercent: number;
  realEffectiveAreaKm2: number;
  realCoveragePercent: number;
  missingBeforeGeneratedAreaKm2: number;
  generatedEffectiveCount: number;
  generatedEffectiveAreaKm2: number;
  generatedCoveragePercent: number;
  finalCoverageAreaKm2: number;
  finalCoveragePercent: number;
  remainingGapAreaKm2: number;
  overlapRemovedByPriorityKm2: number;
  rejectedSliverAreaKm2: number;
  sourceCounts: Record<TurkeyV2HybridSourceClass, number>;
  profile: TurkeyGameZoneProfile;
  selectedProfile?: string;
  algorithmVersion: typeof TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION;
  status: "ok" | "quality-failed" | "build-failed";
}

export interface TurkeyV2HybridQualityReport {
  schemaVersion: typeof TURKEY_V2_HYBRID_QUALITY_SCHEMA_VERSION;
  ok: boolean;
  districtId: string;
  deterministicHash: string;
  summary: {
    invalidGeometryCount: number;
    emptyGeometryCount: number;
    duplicateStableIdCount: number;
    duplicateSourceIdentityCount: number;
    duplicateGeometryCount: number;
    parentContainmentErrorCount: number;
    siblingOverlapBeforePriorityCount: number;
    siblingOverlapAfterPriorityCount: number;
    officialSourceInternalOverlapCount: number;
    osmSourceInternalOverlapCount: number;
    officialOsmOverlapRemovedKm2: number;
    realGeneratedOverlapKm2: number;
    remainingGapCount: number;
    remainingGapAreaKm2: number;
    sliverCount: number;
    sliverAreaKm2: number;
    sourceMetadataConflictCount: number;
    missingProvenanceCount: number;
    licenseAttributionMissingCount: number;
    semanticTypeConflictCount: number;
    strictTrV2ValidationErrorCount: number;
    generatedQualityErrorCount: number;
    adjacencyIntegrityErrorCount: number;
  };
  gates: {
    coverage: boolean;
    effectiveSiblingOverlap: boolean;
    realGeneratedOverlap: boolean;
    parentContainment: boolean;
    invalidGeometry: boolean;
    emptyFinalGeometry: boolean;
    duplicateStableId: boolean;
    missingRequiredProvenance: boolean;
    generatedMetadata: boolean;
    strictTrV2Validation: boolean;
    adjacencyIntegrity: boolean;
  };
  strictValidation: {
    ok: boolean;
    issues: TerritoryValidationIssue[];
  };
  issues: TurkeyV2HybridIssue[];
}

export interface TurkeyV2HybridProvenanceItem {
  zoneId: string;
  sourceClass: TurkeyV2HybridSourceClass;
  boundaryKind: TerritoryBoundaryKind;
  boundarySourceClass: TerritoryBoundarySourceClass;
  confidence: TerritoryBoundaryConfidence;
  providerClass: TurkeyV2HybridProviderClass;
  providerId: string;
  providerName: string;
  sourceDatasetId: string;
  sourceId: string;
  sourceNativeId: string;
  sourceDate: string;
  sourceVersion?: string;
  retrievedAt?: string;
  buildDate: string;
  sourceUrl?: string;
  sourceSnapshotChecksum: string;
  licenseState: TerritoryLicenseState;
  license: string;
  attribution: string;
  redistributionPolicy: string;
  commercialUsePolicy: string;
  modificationPolicy: string;
  originalGeometryHash: string;
  effectiveGeometryHash: string;
  clippedAreaKm2: number;
  removedByPriorityAreaKm2: number;
  parentId: string;
  semanticType: string;
  reviewStatus: string;
  sourceLockReference?: string;
  sourceLockChecksum?: string;
  algorithmVersion?: string;
  generatorSeedHash?: string;
  generatorConfigurationHash?: string;
  parentGeometryHash?: string;
}

export interface TurkeyV2HybridProvenanceReport {
  schemaVersion: typeof TURKEY_V2_HYBRID_PROVENANCE_SCHEMA_VERSION;
  districtId: string;
  buildDate: string;
  zones: TurkeyV2HybridProvenanceItem[];
}

export interface TurkeyV2HybridAttributionManifest {
  schemaVersion: typeof TURKEY_V2_HYBRID_ATTRIBUTION_SCHEMA_VERSION;
  districtId: string;
  buildDate: string;
  groups: Array<{
    sourceClass: TurkeyV2HybridSourceClass;
    license: string;
    attribution: string;
    providerIds: string[];
    zoneIds: string[];
    redistributionPolicies: string[];
  }>;
  text: string;
}

export interface TurkeyV2HybridLicenseManifest {
  schemaVersion: "territorykit-tr-v2-hybrid-licenses@1";
  districtId: string;
  licenses: Array<{
    sourceClass: TurkeyV2HybridSourceClass;
    license: string;
    attribution: string;
    zoneCount: number;
  }>;
}

export interface TurkeyV2HybridDistributionPolicyManifest {
  schemaVersion: "territorykit-tr-v2-hybrid-distribution-policy@1";
  districtId: string;
  policies: Array<{
    sourceClass: TurkeyV2HybridSourceClass;
    providerClass: TurkeyV2HybridProviderClass;
    license: string;
    redistributionPolicy: string;
    commercialUsePolicy: string;
    modificationPolicy: string;
    zoneIds: string[];
  }>;
}

export interface TurkeyV2HybridRejectionRecord {
  zoneId: string;
  sourceNativeId?: string;
  sourceClass: TurkeyV2HybridSourceClass;
  providerClass: TurkeyV2HybridProviderClass;
  providerId: string;
  parentId?: string;
  reason: TurkeyV2HybridRejectionReason;
  candidateAreaKm2: number;
  effectiveAreaKm2: number;
  removedAreaKm2: number;
  higherPriorityZoneIds: string[];
  severity: "error" | "warning";
  manualReviewRequired: boolean;
}

export interface TurkeyV2HybridRejectionReport {
  schemaVersion: typeof TURKEY_V2_HYBRID_REJECTION_SCHEMA_VERSION;
  districtId: string;
  rejections: TurkeyV2HybridRejectionRecord[];
}

export interface TurkeyV2ZoneMigrationRecord {
  changeType: TurkeyV2HybridMigrationChangeType;
  oldZoneIds: string[];
  newZoneIds: string[];
  sourceClassBefore?: TurkeyV2HybridSourceClass;
  sourceClassAfter?: TurkeyV2HybridSourceClass;
  parentBefore?: string;
  parentAfter?: string;
  intersectionAreaKm2: number;
  oldOverlapPercent: number;
  newOverlapPercent: number;
  confidence: number;
  manualReviewRequired: boolean;
  reason: string;
}

export interface TurkeyV2ZoneMigrationPlan {
  schemaVersion: typeof TURKEY_V2_HYBRID_MIGRATION_SCHEMA_VERSION;
  buildDate: string;
  records: TurkeyV2ZoneMigrationRecord[];
}

export interface TurkeyV2HybridBatchSourceEntry {
  officialZones?: readonly TerritoryZone[];
  osmZones?: readonly TerritoryZone[];
}

export interface TurkeyV2HybridBatchBuildOptions {
  districts: readonly TerritoryZone[];
  sourcesByDistrict?:
    | ReadonlyMap<string, TurkeyV2HybridBatchSourceEntry>
    | Record<string, TurkeyV2HybridBatchSourceEntry>;
  generatedDefaults?: TurkeyV2HybridGeneratedOptions;
  buildDate: string;
  continueOnError?: boolean;
  fallbackToGeneratedOnQualityFailure?: boolean;
  datasetId?: string;
  minimumEffectiveAreaKm2?: number;
  overlapToleranceKm2?: number;
  gapToleranceKm2?: number;
  parentOutsideToleranceKm2?: number;
  allowExperimental?: boolean;
}

export interface TurkeyV2HybridBatchBuildResult {
  schemaVersion: typeof TURKEY_V2_HYBRID_BATCH_SCHEMA_VERSION;
  districts: TurkeyV2HybridDistrictBuildResult[];
  dataset: TerritoryDataset;
  coverage: TurkeyV2HybridBatchCoverageSummary;
  quality: TurkeyV2HybridBatchQualityReport;
  provenance: {
    schemaVersion: typeof TURKEY_V2_HYBRID_PROVENANCE_SCHEMA_VERSION;
    buildDate: string;
    zones: TurkeyV2HybridProvenanceItem[];
  };
  attribution: TurkeyV2HybridAttributionManifest;
  failures: Array<{ districtId: string; message: string }>;
  deterministicHash: string;
}

export interface TurkeyV2HybridBatchCoverageSummary {
  districtCount: number;
  successfulDistrictCount: number;
  failedDistrictCount: number;
  districtsAbove9999: string[];
  districtsBelow9999: string[];
  officialOnlyDistricts: string[];
  officialOsmDistricts: string[];
  hybridRealGeneratedDistricts: string[];
  generatedOnlyDistricts: string[];
  totalOfficialAreaKm2: number;
  totalOsmEffectiveAreaKm2: number;
  totalGeneratedAreaKm2: number;
  finalCoveragePercent: number;
  gapTotalKm2: number;
  rejectionTotalKm2: number;
  provinces: Record<
    string,
    { provinceCode: string; districtCount: number; finalCoveragePercent: number }
  >;
}

export interface TurkeyV2HybridBatchQualityReport {
  ok: boolean;
  districtCount: number;
  failedDistrictCount: number;
  issueCount: number;
  hardFailureCount: number;
  deterministicHash: string;
}

interface PolygonClippingApi {
  difference: typeof polygonClipping.difference;
  intersection: typeof polygonClipping.intersection;
  union: typeof polygonClipping.union;
}

interface CandidateMetadata {
  sourceClass: TurkeyV2HybridSourceClass;
  providerClass: TurkeyV2HybridProviderClass;
  providerId: string;
  providerName: string;
  sourceDatasetId: string;
  sourceId: string;
  sourceNativeId: string;
  sourceDate: string;
  sourceVersion?: string;
  retrievedAt?: string;
  sourceUrl?: string;
  sourceSnapshotChecksum?: string;
  licenseState?: TerritoryLicenseState;
  license: string;
  attribution: string;
  redistributionPolicy: string;
  commercialUsePolicy: string;
  modificationPolicy: string;
  semanticType: "neighbourhood" | "village" | "generated-zone";
  localTypeName: string;
  reviewStatus: string;
  sourceLockReference?: string;
  sourceLockChecksum?: string;
  stableId: string;
  experimental: boolean;
}

interface EffectiveBuildOutput {
  zones: TerritoryZone[];
  rejections: TurkeyV2HybridRejectionRecord[];
  issues: TurkeyV2HybridIssue[];
  sourceInternalOverlapCount: number;
  sourceInternalOverlapAreaKm2: number;
  removedByPriorityAreaKm2: number;
  sliverAreaKm2: number;
}

const CLIPPER =
  (polygonClipping as unknown as { default?: PolygonClippingApi }).default ??
  (polygonClipping as unknown as PolygonClippingApi);
const EARTH_RADIUS_METERS = 6_371_008.8;
const COORDINATE_EPSILON = 1e-9;
const RING_AREA_EPSILON = 1e-9;
const AREA_TOLERANCE_KM2 = 0.000001;
const DEFAULT_BUILD_DATE = "1970-01-01T00:00:00.000Z";

export async function buildTurkeyV2HybridDistrict(
  options: TurkeyV2HybridDistrictBuildOptions
): Promise<TurkeyV2HybridDistrictBuildResult> {
  const buildDate = options.buildDate ?? DEFAULT_BUILD_DATE;
  const sourcePriority = options.sourcePriority ?? ["official", "osm", "generated"];
  const minimumEffectiveAreaKm2 = options.minimumEffectiveAreaKm2 ?? AREA_TOLERANCE_KM2;
  const overlapToleranceKm2 = options.overlapToleranceKm2 ?? AREA_TOLERANCE_KM2;
  const gapToleranceKm2 = options.gapToleranceKm2 ?? 0.0001;
  const parentOutsideToleranceKm2 = options.parentOutsideToleranceKm2 ?? AREA_TOLERANCE_KM2;
  const issues: TurkeyV2HybridIssue[] = [];

  if (sourcePriority.join(">") !== "official>osm>generated") {
    issues.push({
      code: "TR_V2_HYBRID_SOURCE_PRIORITY_UNSUPPORTED",
      severity: "error",
      message: "Turkey V2 hybrid builds require official > osm > generated source priority.",
      parentId: options.district.id
    });
  }

  const districtGeometry = toClippingMultiPolygon(options.district.geometry);
  const districtAreaKm2 = clippingAreaKm2(districtGeometry);
  const officialCandidates = sortZones(options.officialZones ?? []);
  const osmCandidates = sortZones(options.osmZones ?? []);
  const officialCandidateAreaKm2 = sumAreas(officialCandidates);
  const osmCandidateAreaKm2 = sumAreas(osmCandidates);
  const officialEffective = buildEffectiveRealZones({
    district: options.district,
    provinceCode: options.provinceCode,
    districtCode: options.districtCode,
    districtGeometry,
    zones: officialCandidates,
    sourceClass: "official",
    priorityMask: [],
    minimumEffectiveAreaKm2,
    overlapToleranceKm2,
    allowExperimental: Boolean(options.allowExperimental)
  });
  const officialMask = unionTerritoryGeometries(
    officialEffective.zones.map((zone) => zone.geometry)
  );
  const osmEffective = buildEffectiveRealZones({
    district: options.district,
    provinceCode: options.provinceCode,
    districtCode: options.districtCode,
    districtGeometry,
    zones: osmCandidates,
    sourceClass: "osm",
    priorityMask: officialMask,
    minimumEffectiveAreaKm2,
    overlapToleranceKm2,
    allowExperimental: Boolean(options.allowExperimental)
  });
  const realZones = [...officialEffective.zones, ...osmEffective.zones].sort(compareZones);
  const realMask = unionTerritoryGeometries(realZones.map((zone) => zone.geometry));
  const missingGeometry = differenceClippingGeometries(districtGeometry, realMask);
  const missingBeforeGeneratedAreaKm2 = clippingAreaKm2(missingGeometry);
  const generationGeometry = clippingMultiPolygonToTerritoryGeometry(missingGeometry);
  const generatedOptions = options.generated ?? { enabled: true, profile: "auto" as const };
  let generatedResult: TurkeyGameZoneBuildResult | undefined;
  let generatedEffective: TerritoryZone[] = [];
  let generatedSliverAreaKm2 = 0;

  if (
    generatedOptions.enabled &&
    missingBeforeGeneratedAreaKm2 >= minimumEffectiveAreaKm2 &&
    generationGeometry &&
    issues.every((issue) => issue.severity !== "error")
  ) {
    const generationDistrict = {
      ...options.district,
      geometry: generationGeometry,
      bbox: computeGeometryBBox(generationGeometry),
      center: computeSafeGeometryCenter(generationGeometry)
    };
    generatedResult = buildTurkeyGameZones({
      district: generationDistrict,
      provinceCode: options.provinceCode,
      districtCode: options.districtCode,
      profile: generatedOptions.profile ?? "auto",
      seed: generatedOptions.seed ?? "kaprota-v2",
      excludedOrOccupiedZones: [],
      ...(generatedOptions.targetAreaKm2 !== undefined
        ? { targetAreaKm2: generatedOptions.targetAreaKm2 }
        : {}),
      ...(generatedOptions.targetZoneCount !== undefined
        ? { targetZoneCount: generatedOptions.targetZoneCount }
        : {}),
      ...(generatedOptions.minAreaKm2 !== undefined
        ? { minAreaKm2: generatedOptions.minAreaKm2 }
        : {}),
      ...(generatedOptions.maxAreaKm2 !== undefined
        ? { maxAreaKm2: generatedOptions.maxAreaKm2 }
        : {}),
      ...(generatedOptions.maxZonesPerDistrict !== undefined
        ? { maxZonesPerDistrict: generatedOptions.maxZonesPerDistrict }
        : {}),
      ...(generatedOptions.minFragmentAreaKm2 !== undefined
        ? { minFragmentAreaKm2: generatedOptions.minFragmentAreaKm2 }
        : {}),
      ...(generatedOptions.fragmentStrategy
        ? { fragmentStrategy: generatedOptions.fragmentStrategy }
        : {})
    });
    const configurationHash = sha256Hex(serializeJsonStable(generatedResult.configuration));
    const generatedOutput = buildEffectiveGeneratedZones({
      district: options.district,
      provinceCode: options.provinceCode,
      districtCode: options.districtCode,
      districtGeometry,
      realMask,
      zones: generatedResult.zones,
      minimumEffectiveAreaKm2,
      buildDate,
      configurationHash
    });
    generatedEffective = generatedOutput.zones;
    generatedSliverAreaKm2 = generatedOutput.sliverAreaKm2;

    if (
      generatedEffective.length === 0 &&
      missingBeforeGeneratedAreaKm2 >= minimumEffectiveAreaKm2
    ) {
      const fallbackZone = createSingleGeneratedFallbackZone({
        district: options.district,
        provinceCode: options.provinceCode,
        districtCode: options.districtCode,
        geometry: generationGeometry,
        buildDate,
        seed: generatedOptions.seed ?? "kaprota-v2",
        configurationHash,
        effectiveGeometry: missingGeometry
      });

      generatedEffective = [fallbackZone];
      generatedResult = undefined;
    } else {
      issues.push(
        ...generatedResult.issues.map((issue) => ({
          code: `TR_V2_HYBRID_GENERATOR_${issue.code}`,
          severity: issue.severity,
          message: issue.message,
          ...(issue.zoneId ? { zoneId: issue.zoneId } : {}),
          ...(issue.parentId ? { parentId: issue.parentId } : {}),
          ...(issue.details ? { details: issue.details } : {})
        }))
      );
    }
  }

  issues.push(...officialEffective.issues, ...osmEffective.issues);

  const effectiveZonesWithoutAdjacency = [...realZones, ...generatedEffective].sort(compareZones);
  const datasetId = options.datasetId ?? "tr-adm3-v2-hybrid-build";
  const parentDistrict = createHybridDistrictZone({
    district: options.district,
    datasetId,
    childIds: effectiveZonesWithoutAdjacency.map((zone) => zone.id),
    provinceCode: options.provinceCode,
    districtCode: options.districtCode
  });
  const datasetWithoutAdjacency = createHybridDataset({
    datasetId,
    buildDate,
    district: parentDistrict,
    zones: effectiveZonesWithoutAdjacency
  });
  const adjacency = await buildTerritoryAdjacency(datasetWithoutAdjacency, {
    buildDate,
    includePointTouches: false,
    sameAdminLevelOnly: true,
    sameParentOnly: true,
    minimumSharedBoundaryMeters: 0.001,
    qualityChecks: {
      coordinates: true,
      rings: true,
      selfIntersections: true,
      holes: true,
      bbox: true,
      center: false,
      antimeridian: true,
      parentContainment: false,
      siblingOverlaps: false
    }
  });
  const zones = addNeighbors(effectiveZonesWithoutAdjacency, adjacency.artifact.edges);
  const dataset = createHybridDataset({
    datasetId,
    buildDate,
    district: createHybridDistrictZone({
      district: parentDistrict,
      datasetId,
      childIds: zones.map((zone) => zone.id),
      provinceCode: options.provinceCode,
      districtCode: options.districtCode
    }),
    zones
  });
  const trV2Validation = validateTurkeyV2Dataset(dataset);
  const coverage = createCoverageReport({
    districtId: options.district.id,
    provinceCode: options.provinceCode,
    districtCode: options.districtCode,
    districtAreaKm2:
      districtAreaKm2 > 0
        ? districtAreaKm2
        : roundAreaKm2(areaOfUnion(realZones) + missingBeforeGeneratedAreaKm2),
    officialCandidates,
    officialEffective: officialEffective.zones,
    officialCandidateAreaKm2,
    osmCandidates,
    osmEffective: osmEffective.zones,
    osmCandidateAreaKm2,
    osmClippedByOfficialAreaKm2: osmEffective.removedByPriorityAreaKm2,
    realZones,
    generatedZones: generatedEffective,
    ...(generatedResult ? { generatedResult } : {}),
    missingBeforeGeneratedAreaKm2,
    finalZones: zones,
    rejectedSliverAreaKm2:
      officialEffective.sliverAreaKm2 + osmEffective.sliverAreaKm2 + generatedSliverAreaKm2
  });
  const rejections = createRejectionReport(options.district.id, [
    ...officialEffective.rejections,
    ...osmEffective.rejections
  ]);
  const provenance = createProvenanceReport({
    districtId: options.district.id,
    buildDate,
    zones,
    districtGeometryHash: geometryHash(options.district.geometry)
  });
  const attribution = createAttributionManifest({
    districtId: options.district.id,
    buildDate,
    provenance
  });
  const licenses = createLicenseManifest(options.district.id, attribution);
  const distributionPolicy = createDistributionPolicyManifest(options.district.id, provenance);
  const migration = createTurkeyV2ZoneMigrationPlan({
    buildDate,
    oldZones: options.migrationBaselineZones ?? [],
    newZones: zones
  });
  const preliminaryHash = sha256Hex(
    serializeJsonStable({
      datasetGeometryHash: dataset.manifest.geometryHash,
      coverage,
      provenance,
      attribution,
      licenses,
      distributionPolicy,
      rejections,
      migration,
      adjacency: adjacency.artifact.contentHash,
      validationIssueKeys: trV2Validation.issues.map(issueKey)
    })
  );
  const quality = createQualityReport({
    dataset,
    district: options.district,
    zones,
    districtAreaKm2:
      districtAreaKm2 > 0
        ? districtAreaKm2
        : roundAreaKm2(areaOfUnion(realZones) + missingBeforeGeneratedAreaKm2),
    coverage,
    rejections,
    trV2Validation,
    issues,
    adjacencyIssueCount: adjacency.issues.filter((issue) => issue.severity === "error").length,
    officialSourceInternalOverlapCount: officialEffective.sourceInternalOverlapCount,
    osmSourceInternalOverlapCount: osmEffective.sourceInternalOverlapCount,
    realMask,
    generatedZones: generatedEffective,
    overlapToleranceKm2,
    gapToleranceKm2,
    parentOutsideToleranceKm2,
    ...(generatedResult ? { generatedResult } : {}),
    deterministicHash: preliminaryHash
  });
  const deterministicHash = sha256Hex(
    serializeJsonStable({
      base: preliminaryHash,
      qualitySummary: quality.summary,
      qualityGates: quality.gates
    })
  );
  const finalQuality = { ...quality, deterministicHash };

  return {
    district: dataset.zones[0]!,
    candidates: {
      official: officialCandidates,
      osm: osmCandidates
    },
    effective: {
      official: officialEffective.zones,
      osm: osmEffective.zones,
      generated: generatedEffective,
      zones
    },
    dataset,
    coverage: {
      ...coverage,
      status: finalQuality.ok ? "ok" : "quality-failed"
    },
    quality: finalQuality,
    provenance,
    attribution,
    licenses,
    distributionPolicy,
    rejections,
    migration,
    adjacency: adjacency.artifact,
    adjacencyStatistics: adjacency.statistics,
    ...(generatedResult ? { generatedResult } : {}),
    deterministicHash,
    issues: sortIssues([...issues, ...finalQuality.issues])
  };
}

function isUsableGeneratedFallback(result: TurkeyV2HybridDistrictBuildResult): boolean {
  return (
    result.coverage.finalCoveragePercent >= 99.99 &&
    result.quality.summary.invalidGeometryCount === 0 &&
    result.quality.summary.emptyGeometryCount === 0 &&
    result.quality.summary.generatedQualityErrorCount === 0 &&
    result.quality.summary.parentContainmentErrorCount === 0 &&
    result.quality.summary.siblingOverlapAfterPriorityCount === 0 &&
    result.quality.summary.realGeneratedOverlapKm2 === 0
  );
}

export async function buildTurkeyV2HybridBatch(
  options: TurkeyV2HybridBatchBuildOptions
): Promise<TurkeyV2HybridBatchBuildResult> {
  const datasetId = options.datasetId ?? "tr-adm3-v2-hybrid-batch";
  const districts = sortZones(options.districts);
  const duplicateDistrictIds = findDuplicates(districts.map((district) => district.id));

  if (duplicateDistrictIds.length > 0) {
    throw new Error(`Duplicate district id(s): ${duplicateDistrictIds.join(", ")}`);
  }

  const results: TurkeyV2HybridDistrictBuildResult[] = [];
  const failures: Array<{ districtId: string; message: string }> = [];

  for (const district of districts) {
    try {
      const sourceEntry = readBatchSourceEntry(options.sourcesByDistrict, district.id);
      const codes = readDistrictCodes(district);
      const districtOptions = {
        district,
        provinceCode: codes.provinceCode,
        districtCode: codes.districtCode,
        officialZones: sourceEntry?.officialZones ?? [],
        osmZones: sourceEntry?.osmZones ?? [],
        generated: options.generatedDefaults ?? { enabled: true, profile: "auto" },
        buildDate: options.buildDate,
        datasetId: `${datasetId}-${district.id.replace(/[^a-zA-Z0-9_-]+/g, "-")}`,
        ...(options.minimumEffectiveAreaKm2 !== undefined
          ? { minimumEffectiveAreaKm2: options.minimumEffectiveAreaKm2 }
          : {}),
        ...(options.overlapToleranceKm2 !== undefined
          ? { overlapToleranceKm2: options.overlapToleranceKm2 }
          : {}),
        ...(options.gapToleranceKm2 !== undefined
          ? { gapToleranceKm2: options.gapToleranceKm2 }
          : {}),
        ...(options.parentOutsideToleranceKm2 !== undefined
          ? { parentOutsideToleranceKm2: options.parentOutsideToleranceKm2 }
          : {}),
        ...(options.allowExperimental !== undefined
          ? { allowExperimental: options.allowExperimental }
          : {})
      };
      let result = await buildTurkeyV2HybridDistrict(districtOptions);

      if (
        !result.quality.ok &&
        !isUsableGeneratedFallback(result) &&
        options.fallbackToGeneratedOnQualityFailure &&
        (districtOptions.officialZones.length > 0 || districtOptions.osmZones.length > 0) &&
        (options.generatedDefaults?.enabled ?? true)
      ) {
        const fallback = await buildTurkeyV2HybridDistrict({
          ...districtOptions,
          officialZones: [],
          osmZones: []
        });

        if (fallback.quality.ok || isUsableGeneratedFallback(fallback)) {
          result = fallback;
        }
      }

      if (!result.quality.ok && !options.continueOnError) {
        throw new Error(`Hybrid district build failed quality gates for ${district.id}.`);
      }

      results.push(result);
    } catch (error) {
      failures.push({
        districtId: district.id,
        message: error instanceof Error ? error.message : String(error)
      });

      if (!options.continueOnError) {
        throw error;
      }
    }
  }

  const parentZones = results.map((result) =>
    createHybridDistrictZone({
      district: result.district,
      datasetId,
      childIds: result.effective.zones.map((zone) => zone.id),
      provinceCode: result.coverage.provinceCode,
      districtCode: result.coverage.districtCode
    })
  );
  const adm3Zones = results.flatMap((result) =>
    result.effective.zones.map((zone) => ({ ...zone, datasetId }))
  );
  const dataset = createHybridDataset({
    datasetId,
    buildDate: options.buildDate,
    zones: [...parentZones, ...adm3Zones].sort(compareZones),
    adminLevels: ["ADM2", "ADM3"],
    name: "Turkey ADM3 V2 hybrid batch build"
  });
  const coverage = createBatchCoverageSummary({
    requestedDistricts: districts,
    results,
    failures
  });
  const provenanceItems = results.flatMap((result) => result.provenance.zones);
  const provenance = {
    schemaVersion: TURKEY_V2_HYBRID_PROVENANCE_SCHEMA_VERSION,
    buildDate: options.buildDate,
    zones: provenanceItems.sort((left, right) => left.zoneId.localeCompare(right.zoneId))
  };
  const attribution = createAttributionManifest({
    districtId: "batch",
    buildDate: options.buildDate,
    provenance: {
      schemaVersion: TURKEY_V2_HYBRID_PROVENANCE_SCHEMA_VERSION,
      districtId: "batch",
      buildDate: options.buildDate,
      zones: provenance.zones
    }
  });
  const hardFailureCount = results.filter((result) => !result.quality.ok).length + failures.length;
  const deterministicHash = sha256Hex(
    serializeJsonStable({
      datasetGeometryHash: dataset.manifest.geometryHash,
      coverage,
      provenance,
      attribution,
      failures
    })
  );

  return {
    schemaVersion: TURKEY_V2_HYBRID_BATCH_SCHEMA_VERSION,
    districts: results,
    dataset,
    coverage,
    quality: {
      ok: hardFailureCount === 0,
      districtCount: districts.length,
      failedDistrictCount: failures.length,
      issueCount: results.reduce((total, result) => total + result.issues.length, 0),
      hardFailureCount,
      deterministicHash
    },
    provenance,
    attribution,
    failures,
    deterministicHash
  };
}

export function createTurkeyV2ZoneMigrationPlan(input: {
  buildDate: string;
  oldZones: readonly TerritoryZone[];
  newZones: readonly TerritoryZone[];
}): TurkeyV2ZoneMigrationPlan {
  const records: TurkeyV2ZoneMigrationRecord[] = [];
  const oldZones = sortZones(input.oldZones);
  const newZones = sortZones(input.newZones);
  const matchedOld = new Set<string>();
  const matchedNew = new Set<string>();

  for (const oldZone of oldZones) {
    const sameId = newZones.find((zone) => zone.id === oldZone.id);

    if (!sameId) {
      continue;
    }

    const oldSourceClass = readSourceClass(oldZone);
    const newSourceClass = readSourceClass(sameId);
    const overlap = overlapEvidence(oldZone, [sameId]);
    matchedOld.add(oldZone.id);
    matchedNew.add(sameId.id);

    if (oldZone.parentId !== sameId.parentId) {
      records.push(migrationRecord("parent-changed", [oldZone], [sameId], overlap));
    } else if (oldSourceClass !== newSourceClass) {
      records.push(migrationRecord("source-class-changed", [oldZone], [sameId], overlap));
    } else if (geometryHash(oldZone.geometry) !== geometryHash(sameId.geometry)) {
      records.push(migrationRecord("geometry-changed", [oldZone], [sameId], overlap));
    } else {
      records.push(migrationRecord("preserved", [oldZone], [sameId], overlap));
    }
  }

  for (const oldZone of oldZones.filter((zone) => !matchedOld.has(zone.id))) {
    const overlappingNew = newZones
      .filter((zone) => !matchedNew.has(zone.id))
      .map((zone) => ({ zone, evidence: overlapEvidence(oldZone, [zone]) }))
      .filter((entry) => entry.evidence.intersectionAreaKm2 > AREA_TOLERANCE_KM2)
      .sort(
        (left, right) =>
          right.evidence.intersectionAreaKm2 - left.evidence.intersectionAreaKm2 ||
          left.zone.id.localeCompare(right.zone.id)
      );

    if (overlappingNew.length > 1) {
      const zones = overlappingNew.map((entry) => entry.zone);
      zones.forEach((zone) => matchedNew.add(zone.id));
      records.push(migrationRecord("split", [oldZone], zones, overlapEvidence(oldZone, zones)));
      matchedOld.add(oldZone.id);
      continue;
    }

    const best = overlappingNew[0];

    if (best) {
      const oldSourceClass = readSourceClass(oldZone);
      const newSourceClass = readSourceClass(best.zone);
      matchedOld.add(oldZone.id);
      matchedNew.add(best.zone.id);
      records.push(
        migrationRecord(
          oldSourceClass !== newSourceClass ? "source-replaced" : "geometry-changed",
          [oldZone],
          [best.zone],
          best.evidence
        )
      );
    }
  }

  for (const newZone of newZones.filter((zone) => !matchedNew.has(zone.id))) {
    const overlappingOld = oldZones
      .filter((zone) => !matchedOld.has(zone.id))
      .map((zone) => ({ zone, evidence: overlapEvidence(zone, [newZone]) }))
      .filter((entry) => entry.evidence.intersectionAreaKm2 > AREA_TOLERANCE_KM2)
      .sort(
        (left, right) =>
          right.evidence.intersectionAreaKm2 - left.evidence.intersectionAreaKm2 ||
          left.zone.id.localeCompare(right.zone.id)
      );

    if (overlappingOld.length > 1) {
      const oldMatched = overlappingOld.map((entry) => entry.zone);
      oldMatched.forEach((zone) => matchedOld.add(zone.id));
      matchedNew.add(newZone.id);
      records.push(
        migrationRecord("merged", oldMatched, [newZone], overlapEvidence(newZone, oldMatched))
      );
    }
  }

  for (const oldZone of oldZones.filter((zone) => !matchedOld.has(zone.id))) {
    records.push(migrationRecord("removed", [oldZone], [], emptyOverlapEvidence()));
  }

  for (const newZone of newZones.filter((zone) => !matchedNew.has(zone.id))) {
    records.push(migrationRecord("added", [], [newZone], emptyOverlapEvidence()));
  }

  return {
    schemaVersion: TURKEY_V2_HYBRID_MIGRATION_SCHEMA_VERSION,
    buildDate: input.buildDate,
    records: records.sort(compareMigrationRecords)
  };
}

function buildEffectiveRealZones(input: {
  district: TerritoryZone;
  provinceCode: string;
  districtCode: string;
  districtGeometry: ClippingMultiPolygon;
  zones: readonly TerritoryZone[];
  sourceClass: "official" | "osm";
  priorityMask: ClippingMultiPolygon;
  minimumEffectiveAreaKm2: number;
  overlapToleranceKm2: number;
  allowExperimental: boolean;
}): EffectiveBuildOutput {
  const zones: TerritoryZone[] = [];
  const rejections: TurkeyV2HybridRejectionRecord[] = [];
  const issues: TurkeyV2HybridIssue[] = [];
  let localMask: ClippingMultiPolygon = [];
  let sourceInternalOverlapCount = 0;
  let sourceInternalOverlapAreaKm2 = 0;
  let removedByPriorityAreaKm2 = 0;
  let sliverAreaKm2 = 0;
  const sourceIdentities = new Set<string>();
  const geometryHashes = new Set<string>();

  for (const zone of sortZones(input.zones)) {
    const metadata = readCandidateMetadata(zone, input.sourceClass);
    const originalGeometry = toClippingMultiPolygon(zone.geometry);
    const candidateAreaKm2 = clippingAreaKm2(originalGeometry);
    const baseRejection = {
      zoneId: zone.id,
      sourceNativeId: metadata.sourceNativeId,
      sourceClass: input.sourceClass,
      providerClass: metadata.providerClass,
      providerId: metadata.providerId,
      ...(zone.parentId ? { parentId: zone.parentId } : {}),
      candidateAreaKm2,
      effectiveAreaKm2: 0,
      removedAreaKm2: 0,
      higherPriorityZoneIds: [] as string[],
      severity: "error" as const,
      manualReviewRequired: true
    };

    if (metadata.experimental && !input.allowExperimental) {
      rejections.push({ ...baseRejection, reason: "experimental-not-enabled" });
      continue;
    }

    if (!zone.parentId) {
      rejections.push({ ...baseRejection, reason: "missing-parent" });
      continue;
    }

    if (zone.parentId !== input.district.id) {
      rejections.push({ ...baseRejection, reason: "ambiguous-parent" });
      continue;
    }

    if (candidateAreaKm2 <= 0 || originalGeometry.length === 0) {
      rejections.push({ ...baseRejection, reason: "invalid-geometry" });
      continue;
    }

    if (!hasRequiredProvenance(metadata)) {
      rejections.push({ ...baseRejection, reason: "missing-provenance" });
      continue;
    }

    if (input.sourceClass === "osm" && metadata.license !== "ODbL-1.0") {
      rejections.push({ ...baseRejection, reason: "license-blocked" });
      continue;
    }

    const sourceIdentityKey = `${metadata.providerId}:${metadata.sourceNativeId}`;

    if (sourceIdentities.has(sourceIdentityKey)) {
      rejections.push({ ...baseRejection, reason: "duplicate-source-identity" });
      continue;
    }
    sourceIdentities.add(sourceIdentityKey);

    const candidateGeometryHash = geometryHash(zone.geometry);

    if (geometryHashes.has(candidateGeometryHash)) {
      rejections.push({ ...baseRejection, reason: "duplicate-geometry" });
      continue;
    }
    geometryHashes.add(candidateGeometryHash);

    const districtClipped = intersectClippingGeometries(input.districtGeometry, originalGeometry);
    const districtClippedAreaKm2 = clippingAreaKm2(districtClipped);

    if (districtClippedAreaKm2 <= 0) {
      rejections.push({ ...baseRejection, reason: "outside-parent" });
      continue;
    }

    const priorityOverlapKm2 = clippingAreaKm2(
      intersectClippingGeometries(districtClipped, input.priorityMask)
    );
    const sourceInternalOverlapKm2 = clippingAreaKm2(
      intersectClippingGeometries(districtClipped, localMask)
    );

    if (sourceInternalOverlapKm2 > input.overlapToleranceKm2) {
      sourceInternalOverlapCount += 1;
      sourceInternalOverlapAreaKm2 = roundAreaKm2(
        sourceInternalOverlapAreaKm2 + sourceInternalOverlapKm2
      );
      issues.push({
        code: "TR_V2_HYBRID_SOURCE_INTERNAL_OVERLAP",
        severity: "warning",
        message: `${input.sourceClass} candidate '${zone.id}' overlaps a same-source sibling before priority clipping.`,
        zoneId: zone.id,
        parentId: input.district.id,
        details: { areaKm2: sourceInternalOverlapKm2 }
      });
    }

    const effective = differenceClippingGeometries(districtClipped, input.priorityMask, localMask);
    const effectiveAreaKm2 = clippingAreaKm2(effective);
    const removedAreaKm2 = roundAreaKm2(districtClippedAreaKm2 - effectiveAreaKm2);
    removedByPriorityAreaKm2 = roundAreaKm2(removedByPriorityAreaKm2 + priorityOverlapKm2);

    if (effectiveAreaKm2 <= 0) {
      rejections.push({
        ...baseRejection,
        reason: priorityOverlapKm2 > 0 ? "covered-by-higher-priority" : "empty-after-clipping",
        effectiveAreaKm2,
        removedAreaKm2
      });
      continue;
    }

    if (effectiveAreaKm2 < input.minimumEffectiveAreaKm2) {
      sliverAreaKm2 = roundAreaKm2(sliverAreaKm2 + effectiveAreaKm2);
      rejections.push({
        ...baseRejection,
        reason: "below-minimum-effective-area",
        effectiveAreaKm2,
        removedAreaKm2,
        severity: "warning",
        manualReviewRequired: false
      });
      continue;
    }

    const geometry = clippingMultiPolygonToTerritoryGeometry(effective);

    if (!geometry) {
      rejections.push({ ...baseRejection, reason: "empty-after-clipping", removedAreaKm2 });
      continue;
    }

    zones.push(
      createEffectiveRealZone({
        zone,
        district: input.district,
        provinceCode: input.provinceCode,
        districtCode: input.districtCode,
        sourceClass: input.sourceClass,
        metadata,
        geometry,
        originalGeometry,
        effectiveGeometry: effective,
        candidateAreaKm2,
        clippedAreaKm2: districtClippedAreaKm2,
        removedByPriorityAreaKm2: priorityOverlapKm2,
        removedAreaKm2
      })
    );
    localMask = unionClippingGeometries([localMask, effective]);
  }

  return {
    zones: zones.sort(compareZones),
    rejections: rejections.sort(compareRejections),
    issues: sortIssues(issues),
    sourceInternalOverlapCount,
    sourceInternalOverlapAreaKm2,
    removedByPriorityAreaKm2,
    sliverAreaKm2
  };
}

function buildEffectiveGeneratedZones(input: {
  district: TerritoryZone;
  provinceCode: string;
  districtCode: string;
  districtGeometry: ClippingMultiPolygon;
  realMask: ClippingMultiPolygon;
  zones: readonly TerritoryZone[];
  minimumEffectiveAreaKm2: number;
  buildDate: string;
  configurationHash: string;
}): { zones: TerritoryZone[]; sliverAreaKm2: number } {
  const zones: TerritoryZone[] = [];
  let localMask: ClippingMultiPolygon = [];
  let sliverAreaKm2 = 0;

  for (const zone of sortZones(input.zones)) {
    const clipped = intersectClippingGeometries(
      input.districtGeometry,
      toClippingMultiPolygon(zone.geometry)
    );
    const effective = differenceClippingGeometries(clipped, input.realMask, localMask);
    const areaKm2 = clippingAreaKm2(effective);

    if (areaKm2 <= 0) {
      continue;
    }

    if (areaKm2 < input.minimumEffectiveAreaKm2) {
      sliverAreaKm2 = roundAreaKm2(sliverAreaKm2 + areaKm2);
      continue;
    }

    const geometry = clippingMultiPolygonToTerritoryGeometry(effective);

    if (!geometry) {
      continue;
    }

    zones.push(
      createEffectiveGeneratedZone({
        zone,
        district: input.district,
        provinceCode: input.provinceCode,
        districtCode: input.districtCode,
        geometry,
        effectiveGeometry: effective,
        buildDate: input.buildDate,
        configurationHash: input.configurationHash
      })
    );
    localMask = unionClippingGeometries([localMask, effective]);
  }

  return { zones: zones.sort(compareZones), sliverAreaKm2 };
}

function createSingleGeneratedFallbackZone(input: {
  district: TerritoryZone;
  provinceCode: string;
  districtCode: string;
  geometry: TerritoryGeometry;
  effectiveGeometry: ClippingMultiPolygon;
  buildDate: string;
  seed: string;
  configurationHash: string;
}): TerritoryZone {
  const id = [
    "tr:adm3",
    `tr-il-${input.provinceCode}`,
    `ilce-${safeIdentitySegment(input.district.id)}`,
    "generated",
    TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION,
    "single"
  ].join("-");
  const zone: TerritoryZone = {
    id,
    datasetId: input.district.datasetId,
    countryCode: "TR",
    level: 3,
    sourceAdminLevel: "ADM3",
    semanticType: "generated-zone",
    name: `${input.district.name ?? input.district.id} generated zone`,
    parentId: input.district.id,
    neighborIds: [],
    geometry: input.geometry,
    bbox: computeGeometryBBox(input.geometry),
    center: computeSafeGeometryCenter(input.geometry),
    properties: {
      territory: {
        sourceNativeId: id,
        stableId: id,
        generationSeed: input.seed,
        generatedZone: {
          seed: input.seed,
          generationSeed: input.seed,
          configurationHash: input.configurationHash,
          buildDate: input.buildDate
        }
      }
    }
  };

  return createEffectiveGeneratedZone({
    zone,
    district: input.district,
    provinceCode: input.provinceCode,
    districtCode: input.districtCode,
    geometry: input.geometry,
    effectiveGeometry: input.effectiveGeometry,
    buildDate: input.buildDate,
    configurationHash: input.configurationHash
  });
}

function safeIdentitySegment(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : "zone";
}

function createEffectiveRealZone(input: {
  zone: TerritoryZone;
  district: TerritoryZone;
  provinceCode: string;
  districtCode: string;
  sourceClass: "official" | "osm";
  metadata: CandidateMetadata;
  geometry: TerritoryGeometry;
  originalGeometry: ClippingMultiPolygon;
  effectiveGeometry: ClippingMultiPolygon;
  candidateAreaKm2: number;
  clippedAreaKm2: number;
  removedByPriorityAreaKm2: number;
  removedAreaKm2: number;
}): TerritoryZone {
  const territory = isRecord(input.zone.properties.territory)
    ? input.zone.properties.territory
    : {};
  const source = isRecord(territory.source) ? territory.source : {};
  const effectiveGeometryHash = geometryHash(input.geometry);
  const originalGeometryHash =
    clippingMultiPolygonToTerritoryGeometry(input.originalGeometry) === undefined
      ? geometryHash(input.zone.geometry)
      : sha256Hex(
          serializeJsonStable(clippingMultiPolygonToTerritoryGeometry(input.originalGeometry))
        );
  const boundarySourceClass = boundarySourceClassForReal(input.sourceClass);
  const licenseState = licenseStateFromPolicy(input.metadata);
  const confidence = confidenceForRealSource(input.sourceClass, licenseState);
  const sourceSnapshotChecksum =
    input.metadata.sourceSnapshotChecksum ??
    input.metadata.sourceLockChecksum ??
    originalGeometryHash;
  const bbox = computeGeometryBBox(input.geometry);

  return {
    ...input.zone,
    countryCode: "TR",
    level: 3,
    sourceAdminLevel: "ADM3",
    semanticType: input.metadata.semanticType,
    parentId: input.district.id,
    neighborIds: [],
    geometry: input.geometry,
    bbox,
    center: computeSafeGeometryCenter(input.geometry),
    properties: {
      ...input.zone.properties,
      territory: {
        ...territory,
        adminLevel: "ADM3",
        sourceAdminLevel: "ADM3",
        semanticType: input.metadata.semanticType,
        localType: input.metadata.semanticType,
        localTypeName: input.metadata.localTypeName,
        hierarchyDepth: 3,
        parentId: input.district.id,
        countryCode: "TR",
        provinceCode: input.provinceCode,
        districtCode: input.districtCode,
        sourceClass: input.sourceClass,
        boundaryKind: "administrative",
        boundarySourceClass,
        confidence,
        administrative: input.sourceClass === "official",
        providerClass: input.metadata.providerClass,
        providerId: input.metadata.providerId,
        providerName: input.metadata.providerName,
        sourceProvider: input.metadata.providerId,
        sourceId: input.metadata.sourceId,
        sourceDatasetId: input.metadata.sourceDatasetId,
        sourceNativeId: input.metadata.sourceNativeId,
        sourceDate: input.metadata.sourceDate,
        ...(input.metadata.sourceVersion ? { sourceVersion: input.metadata.sourceVersion } : {}),
        ...(input.metadata.sourceUrl ? { sourceUrl: input.metadata.sourceUrl } : {}),
        ...(input.metadata.sourceLockReference
          ? { sourceSnapshotId: input.metadata.sourceLockReference }
          : {}),
        sourceSnapshotChecksum,
        licenseState,
        license: input.metadata.license,
        attribution: input.metadata.attribution,
        official: input.sourceClass === "official",
        generated: false,
        semanticReviewStatus: input.metadata.reviewStatus,
        coverageStatus: "verified",
        stableId: input.metadata.stableId,
        originalGeometryHash,
        effectiveGeometryHash,
        geometryHash: effectiveGeometryHash,
        candidateAreaKm2: input.candidateAreaKm2,
        clippedAreaKm2: input.clippedAreaKm2,
        removedByPriorityAreaKm2: input.removedByPriorityAreaKm2,
        removedAreaKm2: input.removedAreaKm2,
        clippedByParent: input.candidateAreaKm2 !== input.clippedAreaKm2,
        clippedByPriority: input.removedByPriorityAreaKm2 > AREA_TOLERANCE_KM2,
        redistributionPolicy: input.metadata.redistributionPolicy,
        commercialUsePolicy: input.metadata.commercialUsePolicy,
        modificationPolicy: input.metadata.modificationPolicy,
        source: {
          ...source,
          provider: input.metadata.providerId,
          sourceClass: input.sourceClass,
          boundarySourceClass,
          providerId: input.metadata.providerId,
          providerName: input.metadata.providerName,
          sourceDatasetId: input.metadata.sourceDatasetId,
          sourceId: input.metadata.sourceId,
          sourceNativeId: input.metadata.sourceNativeId,
          sourceDate: input.metadata.sourceDate,
          ...(input.metadata.sourceVersion ? { sourceVersion: input.metadata.sourceVersion } : {}),
          ...(input.metadata.sourceUrl ? { sourceUrl: input.metadata.sourceUrl } : {}),
          ...(input.metadata.sourceLockReference
            ? { sourceSnapshotId: input.metadata.sourceLockReference }
            : {}),
          sourceSnapshotChecksum,
          licenseState,
          license: input.metadata.license,
          attribution: input.metadata.attribution
        }
      }
    }
  };
}

function createEffectiveGeneratedZone(input: {
  zone: TerritoryZone;
  district: TerritoryZone;
  provinceCode: string;
  districtCode: string;
  geometry: TerritoryGeometry;
  effectiveGeometry: ClippingMultiPolygon;
  buildDate: string;
  configurationHash: string;
}): TerritoryZone {
  const territory = isRecord(input.zone.properties.territory)
    ? input.zone.properties.territory
    : {};
  const generatedZone = isRecord(territory.generatedZone) ? territory.generatedZone : {};
  const geometryHashValue = geometryHash(input.geometry);
  const bbox = computeGeometryBBox(input.geometry);
  const seed =
    readString(territory.generationSeed) ??
    readString(generatedZone.generationSeed) ??
    readString(generatedZone.seed) ??
    "kaprota-v2";
  const sourceSnapshotChecksum = input.configurationHash;

  return {
    ...input.zone,
    countryCode: "TR",
    level: 3,
    sourceAdminLevel: "ADM3",
    semanticType: "generated-zone",
    parentId: input.district.id,
    neighborIds: [],
    geometry: input.geometry,
    bbox,
    center: computeSafeGeometryCenter(input.geometry),
    properties: {
      ...input.zone.properties,
      territory: {
        ...territory,
        adminLevel: "ADM3",
        sourceAdminLevel: "ADM3",
        semanticType: "generated-zone",
        localType: "generated-zone",
        localTypeName: "Generated game zone",
        hierarchyDepth: 3,
        parentId: input.district.id,
        countryCode: "TR",
        provinceCode: input.provinceCode,
        districtCode: input.districtCode,
        sourceClass: "generated",
        boundaryKind: "estimated",
        boundarySourceClass: "smart-derived",
        confidence: "medium",
        administrative: false,
        providerClass: "generated",
        providerId: "territory-kit-generated",
        providerName: "TerritoryKit game-zone generator",
        sourceProvider: "territory-kit-generated",
        sourceId: "tr-adm3-game-zone-v2",
        sourceDatasetId: "tr-adm3-game-zone-v2",
        sourceNativeId: readString(territory.sourceNativeId) ?? input.zone.id,
        sourceDate: TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION,
        sourceVersion: TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION,
        sourceSnapshotChecksum,
        licenseState: "approved",
        license: "Apache-2.0",
        attribution: "TerritoryKit generated game zones from ADM2 boundaries",
        official: false,
        generated: true,
        algorithmVersion: TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION,
        generationSeed: seed,
        semanticReviewStatus: "not-applicable",
        coverageStatus: "generated",
        stableId: readString(territory.stableId) ?? input.zone.id,
        originalGeometryHash:
          readString(territory.originalGeometryHash) ?? geometryHash(input.zone.geometry),
        effectiveGeometryHash: geometryHashValue,
        geometryHash: geometryHashValue,
        clippedAreaKm2: clippingAreaKm2(input.effectiveGeometry),
        removedByPriorityAreaKm2: 0,
        redistributionPolicy: "allowed",
        commercialUsePolicy: "allowed",
        modificationPolicy: "allowed",
        generatorConfigurationHash: input.configurationHash,
        parentGeometryHash: geometryHash(input.district.geometry),
        source: {
          provider: "territory-kit-generated",
          sourceClass: "generated",
          boundarySourceClass: "smart-derived",
          providerId: "territory-kit-generated",
          providerName: "TerritoryKit game-zone generator",
          sourceDatasetId: "tr-adm3-game-zone-v2",
          sourceId: input.zone.id,
          sourceNativeId: input.zone.id,
          sourceDate: TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION,
          sourceVersion: TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION,
          sourceSnapshotChecksum,
          licenseState: "approved",
          license: "Apache-2.0",
          attribution: "TerritoryKit generated game zones from ADM2 boundaries"
        },
        generatedZone: {
          ...generatedZone,
          algorithm:
            readString(generatedZone.algorithm) ?? "deterministic-clipped-grid-tessellation",
          algorithmVersion: TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION,
          seed,
          generationSeed: seed,
          configurationHash: input.configurationHash,
          buildDate: input.buildDate
        }
      }
    }
  };
}

function createCoverageReport(input: {
  districtId: string;
  provinceCode: string;
  districtCode: string;
  districtAreaKm2: number;
  officialCandidates: readonly TerritoryZone[];
  officialEffective: readonly TerritoryZone[];
  officialCandidateAreaKm2: number;
  osmCandidates: readonly TerritoryZone[];
  osmEffective: readonly TerritoryZone[];
  osmCandidateAreaKm2: number;
  osmClippedByOfficialAreaKm2: number;
  realZones: readonly TerritoryZone[];
  generatedZones: readonly TerritoryZone[];
  generatedResult?: TurkeyGameZoneBuildResult;
  missingBeforeGeneratedAreaKm2: number;
  finalZones: readonly TerritoryZone[];
  rejectedSliverAreaKm2: number;
}): TurkeyV2HybridCoverageReport {
  const officialEffectiveAreaKm2 = sumAreas(input.officialEffective);
  const osmEffectiveAreaKm2 = sumAreas(input.osmEffective);
  const realEffectiveAreaKm2 = areaOfUnion(input.realZones);
  const generatedEffectiveAreaKm2 = areaOfUnion(input.generatedZones);
  const finalCoverageAreaKm2 = areaOfUnion(input.finalZones);
  const remainingGapAreaKm2 = roundAreaKm2(
    Math.max(0, input.districtAreaKm2 - finalCoverageAreaKm2)
  );

  return {
    schemaVersion: TURKEY_V2_HYBRID_COVERAGE_SCHEMA_VERSION,
    districtId: input.districtId,
    provinceCode: input.provinceCode,
    districtCode: input.districtCode,
    districtAreaKm2: input.districtAreaKm2,
    officialCandidateCount: input.officialCandidates.length,
    officialEffectiveCount: input.officialEffective.length,
    officialCandidateAreaKm2: input.officialCandidateAreaKm2,
    officialEffectiveAreaKm2,
    officialCoveragePercent: percentage(officialEffectiveAreaKm2, input.districtAreaKm2),
    osmCandidateCount: input.osmCandidates.length,
    osmEffectiveCount: input.osmEffective.length,
    osmCandidateAreaKm2: input.osmCandidateAreaKm2,
    osmClippedByOfficialAreaKm2: input.osmClippedByOfficialAreaKm2,
    osmEffectiveAreaKm2,
    osmCoveragePercent: percentage(osmEffectiveAreaKm2, input.districtAreaKm2),
    realEffectiveAreaKm2,
    realCoveragePercent: percentage(realEffectiveAreaKm2, input.districtAreaKm2),
    missingBeforeGeneratedAreaKm2: input.missingBeforeGeneratedAreaKm2,
    generatedEffectiveCount: input.generatedZones.length,
    generatedEffectiveAreaKm2,
    generatedCoveragePercent: percentage(generatedEffectiveAreaKm2, input.districtAreaKm2),
    finalCoverageAreaKm2,
    finalCoveragePercent: Math.min(100, percentage(finalCoverageAreaKm2, input.districtAreaKm2)),
    remainingGapAreaKm2,
    overlapRemovedByPriorityKm2: input.osmClippedByOfficialAreaKm2,
    rejectedSliverAreaKm2: input.rejectedSliverAreaKm2,
    sourceCounts: {
      official: input.officialEffective.length,
      osm: input.osmEffective.length,
      generated: input.generatedZones.length
    },
    profile: input.generatedResult?.configuration.profile ?? "auto",
    ...(input.generatedResult ? { selectedProfile: input.generatedResult.selectedProfile } : {}),
    algorithmVersion: TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION,
    status: "ok"
  };
}

function createQualityReport(input: {
  dataset: TerritoryDataset;
  district: TerritoryZone;
  zones: readonly TerritoryZone[];
  districtAreaKm2: number;
  coverage: TurkeyV2HybridCoverageReport;
  rejections: TurkeyV2HybridRejectionReport;
  trV2Validation: ReturnType<typeof validateTurkeyV2Dataset>;
  issues: readonly TurkeyV2HybridIssue[];
  adjacencyIssueCount: number;
  officialSourceInternalOverlapCount: number;
  osmSourceInternalOverlapCount: number;
  realMask: ClippingMultiPolygon;
  generatedZones: readonly TerritoryZone[];
  overlapToleranceKm2: number;
  gapToleranceKm2: number;
  parentOutsideToleranceKm2: number;
  generatedResult?: TurkeyGameZoneBuildResult;
  deterministicHash: string;
}): TurkeyV2HybridQualityReport {
  const finalOverlaps = validateGeometryDataset(input.dataset, {
    checks: {
      coordinates: false,
      rings: false,
      selfIntersections: false,
      holes: false,
      bbox: false,
      center: false,
      antimeridian: false,
      parentContainment: false,
      siblingOverlaps: true
    }
  }).issues.filter(
    (issue) => issue.code === "SIBLING_GEOMETRY_OVERLAP" && issue.severity === "error"
  ).length;
  const parentContainmentErrors = computeParentContainmentErrors(
    input.district,
    input.zones,
    input.parentOutsideToleranceKm2
  );
  const duplicateStableIdCount = countDuplicates(input.zones.map((zone) => readStableId(zone)));
  const duplicateSourceIdentityCount = countDuplicates(
    input.zones.map((zone) => {
      const territory = territoryMetadata(zone);
      return `${readString(territory.providerId) ?? readString(territory.sourceProvider) ?? ""}:${
        readString(territory.sourceNativeId) ?? zone.id
      }`;
    })
  );
  const duplicateGeometryCount = countDuplicates(
    input.zones.map((zone) => geometryHash(zone.geometry))
  );
  const realGeneratedOverlapKm2 = roundAreaKm2(
    input.generatedZones.reduce(
      (total, zone) =>
        total +
        clippingAreaKm2(
          intersectClippingGeometries(input.realMask, toClippingMultiPolygon(zone.geometry))
        ),
      0
    )
  );
  const invalidGeometryCount = input.rejections.rejections.filter(
    (rejection) => rejection.reason === "invalid-geometry"
  ).length;
  const emptyGeometryCount = input.zones.filter((zone) => sumAreas([zone]) <= 0).length;
  const missingProvenanceCount = input.rejections.rejections.filter(
    (rejection) => rejection.reason === "missing-provenance"
  ).length;
  const licenseAttributionMissingCount = input.rejections.rejections.filter(
    (rejection) => rejection.reason === "license-blocked"
  ).length;
  const strictValidationErrorCount = input.trV2Validation.issues.filter(
    (issue) => issue.severity === "error"
  ).length;
  const generatedQualityErrorCount =
    input.generatedResult?.issues.filter(
      (issue) =>
        issue.severity === "error" &&
        !(
          issue.code === "INVALID_GEOMETRY" &&
          invalidGeometryCount === 0 &&
          emptyGeometryCount === 0
        )
    ).length ?? 0;
  const sliverRejections = input.rejections.rejections.filter(
    (rejection) => rejection.reason === "below-minimum-effective-area"
  );
  const summary = {
    invalidGeometryCount,
    emptyGeometryCount,
    duplicateStableIdCount,
    duplicateSourceIdentityCount,
    duplicateGeometryCount,
    parentContainmentErrorCount: parentContainmentErrors,
    siblingOverlapBeforePriorityCount:
      input.officialSourceInternalOverlapCount + input.osmSourceInternalOverlapCount,
    siblingOverlapAfterPriorityCount: finalOverlaps,
    officialSourceInternalOverlapCount: input.officialSourceInternalOverlapCount,
    osmSourceInternalOverlapCount: input.osmSourceInternalOverlapCount,
    officialOsmOverlapRemovedKm2: input.coverage.osmClippedByOfficialAreaKm2,
    realGeneratedOverlapKm2,
    remainingGapCount: input.coverage.remainingGapAreaKm2 > input.gapToleranceKm2 ? 1 : 0,
    remainingGapAreaKm2: input.coverage.remainingGapAreaKm2,
    sliverCount: sliverRejections.length,
    sliverAreaKm2: roundAreaKm2(
      sliverRejections.reduce((total, item) => total + item.effectiveAreaKm2, 0)
    ),
    sourceMetadataConflictCount: 0,
    missingProvenanceCount,
    licenseAttributionMissingCount,
    semanticTypeConflictCount: input.trV2Validation.issues.filter(
      (issue) => issue.code === "INVALID_GENERATED_SEMANTIC_TYPE"
    ).length,
    strictTrV2ValidationErrorCount: strictValidationErrorCount,
    generatedQualityErrorCount,
    adjacencyIntegrityErrorCount: input.adjacencyIssueCount
  };
  const gates = {
    coverage: input.coverage.finalCoveragePercent >= 99.99,
    effectiveSiblingOverlap: finalOverlaps === 0,
    realGeneratedOverlap: realGeneratedOverlapKm2 <= input.overlapToleranceKm2,
    parentContainment: parentContainmentErrors === 0,
    invalidGeometry: invalidGeometryCount === 0,
    emptyFinalGeometry: emptyGeometryCount === 0,
    duplicateStableId: duplicateStableIdCount === 0,
    missingRequiredProvenance: missingProvenanceCount === 0 && licenseAttributionMissingCount === 0,
    generatedMetadata: generatedQualityErrorCount === 0,
    strictTrV2Validation: strictValidationErrorCount === 0,
    adjacencyIntegrity: input.adjacencyIssueCount === 0
  };
  const qualityIssues = [
    ...input.issues,
    ...input.trV2Validation.issues.map((issue) => ({
      code: `TR_V2_STRICT_${issue.code}`,
      severity: issue.severity,
      message: issue.message,
      ...(issue.zoneId ? { zoneId: issue.zoneId } : {}),
      ...(issue.parentId ? { parentId: issue.parentId } : {})
    }))
  ];

  return {
    schemaVersion: TURKEY_V2_HYBRID_QUALITY_SCHEMA_VERSION,
    ok: Object.values(gates).every(Boolean),
    districtId: input.district.id,
    deterministicHash: input.deterministicHash,
    summary,
    gates,
    strictValidation: {
      ok: input.trV2Validation.ok,
      issues: input.trV2Validation.issues
    },
    issues: sortIssues(qualityIssues)
  };
}

function createProvenanceReport(input: {
  districtId: string;
  buildDate: string;
  zones: readonly TerritoryZone[];
  districtGeometryHash: string;
}): TurkeyV2HybridProvenanceReport {
  return {
    schemaVersion: TURKEY_V2_HYBRID_PROVENANCE_SCHEMA_VERSION,
    districtId: input.districtId,
    buildDate: input.buildDate,
    zones: input.zones
      .map((zone) => createProvenanceItem(zone, input.buildDate, input.districtGeometryHash))
      .sort((left, right) => left.zoneId.localeCompare(right.zoneId))
  };
}

function createProvenanceItem(
  zone: TerritoryZone,
  buildDate: string,
  districtGeometryHash: string
): TurkeyV2HybridProvenanceItem {
  const territory = territoryMetadata(zone);
  const sourceClass = readSourceClass(zone);
  const providerClass = readProviderClass(territory, sourceClass);
  const boundarySourceClass = readBoundarySourceClass(territory, sourceClass);
  const licenseState = readLicenseState(territory, providerClass);
  const seed = readString(territory.generationSeed);
  const retrievedAt = readString(territory.retrievedAt);
  const sourceUrl = readString(territory.sourceUrl);
  const sourceVersion = readString(territory.sourceVersion);
  const sourceLockReference = readString(territory.sourceLockReference);
  const sourceLockChecksum = readString(territory.sourceLockChecksum);
  const sourceSnapshotChecksum =
    readString(territory.sourceSnapshotChecksum) ??
    sourceLockChecksum ??
    readString(territory.effectiveGeometryHash) ??
    geometryHash(zone.geometry);
  const item: TurkeyV2HybridProvenanceItem = {
    zoneId: zone.id,
    sourceClass,
    boundaryKind:
      readString(territory.boundaryKind) === "estimated" ? "estimated" : "administrative",
    boundarySourceClass,
    confidence: readBoundaryConfidence(territory, boundarySourceClass, licenseState),
    providerClass,
    providerId:
      readString(territory.providerId) ?? readString(territory.sourceProvider) ?? "unknown",
    providerName:
      readString(territory.providerName) ?? readString(territory.providerId) ?? "unknown",
    sourceDatasetId: readString(territory.sourceDatasetId) ?? zone.datasetId,
    sourceId: readString(territory.sourceId) ?? readString(territory.sourceNativeId) ?? zone.id,
    sourceNativeId: readString(territory.sourceNativeId) ?? zone.id,
    sourceDate: readString(territory.sourceDate) ?? "unknown",
    ...(sourceVersion ? { sourceVersion } : {}),
    ...(retrievedAt ? { retrievedAt } : {}),
    buildDate,
    ...(sourceUrl ? { sourceUrl } : {}),
    sourceSnapshotChecksum,
    licenseState,
    license: readString(territory.license) ?? "unknown",
    attribution: readString(territory.attribution) ?? "unknown",
    redistributionPolicy:
      readString(territory.redistributionPolicy) ?? defaultRedistributionPolicy(providerClass),
    commercialUsePolicy:
      readString(territory.commercialUsePolicy) ?? defaultCommercialUsePolicy(providerClass),
    modificationPolicy:
      readString(territory.modificationPolicy) ?? defaultModificationPolicy(providerClass),
    originalGeometryHash: readString(territory.originalGeometryHash) ?? geometryHash(zone.geometry),
    effectiveGeometryHash:
      readString(territory.effectiveGeometryHash) ?? geometryHash(zone.geometry),
    clippedAreaKm2: readNumber(territory.clippedAreaKm2) ?? sumAreas([zone]),
    removedByPriorityAreaKm2: readNumber(territory.removedByPriorityAreaKm2) ?? 0,
    parentId: zone.parentId ?? "",
    semanticType: zone.semanticType ?? readString(territory.semanticType) ?? "unknown",
    reviewStatus: readString(territory.semanticReviewStatus) ?? "review-required",
    ...(sourceLockReference ? { sourceLockReference } : {}),
    ...(sourceLockChecksum ? { sourceLockChecksum } : {})
  };

  if (sourceClass === "generated") {
    const generatorConfigurationHash = readString(territory.generatorConfigurationHash);

    return {
      ...item,
      algorithmVersion: TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION,
      ...(seed ? { generatorSeedHash: sha256Hex(seed) } : {}),
      ...(generatorConfigurationHash ? { generatorConfigurationHash } : {}),
      parentGeometryHash: readString(territory.parentGeometryHash) ?? districtGeometryHash
    };
  }

  return item;
}

function createAttributionManifest(input: {
  districtId: string;
  buildDate: string;
  provenance: TurkeyV2HybridProvenanceReport;
}): TurkeyV2HybridAttributionManifest {
  const groups = new Map<string, TurkeyV2HybridAttributionManifest["groups"][number]>();

  for (const item of input.provenance.zones) {
    const key = [item.sourceClass, item.license, item.attribution].join("\u0000");
    const existing = groups.get(key) ?? {
      sourceClass: item.sourceClass,
      license: item.license,
      attribution: item.attribution,
      providerIds: [],
      zoneIds: [],
      redistributionPolicies: []
    };
    existing.providerIds = sortedUnique([...existing.providerIds, item.providerId]);
    existing.zoneIds = sortedUnique([...existing.zoneIds, item.zoneId]);
    existing.redistributionPolicies = sortedUnique([
      ...existing.redistributionPolicies,
      item.redistributionPolicy
    ]);
    groups.set(key, existing);
  }

  const sortedGroups = [...groups.values()].sort(
    (left, right) =>
      left.sourceClass.localeCompare(right.sourceClass) ||
      left.license.localeCompare(right.license) ||
      left.attribution.localeCompare(right.attribution)
  );

  return {
    schemaVersion: TURKEY_V2_HYBRID_ATTRIBUTION_SCHEMA_VERSION,
    districtId: input.districtId,
    buildDate: input.buildDate,
    groups: sortedGroups,
    text: sortedGroups
      .map((group) => `${group.sourceClass}: ${group.attribution} (${group.license})`)
      .join("\n")
  };
}

function createLicenseManifest(
  districtId: string,
  attribution: TurkeyV2HybridAttributionManifest
): TurkeyV2HybridLicenseManifest {
  return {
    schemaVersion: "territorykit-tr-v2-hybrid-licenses@1",
    districtId,
    licenses: attribution.groups
      .map((group) => ({
        sourceClass: group.sourceClass,
        license: group.license,
        attribution: group.attribution,
        zoneCount: group.zoneIds.length
      }))
      .sort((left, right) => left.sourceClass.localeCompare(right.sourceClass))
  };
}

function createDistributionPolicyManifest(
  districtId: string,
  provenance: TurkeyV2HybridProvenanceReport
): TurkeyV2HybridDistributionPolicyManifest {
  const groups = new Map<string, TurkeyV2HybridDistributionPolicyManifest["policies"][number]>();

  for (const item of provenance.zones) {
    const key = [
      item.sourceClass,
      item.providerClass,
      item.license,
      item.redistributionPolicy,
      item.commercialUsePolicy,
      item.modificationPolicy
    ].join("\u0000");
    const existing = groups.get(key) ?? {
      sourceClass: item.sourceClass,
      providerClass: item.providerClass,
      license: item.license,
      redistributionPolicy: item.redistributionPolicy,
      commercialUsePolicy: item.commercialUsePolicy,
      modificationPolicy: item.modificationPolicy,
      zoneIds: []
    };
    existing.zoneIds = sortedUnique([...existing.zoneIds, item.zoneId]);
    groups.set(key, existing);
  }

  return {
    schemaVersion: "territorykit-tr-v2-hybrid-distribution-policy@1",
    districtId,
    policies: [...groups.values()].sort(
      (left, right) =>
        left.sourceClass.localeCompare(right.sourceClass) ||
        left.providerClass.localeCompare(right.providerClass) ||
        left.license.localeCompare(right.license)
    )
  };
}

function createRejectionReport(
  districtId: string,
  rejections: readonly TurkeyV2HybridRejectionRecord[]
): TurkeyV2HybridRejectionReport {
  return {
    schemaVersion: TURKEY_V2_HYBRID_REJECTION_SCHEMA_VERSION,
    districtId,
    rejections: [...rejections].sort(compareRejections)
  };
}

function createBatchCoverageSummary(input: {
  requestedDistricts: readonly TerritoryZone[];
  results: readonly TurkeyV2HybridDistrictBuildResult[];
  failures: readonly { districtId: string; message: string }[];
}): TurkeyV2HybridBatchCoverageSummary {
  const totalDistrictAreaKm2 = roundAreaKm2(
    input.results.reduce((total, result) => total + result.coverage.districtAreaKm2, 0)
  );
  const totalFinalAreaKm2 = roundAreaKm2(
    input.results.reduce((total, result) => total + result.coverage.finalCoverageAreaKm2, 0)
  );
  const provinces = new Map<
    string,
    { provinceCode: string; districtCount: number; area: number; covered: number }
  >();

  for (const result of input.results) {
    const current = provinces.get(result.coverage.provinceCode) ?? {
      provinceCode: result.coverage.provinceCode,
      districtCount: 0,
      area: 0,
      covered: 0
    };
    current.districtCount += 1;
    current.area = roundAreaKm2(current.area + result.coverage.districtAreaKm2);
    current.covered = roundAreaKm2(current.covered + result.coverage.finalCoverageAreaKm2);
    provinces.set(current.provinceCode, current);
  }

  return {
    districtCount: input.requestedDistricts.length,
    successfulDistrictCount: input.results.length,
    failedDistrictCount: input.failures.length,
    districtsAbove9999: input.results
      .filter((result) => result.coverage.finalCoveragePercent >= 99.99)
      .map((result) => result.coverage.districtId)
      .sort(),
    districtsBelow9999: input.results
      .filter((result) => result.coverage.finalCoveragePercent < 99.99)
      .map((result) => result.coverage.districtId)
      .sort(),
    officialOnlyDistricts: input.results
      .filter(
        (result) =>
          result.coverage.officialEffectiveCount > 0 &&
          result.coverage.osmEffectiveCount === 0 &&
          result.coverage.generatedEffectiveCount === 0
      )
      .map((result) => result.coverage.districtId)
      .sort(),
    officialOsmDistricts: input.results
      .filter(
        (result) =>
          result.coverage.officialEffectiveCount > 0 &&
          result.coverage.osmEffectiveCount > 0 &&
          result.coverage.generatedEffectiveCount === 0
      )
      .map((result) => result.coverage.districtId)
      .sort(),
    hybridRealGeneratedDistricts: input.results
      .filter(
        (result) =>
          result.coverage.realEffectiveAreaKm2 > 0 && result.coverage.generatedEffectiveCount > 0
      )
      .map((result) => result.coverage.districtId)
      .sort(),
    generatedOnlyDistricts: input.results
      .filter(
        (result) =>
          result.coverage.realEffectiveAreaKm2 === 0 && result.coverage.generatedEffectiveCount > 0
      )
      .map((result) => result.coverage.districtId)
      .sort(),
    totalOfficialAreaKm2: roundAreaKm2(
      input.results.reduce((total, result) => total + result.coverage.officialEffectiveAreaKm2, 0)
    ),
    totalOsmEffectiveAreaKm2: roundAreaKm2(
      input.results.reduce((total, result) => total + result.coverage.osmEffectiveAreaKm2, 0)
    ),
    totalGeneratedAreaKm2: roundAreaKm2(
      input.results.reduce((total, result) => total + result.coverage.generatedEffectiveAreaKm2, 0)
    ),
    finalCoveragePercent: percentage(totalFinalAreaKm2, totalDistrictAreaKm2),
    gapTotalKm2: roundAreaKm2(
      input.results.reduce((total, result) => total + result.coverage.remainingGapAreaKm2, 0)
    ),
    rejectionTotalKm2: roundAreaKm2(
      input.results.reduce(
        (total, result) =>
          total +
          result.rejections.rejections.reduce(
            (sum, rejection) => sum + rejection.candidateAreaKm2,
            0
          ),
        0
      )
    ),
    provinces: Object.fromEntries(
      [...provinces.values()]
        .map(
          (province) =>
            [
              province.provinceCode,
              {
                provinceCode: province.provinceCode,
                districtCount: province.districtCount,
                finalCoveragePercent: percentage(province.covered, province.area)
              }
            ] as const
        )
        .sort(([left], [right]) => left.localeCompare(right))
    )
  };
}

function createHybridDataset(input: {
  datasetId: string;
  buildDate: string;
  district?: TerritoryZone;
  zones: readonly TerritoryZone[];
  adminLevels?: Array<"ADM2" | "ADM3">;
  name?: string;
}): TerritoryDataset {
  const zones = [
    ...(input.district ? [input.district] : []),
    ...input.zones.map((zone) => ({ ...zone, datasetId: input.datasetId }))
  ].sort(compareZones);

  return {
    manifest: {
      schemaVersion: TERRITORY_SCHEMA_VERSION,
      datasetId: input.datasetId,
      datasetVersion: "0.0.0",
      sourceDate: input.buildDate,
      buildDate: input.buildDate,
      geometryHash: createDatasetGeometryHash({ zones }),
      adminLevels: input.adminLevels ?? ["ADM2", "ADM3"],
      countryCodes: ["TR"],
      crs: "EPSG:4326",
      geometryDetail: "source",
      license: "mixed",
      name: input.name ?? "Turkey ADM3 V2 hybrid coverage build",
      sourceProvider: "TerritoryKit Turkey V2 hybrid coverage pipeline",
      boundaryPolicy: "official-osm-generated-priority",
      disputedAreaPolicy: "source",
      worldview: "TR",
      attribution: "Mixed official, OpenStreetMap ODbL, and TerritoryKit generated sources"
    },
    zones
  };
}

function createHybridDistrictZone(input: {
  district: TerritoryZone;
  datasetId: string;
  childIds: readonly string[];
  provinceCode: string;
  districtCode: string;
}): TerritoryZone {
  const territory = isRecord(input.district.properties.territory)
    ? input.district.properties.territory
    : {};
  const geometry = normalizeTerritoryGeometry(input.district.geometry);

  return {
    ...input.district,
    datasetId: input.datasetId,
    countryCode: "TR",
    level: 2,
    sourceAdminLevel: "ADM2",
    semanticType: input.district.semanticType ?? "district",
    childIds: [...input.childIds].sort(),
    neighborIds: input.district.neighborIds ?? [],
    geometry,
    bbox: computeGeometryBBox(geometry),
    center: computeSafeGeometryCenter(geometry),
    properties: {
      ...input.district.properties,
      territory: {
        ...territory,
        adminLevel: "ADM2",
        sourceAdminLevel: "ADM2",
        semanticType: "district",
        hierarchyDepth: 2,
        countryCode: "TR",
        provinceCode: input.provinceCode,
        districtCode: input.districtCode,
        semanticReviewStatus: readString(territory.semanticReviewStatus) ?? "reviewed",
        coverageStatus: readString(territory.coverageStatus) ?? "verified"
      }
    }
  };
}

function readCandidateMetadata(
  zone: TerritoryZone,
  expectedSourceClass: "official" | "osm"
): CandidateMetadata {
  const territory = territoryMetadata(zone);
  const source = isRecord(territory.source) ? territory.source : {};
  const sourceClass = expectedSourceClass;
  const providerClass = readProviderClass(territory, sourceClass);
  const sourceNativeId =
    readString(territory.sourceNativeId) ??
    readString(source.sourceNativeId) ??
    readString(source.sourceId) ??
    readString(territory.osmId) ??
    zone.id;
  const semanticType = normalizeRealSemanticType(
    readString(territory.semanticType) ?? zone.semanticType
  );
  const retrievedAt = readString(territory.retrievedAt);
  const sourceUrl = readString(territory.sourceUrl) ?? readString(source.sourceUrl);
  const sourceLockReference = readString(territory.sourceLockReference);
  const sourceLockChecksum = readString(territory.sourceLockChecksum);
  const sourceId = readString(territory.sourceId) ?? readString(source.sourceId) ?? sourceNativeId;
  const sourceVersion = readString(territory.sourceVersion) ?? readString(source.sourceVersion);
  const sourceSnapshotChecksum =
    readString(territory.sourceSnapshotChecksum) ?? readString(source.sourceSnapshotChecksum);
  const licenseState = readOptionalLicenseState(territory) ?? readOptionalLicenseState(source);

  return {
    sourceClass,
    providerClass,
    providerId:
      readString(territory.providerId) ??
      readString(territory.sourceProvider) ??
      readString(source.provider) ??
      (sourceClass === "osm" ? "openstreetmap" : "unknown-official-provider"),
    providerName:
      readString(territory.providerName) ??
      readString(territory.sourceProvider) ??
      readString(source.provider) ??
      (sourceClass === "osm" ? "OpenStreetMap" : "Official source"),
    sourceDatasetId:
      readString(territory.sourceDatasetId) ?? readString(source.sourceDatasetId) ?? zone.datasetId,
    sourceId,
    sourceNativeId,
    sourceDate: readString(territory.sourceDate) ?? readString(source.sourceDate) ?? "unknown",
    ...(sourceVersion ? { sourceVersion } : {}),
    ...(retrievedAt ? { retrievedAt } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(sourceSnapshotChecksum ? { sourceSnapshotChecksum } : {}),
    ...(licenseState ? { licenseState } : {}),
    license:
      readString(territory.license) ??
      readString(source.license) ??
      (sourceClass === "osm" ? "ODbL-1.0" : ""),
    attribution:
      readString(territory.attribution) ??
      readString(source.attribution) ??
      (sourceClass === "osm" ? "OpenStreetMap contributors, ODbL 1.0" : ""),
    redistributionPolicy:
      readString(territory.redistributionPolicy) ?? defaultRedistributionPolicy(providerClass),
    commercialUsePolicy:
      readString(territory.commercialUsePolicy) ?? defaultCommercialUsePolicy(providerClass),
    modificationPolicy:
      readString(territory.modificationPolicy) ?? defaultModificationPolicy(providerClass),
    semanticType,
    localTypeName:
      readString(territory.localTypeName) ?? (semanticType === "village" ? "Köy" : "Mahalle"),
    reviewStatus:
      readString(territory.semanticReviewStatus) ??
      (semanticType === "neighbourhood" || semanticType === "village"
        ? "reviewed"
        : "mapping-review-required"),
    ...(sourceLockReference ? { sourceLockReference } : {}),
    ...(sourceLockChecksum ? { sourceLockChecksum } : {}),
    stableId: readString(territory.stableId) ?? zone.id,
    experimental: providerClass === "experimental" || readBoolean(territory.experimental) === true
  };
}

function normalizeRealSemanticType(input: string | undefined): "neighbourhood" | "village" {
  return input === "village" ? "village" : "neighbourhood";
}

function hasRequiredProvenance(metadata: CandidateMetadata): boolean {
  return Boolean(
    metadata.providerId &&
    metadata.sourceDatasetId &&
    metadata.sourceId &&
    metadata.sourceNativeId &&
    metadata.license &&
    metadata.attribution
  );
}

function readProviderClass(
  territory: Record<string, unknown>,
  sourceClass: TurkeyV2HybridSourceClass
): TurkeyV2HybridProviderClass {
  const providerClass =
    readString(territory.providerClass) ??
    (isRecord(territory.source) ? readString(territory.source.providerClass) : undefined);

  if (
    providerClass === "runtime" ||
    providerClass === "experimental" ||
    providerClass === "official" ||
    providerClass === "osm" ||
    providerClass === "generated"
  ) {
    return providerClass;
  }

  return sourceClass;
}

function boundarySourceClassForReal(sourceClass: "official" | "osm"): TerritoryBoundarySourceClass {
  return sourceClass === "official" ? "official-local" : "osm-administrative";
}

function readBoundarySourceClass(
  territory: Record<string, unknown>,
  sourceClass: TurkeyV2HybridSourceClass
): TerritoryBoundarySourceClass {
  const value =
    readString(territory.boundarySourceClass) ??
    (isRecord(territory.source) ? readString(territory.source.boundarySourceClass) : undefined);

  if (
    value === "official-national" ||
    value === "official-local" ||
    value === "osm-administrative" ||
    value === "smart-derived" ||
    value === "synthetic-test"
  ) {
    return value;
  }

  if (sourceClass === "osm") {
    return "osm-administrative";
  }

  if (sourceClass === "generated") {
    return "smart-derived";
  }

  return "official-local";
}

function licenseStateFromPolicy(
  metadata: Pick<CandidateMetadata, "redistributionPolicy" | "licenseState">
): TerritoryLicenseState {
  if (metadata.licenseState) {
    return metadata.licenseState;
  }

  return metadata.redistributionPolicy === "allowed" ? "approved" : "restricted";
}

function readOptionalLicenseState(
  input: Record<string, unknown>
): TerritoryLicenseState | undefined {
  const value = readString(input.licenseState);

  if (
    value === "approved" ||
    value === "pending" ||
    value === "restricted" ||
    value === "unknown"
  ) {
    return value;
  }

  return undefined;
}

function readLicenseState(
  territory: Record<string, unknown>,
  providerClass: TurkeyV2HybridProviderClass
): TerritoryLicenseState {
  const value =
    readString(territory.licenseState) ??
    (isRecord(territory.source) ? readString(territory.source.licenseState) : undefined);

  if (
    value === "approved" ||
    value === "pending" ||
    value === "restricted" ||
    value === "unknown"
  ) {
    return value;
  }

  return defaultRedistributionPolicy(providerClass) === "allowed" ? "approved" : "restricted";
}

function confidenceForRealSource(
  sourceClass: "official" | "osm",
  licenseState: TerritoryLicenseState
): TerritoryBoundaryConfidence {
  if (sourceClass === "official" && licenseState === "approved") {
    return "authoritative";
  }

  return sourceClass === "osm" ? "high" : "medium";
}

function readBoundaryConfidence(
  territory: Record<string, unknown>,
  boundarySourceClass: TerritoryBoundarySourceClass,
  licenseState: TerritoryLicenseState
): TerritoryBoundaryConfidence {
  const value = readString(territory.confidence);

  if (value === "authoritative" || value === "high" || value === "medium" || value === "low") {
    return value;
  }

  if (
    (boundarySourceClass === "official-national" || boundarySourceClass === "official-local") &&
    licenseState === "approved"
  ) {
    return "authoritative";
  }

  if (boundarySourceClass === "osm-administrative") {
    return "high";
  }

  return boundarySourceClass === "synthetic-test" ? "low" : "medium";
}

function readSourceClass(zone: TerritoryZone): TurkeyV2HybridSourceClass {
  const territory = territoryMetadata(zone);
  const source = isRecord(territory.source) ? territory.source : {};
  const value = readString(territory.sourceClass) ?? readString(source.sourceClass);

  if (value === "official" || value === "osm" || value === "generated") {
    return value;
  }

  return zone.semanticType === "generated-zone" ? "generated" : "official";
}

function readStableId(zone: TerritoryZone): string {
  return readString(territoryMetadata(zone).stableId) ?? zone.id;
}

function readDistrictCodes(district: TerritoryZone): {
  provinceCode: string;
  districtCode: string;
} {
  const territory = territoryMetadata(district);

  return {
    provinceCode: readString(territory.provinceCode) ?? "00",
    districtCode: readString(territory.districtCode) ?? district.id.replace(/^tr:adm2:/, "")
  };
}

function readBatchSourceEntry(
  sourcesByDistrict:
    | ReadonlyMap<string, TurkeyV2HybridBatchSourceEntry>
    | Record<string, TurkeyV2HybridBatchSourceEntry>
    | undefined,
  districtId: string
): TurkeyV2HybridBatchSourceEntry | undefined {
  if (!sourcesByDistrict) {
    return undefined;
  }

  if (typeof (sourcesByDistrict as { get?: unknown }).get === "function") {
    return (sourcesByDistrict as ReadonlyMap<string, TurkeyV2HybridBatchSourceEntry>).get(
      districtId
    );
  }

  return (sourcesByDistrict as Record<string, TurkeyV2HybridBatchSourceEntry>)[districtId];
}

function computeParentContainmentErrors(
  district: TerritoryZone,
  zones: readonly TerritoryZone[],
  toleranceKm2: number
): number {
  const districtGeometry = toClippingMultiPolygon(district.geometry);
  let count = 0;

  for (const zone of zones) {
    const outside = differenceClippingGeometries(
      toClippingMultiPolygon(zone.geometry),
      districtGeometry
    );

    if (clippingAreaKm2(outside) > toleranceKm2) {
      count += 1;
    }
  }

  return count;
}

function overlapEvidence(
  basis: TerritoryZone,
  others: readonly TerritoryZone[]
): {
  intersectionAreaKm2: number;
  oldOverlapPercent: number;
  newOverlapPercent: number;
} {
  if (others.length === 0) {
    return emptyOverlapEvidence();
  }

  const basisGeometry = toClippingMultiPolygon(basis.geometry);
  const otherGeometry = unionTerritoryGeometries(others.map((zone) => zone.geometry));
  const intersectionAreaKm2 = clippingAreaKm2(
    intersectClippingGeometries(basisGeometry, otherGeometry)
  );
  const basisAreaKm2 = clippingAreaKm2(basisGeometry);
  const otherAreaKm2 = clippingAreaKm2(otherGeometry);

  return {
    intersectionAreaKm2,
    oldOverlapPercent: percentage(intersectionAreaKm2, basisAreaKm2),
    newOverlapPercent: percentage(intersectionAreaKm2, otherAreaKm2)
  };
}

function emptyOverlapEvidence(): {
  intersectionAreaKm2: number;
  oldOverlapPercent: number;
  newOverlapPercent: number;
} {
  return {
    intersectionAreaKm2: 0,
    oldOverlapPercent: 0,
    newOverlapPercent: 0
  };
}

function migrationRecord(
  changeType: TurkeyV2HybridMigrationChangeType,
  oldZones: readonly TerritoryZone[],
  newZones: readonly TerritoryZone[],
  evidence: {
    intersectionAreaKm2: number;
    oldOverlapPercent: number;
    newOverlapPercent: number;
  }
): TurkeyV2ZoneMigrationRecord {
  const sourceClassBefore = firstDefined(oldZones.map(readSourceClass));
  const sourceClassAfter = firstDefined(newZones.map(readSourceClass));
  const parentBefore = firstDefined(oldZones.map((zone) => zone.parentId));
  const parentAfter = firstDefined(newZones.map((zone) => zone.parentId));

  return {
    changeType,
    oldZoneIds: oldZones.map((zone) => zone.id).sort(),
    newZoneIds: newZones.map((zone) => zone.id).sort(),
    ...(sourceClassBefore ? { sourceClassBefore } : {}),
    ...(sourceClassAfter ? { sourceClassAfter } : {}),
    ...(parentBefore ? { parentBefore } : {}),
    ...(parentAfter ? { parentAfter } : {}),
    intersectionAreaKm2: evidence.intersectionAreaKm2,
    oldOverlapPercent: evidence.oldOverlapPercent,
    newOverlapPercent: evidence.newOverlapPercent,
    confidence: Math.min(evidence.oldOverlapPercent, evidence.newOverlapPercent),
    manualReviewRequired:
      changeType !== "preserved" ||
      Math.min(evidence.oldOverlapPercent, evidence.newOverlapPercent) < 95,
    reason: migrationReason(changeType, sourceClassBefore, sourceClassAfter)
  };
}

function migrationReason(
  changeType: TurkeyV2HybridMigrationChangeType,
  before: TurkeyV2HybridSourceClass | undefined,
  after: TurkeyV2HybridSourceClass | undefined
): string {
  if (changeType === "source-replaced" || changeType === "source-class-changed") {
    return `Source class changed from ${before ?? "none"} to ${after ?? "none"}.`;
  }

  return `Turkey V2 hybrid migration classified as ${changeType}.`;
}

function toClippingMultiPolygon(geometry: TerritoryGeometry): ClippingMultiPolygon {
  return canonicalizeClippingGeometry(
    geometryToPolygons(geometry)
      .map((polygon) => {
        const rings = polygon
          .map(normalizeRing)
          .filter((ring) => ring.length >= 4 && ringHasArea(ring));
        return rings.length > 0 ? (rings as ClippingPolygon) : undefined;
      })
      .filter((polygon): polygon is ClippingPolygon => Boolean(polygon))
  );
}

function clippingMultiPolygonToTerritoryGeometry(
  geometry: ClippingMultiPolygon
): TerritoryGeometry | undefined {
  const polygons = canonicalizeClippingGeometry(geometry)
    .map((polygon) =>
      polygon.map(normalizeRing).filter((ring) => ring.length >= 4 && ringHasArea(ring))
    )
    .filter((polygon) => polygon.length > 0);

  if (polygons.length === 0) {
    return undefined;
  }

  if (polygons.length === 1) {
    return {
      type: "Polygon",
      coordinates: polygons[0]!
    };
  }

  return {
    type: "MultiPolygon",
    coordinates: polygons
  };
}

function canonicalizeClippingGeometry(geometry: ClippingMultiPolygon): ClippingMultiPolygon {
  return geometry
    .map((polygon) =>
      polygon
        .map((ring, ringIndex) => canonicalizeRing(ring, ringIndex > 0))
        .sort((left, right) => signedRingArea(right) - signedRingArea(left))
    )
    .filter((polygon) => polygon.length > 0)
    .sort(compareClippingPolygons);
}

function canonicalizeRing(ring: readonly LngLat[], hole: boolean): LngLat[] {
  const normalized = normalizeRing(ring);
  const open = normalized.slice(0, -1);

  if (open.length === 0) {
    return [];
  }

  const oriented =
    signedRingArea([...open, open[0]!]) < 0 !== hole ? [...open].reverse() : [...open];
  const startIndex = oriented.reduce((best, point, index) => {
    const current = oriented[best]!;
    return point[0] < current[0] || (point[0] === current[0] && point[1] < current[1])
      ? index
      : best;
  }, 0);
  const rotated = [...oriented.slice(startIndex), ...oriented.slice(0, startIndex)];
  rotated.push(rotated[0]!);
  return rotated;
}

function unionTerritoryGeometries(geometries: readonly TerritoryGeometry[]): ClippingMultiPolygon {
  return unionClippingGeometries(geometries.map(toClippingMultiPolygon));
}

function unionClippingGeometries(
  geometries: readonly ClippingMultiPolygon[]
): ClippingMultiPolygon {
  const nonEmpty = geometries.filter((geometry) => geometry.length > 0);

  if (nonEmpty.length === 0) {
    return [];
  }

  if (nonEmpty.length === 1) {
    return canonicalizeClippingGeometry(nonEmpty[0]!);
  }

  try {
    return canonicalizeClippingGeometry(CLIPPER.union(nonEmpty[0]!, ...nonEmpty.slice(1)));
  } catch {
    return canonicalizeClippingGeometry(nonEmpty.flatMap((geometry) => geometry));
  }
}

function intersectClippingGeometries(
  left: ClippingMultiPolygon,
  right: ClippingMultiPolygon
): ClippingMultiPolygon {
  if (left.length === 0 || right.length === 0) {
    return [];
  }

  try {
    return canonicalizeClippingGeometry(CLIPPER.intersection(left, right));
  } catch {
    return [];
  }
}

function differenceClippingGeometries(
  subject: ClippingMultiPolygon,
  ...clips: readonly ClippingMultiPolygon[]
): ClippingMultiPolygon {
  const nonEmptyClips = clips.filter((clip) => clip.length > 0);

  if (subject.length === 0) {
    return [];
  }

  if (nonEmptyClips.length === 0) {
    return canonicalizeClippingGeometry(subject);
  }

  try {
    return canonicalizeClippingGeometry(CLIPPER.difference(subject, ...nonEmptyClips));
  } catch {
    let result = subject;

    for (const clip of nonEmptyClips) {
      try {
        result = CLIPPER.difference(result, clip);
      } catch {
        continue;
      }
    }

    return canonicalizeClippingGeometry(result);
  }
}

function clippingAreaKm2(geometry: ClippingMultiPolygon): number {
  return roundAreaKm2(
    geometry.reduce((total, polygon) => total + Math.max(0, polygonAreaM2(polygon)), 0) / 1_000_000
  );
}

function polygonAreaM2(polygon: ClippingPolygon): number {
  const [shell, ...holes] = polygon;

  if (!shell) {
    return 0;
  }

  const shellArea = ringAreaM2(shell);
  const holeArea = holes.reduce((total, hole) => total + ringAreaM2(hole), 0);
  return Math.max(0, shellArea - holeArea);
}

function ringAreaM2(ring: readonly LngLat[]): number {
  const geodesicArea = Math.abs(ringGeodesicAreaM2(ring));
  return geodesicArea > 1 ? geodesicArea : Math.abs(ringProjectedAreaM2(ring));
}

function ringGeodesicAreaM2(ring: readonly LngLat[]): number {
  let total = 0;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index];
    const next = ring[index + 1];

    if (!current || !next) {
      continue;
    }

    const deltaLongitude = normalizeRadians(toRadians(next[0] - current[0]));
    total += deltaLongitude * (2 + Math.sin(toRadians(current[1])) + Math.sin(toRadians(next[1])));
  }

  return (total * EARTH_RADIUS_METERS * EARTH_RADIUS_METERS) / 2;
}

function ringProjectedAreaM2(ring: readonly LngLat[]): number {
  const latitude = ring.reduce((total, point) => total + point[1], 0) / Math.max(1, ring.length);
  const metersPerDegreeLatitude = 111_320;
  const metersPerDegreeLongitude = metersPerDegreeLatitude * Math.cos(toRadians(latitude));
  let area = 0;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index];
    const next = ring[index + 1];

    if (!current || !next) {
      continue;
    }

    area +=
      current[0] * metersPerDegreeLongitude * next[1] * metersPerDegreeLatitude -
      next[0] * metersPerDegreeLongitude * current[1] * metersPerDegreeLatitude;
  }

  return area / 2;
}

function normalizeRing(ring: readonly (readonly [number, number])[]): LngLat[] {
  const coordinates = ring
    .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
    .map((point) => [Number(point[0]), Number(point[1])] satisfies LngLat);
  const deduped: LngLat[] = [];

  for (const coordinate of coordinates) {
    const previous = deduped[deduped.length - 1];

    if (previous && pointsEqual(previous, coordinate)) {
      continue;
    }

    deduped.push(coordinate);
  }

  if (deduped.length === 0) {
    return [];
  }

  const first = deduped[0]!;
  const last = deduped[deduped.length - 1]!;

  if (!pointsEqual(first, last)) {
    deduped.push([...first]);
  }

  return deduped;
}

function pointsEqual(left: LngLat, right: LngLat): boolean {
  return (
    Math.abs(left[0] - right[0]) <= COORDINATE_EPSILON &&
    Math.abs(left[1] - right[1]) <= COORDINATE_EPSILON
  );
}

function ringHasArea(ring: readonly LngLat[]): boolean {
  return Math.abs(signedRingArea(ring)) > RING_AREA_EPSILON;
}

function signedRingArea(ring: readonly LngLat[]): number {
  let area = 0;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index];
    const next = ring[index + 1];

    if (current && next) {
      area += current[0] * next[1] - next[0] * current[1];
    }
  }

  return area / 2;
}

function geometryHash(geometry: TerritoryGeometry): string {
  return sha256Hex(
    serializeJsonStable(clippingMultiPolygonToTerritoryGeometry(toClippingMultiPolygon(geometry)))
  );
}

function normalizeTerritoryGeometry(geometry: TerritoryGeometry): TerritoryGeometry {
  return clippingMultiPolygonToTerritoryGeometry(toClippingMultiPolygon(geometry)) ?? geometry;
}

function computeSafeGeometryCenter(geometry: TerritoryGeometry): LngLat {
  const [west, south, east, north] = computeGeometryBBox(geometry);
  const [longitude, latitude] = computeGeometryRepresentativePoint(geometry);

  return [
    clampCoordinate(longitude, west, east),
    clampCoordinate(latitude, south, north)
  ] satisfies LngLat;
}

function clampCoordinate(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return (minimum + maximum) / 2;
  }

  return Math.min(maximum, Math.max(minimum, value));
}

function areaOfUnion(zones: readonly TerritoryZone[]): number {
  return clippingAreaKm2(unionTerritoryGeometries(zones.map((zone) => zone.geometry)));
}

function sumAreas(zones: readonly TerritoryZone[]): number {
  return roundAreaKm2(
    zones.reduce((total, zone) => total + clippingAreaKm2(toClippingMultiPolygon(zone.geometry)), 0)
  );
}

function addNeighbors(
  zones: readonly TerritoryZone[],
  edges: ReadonlyArray<{ from: string; to: string }>
): TerritoryZone[] {
  const neighbors = new Map<string, Set<string>>();

  for (const zone of zones) {
    neighbors.set(zone.id, new Set());
  }

  for (const edge of edges) {
    neighbors.get(edge.from)?.add(edge.to);
    neighbors.get(edge.to)?.add(edge.from);
  }

  return zones
    .map((zone) => ({
      ...zone,
      neighborIds: [...(neighbors.get(zone.id) ?? new Set<string>())].sort()
    }))
    .sort(compareZones);
}

function countDuplicates(values: readonly string[]): number {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.values()].filter((count) => count > 1).length;
}

function findDuplicates(values: readonly string[]): string[] {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort();
}

function firstDefined<T>(values: readonly (T | undefined)[]): T | undefined {
  return values.find((value): value is T => value !== undefined);
}

function territoryMetadata(zone: TerritoryZone): Record<string, unknown> {
  return isRecord(zone.properties.territory) ? zone.properties.territory : {};
}

function defaultRedistributionPolicy(providerClass: TurkeyV2HybridProviderClass): string {
  return providerClass === "runtime"
    ? "runtime-only"
    : providerClass === "experimental"
      ? "permission-required"
      : "allowed";
}

function defaultCommercialUsePolicy(providerClass: TurkeyV2HybridProviderClass): string {
  return providerClass === "experimental" ? "unknown" : "allowed";
}

function defaultModificationPolicy(providerClass: TurkeyV2HybridProviderClass): string {
  return providerClass === "experimental" ? "unknown" : "allowed";
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function readString(input: unknown): string | undefined {
  return typeof input === "string" && input.trim().length > 0 ? input.trim() : undefined;
}

function readNumber(input: unknown): number | undefined {
  return typeof input === "number" && Number.isFinite(input) ? input : undefined;
}

function readBoolean(input: unknown): boolean | undefined {
  return typeof input === "boolean" ? input : undefined;
}

function issueKey(issue: TerritoryValidationIssue): string {
  return [issue.code, issue.path, issue.zoneId ?? "", issue.parentId ?? "", issue.message].join(
    "|"
  );
}

function compareZones(left: TerritoryZone, right: TerritoryZone): number {
  return left.id.localeCompare(right.id);
}

function sortZones(zones: readonly TerritoryZone[]): TerritoryZone[] {
  return [...zones].sort(
    (left, right) =>
      readStableId(left).localeCompare(readStableId(right)) ||
      left.id.localeCompare(right.id) ||
      geometryHash(left.geometry).localeCompare(geometryHash(right.geometry))
  );
}

function compareRejections(
  left: TurkeyV2HybridRejectionRecord,
  right: TurkeyV2HybridRejectionRecord
): number {
  return (
    left.reason.localeCompare(right.reason) ||
    left.zoneId.localeCompare(right.zoneId) ||
    left.providerId.localeCompare(right.providerId)
  );
}

function compareMigrationRecords(
  left: TurkeyV2ZoneMigrationRecord,
  right: TurkeyV2ZoneMigrationRecord
): number {
  return (
    left.changeType.localeCompare(right.changeType) ||
    left.oldZoneIds.join("|").localeCompare(right.oldZoneIds.join("|")) ||
    left.newZoneIds.join("|").localeCompare(right.newZoneIds.join("|"))
  );
}

function compareClippingPolygons(left: ClippingPolygon, right: ClippingPolygon): number {
  const leftBbox = clippingBBox([left]);
  const rightBbox = clippingBBox([right]);

  return (
    leftBbox[1] - rightBbox[1] ||
    leftBbox[0] - rightBbox[0] ||
    leftBbox[3] - rightBbox[3] ||
    leftBbox[2] - rightBbox[2] ||
    JSON.stringify(left).localeCompare(JSON.stringify(right))
  );
}

function clippingBBox(geometry: ClippingMultiPolygon): [number, number, number, number] {
  const points = geometry.flat(2);

  if (points.length === 0) {
    return [0, 0, 0, 0];
  }

  return [
    Math.min(...points.map((point) => point[0])),
    Math.min(...points.map((point) => point[1])),
    Math.max(...points.map((point) => point[0])),
    Math.max(...points.map((point) => point[1]))
  ];
}

function sortIssues(issues: readonly TurkeyV2HybridIssue[]): TurkeyV2HybridIssue[] {
  return [...issues].sort(
    (left, right) =>
      left.severity.localeCompare(right.severity) ||
      left.code.localeCompare(right.code) ||
      (left.zoneId ?? "").localeCompare(right.zoneId ?? "") ||
      left.message.localeCompare(right.message)
  );
}

function percentage(value: number, total: number): number {
  return total <= 0 ? 0 : roundPercent((value / total) * 100);
}

function roundAreaKm2(value: number): number {
  return Number(value.toFixed(6));
}

function roundPercent(value: number): number {
  return Number(value.toFixed(6));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function normalizeRadians(radians: number): number {
  if (radians > Math.PI) {
    return radians - Math.PI * 2;
  }

  if (radians < -Math.PI) {
    return radians + Math.PI * 2;
  }

  return radians;
}
