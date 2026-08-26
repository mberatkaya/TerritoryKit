import { performance } from "node:perf_hooks";
import {
  TERRITORY_SCHEMA_VERSION,
  computeGeometryBBox,
  computeGeometryCenter,
  geometryToPolygons,
  validateGeometryDataset
} from "@territory-kit/dataset";
import type {
  LngLat,
  TerritoryBBox,
  TerritoryDataset,
  TerritoryGeometry,
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
  computeTurkeyAdm3DistrictCoverage,
  computeTurkeyAdm3GeometryAreaKm2
} from "./turkey-adm3-full-coverage.js";
import type { TurkeyAdm3DistrictCoverageReport } from "./turkey-adm3-full-coverage.js";
import { createTurkeyV2Adm3TerritoryId } from "./turkey-adm3-ingestion.js";
import { isRecord, serializeJsonStable, sha256Hex } from "./sources/utils.js";

export const TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION = "tr-adm3-game-zone-v2" as const;
export const TURKEY_GAME_ZONE_CONFIGURATION_SCHEMA_VERSION =
  "territorykit-tr-adm3-game-zone-config@1" as const;
export const TURKEY_GAME_ZONE_QUALITY_SCHEMA_VERSION =
  "territorykit-tr-adm3-game-zone-quality@1" as const;

export type TurkeyGameZoneProfile = "urban" | "suburban" | "rural" | "auto" | "custom";
export type ResolvedTurkeyGameZoneProfile = Exclude<TurkeyGameZoneProfile, "auto">;
export type TurkeyGameZoneFragmentStrategy =
  "merge-nearest" | "merge-longest-boundary" | "preserve" | "reject";
export type TurkeyGameZoneUrbanityHint = "urban" | "suburban" | "rural";
export type TurkeyGameZoneIssueSeverity = "error" | "warning" | "info";

export type TurkeyGameZoneIssueCode =
  | "INVALID_PROFILE"
  | "INVALID_TARGET_AREA"
  | "INVALID_MINIMUM_AREA"
  | "INVALID_MAXIMUM_AREA"
  | "INVALID_AREA_ORDERING"
  | "INVALID_TARGET_ZONE_COUNT"
  | "INVALID_MAXIMUM_ZONE_COUNT"
  | "INVALID_FRAGMENT_THRESHOLD"
  | "INVALID_FRAGMENT_STRATEGY"
  | "EMPTY_SEED"
  | "EMPTY_ALGORITHM_VERSION"
  | "UNSUPPORTED_ALGORITHM_VERSION"
  | "INVALID_POPULATION"
  | "INVALID_POPULATION_DENSITY"
  | "IMPOSSIBLE_DISTRICT_TARGET"
  | "EMPTY_OR_INVALID_DISTRICT_GEOMETRY"
  | "PARTITION_SPLIT_FAILED"
  | "FRAGMENT_REJECTED"
  | "COVERAGE_THRESHOLD_FAILED"
  | "SIBLING_OVERLAP"
  | "PARENT_CONTAINMENT_ERROR"
  | "INVALID_GEOMETRY"
  | "EMPTY_GEOMETRY"
  | "DUPLICATE_GEOMETRY"
  | "STABLE_ID_COLLISION"
  | "MAX_ZONE_COUNT_EXCEEDED"
  | "METADATA_CONTRACT_ERROR"
  | "ZONE_AREA_BELOW_MINIMUM"
  | "ZONE_AREA_ABOVE_MAXIMUM"
  | "COMPACTNESS_WARNING"
  | "THIN_ZONE_WARNING";

export interface TurkeyGameZoneIssue {
  code: TurkeyGameZoneIssueCode;
  severity: TurkeyGameZoneIssueSeverity;
  message: string;
  zoneId?: string;
  parentId?: string;
  details?: Record<string, unknown>;
}

export interface TurkeyGameZoneGeneratorOptions {
  district: TerritoryZone;
  provinceCode: string;
  districtCode: string;
  profile: TurkeyGameZoneProfile;
  seed?: string;
  algorithmVersion?: string;
  targetAreaKm2?: number;
  minAreaKm2?: number;
  maxAreaKm2?: number;
  targetZoneCount?: number;
  maxZonesPerDistrict?: number;
  minFragmentAreaKm2?: number;
  population?: number;
  populationDensityPerKm2?: number;
  urbanityHint?: TurkeyGameZoneUrbanityHint;
  excludedOrOccupiedZones?: readonly TerritoryZone[];
  compactnessTarget?: number;
  minWidthKm?: number;
  fragmentStrategy?: TurkeyGameZoneFragmentStrategy;
}

export interface TurkeyGameZoneProfileDecision {
  selectedProfile: ResolvedTurkeyGameZoneProfile;
  reasons: string[];
  signals: {
    districtAreaKm2: number;
    targetAreaKm2: number;
    existingRealZoneCount: number;
    population?: number;
    populationDensityPerKm2?: number;
    urbanityHint?: TurkeyGameZoneUrbanityHint;
  };
}

export interface ResolvedTurkeyGameZoneConfiguration {
  schemaVersion: typeof TURKEY_GAME_ZONE_CONFIGURATION_SCHEMA_VERSION;
  profile: TurkeyGameZoneProfile;
  selectedProfile: ResolvedTurkeyGameZoneProfile;
  algorithmVersion: string;
  seed: string;
  targetAreaKm2: number;
  minAreaKm2: number;
  maxAreaKm2: number;
  targetZoneCount: number;
  maxZonesPerDistrict: number;
  minFragmentAreaKm2: number;
  fragmentStrategy: TurkeyGameZoneFragmentStrategy;
  compactnessTarget: number;
  minWidthKm: number;
  coverageTargetPercent: 99.99;
  overlapToleranceKm2: number;
  parentOutsideToleranceKm2: number;
  targetGeometryAreaKm2: number;
  profileDecision?: TurkeyGameZoneProfileDecision;
}

export interface TurkeyGameZoneConfigurationResolution {
  ok: boolean;
  configuration?: ResolvedTurkeyGameZoneConfiguration;
  issues: TurkeyGameZoneIssue[];
}

export interface TurkeyGameZoneQualityReport {
  schemaVersion: typeof TURKEY_GAME_ZONE_QUALITY_SCHEMA_VERSION;
  ok: boolean;
  hardFailureCount: number;
  warningCount: number;
  districtId: string;
  parentId: string;
  districtAreaKm2: number;
  targetGeometryAreaKm2: number;
  generatedUnionAreaKm2: number;
  finalCoveragePercent: number;
  gapCount: number;
  gapAreaKm2: number;
  overlapCount: number;
  overlapAreaKm2: number;
  invalidGeometryCount: number;
  emptyGeometryCount: number;
  duplicateGeometryCount: number;
  sliverCount: number;
  sliverTotalAreaKm2: number;
  parentContainmentErrorCount: number;
  minZoneAreaKm2: number;
  maxZoneAreaKm2: number;
  meanZoneAreaKm2: number;
  medianZoneAreaKm2: number;
  zoneAreaStandardDeviationKm2: number;
  zonesBelowMinimum: number;
  zonesAboveMaximum: number;
  multiPolygonZoneCount: number;
  disconnectedZoneCount: number;
  compactness: {
    min: number;
    mean: number;
    median: number;
  };
  thinZoneCount: number;
  producedZoneCount: number;
  targetZoneCount: number;
  selectedProfile: ResolvedTurkeyGameZoneProfile;
  algorithmVersion: string;
  seedHash: string;
  deterministicOutputHash: string;
  buildDurationMs: number;
  gates: {
    coverage: boolean;
    invalidGeometry: boolean;
    duplicateGeometry: boolean;
    overlap: boolean;
    parentContainment: boolean;
    emptyGeometry: boolean;
    zoneCount: boolean;
    metadata: boolean;
    stableIdCollision: boolean;
  };
  issues: TurkeyGameZoneIssue[];
}

export interface TurkeyGameZoneBuildResult {
  zones: TerritoryZone[];
  selectedProfile: ResolvedTurkeyGameZoneProfile;
  configuration: ResolvedTurkeyGameZoneConfiguration;
  coverage: TurkeyAdm3DistrictCoverageReport;
  quality: TurkeyGameZoneQualityReport;
  adjacency?: Awaited<ReturnType<typeof buildTerritoryAdjacency>>["artifact"];
  adjacencyStatistics?: Awaited<ReturnType<typeof buildTerritoryAdjacency>>["statistics"];
  issues: TurkeyGameZoneIssue[];
  deterministicHash: string;
}

