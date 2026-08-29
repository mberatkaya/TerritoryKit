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
  TerritoryAdjacencyArtifact,
  TerritoryBBox,
  TerritoryDataset,
  TerritoryGeometry,
  TerritoryZone
} from "@territory-kit/dataset";
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import * as polygonClipping from "polygon-clipping";
import type {
  MultiPolygon as ClippingMultiPolygon,
  Polygon as ClippingPolygon
} from "polygon-clipping";
import { buildTerritoryAdjacency } from "./adjacency.js";
import { computeGeometryRepresentativePoint } from "./geometry-repair.js";
import { createTurkeyV2Adm3TerritoryId } from "./turkey-adm3-ingestion.js";
import { isRecord, serializeJsonStable, sha256Hex } from "./sources/utils.js";

export const TURKEY_SMART_FALLBACK_ALGORITHM_VERSION = "smart-derived-v1" as const;
export const TURKEY_SMART_FALLBACK_CONFIGURATION_SCHEMA_VERSION =
  "territorykit-tr-smart-fallback-config@1" as const;
export const TURKEY_SMART_FALLBACK_MANIFEST_SCHEMA_VERSION =
  "territorykit-tr-smart-fallback-manifest@1" as const;
export const TURKEY_SMART_FALLBACK_QUALITY_SCHEMA_VERSION =
  "territorykit-tr-smart-fallback-quality@1" as const;

export type TurkeySmartFallbackProfile =
  "dense-urban" | "urban" | "suburban" | "rural" | "auto" | "custom";
export type ResolvedTurkeySmartFallbackProfile = Exclude<TurkeySmartFallbackProfile, "auto">;
export type TurkeySmartFallbackBarrierLayer = "roads" | "railways" | "water" | "landuse" | "parks";
export type TurkeySmartFallbackBarrierClass =
  "road" | "rail" | "water" | "coastline" | "park" | "forest" | "synthetic";
export type TurkeySmartFallbackBarrierStrengthClass = "strong" | "medium" | "weak" | "ignored";
export type TurkeySmartFallbackStatus = "success" | "rejected";
export type TurkeySmartFallbackSourceStrategy = "barrier-guided" | "synthetic-last-resort";

export type TurkeySmartFallbackIssueCode =
  | "OFFICIAL_ADM3_UNAVAILABLE"
  | "OSM_ADMIN_BOUNDARY_UNAVAILABLE"
  | "SMART_FALLBACK_GENERATED"
  | "SMART_FALLBACK_ALIGNMENT_TOO_LOW"
  | "SMART_FALLBACK_COVERAGE_TOO_LOW"
  | "SMART_FALLBACK_COORDINATE_ORDER_INVALID"
  | "SMART_FALLBACK_GEOMETRY_INVALID"
  | "SMART_FALLBACK_LOW_QUALITY"
  | "SMART_FALLBACK_INVALID_TOPOLOGY"
  | "SMART_FALLBACK_INSUFFICIENT_BARRIERS"
  | "SMART_FALLBACK_QUALITY_REJECTED"
  | "SMART_FALLBACK_SPILL_TOO_HIGH"
  | "SMART_FALLBACK_SYNTHETIC_SPLIT_USED"
  | "SMART_FALLBACK_PARENT_GEOMETRY_INVALID"
  | "SMART_FALLBACK_UNSUPPORTED_PROFILE"
  | "SMART_FALLBACK_UNSUPPORTED_ALGORITHM"
  | "SMART_FALLBACK_EMPTY_SEED"
  | "SMART_FALLBACK_INVALID_TARGET_AREA"
  | "SMART_FALLBACK_INVALID_AREA_ORDERING"
  | "SMART_FALLBACK_INVALID_TARGET_COUNT"
  | "SMART_FALLBACK_NO_GEOMETRY"
  | "SMART_FALLBACK_BARRIER_IGNORED"
  | "SMART_FALLBACK_SPLIT_FAILED"
  | "LEGACY_FALLBACK_USED";

export interface TurkeySmartFallbackIssue {
  code: TurkeySmartFallbackIssueCode;
  severity: "error" | "warning" | "info";
  message: string;
  zoneId?: string;
  parentId?: string;
  details?: Record<string, unknown>;
}

export interface TurkeySmartFallbackLocalitySeed {
  id?: string;
  name: string;
  coordinate: LngLat;
  type?: "neighbourhood" | "suburb" | "quarter" | "village" | "locality" | "unknown";
  source?: string;
  sourceId?: string;
  authoritative?: false;
  confidence?: number;
}

export interface TurkeySmartFallbackBarrierConfig {
  roadScores: Record<string, number>;
  railwayScores: Record<string, number>;
  waterwayScores: Record<string, number>;
  naturalScores: Record<string, number>;
  landuseScores: Record<string, number>;
  leisureScores: Record<string, number>;
  defaultRoadScore: number;
  defaultRailScore: number;
  defaultWaterScore: number;
  minimumAcceptedStrength: number;
}

export interface TurkeySmartFallbackSourceMetadata {
  providerId?: string;
  providerName?: string;
  sourceDatasetId?: string;
  sourceId?: string;
  sourceDate?: string;
  sourceVersion?: string;
  sourceUrl?: string;
  sourceSnapshotId?: string;
  sourceSnapshotChecksum?: string;
  license?: string;
  attribution?: string;
}

export interface TurkeySmartFallbackOptions {
  algorithmVersion?: string;
  seed?: string;
  targetTerritoryCount?: number;
  maxTerritories?: number;
  targetAreaKm2?: number;
  minAreaKm2?: number;
  maxAreaKm2?: number;
  minFragmentAreaKm2?: number;
  minBarrierStrength?: number;
  minAlignmentStrength?: number;
  minBarrierLengthKm?: number;
  maxSyntheticSplits?: number;
  minCoveragePercent?: number;
  overlapToleranceKm2?: number;
  spillToleranceKm2?: number;
  minMeanQualityScore?: number;
  minMeanBarrierAlignment?: number;
  requireBarrierForMultiTerritory?: boolean;
  alignmentToleranceMeters?: number;
  snapToleranceDegrees?: number;
  barrierConfig?: Partial<TurkeySmartFallbackBarrierConfig>;
  sourceMetadata?: TurkeySmartFallbackSourceMetadata;
}

export interface TurkeySmartFallbackInput {
  parent: TerritoryZone;
  provinceCode: string;
  districtCode: string;
  profile: TurkeySmartFallbackProfile;
  roads?: FeatureCollection;
  railways?: FeatureCollection;
  water?: FeatureCollection;
  landuse?: FeatureCollection;
  parks?: FeatureCollection;
  localitySeeds?: readonly TurkeySmartFallbackLocalitySeed[];
  options?: TurkeySmartFallbackOptions;
}

export interface TurkeySmartFallbackBarrier {
  id: string;
  sourceLayer: TurkeySmartFallbackBarrierLayer;
  barrierClass: TurkeySmartFallbackBarrierClass;
  strengthClass: TurkeySmartFallbackBarrierStrengthClass;
  strength: number;
  coordinates: LngLat[];
  lengthKm: number;
  sourceNativeId?: string;
  name?: string;
  tags: Record<string, string>;
}

export interface TurkeySmartFallbackConfiguration {
  schemaVersion: typeof TURKEY_SMART_FALLBACK_CONFIGURATION_SCHEMA_VERSION;
  profile: TurkeySmartFallbackProfile;
  selectedProfile: ResolvedTurkeySmartFallbackProfile;
  algorithmVersion: typeof TURKEY_SMART_FALLBACK_ALGORITHM_VERSION;
  seed: string;
  targetAreaKm2: number;
  minAreaKm2: number;
  maxAreaKm2: number;
  minFragmentAreaKm2: number;
  targetTerritoryCount: number;
  maxTerritories: number;
  minBarrierStrength: number;
  minAlignmentStrength: number;
  minBarrierLengthKm: number;
  maxSyntheticSplits: number;
  minCoveragePercent: number;
  overlapToleranceKm2: number;
  spillToleranceKm2: number;
  minMeanQualityScore: number;
  minMeanBarrierAlignment: number;
  requireBarrierForMultiTerritory: boolean;
  alignmentToleranceMeters: number;
  snapToleranceDegrees: number;
  targetGeometryAreaKm2: number;
  profileDecision: {
    reasons: string[];
    signals: {
      parentAreaKm2: number;
      strongBarrierCount: number;
      mediumBarrierCount: number;
      roadDensityKmPerKm2: number;
      localitySeedCount: number;
    };
  };
}

export interface TurkeySmartFallbackZoneQuality {
  score: number;
  compactness: number;
  barrierAlignment: number;
  realBarrierRatio: number;
  syntheticBoundaryRatio: number;
  barrierEvidence: number;
  sizeScore: number;
  seedConfidence?: number;
  topology: number;
}

export interface TurkeySmartFallbackInputDiagnostics {
  adm2Id: string;
  roadsRaw: number;
  roadsNormalized: number;
  majorRoadsRaw: number;
  majorRoadsNormalized: number;
  railRaw: number;
  railNormalized: number;
  waterRaw: number;
  waterNormalized: number;
  parksRaw: number;
  parksNormalized: number;
  landuseRaw: number;
  landuseNormalized: number;
  seedsRaw: number;
  seedsNormalized: number;
  parentEdgeBarrierCount: number;
  internalBarrierCount: number;
}

export interface TurkeySmartFallbackManifest {
  schemaVersion: typeof TURKEY_SMART_FALLBACK_MANIFEST_SCHEMA_VERSION;
  algorithm: typeof TURKEY_SMART_FALLBACK_ALGORITHM_VERSION;
  parentAdm2: string;
  profile: ResolvedTurkeySmartFallbackProfile;
  inputs: Record<
    TurkeySmartFallbackBarrierLayer | "localitySeeds" | "parent",
    {
      status: "provided" | "missing";
      featureCount: number;
      hash?: string;
      source?: string;
    }
  >;
  inputHashes: Record<string, string>;
  territoryCount: number;
  quality: {
    meanScore: number;
    minScore: number;
    coverage: number;
    meanBarrierAlignment: number;
  };
  contentHash: string;
}

export interface TurkeySmartFallbackQualityReport {
  schemaVersion: typeof TURKEY_SMART_FALLBACK_QUALITY_SCHEMA_VERSION;
  ok: boolean;
  status: TurkeySmartFallbackStatus;
  parentId: string;
  algorithmVersion: typeof TURKEY_SMART_FALLBACK_ALGORITHM_VERSION;
  territoryCount: number;
  validGeometryCount: number;
  invalidGeometryCount: number;
  parentAreaKm2: number;
  smartUnionAreaKm2: number;
  intersectionAreaKm2: number;
  coveragePercent: number;
  uncoveredAreaKm2: number;
  uncoveredInsideParentKm2: number;
  overlapAreaKm2: number;
  overlapPercent: number;
  spillAreaKm2: number;
  outsideSpillKm2: number;
  spillPercent: number;
  averageAreaKm2: number;
  minAreaKm2: number;
  maxAreaKm2: number;
  meanCompactness: number;
  meanBarrierAlignment: number;
  meanZoneBarrierAlignment: number;
  meanRealBarrierRatio: number;
  meanSyntheticBoundaryRatio: number;
  totalInternalBoundaryLengthKm: number;
  barrierAlignedBoundaryLengthKm: number;
  parentBoundaryLengthKm: number;
  seedCoverage: number;
  meanQualityScore: number;
  minQualityScore: number;
  qualityDistribution: {
    min: number;
    p10: number;
    median: number;
    mean: number;
    p90: number;
    max: number;
  };
  inputDiagnostics: TurkeySmartFallbackInputDiagnostics;
  coverageComputation: {
    mode: "union" | "per-zone-fallback";
    unionFailed: boolean;
    topologyToleranceKm2: number;
    rawSmartUnionAreaKm2: number;
    rawIntersectionAreaKm2: number;
    rawUncoveredInsideParentKm2: number;
    rawOutsideSpillKm2: number;
    rawOverlapAreaKm2: number;
    failureReason?: string;
  };
  lowestQualityTerritoryIds: string[];
  mergeCount: number;
  splitCount: number;
  barrierSplitCount: number;
  syntheticSplitCount: number;
  rejectionCount: number;
  barrierCount: number;
  strongBarrierCount: number;
  mediumBarrierCount: number;
  weakBarrierCount: number;
  deterministicOutputHash: string;
  buildDurationMs: number;
  gates: {
    geometryValid: boolean;
    parentCoverage: boolean;
    outsideSpill: boolean;
    minimumArea: boolean;
    maximumArea: boolean;
    syntheticSplitLimit: boolean;
    meanQuality: boolean;
    inputSufficiency: boolean;
    coverage: boolean;
    invalidGeometry: boolean;
    overlap: boolean;
    spill: boolean;
    barrierSufficiency: boolean;
    qualityScore: boolean;
    barrierAlignment: boolean;
    syntheticLimit: boolean;
  };
  zones: Array<{
    id: string;
    areaKm2: number;
    quality: TurkeySmartFallbackZoneQuality;
    barrierIds: string[];
    seedIds: string[];
    strategy: TurkeySmartFallbackSourceStrategy;
  }>;
  issues: TurkeySmartFallbackIssue[];
}

export interface TurkeySmartFallbackBuildResult {
  zones: TerritoryZone[];
  selectedProfile: ResolvedTurkeySmartFallbackProfile;
  configuration: TurkeySmartFallbackConfiguration;
  barriers: TurkeySmartFallbackBarrier[];
  manifest: TurkeySmartFallbackManifest;
  quality: TurkeySmartFallbackQualityReport;
  adjacency?: TerritoryAdjacencyArtifact;
  adjacencyStatistics?: Awaited<ReturnType<typeof buildTerritoryAdjacency>>["statistics"];
  issues: TurkeySmartFallbackIssue[];
  reasonCodes: TurkeySmartFallbackIssueCode[];
  status: TurkeySmartFallbackStatus;
  deterministicHash: string;
}

interface PolygonClippingApi {
  difference: typeof polygonClipping.difference;
  intersection: typeof polygonClipping.intersection;
  union: typeof polygonClipping.union;
}

interface ProfileDefaults {
  targetAreaKm2: number;
  minAreaKm2: number;
  maxAreaKm2: number;
  minFragmentAreaKm2: number;
  maxTerritories: number;
  minMeanQualityScore: number;
  minMeanBarrierAlignment: number;
}

interface SmartPiece {
  geometry: ClippingMultiPolygon;
  key: string;
  areaKm2: number;
  barrierIds: string[];
  syntheticSplitCount: number;
}

interface SplitLine {
  id: string;
  p1: LngLat;
  p2: LngLat;
  lengthKm: number;
  barrier?: TurkeySmartFallbackBarrier;
}

interface SplitCandidate {
  piece: SmartPiece;
  left: SmartPiece;
  right: SmartPiece;
  line: SplitLine;
  score: number;
  synthetic: boolean;
  realBarrierSupportRatio: number;
}

interface BuildStats {
  splitCount: number;
  barrierSplitCount: number;
  syntheticSplitCount: number;
  mergeCount: number;
  rejectionCount: number;
}

interface ZoneCandidate {
  geometry: TerritoryGeometry;
  key: string;
  localKey: string;
  geometryHash: string;
  areaKm2: number;
  barrierIds: string[];
  seedIds: string[];
  seeds: TurkeySmartFallbackLocalitySeed[];
  quality: TurkeySmartFallbackZoneQuality;
  strategy: TurkeySmartFallbackSourceStrategy;
}

const CLIPPER =
  (polygonClipping as unknown as { default?: PolygonClippingApi }).default ??
  (polygonClipping as unknown as PolygonClippingApi);
const EARTH_RADIUS_METERS = 6_371_008.8;
const COORDINATE_EPSILON = 1e-9;
const RING_AREA_EPSILON = 1e-9;
const AREA_TOLERANCE_KM2 = 0.000001;
const DEFAULT_ALIGNMENT_TOLERANCE_METERS = 50;
const PARENT_EDGE_TOLERANCE_METERS = 5;
const BARRIER_PARALLEL_SIN_TOLERANCE = 0.12;
const PARENT_PARALLEL_SIN_TOLERANCE = 0.01;
const BARRIER_MERGE_ENDPOINT_TOLERANCE_METERS = 15;
const MAX_SPLIT_LINE_CANDIDATES_PER_PIECE = 256;
const DEFAULT_BUILD_DATE = "1970-01-01T00:00:00.000Z";

