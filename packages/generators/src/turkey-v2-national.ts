import {
  TERRITORY_SCHEMA_VERSION,
  computeGeometryBBox,
  validateGeometryDataset
} from "@territory-kit/dataset";
import { validateTurkeyV2Dataset } from "@territory-kit/dataset/turkey-v2";
import type {
  LngLat,
  TerritoryAdminLevel,
  TerritoryAdjacencyArtifact,
  TerritoryDataset,
  TerritoryGeometry,
  TerritorySemanticAdminType,
  TerritorySourceClass,
  TerritoryValidationIssue,
  TerritoryZone
} from "@territory-kit/dataset";
import { buildTerritoryAdjacency } from "./adjacency.js";
import { computeGeometryRepresentativePoint } from "./geometry-repair.js";
import { buildTerritoryRenderArtifacts } from "./render-artifacts.js";
import type { TerritoryRenderBuildResult } from "./render-artifacts.js";
import {
  TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION,
  buildTurkeyV2HybridBatch,
  createTurkeyV2ZoneMigrationPlan
} from "./turkey-adm3.js";
import {
  TURKEY_V2_NATIONAL_EXPECTED_COUNTS,
  validateTurkeyV2NationalArtifactIntegrity,
  validateTurkeyV2NationalCompleteness
} from "./turkey-v2-national-validation.js";
import type {
  TurkeyV2NationalValidationIssue,
  TurkeyV2NationalValidationResult
} from "./turkey-v2-national-validation.js";
import type {
  TurkeyV2HybridAttributionManifest,
  TurkeyV2HybridBatchBuildResult,
  TurkeyV2HybridBatchSourceEntry,
  TurkeyV2HybridDistrictBuildResult,
  TurkeyV2HybridDistributionPolicyManifest,
  TurkeyV2HybridGeneratedOptions,
  TurkeyV2HybridLicenseManifest,
  TurkeyV2HybridProvenanceItem,
  TurkeyV2ZoneMigrationPlan
} from "./turkey-v2-hybrid.js";
import {
  createDatasetGeometryHash,
  isRecord,
  serializeJsonStable,
  sha256Hex
} from "./sources/utils.js";

export const TURKEY_V2_NATIONAL_DATASET_ID = "territory-kit-tr-v2-playable" as const;
export const TURKEY_V2_NATIONAL_DATASET_VERSION = "2.0.0" as const;
export const TURKEY_V2_NATIONAL_SOURCE_LOCK_SCHEMA_VERSION =
  "territorykit-tr-v2-national-source-lock@1" as const;
export const TURKEY_V2_NATIONAL_COVERAGE_SCHEMA_VERSION =
  "territorykit-tr-v2-national-coverage@1" as const;
export const TURKEY_V2_NATIONAL_QUALITY_SCHEMA_VERSION =
  "territorykit-tr-v2-national-quality@1" as const;
export const TURKEY_V2_NATIONAL_HIERARCHY_SCHEMA_VERSION =
  "territorykit-tr-v2-national-hierarchy@1" as const;
export const TURKEY_V2_NATIONAL_PROVENANCE_SCHEMA_VERSION =
  "territorykit-tr-v2-national-provenance@1" as const;
export const TURKEY_V2_NATIONAL_REGISTRY_ENTRY_SCHEMA_VERSION =
  "territorykit-tr-v2-national-registry-entry@1" as const;
export const TURKEY_V2_NATIONAL_BUILD_SUMMARY_SCHEMA_VERSION =
  "territorykit-tr-v2-national-build-summary@1" as const;

/**
 * Expected count of ADM0 zones for a complete Turkey national dataset.
 * Turkey has exactly 1 country-level zone.
 */
export const TURKEY_V2_ADM0_EXPECTED_COUNT = TURKEY_V2_NATIONAL_EXPECTED_COUNTS.ADM0;

/**
 * Expected count of ADM1 zones for a complete Turkey national dataset.
 * Turkey has exactly 81 provinces (il).
 */
export const TURKEY_V2_ADM1_EXPECTED_COUNT = TURKEY_V2_NATIONAL_EXPECTED_COUNTS.ADM1;

/**
 * Expected count of ADM2 zones for a complete Turkey national dataset.
 * Turkey has exactly 973 districts (ilçe).
 */
export const TURKEY_V2_ADM2_EXPECTED_COUNT = TURKEY_V2_NATIONAL_EXPECTED_COUNTS.ADM2;

export type TurkeyV2NationalOutputMode = "plan" | "build" | "publish-ready";
export type TurkeyV2NationalBuildMode = "partial" | "publish-ready";
export type TurkeyV2NationalSourceStatus = "artifact-loaded" | "disabled" | "not-built";

export interface TurkeyV2NationalSourceLock {
  schemaVersion: typeof TURKEY_V2_NATIONAL_SOURCE_LOCK_SCHEMA_VERSION;
  datasetId: string;
  datasetVersion: string;
  buildDate: string;
  sourceLockVersion: "1";
  adm0Adm2: TurkeyV2NationalAdmSourceLock;
  officialAdm3: TurkeyV2NationalRealSourceLock;
  osm: TurkeyV2NationalOsmSourceLock;
  generated: TurkeyV2NationalGeneratedSourceLock;
  hybridPipeline: {
    schemaVersion: string;
    sourcePriority: readonly ["official", "osm", "generated"];
    minimumDistrictCoveragePercent: 99.99;
  };
  geometry: {
    crs: "EPSG:4326";
    repairBackend: "none" | "repository-pipeline";
    simplification: "source-and-render-tiers";
  };
  distribution: {
    largeGeometryInNpmPackage: false;
    registryCdnOfflineModel: true;
  };
  contentHash: string;
}

export interface TurkeyV2NationalAdmSourceLock {
  provider: string;
  sourceId: string;
  sourceUrl: string;
  downloadUrl?: string;
  sourceDate: string;
  retrievedAt?: string;
  license: string;
  licenseUrl?: string;
  attribution: string;
  redistributionAllowed: boolean;
  commercialUseAllowed: boolean;
  modificationAllowed: boolean;
  sha256: string;
  byteSize: number;
  levels: {
    ADM0: TurkeyV2NationalAdmLevelLock;
    ADM1: TurkeyV2NationalAdmLevelLock;
    ADM2: TurkeyV2NationalAdmLevelLock;
  };
}

export interface TurkeyV2NationalAdmLevelLock {
  archiveMember: string;
  expectedFeatureCount: number;
  actualFeatureCount: number;
  sha256: string;
  byteSize: number;
}

export interface TurkeyV2NationalRealSourceLock {
  status: TurkeyV2NationalSourceStatus;
  approvedProviderCount: number;
  loadedZoneCount: number;
  providers: TurkeyV2NationalRealProviderLock[];
}

export interface TurkeyV2NationalRealProviderLock {
  providerId: string;
  providerName: string;
  provinceCode: string;
  sourceUrl?: string;
  sourceDate?: string;
  license?: string;
  attribution?: string;
  redistributionPolicy?: string;
  commercialUsePolicy?: string;
  modificationPolicy?: string;
  checksum?: string;
  byteSize?: number;
}

export interface TurkeyV2NationalOsmSourceLock {
  status: TurkeyV2NationalSourceStatus;
  providerCount: number;
  loadedZoneCount: number;
  sourceUrl?: string;
  downloadUrl?: string;
  license: "ODbL-1.0";
  attribution: string;
  checksum?: string;
  byteSize?: number;
}

export interface TurkeyV2NationalGeneratedSourceLock {
  algorithmVersion: typeof TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION;
  seed: string;
  profilePolicy: "auto";
  generatorConfigHash: string;
}

export interface TurkeyV2NationalSourceCatalog {
  zones?: readonly TerritoryZone[];
  status?: TurkeyV2NationalSourceStatus;
  providers?: readonly TurkeyV2NationalRealProviderLock[];
}

export interface TurkeyV2DistrictBuildOverride {
  generated?: TurkeyV2HybridGeneratedOptions;
}

export interface TurkeyV2NationalBuildOptions {
  adm0Adm2Dataset: TerritoryDataset;
  officialSources?: TurkeyV2NationalSourceCatalog;
  osmSources?: TurkeyV2NationalSourceCatalog;
  generatedDefaults?: TurkeyV2HybridGeneratedOptions;
  districtOverrides?: Readonly<Record<string, TurkeyV2DistrictBuildOverride>>;
  sourceLock: TurkeyV2NationalSourceLock;
  buildDate: string;
  datasetVersion: string;
  datasetId?: string;
  outputMode?: TurkeyV2NationalOutputMode;
  continueOnError?: boolean;
  districtLimit?: number;
  buildArtifacts?: {
    query?: boolean;
    render?: boolean;
    binaryIndex?: boolean;
    mvt?: boolean;
    adjacency?: boolean;
  };
}

export interface TurkeyV2NationalBuildResult {
  schemaVersion: typeof TURKEY_V2_NATIONAL_BUILD_SUMMARY_SCHEMA_VERSION;
  dataset: TerritoryDataset;
  levels: {
    ADM0: TerritoryDataset;
    ADM1: TerritoryDataset;
    ADM2: TerritoryDataset;
    ADM3: TerritoryDataset;
  };
  districts: TurkeyV2HybridDistrictBuildResult[];
  hybridBatch: TurkeyV2HybridBatchBuildResult;
  coverage: TurkeyV2NationalCoverageReport;
  quality: TurkeyV2NationalQualityReport;
  hierarchy: TurkeyV2NationalHierarchyReport;
  provenance: TurkeyV2NationalProvenanceReport;
  attribution: TurkeyV2HybridAttributionManifest;
  licenses: TurkeyV2HybridLicenseManifest;
  distributionPolicy: TurkeyV2HybridDistributionPolicyManifest;
  migration: TurkeyV2ZoneMigrationPlan;
  sourceLock: TurkeyV2NationalSourceLock;
  adjacency?: TerritoryAdjacencyArtifact;
  renderArtifacts?: TerritoryRenderBuildResult;
  registry: TurkeyV2NationalRegistryEntry;
  artifactPlan: TurkeyV2NationalArtifactPlan;
  checksums: TurkeyV2NationalChecksums;
  deterministicHash: string;
  failures: Array<{ districtId: string; message: string }>;
}