interface PolygonClippingApi {
  difference: typeof polygonClipping.difference;
  intersection: typeof polygonClipping.intersection;
  union: typeof polygonClipping.union;
}

interface Rect {
  west: number;
  south: number;
  east: number;
  north: number;
}

interface PartitionPiece {
  geometry: ClippingMultiPolygon;
  key: string;
  areaKm2: number;
}

interface ZoneCandidate {
  geometry: TerritoryGeometry;
  localKey: string;
  anchorKey: string;
  geometryHash: string;
  areaKm2: number;
}

const CLIPPER =
  (polygonClipping as unknown as { default?: PolygonClippingApi }).default ??
  (polygonClipping as unknown as PolygonClippingApi);
const EARTH_RADIUS_METERS = 6_371_008.8;
const GEOMETRY_EPSILON = 1e-12;
const COORDINATE_EPSILON = 1e-9;
const RING_AREA_EPSILON = 1e-9;
const AREA_TOLERANCE_KM2 = 0.000001;
const PROFILE_DEFAULTS: Record<
  Exclude<ResolvedTurkeyGameZoneProfile, "custom">,
  Pick<
    ResolvedTurkeyGameZoneConfiguration,
    | "targetAreaKm2"
    | "minAreaKm2"
    | "maxAreaKm2"
    | "maxZonesPerDistrict"
    | "minFragmentAreaKm2"
    | "compactnessTarget"
    | "minWidthKm"
    | "fragmentStrategy"
  >
> = {
  urban: {
    targetAreaKm2: 1,
    minAreaKm2: 0.08,
    maxAreaKm2: 2.75,
    maxZonesPerDistrict: 512,
    minFragmentAreaKm2: 0.02,
    compactnessTarget: 0.22,
    minWidthKm: 0.08,
    fragmentStrategy: "merge-nearest"
  },
  suburban: {
    targetAreaKm2: 2.5,
    minAreaKm2: 0.15,
    maxAreaKm2: 7.5,
    maxZonesPerDistrict: 384,
    minFragmentAreaKm2: 0.04,
    compactnessTarget: 0.18,
    minWidthKm: 0.12,
    fragmentStrategy: "merge-nearest"
  },
  rural: {
    targetAreaKm2: 12,
    minAreaKm2: 0.35,
    maxAreaKm2: 45,
    maxZonesPerDistrict: 256,
    minFragmentAreaKm2: 0.08,
    compactnessTarget: 0.12,
    minWidthKm: 0.2,
    fragmentStrategy: "merge-nearest"
  }
};

export function resolveTurkeyGameZoneConfiguration(
  options: TurkeyGameZoneGeneratorOptions
): TurkeyGameZoneConfigurationResolution {
  const issues: TurkeyGameZoneIssue[] = [];
  const districtGeometry = toClippingMultiPolygon(options.district.geometry);
  const occupiedGeometry = unionClippingGeometries(
    sortZones(options.excludedOrOccupiedZones ?? []).map((zone) =>
      intersectClippingGeometries(districtGeometry, toClippingMultiPolygon(zone.geometry))
    )
  );
  const targetGeometry = differenceClippingGeometries(districtGeometry, occupiedGeometry);
  const targetGeometryAreaKm2 = clippingAreaKm2(targetGeometry);
  const districtAreaKm2 = clippingAreaKm2(districtGeometry);

  if (!isNonEmptyClippingGeometry(districtGeometry) || districtAreaKm2 <= 0) {
    issues.push({
      code: "EMPTY_OR_INVALID_DISTRICT_GEOMETRY",
      severity: "error",
      message: "Turkey game-zone generation requires a non-empty ADM2 Polygon or MultiPolygon.",
      parentId: options.district.id
    });
  }

  if (!["urban", "suburban", "rural", "auto", "custom"].includes(options.profile)) {
    issues.push({
      code: "INVALID_PROFILE",
      severity: "error",
      message: `Unsupported Turkey game-zone profile '${String(options.profile)}'.`
    });
  }

  const algorithmVersion = options.algorithmVersion ?? TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION;
  if (algorithmVersion.trim().length === 0) {
    issues.push({
      code: "EMPTY_ALGORITHM_VERSION",
      severity: "error",
      message: "Turkey game-zone algorithmVersion must not be empty."
    });
  } else if (algorithmVersion !== TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION) {
    issues.push({
      code: "UNSUPPORTED_ALGORITHM_VERSION",
      severity: "error",
      message: `Unsupported Turkey game-zone algorithmVersion '${algorithmVersion}'.`
    });
  }

  const seed = options.seed ?? "kaprota-v2";
  if (seed.trim().length === 0) {
    issues.push({
      code: "EMPTY_SEED",
      severity: "error",
      message: "Turkey game-zone seed must not be empty."
    });
  }

  if (options.population !== undefined && !isFiniteNonNegative(options.population)) {
    issues.push({
      code: "INVALID_POPULATION",
      severity: "error",
      message: "Turkey game-zone population must be a finite non-negative number."
    });
  }

  if (
    options.populationDensityPerKm2 !== undefined &&
    !isFiniteNonNegative(options.populationDensityPerKm2)
  ) {
    issues.push({
      code: "INVALID_POPULATION_DENSITY",
      severity: "error",
      message: "Turkey game-zone populationDensityPerKm2 must be a finite non-negative number."
    });
  }

  const decision = selectGameZoneProfile({
    requestedProfile: options.profile,
    districtAreaKm2,
    targetGeometryAreaKm2,
    existingRealZoneCount: options.excludedOrOccupiedZones?.length ?? 0,
    ...(options.population !== undefined ? { population: options.population } : {}),
    ...(options.populationDensityPerKm2 !== undefined
      ? { populationDensityPerKm2: options.populationDensityPerKm2 }
      : {}),
    ...(options.urbanityHint ? { urbanityHint: options.urbanityHint } : {})
  });
  const defaults =
    decision.selectedProfile === "custom"
      ? PROFILE_DEFAULTS.suburban
      : PROFILE_DEFAULTS[decision.selectedProfile];
  const targetAreaKm2 = options.targetAreaKm2 ?? defaults.targetAreaKm2;
  const minAreaKm2 = options.minAreaKm2 ?? defaults.minAreaKm2;
  const maxAreaKm2 = options.maxAreaKm2 ?? defaults.maxAreaKm2;
  const maxZonesPerDistrict = options.maxZonesPerDistrict ?? defaults.maxZonesPerDistrict;
  const minFragmentAreaKm2 = options.minFragmentAreaKm2 ?? defaults.minFragmentAreaKm2;
  const inferredTargetZoneCount = Math.max(
    1,
    Math.min(
      maxZonesPerDistrict,
      Math.ceil(targetGeometryAreaKm2 / Math.max(targetAreaKm2, GEOMETRY_EPSILON))
    )
  );
  const targetZoneCount = options.targetZoneCount ?? inferredTargetZoneCount;
  const fragmentStrategy = options.fragmentStrategy ?? defaults.fragmentStrategy;
  const compactnessTarget = options.compactnessTarget ?? defaults.compactnessTarget;
  const minWidthKm = options.minWidthKm ?? defaults.minWidthKm;

  validatePositiveFinite(targetAreaKm2, "INVALID_TARGET_AREA", "targetAreaKm2", issues);
  validatePositiveFinite(minAreaKm2, "INVALID_MINIMUM_AREA", "minAreaKm2", issues);
  validatePositiveFinite(maxAreaKm2, "INVALID_MAXIMUM_AREA", "maxAreaKm2", issues);
  validatePositiveFinite(
    minFragmentAreaKm2,
    "INVALID_FRAGMENT_THRESHOLD",
    "minFragmentAreaKm2",
    issues
  );
  validatePositiveFinite(compactnessTarget, "INVALID_TARGET_AREA", "compactnessTarget", issues);
  validatePositiveFinite(minWidthKm, "INVALID_TARGET_AREA", "minWidthKm", issues);

  if (!(minAreaKm2 <= targetAreaKm2 && targetAreaKm2 <= maxAreaKm2)) {
    issues.push({
      code: "INVALID_AREA_ORDERING",
      severity: "error",
      message:
        "Turkey game-zone area ordering must satisfy minAreaKm2 <= targetAreaKm2 <= maxAreaKm2.",
      details: { minAreaKm2, targetAreaKm2, maxAreaKm2 }
    });
  }

  if (!Number.isInteger(targetZoneCount) || targetZoneCount <= 0) {
    issues.push({
      code: "INVALID_TARGET_ZONE_COUNT",
      severity: "error",
      message: "Turkey game-zone targetZoneCount must be a positive integer.",
      details: { targetZoneCount }
    });
  }

  if (!Number.isInteger(maxZonesPerDistrict) || maxZonesPerDistrict <= 0) {
    issues.push({
      code: "INVALID_MAXIMUM_ZONE_COUNT",
      severity: "error",
      message: "Turkey game-zone maxZonesPerDistrict must be a positive integer.",
      details: { maxZonesPerDistrict }
    });
  }

  if (options.targetZoneCount !== undefined && targetZoneCount > maxZonesPerDistrict) {
    issues.push({
      code: "IMPOSSIBLE_DISTRICT_TARGET",
      severity: "error",
      message: "Turkey game-zone targetZoneCount exceeds maxZonesPerDistrict.",
      details: { targetZoneCount, maxZonesPerDistrict }
    });
  }

  if (
    !["merge-nearest", "merge-longest-boundary", "preserve", "reject"].includes(fragmentStrategy)
  ) {
    issues.push({
      code: "INVALID_FRAGMENT_STRATEGY",
      severity: "error",
      message: `Unsupported Turkey game-zone fragment strategy '${String(fragmentStrategy)}'.`
    });
  }

  const configuration: ResolvedTurkeyGameZoneConfiguration = {
    schemaVersion: TURKEY_GAME_ZONE_CONFIGURATION_SCHEMA_VERSION,
    profile: options.profile,
    selectedProfile: decision.selectedProfile,
    algorithmVersion,
    seed,
    targetAreaKm2: roundAreaKm2(targetAreaKm2),
    minAreaKm2: roundAreaKm2(minAreaKm2),
    maxAreaKm2: roundAreaKm2(maxAreaKm2),
    targetZoneCount,
    maxZonesPerDistrict,
    minFragmentAreaKm2: roundAreaKm2(minFragmentAreaKm2),
    fragmentStrategy,
    compactnessTarget: roundMetric(compactnessTarget),
    minWidthKm: roundMetric(minWidthKm),
    coverageTargetPercent: 99.99,
    overlapToleranceKm2: AREA_TOLERANCE_KM2,
    parentOutsideToleranceKm2: AREA_TOLERANCE_KM2,
    targetGeometryAreaKm2,
    ...(options.profile === "auto" ? { profileDecision: decision } : {})
  };

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    configuration,
    issues: sortIssues(issues)
  };
}