export const DEFAULT_TURKEY_SMART_FALLBACK_BARRIER_CONFIG: TurkeySmartFallbackBarrierConfig = {
  roadScores: {
    motorway: 1,
    trunk: 0.95,
    primary: 0.9,
    secondary: 0.75,
    tertiary: 0.45,
    unclassified: 0.25,
    residential: 0.15,
    living_street: 0.1,
    service: 0,
    driveway: 0,
    parking_aisle: 0,
    footway: 0,
    path: 0,
    cycleway: 0
  },
  railwayScores: {
    rail: 0.75,
    light_rail: 0.6,
    subway: 0.45,
    tram: 0.35,
    construction: 0,
    abandoned: 0
  },
  waterwayScores: {
    river: 0.95,
    canal: 0.85,
    stream: 0.55,
    drain: 0.15,
    ditch: 0.1
  },
  naturalScores: {
    coastline: 1,
    water: 0.9,
    bay: 0.8,
    strait: 0.95,
    wood: 0.65
  },
  landuseScores: {
    forest: 0.7,
    recreation_ground: 0.5,
    cemetery: 0.45,
    reservoir: 0.85,
    basin: 0.75,
    grass: 0.2,
    residential: 0
  },
  leisureScores: {
    park: 0.65,
    nature_reserve: 0.75,
    golf_course: 0.55,
    playground: 0.05
  },
  defaultRoadScore: 0.1,
  defaultRailScore: 0.45,
  defaultWaterScore: 0.55,
  minimumAcceptedStrength: 0.05
};

const PROFILE_DEFAULTS: Record<
  Exclude<ResolvedTurkeySmartFallbackProfile, "custom">,
  ProfileDefaults
> = {
  "dense-urban": {
    targetAreaKm2: 0.35,
    minAreaKm2: 0.04,
    maxAreaKm2: 0.9,
    minFragmentAreaKm2: 0.01,
    maxTerritories: 768,
    minMeanQualityScore: 0.55,
    minMeanBarrierAlignment: 0.22
  },
  urban: {
    targetAreaKm2: 0.8,
    minAreaKm2: 0.08,
    maxAreaKm2: 2.75,
    minFragmentAreaKm2: 0.02,
    maxTerritories: 512,
    minMeanQualityScore: 0.52,
    minMeanBarrierAlignment: 0.18
  },
  suburban: {
    targetAreaKm2: 2.5,
    minAreaKm2: 0.15,
    maxAreaKm2: 7.5,
    minFragmentAreaKm2: 0.04,
    maxTerritories: 384,
    minMeanQualityScore: 0.48,
    minMeanBarrierAlignment: 0.12
  },
  rural: {
    targetAreaKm2: 12,
    minAreaKm2: 0.35,
    maxAreaKm2: 45,
    minFragmentAreaKm2: 0.08,
    maxTerritories: 256,
    minMeanQualityScore: 0.42,
    minMeanBarrierAlignment: 0.05
  }
};

export function resolveTurkeySmartFallbackConfiguration(input: TurkeySmartFallbackInput): {
  ok: boolean;
  configuration: TurkeySmartFallbackConfiguration;
  issues: TurkeySmartFallbackIssue[];
} {
  const parentGeometry = toClippingMultiPolygon(input.parent.geometry);
  const parentAreaKm2 = clippingAreaKm2(parentGeometry);
  const barrierConfig = resolveBarrierConfig(input.options?.barrierConfig);
  const barriers = normalizeTurkeySmartFallbackBarriers(input, barrierConfig);
  const strongBarrierCount = barriers.filter(
    (barrier) => barrier.strengthClass === "strong"
  ).length;
  const mediumBarrierCount = barriers.filter(
    (barrier) => barrier.strengthClass === "medium"
  ).length;
  const roadLengthKm = sum(
    barriers.filter((barrier) => barrier.barrierClass === "road").map((barrier) => barrier.lengthKm)
  );
  const roadDensityKmPerKm2 = parentAreaKm2 > 0 ? roundMetric(roadLengthKm / parentAreaKm2) : 0;
  const localitySeedCount = input.localitySeeds?.length ?? 0;
  const profileDecision = selectProfile({
    requestedProfile: input.profile,
    parentAreaKm2,
    roadDensityKmPerKm2,
    strongBarrierCount,
    mediumBarrierCount,
    localitySeedCount
  });
  const defaults =
    profileDecision.selectedProfile === "custom"
      ? PROFILE_DEFAULTS.urban
      : PROFILE_DEFAULTS[profileDecision.selectedProfile];
  const targetAreaKm2 = input.options?.targetAreaKm2 ?? defaults.targetAreaKm2;
  const minAreaKm2 = input.options?.minAreaKm2 ?? defaults.minAreaKm2;
  const maxAreaKm2 = input.options?.maxAreaKm2 ?? defaults.maxAreaKm2;
  const minFragmentAreaKm2 = input.options?.minFragmentAreaKm2 ?? defaults.minFragmentAreaKm2;
  const maxTerritories = input.options?.maxTerritories ?? defaults.maxTerritories;
  const inferredTargetCount = clampInteger(
    Math.ceil(parentAreaKm2 / Math.max(targetAreaKm2, AREA_TOLERANCE_KM2)),
    1,
    maxTerritories
  );
  const targetTerritoryCount = input.options?.targetTerritoryCount ?? inferredTargetCount;
  const issues: TurkeySmartFallbackIssue[] = [];

  if (!isNonEmptyClippingGeometry(parentGeometry) || parentAreaKm2 <= 0) {
    issues.push({
      code: "SMART_FALLBACK_PARENT_GEOMETRY_INVALID",
      severity: "error",
      message: "Smart fallback requires a non-empty ADM2 parent Polygon or MultiPolygon.",
      parentId: input.parent.id
    });
  }

  if (isLikelySwappedTurkeyGeometry(input.parent.geometry)) {
    issues.push({
      code: "SMART_FALLBACK_COORDINATE_ORDER_INVALID",
      severity: "error",
      message:
        "Smart fallback parent geometry appears to use latitude,longitude order; Turkey inputs must be EPSG:4326 longitude,latitude.",
      parentId: input.parent.id,
      details: { bbox: computeGeometryBBox(input.parent.geometry) }
    });
  }

  if (!["dense-urban", "urban", "suburban", "rural", "auto", "custom"].includes(input.profile)) {
    issues.push({
      code: "SMART_FALLBACK_UNSUPPORTED_PROFILE",
      severity: "error",
      message: `Unsupported smart fallback profile '${String(input.profile)}'.`
    });
  }

  if (
    input.options?.algorithmVersion !== undefined &&
    input.options.algorithmVersion !== TURKEY_SMART_FALLBACK_ALGORITHM_VERSION
  ) {
    issues.push({
      code: "SMART_FALLBACK_UNSUPPORTED_ALGORITHM",
      severity: "error",
      message: `Unsupported smart fallback algorithm '${input.options.algorithmVersion}'.`
    });
  }

  const seed = input.options?.seed ?? "territory-kit-smart-fallback";
  if (seed.trim().length === 0) {
    issues.push({
      code: "SMART_FALLBACK_EMPTY_SEED",
      severity: "error",
      message: "Smart fallback seed must not be empty."
    });
  }

  for (const [field, value] of [
    ["targetAreaKm2", targetAreaKm2],
    ["minAreaKm2", minAreaKm2],
    ["maxAreaKm2", maxAreaKm2],
    ["minFragmentAreaKm2", minFragmentAreaKm2]
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      issues.push({
        code: "SMART_FALLBACK_INVALID_TARGET_AREA",
        severity: "error",
        message: `Smart fallback ${field} must be a positive finite number.`,
        details: { field, value }
      });
    }
  }

  if (!(minAreaKm2 <= targetAreaKm2 && targetAreaKm2 <= maxAreaKm2)) {
    issues.push({
      code: "SMART_FALLBACK_INVALID_AREA_ORDERING",
      severity: "error",
      message:
        "Smart fallback area settings must satisfy minAreaKm2 <= targetAreaKm2 <= maxAreaKm2.",
      details: { minAreaKm2, targetAreaKm2, maxAreaKm2 }
    });
  }

  if (!Number.isInteger(targetTerritoryCount) || targetTerritoryCount <= 0) {
    issues.push({
      code: "SMART_FALLBACK_INVALID_TARGET_COUNT",
      severity: "error",
      message: "Smart fallback targetTerritoryCount must be a positive integer.",
      details: { targetTerritoryCount }
    });
  }

  const configuration: TurkeySmartFallbackConfiguration = {
    schemaVersion: TURKEY_SMART_FALLBACK_CONFIGURATION_SCHEMA_VERSION,
    profile: input.profile,
    selectedProfile: profileDecision.selectedProfile,
    algorithmVersion: TURKEY_SMART_FALLBACK_ALGORITHM_VERSION,
    seed,
    targetAreaKm2: roundAreaKm2(targetAreaKm2),
    minAreaKm2: roundAreaKm2(minAreaKm2),
    maxAreaKm2: roundAreaKm2(maxAreaKm2),
    minFragmentAreaKm2: roundAreaKm2(minFragmentAreaKm2),
    targetTerritoryCount,
    maxTerritories,
    minBarrierStrength: roundMetric(input.options?.minBarrierStrength ?? 0.45),
    minAlignmentStrength: roundMetric(input.options?.minAlignmentStrength ?? 0.45),
    minBarrierLengthKm: roundMetric(input.options?.minBarrierLengthKm ?? 0.05),
    maxSyntheticSplits: input.options?.maxSyntheticSplits ?? 0,
    minCoveragePercent: roundMetric(input.options?.minCoveragePercent ?? 99.99),
    overlapToleranceKm2: roundAreaKm2(input.options?.overlapToleranceKm2 ?? AREA_TOLERANCE_KM2),
    spillToleranceKm2: roundAreaKm2(input.options?.spillToleranceKm2 ?? AREA_TOLERANCE_KM2),
    minMeanQualityScore: roundMetric(
      input.options?.minMeanQualityScore ?? defaults.minMeanQualityScore
    ),
    minMeanBarrierAlignment: roundMetric(
      input.options?.minMeanBarrierAlignment ?? defaults.minMeanBarrierAlignment
    ),
    requireBarrierForMultiTerritory: input.options?.requireBarrierForMultiTerritory ?? true,
    alignmentToleranceMeters: roundMetric(
      input.options?.alignmentToleranceMeters ??
        snapToleranceDegreesToMeters(input.options?.snapToleranceDegrees) ??
        DEFAULT_ALIGNMENT_TOLERANCE_METERS
    ),
    snapToleranceDegrees: input.options?.snapToleranceDegrees ?? 1e-8,
    targetGeometryAreaKm2: parentAreaKm2,
    profileDecision: {
      reasons: profileDecision.reasons,
      signals: {
        parentAreaKm2,
        strongBarrierCount,
        mediumBarrierCount,
        roadDensityKmPerKm2,
        localitySeedCount
      }
    }
  };

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    configuration,
    issues: sortIssues(issues)
  };
}

export function normalizeTurkeySmartFallbackBarriers(
  input: TurkeySmartFallbackInput,
  barrierConfig: TurkeySmartFallbackBarrierConfig = DEFAULT_TURKEY_SMART_FALLBACK_BARRIER_CONFIG
): TurkeySmartFallbackBarrier[] {
  const layers: Array<[TurkeySmartFallbackBarrierLayer, FeatureCollection | undefined]> = [
    ["roads", input.roads],
    ["railways", input.railways],
    ["water", input.water],
    ["landuse", input.landuse],
    ["parks", input.parks]
  ];
  const barriers: TurkeySmartFallbackBarrier[] = [];

  for (const [sourceLayer, collection] of layers) {
    for (const [featureIndex, feature] of (collection?.features ?? []).entries()) {
      const tags = normalizeFeatureProperties(feature.properties);
      const classified = classifyBarrierFeature(sourceLayer, tags, barrierConfig);
      const paths = geometryToLinePaths(feature.geometry);

      if (classified.strength < barrierConfig.minimumAcceptedStrength || paths.length === 0) {
        continue;
      }

      for (const [pathIndex, coordinates] of paths.entries()) {
        const normalized = normalizeLineCoordinates(coordinates);
        const lengthKm = lineLengthKm(normalized);

        if (normalized.length < 2 || lengthKm <= 0) {
          continue;
        }

        const sourceNativeId =
          feature.id !== undefined
            ? String(feature.id)
            : (tags.osm_id ?? tags["@id"] ?? tags.id ?? undefined);
        const id = [
          sourceLayer,
          classified.barrierClass,
          sourceNativeId ?? featureIndex,
          pathIndex,
          sha256Hex(serializeJsonStable({ tags, coordinates: canonicalLine(normalized) })).slice(
            0,
            16
          )
        ].join(":");

        barriers.push({
          id,
          sourceLayer,
          barrierClass: classified.barrierClass,
          strengthClass: strengthClass(classified.strength),
          strength: roundMetric(classified.strength),
          coordinates: normalized,
          lengthKm: roundMetric(lengthKm),
          ...(sourceNativeId ? { sourceNativeId } : {}),
          ...(tags.name ? { name: tags.name } : {}),
          tags
        });
      }
    }
  }

  return consolidateConnectedBarriers(barriers).sort(compareBarriers);
}

function consolidateConnectedBarriers(
  barriers: readonly TurkeySmartFallbackBarrier[]
): TurkeySmartFallbackBarrier[] {
  const groups = new Map<string, TurkeySmartFallbackBarrier[]>();

  for (const barrier of barriers) {
    const key = barrierConsolidationKey(barrier);

    if (!key) {
      groups.set(barrier.id, [barrier]);
      continue;
    }

    const group = groups.get(key) ?? [];
    group.push(barrier);
    groups.set(key, group);
  }

  return [...groups.values()].flatMap((group) =>
    group.length > 1 ? mergeBarrierGroup(group) : group
  );
}

function barrierConsolidationKey(barrier: TurkeySmartFallbackBarrier): string | undefined {
  if (
    barrier.strength < 0.4 ||
    !["road", "rail", "water"].includes(barrier.barrierClass) ||
    barrier.coordinates.length < 2
  ) {
    return undefined;
  }

  const corridorName = firstTagValue(barrier.tags.name) ?? firstTagValue(barrier.tags.ref);

  if (!corridorName) {
    return undefined;
  }

  return [
    barrier.sourceLayer,
    barrier.barrierClass,
    firstTagValue(barrier.tags.highway) ?? "",
    firstTagValue(barrier.tags.railway) ?? "",
    firstTagValue(barrier.tags.waterway) ?? firstTagValue(barrier.tags.water) ?? "",
    corridorName.toLocaleLowerCase("tr"),
    barrier.tags.bridge ?? "",
    barrier.tags.tunnel ?? "",
    barrier.tags.layer ?? "",
    barrier.strengthClass,
    barrier.strength
  ].join("|");
}

function mergeBarrierGroup(
  group: readonly TurkeySmartFallbackBarrier[]
): TurkeySmartFallbackBarrier[] {
  const remaining = [...group].sort(compareBarriers);
  const merged: TurkeySmartFallbackBarrier[] = [];

  while (remaining.length > 0) {
    const first = remaining.shift()!;
    let coordinates = [...first.coordinates];
    const lineage = [first];
    let changed = true;

    while (changed) {
      changed = false;

      for (let index = 0; index < remaining.length; index += 1) {
        const candidate = remaining[index]!;
        const joined = joinBarrierCoordinates(coordinates, candidate.coordinates);

        if (!joined) {
          continue;
        }

        coordinates = joined;
        lineage.push(candidate);
        remaining.splice(index, 1);
        changed = true;
        break;
      }
    }

    merged.push(createMergedBarrier(first, lineage, coordinates));
  }

  return merged;
}

function joinBarrierCoordinates(
  left: readonly LngLat[],
  right: readonly LngLat[]
): LngLat[] | undefined {
  const leftFirst = left[0];
  const leftLast = left[left.length - 1];
  const rightFirst = right[0];
  const rightLast = right[right.length - 1];

  if (!leftFirst || !leftLast || !rightFirst || !rightLast) {
    return undefined;
  }

  if (pointsNearMeters(leftLast, rightFirst, BARRIER_MERGE_ENDPOINT_TOLERANCE_METERS)) {
    return normalizeLineCoordinates([...left, ...right.slice(1)]);
  }

  if (pointsNearMeters(leftLast, rightLast, BARRIER_MERGE_ENDPOINT_TOLERANCE_METERS)) {
    return normalizeLineCoordinates([...left, ...[...right].reverse().slice(1)]);
  }

  if (pointsNearMeters(leftFirst, rightLast, BARRIER_MERGE_ENDPOINT_TOLERANCE_METERS)) {
    return normalizeLineCoordinates([...right, ...left.slice(1)]);
  }

  if (pointsNearMeters(leftFirst, rightFirst, BARRIER_MERGE_ENDPOINT_TOLERANCE_METERS)) {
    return normalizeLineCoordinates([...right].reverse().concat(left.slice(1)));
  }

  return undefined;
}