export interface TurkeyV2NationalCoverageReport {
  schemaVersion: typeof TURKEY_V2_NATIONAL_COVERAGE_SCHEMA_VERSION;
  datasetId: string;
  datasetVersion: string;
  buildDate: string;
  sourceLockHash: string;
  deterministicHash: string;
  adm0Count: number;
  provinceCount: number;
  districtCount: number;
  successfulDistrictCount: number;
  failedDistrictCount: number;
  adm3FinalZoneCount: number;
  officialZoneCount: number;
  osmZoneCount: number;
  generatedZoneCount: number;
  officialEffectiveAreaKm2: number;
  osmEffectiveAreaKm2: number;
  generatedEffectiveAreaKm2: number;
  realCoveragePercent: number;
  generatedCoveragePercent: number;
  finalCoveragePercent: number;
  remainingGapAreaKm2: number;
  districtsAtOrAbove9999: number;
  districtsBelow9999: string[];
  officialOnlyDistricts: string[];
  osmOnlyDistricts: string[];
  generatedOnlyDistricts: string[];
  hybridDistricts: string[];
  profileDistribution: Record<string, number>;
  algorithmVersion: typeof TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION;
  sourceStatus: {
    official: TurkeyV2NationalSourceStatus;
    osm: TurkeyV2NationalSourceStatus;
    generated: "built" | "disabled";
  };
  provinces: TurkeyV2NationalProvinceCoverage[];
  districts: TurkeyV2NationalDistrictCoverage[];
}

export interface TurkeyV2NationalProvinceCoverage {
  provinceCode: string;
  provinceName: string;
  districtCount: number;
  successfulDistrictCount: number;
  finalZoneCount: number;
  officialCount: number;
  officialAreaKm2: number;
  officialCoveragePercent: number;
  osmCount: number;
  osmAreaKm2: number;
  osmCoveragePercent: number;
  generatedCount: number;
  generatedAreaKm2: number;
  generatedCoveragePercent: number;
  finalCoveragePercent: number;
  gapAreaKm2: number;
  qualityStatus: "ok" | "failed";
  primaryCoverageClass: TerritorySourceClass;
}

export interface TurkeyV2NationalDistrictCoverage {
  districtId: string;
  districtCode: string;
  districtName: string;
  provinceCode: string;
  provinceName: string;
  parentId: string;
  officialCount: number;
  osmCount: number;
  generatedCount: number;
  zoneCount: number;
  profile: string;
  realCoveragePercent: number;
  generatedCoveragePercent: number;
  finalCoveragePercent: number;
  gapAreaKm2: number;
  qualityStatus: "ok" | "failed";
  deterministicHash: string;
  artifactPath: string;
}

export interface TurkeyV2NationalQualityReport {
  schemaVersion: typeof TURKEY_V2_NATIONAL_QUALITY_SCHEMA_VERSION;
  ok: boolean;
  buildMode: TurkeyV2NationalBuildMode;
  publishReady: boolean;
  hardGateFailures: string[];
  publishReadyGateFailures: string[];
  completeness: {
    expected: {
      adm0Count: typeof TURKEY_V2_ADM0_EXPECTED_COUNT;
      adm1Count: typeof TURKEY_V2_ADM1_EXPECTED_COUNT;
      adm2Count: typeof TURKEY_V2_ADM2_EXPECTED_COUNT;
    };
    actual: {
      adm0Count: number;
      adm1Count: number;
      adm2Count: number;
      successfulAdm2Count: number;
      failedDistrictCount: number;
    };
    strictIssueCount: number;
    strictIssues: TurkeyV2NationalValidationIssue[];
  };
  summary: {
    adm0Count: number;
    adm1Count: number;
    adm2Count: number;
    adm3Count: number;
    failedDistrictCount: number;
    districtsBelow9999: number;
    orphanCount: number;
    hierarchyCycleCount: number;
    duplicateStableIdCount: number;
    invalidFinalGeometryCount: number;
    emptyFinalGeometryCount: number;
    effectiveSiblingOverlapCount: number;
    realGeneratedOverlapCount: number;
    parentContainmentErrorCount: number;
    missingProvenanceCount: number;
    missingAttributionLicenseCount: number;
    generatedMetadataErrorCount: number;
    strictTrV2ValidationErrorCount: number;
    adjacencyIntegrityErrorCount: number;
    registryArtifactChecksumErrors: number;
    warningCount: number;
  };
  strictValidation: {
    ok: boolean;
    issues: TerritoryValidationIssue[];
  };
  geometryValidation: {
    ok: boolean;
    issueCount: number;
    errorCount: number;
  };
  artifactIntegrity: TurkeyV2NationalValidationResult;
  gates: Record<string, boolean>;
  publishReadyGates: Record<string, boolean>;
}

export interface TurkeyV2NationalHierarchyReport {
  schemaVersion: typeof TURKEY_V2_NATIONAL_HIERARCHY_SCHEMA_VERSION;
  datasetId: string;
  adm0Id: string;
  countryChildIds: string[];
  provinceCount: number;
  districtCount: number;
  adm3Count: number;
  orphanCount: number;
  cycleCount: number;
  duplicateIdCount: number;
  parentChildMismatchCount: number;
  provinceCodeMismatchCount: number;
  districtCodeMissingCount: number;
}

export interface TurkeyV2NationalProvenanceReport {
  schemaVersion: typeof TURKEY_V2_NATIONAL_PROVENANCE_SCHEMA_VERSION;
  buildDate: string;
  summary: {
    sourceClasses: Record<string, number>;
    providerCount: number;
    licenseCount: number;
    zoneCount: number;
    sourceLockHash: string;
  };
  zones: TurkeyV2HybridProvenanceItem[];
}

export interface TurkeyV2NationalRegistryEntry {
  schemaVersion: typeof TURKEY_V2_NATIONAL_REGISTRY_ENTRY_SCHEMA_VERSION;
  registryVersion: "1";
  generatedAt: string;
  datasets: [
    {
      id: string;
      displayName: string;
      version: string;
      schemaVersion: typeof TERRITORY_SCHEMA_VERSION;
      country: { alpha2: "TR"; alpha3: "TUR"; name: "Türkiye" };
      levels: readonly TerritoryAdminLevel[];
      prerelease: boolean;
      coverage: {
        provinceCount: number;
        districtCount: number;
        adm3ZoneCount: number;
        finalCoveragePercent: number;
      };
      sourceClassSummary: Record<string, number>;
      source: { provider: string; version: string; attribution: string };
      license: { id: "mixed"; attribution: string };
      artifacts: TurkeyV2NationalRegistryArtifact[];
    }
  ];
}

export interface TurkeyV2NationalRegistryArtifact {
  id: string;
  purpose: "query" | "render" | "index" | "metadata" | "adjacency";
  format: "territory-json" | "geojson" | "json" | "mvt" | "tksi";
  levels?: readonly TerritoryAdminLevel[];
  detail?: string;
  path: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  compression: "none";
}

export interface TurkeyV2NationalArtifactPlan {
  schemaVersion: "territorykit-tr-v2-national-artifact-plan@1";
  datasetId: string;
  datasetVersion: string;
  largeGeometryEmbeddedInNpm: false;
  commitPolicy: {
    commit: string[];
    external: string[];
  };
  artifacts: TurkeyV2NationalRegistryArtifact[];
}

export interface TurkeyV2NationalChecksums {
  schemaVersion: "territorykit-tr-v2-national-checksums@1";
  files: Record<string, { sha256: string; byteSize: number }>;
}

export interface TurkeyV2NationalArtifactPayloads {
  json: Map<string, unknown>;
  text: Map<string, string>;
  bytes: Map<string, Uint8Array | string>;
}

interface NormalizedHierarchy {
  adm0: TerritoryZone;
  adm1: TerritoryZone[];
  adm2: TerritoryZone[];
  provinceById: Map<string, TerritoryZone>;
  provinceNameByCode: Map<string, string>;
}

const TURKEY_V2_NATIONAL_MANDATORY_ARTIFACT_IDS = ["dataset", "coverage", "query", "adm3"] as const;

export function createTurkeyV2NationalSourceLock(input: {
  adm0Adm2: Omit<TurkeyV2NationalAdmSourceLock, "levels"> & {
    levels: TurkeyV2NationalAdmSourceLock["levels"];
  };
  buildDate: string;
  datasetVersion?: string;
  officialAdm3?: Omit<TurkeyV2NationalRealSourceLock, "status" | "loadedZoneCount"> & {
    status?: TurkeyV2NationalSourceStatus;
    loadedZoneCount?: number;
  };
  osm?: Partial<TurkeyV2NationalOsmSourceLock>;
  generated?: Partial<TurkeyV2NationalGeneratedSourceLock>;
}): TurkeyV2NationalSourceLock {
  const generated = {
    algorithmVersion: TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION,
    seed: input.generated?.seed ?? "territory-kit-tr-v2-national",
    profilePolicy: "auto" as const,
    generatorConfigHash:
      input.generated?.generatorConfigHash ??
      sha256Hex(
        serializeJsonStable({
          algorithmVersion: TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION,
          seed: input.generated?.seed ?? "territory-kit-tr-v2-national",
          profilePolicy: "auto"
        })
      )
  };
  const lockWithoutHash = {
    schemaVersion: TURKEY_V2_NATIONAL_SOURCE_LOCK_SCHEMA_VERSION,
    datasetId: TURKEY_V2_NATIONAL_DATASET_ID,
    datasetVersion: input.datasetVersion ?? TURKEY_V2_NATIONAL_DATASET_VERSION,
    buildDate: input.buildDate,
    sourceLockVersion: "1" as const,
    adm0Adm2: input.adm0Adm2,
    officialAdm3: {
      status: input.officialAdm3?.status ?? "not-built",
      approvedProviderCount: input.officialAdm3?.approvedProviderCount ?? 0,
      loadedZoneCount: input.officialAdm3?.loadedZoneCount ?? 0,
      providers: [...(input.officialAdm3?.providers ?? [])].sort((left, right) =>
        left.providerId.localeCompare(right.providerId)
      )
    },
    osm: {
      status: input.osm?.status ?? "not-built",
      providerCount: input.osm?.providerCount ?? 0,
      loadedZoneCount: input.osm?.loadedZoneCount ?? 0,
      ...(input.osm?.sourceUrl ? { sourceUrl: input.osm.sourceUrl } : {}),
      ...(input.osm?.downloadUrl ? { downloadUrl: input.osm.downloadUrl } : {}),
      license: "ODbL-1.0" as const,
      attribution: input.osm?.attribution ?? "OpenStreetMap contributors, ODbL 1.0",
      ...(input.osm?.checksum ? { checksum: input.osm.checksum } : {}),
      ...(input.osm?.byteSize !== undefined ? { byteSize: input.osm.byteSize } : {})
    },
    generated,
    hybridPipeline: {
      schemaVersion: "territorykit-tr-v2-hybrid-batch@1",
      sourcePriority: ["official", "osm", "generated"] as const,
      minimumDistrictCoveragePercent: 99.99 as const
    },
    geometry: {
      crs: "EPSG:4326" as const,
      repairBackend: "none" as const,
      simplification: "source-and-render-tiers" as const
    },
    distribution: {
      largeGeometryInNpmPackage: false as const,
      registryCdnOfflineModel: true as const
    }
  };

  return {
    ...lockWithoutHash,
    contentHash: `sha256:${sha256Hex(serializeJsonStable(lockWithoutHash))}`
  };
}