export function validateTurkeyGameZoneGeneratorOptions(
  options: TurkeyGameZoneGeneratorOptions
): TurkeyGameZoneConfigurationResolution {
  return resolveTurkeyGameZoneConfiguration(options);
}

export function buildTurkeyGameZones(
  options: TurkeyGameZoneGeneratorOptions
): TurkeyGameZoneBuildResult {
  const startedAt = performance.now();
  const resolution = resolveTurkeyGameZoneConfiguration(options);
  const configuration =
    resolution.configuration ??
    createFallbackConfiguration(options, TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION);
  const districtGeometry = toClippingMultiPolygon(options.district.geometry);
  const occupiedGeometry = unionClippingGeometries(
    sortZones(options.excludedOrOccupiedZones ?? []).map((zone) =>
      intersectClippingGeometries(districtGeometry, toClippingMultiPolygon(zone.geometry))
    )
  );
  const targetGeometry = differenceClippingGeometries(districtGeometry, occupiedGeometry);
  const issues = [...resolution.issues];
  let candidates: ZoneCandidate[] = [];

  if (resolution.ok && isNonEmptyClippingGeometry(targetGeometry)) {
    const pieces = partitionTargetGeometry(targetGeometry, configuration, issues);
    candidates = createZoneCandidates(pieces).sort(compareZoneCandidates);
  }

  const zones = candidates.map((candidate, index) =>
    createTurkeyGameZone({
      candidate,
      displayIndex: index,
      district: options.district,
      provinceCode: options.provinceCode,
      districtCode: options.districtCode,
      configuration
    })
  );
  const coverage = computeTurkeyAdm3DistrictCoverage({
    districtId: options.district.id,
    provinceCode: options.provinceCode,
    districtGeometry: options.district.geometry,
    official: options.excludedOrOccupiedZones?.map((zone) => zone.geometry) ?? [],
    generated: zones.map((zone) => zone.geometry)
  });
  const deterministicHashBase = createDeterministicHashBase({
    zones,
    configuration,
    coverage
  });
  const quality = inspectTurkeyGameZoneQuality({
    district: options.district,
    zones,
    targetGeometry,
    configuration,
    coverage,
    issues,
    deterministicHashBase,
    buildDurationMs: Math.round(performance.now() - startedAt)
  });
  const deterministicHash = quality.deterministicOutputHash;

  return {
    zones,
    selectedProfile: configuration.selectedProfile,
    configuration,
    coverage,
    quality,
    issues: sortIssues([...issues, ...quality.issues]),
    deterministicHash
  };
}