function createMergedBarrier(
  template: TurkeySmartFallbackBarrier,
  lineage: readonly TurkeySmartFallbackBarrier[],
  coordinates: readonly LngLat[]
): TurkeySmartFallbackBarrier {
  if (lineage.length === 1) {
    return template;
  }

  const lineageIds = lineage.map((barrier) => barrier.id).sort();
  const id = [
    template.sourceLayer,
    template.barrierClass,
    "merged",
    sha256Hex(serializeJsonStable(lineageIds)).slice(0, 16)
  ].join(":");
  const normalized = normalizeLineCoordinates(coordinates);

  return {
    ...template,
    id,
    coordinates: normalized,
    lengthKm: roundMetric(lineLengthKm(normalized)),
    sourceNativeId: `merged:${lineage.length}:${sha256Hex(serializeJsonStable(lineageIds)).slice(
      0,
      16
    )}`,
    tags: {
      ...template.tags,
      sourceBarrierIds: lineageIds.join(",")
    }
  };
}

function pointsNearMeters(left: LngLat, right: LngLat, toleranceMeters: number): boolean {
  return haversineKm(left, right) * 1_000 <= toleranceMeters;
}

function filterInternalBarriers(input: {
  barriers: readonly TurkeySmartFallbackBarrier[];
  parentGeometry: ClippingMultiPolygon;
  configuration: TurkeySmartFallbackConfiguration;
}): { barriers: TurkeySmartFallbackBarrier[]; parentEdgeBarrierCount: number } {
  const parent = clippingMultiPolygonToTerritoryGeometry(input.parentGeometry);

  if (!parent) {
    return { barriers: [...input.barriers].sort(compareBarriers), parentEdgeBarrierCount: 0 };
  }

  const parentSegments = geometrySegments(parent);
  const barriers: TurkeySmartFallbackBarrier[] = [];
  let parentEdgeBarrierCount = 0;

  for (const barrier of input.barriers) {
    if (isParentEdgeBarrier(barrier, parentSegments, input.configuration)) {
      parentEdgeBarrierCount += 1;
      continue;
    }

    barriers.push(barrier);
  }

  return { barriers: barriers.sort(compareBarriers), parentEdgeBarrierCount };
}

function isParentEdgeBarrier(
  barrier: TurkeySmartFallbackBarrier,
  parentSegments: readonly { a: LngLat; b: LngLat }[],
  configuration: TurkeySmartFallbackConfiguration
): boolean {
  const segments = lineSegments(barrier.coordinates);
  const lengthMeters = segments.reduce(
    (total, segment) => total + haversineKm(segment.a, segment.b) * 1_000,
    0
  );

  if (lengthMeters <= 0) {
    return false;
  }

  const alignedMeters = segments.reduce(
    (total, segment) =>
      total +
      segmentAlignedLengthMeters(segment, parentSegments, {
        toleranceMeters: Math.min(
          configuration.alignmentToleranceMeters,
          PARENT_EDGE_TOLERANCE_METERS
        ),
        parallelSinTolerance: PARENT_PARALLEL_SIN_TOLERANCE
      }),
    0
  );

  return alignedMeters / lengthMeters >= 0.8;
}

function createInputDiagnostics(input: {
  input: TurkeySmartFallbackInput;
  normalizedBarriers: readonly TurkeySmartFallbackBarrier[];
  generationBarriers: readonly TurkeySmartFallbackBarrier[];
  normalizedSeeds: readonly TurkeySmartFallbackLocalitySeed[];
  parentEdgeBarrierCount: number;
}): TurkeySmartFallbackInputDiagnostics {
  return {
    adm2Id: input.input.parent.id,
    roadsRaw: input.input.roads?.features.length ?? 0,
    roadsNormalized: countBarriers(input.generationBarriers, "roads"),
    majorRoadsRaw: countMajorRoadFeatures(input.input.roads),
    majorRoadsNormalized: input.generationBarriers.filter(
      (barrier) => barrier.sourceLayer === "roads" && barrier.strength >= 0.45
    ).length,
    railRaw: input.input.railways?.features.length ?? 0,
    railNormalized: countBarriers(input.generationBarriers, "railways"),
    waterRaw: input.input.water?.features.length ?? 0,
    waterNormalized: countBarriers(input.generationBarriers, "water"),
    parksRaw: input.input.parks?.features.length ?? 0,
    parksNormalized: countBarriers(input.generationBarriers, "parks"),
    landuseRaw: input.input.landuse?.features.length ?? 0,
    landuseNormalized: countBarriers(input.generationBarriers, "landuse"),
    seedsRaw: input.input.localitySeeds?.length ?? 0,
    seedsNormalized: input.normalizedSeeds.length,
    parentEdgeBarrierCount: input.parentEdgeBarrierCount,
    internalBarrierCount: input.generationBarriers.length
  };
}

function countBarriers(
  barriers: readonly TurkeySmartFallbackBarrier[],
  sourceLayer: TurkeySmartFallbackBarrierLayer
): number {
  return barriers.filter((barrier) => barrier.sourceLayer === sourceLayer).length;
}

function countMajorRoadFeatures(collection: FeatureCollection | undefined): number {
  return (collection?.features ?? []).filter((feature) => {
    const highway = feature.properties?.highway;
    return (
      typeof highway === "string" &&
      (DEFAULT_TURKEY_SMART_FALLBACK_BARRIER_CONFIG.roadScores[highway] ?? 0) >= 0.45
    );
  }).length;
}

export function buildTurkeySmartFallback(
  input: TurkeySmartFallbackInput
): TurkeySmartFallbackBuildResult {
  const startedAt = performance.now();
  const parentGeometry = toClippingMultiPolygon(input.parent.geometry);
  const barrierConfig = resolveBarrierConfig(input.options?.barrierConfig);
  const normalizedBarriers = normalizeTurkeySmartFallbackBarriers(input, barrierConfig);
  const resolution = resolveTurkeySmartFallbackConfiguration(input);
  const configuration = resolution.configuration;
  const barrierFilter = filterInternalBarriers({
    barriers: normalizedBarriers,
    parentGeometry,
    configuration
  });
  const barriers = barrierFilter.barriers;
  const issues: TurkeySmartFallbackIssue[] = [
    ...resolution.issues,
    ...(barrierFilter.parentEdgeBarrierCount > 0
      ? [
          {
            code: "SMART_FALLBACK_BARRIER_IGNORED" as const,
            severity: "info" as const,
            message:
              "Smart fallback ignored barriers that were aligned with the ADM2 outer boundary.",
            parentId: input.parent.id,
            details: {
              reason: "parent-edge",
              ignoredBarrierCount: barrierFilter.parentEdgeBarrierCount
            }
          }
        ]
      : []),
    {
      code: "OFFICIAL_ADM3_UNAVAILABLE",
      severity: "info",
      message: "Official ADM3 was unavailable for this smart fallback generation unit.",
      parentId: input.parent.id
    },
    {
      code: "OSM_ADMIN_BOUNDARY_UNAVAILABLE",
      severity: "info",
      message: "A usable OSM administrative ADM3 polygon was unavailable before smart fallback.",
      parentId: input.parent.id
    }
  ];
  const stats: BuildStats = {
    splitCount: 0,
    barrierSplitCount: 0,
    syntheticSplitCount: 0,
    mergeCount: 0,
    rejectionCount: 0
  };
  const seeds = normalizeLocalitySeeds(input.localitySeeds ?? [], parentGeometry);
  const inputDiagnostics = createInputDiagnostics({
    input,
    normalizedBarriers,
    generationBarriers: barriers,
    normalizedSeeds: seeds,
    parentEdgeBarrierCount: barrierFilter.parentEdgeBarrierCount
  });
  let pieces: SmartPiece[] = [];

  if (resolution.ok && isNonEmptyClippingGeometry(parentGeometry)) {
    pieces = [
      {
        geometry: parentGeometry,
        key: "root",
        areaKm2: clippingAreaKm2(parentGeometry),
        barrierIds: [],
        syntheticSplitCount: 0
      }
    ];
    pieces = splitWithBarriers(pieces, barriers, seeds, configuration, stats, issues);
    pieces = splitOversizedPieces(pieces, barriers, seeds, configuration, stats, issues);
    pieces = mergeSmallPieces(pieces, configuration, stats);
  }

  const candidates = createZoneCandidates({
    pieces,
    parent: input.parent,
    parentGeometry,
    barriers,
    seeds,
    configuration
  });
  const sourceMetadata = resolveSourceMetadata(input, barriers, configuration);
  const zones = candidates.map((candidate, index) =>
    createSmartFallbackZone({
      candidate,
      displayIndex: index,
      parent: input.parent,
      provinceCode: input.provinceCode,
      districtCode: input.districtCode,
      configuration,
      sourceMetadata,
      sourceSnapshotChecksum: sourceMetadata.sourceSnapshotChecksum
    })
  );
  const quality = inspectSmartFallbackQuality({
    parent: input.parent,
    parentGeometry,
    zones,
    candidates,
    barriers,
    seeds,
    configuration,
    inputDiagnostics,
    stats,
    issues,
    buildDurationMs: Math.round(performance.now() - startedAt)
  });
  const finalManifestWithoutHash = createManifest(input, configuration, barriers, candidates, {
    coverage: quality.coveragePercent,
    meanScore: quality.meanQualityScore,
    minScore: quality.minQualityScore,
    meanBarrierAlignment: quality.meanBarrierAlignment
  });
  const manifest = {
    ...finalManifestWithoutHash,
    contentHash: sha256Hex(serializeJsonStable(finalManifestWithoutHash))
  };
  const reasonCodes = sortedUnique(quality.issues.map((issue) => issue.code));

  return {
    zones,
    selectedProfile: configuration.selectedProfile,
    configuration,
    barriers,
    manifest,
    quality,
    issues: quality.issues,
    reasonCodes,
    status: quality.ok ? "success" : "rejected",
    deterministicHash: quality.deterministicOutputHash
  };
}