function resolveNationalArtifactOptions(input: TurkeyV2NationalBuildOptions["buildArtifacts"]): {
  render: boolean;
  adjacency: boolean;
} {
  return {
    render: input?.render === true && input.mvt !== false,
    adjacency: input?.adjacency === true
  };
}

export async function buildTurkeyV2NationalDataset(
  options: TurkeyV2NationalBuildOptions
): Promise<TurkeyV2NationalBuildResult> {
  const datasetId = options.datasetId ?? TURKEY_V2_NATIONAL_DATASET_ID;
  const buildDate = options.buildDate;
  const datasetVersion = options.datasetVersion;
  const generatedDefaults = options.generatedDefaults ?? {
    enabled: true,
    profile: "auto",
    seed: options.sourceLock.generated.seed
  };
  const hierarchy = normalizeTurkeyAdmHierarchy(options.adm0Adm2Dataset, datasetId);
  const selectedAdm2 = hierarchy.adm2.slice(0, options.districtLimit ?? undefined);
  const officialZones = normalizeAdm3SourceZones(options.officialSources?.zones ?? [], datasetId);
  const osmZones = normalizeAdm3SourceZones(options.osmSources?.zones ?? [], datasetId);
  const sourcesByDistrict = createSourcesByDistrict(selectedAdm2, officialZones, osmZones);
  const hybridBatch = await buildTurkeyV2HybridBatch({
    districts: selectedAdm2,
    sourcesByDistrict,
    generatedDefaults,
    buildDate,
    continueOnError: true,
    fallbackToGeneratedOnQualityFailure: true,
    datasetId: `${datasetId}-adm3`
  });
  const adm3Zones = hybridBatch.districts
    .flatMap((district) =>
      district.effective.zones.map((zone) => ({
        ...zone,
        datasetId
      }))
    )
    .sort(compareZones);
  const adm2ChildIds = new Map(
    hybridBatch.districts.map((district) => [
      district.coverage.districtId,
      district.effective.zones.map((zone) => zone.id).sort()
    ])
  );
  const adm2 = selectedAdm2
    .map((district) => ({
      ...district,
      datasetId,
      childIds: adm2ChildIds.get(district.id) ?? []
    }))
    .sort(compareZones);
  const adm2ById = new Map(adm2.map((zone) => [zone.id, zone]));
  const adm1 = hierarchy.adm1
    .map((province) => ({
      ...province,
      datasetId,
      childIds: adm2
        .filter((district) => district.parentId === province.id)
        .map((district) => district.id)
        .sort()
    }))
    .sort(compareZones);
  const adm0 = {
    ...hierarchy.adm0,
    datasetId,
    childIds: adm1.map((province) => province.id).sort()
  };
  const zones = [adm0, ...adm1, ...adm2, ...adm3Zones].sort(compareZones);
  const dataset: TerritoryDataset = {
    manifest: {
      schemaVersion: TERRITORY_SCHEMA_VERSION,
      datasetId,
      datasetVersion,
      sourceDate: options.sourceLock.adm0Adm2.sourceDate,
      buildDate,
      geometryHash: createDatasetGeometryHash({ zones }),
      adminLevels: ["ADM0", "ADM1", "ADM2", "ADM3"],
      countryCodes: ["TR"],
      crs: "EPSG:4326",
      geometryDetail: "source",
      license: "mixed",
      name: "Turkey V2 playable national dataset",
      description:
        "Playable Turkey V2 national dataset with official/OSM ADM3 polygons where available and generated game-zone fallback elsewhere.",
      sourceProvider: "TerritoryKit Turkey V2 national hybrid build",
      boundaryPolicy: "canonical-adm0-adm2-official-osm-generated-adm3",
      disputedAreaPolicy: "source",
      worldview: "TR",
      attribution:
        "OCHA COD-AB Türkiye ADM0-ADM2; approved municipal open data where available; OpenStreetMap ODbL if built; TerritoryKit generated game zones"
    },
    zones
  };
  const levels = createLevelDatasets(dataset);
  const artifactOptions = resolveNationalArtifactOptions(options.buildArtifacts);
  const adjacency = artifactOptions.adjacency
    ? await buildTerritoryAdjacency(levels.ADM3, {
        buildDate,
        includePointTouches: false,
        sameAdminLevelOnly: true,
        sameParentOnly: true,
        minimumSharedBoundaryMeters: 0.001,
        qualityChecks: {
          coordinates: true,
          rings: true,
          selfIntersections: false,
          holes: false,
          bbox: true,
          center: false,
          antimeridian: true,
          parentContainment: false,
          siblingOverlaps: false
        }
      })
    : undefined;
  const deterministicHash = sha256Hex(
    serializeJsonStable({
      datasetGeometryHash: dataset.manifest.geometryHash,
      sourceLockHash: options.sourceLock.contentHash,
      hybridHash: hybridBatch.deterministicHash,
      districtHashes: hybridBatch.districts.map((district) => district.deterministicHash)
    })
  );
  const coverage = createNationalCoverage({
    datasetId,
    datasetVersion,
    buildDate,
    deterministicHash,
    sourceLockHash: options.sourceLock.contentHash,
    hierarchy,
    adm2ById,
    districts: hybridBatch.districts,
    failures: hybridBatch.failures,
    sourceStatus: {
      official: options.officialSources?.status ?? options.sourceLock.officialAdm3.status,
      osm: options.osmSources?.status ?? options.sourceLock.osm.status,
      generated: generatedDefaults.enabled ? "built" : "disabled"
    }
  });
  const hierarchyReport = createNationalHierarchyReport(dataset, adm0.id);
  const provenance = createNationalProvenance(
    buildDate,
    options.sourceLock.contentHash,
    hybridBatch
  );
  const attribution = createNationalAttribution(buildDate, hybridBatch);
  const licenses = createNationalLicenses(attribution);
  const distributionPolicy = createNationalDistributionPolicy(hybridBatch);
  const migration = createTurkeyV2ZoneMigrationPlan({
    buildDate,
    oldZones: [],
    newZones: adm3Zones
  });
  const renderArtifacts = artifactOptions.render
    ? buildTerritoryRenderArtifacts({
        dataset: levels.ADM3,
        format: "mvt",
        layerId: "territory_adm3",
        policies: [{ adminLevel: "ADM3", minZoom: 10, maxZoom: 12 }],
        minZoom: 10,
        maxZoom: 12,
        buildDate
      })
    : undefined;
  const coreArtifactFiles = createCoreNationalArtifactFiles({
    dataset,
    deterministicHash,
    sourceLock: options.sourceLock,
    coverage,
    hierarchy: hierarchyReport,
    provenance,
    attribution,
    licenses,
    distributionPolicy,
    migration,
    levels,
    ...(adjacency ? { adjacency: adjacency.artifact } : {}),
    ...(renderArtifacts ? { renderArtifacts } : {})
  });
  const coreChecksums = createChecksums(coreArtifactFiles);
  const baseRegistry = createNationalRegistryEntry({
    datasetId,
    datasetVersion,
    buildDate,
    coverage,
    sourceLock: options.sourceLock,
    artifactHashes: coreChecksums.files,
    includeQuality: false,
    includeRender: Boolean(renderArtifacts),
    includeAdjacency: Boolean(adjacency)
  });
  const baseArtifactIntegrity = await validateTurkeyV2NationalArtifactIntegrity({
    registry: baseRegistry,
    checksums: coreChecksums,
    mandatoryArtifactIds: TURKEY_V2_NATIONAL_MANDATORY_ARTIFACT_IDS,
    producedPaths: new Set(coreArtifactFiles.keys())
  });
  const buildMode: TurkeyV2NationalBuildMode =
    options.outputMode === "publish-ready" && options.districtLimit === undefined
      ? "publish-ready"
      : "partial";
  const quality = createNationalQuality({
    dataset,
    coverage,
    hierarchy: hierarchyReport,
    hybridBatch,
    sourceLock: options.sourceLock,
    artifactIntegrity: baseArtifactIntegrity,
    adjacencyIssueCount:
      adjacency?.issues.filter((issue) => issue.severity === "error").length ?? 0,
    buildMode
  });
  const filesWithQuality = new Map(coreArtifactFiles);
  filesWithQuality.set("quality-report.json", serializeJsonArtifact(quality));
  const checksumsWithQuality = createChecksums(filesWithQuality);
  const registry = createNationalRegistryEntry({
    datasetId,
    datasetVersion,
    buildDate,
    coverage,
    sourceLock: options.sourceLock,
    artifactHashes: checksumsWithQuality.files,
    includeQuality: true,
    includeRender: Boolean(renderArtifacts),
    includeAdjacency: Boolean(adjacency)
  });
  const artifactPlan = createNationalArtifactPlan(
    datasetId,
    datasetVersion,
    registry.datasets[0].artifacts
  );
  const checksumFiles = new Map(filesWithQuality);
  checksumFiles.set("registry-entry.json", serializeJsonArtifact(registry));
  checksumFiles.set("artifact-plan.json", serializeJsonArtifact(artifactPlan));
  const checksums = createChecksums(checksumFiles);

  return {
    schemaVersion: TURKEY_V2_NATIONAL_BUILD_SUMMARY_SCHEMA_VERSION,
    dataset,
    levels,
    districts: hybridBatch.districts,
    hybridBatch,
    coverage,
    quality,
    hierarchy: hierarchyReport,
    provenance,
    attribution,
    licenses,
    distributionPolicy,
    migration,
    sourceLock: options.sourceLock,
    ...(adjacency ? { adjacency: adjacency.artifact } : {}),
    ...(renderArtifacts ? { renderArtifacts } : {}),
    registry,
    artifactPlan,
    checksums,
    deterministicHash,
    failures: hybridBatch.failures
  };
}