export async function buildTurkeyGameZonesWithAdjacency(
  options: TurkeyGameZoneGeneratorOptions
): Promise<TurkeyGameZoneBuildResult> {
  const result = buildTurkeyGameZones(options);

  if (result.zones.length === 0 || result.issues.some((issue) => issue.severity === "error")) {
    return result;
  }

  const adjacencyDataset = createTurkeyGameZoneDataset({
    district: options.district,
    zones: result.zones,
    datasetId: "tr-adm3-game-zones-adjacency",
    sourceDate: result.configuration.algorithmVersion,
    includeParent: false
  });
  const adjacency = await buildTerritoryAdjacency(adjacencyDataset, {
    buildDate: "1970-01-01T00:00:00.000Z",
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
  const zones = addNeighborIds(result.zones, adjacency.artifact.edges);
  const deterministicHash = sha256Hex(
    serializeJsonStable({
      base: result.deterministicHash,
      adjacency: adjacency.artifact.contentHash,
      zones: zones.map((zone) => ({ id: zone.id, neighborIds: zone.neighborIds }))
    })
  );
  const quality = {
    ...result.quality,
    deterministicOutputHash: deterministicHash
  };

  return {
    ...result,
    zones,
    quality,
    adjacency: adjacency.artifact,
    adjacencyStatistics: adjacency.statistics,
    issues: sortIssues([
      ...result.issues,
      ...adjacency.issues.map((issue) => ({
        code: "INVALID_GEOMETRY" as const,
        severity: issue.severity,
        message: issue.message,
        ...(issue.zoneId ? { zoneId: issue.zoneId } : {})
      }))
    ]),
    deterministicHash
  };
}

export function createTurkeyGameZoneDataset(input: {
  district: TerritoryZone;
  zones: readonly TerritoryZone[];
  datasetId?: string;
  sourceDate?: string;
  includeParent?: boolean;
}): TerritoryDataset {
  const datasetId = input.datasetId ?? "tr-adm3-game-zones";
  const rebasedZones = input.zones.map((zone) => ({ ...zone, datasetId }));
  const zones =
    input.includeParent === false
      ? rebasedZones
      : [withChildIds(input.district, rebasedZones, datasetId), ...rebasedZones];

  return {
    manifest: {
      schemaVersion: TERRITORY_SCHEMA_VERSION,
      datasetId,
      datasetVersion: "0.0.0",
      sourceDate: input.sourceDate ?? TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION,
      geometryHash: sha256Hex(
        serializeJsonStable(
          zones.map((zone) => ({
            id: zone.id,
            parentId: zone.parentId ?? null,
            geometry: canonicalGeometryPayload(zone.geometry)
          }))
        )
      ),
      adminLevels: input.includeParent === false ? ["ADM3"] : ["ADM2", "ADM3"],
      countryCodes: ["TR"],
      crs: "EPSG:4326",
      geometryDetail: "source",
      license: "Apache-2.0",
      name: "Turkey ADM3 V2 generated game zones",
      sourceProvider: "TerritoryKit generated game-zone generator",
      boundaryPolicy: "adm2-contained-generated-game-zones",
      disputedAreaPolicy: "source",
      worldview: "TR"
    },
    zones
  };
}

function partitionTargetGeometry(
  targetGeometry: ClippingMultiPolygon,
  configuration: ResolvedTurkeyGameZoneConfiguration,
  issues: TurkeyGameZoneIssue[]
): PartitionPiece[] {
  const initialAreaKm2 = clippingAreaKm2(targetGeometry);
  let pieces = splitPiece(
    {
      geometry: targetGeometry,
      key: "root",
      areaKm2: initialAreaKm2
    },
    Math.min(configuration.targetZoneCount, configuration.maxZonesPerDistrict),
    configuration,
    issues
  );

  while (
    pieces.length < configuration.maxZonesPerDistrict &&
    pieces.some((piece) => piece.areaKm2 > configuration.maxAreaKm2 + AREA_TOLERANCE_KM2)
  ) {
    const sorted = [...pieces].sort(
      (left, right) => right.areaKm2 - left.areaKm2 || left.key.localeCompare(right.key)
    );
    const largest = sorted[0];

    if (!largest) {
      break;
    }

    const split = splitOnce(largest, configuration, `${largest.key}:oversize`, issues);

    if (split.length < 2) {
      break;
    }

    pieces = pieces
      .filter((piece) => piece.key !== largest.key)
      .concat(split)
      .sort(comparePieces);
  }

  pieces = handleFragments(pieces, configuration, issues);

  if (pieces.length > configuration.maxZonesPerDistrict) {
    issues.push({
      code: "MAX_ZONE_COUNT_EXCEEDED",
      severity: "error",
      message: "Turkey game-zone partition exceeded maxZonesPerDistrict after fragment handling.",
      details: {
        producedZoneCount: pieces.length,
        maxZonesPerDistrict: configuration.maxZonesPerDistrict
      }
    });
  }

  return pieces.sort(comparePieces);
}

function splitPiece(
  piece: PartitionPiece,
  requestedCount: number,
  configuration: ResolvedTurkeyGameZoneConfiguration,
  issues: TurkeyGameZoneIssue[]
): PartitionPiece[] {
  if (requestedCount <= 1 || piece.areaKm2 <= configuration.maxAreaKm2) {
    return [piece];
  }

  const split = splitOnce(piece, configuration, piece.key, issues);

  if (split.length < 2) {
    return [piece];
  }

  const totalArea = split.reduce((sum, item) => sum + item.areaKm2, 0);
  const leftTarget = clampInteger(
    Math.round((requestedCount * split[0]!.areaKm2) / Math.max(totalArea, GEOMETRY_EPSILON)),
    1,
    requestedCount - 1
  );
  const rightTarget = requestedCount - leftTarget;

  return [
    ...splitPiece(split[0]!, leftTarget, configuration, issues),
    ...splitPiece(split[1]!, rightTarget, configuration, issues)
  ].sort(comparePieces);
}

function splitOnce(
  piece: PartitionPiece,
  configuration: ResolvedTurkeyGameZoneConfiguration,
  key: string,
  issues: TurkeyGameZoneIssue[]
): PartitionPiece[] {
  const bbox = clippingBBox(piece.geometry);
  const rect = bboxToRect(bbox);
  const centerLatitude = (rect.south + rect.north) / 2;
  const widthKm = Math.max(
    GEOMETRY_EPSILON,
    (rect.east - rect.west) * kilometersPerLongitudeDegree(centerLatitude)
  );
  const heightKm = Math.max(GEOMETRY_EPSILON, (rect.north - rect.south) * 111.32);
  const splitLongitude = widthKm >= heightKm;
  const jitter = deterministicUnitInterval(
    `${configuration.algorithmVersion}:${configuration.seed}:${key}`
  );
  const ratio = 0.42 + jitter * 0.16;
  const splitValue = splitLongitude
    ? rect.west + (rect.east - rect.west) * ratio
    : rect.south + (rect.north - rect.south) * ratio;
  const leftRect = splitLongitude
    ? { west: rect.west, south: rect.south, east: splitValue, north: rect.north }
    : { west: rect.west, south: rect.south, east: rect.east, north: splitValue };
  const rightRect = splitLongitude
    ? { west: splitValue, south: rect.south, east: rect.east, north: rect.north }
    : { west: rect.west, south: splitValue, east: rect.east, north: rect.north };

  try {
    const left = intersectClippingGeometries(
      piece.geometry,
      toClippingMultiPolygon(rectToGeometry(leftRect))
    );
    const right = intersectClippingGeometries(
      piece.geometry,
      toClippingMultiPolygon(rectToGeometry(rightRect))
    );
    const pieces = [createPiece(left, `${key}:0`), createPiece(right, `${key}:1`)].filter(
      (item): item is PartitionPiece => Boolean(item)
    );

    if (pieces.length === 2) {
      return pieces.sort(comparePieces);
    }
  } catch {
    // Fall through to the reported split failure below.
  }

  issues.push({
    code: "PARTITION_SPLIT_FAILED",
    severity: "warning",
    message: "Turkey game-zone partition could not split a geometry component deterministically.",
    details: { key, areaKm2: piece.areaKm2 }
  });
  return [piece];
}

function handleFragments(
  inputPieces: readonly PartitionPiece[],
  configuration: ResolvedTurkeyGameZoneConfiguration,
  issues: TurkeyGameZoneIssue[]
): PartitionPiece[] {
  let pieces = [...inputPieces].sort(comparePieces);

  if (configuration.fragmentStrategy === "preserve") {
    return pieces;
  }

  if (configuration.fragmentStrategy === "reject") {
    const kept = pieces.filter((piece) => piece.areaKm2 >= configuration.minFragmentAreaKm2);
    const rejected = pieces.length - kept.length;

    if (rejected > 0) {
      issues.push({
        code: "FRAGMENT_REJECTED",
        severity: "error",
        message: "Turkey game-zone fragmentStrategy reject removed generated area.",
        details: { rejected }
      });
    }

    return kept;
  }

  while (pieces.length > 1) {
    const fragment = pieces
      .filter((piece) => piece.areaKm2 < configuration.minFragmentAreaKm2)
      .sort((left, right) => left.areaKm2 - right.areaKm2 || left.key.localeCompare(right.key))[0];

    if (!fragment) {
      break;
    }

    const neighbour = pieces
      .filter((piece) => piece.key !== fragment.key)
      .map((piece) => ({
        piece,
        distanceKm: centroidDistanceKm(fragment.geometry, piece.geometry),
        combinedAreaKm2: fragment.areaKm2 + piece.areaKm2
      }))
      .sort(
        (left, right) =>
          left.distanceKm - right.distanceKm ||
          left.combinedAreaKm2 - right.combinedAreaKm2 ||
          left.piece.key.localeCompare(right.piece.key)
      )[0]?.piece;

    if (!neighbour) {
      break;
    }

    const merged = createPiece(
      unionClippingGeometries([fragment.geometry, neighbour.geometry]),
      `${fragment.key}+${neighbour.key}`
    );

    pieces = pieces
      .filter((piece) => piece.key !== fragment.key && piece.key !== neighbour.key)
      .concat(merged ? [merged] : [])
      .sort(comparePieces);
  }

  return pieces;
}

function createZoneCandidates(pieces: readonly PartitionPiece[]): ZoneCandidate[] {
  return pieces.flatMap((piece) => {
    const geometry = clippingMultiPolygonToTerritoryGeometry(piece.geometry);

    if (!geometry) {
      return [];
    }

    const canonicalGeometryHash = sha256Hex(
      serializeJsonStable(canonicalGeometryPayload(geometry))
    );
    const bbox = computeGeometryBBox(geometry);
    const center = computeSafeGeometryCenter(geometry);
    const anchorKey = [
      roundCoordinate(center[1]),
      roundCoordinate(center[0]),
      roundCoordinate(bbox[1]),
      roundCoordinate(bbox[0]),
      roundCoordinate(bbox[3]),
      roundCoordinate(bbox[2])
    ].join(":");
    const localKey = sha256Hex(`${piece.key}:${anchorKey}:${canonicalGeometryHash}`).slice(0, 20);

    return [
      {
        geometry,
        localKey,
        anchorKey,
        geometryHash: canonicalGeometryHash,
        areaKm2: piece.areaKm2
      }
    ];
  });
}

function createTurkeyGameZone(input: {
  candidate: ZoneCandidate;
  displayIndex: number;
  district: TerritoryZone;
  provinceCode: string;
  districtCode: string;
  configuration: ResolvedTurkeyGameZoneConfiguration;
}): TerritoryZone {
  const generationSeed = [
    input.configuration.seed,
    input.district.id,
    input.candidate.anchorKey,
    input.candidate.geometryHash
  ].join(":");
  const id = createTurkeyV2Adm3TerritoryId({
    provinceCode: input.provinceCode,
    districtCode: input.districtCode,
    sourceClass: "generated",
    algorithmVersion: input.configuration.algorithmVersion,
    generationSeed,
    localKey: input.candidate.localKey
  });
  const bbox = computeGeometryBBox(input.candidate.geometry);
  const name = `Generated game zone ${input.displayIndex + 1}`;
  const sourceSnapshotChecksum = sha256Hex(serializeJsonStable(input.configuration));

  return {
    id,
    datasetId: "tr-adm3-game-zones",
    countryCode: "TR",
    level: 3,
    sourceAdminLevel: "ADM3",
    semanticType: "generated-zone",
    name,
    localName: name,
    parentId: input.district.id,
    neighborIds: [],
    geometry: input.candidate.geometry,
    center: computeSafeGeometryCenter(input.candidate.geometry),
    bbox,
    properties: {
      territory: {
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
        providerId: "territory-kit-generated",
        providerName: "TerritoryKit game-zone generator",
        sourceProvider: "territory-kit-generated",
        sourceId: "tr-adm3-game-zones",
        sourceDatasetId: "tr-adm3-game-zones",
        sourceDate: input.configuration.algorithmVersion,
        sourceVersion: input.configuration.algorithmVersion,
        sourceSnapshotChecksum,
        licenseState: "approved",
        license: "Apache-2.0",
        attribution: "TerritoryKit generated game zones from ADM2 boundaries",
        official: false,
        generated: true,
        algorithmVersion: input.configuration.algorithmVersion,
        generationSeed,
        stableId: id,
        coverageStatus: "generated",
        semanticReviewStatus: "not-applicable",
        geometryHash: input.candidate.geometryHash,
        source: {
          provider: "territory-kit-generated",
          sourceClass: "generated",
          boundarySourceClass: "smart-derived",
          providerId: "territory-kit-generated",
          providerName: "TerritoryKit game-zone generator",
          sourceDatasetId: "tr-adm3-game-zones",
          sourceId: "tr-adm3-game-zones",
          sourceDate: input.configuration.algorithmVersion,
          sourceVersion: input.configuration.algorithmVersion,
          sourceSnapshotChecksum,
          licenseState: "approved",
          license: "Apache-2.0",
          attribution: "TerritoryKit generated game zones from ADM2 boundaries"
        },
        generatedZone: {
          algorithm: "deterministic-recursive-spatial-partition",
          algorithmVersion: input.configuration.algorithmVersion,
          seed: input.configuration.seed,
          generationSeed,
          localKey: input.candidate.localKey,
          targetAreaKm2: input.configuration.targetAreaKm2,
          minAreaKm2: input.configuration.minAreaKm2,
          maxAreaKm2: input.configuration.maxAreaKm2,
          maxZonesPerDistrict: input.configuration.maxZonesPerDistrict,
          minFragmentAreaKm2: input.configuration.minFragmentAreaKm2
        }
      }
    }
  };
}

function inspectTurkeyGameZoneQuality(input: {
  district: TerritoryZone;
  zones: readonly TerritoryZone[];
  targetGeometry: ClippingMultiPolygon;
  configuration: ResolvedTurkeyGameZoneConfiguration;
  coverage: TurkeyAdm3DistrictCoverageReport;
  issues: TurkeyGameZoneIssue[];
  deterministicHashBase: string;
  buildDurationMs: number;
}): TurkeyGameZoneQualityReport {
  const qualityIssues = [...input.issues];
  const districtGeometry = toClippingMultiPolygon(input.district.geometry);
  const generatedUnion = unionClippingGeometries(
    input.zones.map((zone) => toClippingMultiPolygon(zone.geometry))
  );
  const gap = differenceClippingGeometries(input.targetGeometry, generatedUnion);
  const gapAreaKm2 = clippingAreaKm2(gap);
  const overlaps = collectOverlaps(input.zones, input.configuration.overlapToleranceKm2);
  const parentErrors = collectParentContainmentErrors(
    input.zones,
    districtGeometry,
    input.configuration.parentOutsideToleranceKm2
  );
  const geometryValidation = validateGeometryDataset(
    createTurkeyGameZoneDataset({
      district: input.district,
      zones: input.zones,
      includeParent: false
    }),
    {
      checks: {
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
    }
  );
  const invalidGeometryCount = geometryValidation.issues.filter(
    (issue) => issue.severity === "error"
  ).length;
  const zoneAreas = input.zones.map((zone) => computeTurkeyAdm3GeometryAreaKm2(zone.geometry));
  const emptyGeometryCount = zoneAreas.filter((area) => area <= 0).length;
  const duplicateGeometryCount = countDuplicateGeometries(input.zones);
  const sliverAreas = zoneAreas.filter((area) => area < input.configuration.minFragmentAreaKm2);
  const compactnessValues = input.zones.map((zone) => compactness(zone.geometry));
  const bboxThinCount = input.zones.filter((zone) =>
    isThinZone(zone.geometry, input.configuration.minWidthKm)
  ).length;
  const zonesBelowMinimum = zoneAreas.filter(
    (area) => area + AREA_TOLERANCE_KM2 < input.configuration.minAreaKm2
  ).length;
  const zonesAboveMaximum = zoneAreas.filter(
    (area) => area - AREA_TOLERANCE_KM2 > input.configuration.maxAreaKm2
  ).length;
  const stableIdCollisionCount = countStableIdCollisions(input.zones);
  const metadataErrorCount = countMetadataErrors(input.zones, input.configuration);
  const gates = {
    coverage: input.coverage.finalCoveragePercent >= input.configuration.coverageTargetPercent,
    invalidGeometry: invalidGeometryCount === 0,
    duplicateGeometry: duplicateGeometryCount === 0,
    overlap: overlaps.length === 0,
    parentContainment: parentErrors.length === 0,
    emptyGeometry: emptyGeometryCount === 0,
    zoneCount: input.zones.length <= input.configuration.maxZonesPerDistrict,
    metadata: metadataErrorCount === 0,
    stableIdCollision: stableIdCollisionCount === 0
  };

  if (!gates.coverage) {
    qualityIssues.push({
      code: "COVERAGE_THRESHOLD_FAILED",
      severity: "error",
      message: "Turkey game-zone final coverage is below 99.99%.",
      parentId: input.district.id,
      details: { finalCoveragePercent: input.coverage.finalCoveragePercent }
    });
  }

  for (const overlap of overlaps) {
    qualityIssues.push({
      code: "SIBLING_OVERLAP",
      severity: "error",
      message: "Turkey game-zone siblings overlap beyond tolerance.",
      zoneId: overlap.leftZoneId,
      parentId: input.district.id,
      details: overlap
    });
  }

  for (const parentError of parentErrors) {
    qualityIssues.push({
      code: "PARENT_CONTAINMENT_ERROR",
      severity: "error",
      message: "Turkey game-zone extends outside its ADM2 parent beyond tolerance.",
      zoneId: parentError.zoneId,
      parentId: input.district.id,
      details: parentError
    });
  }

  if (invalidGeometryCount > 0) {
    qualityIssues.push({
      code: "INVALID_GEOMETRY",
      severity: "error",
      message: "Turkey game-zone geometry validation reported invalid geometry.",
      details: { invalidGeometryCount }
    });
  }

  if (emptyGeometryCount > 0) {
    qualityIssues.push({
      code: "EMPTY_GEOMETRY",
      severity: "error",
      message: "Turkey game-zone generation produced empty geometry.",
      details: { emptyGeometryCount }
    });
  }

  if (duplicateGeometryCount > 0) {
    qualityIssues.push({
      code: "DUPLICATE_GEOMETRY",
      severity: "error",
      message: "Turkey game-zone generation produced duplicate geometry.",
      details: { duplicateGeometryCount }
    });
  }

  if (stableIdCollisionCount > 0) {
    qualityIssues.push({
      code: "STABLE_ID_COLLISION",
      severity: "error",
      message: "Turkey game-zone stable ID collision detected.",
      details: { stableIdCollisionCount }
    });
  }

  if (metadataErrorCount > 0) {
    qualityIssues.push({
      code: "METADATA_CONTRACT_ERROR",
      severity: "error",
      message: "Turkey game-zone metadata does not match the Sprint 1 generated-zone contract.",
      details: { metadataErrorCount }
    });
  }

  if (zonesBelowMinimum > 0) {
    qualityIssues.push({
      code: "ZONE_AREA_BELOW_MINIMUM",
      severity: "warning",
      message: "Some Turkey game zones are below the configured minimum area.",
      details: { zonesBelowMinimum }
    });
  }

  if (zonesAboveMaximum > 0) {
    qualityIssues.push({
      code: "ZONE_AREA_ABOVE_MAXIMUM",
      severity: "warning",
      message: "Some Turkey game zones are above the configured maximum area.",
      details: { zonesAboveMaximum }
    });
  }

  const compactnessBelowTarget = compactnessValues.filter(
    (value) => value < input.configuration.compactnessTarget
  ).length;
  if (compactnessBelowTarget > 0) {
    qualityIssues.push({
      code: "COMPACTNESS_WARNING",
      severity: "warning",
      message: "Some Turkey game zones are below the profile compactness target.",
      details: { compactnessBelowTarget }
    });
  }

  if (bboxThinCount > 0) {
    qualityIssues.push({
      code: "THIN_ZONE_WARNING",
      severity: "warning",
      message: "Some Turkey game zones are thinner than the profile width target.",
      details: { thinZoneCount: bboxThinCount }
    });
  }

  const deterministicOutputHash = sha256Hex(
    serializeJsonStable({
      base: input.deterministicHashBase,
      quality: {
        finalCoveragePercent: input.coverage.finalCoveragePercent,
        gapAreaKm2,
        overlapAreaKm2: sum(overlaps.map((overlap) => overlap.areaKm2)),
        zoneAreas,
        compactnessValues,
        issues: qualityIssues.map((issue) => ({
          code: issue.code,
          severity: issue.severity,
          zoneId: issue.zoneId ?? null
        }))
      }
    })
  );
  const hardFailureCount = qualityIssues.filter((issue) => issue.severity === "error").length;
  const warningCount = qualityIssues.filter((issue) => issue.severity === "warning").length;

  return {
    schemaVersion: TURKEY_GAME_ZONE_QUALITY_SCHEMA_VERSION,
    ok: Object.values(gates).every(Boolean) && hardFailureCount === 0,
    hardFailureCount,
    warningCount,
    districtId: input.district.id,
    parentId: input.district.id,
    districtAreaKm2: clippingAreaKm2(districtGeometry),
    targetGeometryAreaKm2: input.configuration.targetGeometryAreaKm2,
    generatedUnionAreaKm2: clippingAreaKm2(generatedUnion),
    finalCoveragePercent: input.coverage.finalCoveragePercent,
    gapCount: gap.length,
    gapAreaKm2,
    overlapCount: overlaps.length,
    overlapAreaKm2: sum(overlaps.map((overlap) => overlap.areaKm2)),
    invalidGeometryCount,
    emptyGeometryCount,
    duplicateGeometryCount,
    sliverCount: sliverAreas.length,
    sliverTotalAreaKm2: sum(sliverAreas),
    parentContainmentErrorCount: parentErrors.length,
    minZoneAreaKm2: min(zoneAreas),
    maxZoneAreaKm2: max(zoneAreas),
    meanZoneAreaKm2: mean(zoneAreas),
    medianZoneAreaKm2: median(zoneAreas),
    zoneAreaStandardDeviationKm2: standardDeviation(zoneAreas),
    zonesBelowMinimum,
    zonesAboveMaximum,
    multiPolygonZoneCount: input.zones.filter((zone) => zone.geometry.type === "MultiPolygon")
      .length,
    disconnectedZoneCount: input.zones.filter(
      (zone) => geometryToPolygons(zone.geometry).length > 1
    ).length,
    compactness: {
      min: min(compactnessValues),
      mean: mean(compactnessValues),
      median: median(compactnessValues)
    },
    thinZoneCount: bboxThinCount,
    producedZoneCount: input.zones.length,
    targetZoneCount: input.configuration.targetZoneCount,
    selectedProfile: input.configuration.selectedProfile,
    algorithmVersion: input.configuration.algorithmVersion,
    seedHash: sha256Hex(input.configuration.seed).slice(0, 16),
    deterministicOutputHash,
    buildDurationMs: input.buildDurationMs,
    gates,
    issues: sortIssues(qualityIssues)
  };
}

function selectGameZoneProfile(input: {
  requestedProfile: TurkeyGameZoneProfile;
  districtAreaKm2: number;
  targetGeometryAreaKm2: number;
  existingRealZoneCount: number;
  population?: number;
  populationDensityPerKm2?: number;
  urbanityHint?: TurkeyGameZoneUrbanityHint;
}): TurkeyGameZoneProfileDecision {
  const reasons: string[] = [];
  let selectedProfile: ResolvedTurkeyGameZoneProfile;

  if (input.requestedProfile !== "auto") {
    selectedProfile = input.requestedProfile;
    reasons.push(`requested:${input.requestedProfile}`);
  } else if (input.urbanityHint) {
    selectedProfile = input.urbanityHint;
    reasons.push(`urbanityHint:${input.urbanityHint}`);
  } else {
    const density =
      input.populationDensityPerKm2 ??
      (input.population !== undefined && input.districtAreaKm2 > 0
        ? input.population / input.districtAreaKm2
        : undefined);

    if (density !== undefined && density >= 3_000) {
      selectedProfile = "urban";
      reasons.push("density>=3000");
    } else if (density !== undefined && density >= 600) {
      selectedProfile = "suburban";
      reasons.push("density>=600");
    } else if (input.targetGeometryAreaKm2 <= 75 || input.existingRealZoneCount >= 20) {
      selectedProfile = "urban";
      reasons.push(input.targetGeometryAreaKm2 <= 75 ? "area<=75" : "realZoneCount>=20");
    } else if (input.targetGeometryAreaKm2 <= 450) {
      selectedProfile = "suburban";
      reasons.push("area<=450");
    } else {
      selectedProfile = "rural";
      reasons.push("area>450");
    }
  }

  return {
    selectedProfile,
    reasons,
    signals: {
      districtAreaKm2: input.districtAreaKm2,
      targetAreaKm2: input.targetGeometryAreaKm2,
      existingRealZoneCount: input.existingRealZoneCount,
      ...(input.population !== undefined ? { population: input.population } : {}),
      ...(input.populationDensityPerKm2 !== undefined
        ? { populationDensityPerKm2: input.populationDensityPerKm2 }
        : {}),
      ...(input.urbanityHint ? { urbanityHint: input.urbanityHint } : {})
    }
  };
}

function createFallbackConfiguration(
  options: TurkeyGameZoneGeneratorOptions,
  algorithmVersion: string
): ResolvedTurkeyGameZoneConfiguration {
  const defaults = PROFILE_DEFAULTS.suburban;
  return {
    schemaVersion: TURKEY_GAME_ZONE_CONFIGURATION_SCHEMA_VERSION,
    profile: options.profile,
    selectedProfile: options.profile === "custom" ? "custom" : "suburban",
    algorithmVersion,
    seed: options.seed ?? "kaprota-v2",
    targetAreaKm2: defaults.targetAreaKm2,
    minAreaKm2: defaults.minAreaKm2,
    maxAreaKm2: defaults.maxAreaKm2,
    targetZoneCount: 1,
    maxZonesPerDistrict: defaults.maxZonesPerDistrict,
    minFragmentAreaKm2: defaults.minFragmentAreaKm2,
    fragmentStrategy: defaults.fragmentStrategy,
    compactnessTarget: defaults.compactnessTarget,
    minWidthKm: defaults.minWidthKm,
    coverageTargetPercent: 99.99,
    overlapToleranceKm2: AREA_TOLERANCE_KM2,
    parentOutsideToleranceKm2: AREA_TOLERANCE_KM2,
    targetGeometryAreaKm2: 0
  };
}

function collectOverlaps(
  zones: readonly TerritoryZone[],
  toleranceKm2: number
): Array<{ leftZoneId: string; rightZoneId: string; areaKm2: number }> {
  const overlaps = [];
  const sorted = [...zones].sort((left, right) => left.id.localeCompare(right.id));

  for (let index = 0; index < sorted.length; index += 1) {
    const left = sorted[index];
    if (!left) continue;

    for (let nextIndex = index + 1; nextIndex < sorted.length; nextIndex += 1) {
      const right = sorted[nextIndex];
      if (!right || !bboxesOverlap(left.bbox, right.bbox)) continue;

      const areaKm2 = clippingAreaKm2(
        intersectClippingGeometries(
          toClippingMultiPolygon(left.geometry),
          toClippingMultiPolygon(right.geometry)
        )
      );

      if (areaKm2 > toleranceKm2) {
        overlaps.push({ leftZoneId: left.id, rightZoneId: right.id, areaKm2 });
      }
    }
  }

  return overlaps.sort((left, right) => left.leftZoneId.localeCompare(right.leftZoneId));
}

function collectParentContainmentErrors(
  zones: readonly TerritoryZone[],
  parent: ClippingMultiPolygon,
  toleranceKm2: number
): Array<{ zoneId: string; outsideAreaKm2: number }> {
  return zones
    .map((zone) => ({
      zoneId: zone.id,
      outsideAreaKm2: clippingAreaKm2(
        differenceClippingGeometries(toClippingMultiPolygon(zone.geometry), parent)
      )
    }))
    .filter((item) => item.outsideAreaKm2 > toleranceKm2)
    .sort((left, right) => left.zoneId.localeCompare(right.zoneId));
}

function countDuplicateGeometries(zones: readonly TerritoryZone[]): number {
  const hashes = new Map<string, number>();

  for (const zone of zones) {
    const hash = sha256Hex(serializeJsonStable(canonicalGeometryPayload(zone.geometry)));
    hashes.set(hash, (hashes.get(hash) ?? 0) + 1);
  }

  return [...hashes.values()].filter((count) => count > 1).length;
}

function countStableIdCollisions(zones: readonly TerritoryZone[]): number {
  const ids = new Map<string, number>();

  for (const zone of zones) {
    const territory = isRecord(zone.properties.territory) ? zone.properties.territory : {};
    const stableId = typeof territory.stableId === "string" ? territory.stableId : zone.id;
    ids.set(stableId, (ids.get(stableId) ?? 0) + 1);
  }

  return [...ids.values()].filter((count) => count > 1).length;
}

function countMetadataErrors(
  zones: readonly TerritoryZone[],
  configuration: ResolvedTurkeyGameZoneConfiguration
): number {
  return zones.filter((zone) => {
    const territory = isRecord(zone.properties.territory) ? zone.properties.territory : {};
    return (
      zone.semanticType !== "generated-zone" ||
      territory.sourceClass !== "generated" ||
      territory.official !== false ||
      territory.generated !== true ||
      territory.semanticType !== "generated-zone" ||
      territory.localType === "neighbourhood" ||
      territory.localType === "village" ||
      territory.algorithmVersion !== configuration.algorithmVersion ||
      territory.countryCode !== "TR"
    );
  }).length;
}

function addNeighborIds(
  zones: readonly TerritoryZone[],
  edges: readonly { from: string; to: string }[]
): TerritoryZone[] {
  const neighbours = new Map<string, Set<string>>();

  for (const zone of zones) {
    neighbours.set(zone.id, new Set());
  }

  for (const edge of edges) {
    neighbours.get(edge.from)?.add(edge.to);
    neighbours.get(edge.to)?.add(edge.from);
  }

  return zones.map((zone) => ({
    ...zone,
    neighborIds: [...(neighbours.get(zone.id) ?? new Set<string>())].sort()
  }));
}

function withChildIds(
  district: TerritoryZone,
  zones: readonly TerritoryZone[],
  datasetId: string
): TerritoryZone {
  const { parentId: _parentId, ...standaloneDistrict } = district;

  return {
    ...standaloneDistrict,
    datasetId,
    childIds: zones.map((zone) => zone.id).sort(),
    neighborIds: [...district.neighborIds].sort()
  };
}

function createDeterministicHashBase(input: {
  zones: readonly TerritoryZone[];
  configuration: ResolvedTurkeyGameZoneConfiguration;
  coverage: TurkeyAdm3DistrictCoverageReport;
}): string {
  return sha256Hex(
    serializeJsonStable({
      configuration: input.configuration,
      coverage: input.coverage,
      zones: input.zones.map((zone) => ({
        id: zone.id,
        parentId: zone.parentId ?? null,
        geometry: canonicalGeometryPayload(zone.geometry),
        territory: isRecord(zone.properties.territory) ? zone.properties.territory : {}
      }))
    })
  );
}

function createPiece(geometry: ClippingMultiPolygon, key: string): PartitionPiece | undefined {
  const areaKm2 = clippingAreaKm2(geometry);
  return areaKm2 > AREA_TOLERANCE_KM2 ? { geometry, key, areaKm2 } : undefined;
}

function toClippingMultiPolygon(geometry: TerritoryGeometry): ClippingMultiPolygon {
  return geometryToPolygons(geometry)
    .map((polygon) => {
      const rings = polygon
        .map(normalizeRing)
        .filter((ring) => ring.length >= 4 && ringHasPlanarArea(ring));
      return rings.length > 0 ? (rings as ClippingPolygon) : undefined;
    })
    .filter((polygon): polygon is ClippingPolygon => Boolean(polygon));
}

function clippingMultiPolygonToTerritoryGeometry(
  geometry: ClippingMultiPolygon
): TerritoryGeometry | undefined {
  const polygons = geometry
    .map((polygon) =>
      polygon.map(normalizeRing).filter((ring) => ring.length >= 4 && ringHasPlanarArea(ring))
    )
    .filter((polygon) => polygon.length > 0);

  if (polygons.length === 0) return undefined;
  if (polygons.length === 1) return { type: "Polygon", coordinates: polygons[0]! };
  return { type: "MultiPolygon", coordinates: polygons };
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

function unionClippingGeometries(
  geometries: readonly ClippingMultiPolygon[]
): ClippingMultiPolygon {
  const nonEmpty = geometries.filter(isNonEmptyClippingGeometry);
  if (nonEmpty.length === 0) return [];
  if (nonEmpty.length === 1) return nonEmpty[0]!;

  try {
    return CLIPPER.union(nonEmpty[0]!, ...nonEmpty.slice(1));
  } catch {
    return nonEmpty.flatMap((geometry) => geometry);
  }
}

function intersectClippingGeometries(
  left: ClippingMultiPolygon,
  right: ClippingMultiPolygon
): ClippingMultiPolygon {
  if (!isNonEmptyClippingGeometry(left) || !isNonEmptyClippingGeometry(right)) return [];

  try {
    return CLIPPER.intersection(left, right);
  } catch {
    return [];
  }
}

function differenceClippingGeometries(
  subject: ClippingMultiPolygon,
  ...clips: readonly ClippingMultiPolygon[]
): ClippingMultiPolygon {
  const nonEmptyClips = clips.filter(isNonEmptyClippingGeometry);
  if (!isNonEmptyClippingGeometry(subject)) return [];
  if (nonEmptyClips.length === 0) return subject;

  try {
    return CLIPPER.difference(subject, ...nonEmptyClips);
  } catch {
    let result = subject;

    for (const clip of nonEmptyClips) {
      if (!isNonEmptyClippingGeometry(result)) return [];

      try {
        result = CLIPPER.difference(result, clip);
      } catch {
        continue;
      }
    }

    return result;
  }
}

function clippingAreaKm2(geometry: ClippingMultiPolygon): number {
  return roundAreaKm2(
    geometry.reduce((total, polygon) => total + Math.max(0, polygonAreaM2(polygon)), 0) / 1_000_000
  );
}

function polygonAreaM2(polygon: ClippingPolygon): number {
  const [shell, ...holes] = polygon;
  if (!shell) return 0;

  return Math.max(
    0,
    ringAreaM2(shell) - holes.reduce((total, hole) => total + ringAreaM2(hole), 0)
  );
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
    if (!current || !next) continue;

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
    if (!current || !next) continue;

    area +=
      current[0] * metersPerDegreeLongitude * next[1] * metersPerDegreeLatitude -
      next[0] * metersPerDegreeLongitude * current[1] * metersPerDegreeLatitude;
  }

  return area / 2;
}

function geometryPerimeterKm(geometry: TerritoryGeometry): number {
  return geometryToPolygons(geometry).reduce(
    (total, polygon) =>
      total + polygon.reduce((ringTotal, ring) => ringTotal + ringLengthKm(normalizeRing(ring)), 0),
    0
  );
}

function ringLengthKm(ring: readonly LngLat[]): number {
  let total = 0;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index];
    const next = ring[index + 1];
    if (current && next) total += haversineKm(current, next);
  }

  return total;
}

function compactness(geometry: TerritoryGeometry): number {
  const areaM2 = computeTurkeyAdm3GeometryAreaKm2(geometry) * 1_000_000;
  const perimeterM = geometryPerimeterKm(geometry) * 1_000;

  if (areaM2 <= 0 || perimeterM <= 0) return 0;
  return roundMetric(Math.min(1, (4 * Math.PI * areaM2) / (perimeterM * perimeterM)));
}

function isThinZone(geometry: TerritoryGeometry, minWidthKm: number): boolean {
  const bbox = computeGeometryBBox(geometry);
  const centerLatitude = (bbox[1] + bbox[3]) / 2;
  const widthKm = Math.abs(bbox[2] - bbox[0]) * kilometersPerLongitudeDegree(centerLatitude);
  const heightKm = Math.abs(bbox[3] - bbox[1]) * 111.32;

  return Math.min(widthKm, heightKm) < minWidthKm;
}

function centroidDistanceKm(left: ClippingMultiPolygon, right: ClippingMultiPolygon): number {
  const leftGeometry = clippingMultiPolygonToTerritoryGeometry(left);
  const rightGeometry = clippingMultiPolygonToTerritoryGeometry(right);

  if (!leftGeometry || !rightGeometry) return Number.POSITIVE_INFINITY;
  return haversineKm(computeGeometryCenter(leftGeometry), computeGeometryCenter(rightGeometry));
}

function haversineKm(left: LngLat, right: LngLat): number {
  const deltaLatitude = toRadians(right[1] - left[1]);
  const deltaLongitude = toRadians(right[0] - left[0]);
  const leftLatitude = toRadians(left[1]);
  const rightLatitude = toRadians(right[1]);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(deltaLongitude / 2) ** 2;

  return (2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) / 1_000;
}

function clippingBBox(geometry: ClippingMultiPolygon): TerritoryBBox {
  const territoryGeometry = clippingMultiPolygonToTerritoryGeometry(geometry);
  return territoryGeometry ? computeGeometryBBox(territoryGeometry) : [0, 0, 0, 0];
}

function bboxToRect(bbox: TerritoryBBox): Rect {
  return {
    west: Math.min(bbox[0], bbox[2]),
    south: Math.min(bbox[1], bbox[3]),
    east: Math.max(bbox[0], bbox[2]),
    north: Math.max(bbox[1], bbox[3])
  };
}

function rectToGeometry(rect: Rect): TerritoryGeometry {
  return {
    type: "Polygon",
    coordinates: [
      [
        [rect.west, rect.south],
        [rect.east, rect.south],
        [rect.east, rect.north],
        [rect.west, rect.north],
        [rect.west, rect.south]
      ]
    ]
  };
}

function canonicalGeometryPayload(geometry: TerritoryGeometry): unknown {
  return geometryToPolygons(geometry)
    .map((polygon) => {
      const rings = polygon.map((ring) => canonicalRing(normalizeRing(ring)));
      const [shell, ...holes] = rings;
      return {
        shell,
        holes: holes.sort(compareSerialized)
      };
    })
    .sort((left, right) => compareSerialized(left.shell, right.shell));
}

function canonicalRing(ring: readonly LngLat[]): LngLat[] {
  const open = ring
    .slice(0, -1)
    .map((point) => [roundCoordinate(point[0]), roundCoordinate(point[1])] satisfies LngLat);
  const forward = rotateToSmallest(open);
  const reverse = rotateToSmallest([...open].reverse());
  const chosen = compareSerialized(forward, reverse) <= 0 ? forward : reverse;

  return [...chosen, chosen[0] ?? [0, 0]];
}

function rotateToSmallest(ring: readonly LngLat[]): LngLat[] {
  if (ring.length === 0) return [];
  let bestIndex = 0;

  for (let index = 1; index < ring.length; index += 1) {
    const point = ring[index]!;
    const best = ring[bestIndex]!;
    if (point[0] < best[0] || (point[0] === best[0] && point[1] < best[1])) {
      bestIndex = index;
    }
  }

  return [...ring.slice(bestIndex), ...ring.slice(0, bestIndex)].map(
    (point) => [...point] as LngLat
  );
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

  if (deduped.length === 0) return [];
  const first = deduped[0]!;
  const last = deduped[deduped.length - 1]!;
  if (!pointsEqual(first, last)) deduped.push([...first]);
  return deduped;
}

function pointsEqual(left: LngLat, right: LngLat): boolean {
  return (
    Math.abs(left[0] - right[0]) <= COORDINATE_EPSILON &&
    Math.abs(left[1] - right[1]) <= COORDINATE_EPSILON
  );
}

function ringHasPlanarArea(ring: readonly LngLat[]): boolean {
  let area = 0;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index];
    const next = ring[index + 1];
    if (current && next) area += current[0] * next[1] - next[0] * current[1];
  }

  return Math.abs(area / 2) > RING_AREA_EPSILON;
}