export async function buildTurkeySmartFallbackWithAdjacency(
  input: TurkeySmartFallbackInput
): Promise<TurkeySmartFallbackBuildResult> {
  const result = buildTurkeySmartFallback(input);

  if (!result.quality.ok || result.zones.length === 0) {
    return result;
  }

  const dataset = createTurkeySmartFallbackDataset({
    parent: input.parent,
    zones: result.zones,
    datasetId: "tr-adm3-smart-fallback-adjacency",
    sourceDate: result.configuration.algorithmVersion,
    includeParent: false
  });
  const adjacency = await buildTerritoryAdjacency(dataset, {
    buildDate: DEFAULT_BUILD_DATE,
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

  return {
    ...result,
    zones,
    adjacency: adjacency.artifact,
    adjacencyStatistics: adjacency.statistics,
    quality: {
      ...result.quality,
      deterministicOutputHash: deterministicHash
    },
    deterministicHash
  };
}

export function createTurkeySmartFallbackDataset(input: {
  parent: TerritoryZone;
  zones: readonly TerritoryZone[];
  datasetId?: string;
  sourceDate?: string;
  includeParent?: boolean;
}): TerritoryDataset {
  const datasetId = input.datasetId ?? "tr-adm3-smart-fallback";
  const rebasedZones = input.zones.map((zone) => ({ ...zone, datasetId }));
  const zones =
    input.includeParent === false
      ? rebasedZones
      : [
          {
            ...input.parent,
            datasetId,
            childIds: rebasedZones.map((zone) => zone.id).sort(),
            neighborIds: [...(input.parent.neighborIds ?? [])].sort()
          },
          ...rebasedZones
        ];

  return {
    manifest: {
      schemaVersion: TERRITORY_SCHEMA_VERSION,
      datasetId,
      datasetVersion: "0.0.0",
      sourceDate: input.sourceDate ?? TURKEY_SMART_FALLBACK_ALGORITHM_VERSION,
      buildDate: DEFAULT_BUILD_DATE,
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
      license: "mixed",
      name: "Turkey ADM3 smart-derived fallback zones",
      sourceProvider: "TerritoryKit Smart Fallback Boundary Engine",
      boundaryPolicy: "adm2-contained-smart-derived-non-authoritative",
      disputedAreaPolicy: "source",
      worldview: "TR",
      attribution:
        "OpenStreetMap contributors if OSM barriers are used; TerritoryKit derived fallback"
    },
    zones
  };
}

function splitWithBarriers(
  inputPieces: readonly SmartPiece[],
  barriers: readonly TurkeySmartFallbackBarrier[],
  seeds: readonly TurkeySmartFallbackLocalitySeed[],
  configuration: TurkeySmartFallbackConfiguration,
  stats: BuildStats,
  issues: TurkeySmartFallbackIssue[]
): SmartPiece[] {
  let pieces = [...inputPieces].sort(comparePieces);
  const splitLines = createCandidateSplitLines(
    barriers,
    configuration,
    configuration.minBarrierStrength
  );

  while (pieces.length < configuration.targetTerritoryCount) {
    const candidate = findBestBarrierSplit({
      pieces,
      splitLines,
      seeds,
      configuration
    });

    if (!candidate) {
      break;
    }

    pieces = replacePiece(pieces, candidate);
    stats.splitCount += 1;
    stats.barrierSplitCount += 1;
  }

  if (
    configuration.requireBarrierForMultiTerritory &&
    configuration.targetTerritoryCount > 1 &&
    stats.barrierSplitCount === 0
  ) {
    issues.push({
      code: "SMART_FALLBACK_INSUFFICIENT_BARRIERS",
      severity: "error",
      message:
        "Smart fallback could not find a strong enough road, rail, water, or physical barrier.",
      details: {
        targetTerritoryCount: configuration.targetTerritoryCount,
        minBarrierStrength: configuration.minBarrierStrength
      }
    });
  }

  return pieces.sort(comparePieces);
}

function splitOversizedPieces(
  inputPieces: readonly SmartPiece[],
  barriers: readonly TurkeySmartFallbackBarrier[],
  seeds: readonly TurkeySmartFallbackLocalitySeed[],
  configuration: TurkeySmartFallbackConfiguration,
  stats: BuildStats,
  issues: TurkeySmartFallbackIssue[]
): SmartPiece[] {
  let pieces = [...inputPieces].sort(comparePieces);
  const splitLines = createCandidateSplitLines(
    barriers,
    configuration,
    configuration.minBarrierStrength
  );

  while (
    pieces.length < configuration.maxTerritories &&
    pieces.some((piece) => piece.areaKm2 > configuration.maxAreaKm2 + AREA_TOLERANCE_KM2)
  ) {
    const candidate =
      findBestBarrierSplit({
        pieces: pieces.filter(
          (piece) => piece.areaKm2 > configuration.maxAreaKm2 + AREA_TOLERANCE_KM2
        ),
        splitLines,
        seeds,
        configuration
      }) ?? createSyntheticSplitCandidate(pieces, configuration);

    if (!candidate) {
      issues.push({
        code: "SMART_FALLBACK_SPLIT_FAILED",
        severity: "warning",
        message: "Smart fallback could not split an oversized candidate territory.",
        details: { maxAreaKm2: configuration.maxAreaKm2 }
      });
      break;
    }

    pieces = replacePiece(pieces, candidate);
    stats.splitCount += 1;

    if (candidate.synthetic) {
      stats.syntheticSplitCount += 1;
      issues.push({
        code: "SMART_FALLBACK_SYNTHETIC_SPLIT_USED",
        severity: configuration.maxSyntheticSplits === 0 ? "error" : "warning",
        message: "Smart fallback used a synthetic split after exhausting usable physical barriers.",
        details: { pieceKey: candidate.piece.key }
      });
    } else {
      stats.barrierSplitCount += 1;
    }
  }

  return pieces.sort(comparePieces);
}

function findBestBarrierSplit(input: {
  pieces: readonly SmartPiece[];
  splitLines: readonly SplitLine[];
  seeds: readonly TurkeySmartFallbackLocalitySeed[];
  configuration: TurkeySmartFallbackConfiguration;
}): SplitCandidate | undefined {
  let best: SplitCandidate | undefined;

  for (const piece of [...input.pieces].sort((left, right) => right.areaKm2 - left.areaKm2)) {
    if (piece.areaKm2 < input.configuration.minAreaKm2 * 1.5) {
      continue;
    }

    const pieceBbox = clippingBBox(piece.geometry);
    let evaluatedTouchingLines = 0;

    for (const line of input.splitLines) {
      const sourceBarrierId = line.barrier?.id ?? line.id;

      if (piece.barrierIds.includes(sourceBarrierId) || !lineTouchesBBox(line, pieceBbox)) {
        continue;
      }

      evaluatedTouchingLines += 1;

      if (evaluatedTouchingLines > MAX_SPLIT_LINE_CANDIDATES_PER_PIECE) {
        break;
      }

      const split = splitPieceByLine(piece, line, input.configuration);
      if (!split) {
        continue;
      }

      const splitBoundaryKm = sharedBoundaryKmBetween(split.left.geometry, split.right.geometry);
      const realBarrierSupportRatio =
        splitBoundaryKm > 0 ? roundMetric(clamp01(line.lengthKm / splitBoundaryKm)) : 0;
      const leftSeeds = countSeedsInGeometry(input.seeds, split.left.geometry);
      const rightSeeds = countSeedsInGeometry(input.seeds, split.right.geometry);
      const seedSeparation =
        leftSeeds > 0 && rightSeeds > 0 ? 1 : leftSeeds + rightSeeds > 0 ? 0.35 : 0;
      const balance = splitBalanceScore(split.left.areaKm2, split.right.areaKm2);
      const targetFit =
        (sizeFitness(split.left.areaKm2, input.configuration) +
          sizeFitness(split.right.areaKm2, input.configuration)) /
        2;
      const score =
        line.barrier!.strength * 0.36 +
        realBarrierSupportRatio * 0.34 +
        balance * 0.15 +
        seedSeparation * 0.1 +
        targetFit * 0.05;

      const candidate = {
        ...split,
        score: roundMetric(score),
        synthetic: false,
        realBarrierSupportRatio
      } satisfies SplitCandidate;

      if (!best || compareSplitCandidates(candidate, best) < 0) {
        best = candidate;
      }
    }
  }

  return best;
}

function createCandidateSplitLines(
  barriers: readonly TurkeySmartFallbackBarrier[],
  configuration: TurkeySmartFallbackConfiguration,
  minimumStrength: number
): SplitLine[] {
  return barriers
    .filter((barrier) => barrier.strength >= minimumStrength)
    .flatMap((barrier) => createSplitLines(barrier, configuration.minBarrierLengthKm))
    .sort(compareSplitLines);
}

function createSyntheticSplitCandidate(
  pieces: readonly SmartPiece[],
  configuration: TurkeySmartFallbackConfiguration
): SplitCandidate | undefined {
  const piece = [...pieces].sort(
    (left, right) => right.areaKm2 - left.areaKm2 || left.key.localeCompare(right.key)
  )[0];

  if (!piece) {
    return undefined;
  }

  const bbox = clippingBBox(piece.geometry);
  const rect = bboxToRect(bbox);
  const splitLongitude =
    (rect.east - rect.west) * kilometersPerLongitudeDegree((rect.south + rect.north) / 2) >=
    (rect.north - rect.south) * 111.32;
  const ratio = 0.46 + deterministicUnitInterval(`${configuration.seed}:${piece.key}`) * 0.08;
  const p1: LngLat = splitLongitude
    ? [rect.west + (rect.east - rect.west) * ratio, rect.south]
    : [rect.west, rect.south + (rect.north - rect.south) * ratio];
  const p2: LngLat = splitLongitude
    ? [rect.west + (rect.east - rect.west) * ratio, rect.north]
    : [rect.east, rect.south + (rect.north - rect.south) * ratio];
  const line: SplitLine = {
    id: `synthetic:${piece.key}`,
    p1,
    p2,
    lengthKm: haversineKm(p1, p2)
  };
  const split = splitPieceByLine(piece, line, configuration);

  return split ? { ...split, score: 0, synthetic: true, realBarrierSupportRatio: 0 } : undefined;
}

function splitPieceByLine(
  piece: SmartPiece,
  line: SplitLine,
  configuration: TurkeySmartFallbackConfiguration
): Omit<SplitCandidate, "score" | "synthetic" | "realBarrierSupportRatio"> | undefined {
  const bbox = clippingBBox(piece.geometry);
  const [positiveClip, negativeClip] = halfPlaneClips(bbox, line);
  const leftGeometry = intersectClippingGeometries(piece.geometry, positiveClip);
  const rightGeometry = intersectClippingGeometries(piece.geometry, negativeClip);
  const leftArea = clippingAreaKm2(leftGeometry);
  const rightArea = clippingAreaKm2(rightGeometry);
  const minimumArea = Math.max(AREA_TOLERANCE_KM2, configuration.minFragmentAreaKm2 * 0.25);

  if (leftArea <= minimumArea || rightArea <= minimumArea) {
    return undefined;
  }

  return {
    piece,
    line,
    left: {
      geometry: leftGeometry,
      key: `${piece.key}|${line.id}|a`,
      areaKm2: leftArea,
      barrierIds: line.barrier
        ? sortedUnique([...piece.barrierIds, line.barrier.id])
        : [...piece.barrierIds],
      syntheticSplitCount: piece.syntheticSplitCount + (line.barrier ? 0 : 1)
    },
    right: {
      geometry: rightGeometry,
      key: `${piece.key}|${line.id}|b`,
      areaKm2: rightArea,
      barrierIds: line.barrier
        ? sortedUnique([...piece.barrierIds, line.barrier.id])
        : [...piece.barrierIds],
      syntheticSplitCount: piece.syntheticSplitCount + (line.barrier ? 0 : 1)
    }
  };
}

function mergeSmallPieces(
  inputPieces: readonly SmartPiece[],
  configuration: TurkeySmartFallbackConfiguration,
  stats: BuildStats
): SmartPiece[] {
  let pieces = [...inputPieces].sort(comparePieces);

  while (pieces.length > 1) {
    const fragment = pieces
      .filter((piece) => piece.areaKm2 < configuration.minAreaKm2)
      .concat(
        pieces.length > configuration.targetTerritoryCount
          ? pieces.filter(
              (piece) =>
                piece.areaKm2 >= configuration.minAreaKm2 &&
                piece.areaKm2 < configuration.targetAreaKm2 * 0.5
            )
          : []
      )
      .sort((left, right) => left.areaKm2 - right.areaKm2 || left.key.localeCompare(right.key))[0];

    if (!fragment) {
      break;
    }

    const neighbour = pieces
      .filter((piece) => piece.key !== fragment.key)
      .map((piece) => {
        const sharedBoundaryKm = sharedBoundaryKmBetween(fragment.geometry, piece.geometry);
        const distanceKm = centroidDistanceKm(fragment.geometry, piece.geometry);
        const combinedAreaKm2 = fragment.areaKm2 + piece.areaKm2;
        const oversizePenalty =
          combinedAreaKm2 > configuration.maxAreaKm2
            ? (combinedAreaKm2 - configuration.maxAreaKm2) * 1_000
            : 0;
        return {
          piece,
          sharedBoundaryKm,
          distanceKm,
          combinedAreaKm2,
          score:
            sharedBoundaryKm * 100 -
            distanceKm -
            Math.abs(combinedAreaKm2 - configuration.targetAreaKm2) -
            oversizePenalty
        };
      })
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.sharedBoundaryKm - left.sharedBoundaryKm ||
          left.distanceKm - right.distanceKm ||
          left.piece.key.localeCompare(right.piece.key)
      )[0]?.piece;

    if (!neighbour) {
      break;
    }

    const mergedGeometry = unionClippingGeometries([fragment.geometry, neighbour.geometry]);
    const mergedAreaKm2 = clippingAreaKm2(mergedGeometry);
    pieces = pieces
      .filter((piece) => piece.key !== fragment.key && piece.key !== neighbour.key)
      .concat({
        geometry: mergedGeometry,
        key: `${fragment.key}+${neighbour.key}`,
        areaKm2: mergedAreaKm2,
        barrierIds: sortedUnique([...fragment.barrierIds, ...neighbour.barrierIds]),
        syntheticSplitCount: fragment.syntheticSplitCount + neighbour.syntheticSplitCount
      })
      .sort(comparePieces);
    stats.mergeCount += 1;
  }

  return pieces;
}

function createZoneCandidates(input: {
  pieces: readonly SmartPiece[];
  parent: TerritoryZone;
  parentGeometry: ClippingMultiPolygon;
  barriers: readonly TurkeySmartFallbackBarrier[];
  seeds: readonly TurkeySmartFallbackLocalitySeed[];
  configuration: TurkeySmartFallbackConfiguration;
}): ZoneCandidate[] {
  return input.pieces
    .flatMap((piece): ZoneCandidate[] => {
      const geometry = clippingMultiPolygonToTerritoryGeometry(piece.geometry);

      if (!geometry) {
        return [];
      }

      const assignedSeeds = input.seeds.filter((seed) =>
        pointInClippingGeometry(seed.coordinate, piece.geometry)
      );
      const geometryHash = sha256Hex(serializeJsonStable(canonicalGeometryPayload(geometry)));
      const localKey = sha256Hex(
        serializeJsonStable({
          parentId: input.parent.id,
          key: piece.key,
          geometryHash,
          barrierIds: piece.barrierIds,
          seedIds: assignedSeeds.map(seedId).sort()
        })
      ).slice(0, 20);
      const barrierAlignment = computeBarrierAlignment(
        geometry,
        input.parentGeometry,
        input.barriers,
        {
          minAlignmentStrength: input.configuration.minAlignmentStrength,
          alignmentToleranceMeters: input.configuration.alignmentToleranceMeters
        }
      );
      const compactnessValue = compactness(geometry);
      const sizeScore = sizeFitness(piece.areaKm2, input.configuration);
      const seedConfidence = computeSeedConfidence(assignedSeeds);
      const topology = geometry ? 1 : 0;
      const quality = createZoneQuality({
        compactness: compactnessValue,
        barrierAlignment,
        barrierEvidence:
          piece.barrierIds.length > 0 || input.configuration.targetTerritoryCount <= 1 ? 1 : 0,
        sizeScore,
        ...(seedConfidence !== undefined ? { seedConfidence } : {}),
        topology
      });

      return [
        {
          geometry,
          key: piece.key,
          localKey,
          geometryHash,
          areaKm2: piece.areaKm2,
          barrierIds: piece.barrierIds,
          seedIds: assignedSeeds.map(seedId).sort(),
          seeds: assignedSeeds.sort(compareSeeds),
          quality,
          strategy: piece.syntheticSplitCount > 0 ? "synthetic-last-resort" : "barrier-guided"
        }
      ];
    })
    .sort(compareZoneCandidates);
}

function createSmartFallbackZone(input: {
  candidate: ZoneCandidate;
  displayIndex: number;
  parent: TerritoryZone;
  provinceCode: string;
  districtCode: string;
  configuration: TurkeySmartFallbackConfiguration;
  sourceMetadata: Required<TurkeySmartFallbackSourceMetadata>;
  sourceSnapshotChecksum: string;
}): TerritoryZone {
  const generationSeed = [
    input.configuration.seed,
    input.parent.id,
    input.candidate.localKey,
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
  const assignedSeed = input.candidate.seeds.length === 1 ? input.candidate.seeds[0] : undefined;
  const defaultName = `Territory ${String(input.displayIndex + 1).padStart(3, "0")}`;
  const displayName = assignedSeed?.name ?? defaultName;
  const bbox = computeGeometryBBox(input.candidate.geometry);

  return {
    id,
    datasetId: "tr-adm3-smart-fallback",
    countryCode: "TR",
    level: 3,
    sourceAdminLevel: "ADM3",
    semanticType: "generated-zone",
    name: displayName,
    localName: displayName,
    parentId: input.parent.id,
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
        localTypeName: "Smart derived territory",
        hierarchyDepth: 3,
        parentId: input.parent.id,
        countryCode: "TR",
        provinceCode: input.provinceCode,
        districtCode: input.districtCode,
        sourceClass: "generated",
        boundaryType: "derived",
        boundaryKind: "estimated",
        boundarySourceClass: "smart-derived",
        confidence: input.candidate.quality.score >= 0.65 ? "medium" : "low",
        administrative: false,
        authoritative: false,
        providerClass: "generated",
        providerId: input.sourceMetadata.providerId,
        providerName: input.sourceMetadata.providerName,
        sourceProvider: input.sourceMetadata.providerId,
        sourceId: input.sourceMetadata.sourceId,
        sourceDatasetId: input.sourceMetadata.sourceDatasetId,
        sourceNativeId: id,
        sourceDate: input.sourceMetadata.sourceDate,
        sourceVersion: input.sourceMetadata.sourceVersion,
        sourceUrl: input.sourceMetadata.sourceUrl,
        sourceSnapshotId: input.sourceMetadata.sourceSnapshotId,
        sourceSnapshotChecksum: input.sourceSnapshotChecksum,
        licenseState: "approved",
        license: input.sourceMetadata.license,
        attribution: input.sourceMetadata.attribution,
        official: false,
        generated: true,
        algorithm: input.configuration.algorithmVersion,
        algorithmVersion: input.configuration.algorithmVersion,
        generationSeed,
        stableId: id,
        coverageStatus:
          input.candidate.quality.score >= input.configuration.minMeanQualityScore
            ? "generated"
            : "generated-with-warnings",
        semanticReviewStatus: "not-applicable",
        geometryHash: input.candidate.geometryHash,
        originalGeometryHash: input.candidate.geometryHash,
        effectiveGeometryHash: input.candidate.geometryHash,
        areaM2: Math.round(input.candidate.areaKm2 * 1_000_000),
        representativePoint: computeSafeGeometryCenter(input.candidate.geometry),
        displayName,
        nameSource: assignedSeed ? "locality-seed" : "generated-index",
        ...(assignedSeed ? { seedName: assignedSeed.name } : {}),
        geometrySource: "derived",
        redistributionPolicy: "allowed",
        commercialUsePolicy: "allowed",
        modificationPolicy: "allowed",
        generatorConfigurationHash: sha256Hex(serializeJsonStable(input.configuration)),
        parentGeometryHash: sha256Hex(
          serializeJsonStable(canonicalGeometryPayload(input.parent.geometry))
        ),
        source: {
          provider: input.sourceMetadata.providerId,
          sourceClass: "generated",
          boundarySourceClass: "smart-derived",
          providerId: input.sourceMetadata.providerId,
          providerName: input.sourceMetadata.providerName,
          sourceDatasetId: input.sourceMetadata.sourceDatasetId,
          sourceId: input.sourceMetadata.sourceId,
          sourceNativeId: id,
          sourceDate: input.sourceMetadata.sourceDate,
          sourceVersion: input.sourceMetadata.sourceVersion,
          sourceUrl: input.sourceMetadata.sourceUrl,
          sourceSnapshotId: input.sourceMetadata.sourceSnapshotId,
          sourceSnapshotChecksum: input.sourceSnapshotChecksum,
          licenseState: "approved",
          license: input.sourceMetadata.license,
          attribution: input.sourceMetadata.attribution
        },
        generatedZone: {
          algorithm: "barrier-guided-smart-fallback",
          algorithmVersion: input.configuration.algorithmVersion,
          seed: input.configuration.seed,
          generationSeed,
          localKey: input.candidate.localKey,
          targetAreaKm2: input.configuration.targetAreaKm2,
          minAreaKm2: input.configuration.minAreaKm2,
          maxAreaKm2: input.configuration.maxAreaKm2,
          maxZonesPerDistrict: input.configuration.maxTerritories,
          minFragmentAreaKm2: input.configuration.minFragmentAreaKm2
        },
        smartFallback: {
          algorithm: input.configuration.algorithmVersion,
          sourceStrategy: input.candidate.strategy,
          administrative: false,
          authoritative: false,
          quality: input.candidate.quality,
          barrierIds: input.candidate.barrierIds,
          seedIds: input.candidate.seedIds,
          provenance: {
            parentSource: parentSourceId(input.parent),
            barrierSource: input.sourceMetadata.providerId,
            roadSource: input.sourceMetadata.providerId,
            waterSource: input.sourceMetadata.providerId,
            railSource: input.sourceMetadata.providerId,
            seedSource: input.sourceMetadata.providerId
          }
        }
      }
    }
  };
}