export function createTurkeyV2NationalArtifactPayloads(input: {
  result: TurkeyV2NationalBuildResult;
  includeDataset?: boolean;
  includeGeoJson?: boolean;
  includeRender?: boolean;
}): TurkeyV2NationalArtifactPayloads {
  const json = new Map<string, unknown>([
    ["manifest.json", createDatasetManifestJson(input.result)],
    ["source-lock.json", input.result.sourceLock],
    ["build-summary.json", createBuildSummary(input.result)],
    ["coverage.json", input.result.coverage],
    ["quality-report.json", input.result.quality],
    ["hierarchy-report.json", input.result.hierarchy],
    ["provenance.json", input.result.provenance],
    ["attribution.json", input.result.attribution],
    ["licenses.json", input.result.licenses],
    ["distribution-policy.json", input.result.distributionPolicy],
    ["migration-plan.json", input.result.migration],
    ["registry-entry.json", input.result.registry],
    ["artifact-plan.json", input.result.artifactPlan],
    ["levels/ADM0/dataset.json", input.result.levels.ADM0],
    ["levels/ADM1/dataset.json", input.result.levels.ADM1],
    ["levels/ADM2/dataset.json", input.result.levels.ADM2],
    ["levels/ADM3/dataset.json", input.result.levels.ADM3],
    ["query/query-artifact.json", createNationalQueryArtifact(input.result.dataset)]
  ]);
  const attributionText = input.result.attribution.text.endsWith("\n")
    ? input.result.attribution.text
    : `${input.result.attribution.text}\n`;
  const text = new Map<string, string>([["attribution.txt", attributionText]]);
  const bytes = new Map<string, Uint8Array | string>();

  if (input.includeDataset) {
    json.set("dataset.json", input.result.dataset);
  }

  json.set("checksums.json", input.result.checksums);

  if (input.includeGeoJson) {
    json.set(
      "levels/ADM3/full.geojson",
      territoryDatasetToFeatureCollection(input.result.levels.ADM3)
    );
  }

  if (input.result.adjacency) {
    json.set("levels/ADM3/adjacency/adjacency.json", input.result.adjacency);
  }

  if (input.includeRender && input.result.renderArtifacts) {
    for (const [path, payload] of input.result.renderArtifacts.files.entries()) {
      if (path.startsWith("render/")) {
        bytes.set(path, payload);
      }
    }
  }

  return { json, text, bytes };
}

function normalizeTurkeyAdmHierarchy(
  dataset: TerritoryDataset,
  datasetId: string
): NormalizedHierarchy {
  const adm0Zones = dataset.zones.filter(
    (zone) => zone.level === 0 || zone.sourceAdminLevel === "ADM0"
  );
  const adm1Source = dataset.zones
    .filter((zone) => zone.level === 1 || zone.sourceAdminLevel === "ADM1")
    .sort(compareZones);
  const adm2Source = dataset.zones
    .filter((zone) => zone.level === 2 || zone.sourceAdminLevel === "ADM2")
    .sort(compareZones);

  if (adm0Zones.length !== TURKEY_V2_ADM0_EXPECTED_COUNT) {
    throw new Error(
      `Turkey national V2 build requires exactly one ADM0 zone, found ${adm0Zones.length}.`
    );
  }

  if (adm1Source.length !== TURKEY_V2_ADM1_EXPECTED_COUNT) {
    throw new Error(
      `Turkey national V2 build requires ${TURKEY_V2_ADM1_EXPECTED_COUNT} ADM1 provinces, found ${adm1Source.length}.`
    );
  }

  const provinceById = new Map<string, TerritoryZone>();
  const provinceNameByCode = new Map<string, string>();
  const adm1 = adm1Source.map((province) => {
    const provinceCode = readProvinceCode(province);
    const normalized = normalizeAdmZone({
      zone: province,
      datasetId,
      level: 1,
      sourceAdminLevel: "ADM1",
      semanticType: "province",
      parentId: adm0Zones[0]!.id,
      territory: {
        countryCode: "TR",
        provinceCode,
        semanticType: "province",
        localTypeName: "Il"
      }
    });
    provinceById.set(normalized.id, normalized);
    provinceNameByCode.set(provinceCode, normalized.name ?? provinceCode);
    return normalized;
  });
  const adm2 = adm2Source.map((district) => {
    const province = district.parentId ? provinceById.get(district.parentId) : undefined;
    const provinceCode = province ? readProvinceCode(province) : readProvinceCode(district);
    const districtCode = readDistrictCode(district);
    const parentId = province?.id ?? district.parentId;

    return normalizeAdmZone({
      zone: district,
      datasetId,
      level: 2,
      sourceAdminLevel: "ADM2",
      semanticType: "district",
      ...(parentId ? { parentId } : {}),
      territory: {
        countryCode: "TR",
        provinceCode,
        districtCode,
        semanticType: "district",
        localTypeName: "Ilce"
      }
    });
  });
  const adm0 = normalizeAdmZone({
    zone: adm0Zones[0]!,
    datasetId,
    level: 0,
    sourceAdminLevel: "ADM0",
    semanticType: "country",
    territory: {
      countryCode: "TR",
      semanticType: "country",
      localTypeName: "Ulke"
    }
  });

  return { adm0, adm1, adm2, provinceById, provinceNameByCode };
}