function isNonEmptyClippingGeometry(
  geometry: ClippingMultiPolygon
): geometry is ClippingMultiPolygon {
  return geometry.length > 0;
}

function bboxesOverlap(left: TerritoryBBox, right: TerritoryBBox): boolean {
  return left[0] <= right[2] && left[2] >= right[0] && left[1] <= right[3] && left[3] >= right[1];
}

function sortZones(zones: readonly TerritoryZone[]): TerritoryZone[] {
  return [...zones].sort((left, right) => left.id.localeCompare(right.id));
}

function comparePieces(left: PartitionPiece, right: PartitionPiece): number {
  return (
    compareBBoxes(clippingBBox(left.geometry), clippingBBox(right.geometry)) ||
    left.key.localeCompare(right.key)
  );
}

function compareZoneCandidates(left: ZoneCandidate, right: ZoneCandidate): number {
  return (
    compareBBoxes(computeGeometryBBox(left.geometry), computeGeometryBBox(right.geometry)) ||
    left.anchorKey.localeCompare(right.anchorKey) ||
    left.geometryHash.localeCompare(right.geometryHash) ||
    left.localKey.localeCompare(right.localKey)
  );
}

function compareBBoxes(left: TerritoryBBox, right: TerritoryBBox): number {
  return left[1] - right[1] || left[0] - right[0] || left[3] - right[3] || left[2] - right[2];
}