function inspectSmartFallbackQuality(input: {
  parent: TerritoryZone;
  parentGeometry: ClippingMultiPolygon;
  zones: readonly TerritoryZone[];
  candidates: readonly ZoneCandidate[];
  barriers: readonly TurkeySmartFallbackBarrier[];
  seeds: readonly TurkeySmartFallbackLocalitySeed[];
  configuration: TurkeySmartFallbackConfiguration;
  inputDiagnostics: TurkeySmartFallbackInputDiagnostics;
  stats: BuildStats;
  issues: readonly TurkeySmartFallbackIssue[];
  buildDurationMs: number;
}): TurkeySmartFallbackQualityReport {
  const dataset = createTurkeySmartFallbackDataset({
    parent: input.parent,
    zones: input.zones,
    includeParent: false
  });
  const geometryValidation = validateGeometryDataset(dataset, {
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
  });
  const invalidGeometryCount = geometryValidation.issues.filter(
    (issue) => issue.severity === "error"
  ).length;
  const zoneGeometries = input.zones.map((zone) => toClippingMultiPolygon(zone.geometry));
  const rawOverlapAreaKm2 = collectOverlapArea(input.zones);
  const coverageAreas = computeCoverageAreas({
    parentGeometry: input.parentGeometry,
    zoneGeometries,
    overlapAreaKm2: rawOverlapAreaKm2
  });
  const parentAreaKm2 = coverageAreas.parentAreaKm2;
  const topologyToleranceKm2 = topologyNoiseToleranceKm2(parentAreaKm2);
  const uncoveredAreaKm2 = normalizeTopologyNoiseAreaKm2(
    coverageAreas.uncoveredInsideParentKm2,
    topologyToleranceKm2
  );
  const spillAreaKm2 = normalizeTopologyNoiseAreaKm2(
    coverageAreas.outsideSpillKm2,
    topologyToleranceKm2
  );
  const overlapAreaKm2 = normalizeTopologyNoiseAreaKm2(rawOverlapAreaKm2, topologyToleranceKm2);
  const coveredParentAreaKm2 =
    uncoveredAreaKm2 === 0 ? parentAreaKm2 : coverageAreas.intersectionAreaKm2;
  const smartUnionAreaKm2 = roundAreaKm2(coveredParentAreaKm2 + spillAreaKm2);
  const areas = input.candidates.map((candidate) => candidate.areaKm2);
  const compactnessValues = input.candidates.map((candidate) => candidate.quality.compactness);
  const barrierAlignmentValues = input.candidates.map(
    (candidate) => candidate.quality.barrierAlignment
  );
  const boundaryAlignment = computeBoundaryAlignmentSummary({
    zones: input.zones,
    parentGeometry: input.parentGeometry,
    barriers: input.barriers,
    configuration: input.configuration
  });
  const qualityScores = input.candidates.map((candidate) => candidate.quality.score);
  const assignedSeedIds = new Set(input.candidates.flatMap((candidate) => candidate.seedIds));
  const seedCoverage =
    input.seeds.length === 0 ? 1 : roundMetric(assignedSeedIds.size / input.seeds.length);
  const strongBarrierCount = input.barriers.filter(
    (barrier) => barrier.strengthClass === "strong"
  ).length;
  const mediumBarrierCount = input.barriers.filter(
    (barrier) => barrier.strengthClass === "medium"
  ).length;
  const weakBarrierCount = input.barriers.filter(
    (barrier) => barrier.strengthClass === "weak"
  ).length;
  const meanQualityScore = meanMetric(qualityScores);
  const meanZoneBarrierAlignment = meanMetric(barrierAlignmentValues);
  const meanBarrierAlignment = boundaryAlignment.realBarrierRatio;
  const qualityDistribution = metricDistribution(qualityScores);
  const coveragePercent = percentage(coveredParentAreaKm2, parentAreaKm2);
  const barrierSufficient =
    input.configuration.targetTerritoryCount <= 1 ||
    !input.configuration.requireBarrierForMultiTerritory ||
    input.stats.barrierSplitCount > 0;
  const gates = {
    geometryValid: invalidGeometryCount === 0,
    parentCoverage: coveragePercent >= input.configuration.minCoveragePercent,
    outsideSpill: spillAreaKm2 <= input.configuration.spillToleranceKm2,
    minimumArea: input.candidates.every(
      (candidate) => candidate.areaKm2 + AREA_TOLERANCE_KM2 >= input.configuration.minAreaKm2
    ),
    maximumArea: input.candidates.every(
      (candidate) => candidate.areaKm2 <= input.configuration.maxAreaKm2 + AREA_TOLERANCE_KM2
    ),
    syntheticSplitLimit: input.stats.syntheticSplitCount <= input.configuration.maxSyntheticSplits,
    meanQuality: meanQualityScore >= input.configuration.minMeanQualityScore,
    inputSufficiency: barrierSufficient,
    coverage: coveragePercent >= input.configuration.minCoveragePercent,
    invalidGeometry: invalidGeometryCount === 0,
    overlap: overlapAreaKm2 <= input.configuration.overlapToleranceKm2,
    spill: spillAreaKm2 <= input.configuration.spillToleranceKm2,
    barrierSufficiency: barrierSufficient,
    qualityScore: meanQualityScore >= input.configuration.minMeanQualityScore,
    barrierAlignment:
      input.configuration.targetTerritoryCount <= 1 ||
      meanBarrierAlignment >= input.configuration.minMeanBarrierAlignment,
    syntheticLimit: input.stats.syntheticSplitCount <= input.configuration.maxSyntheticSplits
  };
  const qualityIssues = [...input.issues];

  if (!gates.parentCoverage) {
    qualityIssues.push({
      code: "SMART_FALLBACK_COVERAGE_TOO_LOW",
      severity: "error",
      message: "Smart fallback coverage is below the configured quality gate.",
      parentId: input.parent.id,
      details: {
        coveragePercent,
        minCoveragePercent: input.configuration.minCoveragePercent,
        uncoveredInsideParentKm2: uncoveredAreaKm2
      }
    });
  }

  if (!gates.geometryValid || !gates.overlap) {
    qualityIssues.push({
      code: "SMART_FALLBACK_GEOMETRY_INVALID",
      severity: "error",
      message: "Smart fallback topology failed validation.",
      parentId: input.parent.id,
      details: { invalidGeometryCount, overlapAreaKm2 }
    });
  }

  if (!gates.outsideSpill) {
    qualityIssues.push({
      code: "SMART_FALLBACK_SPILL_TOO_HIGH",
      severity: "error",
      message: "Smart fallback produced territory area outside the ADM2 parent.",
      parentId: input.parent.id,
      details: {
        outsideSpillKm2: spillAreaKm2,
        spillToleranceKm2: input.configuration.spillToleranceKm2
      }
    });
  }

  if (!gates.minimumArea) {
    qualityIssues.push({
      code: "SMART_FALLBACK_QUALITY_REJECTED",
      severity: "error",
      message: "Smart fallback produced territories below the configured minimum area gate.",
      parentId: input.parent.id,
      details: {
        failedGate: "minimumArea",
        minAreaKm2: input.configuration.minAreaKm2,
        smallestAreaKm2: min(areas)
      }
    });
  }

  if (!gates.maximumArea) {
    qualityIssues.push({
      code: "SMART_FALLBACK_QUALITY_REJECTED",
      severity: "error",
      message: "Smart fallback produced territories above the configured maximum area gate.",
      parentId: input.parent.id,
      details: {
        failedGate: "maximumArea",
        maxAreaKm2: input.configuration.maxAreaKm2,
        largestAreaKm2: max(areas),
        targetTerritoryCount: input.configuration.targetTerritoryCount,
        maxTerritories: input.configuration.maxTerritories
      }
    });
  }

  if (!gates.inputSufficiency) {
    qualityIssues.push({
      code: "SMART_FALLBACK_INSUFFICIENT_BARRIERS",
      severity: "error",
      message:
        "Smart fallback did not use enough real-world barriers for this multi-territory result.",
      parentId: input.parent.id
    });
  }

  if (!gates.meanQuality) {
    qualityIssues.push({
      code: "SMART_FALLBACK_QUALITY_REJECTED",
      severity: "error",
      message: "Smart fallback derived geography quality score is below the configured gate.",
      parentId: input.parent.id,
      details: {
        meanQualityScore,
        minMeanQualityScore: input.configuration.minMeanQualityScore
      }
    });
  }

  if (!gates.barrierAlignment) {
    qualityIssues.push({
      code: "SMART_FALLBACK_ALIGNMENT_TOO_LOW",
      severity: "error",
      message: "Smart fallback internal boundaries are not aligned with enough real barriers.",
      parentId: input.parent.id,
      details: {
        meanBarrierAlignment,
        minMeanBarrierAlignment: input.configuration.minMeanBarrierAlignment,
        alignmentToleranceMeters: input.configuration.alignmentToleranceMeters
      }
    });
  }

  if (!gates.syntheticSplitLimit) {
    qualityIssues.push({
      code: "SMART_FALLBACK_SYNTHETIC_SPLIT_USED",
      severity: "error",
      message: "Smart fallback used more synthetic last-resort splits than allowed.",
      parentId: input.parent.id,
      details: {
        syntheticSplitCount: input.stats.syntheticSplitCount,
        maxSyntheticSplits: input.configuration.maxSyntheticSplits
      }
    });
  }

  if (Object.values(gates).every(Boolean)) {
    qualityIssues.push({
      code: "SMART_FALLBACK_GENERATED",
      severity: "info",
      message: "Smart fallback generated derived, non-authoritative territories.",
      parentId: input.parent.id
    });
  }

  const lowestQualityTerritoryIds = [...input.candidates]
    .sort(
      (left, right) =>
        left.quality.score - right.quality.score || left.localKey.localeCompare(right.localKey)
    )
    .slice(0, 5)
    .map((candidate) => input.zones[input.candidates.indexOf(candidate)]?.id ?? candidate.localKey);
  const deterministicOutputHash = sha256Hex(
    serializeJsonStable({
      parentId: input.parent.id,
      configuration: input.configuration,
      gates,
      zones: input.zones.map((zone) => ({
        id: zone.id,
        geometry: canonicalGeometryPayload(zone.geometry),
        quality: readSmartFallbackPayload(zone)
      }))
    })
  );
  const ok =
    Object.values(gates).every(Boolean) &&
    qualityIssues.every((issue) => issue.severity !== "error");

  return {
    schemaVersion: TURKEY_SMART_FALLBACK_QUALITY_SCHEMA_VERSION,
    ok,
    status: ok ? "success" : "rejected",
    parentId: input.parent.id,
    algorithmVersion: input.configuration.algorithmVersion,
    territoryCount: input.zones.length,
    validGeometryCount: Math.max(0, input.zones.length - invalidGeometryCount),
    invalidGeometryCount,
    parentAreaKm2,
    smartUnionAreaKm2,
    intersectionAreaKm2: coveredParentAreaKm2,
    coveragePercent,
    uncoveredAreaKm2,
    uncoveredInsideParentKm2: uncoveredAreaKm2,
    overlapAreaKm2,
    overlapPercent: percentage(overlapAreaKm2, parentAreaKm2),
    spillAreaKm2,
    outsideSpillKm2: spillAreaKm2,
    spillPercent: percentage(spillAreaKm2, parentAreaKm2),
    averageAreaKm2: mean(areas),
    minAreaKm2: min(areas),
    maxAreaKm2: max(areas),
    meanCompactness: meanMetric(compactnessValues),
    meanBarrierAlignment,
    meanZoneBarrierAlignment,
    meanRealBarrierRatio: boundaryAlignment.realBarrierRatio,
    meanSyntheticBoundaryRatio: boundaryAlignment.syntheticBoundaryRatio,
    totalInternalBoundaryLengthKm: boundaryAlignment.totalInternalBoundaryLengthKm,
    barrierAlignedBoundaryLengthKm: boundaryAlignment.barrierAlignedBoundaryLengthKm,
    parentBoundaryLengthKm: boundaryAlignment.parentBoundaryLengthKm,
    seedCoverage,
    meanQualityScore,
    minQualityScore: minMetric(qualityScores),
    qualityDistribution,
    inputDiagnostics: input.inputDiagnostics,
    coverageComputation: {
      mode: coverageAreas.mode,
      unionFailed: coverageAreas.mode === "per-zone-fallback",
      topologyToleranceKm2,
      rawSmartUnionAreaKm2: coverageAreas.smartUnionAreaKm2,
      rawIntersectionAreaKm2: coverageAreas.intersectionAreaKm2,
      rawUncoveredInsideParentKm2: coverageAreas.uncoveredInsideParentKm2,
      rawOutsideSpillKm2: coverageAreas.outsideSpillKm2,
      rawOverlapAreaKm2,
      ...(coverageAreas.failureReason ? { failureReason: coverageAreas.failureReason } : {})
    },
    lowestQualityTerritoryIds,
    mergeCount: input.stats.mergeCount,
    splitCount: input.stats.splitCount,
    barrierSplitCount: input.stats.barrierSplitCount,
    syntheticSplitCount: input.stats.syntheticSplitCount,
    rejectionCount: input.stats.rejectionCount,
    barrierCount: input.barriers.length,
    strongBarrierCount,
    mediumBarrierCount,
    weakBarrierCount,
    deterministicOutputHash,
    buildDurationMs: input.buildDurationMs,
    gates,
    zones: input.candidates.map((candidate, index) => ({
      id: input.zones[index]?.id ?? candidate.localKey,
      areaKm2: candidate.areaKm2,
      quality: candidate.quality,
      barrierIds: candidate.barrierIds,
      seedIds: candidate.seedIds,
      strategy: candidate.strategy
    })),
    issues: sortIssues(qualityIssues)
  };
}

function readSmartFallbackPayload(zone: TerritoryZone): unknown {
  const territory = isRecord(zone.properties.territory) ? zone.properties.territory : {};
  return territory.smartFallback;
}

function createManifest(
  input: TurkeySmartFallbackInput,
  configuration: TurkeySmartFallbackConfiguration,
  barriers: readonly TurkeySmartFallbackBarrier[],
  candidates: readonly ZoneCandidate[],
  quality: {
    meanScore: number;
    minScore: number;
    coverage: number;
    meanBarrierAlignment: number;
  }
): Omit<TurkeySmartFallbackManifest, "contentHash"> {
  const layerInputs = {
    parent: {
      status: "provided" as const,
      featureCount: 1,
      hash: sha256Hex(serializeJsonStable(canonicalGeometryPayload(input.parent.geometry))),
      source: parentSourceId(input.parent)
    },
    roads: layerSummary(input.roads),
    railways: layerSummary(input.railways),
    water: layerSummary(input.water),
    landuse: layerSummary(input.landuse),
    parks: layerSummary(input.parks),
    localitySeeds: {
      status:
        input.localitySeeds && input.localitySeeds.length > 0
          ? ("provided" as const)
          : ("missing" as const),
      featureCount: input.localitySeeds?.length ?? 0,
      ...(input.localitySeeds && input.localitySeeds.length > 0
        ? { hash: sha256Hex(serializeJsonStable(input.localitySeeds)) }
        : {}),
      source: "locality-seeds"
    }
  };

  const inputHashes = Object.fromEntries(
    Object.entries(layerInputs)
      .flatMap(([key, value]): Array<[string, string]> => (value.hash ? [[key, value.hash]] : []))
      .sort(([left], [right]) => left.localeCompare(right))
  );

  return {
    schemaVersion: TURKEY_SMART_FALLBACK_MANIFEST_SCHEMA_VERSION,
    algorithm: configuration.algorithmVersion,
    parentAdm2: input.parent.id,
    profile: configuration.selectedProfile,
    inputs: layerInputs,
    inputHashes,
    territoryCount: candidates.length,
    quality: {
      meanScore: roundMetric(quality.meanScore),
      minScore: roundMetric(quality.minScore),
      coverage: roundMetric(quality.coverage),
      meanBarrierAlignment: roundMetric(quality.meanBarrierAlignment)
    }
  };
}

function classifyBarrierFeature(
  sourceLayer: TurkeySmartFallbackBarrierLayer,
  tags: Record<string, string>,
  config: TurkeySmartFallbackBarrierConfig
): { barrierClass: TurkeySmartFallbackBarrierClass; strength: number } {
  const explicitStrength = readFiniteNumber(tags.strength ?? tags.barrierStrength);

  if (sourceLayer === "roads") {
    const highway = firstTagValue(tags.highway);
    const strength =
      explicitStrength ??
      (highway ? config.roadScores[highway] : undefined) ??
      config.defaultRoadScore;
    return { barrierClass: "road", strength: clamp01(strength) };
  }

  if (sourceLayer === "railways") {
    const railway = firstTagValue(tags.railway);
    const strength =
      explicitStrength ??
      (railway ? config.railwayScores[railway] : undefined) ??
      config.defaultRailScore;
    return { barrierClass: "rail", strength: clamp01(strength) };
  }

  if (sourceLayer === "water") {
    const natural = firstTagValue(tags.natural);
    const waterway = firstTagValue(tags.waterway);
    const water = firstTagValue(tags.water);

    if (natural === "coastline") {
      return { barrierClass: "coastline", strength: explicitStrength ?? 1 };
    }

    const strength =
      explicitStrength ??
      (waterway ? config.waterwayScores[waterway] : undefined) ??
      (natural ? config.naturalScores[natural] : undefined) ??
      (water ? config.naturalScores.water : undefined) ??
      config.defaultWaterScore;
    return { barrierClass: "water", strength: clamp01(strength) };
  }

  if (sourceLayer === "parks") {
    const leisure = firstTagValue(tags.leisure);
    const strength =
      explicitStrength ?? (leisure ? config.leisureScores[leisure] : undefined) ?? 0.45;
    return { barrierClass: "park", strength: clamp01(strength) };
  }

  const landuse = firstTagValue(tags.landuse);
  const natural = firstTagValue(tags.natural);
  const strength =
    explicitStrength ??
    (landuse ? config.landuseScores[landuse] : undefined) ??
    (natural ? config.naturalScores[natural] : undefined) ??
    0.2;
  return {
    barrierClass: landuse === "forest" || natural === "wood" ? "forest" : "park",
    strength: clamp01(strength)
  };
}