function normalizeAdmZone(input: {
  zone: TerritoryZone;
  datasetId: string;
  level: number;
  sourceAdminLevel: TerritoryAdminLevel;
  semanticType: TerritorySemanticAdminType;
  parentId?: string;
  territory: Record<string, unknown>;
}): TerritoryZone {
  const territory = isRecord(input.zone.properties.territory)
    ? input.zone.properties.territory
    : {};
  const geometry = input.zone.geometry;
  const result: TerritoryZone = {
    ...input.zone,
    datasetId: input.datasetId,
    countryCode: "TR",
    level: input.level,
    sourceAdminLevel: input.sourceAdminLevel,
    semanticType: input.semanticType,
    neighborIds: input.zone.neighborIds ?? [],
    geometry,
    bbox: computeGeometryBBox(geometry),
    center: computeSafeGeometryCenter(geometry),
    properties: {
      ...input.zone.properties,
      territory: {
        ...territory,
        ...input.territory,
        adminLevel: input.sourceAdminLevel,
        sourceAdminLevel: input.sourceAdminLevel,
        hierarchyDepth: input.level,
        semanticReviewStatus: readString(territory.semanticReviewStatus) ?? "reviewed",
        coverageStatus: readString(territory.coverageStatus) ?? "verified"
      }
    }
  };

  return input.parentId ? { ...result, parentId: input.parentId } : result;
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

function normalizeAdm3SourceZones(
  zones: readonly TerritoryZone[],
  datasetId: string
): TerritoryZone[] {
  return zones
    .map((zone) => {
      const territory = isRecord(zone.properties.territory) ? zone.properties.territory : {};
      const parentId =
        zone.parentId ??
        readString(territory.parentId) ??
        readString(territory.sourceParentId) ??
        readString(territory.parentAdm2Id);
      const source = isRecord(territory.source) ? territory.source : {};
      const sourceClass = readString(territory.sourceClass) ?? readString(source.sourceClass);

      return {
        ...zone,
        datasetId,
        ...(parentId ? { parentId } : {}),
        properties: {
          ...zone.properties,
          territory: {
            ...territory,
            ...(sourceClass ? { sourceClass } : {}),
            ...(parentId ? { parentId } : {})
          }
        }
      };
    })
    .filter((zone) => typeof zone.parentId === "string" && zone.parentId.length > 0)
    .sort(compareZones);
}

function createSourcesByDistrict(
  districts: readonly TerritoryZone[],
  officialZones: readonly TerritoryZone[],
  osmZones: readonly TerritoryZone[]
): Record<string, TurkeyV2HybridBatchSourceEntry> {
  const officialByParent = groupByParent(officialZones);
  const osmByParent = groupByParent(osmZones);

  return Object.fromEntries(
    districts.map((district) => [
      district.id,
      {
        officialZones: officialByParent.get(district.id) ?? [],
        osmZones: osmByParent.get(district.id) ?? []
      }
    ])
  );
}

function groupByParent(zones: readonly TerritoryZone[]): Map<string, TerritoryZone[]> {
  const grouped = new Map<string, TerritoryZone[]>();

  for (const zone of zones) {
    if (!zone.parentId) {
      continue;
    }

    const current = grouped.get(zone.parentId) ?? [];
    current.push(zone);
    grouped.set(zone.parentId, current);
  }

  for (const [parentId, siblings] of grouped.entries()) {
    grouped.set(parentId, siblings.sort(compareZones));
  }

  return grouped;
}

function createLevelDatasets(dataset: TerritoryDataset): TurkeyV2NationalBuildResult["levels"] {
  return {
    ADM0: filterDatasetLevel(dataset, 0, "ADM0"),
    ADM1: filterDatasetLevel(dataset, 1, "ADM1"),
    ADM2: filterDatasetLevel(dataset, 2, "ADM2"),
    ADM3: filterDatasetLevel(dataset, 3, "ADM3")
  };
}

function filterDatasetLevel(
  dataset: TerritoryDataset,
  level: number,
  adminLevel: TerritoryAdminLevel
): TerritoryDataset {
  const levelDatasetId = `${dataset.manifest.datasetId}-${adminLevel.toLowerCase()}`;
  const zones = dataset.zones
    .filter((zone) => zone.level === level || zone.sourceAdminLevel === adminLevel)
    .map(({ parentId: _parentId, childIds: _childIds, ...zone }) => ({
      ...zone,
      datasetId: levelDatasetId
    }));

  return {
    manifest: {
      ...dataset.manifest,
      datasetId: levelDatasetId,
      adminLevels: [adminLevel],
      geometryHash: createDatasetGeometryHash({ zones }),
      name: `${dataset.manifest.name} ${adminLevel}`
    },
    zones
  };
}

function createNationalCoverage(input: {
  datasetId: string;
  datasetVersion: string;
  buildDate: string;
  deterministicHash: string;
  sourceLockHash: string;
  hierarchy: NormalizedHierarchy;
  adm2ById: ReadonlyMap<string, TerritoryZone>;
  districts: readonly TurkeyV2HybridDistrictBuildResult[];
  failures: readonly { districtId: string; message: string }[];
  sourceStatus: TurkeyV2NationalCoverageReport["sourceStatus"];
}): TurkeyV2NationalCoverageReport {
  const districtCoverages = input.districts.map((district) => {
    const parent = input.adm2ById.get(district.coverage.districtId);
    const provinceCode = district.coverage.provinceCode;
    const zoneCount =
      district.coverage.officialEffectiveCount +
      district.coverage.osmEffectiveCount +
      district.coverage.generatedEffectiveCount;
    return {
      districtId: district.coverage.districtId,
      districtCode: district.coverage.districtCode,
      districtName: parent?.name ?? district.district.name ?? district.coverage.districtId,
      provinceCode,
      provinceName: input.hierarchy.provinceNameByCode.get(provinceCode) ?? provinceCode,
      parentId: parent?.parentId ?? "",
      officialCount: district.coverage.officialEffectiveCount,
      osmCount: district.coverage.osmEffectiveCount,
      generatedCount: district.coverage.generatedEffectiveCount,
      zoneCount,
      profile: district.coverage.selectedProfile ?? district.coverage.profile,
      realCoveragePercent: district.coverage.realCoveragePercent,
      generatedCoveragePercent: district.coverage.generatedCoveragePercent,
      finalCoveragePercent: district.coverage.finalCoveragePercent,
      gapAreaKm2: district.coverage.remainingGapAreaKm2,
      qualityStatus:
        zoneCount > 0 && district.coverage.finalCoveragePercent >= 99.99 ? "ok" : "failed",
      deterministicHash: district.deterministicHash,
      artifactPath: `districts/${safeArtifactSegment(district.coverage.districtId)}`
    } satisfies TurkeyV2NationalDistrictCoverage;
  });
  const totalDistrictArea = sum(
    input.districts.map((district) => district.coverage.districtAreaKm2)
  );
  const officialArea = sum(
    input.districts.map((district) => district.coverage.officialEffectiveAreaKm2)
  );
  const osmArea = sum(input.districts.map((district) => district.coverage.osmEffectiveAreaKm2));
  const generatedArea = sum(
    input.districts.map((district) => district.coverage.generatedEffectiveAreaKm2)
  );
  const finalArea = sum(input.districts.map((district) => district.coverage.finalCoverageAreaKm2));
  const profileDistribution = countBy(districtCoverages.map((district) => district.profile));
  const provinceCoverage = createProvinceCoverage(districtCoverages, input.districts);
  const officialZoneCount = sum(
    input.districts.map((district) => district.coverage.officialEffectiveCount)
  );
  const osmZoneCount = sum(input.districts.map((district) => district.coverage.osmEffectiveCount));
  const generatedZoneCount = sum(
    input.districts.map((district) => district.coverage.generatedEffectiveCount)
  );

  return {
    schemaVersion: TURKEY_V2_NATIONAL_COVERAGE_SCHEMA_VERSION,
    datasetId: input.datasetId,
    datasetVersion: input.datasetVersion,
    buildDate: input.buildDate,
    sourceLockHash: input.sourceLockHash,
    deterministicHash: input.deterministicHash,
    adm0Count: input.hierarchy.adm0 ? 1 : 0,
    provinceCount: input.hierarchy.adm1.length,
    districtCount: input.hierarchy.adm2.length,
    successfulDistrictCount: input.districts.length,
    failedDistrictCount: input.failures.length,
    adm3FinalZoneCount: officialZoneCount + osmZoneCount + generatedZoneCount,
    officialZoneCount,
    osmZoneCount,
    generatedZoneCount,
    officialEffectiveAreaKm2: round6(officialArea),
    osmEffectiveAreaKm2: round6(osmArea),
    generatedEffectiveAreaKm2: round6(generatedArea),
    realCoveragePercent: percentage(officialArea + osmArea, totalDistrictArea),
    generatedCoveragePercent: percentage(generatedArea, totalDistrictArea),
    finalCoveragePercent: percentage(finalArea, totalDistrictArea),
    remainingGapAreaKm2: round6(Math.max(0, totalDistrictArea - finalArea)),
    districtsAtOrAbove9999: districtCoverages.filter(
      (district) => district.finalCoveragePercent >= 99.99
    ).length,
    districtsBelow9999: districtCoverages
      .filter((district) => district.finalCoveragePercent < 99.99)
      .map((district) => district.districtId)
      .sort(),
    officialOnlyDistricts: input.districts
      .filter(
        (district) =>
          district.coverage.officialEffectiveCount > 0 &&
          district.coverage.osmEffectiveCount === 0 &&
          district.coverage.generatedEffectiveCount === 0
      )
      .map((district) => district.coverage.districtId)
      .sort(),
    osmOnlyDistricts: input.districts
      .filter(
        (district) =>
          district.coverage.officialEffectiveCount === 0 &&
          district.coverage.osmEffectiveCount > 0 &&
          district.coverage.generatedEffectiveCount === 0
      )
      .map((district) => district.coverage.districtId)
      .sort(),
    generatedOnlyDistricts: input.districts
      .filter(
        (district) =>
          district.coverage.officialEffectiveCount === 0 &&
          district.coverage.osmEffectiveCount === 0 &&
          district.coverage.generatedEffectiveCount > 0
      )
      .map((district) => district.coverage.districtId)
      .sort(),
    hybridDistricts: input.districts
      .filter(
        (district) =>
          district.coverage.realEffectiveAreaKm2 > 0 &&
          district.coverage.generatedEffectiveCount > 0
      )
      .map((district) => district.coverage.districtId)
      .sort(),
    profileDistribution,
    algorithmVersion: TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION,
    sourceStatus: input.sourceStatus,
    provinces: provinceCoverage,
    districts: districtCoverages.sort((left, right) =>
      left.districtId.localeCompare(right.districtId)
    )
  };
}

function createProvinceCoverage(
  districtCoverages: readonly TurkeyV2NationalDistrictCoverage[],
  districtResults: readonly TurkeyV2HybridDistrictBuildResult[]
): TurkeyV2NationalProvinceCoverage[] {
  const byDistrictId = new Map(
    districtResults.map((district) => [district.coverage.districtId, district])
  );
  const grouped = new Map<string, TurkeyV2NationalDistrictCoverage[]>();

  for (const district of districtCoverages) {
    const current = grouped.get(district.provinceCode) ?? [];
    current.push(district);
    grouped.set(district.provinceCode, current);
  }

  return [...grouped.entries()]
    .map(([provinceCode, districts]) => {
      const results = districts.flatMap((district) => {
        const result = byDistrictId.get(district.districtId);
        return result ? [result] : [];
      });
      const districtArea = sum(results.map((district) => district.coverage.districtAreaKm2));
      const officialArea = sum(
        results.map((district) => district.coverage.officialEffectiveAreaKm2)
      );
      const osmArea = sum(results.map((district) => district.coverage.osmEffectiveAreaKm2));
      const generatedArea = sum(
        results.map((district) => district.coverage.generatedEffectiveAreaKm2)
      );
      const finalArea = sum(results.map((district) => district.coverage.finalCoverageAreaKm2));
      const gapArea = sum(results.map((district) => district.coverage.remainingGapAreaKm2));
      const sourceCounts = {
        official: sum(districts.map((district) => district.officialCount)),
        osm: sum(districts.map((district) => district.osmCount)),
        generated: sum(districts.map((district) => district.generatedCount))
      };
      const primaryCoverageClass = Object.entries(sourceCounts).sort(
        ([leftClass, leftCount], [rightClass, rightCount]) =>
          rightCount - leftCount || leftClass.localeCompare(rightClass)
      )[0]?.[0] as TerritorySourceClass;

      return {
        provinceCode,
        provinceName: districts[0]?.provinceName ?? provinceCode,
        districtCount: districts.length,
        successfulDistrictCount: districts.filter((district) => district.qualityStatus === "ok")
          .length,
        finalZoneCount: sum(districts.map((district) => district.zoneCount)),
        officialCount: sourceCounts.official,
        officialAreaKm2: round6(officialArea),
        officialCoveragePercent: percentage(officialArea, districtArea),
        osmCount: sourceCounts.osm,
        osmAreaKm2: round6(osmArea),
        osmCoveragePercent: percentage(osmArea, districtArea),
        generatedCount: sourceCounts.generated,
        generatedAreaKm2: round6(generatedArea),
        generatedCoveragePercent: percentage(generatedArea, districtArea),
        finalCoveragePercent: percentage(finalArea, districtArea),
        gapAreaKm2: round6(gapArea),
        qualityStatus: districts.every((district) => district.qualityStatus === "ok")
          ? "ok"
          : "failed",
        primaryCoverageClass
      } satisfies TurkeyV2NationalProvinceCoverage;
    })
    .sort((left, right) => left.provinceCode.localeCompare(right.provinceCode));
}

function createNationalHierarchyReport(
  dataset: TerritoryDataset,
  adm0Id: string
): TurkeyV2NationalHierarchyReport {
  const ids = new Set<string>();
  let duplicateIdCount = 0;
  let parentChildMismatchCount = 0;
  let provinceCodeMismatchCount = 0;
  let districtCodeMissingCount = 0;
  const zonesById = new Map(dataset.zones.map((zone) => [zone.id, zone]));

  for (const zone of dataset.zones) {
    if (ids.has(zone.id)) {
      duplicateIdCount += 1;
    }
    ids.add(zone.id);

    for (const childId of zone.childIds ?? []) {
      const child = zonesById.get(childId);
      if (!child || child.parentId !== zone.id) {
        parentChildMismatchCount += 1;
      }
    }

    const territory = territoryMetadata(zone);
    if (
      (zone.level === 2 || zone.sourceAdminLevel === "ADM2") &&
      !readString(territory.provinceCode)
    ) {
      provinceCodeMismatchCount += 1;
    }
    if (
      (zone.level === 3 || zone.sourceAdminLevel === "ADM3") &&
      !readString(territory.districtCode)
    ) {
      districtCodeMissingCount += 1;
    }
  }

  const orphanCount = dataset.zones.filter((zone) => zone.id !== adm0Id && !zone.parentId).length;

  return {
    schemaVersion: TURKEY_V2_NATIONAL_HIERARCHY_SCHEMA_VERSION,
    datasetId: dataset.manifest.datasetId,
    adm0Id,
    countryChildIds: zonesById.get(adm0Id)?.childIds ?? [],
    provinceCount: dataset.zones.filter((zone) => zone.level === 1).length,
    districtCount: dataset.zones.filter((zone) => zone.level === 2).length,
    adm3Count: dataset.zones.filter((zone) => zone.level === 3).length,
    orphanCount,
    cycleCount: detectCycleCount(dataset),
    duplicateIdCount,
    parentChildMismatchCount,
    provinceCodeMismatchCount,
    districtCodeMissingCount
  };
}

function createNationalProvenance(
  buildDate: string,
  sourceLockHash: string,
  batch: TurkeyV2HybridBatchBuildResult
): TurkeyV2NationalProvenanceReport {
  const zones = batch.provenance.zones.sort((left, right) =>
    left.zoneId.localeCompare(right.zoneId)
  );
  const providerIds = new Set(zones.map((zone) => zone.providerId));
  const licenses = new Set(zones.map((zone) => zone.license));

  return {
    schemaVersion: TURKEY_V2_NATIONAL_PROVENANCE_SCHEMA_VERSION,
    buildDate,
    summary: {
      sourceClasses: countBy(zones.map((zone) => zone.sourceClass)),
      providerCount: providerIds.size,
      licenseCount: licenses.size,
      zoneCount: zones.length,
      sourceLockHash
    },
    zones
  };
}

function createNationalAttribution(
  buildDate: string,
  batch: TurkeyV2HybridBatchBuildResult
): TurkeyV2HybridAttributionManifest {
  return {
    ...batch.attribution,
    districtId: "national",
    buildDate
  };
}

function createNationalLicenses(
  attribution: TurkeyV2HybridAttributionManifest
): TurkeyV2HybridLicenseManifest {
  return {
    schemaVersion: "territorykit-tr-v2-hybrid-licenses@1",
    districtId: "national",
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

function createNationalDistributionPolicy(
  batch: TurkeyV2HybridBatchBuildResult
): TurkeyV2HybridDistributionPolicyManifest {
  const policies = new Map<string, TurkeyV2HybridDistributionPolicyManifest["policies"][number]>();

  for (const district of batch.districts) {
    for (const policy of district.distributionPolicy.policies) {
      const key = [
        policy.sourceClass,
        policy.providerClass,
        policy.license,
        policy.redistributionPolicy,
        policy.commercialUsePolicy,
        policy.modificationPolicy
      ].join("\u0000");
      const existing = policies.get(key) ?? { ...policy, zoneIds: [] };
      existing.zoneIds = [...new Set([...existing.zoneIds, ...policy.zoneIds])].sort();
      policies.set(key, existing);
    }
  }

  return {
    schemaVersion: "territorykit-tr-v2-hybrid-distribution-policy@1",
    districtId: "national",
    policies: [...policies.values()].sort(
      (left, right) =>
        left.sourceClass.localeCompare(right.sourceClass) ||
        left.providerClass.localeCompare(right.providerClass) ||
        left.license.localeCompare(right.license)
    )
  };
}

function createNationalQuality(input: {
  dataset: TerritoryDataset;
  coverage: TurkeyV2NationalCoverageReport;
  hierarchy: TurkeyV2NationalHierarchyReport;
  hybridBatch: TurkeyV2HybridBatchBuildResult;
  sourceLock: TurkeyV2NationalSourceLock;
  artifactIntegrity: TurkeyV2NationalValidationResult;
  adjacencyIssueCount: number;
  buildMode: TurkeyV2NationalBuildMode;
}): TurkeyV2NationalQualityReport {
  const strictValidation = validateTurkeyV2Dataset(input.dataset);
  const geometryValidation = validateGeometryDataset(input.dataset, {
    checks: {
      coordinates: true,
      rings: true,
      selfIntersections: true,
      holes: true,
      bbox: true,
      center: true,
      antimeridian: true,
      parentContainment: false,
      siblingOverlaps: false
    }
  });
  const adm3SiblingValidation = validateGeometryDataset(
    {
      ...input.dataset,
      zones: input.dataset.zones.filter((zone) => zone.level === 3)
    },
    {
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
    }
  );
  const sourceClassByZoneId = new Map(
    input.dataset.zones.map((zone) => [zone.id, readZoneSourceClass(zone)] as const)
  );
  const siblingOverlapIssues = adm3SiblingValidation.issues.filter(
    (issue) => issue.code === "SIBLING_GEOMETRY_OVERLAP" && issue.severity === "error"
  );
  const realGeneratedOverlapCount = siblingOverlapIssues.filter((issue) => {
    const leftSourceClass = issue.zoneId ? sourceClassByZoneId.get(issue.zoneId) : undefined;
    const rightSourceClass = issue.otherZoneId
      ? sourceClassByZoneId.get(issue.otherZoneId)
      : undefined;

    return (
      (leftSourceClass === "generated" && rightSourceClass !== "generated") ||
      (leftSourceClass !== "generated" && rightSourceClass === "generated")
    );
  }).length;
  const duplicateStableIdCount = countDuplicates(
    input.dataset.zones
      .filter((zone) => zone.level === 3)
      .map((zone) => readString(territoryMetadata(zone).stableId) ?? zone.id)
  );
  const missingProvenanceCount = input.hybridBatch.districts.reduce(
    (total, district) => total + district.quality.summary.missingProvenanceCount,
    0
  );
  const missingAttributionLicenseCount = input.hybridBatch.districts.reduce(
    (total, district) => total + district.quality.summary.licenseAttributionMissingCount,
    0
  );
  const generatedMetadataErrorCount = input.hybridBatch.districts.reduce(
    (total, district) => total + district.quality.summary.generatedQualityErrorCount,
    0
  );
  const completeness = validateTurkeyV2NationalCompleteness({
    coverage: input.coverage,
    quality: { ok: true, buildMode: input.buildMode, publishReady: true },
    sourceLock: input.sourceLock,
    strictPublishReady: true
  });
  const gates = {
    adm0Count:
      input.hierarchy.adm0Id.length > 0 &&
      input.dataset.zones.filter((zone) => zone.level === 0).length === input.coverage.adm0Count,
    adm1Count: input.coverage.provinceCount === input.hierarchy.provinceCount,
    adm2Count:
      input.buildMode === "partial" ||
      (input.coverage.districtCount === input.coverage.successfulDistrictCount &&
        input.coverage.failedDistrictCount === 0),
    everyDistrictHasAdm3: input.coverage.districts.every((district) => district.zoneCount > 0),
    everyDistrictCoverage: input.coverage.districtsBelow9999.length === 0,
    nationalCoverage: input.coverage.finalCoveragePercent >= 99.99,
    orphanCount: input.hierarchy.orphanCount === 0,
    hierarchyCycleCount: input.hierarchy.cycleCount === 0,
    duplicateStableId: duplicateStableIdCount === 0,
    invalidFinalGeometry: geometryValidation.issues.every((issue) => issue.severity !== "error"),
    effectiveSiblingOverlap: siblingOverlapIssues.length === 0,
    realGeneratedOverlap: realGeneratedOverlapCount === 0,
    parentContainment: input.hybridBatch.districts.every(
      (district) => district.quality.summary.parentContainmentErrorCount === 0
    ),
    missingProvenance: missingProvenanceCount === 0,
    missingAttributionLicense: missingAttributionLicenseCount === 0,
    generatedMetadata: generatedMetadataErrorCount === 0,
    strictTrV2Validation: strictValidation.ok,
    adjacencyIntegrity: input.adjacencyIssueCount === 0,
    registryArtifactChecksum: input.artifactIntegrity.ok
  };
  const publishReadyGates = {
    ...gates,
    buildMode: input.buildMode === "publish-ready",
    nationalCompleteness: completeness.ok,
    adm0NationalCount: input.coverage.adm0Count === TURKEY_V2_ADM0_EXPECTED_COUNT,
    adm1NationalCount: input.coverage.provinceCount === TURKEY_V2_ADM1_EXPECTED_COUNT,
    adm2NationalCount: input.coverage.districtCount === TURKEY_V2_ADM2_EXPECTED_COUNT,
    successfulAdm2NationalCount:
      input.coverage.successfulDistrictCount === TURKEY_V2_ADM2_EXPECTED_COUNT
  };
  const hardGateFailures = Object.entries(gates)
    .filter(([, ok]) => !ok)
    .map(([gate]) => gate)
    .sort();
  const publishReadyGateFailures = Object.entries(publishReadyGates)
    .filter(([, ok]) => !ok)
    .map(([gate]) => gate)
    .sort();

  return {
    schemaVersion: TURKEY_V2_NATIONAL_QUALITY_SCHEMA_VERSION,
    ok: hardGateFailures.length === 0,
    buildMode: input.buildMode,
    publishReady: hardGateFailures.length === 0 && publishReadyGateFailures.length === 0,
    hardGateFailures,
    publishReadyGateFailures,
    completeness: {
      expected: {
        adm0Count: TURKEY_V2_ADM0_EXPECTED_COUNT,
        adm1Count: TURKEY_V2_ADM1_EXPECTED_COUNT,
        adm2Count: TURKEY_V2_ADM2_EXPECTED_COUNT
      },
      actual: {
        adm0Count: input.coverage.adm0Count,
        adm1Count: input.coverage.provinceCount,
        adm2Count: input.coverage.districtCount,
        successfulAdm2Count: input.coverage.successfulDistrictCount,
        failedDistrictCount: input.coverage.failedDistrictCount
      },
      strictIssueCount: completeness.errorCount,
      strictIssues: completeness.errors
    },
    summary: {
      adm0Count: input.dataset.zones.filter((zone) => zone.level === 0).length,
      adm1Count: input.dataset.zones.filter((zone) => zone.level === 1).length,
      adm2Count: input.dataset.zones.filter((zone) => zone.level === 2).length,
      adm3Count: input.dataset.zones.filter((zone) => zone.level === 3).length,
      failedDistrictCount: input.coverage.failedDistrictCount,
      districtsBelow9999: input.coverage.districtsBelow9999.length,
      orphanCount: input.hierarchy.orphanCount,
      hierarchyCycleCount: input.hierarchy.cycleCount,
      duplicateStableIdCount,
      invalidFinalGeometryCount: geometryValidation.issues.filter(
        (issue) => issue.severity === "error"
      ).length,
      emptyFinalGeometryCount: input.dataset.zones.filter((zone) => isEmptyGeometry(zone.geometry))
        .length,
      effectiveSiblingOverlapCount: siblingOverlapIssues.length,
      realGeneratedOverlapCount,
      parentContainmentErrorCount: input.hybridBatch.districts.reduce(
        (total, district) => total + district.quality.summary.parentContainmentErrorCount,
        0
      ),
      missingProvenanceCount,
      missingAttributionLicenseCount,
      generatedMetadataErrorCount,
      strictTrV2ValidationErrorCount: strictValidation.issues.filter(
        (issue) => issue.severity === "error"
      ).length,
      adjacencyIntegrityErrorCount: input.adjacencyIssueCount,
      registryArtifactChecksumErrors: input.artifactIntegrity.errorCount,
      warningCount: strictValidation.issues.filter((issue) => issue.severity === "warning").length
    },
    strictValidation: {
      ok: strictValidation.ok,
      issues: strictValidation.issues
    },
    geometryValidation: {
      ok: geometryValidation.ok,
      issueCount: geometryValidation.issues.length,
      errorCount: geometryValidation.issues.filter((issue) => issue.severity === "error").length
    },
    artifactIntegrity: input.artifactIntegrity,
    gates,
    publishReadyGates
  };
}

function createNationalRegistryEntry(input: {
  datasetId: string;
  datasetVersion: string;
  buildDate: string;
  coverage: TurkeyV2NationalCoverageReport;
  sourceLock: TurkeyV2NationalSourceLock;
  artifactHashes: Record<string, { sha256: string; byteSize: number }>;
  includeQuality: boolean;
  includeRender: boolean;
  includeAdjacency: boolean;
}): TurkeyV2NationalRegistryEntry {
  const artifact = (
    id: string,
    purpose: TurkeyV2NationalRegistryArtifact["purpose"],
    format: TurkeyV2NationalRegistryArtifact["format"],
    path: string,
    levels?: readonly TerritoryAdminLevel[],
    detail?: string
  ): TurkeyV2NationalRegistryArtifact => {
    const checksum = input.artifactHashes[path];
    if (!checksum) {
      throw new Error(`Missing checksum for registry artifact '${id}' at '${path}'.`);
    }

    return {
      id,
      purpose,
      format,
      ...(levels ? { levels } : {}),
      ...(detail ? { detail } : {}),
      path,
      url: `./${path}`,
      sha256: checksum.sha256,
      sizeBytes: checksum.byteSize,
      compression: "none"
    };
  };
  const artifacts: TurkeyV2NationalRegistryArtifact[] = [
    artifact("dataset", "metadata", "territory-json", "dataset.json", [
      "ADM0",
      "ADM1",
      "ADM2",
      "ADM3"
    ]),
    artifact("coverage", "metadata", "json", "coverage.json"),
    ...(input.includeQuality
      ? [artifact("quality", "metadata", "json", "quality-report.json")]
      : []),
    artifact("query", "query", "json", "query/query-artifact.json", [
      "ADM0",
      "ADM1",
      "ADM2",
      "ADM3"
    ]),
    artifact("adm3", "metadata", "territory-json", "levels/ADM3/dataset.json", ["ADM3"], "full"),
    ...(input.includeRender
      ? [artifact("adm3-render-manifest", "render", "json", "render/manifest.json", ["ADM3"])]
      : []),
    ...(input.includeAdjacency
      ? [
          artifact("adm3-adjacency", "adjacency", "json", "levels/ADM3/adjacency/adjacency.json", [
            "ADM3"
          ])
        ]
      : [])
  ];

  return {
    schemaVersion: TURKEY_V2_NATIONAL_REGISTRY_ENTRY_SCHEMA_VERSION,
    registryVersion: "1",
    generatedAt: input.buildDate,
    datasets: [
      {
        id: input.datasetId,
        displayName: "Turkey V2 Playable National Dataset",
        version: input.datasetVersion,
        schemaVersion: TERRITORY_SCHEMA_VERSION,
        country: { alpha2: "TR", alpha3: "TUR", name: "Türkiye" },
        levels: ["ADM0", "ADM1", "ADM2", "ADM3"],
        prerelease: isSemverPrerelease(input.datasetVersion),
        coverage: {
          provinceCount: input.coverage.provinceCount,
          districtCount: input.coverage.districtCount,
          adm3ZoneCount: input.coverage.adm3FinalZoneCount,
          finalCoveragePercent: input.coverage.finalCoveragePercent
        },
        sourceClassSummary: {
          official: input.coverage.officialZoneCount,
          osm: input.coverage.osmZoneCount,
          generated: input.coverage.generatedZoneCount
        },
        source: {
          provider: "territory-kit-tr-v2-national",
          version: input.sourceLock.contentHash,
          attribution: input.sourceLock.adm0Adm2.attribution
        },
        license: {
          id: "mixed",
          attribution:
            "OCHA COD-AB Türkiye ADM0-ADM2; approved municipal open data; OpenStreetMap contributors if OSM artifact is built; TerritoryKit generated game zones"
        },
        artifacts
      }
    ]
  };
}

function isSemverPrerelease(version: string): boolean {
  const match = /^\d+\.\d+\.\d+(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);

  if (!match) {
    throw new Error(`Invalid Turkey V2 national dataset semver '${version}'.`);
  }

  return match[1] !== undefined;
}

function createNationalArtifactPlan(
  datasetId: string,
  datasetVersion: string,
  artifacts: readonly TurkeyV2NationalRegistryArtifact[]
): TurkeyV2NationalArtifactPlan {
  return {
    schemaVersion: "territorykit-tr-v2-national-artifact-plan@1",
    datasetId,
    datasetVersion,
    largeGeometryEmbeddedInNpm: false,
    commitPolicy: {
      commit: [
        "source-lock",
        "coverage summary",
        "quality summary",
        "hierarchy summary",
        "provenance summary",
        "attribution summary",
        "registry entry",
        "checksums",
        "small smoke fixtures"
      ],
      external: [
        "dataset.json",
        "levels/ADM3/dataset.json",
        "levels/ADM3/full.geojson",
        "render MVT tiles",
        "large binary/query indexes",
        "raw source archives and caches"
      ]
    },
    artifacts: [...artifacts]
  };
}

function createCoreNationalArtifactFiles(input: {
  dataset: TerritoryDataset;
  deterministicHash: string;
  sourceLock: TurkeyV2NationalSourceLock;
  coverage: TurkeyV2NationalCoverageReport;
  hierarchy: TurkeyV2NationalHierarchyReport;
  provenance: TurkeyV2NationalProvenanceReport;
  attribution: TurkeyV2HybridAttributionManifest;
  licenses: TurkeyV2HybridLicenseManifest;
  distributionPolicy: TurkeyV2HybridDistributionPolicyManifest;
  migration: TurkeyV2ZoneMigrationPlan;
  levels: TurkeyV2NationalBuildResult["levels"];
  adjacency?: TerritoryAdjacencyArtifact;
  renderArtifacts?: TerritoryRenderBuildResult;
}): Map<string, string | Uint8Array> {
  const files = new Map<string, string | Uint8Array>([
    ["dataset.json", serializeJsonArtifact(input.dataset)],
    [
      "manifest.json",
      serializeJsonArtifact({
        ...input.dataset.manifest,
        coverage: {
          provinceCount: input.coverage.provinceCount,
          districtCount: input.coverage.districtCount,
          adm3FinalZoneCount: input.coverage.adm3FinalZoneCount,
          finalCoveragePercent: input.coverage.finalCoveragePercent
        },
        deterministicHash: input.deterministicHash,
        sourceLockHash: input.coverage.sourceLockHash
      })
    ],
    ["source-lock.json", serializeJsonArtifact(input.sourceLock)],
    ["coverage.json", serializeJsonArtifact(input.coverage)],
    ["hierarchy-report.json", serializeJsonArtifact(input.hierarchy)],
    ["provenance.json", serializeJsonArtifact(input.provenance)],
    ["attribution.json", serializeJsonArtifact(input.attribution)],
    [
      "attribution.txt",
      input.attribution.text.endsWith("\n") ? input.attribution.text : `${input.attribution.text}\n`
    ],
    ["licenses.json", serializeJsonArtifact(input.licenses)],
    ["distribution-policy.json", serializeJsonArtifact(input.distributionPolicy)],
    ["migration-plan.json", serializeJsonArtifact(input.migration)],
    ["levels/ADM0/dataset.json", serializeJsonArtifact(input.levels.ADM0)],
    ["levels/ADM1/dataset.json", serializeJsonArtifact(input.levels.ADM1)],
    ["levels/ADM2/dataset.json", serializeJsonArtifact(input.levels.ADM2)],
    ["levels/ADM3/dataset.json", serializeJsonArtifact(input.levels.ADM3)],
    [
      "levels/ADM3/full.geojson",
      serializeJsonArtifact(territoryDatasetToFeatureCollection(input.levels.ADM3))
    ],
    ["query/query-artifact.json", serializeJsonArtifact(createNationalQueryArtifact(input.dataset))]
  ]);

  if (input.adjacency) {
    files.set("levels/ADM3/adjacency/adjacency.json", serializeJsonArtifact(input.adjacency));
  }

  if (input.renderArtifacts) {
    for (const [path, payload] of input.renderArtifacts.files.entries()) {
      if (path.startsWith("render/")) {
        files.set(path, payload);
      }
    }
  }

  return files;
}

function createChecksums(
  files: ReadonlyMap<string, string | Uint8Array>
): TurkeyV2NationalChecksums {
  return {
    schemaVersion: "territorykit-tr-v2-national-checksums@1",
    files: Object.fromEntries(
      [...files.entries()]
        .map(
          ([path, payload]) =>
            [
              path,
              {
                sha256: sha256Hex(payload),
                byteSize:
                  typeof payload === "string" ? Buffer.byteLength(payload) : payload.byteLength
              }
            ] as const
        )
        .sort(([left], [right]) => left.localeCompare(right))
    )
  };
}

function serializeJsonArtifact(input: unknown): string {
  return `${JSON.stringify(input, null, 2)}\n`;
}

function createDatasetManifestJson(result: TurkeyV2NationalBuildResult): Record<string, unknown> {
  return {
    ...result.dataset.manifest,
    coverage: {
      provinceCount: result.coverage.provinceCount,
      districtCount: result.coverage.districtCount,
      adm3FinalZoneCount: result.coverage.adm3FinalZoneCount,
      finalCoveragePercent: result.coverage.finalCoveragePercent
    },
    deterministicHash: result.deterministicHash,
    sourceLockHash: result.coverage.sourceLockHash
  };
}

function createBuildSummary(result: TurkeyV2NationalBuildResult): Record<string, unknown> {
  return {
    schemaVersion: TURKEY_V2_NATIONAL_BUILD_SUMMARY_SCHEMA_VERSION,
    datasetId: result.coverage.datasetId,
    datasetVersion: result.coverage.datasetVersion,
    buildDate: result.coverage.buildDate,
    buildMode: result.quality.buildMode,
    publishReady: result.quality.publishReady,
    adm0Count: result.coverage.adm0Count,
    provinceCount: result.coverage.provinceCount,
    districtCount: result.coverage.districtCount,
    successfulDistrictCount: result.coverage.successfulDistrictCount,
    failedDistrictCount: result.coverage.failedDistrictCount,
    adm3FinalZoneCount: result.coverage.adm3FinalZoneCount,
    officialZoneCount: result.coverage.officialZoneCount,
    osmZoneCount: result.coverage.osmZoneCount,
    generatedZoneCount: result.coverage.generatedZoneCount,
    realCoveragePercent: result.coverage.realCoveragePercent,
    generatedCoveragePercent: result.coverage.generatedCoveragePercent,
    finalCoveragePercent: result.coverage.finalCoveragePercent,
    deterministicHash: result.deterministicHash,
    qualityOk: result.quality.ok,
    publishReadyGateFailures: result.quality.publishReadyGateFailures,
    sourceStatus: result.coverage.sourceStatus,
    artifactPlan: result.artifactPlan
  };
}

function createNationalQueryArtifact(dataset: TerritoryDataset): Record<string, unknown> {
  const childrenByParent = new Map<string, string[]>();

  for (const zone of dataset.zones) {
    if (!zone.parentId) {
      continue;
    }

    const children = childrenByParent.get(zone.parentId) ?? [];
    children.push(zone.id);
    childrenByParent.set(zone.parentId, children);
  }

  return {
    schemaVersion: "territorykit-tr-v2-national-query-artifact@1",
    datasetId: dataset.manifest.datasetId,
    datasetVersion: dataset.manifest.datasetVersion,
    geometryHash: dataset.manifest.geometryHash,
    zoneCount: dataset.zones.length,
    byId: Object.fromEntries(
      dataset.zones
        .map(
          (zone) =>
            [
              zone.id,
              {
                id: zone.id,
                name: zone.name,
                level: zone.level,
                sourceAdminLevel: zone.sourceAdminLevel,
                semanticType: zone.semanticType,
                parentId: zone.parentId,
                childIds: zone.childIds ?? [],
                bbox: zone.bbox,
                center: zone.center,
                sourceClass: readString(territoryMetadata(zone).sourceClass)
              }
            ] as const
        )
        .sort(([left], [right]) => left.localeCompare(right))
    ),
    childrenByParent: Object.fromEntries(
      [...childrenByParent.entries()]
        .map(([parentId, ids]) => [parentId, ids.sort()] as const)
        .sort(([left], [right]) => left.localeCompare(right))
    ),
    provinceDistrictIndex: Object.fromEntries(
      dataset.zones
        .filter((zone) => zone.level === 2)
        .map((zone) => {
          const territory = territoryMetadata(zone);
          return [
            zone.id,
            {
              provinceCode: readString(territory.provinceCode),
              districtCode: readString(territory.districtCode)
            }
          ] as const;
        })
        .sort(([left], [right]) => left.localeCompare(right))
    ),
    sourceClassIndex: Object.fromEntries(
      ["official", "osm", "generated"].map((sourceClass) => [
        sourceClass,
        dataset.zones
          .filter((zone) => readString(territoryMetadata(zone).sourceClass) === sourceClass)
          .map((zone) => zone.id)
          .sort()
      ])
    )
  };
}

function territoryDatasetToFeatureCollection(dataset: TerritoryDataset): Record<string, unknown> {
  return {
    type: "FeatureCollection",
    territoryKit: {
      datasetId: dataset.manifest.datasetId,
      datasetVersion: dataset.manifest.datasetVersion,
      geometryHash: dataset.manifest.geometryHash
    },
    features: dataset.zones.map((zone) => ({
      type: "Feature",
      id: zone.id,
      properties: {
        ...zone.properties,
        id: zone.id,
        datasetId: zone.datasetId,
        countryCode: zone.countryCode,
        level: zone.level,
        sourceAdminLevel: zone.sourceAdminLevel,
        semanticType: zone.semanticType,
        name: zone.name,
        localName: zone.localName,
        parentId: zone.parentId,
        childIds: zone.childIds,
        neighborIds: zone.neighborIds,
        bbox: zone.bbox,
        center: zone.center
      },
      geometry: zone.geometry
    }))
  };
}

function readProvinceCode(zone: TerritoryZone): string {
  const territory = territoryMetadata(zone);
  const explicit = readString(territory.provinceCode);
  if (explicit) {
    return explicit.padStart(2, "0").slice(-2);
  }

  const idMatch = zone.id.match(/tr:adm1:tr-(\d{2})/) ?? zone.parentId?.match(/tr:adm1:tr-(\d{2})/);
  if (idMatch?.[1]) {
    return idMatch[1];
  }

  const sourceCode = readString(isRecord(territory.codes) ? territory.codes.source : undefined);
  const sourceMatch = sourceCode?.match(/^TR(\d{2})/i);
  if (sourceMatch?.[1]) {
    return sourceMatch[1];
  }

  return "00";
}

function readDistrictCode(zone: TerritoryZone): string {
  const territory = territoryMetadata(zone);
  const explicit = readString(territory.districtCode);
  if (explicit) {
    return explicit;
  }

  const sourceCode =
    readString(isRecord(territory.codes) ? territory.codes.source : undefined) ??
    readString(isRecord(territory.source) ? territory.source.sourceId : undefined);
  return sourceCode?.toLowerCase() ?? zone.id.replace(/^tr:adm2:/, "");
}

function territoryMetadata(zone: TerritoryZone): Record<string, unknown> {
  return isRecord(zone.properties.territory) ? zone.properties.territory : {};
}

function readZoneSourceClass(zone: TerritoryZone): string | undefined {
  const territory = territoryMetadata(zone);
  const source = isRecord(territory.source) ? territory.source : {};
  return readString(territory.sourceClass) ?? readString(source.sourceClass);
}

function readString(input: unknown): string | undefined {
  return typeof input === "string" && input.trim().length > 0 ? input.trim() : undefined;
}

function compareZones(left: TerritoryZone, right: TerritoryZone): number {
  return left.id.localeCompare(right.id);
}

function safeArtifactSegment(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))
  );
}

function countDuplicates(values: readonly string[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const value of values) {
    if (seen.has(value)) {
      duplicates += 1;
    }
    seen.add(value);
  }
  return duplicates;
}

function detectCycleCount(dataset: TerritoryDataset): number {
  const parentById = new Map(dataset.zones.map((zone) => [zone.id, zone.parentId]));
  let cycles = 0;
  for (const zone of dataset.zones) {
    const seen = new Set<string>();
    let current: string | undefined = zone.id;
    while (current) {
      if (seen.has(current)) {
        cycles += 1;
        break;
      }
      seen.add(current);
      current = parentById.get(current);
    }
  }
  return cycles;
}

function isEmptyGeometry(geometry: TerritoryGeometry): boolean {
  if (geometry.type === "Polygon") {
    return (
      geometry.coordinates.length === 0 || geometry.coordinates.every((ring) => ring.length === 0)
    );
  }
  return geometry.coordinates.length === 0;
}

function sum(values: readonly number[]): number {
  return round6(values.reduce((total, value) => total + value, 0));
}

function percentage(value: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return round6((value / total) * 100);
}

function round6(value: number): number {
  return Number(value.toFixed(6));
}