function compareSerialized(left: unknown, right: unknown): number {
  return serializeJsonStable(left).localeCompare(serializeJsonStable(right));
}

function deterministicUnitInterval(input: string): number {
  const hex = sha256Hex(input).slice(0, 12);
  return Number.parseInt(hex, 16) / 0xffffffffffff;
}

function validatePositiveFinite(
  value: number,
  code: TurkeyGameZoneIssueCode,
  field: string,
  issues: TurkeyGameZoneIssue[]
): void {
  if (!Number.isFinite(value) || value <= 0) {
    issues.push({
      code,
      severity: "error",
      message: `Turkey game-zone ${field} must be a positive finite number.`,
      details: { field, value }
    });
  }
}

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function sortIssues(issues: readonly TurkeyGameZoneIssue[]): TurkeyGameZoneIssue[] {
  return [...issues].sort(
    (left, right) =>
      severityRank(left.severity) - severityRank(right.severity) ||
      left.code.localeCompare(right.code) ||
      (left.zoneId ?? "").localeCompare(right.zoneId ?? "") ||
      left.message.localeCompare(right.message)
  );
}

function severityRank(severity: TurkeyGameZoneIssueSeverity): number {
  return severity === "error" ? 0 : severity === "warning" ? 1 : 2;
}

function clampInteger(value: number, minValue: number, maxValue: number): number {
  return Math.max(minValue, Math.min(maxValue, value));
}

function kilometersPerLongitudeDegree(latitude: number): number {
  return Math.max(GEOMETRY_EPSILON, 111.32 * Math.cos(toRadians(latitude)));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function normalizeRadians(radians: number): number {
  if (radians > Math.PI) return radians - Math.PI * 2;
  if (radians < -Math.PI) return radians + Math.PI * 2;
  return radians;
}

function roundCoordinate(value: number): number {
  return Number(value.toFixed(12));
}

function roundAreaKm2(value: number): number {
  return Number(value.toFixed(6));
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}

function sum(values: readonly number[]): number {
  return roundAreaKm2(values.reduce((total, value) => total + value, 0));
}

function min(values: readonly number[]): number {
  return values.length === 0 ? 0 : roundAreaKm2(Math.min(...values));
}

function max(values: readonly number[]): number {
  return values.length === 0 ? 0 : roundAreaKm2(Math.max(...values));
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : roundAreaKm2(sum(values) / values.length);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? roundAreaKm2(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2)
    : roundAreaKm2(sorted[middle] ?? 0);
}

function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const average = mean(values);
  return roundAreaKm2(
    Math.sqrt(values.reduce((total, value) => total + (value - average) ** 2, 0) / values.length)
  );
}