function geometryToLinePaths(geometry: Geometry | null): LngLat[][] {
  if (!geometry) {
    return [];
  }

  if (geometry.type === "LineString") {
    return [geometry.coordinates as LngLat[]];
  }

  if (geometry.type === "MultiLineString") {
    return geometry.coordinates as LngLat[][];
  }

  if (geometry.type === "Polygon") {
    return geometry.coordinates as LngLat[][];
  }

  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as LngLat[][][]).flatMap((polygon) => polygon);
  }

  return [];
}

function createSplitLines(
  barrier: TurkeySmartFallbackBarrier,
  minBarrierLengthKm: number
): SplitLine[] {
  const lines: SplitLine[] = [];

  for (let index = 0; index < barrier.coordinates.length - 1; index += 1) {
    const p1 = barrier.coordinates[index];
    const p2 = barrier.coordinates[index + 1];

    if (!p1 || !p2 || pointsEqual(p1, p2)) {
      continue;
    }

    const lengthKm = haversineKm(p1, p2);

    if (lengthKm >= minBarrierLengthKm) {
      lines.push({
        id: `${barrier.id}:segment:${index}`,
        p1,
        p2,
        lengthKm,
        barrier
      });
    }
  }

  const first = barrier.coordinates[0];
  const last = barrier.coordinates[barrier.coordinates.length - 1];

  if (first && last && !pointsEqual(first, last)) {
    const lengthKm = haversineKm(first, last);
    if (lengthKm >= minBarrierLengthKm) {
      lines.push({
        id: `${barrier.id}:chord`,
        p1: first,
        p2: last,
        lengthKm,
        barrier
      });
    }
  }

  return lines.sort(compareSplitLines);
}

function halfPlaneClips(
  bbox: TerritoryBBox,
  line: SplitLine
): [ClippingMultiPolygon, ClippingMultiPolygon] {
  const rect = bboxToRect(bbox);
  const margin = Math.max(rect.east - rect.west, rect.north - rect.south, 0.001) * 8 + 0.01;
  const box: LngLat[] = [
    [rect.west - margin, rect.south - margin],
    [rect.east + margin, rect.south - margin],
    [rect.east + margin, rect.north + margin],
    [rect.west - margin, rect.north + margin]
  ];
  const positive = clipRingByHalfPlane(box, line, 1);
  const negative = clipRingByHalfPlane(box, line, -1);

  return [ringToClippingGeometry(positive), ringToClippingGeometry(negative)];
}

function clipRingByHalfPlane(ring: readonly LngLat[], line: SplitLine, side: 1 | -1): LngLat[] {
  const output: LngLat[] = [];

  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]!;
    const previous = ring[(index + ring.length - 1) % ring.length]!;
    const currentInside = side * lineSignedDistance(line, current) >= -COORDINATE_EPSILON;
    const previousInside = side * lineSignedDistance(line, previous) >= -COORDINATE_EPSILON;

    if (currentInside !== previousInside) {
      const intersection = segmentLineIntersection(previous, current, line);
      if (intersection) {
        output.push(intersection);
      }
    }

    if (currentInside) {
      output.push(current);
    }
  }

  return normalizeRing(output);
}

function segmentLineIntersection(a: LngLat, b: LngLat, line: SplitLine): LngLat | undefined {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const dx = line.p2[0] - line.p1[0];
  const dy = line.p2[1] - line.p1[1];
  const denominator = cross(vx, vy, dx, dy);

  if (Math.abs(denominator) < COORDINATE_EPSILON) {
    return undefined;
  }

  const t = cross(line.p1[0] - a[0], line.p1[1] - a[1], dx, dy) / denominator;

  return [roundCoordinate(a[0] + vx * t), roundCoordinate(a[1] + vy * t)];
}

function ringToClippingGeometry(ring: readonly LngLat[]): ClippingMultiPolygon {
  const normalized = normalizeRing(ring);

  if (normalized.length < 4 || !ringHasArea(normalized)) {
    return [];
  }

  return [[normalized]];
}

function replacePiece(pieces: readonly SmartPiece[], candidate: SplitCandidate): SmartPiece[] {
  return pieces
    .filter((piece) => piece.key !== candidate.piece.key)
    .concat(candidate.left, candidate.right)
    .sort(comparePieces);
}

function createZoneQuality(input: {
  compactness: number;
  barrierAlignment: number;
  barrierEvidence: number;
  sizeScore: number;
  seedConfidence?: number;
  topology: number;
}): TurkeySmartFallbackZoneQuality {
  const seedComponent = input.seedConfidence ?? 0.75;
  const score =
    input.barrierAlignment * 0.25 +
    input.barrierEvidence * 0.2 +
    input.compactness * 0.17 +
    input.sizeScore * 0.17 +
    seedComponent * 0.08 +
    input.topology * 0.13;

  return {
    score: roundMetric(clamp01(score)),
    compactness: roundMetric(input.compactness),
    barrierAlignment: roundMetric(input.barrierAlignment),
    realBarrierRatio: roundMetric(input.barrierAlignment),
    syntheticBoundaryRatio: roundMetric(clamp01(1 - input.barrierAlignment)),
    barrierEvidence: roundMetric(input.barrierEvidence),
    sizeScore: roundMetric(input.sizeScore),
    ...(input.seedConfidence !== undefined
      ? { seedConfidence: roundMetric(input.seedConfidence) }
      : {}),
    topology: roundMetric(input.topology)
  };
}

function computeBarrierAlignment(
  geometry: TerritoryGeometry,
  parentGeometry: ClippingMultiPolygon,
  barriers: readonly TurkeySmartFallbackBarrier[],
  options: { minAlignmentStrength: number; alignmentToleranceMeters: number }
): number {
  const parent = clippingMultiPolygonToTerritoryGeometry(parentGeometry);
  const parentSegments = parent ? geometrySegments(parent) : [];
  const barrierSegments = barriers
    .filter((barrier) => barrier.strength >= options.minAlignmentStrength)
    .flatMap((barrier) =>
      lineSegments(barrier.coordinates).map((segment) => ({ ...segment, barrier }))
    );
  let totalKm = 0;
  let alignedKm = 0;

  for (const segment of geometrySegments(geometry)) {
    const lengthKm = haversineKm(segment.a, segment.b);

    if (
      lengthKm <= 0 ||
      segmentAlignedLengthMeters(segment, parentSegments, {
        toleranceMeters: PARENT_EDGE_TOLERANCE_METERS,
        parallelSinTolerance: PARENT_PARALLEL_SIN_TOLERANCE
      }) >=
        lengthKm * 1_000 * 0.6
    ) {
      continue;
    }

    totalKm += lengthKm;
    alignedKm +=
      segmentAlignedLengthMeters(segment, barrierSegments, {
        toleranceMeters: options.alignmentToleranceMeters,
        parallelSinTolerance: BARRIER_PARALLEL_SIN_TOLERANCE
      }) / 1_000;
  }

  if (totalKm <= 0) {
    return 0;
  }

  return roundMetric(clamp01(alignedKm / totalKm));
}

function computeBoundaryAlignmentSummary(input: {
  zones: readonly TerritoryZone[];
  parentGeometry: ClippingMultiPolygon;
  barriers: readonly TurkeySmartFallbackBarrier[];
  configuration: TurkeySmartFallbackConfiguration;
}): {
  realBarrierRatio: number;
  syntheticBoundaryRatio: number;
  totalInternalBoundaryLengthKm: number;
  barrierAlignedBoundaryLengthKm: number;
  parentBoundaryLengthKm: number;
} {
  const parent = clippingMultiPolygonToTerritoryGeometry(input.parentGeometry);
  const parentSegments = parent ? geometrySegments(parent) : [];
  const barrierSegments = input.barriers
    .filter((barrier) => barrier.strength >= input.configuration.minAlignmentStrength)
    .flatMap((barrier) =>
      lineSegments(barrier.coordinates).map((segment) => ({ ...segment, barrier }))
    );
  let internalBoundaryMeters = 0;
  let barrierAlignedMeters = 0;
  let parentBoundaryMeters = 0;

  for (const zone of input.zones) {
    for (const segment of geometrySegments(zone.geometry)) {
      const lengthMeters = haversineKm(segment.a, segment.b) * 1_000;

      if (lengthMeters <= 0) {
        continue;
      }

      const parentAlignedMeters = segmentAlignedLengthMeters(segment, parentSegments, {
        toleranceMeters: PARENT_EDGE_TOLERANCE_METERS,
        parallelSinTolerance: PARENT_PARALLEL_SIN_TOLERANCE
      });

      if (parentAlignedMeters >= lengthMeters * 0.6) {
        parentBoundaryMeters += lengthMeters;
        continue;
      }

      internalBoundaryMeters += lengthMeters;
      barrierAlignedMeters += segmentAlignedLengthMeters(segment, barrierSegments, {
        toleranceMeters: input.configuration.alignmentToleranceMeters,
        parallelSinTolerance: BARRIER_PARALLEL_SIN_TOLERANCE
      });
    }
  }

  const uniqueInternalBoundaryKm = internalBoundaryMeters / 2 / 1_000;
  const uniqueBarrierAlignedKm = barrierAlignedMeters / 2 / 1_000;
  const ratio =
    uniqueInternalBoundaryKm > 0 ? clamp01(uniqueBarrierAlignedKm / uniqueInternalBoundaryKm) : 0;

  return {
    realBarrierRatio: roundMetric(ratio),
    syntheticBoundaryRatio: roundMetric(clamp01(1 - ratio)),
    totalInternalBoundaryLengthKm: roundMetric(uniqueInternalBoundaryKm),
    barrierAlignedBoundaryLengthKm: roundMetric(uniqueBarrierAlignedKm),
    parentBoundaryLengthKm: roundMetric(parentBoundaryMeters / 1_000)
  };
}

function segmentAlignedLengthMeters(
  segment: { a: LngLat; b: LngLat },
  candidates: readonly { a: LngLat; b: LngLat }[],
  options: { toleranceMeters: number; parallelSinTolerance: number }
): number {
  const latitude = (segment.a[1] + segment.b[1]) / 2;
  const origin = projectLngLatToMeters(segment.a, latitude);
  const end = projectLngLatToMeters(segment.b, latitude);
  const dx = end[0] - origin[0];
  const dy = end[1] - origin[1];
  const lengthMeters = Math.hypot(dx, dy);

  if (lengthMeters <= 0) {
    return 0;
  }

  const intervals: Array<[number, number]> = [];

  for (const candidate of candidates) {
    if (!segmentBBoxesOverlapWithinMeters(segment, candidate, latitude, options.toleranceMeters)) {
      continue;
    }

    const candidateStart = projectLngLatToMeters(candidate.a, latitude);
    const candidateEnd = projectLngLatToMeters(candidate.b, latitude);
    const candidateDx = candidateEnd[0] - candidateStart[0];
    const candidateDy = candidateEnd[1] - candidateStart[1];
    const candidateLengthMeters = Math.hypot(candidateDx, candidateDy);

    if (candidateLengthMeters <= 0) {
      continue;
    }

    const parallel =
      Math.abs(cross(dx, dy, candidateDx, candidateDy)) / (lengthMeters * candidateLengthMeters);

    if (parallel > options.parallelSinTolerance) {
      continue;
    }

    const distanceStart = pointToProjectedLineDistanceMeters(candidateStart, origin, dx, dy);
    const distanceEnd = pointToProjectedLineDistanceMeters(candidateEnd, origin, dx, dy);
    const distanceMid = pointToProjectedLineDistanceMeters(
      [(candidateStart[0] + candidateEnd[0]) / 2, (candidateStart[1] + candidateEnd[1]) / 2],
      origin,
      dx,
      dy
    );

    if (Math.min(Math.max(distanceStart, distanceEnd), distanceMid) > options.toleranceMeters) {
      continue;
    }

    const start = projectDistanceOnSegment(candidateStart, origin, dx, dy, lengthMeters);
    const endDistance = projectDistanceOnSegment(candidateEnd, origin, dx, dy, lengthMeters);
    const intervalStart = Math.max(0, Math.min(start, endDistance));
    const intervalEnd = Math.min(lengthMeters, Math.max(start, endDistance));

    if (intervalEnd - intervalStart > COORDINATE_EPSILON) {
      intervals.push([intervalStart, intervalEnd]);
    }
  }

  return mergeIntervalLengthMeters(intervals, options.toleranceMeters);
}

function segmentBBoxesOverlapWithinMeters(
  left: { a: LngLat; b: LngLat },
  right: { a: LngLat; b: LngLat },
  latitude: number,
  toleranceMeters: number
): boolean {
  const longitudeTolerance = toleranceMeters / (kilometersPerLongitudeDegree(latitude) * 1_000);
  const latitudeTolerance = toleranceMeters / 111_320;
  const leftWest = Math.min(left.a[0], left.b[0]) - longitudeTolerance;
  const leftEast = Math.max(left.a[0], left.b[0]) + longitudeTolerance;
  const leftSouth = Math.min(left.a[1], left.b[1]) - latitudeTolerance;
  const leftNorth = Math.max(left.a[1], left.b[1]) + latitudeTolerance;
  const rightWest = Math.min(right.a[0], right.b[0]);
  const rightEast = Math.max(right.a[0], right.b[0]);
  const rightSouth = Math.min(right.a[1], right.b[1]);
  const rightNorth = Math.max(right.a[1], right.b[1]);

  return (
    leftWest <= rightEast &&
    leftEast >= rightWest &&
    leftSouth <= rightNorth &&
    leftNorth >= rightSouth
  );
}

function projectLngLatToMeters(point: LngLat, latitude: number): [number, number] {
  return [point[0] * kilometersPerLongitudeDegree(latitude) * 1_000, point[1] * 111_320];
}

function pointToProjectedLineDistanceMeters(
  point: [number, number],
  origin: [number, number],
  dx: number,
  dy: number
): number {
  const length = Math.hypot(dx, dy);

  if (length <= 0) {
    return Math.hypot(point[0] - origin[0], point[1] - origin[1]);
  }

  return Math.abs(cross(dx, dy, point[0] - origin[0], point[1] - origin[1])) / length;
}

function projectDistanceOnSegment(
  point: [number, number],
  origin: [number, number],
  dx: number,
  dy: number,
  lengthMeters: number
): number {
  return ((point[0] - origin[0]) * dx + (point[1] - origin[1]) * dy) / lengthMeters;
}

function mergeIntervalLengthMeters(
  intervals: Array<[number, number]>,
  mergeToleranceMeters: number
): number {
  if (intervals.length === 0) {
    return 0;
  }

  const sorted = intervals.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let total = 0;
  let [start, end] = sorted[0]!;

  for (const [nextStart, nextEnd] of sorted.slice(1)) {
    if (nextStart <= end + mergeToleranceMeters) {
      end = Math.max(end, nextEnd);
      continue;
    }

    total += end - start;
    start = nextStart;
    end = nextEnd;
  }

  total += end - start;
  return total;
}

function sizeFitness(areaKm2: number, configuration: TurkeySmartFallbackConfiguration): number {
  if (areaKm2 >= configuration.minAreaKm2 && areaKm2 <= configuration.maxAreaKm2) {
    const distance = Math.abs(areaKm2 - configuration.targetAreaKm2);
    const range = Math.max(
      configuration.targetAreaKm2 - configuration.minAreaKm2,
      configuration.maxAreaKm2 - configuration.targetAreaKm2,
      AREA_TOLERANCE_KM2
    );
    return roundMetric(clamp01(1 - distance / range));
  }

  if (areaKm2 < configuration.minAreaKm2) {
    return roundMetric(clamp01(areaKm2 / configuration.minAreaKm2));
  }

  return roundMetric(clamp01(configuration.maxAreaKm2 / areaKm2));
}

function computeSeedConfidence(
  seeds: readonly TurkeySmartFallbackLocalitySeed[]
): number | undefined {
  if (seeds.length === 0) {
    return undefined;
  }

  if (seeds.length === 1) {
    return roundMetric(clamp01(seeds[0]?.confidence ?? 0.85));
  }

  return roundMetric(clamp01(0.55 / seeds.length));
}

function normalizeLocalitySeeds(
  seeds: readonly TurkeySmartFallbackLocalitySeed[],
  parentGeometry: ClippingMultiPolygon
): TurkeySmartFallbackLocalitySeed[] {
  const normalized = seeds
    .filter(
      (seed) =>
        seed.name.trim().length > 0 &&
        Number.isFinite(seed.coordinate[0]) &&
        Number.isFinite(seed.coordinate[1]) &&
        pointInClippingGeometry(seed.coordinate, parentGeometry)
    )
    .map((seed, index) => ({
      ...seed,
      id: seed.id ?? `seed:${index}`,
      authoritative: false as const,
      confidence: clamp01(seed.confidence ?? 0.8)
    }))
    .sort(compareSeeds);

  const deduped: TurkeySmartFallbackLocalitySeed[] = [];

  for (const seed of normalized) {
    const duplicateIndex = deduped.findIndex(
      (candidate) =>
        normalizeSeedName(candidate.name) === normalizeSeedName(seed.name) &&
        (candidate.type ?? "unknown") === (seed.type ?? "unknown") &&
        haversineKm(candidate.coordinate, seed.coordinate) <= 0.05
    );

    if (duplicateIndex === -1) {
      deduped.push(seed);
      continue;
    }

    const duplicate = deduped[duplicateIndex]!;
    if ((seed.confidence ?? 0) > (duplicate.confidence ?? 0)) {
      deduped[duplicateIndex] = seed;
    }
  }

  return deduped.sort(compareSeeds);
}

function normalizeSeedName(input: string): string {
  return input.trim().toLocaleLowerCase("tr").replace(/\s+/g, " ");
}

function selectProfile(input: {
  requestedProfile: TurkeySmartFallbackProfile;
  parentAreaKm2: number;
  roadDensityKmPerKm2: number;
  strongBarrierCount: number;
  mediumBarrierCount: number;
  localitySeedCount: number;
}): { selectedProfile: ResolvedTurkeySmartFallbackProfile; reasons: string[] } {
  if (input.requestedProfile !== "auto") {
    return {
      selectedProfile: input.requestedProfile,
      reasons: [`requested:${input.requestedProfile}`]
    };
  }

  if (
    input.parentAreaKm2 <= 75 &&
    (input.roadDensityKmPerKm2 >= 12 || input.localitySeedCount >= 20)
  ) {
    return {
      selectedProfile: "dense-urban",
      reasons: ["area<=75-and-road-density>=12-or-seeds>=20"]
    };
  }

  if (
    input.parentAreaKm2 <= 150 &&
    (input.roadDensityKmPerKm2 >= 5 || input.localitySeedCount >= 8 || input.parentAreaKm2 <= 75)
  ) {
    return {
      selectedProfile: "urban",
      reasons: ["area<=150-and-road-density>=5-or-seeds>=8-or-area<=75"]
    };
  }

  if (
    input.parentAreaKm2 <= 450 ||
    input.roadDensityKmPerKm2 >= 1.5 ||
    (input.parentAreaKm2 <= 1_000 && input.strongBarrierCount + input.mediumBarrierCount >= 5)
  ) {
    return {
      selectedProfile: "suburban",
      reasons: ["area<=450-or-road-density>=1.5-or-area<=1000-and-barriers>=5"]
    };
  }

  return { selectedProfile: "rural", reasons: ["area>450"] };
}

function isLikelySwappedTurkeyGeometry(geometry: TerritoryGeometry): boolean {
  const [west, south, east, north] = computeGeometryBBox(geometry);
  const longitudeLooksLikeTurkeyLatitude = west >= 35 && east <= 43;
  const latitudeLooksLikeTurkeyLongitude = south >= 25 && north <= 45;
  const longitudeLooksLikeTurkeyLongitude = west >= 25 && east <= 45;
  const latitudeLooksLikeTurkeyLatitude = south >= 35 && north <= 43;

  return (
    longitudeLooksLikeTurkeyLatitude &&
    latitudeLooksLikeTurkeyLongitude &&
    !(longitudeLooksLikeTurkeyLongitude && latitudeLooksLikeTurkeyLatitude)
  );
}

function snapToleranceDegreesToMeters(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return roundMetric(value * 111_320);
}

function resolveBarrierConfig(
  override: Partial<TurkeySmartFallbackBarrierConfig> | undefined
): TurkeySmartFallbackBarrierConfig {
  return {
    ...DEFAULT_TURKEY_SMART_FALLBACK_BARRIER_CONFIG,
    ...override,
    roadScores: {
      ...DEFAULT_TURKEY_SMART_FALLBACK_BARRIER_CONFIG.roadScores,
      ...(override?.roadScores ?? {})
    },
    railwayScores: {
      ...DEFAULT_TURKEY_SMART_FALLBACK_BARRIER_CONFIG.railwayScores,
      ...(override?.railwayScores ?? {})
    },
    waterwayScores: {
      ...DEFAULT_TURKEY_SMART_FALLBACK_BARRIER_CONFIG.waterwayScores,
      ...(override?.waterwayScores ?? {})
    },
    naturalScores: {
      ...DEFAULT_TURKEY_SMART_FALLBACK_BARRIER_CONFIG.naturalScores,
      ...(override?.naturalScores ?? {})
    },
    landuseScores: {
      ...DEFAULT_TURKEY_SMART_FALLBACK_BARRIER_CONFIG.landuseScores,
      ...(override?.landuseScores ?? {})
    },
    leisureScores: {
      ...DEFAULT_TURKEY_SMART_FALLBACK_BARRIER_CONFIG.leisureScores,
      ...(override?.leisureScores ?? {})
    }
  };
}

function resolveSourceMetadata(
  input: TurkeySmartFallbackInput,
  barriers: readonly TurkeySmartFallbackBarrier[],
  configuration: TurkeySmartFallbackConfiguration
): Required<TurkeySmartFallbackSourceMetadata> {
  const explicit = input.options?.sourceMetadata ?? {};
  const usesOsm =
    barriers.some((barrier) => {
      const serialized = serializeJsonStable(barrier.tags).toLowerCase();
      return serialized.includes("osm") || serialized.includes("openstreetmap");
    }) || barriers.length > 0;
  const providerId = explicit.providerId ?? (usesOsm ? "openstreetmap" : "territory-kit-derived");

  return {
    providerId,
    providerName:
      explicit.providerName ??
      (usesOsm
        ? "OpenStreetMap normalized by TerritoryKit Smart Fallback"
        : "TerritoryKit Smart Fallback"),
    sourceDatasetId: explicit.sourceDatasetId ?? "tr-adm3-smart-fallback",
    sourceId: explicit.sourceId ?? "tr-adm3-smart-fallback",
    sourceDate: explicit.sourceDate ?? configuration.algorithmVersion,
    sourceVersion: explicit.sourceVersion ?? configuration.algorithmVersion,
    sourceUrl: explicit.sourceUrl ?? (usesOsm ? "https://www.openstreetmap.org/" : ""),
    sourceSnapshotId: explicit.sourceSnapshotId ?? configuration.algorithmVersion,
    sourceSnapshotChecksum:
      explicit.sourceSnapshotChecksum ??
      sha256Hex(
        serializeJsonStable({
          parent: input.parent.id,
          barriers,
          seeds: input.localitySeeds ?? [],
          configuration
        })
      ),
    license: explicit.license ?? (usesOsm ? "ODbL-1.0" : "Apache-2.0"),
    attribution:
      explicit.attribution ??
      (usesOsm
        ? "OpenStreetMap contributors, ODbL 1.0; TerritoryKit smart-derived fallback"
        : "TerritoryKit smart-derived fallback")
  };
}

function normalizeFeatureProperties(properties: GeoJsonProperties): Record<string, string> {
  if (!properties) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(properties)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, Array.isArray(value) ? String(value[0] ?? "") : String(value)])
  );
}

function firstTagValue(input: string | undefined): string | undefined {
  return input?.split(";")[0]?.trim();
}

function readFiniteNumber(input: string | undefined): number | undefined {
  if (input === undefined) {
    return undefined;
  }

  const value = Number(input);
  return Number.isFinite(value) ? value : undefined;
}

function strengthClass(strength: number): TurkeySmartFallbackBarrierStrengthClass {
  if (strength >= 0.75) {
    return "strong";
  }

  if (strength >= 0.4) {
    return "medium";
  }

  if (strength > 0) {
    return "weak";
  }

  return "ignored";
}

function normalizeLineCoordinates(coordinates: readonly LngLat[]): LngLat[] {
  const normalized = coordinates
    .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
    .map((point) => [roundCoordinate(point[0]), roundCoordinate(point[1])] satisfies LngLat);
  const deduped: LngLat[] = [];

  for (const point of normalized) {
    const previous = deduped[deduped.length - 1];
    if (!previous || !pointsEqual(previous, point)) {
      deduped.push(point);
    }
  }

  return deduped;
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
    return { type: "Polygon", coordinates: polygons[0]! };
  }

  return { type: "MultiPolygon", coordinates: polygons };
}

function canonicalizeClippingGeometry(geometry: ClippingMultiPolygon): ClippingMultiPolygon {
  return geometry
    .map((polygon) =>
      polygon
        .map((ring, ringIndex) => canonicalizeRing(ring, ringIndex > 0))
        .filter((ring) => ring.length >= 4)
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

function normalizeRing(ring: readonly (readonly [number, number])[]): LngLat[] {
  const coordinates = ring
    .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
    .map((point) => [roundCoordinate(point[0]), roundCoordinate(point[1])] satisfies LngLat);
  const deduped: LngLat[] = [];

  for (const coordinate of coordinates) {
    const previous = deduped[deduped.length - 1];

    if (!previous || !pointsEqual(previous, coordinate)) {
      deduped.push(coordinate);
    }
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

function unionClippingGeometries(
  geometries: readonly ClippingMultiPolygon[]
): ClippingMultiPolygon {
  const nonEmpty = geometries.filter(isNonEmptyClippingGeometry);

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
  if (!isNonEmptyClippingGeometry(left) || !isNonEmptyClippingGeometry(right)) {
    return [];
  }

  try {
    return canonicalizeClippingGeometry(CLIPPER.intersection(left, right));
  } catch {
    return [];
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

function compactness(geometry: TerritoryGeometry): number {
  const areaM2 = clippingAreaKm2(toClippingMultiPolygon(geometry)) * 1_000_000;
  const perimeterM = geometrySegments(geometry).reduce(
    (total, segment) => total + haversineKm(segment.a, segment.b) * 1_000,
    0
  );

  if (areaM2 <= 0 || perimeterM <= 0) {
    return 0;
  }

  return roundMetric(clamp01((4 * Math.PI * areaM2) / (perimeterM * perimeterM)));
}

function collectOverlapArea(zones: readonly TerritoryZone[]): number {
  let overlapAreaKm2 = 0;
  const sorted = [...zones].sort((left, right) => left.id.localeCompare(right.id));

  for (let index = 0; index < sorted.length; index += 1) {
    const left = sorted[index];
    if (!left) continue;

    for (let nextIndex = index + 1; nextIndex < sorted.length; nextIndex += 1) {
      const right = sorted[nextIndex];
      if (!right || !bboxesOverlap(left.bbox, right.bbox)) continue;

      overlapAreaKm2 += clippingAreaKm2(
        intersectClippingGeometries(
          toClippingMultiPolygon(left.geometry),
          toClippingMultiPolygon(right.geometry)
        )
      );
    }
  }

  return roundAreaKm2(overlapAreaKm2);
}

function topologyNoiseToleranceKm2(parentAreaKm2: number): number {
  return roundAreaKm2(Math.max(AREA_TOLERANCE_KM2, Math.min(0.0001, parentAreaKm2 * 0.000002)));
}

function normalizeTopologyNoiseAreaKm2(value: number, toleranceKm2: number): number {
  return value <= toleranceKm2 ? 0 : value;
}

function computeCoverageAreas(input: {
  parentGeometry: ClippingMultiPolygon;
  zoneGeometries: readonly ClippingMultiPolygon[];
  overlapAreaKm2: number;
}): {
  parentAreaKm2: number;
  smartUnionAreaKm2: number;
  intersectionAreaKm2: number;
  uncoveredInsideParentKm2: number;
  outsideSpillKm2: number;
  mode: "union" | "per-zone-fallback";
  failureReason?: string;
} {
  const parentAreaKm2 = clippingAreaKm2(input.parentGeometry);
  const unionAttempt = tryUnionClippingGeometries(input.zoneGeometries);

  if (unionAttempt.ok) {
    const intersection = tryIntersectClippingGeometries(
      input.parentGeometry,
      unionAttempt.geometry
    );
    const uncovered = tryDifferenceClippingGeometries(input.parentGeometry, unionAttempt.geometry);
    const spill = tryDifferenceClippingGeometries(unionAttempt.geometry, input.parentGeometry);

    if (intersection.ok && uncovered.ok && spill.ok) {
      const intersectionAreaKm2 = clippingAreaKm2(intersection.geometry);
      const outsideSpillKm2 = clippingAreaKm2(spill.geometry);

      return {
        parentAreaKm2,
        smartUnionAreaKm2: roundAreaKm2(intersectionAreaKm2 + outsideSpillKm2),
        intersectionAreaKm2,
        uncoveredInsideParentKm2: clippingAreaKm2(uncovered.geometry),
        outsideSpillKm2,
        mode: "union"
      };
    }

    const failureReason = [
      intersection.ok ? undefined : `intersection:${intersection.failureReason}`,
      uncovered.ok ? undefined : `uncovered:${uncovered.failureReason}`,
      spill.ok ? undefined : `spill:${spill.failureReason}`
    ]
      .filter(Boolean)
      .join(";");

    return computePerZoneCoverageAreas({
      parentGeometry: input.parentGeometry,
      zoneGeometries: input.zoneGeometries,
      overlapAreaKm2: input.overlapAreaKm2,
      parentAreaKm2,
      failureReason
    });
  }

  return computePerZoneCoverageAreas({
    parentGeometry: input.parentGeometry,
    zoneGeometries: input.zoneGeometries,
    overlapAreaKm2: input.overlapAreaKm2,
    parentAreaKm2,
    failureReason: `union:${unionAttempt.failureReason}`
  });
}

function computePerZoneCoverageAreas(input: {
  parentGeometry: ClippingMultiPolygon;
  zoneGeometries: readonly ClippingMultiPolygon[];
  overlapAreaKm2: number;
  parentAreaKm2: number;
  failureReason?: string;
}): {
  parentAreaKm2: number;
  smartUnionAreaKm2: number;
  intersectionAreaKm2: number;
  uncoveredInsideParentKm2: number;
  outsideSpillKm2: number;
  mode: "per-zone-fallback";
  failureReason?: string;
} {
  let intersectionAreaKm2 = 0;
  let outsideSpillKm2 = 0;

  for (const geometry of input.zoneGeometries) {
    const zoneAreaKm2 = clippingAreaKm2(geometry);
    const intersection = tryIntersectClippingGeometries(input.parentGeometry, geometry);
    const clippedAreaKm2 = intersection.ok ? clippingAreaKm2(intersection.geometry) : 0;
    const spill = tryDifferenceClippingGeometries(geometry, input.parentGeometry);

    intersectionAreaKm2 += clippedAreaKm2;
    outsideSpillKm2 += spill.ok
      ? clippingAreaKm2(spill.geometry)
      : Math.max(0, zoneAreaKm2 - clippedAreaKm2);
  }

  const effectiveIntersectionAreaKm2 = roundAreaKm2(
    clampNumber(
      intersectionAreaKm2 - input.overlapAreaKm2,
      0,
      Math.max(input.parentAreaKm2, intersectionAreaKm2)
    )
  );
  const normalizedIntersectionAreaKm2 = roundAreaKm2(
    Math.min(input.parentAreaKm2, effectiveIntersectionAreaKm2)
  );
  const normalizedOutsideSpillKm2 = roundAreaKm2(Math.max(0, outsideSpillKm2));

  return {
    parentAreaKm2: input.parentAreaKm2,
    smartUnionAreaKm2: roundAreaKm2(normalizedIntersectionAreaKm2 + normalizedOutsideSpillKm2),
    intersectionAreaKm2: normalizedIntersectionAreaKm2,
    uncoveredInsideParentKm2: roundAreaKm2(
      Math.max(0, input.parentAreaKm2 - normalizedIntersectionAreaKm2)
    ),
    outsideSpillKm2: normalizedOutsideSpillKm2,
    mode: "per-zone-fallback",
    ...(input.failureReason ? { failureReason: input.failureReason } : {})
  };
}

function tryUnionClippingGeometries(
  geometries: readonly ClippingMultiPolygon[]
): { ok: true; geometry: ClippingMultiPolygon } | { ok: false; failureReason: string } {
  const nonEmpty = geometries.filter(isNonEmptyClippingGeometry);

  if (nonEmpty.length === 0) {
    return { ok: true, geometry: [] };
  }

  if (nonEmpty.length === 1) {
    return { ok: true, geometry: canonicalizeClippingGeometry(nonEmpty[0]!) };
  }

  try {
    return {
      ok: true,
      geometry: canonicalizeClippingGeometry(CLIPPER.union(nonEmpty[0]!, ...nonEmpty.slice(1)))
    };
  } catch (error) {
    return {
      ok: false,
      failureReason: error instanceof Error ? error.message : String(error)
    };
  }
}

function tryIntersectClippingGeometries(
  left: ClippingMultiPolygon,
  right: ClippingMultiPolygon
): { ok: true; geometry: ClippingMultiPolygon } | { ok: false; failureReason: string } {
  if (!isNonEmptyClippingGeometry(left) || !isNonEmptyClippingGeometry(right)) {
    return { ok: true, geometry: [] };
  }

  try {
    return { ok: true, geometry: canonicalizeClippingGeometry(CLIPPER.intersection(left, right)) };
  } catch (error) {
    return {
      ok: false,
      failureReason: error instanceof Error ? error.message : String(error)
    };
  }
}

function tryDifferenceClippingGeometries(
  subject: ClippingMultiPolygon,
  ...clips: readonly ClippingMultiPolygon[]
): { ok: true; geometry: ClippingMultiPolygon } | { ok: false; failureReason: string } {
  const nonEmptyClips = clips.filter(isNonEmptyClippingGeometry);

  if (!isNonEmptyClippingGeometry(subject)) {
    return { ok: true, geometry: [] };
  }

  if (nonEmptyClips.length === 0) {
    return { ok: true, geometry: canonicalizeClippingGeometry(subject) };
  }

  try {
    return {
      ok: true,
      geometry: canonicalizeClippingGeometry(CLIPPER.difference(subject, ...nonEmptyClips))
    };
  } catch (error) {
    return {
      ok: false,
      failureReason: error instanceof Error ? error.message : String(error)
    };
  }
}

function pointInClippingGeometry(point: LngLat, geometry: ClippingMultiPolygon): boolean {
  const territoryGeometry = clippingMultiPolygonToTerritoryGeometry(geometry);
  return territoryGeometry ? pointInGeometry(point, territoryGeometry) : false;
}

function pointInGeometry(point: LngLat, geometry: TerritoryGeometry): boolean {
  return geometryToPolygons(geometry).some((polygon) => pointInPolygon(point, polygon));
}

function pointInPolygon(point: LngLat, polygon: readonly LngLat[][]): boolean {
  const [shell, ...holes] = polygon;

  if (!shell || !pointInRing(point, shell)) {
    return false;
  }

  return !holes.some((hole) => pointInRing(point, hole));
}

function pointInRing(point: LngLat, ring: readonly LngLat[]): boolean {
  let inside = false;
  const [x, y] = point;

  for (
    let index = 0, previousIndex = ring.length - 1;
    index < ring.length;
    previousIndex = index, index += 1
  ) {
    const current = ring[index];
    const previous = ring[previousIndex];

    if (!current || !previous) {
      continue;
    }

    if (pointOnSegment(point, previous, current)) {
      return true;
    }

    const intersects =
      current[1] > y !== previous[1] > y &&
      x < ((previous[0] - current[0]) * (y - current[1])) / (previous[1] - current[1]) + current[0];

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function pointOnSegment(point: LngLat, a: LngLat, b: LngLat): boolean {
  const distance = pointToLineDistanceDegrees(point, { a, b });
  const withinX =
    point[0] >= Math.min(a[0], b[0]) - COORDINATE_EPSILON &&
    point[0] <= Math.max(a[0], b[0]) + COORDINATE_EPSILON;
  const withinY =
    point[1] >= Math.min(a[1], b[1]) - COORDINATE_EPSILON &&
    point[1] <= Math.max(a[1], b[1]) + COORDINATE_EPSILON;

  return distance <= COORDINATE_EPSILON && withinX && withinY;
}

function pointToLineDistanceDegrees(point: LngLat, line: { a: LngLat; b: LngLat }): number {
  const dx = line.b[0] - line.a[0];
  const dy = line.b[1] - line.a[1];
  const length = Math.hypot(dx, dy);

  if (length <= 0) {
    return Math.hypot(point[0] - line.a[0], point[1] - line.a[1]);
  }

  return Math.abs(cross(dx, dy, point[0] - line.a[0], point[1] - line.a[1])) / length;
}

function countSeedsInGeometry(
  seeds: readonly TurkeySmartFallbackLocalitySeed[],
  geometry: ClippingMultiPolygon
): number {
  return seeds.filter((seed) => pointInClippingGeometry(seed.coordinate, geometry)).length;
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

function geometrySegments(geometry: TerritoryGeometry): Array<{ a: LngLat; b: LngLat }> {
  return geometryToPolygons(geometry).flatMap((polygon) => polygon.flatMap(lineSegments));
}

function lineSegments(coordinates: readonly LngLat[]): Array<{ a: LngLat; b: LngLat }> {
  const segments: Array<{ a: LngLat; b: LngLat }> = [];

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const a = coordinates[index];
    const b = coordinates[index + 1];

    if (a && b && !pointsEqual(a, b)) {
      segments.push({ a, b });
    }
  }

  return segments;
}

function sharedBoundaryKmBetween(left: ClippingMultiPolygon, right: ClippingMultiPolygon): number {
  const leftGeometry = clippingMultiPolygonToTerritoryGeometry(left);
  const rightGeometry = clippingMultiPolygonToTerritoryGeometry(right);

  if (!leftGeometry || !rightGeometry) {
    return 0;
  }

  let total = 0;
  const rightSegments = geometrySegments(rightGeometry);

  for (const segment of geometrySegments(leftGeometry)) {
    total +=
      segmentAlignedLengthMeters(segment, rightSegments, {
        toleranceMeters: PARENT_EDGE_TOLERANCE_METERS,
        parallelSinTolerance: PARENT_PARALLEL_SIN_TOLERANCE
      }) / 1_000;
  }

  return roundMetric(total);
}

function lineLengthKm(coordinates: readonly LngLat[]): number {
  return lineSegments(coordinates).reduce(
    (total, segment) => total + haversineKm(segment.a, segment.b),
    0
  );
}

function centroidDistanceKm(left: ClippingMultiPolygon, right: ClippingMultiPolygon): number {
  const leftGeometry = clippingMultiPolygonToTerritoryGeometry(left);
  const rightGeometry = clippingMultiPolygonToTerritoryGeometry(right);

  if (!leftGeometry || !rightGeometry) {
    return Number.POSITIVE_INFINITY;
  }

  return haversineKm(computeGeometryCenter(leftGeometry), computeGeometryCenter(rightGeometry));
}

function lineSignedDistance(line: SplitLine, point: LngLat): number {
  return cross(
    line.p2[0] - line.p1[0],
    line.p2[1] - line.p1[1],
    point[0] - line.p1[0],
    point[1] - line.p1[1]
  );
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function lineTouchesBBox(line: SplitLine, bbox: TerritoryBBox): boolean {
  const rect = bboxToRect(bbox);
  const west = Math.min(line.p1[0], line.p2[0]);
  const east = Math.max(line.p1[0], line.p2[0]);
  const south = Math.min(line.p1[1], line.p2[1]);
  const north = Math.max(line.p1[1], line.p2[1]);

  return west <= rect.east && east >= rect.west && south <= rect.north && north >= rect.south;
}

function splitBalanceScore(leftAreaKm2: number, rightAreaKm2: number): number {
  const total = leftAreaKm2 + rightAreaKm2;
  if (total <= 0) {
    return 0;
  }

  return roundMetric(clamp01(1 - Math.abs(leftAreaKm2 - rightAreaKm2) / total));
}

function clippingBBox(geometry: ClippingMultiPolygon): TerritoryBBox {
  const territoryGeometry = clippingMultiPolygonToTerritoryGeometry(geometry);
  return territoryGeometry ? computeGeometryBBox(territoryGeometry) : [0, 0, 0, 0];
}

function bboxToRect(bbox: TerritoryBBox): {
  west: number;
  south: number;
  east: number;
  north: number;
} {
  return {
    west: Math.min(bbox[0], bbox[2]),
    south: Math.min(bbox[1], bbox[3]),
    east: Math.max(bbox[0], bbox[2]),
    north: Math.max(bbox[1], bbox[3])
  };
}

function bboxesOverlap(left: TerritoryBBox, right: TerritoryBBox): boolean {
  return left[0] <= right[2] && left[2] >= right[0] && left[1] <= right[3] && left[3] >= right[1];
}

function canonicalGeometryPayload(geometry: TerritoryGeometry): unknown {
  return geometryToPolygons(geometry)
    .map((polygon) => {
      const rings = polygon.map((ring) => canonicalLine(normalizeRing(ring)));
      const [shell, ...holes] = rings;
      return { shell, holes: holes.sort(compareSerialized) };
    })
    .sort((left, right) => compareSerialized(left.shell, right.shell));
}

function canonicalLine(line: readonly LngLat[]): LngLat[] {
  const forward = line.map(
    (point) => [roundCoordinate(point[0]), roundCoordinate(point[1])] satisfies LngLat
  );
  const reverse = [...forward].reverse();
  return compareSerialized(forward, reverse) <= 0 ? forward : reverse;
}

function layerSummary(collection: FeatureCollection | undefined): {
  status: "provided" | "missing";
  featureCount: number;
  hash?: string;
  source?: string;
} {
  if (!collection || collection.features.length === 0) {
    return { status: "missing", featureCount: 0 };
  }

  return {
    status: "provided",
    featureCount: collection.features.length,
    hash: sha256Hex(serializeJsonStable(collection)),
    source: inferLayerSource(collection.features)
  };
}

function inferLayerSource(features: readonly Feature[]): string {
  const text = serializeJsonStable(
    features.map((feature) => feature.properties ?? {})
  ).toLowerCase();
  return text.includes("osm") || text.includes("openstreetmap") ? "openstreetmap" : "provided";
}

function parentSourceId(parent: TerritoryZone): string {
  const territory = isRecord(parent.properties.territory) ? parent.properties.territory : {};
  const source = isRecord(territory.source) ? territory.source : {};

  return (
    readString(territory.sourceDatasetId) ??
    readString(source.sourceDatasetId) ??
    readString(territory.providerId) ??
    readString(source.providerId) ??
    parent.datasetId
  );
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

function readString(input: unknown): string | undefined {
  return typeof input === "string" && input.trim().length > 0 ? input.trim() : undefined;
}

function isNonEmptyClippingGeometry(
  geometry: ClippingMultiPolygon
): geometry is ClippingMultiPolygon {
  return geometry.length > 0;
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

function compareClippingPolygons(left: ClippingPolygon, right: ClippingPolygon): number {
  return compareSerialized(left, right);
}

function compareBarriers(
  left: TurkeySmartFallbackBarrier,
  right: TurkeySmartFallbackBarrier
): number {
  return (
    right.strength - left.strength ||
    right.lengthKm - left.lengthKm ||
    left.sourceLayer.localeCompare(right.sourceLayer) ||
    left.id.localeCompare(right.id)
  );
}

function comparePieces(left: SmartPiece, right: SmartPiece): number {
  return (
    compareBBoxes(clippingBBox(left.geometry), clippingBBox(right.geometry)) ||
    left.key.localeCompare(right.key)
  );
}

function compareZoneCandidates(left: ZoneCandidate, right: ZoneCandidate): number {
  return (
    compareBBoxes(computeGeometryBBox(left.geometry), computeGeometryBBox(right.geometry)) ||
    left.localKey.localeCompare(right.localKey)
  );
}

function compareSplitLines(left: SplitLine, right: SplitLine): number {
  const leftStrength = left.barrier?.strength ?? 0;
  const rightStrength = right.barrier?.strength ?? 0;

  return (
    rightStrength - leftStrength ||
    right.lengthKm - left.lengthKm ||
    left.id.localeCompare(right.id)
  );
}

function compareSplitCandidates(left: SplitCandidate, right: SplitCandidate): number {
  return (
    right.score - left.score ||
    right.line.lengthKm - left.line.lengthKm ||
    left.piece.key.localeCompare(right.piece.key) ||
    left.line.id.localeCompare(right.line.id)
  );
}

function compareSeeds(
  left: TurkeySmartFallbackLocalitySeed,
  right: TurkeySmartFallbackLocalitySeed
): number {
  return seedId(left).localeCompare(seedId(right)) || left.name.localeCompare(right.name);
}

function seedId(seed: TurkeySmartFallbackLocalitySeed): string {
  return seed.id ?? `${seed.name}:${seed.coordinate[0]}:${seed.coordinate[1]}`;
}

function compareBBoxes(left: TerritoryBBox, right: TerritoryBBox): number {
  return left[1] - right[1] || left[0] - right[0] || left[3] - right[3] || left[2] - right[2];
}

function compareSerialized(left: unknown, right: unknown): number {
  return serializeJsonStable(left).localeCompare(serializeJsonStable(right));
}

function sortIssues(issues: readonly TurkeySmartFallbackIssue[]): TurkeySmartFallbackIssue[] {
  return [...issues].sort(
    (left, right) =>
      severityRank(left.severity) - severityRank(right.severity) ||
      left.code.localeCompare(right.code) ||
      (left.zoneId ?? "").localeCompare(right.zoneId ?? "") ||
      left.message.localeCompare(right.message)
  );
}

function severityRank(severity: TurkeySmartFallbackIssue["severity"]): number {
  return severity === "error" ? 0 : severity === "warning" ? 1 : 2;
}

function sortedUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

function pointsEqual(left: LngLat, right: LngLat): boolean {
  return (
    Math.abs(left[0] - right[0]) <= COORDINATE_EPSILON &&
    Math.abs(left[1] - right[1]) <= COORDINATE_EPSILON
  );
}

function deterministicUnitInterval(input: string): number {
  return Number.parseInt(sha256Hex(input).slice(0, 12), 16) / 0xffffffffffff;
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

function kilometersPerLongitudeDegree(latitude: number): number {
  return Math.max(AREA_TOLERANCE_KM2, 111.32 * Math.cos(toRadians(latitude)));
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
  return Number(value.toFixed(7));
}

function roundAreaKm2(value: number): number {
  return Number(value.toFixed(6));
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampInteger(value: number, minValue: number, maxValue: number): number {
  return Math.max(minValue, Math.min(maxValue, value));
}

function clampNumber(value: number, minValue: number, maxValue: number): number {
  return Math.max(minValue, Math.min(maxValue, value));
}

function percentage(value: number, total: number): number {
  return total <= 0 ? 0 : roundMetric((value / total) * 100);
}

function sum(values: readonly number[]): number {
  return roundAreaKm2(values.reduce((total, value) => total + value, 0));
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : roundAreaKm2(sum(values) / values.length);
}

function min(values: readonly number[]): number {
  return values.length === 0 ? 0 : roundAreaKm2(Math.min(...values));
}

function max(values: readonly number[]): number {
  return values.length === 0 ? 0 : roundAreaKm2(Math.max(...values));
}

function meanMetric(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : roundMetric(values.reduce((total, value) => total + value, 0) / values.length);
}

function minMetric(values: readonly number[]): number {
  return values.length === 0 ? 0 : roundMetric(Math.min(...values));
}

function metricDistribution(values: readonly number[]): {
  min: number;
  p10: number;
  median: number;
  mean: number;
  p90: number;
  max: number;
} {
  if (values.length === 0) {
    return { min: 0, p10: 0, median: 0, mean: 0, p90: 0, max: 0 };
  }

  const sorted = [...values].sort((left, right) => left - right);

  return {
    min: roundMetric(sorted[0]!),
    p10: percentile(sorted, 0.1),
    median: percentile(sorted, 0.5),
    mean: meanMetric(sorted),
    p90: percentile(sorted, 0.9),
    max: roundMetric(sorted[sorted.length - 1]!)
  };
}

function percentile(sortedValues: readonly number[], fraction: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }

  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor((sortedValues.length - 1) * fraction))
  );

  return roundMetric(sortedValues[index]!);
}
