import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TerritoryDataset, TerritoryGeometry, TerritoryZone } from "@territory-kit/dataset";
import polygonClipping from "polygon-clipping";
import {
  buildTerritoryCountryDataset,
  parseTerritoryCountrySourceFeatures
} from "./countries/builder.js";
import { createPilotCountryConfig } from "./countries/configs/utils.js";
import type {
  TerritoryCountryDatasetConfig,
  TerritoryCountrySourceLock
} from "./countries/types.js";
import { repairTerritoryGeometries } from "./geometry-repair.js";
import {
  clippingMultiPolygonToTerritoryGeometry,
  computeTurkeyAdm3GeometryAreaKm2,
  geometryToClippingMultiPolygon
} from "./turkey-adm3-full-coverage.js";
import type { MultiPolygon as ClippingMultiPolygon } from "polygon-clipping";
import {
  TURKEY_GEOBOUNDARIES_GIT_RELEASE_COMMIT,
  analyzeGeoBoundariesFeatureCollection,
  findGeoBoundariesArtifactBySha256,
  loadTurkeyGeoBoundariesSourceLock,
  verifyGeoBoundariesSourceArtifactBytes
} from "./turkey-geoboundaries-parent-lineage.js";
import {
  TURKEY_PARENT_INVENTORY_EXPECTED,
  TURKEY_V2_ADM_PARENT_LEVELS,
  auditGeometryHash,
  type TurkeyV2AdmParentLevel
} from "./turkey-parent-provenance.js";
import { serializeJsonStable } from "./sources/utils.js";

export const TURKEY_GEOBOUNDARIES_FULL_BUILDER_REPLAY_SCHEMA_VERSION =
  "territorykit-tr-geoboundaries-full-builder-replay@1" as const;

export type FullBuilderReplayClassification =
  | "FULL_REPLAY_VERIFIED"
  | "GEOGRAPHICALLY_EQUIVALENT_WITH_DIFFERENCES"
  | "MATERIAL_GEOMETRY_DIFFERENCES_FOUND"
  | "PARTIALLY_REPRODUCED"
  | "BLOCKED_BY_MISSING_EVIDENCE";

export type GeometryPipelineStage =
  | "parsed-upstream"
  | "adapter-output"
  | "geometry-repair"
  | "country-builder-output"
  | "serialized-final"
  | "canonical-parent";

export type GeographicEquivalenceClass =
  | "BYTE_IDENTICAL"
  | "SERIALIZED_IDENTICAL"
  | "TOPOLOGICALLY_EQUIVALENT"
  | "GEOGRAPHICALLY_EQUIVALENT_WITHIN_TOLERANCE"
  | "MATERIALLY_DIFFERENT"
  | "NOT_ASSESSABLE";

export type GeometryMismatchRootCause =
  | "coordinate-precision"
  | "geometry-normalization"
  | "ring-direction-or-start-vertex"
  | "polygon-multipolygon-representation"
  | "interior-ring-ordering"
  | "geometry-repair"
  | "simplification"
  | "topology-operations"
  | "historical-build-configuration"
  | "source-input-mismatch"
  | "genuine-geographic-boundary-difference"
  | "missing-evidence";

export type RootCauseEvidenceTier = "confirmed" | "probable" | "unresolved";

export interface MismatchRootCauseAssessment {
  /** Earliest pipeline stage whose audit hash differs from canonical — not a proven causal origin. */
  firstObservedHashMismatchStage: GeometryPipelineStage;
  confirmedRootCause: GeometryMismatchRootCause | null;
  probableExplanation: string | null;
  unresolvedReason: string | null;
  evidenceTier: RootCauseEvidenceTier;
}

export interface ReplayCoverageGate {
  complete: boolean;
  issues: string[];
  expectedParentZoneCount: number;
  canonicalParentZoneCount: number;
  replayParentZoneCount: number;
  missingReplayZones: number;
  missingCanonicalSourceIds: number;
  duplicateReplaySourceNativeIds: number;
  geometryComparisonsExpected: number;
  geometryComparisonsPerformed: number;
  geographicComparisonSkipped: boolean;
  buildDatasetAvailable: boolean;
  determinismSkipped: boolean;
  determinismByteIdentical: boolean;
}

const CLIPPER =
  (polygonClipping as unknown as { default?: typeof polygonClipping }).default ?? polygonClipping;

const LEVEL_TO_NUMBER: Record<TurkeyV2AdmParentLevel, number> = {
  ADM0: 0,
  ADM1: 1,
  ADM2: 2
};

const GEOGRAPHIC_IOU_EQUIVALENCE_THRESHOLD = 0.9999;
const GEOGRAPHIC_RELATIVE_AREA_TOLERANCE = 1e-6;

export interface TurkeyGeoBoundariesFullBuilderReplayOptions {
  parentDatasetPath: string;
  sourceLockPath: string;
  geoBoundariesCacheRoot: string;
  outputReportDir: string;
  replayOutputRoot?: string;
  buildDate?: string;
  cacheDir?: string;
  cwd?: string;
  skipGeographicEquivalence?: boolean;
  skipSecondDeterminismRun?: boolean;
}

export interface TurkeyGeoBoundariesFullBuilderReplayResult {
  schemaVersion: typeof TURKEY_GEOBOUNDARIES_FULL_BUILDER_REPLAY_SCHEMA_VERSION;
  classification: FullBuilderReplayClassification;
  pathBTechnicalRecommendation: "GO" | "PARTIAL" | "NO-GO";
  legalReviewStatus: "PENDING_REVIEW";
  migrationAuthorizationStatus: "NOT_AUTHORIZED";
  replayConfiguration: Record<string, unknown>;
  inputChecksums: Record<string, string | null>;
  replaySummary: {
    ADM0: { identityMatched: number; geometryHashMatches: number; geometryHashMismatches: number };
    ADM1: { identityMatched: number; geometryHashMatches: number; geometryHashMismatches: number };
    ADM2: { identityMatched: number; geometryHashMatches: number; geometryHashMismatches: number };
  };
  determinism: {
    firstRunDatasetSha256: string | null;
    secondRunDatasetSha256: string | null;
    byteIdentical: boolean;
    skipped: boolean;
    canonicalParentDatasetSha256?: string | null;
    note?: string;
  };
  reportPaths: Record<string, string>;
}

export function createTurkeyGeoBoundariesHistoricalCountryConfig(): TerritoryCountryDatasetConfig {
  return createPilotCountryConfig({
    datasetId: "tr",
    countryCodeAlpha2: "TR",
    countryCodeAlpha3: "TUR",
    displayName: "Turkiye",
    loaderPackageName: "@territory-kit/data-tr",
    defaultLocale: "tr",
    localTypes: {
      ADM0: ["country"],
      ADM1: ["province", "administrative-unit"],
      ADM2: ["district", "administrative-unit"]
    },
    semanticTypes: {
      ADM0: "country",
      ADM1: "province",
      ADM2: "district"
    },
    localTypeNames: {
      ADM0: "Ulke",
      ADM1: "Il",
      ADM2: "Ilce"
    }
  });
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function readZoneSourceNativeId(zone: TerritoryZone): string | null {
  const territory = zone.properties?.territory;
  if (!territory || typeof territory !== "object") {
    return null;
  }
  const source = (territory as Record<string, unknown>).source;
  if (!source || typeof source !== "object") {
    return null;
  }
  const sourceId = (source as Record<string, unknown>).sourceId;
  return typeof sourceId === "string" && sourceId.length > 0 ? sourceId : null;
}

function zonesForLevel(dataset: TerritoryDataset, level: TurkeyV2AdmParentLevel): TerritoryZone[] {
  return dataset.zones.filter((zone) => zone.level === LEVEL_TO_NUMBER[level]);
}

function indexZonesBySourceId(zones: TerritoryZone[]): Map<string, TerritoryZone> {
  const map = new Map<string, TerritoryZone>();
  for (const zone of zones) {
    const sourceId = readZoneSourceNativeId(zone);
    if (sourceId) {
      map.set(sourceId, zone);
    }
  }
  return map;
}

function countDuplicateReplaySourceIds(zones: TerritoryZone[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const zone of zones) {
    const sourceId = readZoneSourceNativeId(zone);
    if (!sourceId) {
      continue;
    }
    if (seen.has(sourceId)) {
      duplicates += 1;
    } else {
      seen.add(sourceId);
    }
  }
  return duplicates;
}

export function assessGeographicPair(
  left: TerritoryGeometry,
  right: TerritoryGeometry
): {
  equivalenceClass: GeographicEquivalenceClass;
  intersectionOverUnion: number | null;
  symmetricDifferenceAreaKm2: number | null;
  relativeAreaDifference: number | null;
  leftAreaKm2: number;
  rightAreaKm2: number;
  measurementMethod: string;
  measurementLimitations: string[];
  clippingConversionOk: boolean;
} {
  const measurementMethod =
    "EPSG:4326 polygon-clipping boolean ops; areas via computeTurkeyAdm3GeometryAreaKm2 (geodesic ring integration). IoU threshold 0.9999 with symmetric-difference area tolerance; no topological equality test.";
  const measurementLimitations = [
    "High IoU does not prove topological equivalence.",
    "Relative area similarity alone is not used for equivalence classification.",
    "Invalid or non-area geometries yield NOT_ASSESSABLE."
  ];
  const leftHash = auditGeometryHash(left);
  const rightHash = auditGeometryHash(right);
  const leftAreaKm2 = computeTurkeyAdm3GeometryAreaKm2(left);
  const rightAreaKm2 = computeTurkeyAdm3GeometryAreaKm2(right);
  if (leftHash === rightHash) {
    return {
      equivalenceClass: "SERIALIZED_IDENTICAL",
      intersectionOverUnion: 1,
      symmetricDifferenceAreaKm2: 0,
      relativeAreaDifference: 0,
      leftAreaKm2,
      rightAreaKm2,
      measurementMethod,
      measurementLimitations,
      clippingConversionOk: true
    };
  }

  const leftClip = geometryToClippingMultiPolygon(left);
  const rightClip = geometryToClippingMultiPolygon(right);
  if (leftClip.length === 0 || rightClip.length === 0) {
    return {
      equivalenceClass: "NOT_ASSESSABLE",
      intersectionOverUnion: null,
      symmetricDifferenceAreaKm2: null,
      relativeAreaDifference: null,
      leftAreaKm2,
      rightAreaKm2,
      measurementMethod,
      measurementLimitations: [
        ...measurementLimitations,
        "Clipping conversion produced no valid polygon rings (check coordinate dimensionality)."
      ],
      clippingConversionOk: false
    };
  }

  try {
    const intersection = CLIPPER.intersection(leftClip, rightClip) as ClippingMultiPolygon;
    const union = CLIPPER.union(leftClip, rightClip) as ClippingMultiPolygon;
    const intersectionGeom = clippingMultiPolygonToTerritoryGeometry(intersection);
    const unionGeom = clippingMultiPolygonToTerritoryGeometry(union);
    const symDiffGeom = clippingMultiPolygonToTerritoryGeometry(
      CLIPPER.difference(union, intersection) as ClippingMultiPolygon
    );
    const intersectionAreaKm2 = intersectionGeom
      ? computeTurkeyAdm3GeometryAreaKm2(intersectionGeom)
      : 0;
    const unionAreaKm2 = unionGeom ? computeTurkeyAdm3GeometryAreaKm2(unionGeom) : 0;
    const symDiffKm2 = symDiffGeom ? computeTurkeyAdm3GeometryAreaKm2(symDiffGeom) : 0;
    const iou = unionAreaKm2 > 0 ? intersectionAreaKm2 / unionAreaKm2 : 0;
    const maxArea = Math.max(leftAreaKm2, rightAreaKm2, 1e-12);
    const relativeAreaDifference = Math.abs(leftAreaKm2 - rightAreaKm2) / maxArea;

    let equivalenceClass: GeographicEquivalenceClass = "MATERIALLY_DIFFERENT";
    if (iou >= GEOGRAPHIC_IOU_EQUIVALENCE_THRESHOLD && symDiffKm2 <= AREA_TOLERANCE_KM2(maxArea)) {
      equivalenceClass = "GEOGRAPHICALLY_EQUIVALENT_WITHIN_TOLERANCE";
    }

    return {
      equivalenceClass,
      intersectionOverUnion: iou,
      symmetricDifferenceAreaKm2: symDiffKm2,
      relativeAreaDifference,
      leftAreaKm2,
      rightAreaKm2,
      measurementMethod,
      measurementLimitations,
      clippingConversionOk: true
    };
  } catch {
    return {
      equivalenceClass: "NOT_ASSESSABLE",
      intersectionOverUnion: null,
      symmetricDifferenceAreaKm2: null,
      relativeAreaDifference: null,
      leftAreaKm2,
      rightAreaKm2,
      measurementMethod,
      measurementLimitations: [...measurementLimitations, "polygon-clipping operation failed."],
      clippingConversionOk: true
    };
  }
}

function AREA_TOLERANCE_KM2(featureAreaKm2: number): number {
  return Math.max(0.000001, featureAreaKm2 * GEOGRAPHIC_RELATIVE_AREA_TOLERANCE);
}

export function assessMismatchRootCause(input: {
  firstObservedHashMismatchStage: GeometryPipelineStage;
  geographic: GeographicEquivalenceClass;
  parsedMatchesCanonical: boolean;
  adapterMatchesCanonical: boolean;
  repairMatchesCanonical: boolean;
  builderMatchesCanonical: boolean;
  replayPipelineSelfConsistent: boolean;
  missingReplayZone: boolean;
}): MismatchRootCauseAssessment {
  if (input.builderMatchesCanonical || input.missingReplayZone) {
    return {
      firstObservedHashMismatchStage: input.firstObservedHashMismatchStage,
      confirmedRootCause: input.missingReplayZone ? "missing-evidence" : null,
      probableExplanation: null,
      unresolvedReason: input.missingReplayZone
        ? "Canonical zone had no replay counterpart for geometry comparison."
        : null,
      evidenceTier: input.missingReplayZone ? "confirmed" : "unresolved"
    };
  }

  if (!input.adapterMatchesCanonical && input.repairMatchesCanonical) {
    return {
      firstObservedHashMismatchStage: input.firstObservedHashMismatchStage,
      confirmedRootCause: "polygon-multipolygon-representation",
      probableExplanation: null,
      unresolvedReason: null,
      evidenceTier: "confirmed"
    };
  }

  if (!input.repairMatchesCanonical && input.builderMatchesCanonical) {
    return {
      firstObservedHashMismatchStage: input.firstObservedHashMismatchStage,
      confirmedRootCause: "geometry-normalization",
      probableExplanation: null,
      unresolvedReason: null,
      evidenceTier: "confirmed"
    };
  }

  if (input.geographic === "MATERIALLY_DIFFERENT") {
    return {
      firstObservedHashMismatchStage: input.firstObservedHashMismatchStage,
      confirmedRootCause: "genuine-geographic-boundary-difference",
      probableExplanation: null,
      unresolvedReason: null,
      evidenceTier: "confirmed"
    };
  }

  if (
    input.firstObservedHashMismatchStage === "geometry-repair" &&
    input.replayPipelineSelfConsistent &&
    !input.repairMatchesCanonical
  ) {
    return {
      firstObservedHashMismatchStage: input.firstObservedHashMismatchStage,
      confirmedRootCause: "geometry-repair",
      probableExplanation: null,
      unresolvedReason: null,
      evidenceTier: "confirmed"
    };
  }

  if (
    input.geographic === "GEOGRAPHICALLY_EQUIVALENT_WITHIN_TOLERANCE" ||
    input.geographic === "SERIALIZED_IDENTICAL"
  ) {
    return {
      firstObservedHashMismatchStage: input.firstObservedHashMismatchStage,
      confirmedRootCause: null,
      probableExplanation:
        "Serialized audit geometry hashes differ while geographic IoU/symmetric-difference metrics remain within documented tolerance (not a topological equality proof).",
      unresolvedReason:
        "Cannot confirm ring winding, repair-engine drift, or other historical pipeline causes without additional controlled evidence.",
      evidenceTier: "probable"
    };
  }

  if (!input.parsedMatchesCanonical && input.replayPipelineSelfConsistent) {
    return {
      firstObservedHashMismatchStage: input.firstObservedHashMismatchStage,
      confirmedRootCause: null,
      probableExplanation:
        "Pinned upstream bytes match the lock, but canonical serialized geometry differs from the current pipeline output at the earliest observed stage.",
      unresolvedReason:
        "Historical repair/runtime versions (e.g. GEOS/Shapely) were not reproduced; no A/B evidence pins dependency drift as the cause.",
      evidenceTier: "unresolved"
    };
  }

  if (!input.parsedMatchesCanonical) {
    return {
      firstObservedHashMismatchStage: input.firstObservedHashMismatchStage,
      confirmedRootCause: "source-input-mismatch",
      probableExplanation: null,
      unresolvedReason: null,
      evidenceTier: "confirmed"
    };
  }

  return {
    firstObservedHashMismatchStage: input.firstObservedHashMismatchStage,
    confirmedRootCause: null,
    probableExplanation: null,
    unresolvedReason: "Insufficient evidence to confirm a single root-cause category.",
    evidenceTier: "unresolved"
  };
}

export function findFirstObservedHashMismatchStage(
  stageHashes: Record<GeometryPipelineStage, string>,
  canonicalHash: string
): GeometryPipelineStage {
  const order: GeometryPipelineStage[] = [
    "parsed-upstream",
    "adapter-output",
    "geometry-repair",
    "country-builder-output",
    "serialized-final",
    "canonical-parent"
  ];
  for (const stage of order) {
    if (stage === "canonical-parent") {
      continue;
    }
    if (stageHashes[stage] !== canonicalHash) {
      return stage;
    }
  }
  return "canonical-parent";
}

export function validateReplayCoverageGate(input: {
  replaySummary: TurkeyGeoBoundariesFullBuilderReplayResult["replaySummary"];
  canonicalParentZoneCount: number;
  replayParentZoneCount: number;
  missingReplayZones: number;
  missingCanonicalSourceIds: number;
  duplicateReplaySourceNativeIds: number;
  geometryComparisonsExpected: number;
  geometryComparisonsPerformed: number;
  geographicComparisonSkipped: boolean;
  buildDatasetAvailable: boolean;
  determinismSkipped: boolean;
  determinismByteIdentical: boolean;
  allBytesVerified: boolean;
}): ReplayCoverageGate {
  const issues: string[] = [];
  const expectedParentZoneCount =
    TURKEY_PARENT_INVENTORY_EXPECTED.ADM0 +
    TURKEY_PARENT_INVENTORY_EXPECTED.ADM1 +
    TURKEY_PARENT_INVENTORY_EXPECTED.ADM2;

  for (const level of TURKEY_V2_ADM_PARENT_LEVELS) {
    const expected = TURKEY_PARENT_INVENTORY_EXPECTED[level];
    const matched = input.replaySummary[level].identityMatched;
    if (matched !== expected) {
      issues.push(`${level}: identityMatched ${matched} != expected ${expected}`);
    }
  }

  if (input.canonicalParentZoneCount !== expectedParentZoneCount) {
    issues.push(
      `canonical parent zone count ${input.canonicalParentZoneCount} != expected ${expectedParentZoneCount}`
    );
  }
  if (input.replayParentZoneCount !== expectedParentZoneCount) {
    issues.push(
      `replay parent zone count ${input.replayParentZoneCount} != expected ${expectedParentZoneCount}`
    );
  }
  if (input.missingReplayZones > 0) {
    issues.push(`missing replay zones for ${input.missingReplayZones} canonical source IDs`);
  }
  if (input.missingCanonicalSourceIds > 0) {
    issues.push(`replay zones without canonical parent: ${input.missingCanonicalSourceIds}`);
  }
  if (input.duplicateReplaySourceNativeIds > 0) {
    issues.push(`duplicate replay source-native IDs: ${input.duplicateReplaySourceNativeIds}`);
  }
  if (!input.buildDatasetAvailable) {
    issues.push("buildTerritoryCountryDataset did not produce combinedDataset zones");
  }
  if (!input.allBytesVerified) {
    issues.push("geoBoundaries source bytes were not fully verified");
  }
  if (input.geographicComparisonSkipped) {
    issues.push("geographic equivalence analysis was skipped");
  } else if (input.geometryComparisonsPerformed !== input.geometryComparisonsExpected) {
    issues.push(
      `geographic comparisons performed ${input.geometryComparisonsPerformed} != expected mismatches ${input.geometryComparisonsExpected}`
    );
  }
  if (input.geometryComparisonsExpected > 0 && input.geometryComparisonsPerformed === 0) {
    issues.push("geometry hash mismatches exist but no geographic comparisons were recorded");
  }
  if (input.determinismSkipped) {
    issues.push("determinism second run was skipped");
  } else if (!input.determinismByteIdentical) {
    issues.push("determinism check failed: replay runs were not byte-identical");
  }

  return {
    complete: issues.length === 0,
    issues,
    expectedParentZoneCount,
    canonicalParentZoneCount: input.canonicalParentZoneCount,
    replayParentZoneCount: input.replayParentZoneCount,
    missingReplayZones: input.missingReplayZones,
    missingCanonicalSourceIds: input.missingCanonicalSourceIds,
    duplicateReplaySourceNativeIds: input.duplicateReplaySourceNativeIds,
    geometryComparisonsExpected: input.geometryComparisonsExpected,
    geometryComparisonsPerformed: input.geometryComparisonsPerformed,
    geographicComparisonSkipped: input.geographicComparisonSkipped,
    buildDatasetAvailable: input.buildDatasetAvailable,
    determinismSkipped: input.determinismSkipped,
    determinismByteIdentical: input.determinismByteIdentical
  };
}

export async function runTurkeyGeoBoundariesFullBuilderReplay(
  options: TurkeyGeoBoundariesFullBuilderReplayOptions
): Promise<TurkeyGeoBoundariesFullBuilderReplayResult> {
  const cwd = options.cwd ?? process.cwd();
  const parentDatasetPath = path.resolve(cwd, options.parentDatasetPath);
  const sourceLockPath = path.resolve(cwd, options.sourceLockPath);
  const geoBoundariesCacheRoot = path.resolve(cwd, options.geoBoundariesCacheRoot);
  const outputReportDir = path.resolve(cwd, options.outputReportDir);
  const cacheDir = options.cacheDir ?? path.join(cwd, ".territory/cache/sources");

  let parentDatasetSha256: string | null = null;
  let sourceLockSha256: string | null = null;
  try {
    await stat(parentDatasetPath);
    await stat(sourceLockPath);
    parentDatasetSha256 = await sha256File(parentDatasetPath);
    sourceLockSha256 = await sha256File(sourceLockPath);
  } catch {
    await mkdir(outputReportDir, { recursive: true });
    const blocked = buildBlockedResult({
      outputReportDir,
      parentDatasetPath,
      sourceLockPath,
      parentDatasetSha256,
      sourceLockSha256,
      reason: "canonical-parent-or-source-lock-missing"
    });
    await writeReplayReports(blocked, outputReportDir, cwd);
    return blocked;
  }

  const canonical = JSON.parse(await readFile(parentDatasetPath, "utf8")) as TerritoryDataset;
  const buildDate =
    options.buildDate ??
    (typeof canonical.manifest?.buildDate === "string"
      ? canonical.manifest.buildDate
      : undefined) ??
    "2026-07-15T11:34:06.314Z";
  const historicalConfig = createTurkeyGeoBoundariesHistoricalCountryConfig();
  const gbLock = await loadTurkeyGeoBoundariesSourceLock(sourceLockPath);
  const sourceLock = JSON.parse(
    await readFile(sourceLockPath, "utf8")
  ) as TerritoryCountrySourceLock;

  const byteVerification = [];
  const artifactPaths: Partial<Record<TurkeyV2AdmParentLevel, string>> = {};
  for (const level of TURKEY_V2_ADM_PARENT_LEVELS) {
    const expectedSha256 = gbLock.levels[level]?.sha256 ?? null;
    if (!expectedSha256) {
      byteVerification.push({ level, status: "EXPECTED_HASH_MISSING" });
      continue;
    }
    const located = await findGeoBoundariesArtifactBySha256(geoBoundariesCacheRoot, expectedSha256);
    if (!located) {
      byteVerification.push({ level, status: "ARTIFACT_NOT_AVAILABLE", expectedSha256 });
      continue;
    }
    const verified = await verifyGeoBoundariesSourceArtifactBytes({
      adminLevel: level,
      artifactPath: located.artifactPath,
      expectedSha256
    });
    byteVerification.push({ level, status: verified.status, expectedSha256 });
    if (verified.status === "LOCKED_BYTES_VERIFIED") {
      artifactPaths[level] = located.artifactPath;
    }
  }

  const allBytesVerified = byteVerification.every(
    (entry) => entry.status === "LOCKED_BYTES_VERIFIED"
  );
  if (!allBytesVerified) {
    const blocked = buildBlockedResult({
      outputReportDir,
      parentDatasetPath,
      sourceLockPath,
      parentDatasetSha256,
      sourceLockSha256,
      buildDate,
      reason: "geoboundaries-source-artifacts-unavailable-or-checksum-mismatch",
      byteVerification
    });
    await mkdir(outputReportDir, { recursive: true });
    await writeReplayReports(blocked, outputReportDir, cwd);
    return blocked;
  }

  const replayRoot =
    options.replayOutputRoot ?? (await mkdtemp(path.join(tmpdir(), "territorykit-tr-gb-replay-")));
  const firstRunDir = path.join(replayRoot, "run-1");
  const secondRunDir = path.join(replayRoot, "run-2");
  await mkdir(firstRunDir, { recursive: true });

  const buildCommon = {
    country: "TR",
    sourceLock,
    countryConfig: historicalConfig,
    levels: TURKEY_V2_ADM_PARENT_LEVELS,
    buildDate,
    cacheDir,
    allowNonPublishReady: true,
    force: true,
    cwd
  };

  const firstBuild = await buildTerritoryCountryDataset({
    ...buildCommon,
    outputPath: firstRunDir
  });

  const replayCombinedDataset = firstBuild.combinedDataset;
  if (!replayCombinedDataset?.zones?.length) {
    const blocked = buildBlockedResult({
      outputReportDir,
      parentDatasetPath,
      sourceLockPath,
      parentDatasetSha256,
      sourceLockSha256,
      buildDate,
      reason: "country-builder-replay-produced-no-combined-dataset"
    });
    await mkdir(outputReportDir, { recursive: true });
    await writeReplayReports(blocked, outputReportDir, cwd);
    return blocked;
  }

  let secondDatasetSha256: string | null = null;
  const determinismSkipped = Boolean(options.skipSecondDeterminismRun);
  let firstDatasetSha256: string;
  try {
    firstDatasetSha256 = await sha256File(path.join(firstRunDir, "dataset.json"));
  } catch {
    const blocked = buildBlockedResult({
      outputReportDir,
      parentDatasetPath,
      sourceLockPath,
      parentDatasetSha256,
      sourceLockSha256,
      buildDate,
      reason: "replay-dataset-json-missing-after-build"
    });
    await mkdir(outputReportDir, { recursive: true });
    await writeReplayReports(blocked, outputReportDir, cwd);
    return blocked;
  }

  if (!options.skipSecondDeterminismRun) {
    await mkdir(secondRunDir, { recursive: true });
    const secondBuild = await buildTerritoryCountryDataset({
      ...buildCommon,
      outputPath: secondRunDir
    });
    if (!secondBuild.combinedDataset?.zones?.length) {
      const blocked = buildBlockedResult({
        outputReportDir,
        parentDatasetPath,
        sourceLockPath,
        parentDatasetSha256,
        sourceLockSha256,
        buildDate,
        reason: "country-builder-determinism-run-produced-no-combined-dataset"
      });
      await mkdir(outputReportDir, { recursive: true });
      await writeReplayReports(blocked, outputReportDir, cwd);
      return blocked;
    }
    try {
      secondDatasetSha256 = await sha256File(path.join(secondRunDir, "dataset.json"));
    } catch {
      const blocked = buildBlockedResult({
        outputReportDir,
        parentDatasetPath,
        sourceLockPath,
        parentDatasetSha256,
        sourceLockSha256,
        buildDate,
        reason: "replay-determinism-dataset-json-missing"
      });
      await mkdir(outputReportDir, { recursive: true });
      await writeReplayReports(blocked, outputReportDir, cwd);
      return blocked;
    }
  }

  const replaySummary = {
    ADM0: { identityMatched: 0, geometryHashMatches: 0, geometryHashMismatches: 0 },
    ADM1: { identityMatched: 0, geometryHashMatches: 0, geometryHashMismatches: 0 },
    ADM2: { identityMatched: 0, geometryHashMatches: 0, geometryHashMismatches: 0 }
  };

  const geometryDifferences: Array<Record<string, unknown>> = [];
  const geographicEquivalence: Array<Record<string, unknown>> = [];
  const stableIdComparison: Array<Record<string, unknown>> = [];
  let missingReplayZones = 0;
  let missingCanonicalSourceIds = 0;
  const geographicComparisonSkipped = Boolean(options.skipGeographicEquivalence);

  const canonicalParentZones = TURKEY_V2_ADM_PARENT_LEVELS.flatMap((level) =>
    zonesForLevel(canonical, level)
  );
  const replayParentZones = TURKEY_V2_ADM_PARENT_LEVELS.flatMap((level) =>
    zonesForLevel(replayCombinedDataset, level)
  );
  const duplicateReplaySourceNativeIds = TURKEY_V2_ADM_PARENT_LEVELS.reduce(
    (sum, level) =>
      sum + countDuplicateReplaySourceIds(zonesForLevel(replayCombinedDataset, level)),
    0
  );

  for (const level of TURKEY_V2_ADM_PARENT_LEVELS) {
    const canonicalZones = zonesForLevel(canonical, level);
    const replayZones = zonesForLevel(replayCombinedDataset, level);
    const replayBySource = indexZonesBySourceId(replayZones);
    const artifactPath = artifactPaths[level]!;
    const collection = JSON.parse(await readFile(artifactPath, "utf8")) as unknown;
    const parseReport = analyzeGeoBoundariesFeatureCollection(collection);
    const sourceById = new Map(parseReport.features.map((feature) => [feature.shapeId, feature]));
    const adapterFeatures = parseTerritoryCountrySourceFeatures(collection, {
      config: historicalConfig,
      level
    });
    const adapterBySourceId = new Map(
      adapterFeatures.flatMap((feature) =>
        feature.sourceId ? [[feature.sourceId, feature] as const] : []
      )
    );
    const repairReport = await repairTerritoryGeometries(
      adapterFeatures.map((feature, index) => ({
        id: String(index),
        geometry: feature.geometry
      }))
    );
    const repairedBySourceId = new Map<string, TerritoryGeometry>();
    adapterFeatures.forEach((feature, index) => {
      const repaired = repairReport.results[index]?.geometry;
      if (feature.sourceId && repaired) {
        repairedBySourceId.set(feature.sourceId, repaired);
      }
    });

    for (const canonicalZone of canonicalZones) {
      const sourceNativeId = readZoneSourceNativeId(canonicalZone);
      if (!sourceNativeId) {
        continue;
      }
      replaySummary[level].identityMatched += 1;
      const replayZone = replayBySource.get(sourceNativeId);
      if (!replayZone) {
        missingReplayZones += 1;
      }
      const canonicalHash = auditGeometryHash(canonicalZone.geometry);
      const replayHash = replayZone ? auditGeometryHash(replayZone.geometry) : null;
      const parsedFeature = sourceById.get(sourceNativeId);
      const adapterFeature = adapterBySourceId.get(sourceNativeId);
      const repairedGeometry = repairedBySourceId.get(sourceNativeId);

      const stageHashes: Record<GeometryPipelineStage, string> = {
        "parsed-upstream": parsedFeature ? auditGeometryHash(parsedFeature.geometry) : "missing",
        "adapter-output": adapterFeature ? auditGeometryHash(adapterFeature.geometry) : "missing",
        "geometry-repair": repairedGeometry ? auditGeometryHash(repairedGeometry) : "missing",
        "country-builder-output": replayHash ?? "missing",
        "serialized-final": replayHash ?? "missing",
        "canonical-parent": canonicalHash
      };

      const parsedMatchesCanonical = stageHashes["parsed-upstream"] === canonicalHash;
      const adapterMatchesCanonical = stageHashes["adapter-output"] === canonicalHash;
      const repairMatchesCanonical = stageHashes["geometry-repair"] === canonicalHash;
      const builderMatchesCanonical = replayHash === canonicalHash;

      if (builderMatchesCanonical) {
        replaySummary[level].geometryHashMatches += 1;
      } else {
        replaySummary[level].geometryHashMismatches += 1;
      }

      const territoryIdMatch = replayZone?.id === canonicalZone.id;
      stableIdComparison.push({
        adminLevel: level,
        territoryId: canonicalZone.id,
        sourceNativeId,
        canonicalTerritoryId: canonicalZone.id,
        replayTerritoryId: replayZone?.id ?? null,
        territoryIdMatch,
        canonicalParentId: canonicalZone.parentId ?? null,
        replayParentId: replayZone?.parentId ?? null,
        parentIdMatch: (canonicalZone.parentId ?? null) === (replayZone?.parentId ?? null)
      });

      if (!builderMatchesCanonical) {
        const firstObservedHashMismatchStage = findFirstObservedHashMismatchStage(
          stageHashes,
          canonicalHash
        );
        const geo =
          replayZone && !geographicComparisonSkipped
            ? assessGeographicPair(canonicalZone.geometry, replayZone.geometry)
            : {
                equivalenceClass: "NOT_ASSESSABLE" as GeographicEquivalenceClass,
                intersectionOverUnion: null,
                symmetricDifferenceAreaKm2: null,
                relativeAreaDifference: null,
                leftAreaKm2: computeTurkeyAdm3GeometryAreaKm2(canonicalZone.geometry),
                rightAreaKm2: replayZone
                  ? computeTurkeyAdm3GeometryAreaKm2(replayZone.geometry)
                  : 0,
                measurementMethod: "skipped",
                measurementLimitations: [
                  "Geographic equivalence analysis skipped or replay zone missing."
                ],
                clippingConversionOk: false
              };
        const replayPipelineSelfConsistent =
          stageHashes["geometry-repair"] === stageHashes["country-builder-output"] &&
          stageHashes["adapter-output"] === stageHashes["parsed-upstream"];
        const rootCauseAssessment = assessMismatchRootCause({
          firstObservedHashMismatchStage,
          geographic: geo.equivalenceClass,
          parsedMatchesCanonical,
          adapterMatchesCanonical,
          repairMatchesCanonical,
          builderMatchesCanonical,
          replayPipelineSelfConsistent,
          missingReplayZone: !replayZone
        });
        geometryDifferences.push({
          adminLevel: level,
          territoryId: canonicalZone.id,
          sourceShapeId: sourceNativeId,
          canonicalGeometryHash: canonicalHash,
          replayGeometryHash: replayHash,
          stageGeometryHashes: stageHashes,
          firstObservedHashMismatchStage,
          rootCauseAssessment,
          confirmedRootCause: rootCauseAssessment.confirmedRootCause,
          probableExplanation: rootCauseAssessment.probableExplanation,
          unresolvedReason: rootCauseAssessment.unresolvedReason,
          rootCauseEvidenceTier: rootCauseAssessment.evidenceTier,
          supportingEvidence: {
            parsedMatchesCanonical,
            adapterMatchesCanonical,
            repairMatchesCanonical,
            builderMatchesCanonical,
            replayPipelineSelfConsistent,
            repairEngine: repairReport.engine,
            repairEngineVersion: repairReport.engineVersion,
            repairMode: repairReport.mode,
            stageMismatchNote:
              "firstObservedHashMismatchStage is the earliest stage whose audit hash differs from canonical; it is not proof of where the transformation error originated."
          },
          geographicEquivalenceAssessment: geo.equivalenceClass,
          confidence:
            rootCauseAssessment.evidenceTier === "confirmed"
              ? "high"
              : rootCauseAssessment.evidenceTier === "probable"
                ? "medium"
                : "low",
          remainingUncertainty: rootCauseAssessment.unresolvedReason
        });
        if (!geographicComparisonSkipped && replayZone) {
          geographicEquivalence.push({
            adminLevel: level,
            territoryId: canonicalZone.id,
            sourceShapeId: sourceNativeId,
            ...geo,
            crs: "EPSG:4326"
          });
        }
      }
    }

    const canonicalSourceIds = new Set(
      canonicalZones
        .map((zone) => readZoneSourceNativeId(zone))
        .filter((value): value is string => Boolean(value))
    );
    for (const replayZone of replayZones) {
      const sourceId = readZoneSourceNativeId(replayZone);
      if (sourceId && !canonicalSourceIds.has(sourceId)) {
        missingCanonicalSourceIds += 1;
      }
    }
  }

  const determinismByteIdentical =
    firstDatasetSha256 !== null &&
    secondDatasetSha256 !== null &&
    firstDatasetSha256 === secondDatasetSha256;

  const coverageGate = validateReplayCoverageGate({
    replaySummary,
    canonicalParentZoneCount: canonicalParentZones.length,
    replayParentZoneCount: replayParentZones.length,
    missingReplayZones,
    missingCanonicalSourceIds,
    duplicateReplaySourceNativeIds,
    geometryComparisonsExpected:
      replaySummary.ADM0.geometryHashMismatches +
      replaySummary.ADM1.geometryHashMismatches +
      replaySummary.ADM2.geometryHashMismatches,
    geometryComparisonsPerformed: geographicEquivalence.length,
    geographicComparisonSkipped,
    buildDatasetAvailable: true,
    determinismSkipped,
    determinismByteIdentical,
    allBytesVerified
  });

  const classification = classifyFullBuilderReplay({
    replaySummary,
    geometryDifferenceCount: geometryDifferences.length,
    coverageGate,
    geographicEquivalence
  });

  const replayConfiguration = {
    countryBuilderEntrypoint: "buildTerritoryCountryDataset",
    countryConfig:
      "createTurkeyGeoBoundariesHistoricalCountryConfig (pilot geoBoundaries shapeID/shapeName; not current HDX tr.ts field map)",
    levels: TURKEY_V2_ADM_PARENT_LEVELS,
    buildDate,
    geoBoundariesGitReleaseCommit: TURKEY_GEOBOUNDARIES_GIT_RELEASE_COMMIT,
    sourceLockPath: path.relative(cwd, sourceLockPath),
    parentDatasetPath: path.relative(cwd, parentDatasetPath),
    cacheDir: path.relative(cwd, cacheDir),
    simplificationPhase:
      "source-geometry (no topology-safe tier simplification for country artifacts)",
    geometryRepair: "repairTerritoryGeometries (same as country builder)",
    hierarchy: "resolveTerritoryCountryHierarchy + attachChildIds",
    outputIsolation: path.relative(cwd, replayRoot)
  };

  const result: TurkeyGeoBoundariesFullBuilderReplayResult = {
    schemaVersion: TURKEY_GEOBOUNDARIES_FULL_BUILDER_REPLAY_SCHEMA_VERSION,
    classification,
    pathBTechnicalRecommendation:
      classification === "FULL_REPLAY_VERIFIED"
        ? "PARTIAL"
        : classification === "GEOGRAPHICALLY_EQUIVALENT_WITH_DIFFERENCES"
          ? "PARTIAL"
          : classification === "BLOCKED_BY_MISSING_EVIDENCE"
            ? "NO-GO"
            : "PARTIAL",
    legalReviewStatus: "PENDING_REVIEW",
    migrationAuthorizationStatus: "NOT_AUTHORIZED",
    replayConfiguration,
    inputChecksums: {
      canonicalParentDatasetSha256: parentDatasetSha256,
      sourcesLockSha256: sourceLockSha256,
      geoBoundariesGitReleaseCommit: TURKEY_GEOBOUNDARIES_GIT_RELEASE_COMMIT
    },
    replaySummary,
    determinism: {
      firstRunDatasetSha256: firstDatasetSha256,
      secondRunDatasetSha256: secondDatasetSha256,
      byteIdentical: determinismByteIdentical,
      skipped: determinismSkipped,
      canonicalParentDatasetSha256: parentDatasetSha256,
      note: "Replay dataset.json SHA-256 is not expected to equal canonical parent dataset SHA-256; compare only across replay runs for determinism."
    },
    reportPaths: {}
  };

  await mkdir(outputReportDir, { recursive: true });
  await writeReplayReports(result, outputReportDir, cwd, {
    replayInputs: {
      parentDatasetPath: path.relative(cwd, parentDatasetPath),
      sourceLockPath: path.relative(cwd, sourceLockPath),
      geoBoundariesCacheRoot: path.relative(cwd, geoBoundariesCacheRoot),
      byteVerification,
      canonicalDatasetVersion: canonical.manifest?.datasetVersion ?? null,
      canonicalFeatureCounts: TURKEY_PARENT_INVENTORY_EXPECTED
    },
    transformationStages: {
      pipeline: [
        "acquireBoundarySourceArtifact (SHA-256 pinned)",
        "parseTerritoryCountrySourceFeatures",
        "repairTerritoryGeometries",
        "buildLevelZones + createTerritoryCountryIdentity",
        "resolveTerritoryCountryHierarchy",
        "createCombinedDataset / serialization"
      ],
      stageLabels: [
        "parsed-upstream",
        "adapter-output",
        "geometry-repair",
        "country-builder-output",
        "serialized-final",
        "canonical-parent"
      ],
      stageSemantics:
        "firstObservedHashMismatchStage reports the earliest stage whose audit hash differs from canonical; it does not prove causal origin of divergence.",
      coverageGate
    },
    geometryDifferences,
    geographicEquivalence,
    stableIdComparison,
    determinismReport: result.determinism,
    downstreamImpactMarkdown: renderDownstreamImpactMarkdown(),
    replayConclusionMarkdown: renderReplayConclusionMarkdown(result, geometryDifferences.length)
  });

  if (!options.replayOutputRoot) {
    await rm(replayRoot, { recursive: true, force: true });
  }

  return result;
}

export function classifyFullBuilderReplay(input: {
  replaySummary: TurkeyGeoBoundariesFullBuilderReplayResult["replaySummary"];
  geometryDifferenceCount: number;
  coverageGate: ReplayCoverageGate;
  geographicEquivalence: Array<Record<string, unknown>>;
}): FullBuilderReplayClassification {
  if (!input.coverageGate.buildDatasetAvailable || !input.coverageGate.complete) {
    return "BLOCKED_BY_MISSING_EVIDENCE";
  }
  const totalExpected = input.coverageGate.expectedParentZoneCount;
  const totalMatches =
    input.replaySummary.ADM0.geometryHashMatches +
    input.replaySummary.ADM1.geometryHashMatches +
    input.replaySummary.ADM2.geometryHashMatches;
  if (totalMatches === totalExpected && input.geometryDifferenceCount === 0) {
    return "FULL_REPLAY_VERIFIED";
  }
  if (input.coverageGate.geographicComparisonSkipped) {
    return input.geometryDifferenceCount > 0 ? "PARTIALLY_REPRODUCED" : "PARTIALLY_REPRODUCED";
  }
  if (input.geometryDifferenceCount === 0) {
    return "PARTIALLY_REPRODUCED";
  }
  if (input.geographicEquivalence.length !== input.geometryDifferenceCount) {
    return "BLOCKED_BY_MISSING_EVIDENCE";
  }
  const allGeoEquivalent = input.geographicEquivalence.every(
    (row) => row.equivalenceClass === "GEOGRAPHICALLY_EQUIVALENT_WITHIN_TOLERANCE"
  );
  if (allGeoEquivalent) {
    return "GEOGRAPHICALLY_EQUIVALENT_WITH_DIFFERENCES";
  }
  const anyMaterial = input.geographicEquivalence.some(
    (row) => row.equivalenceClass === "MATERIALLY_DIFFERENT"
  );
  if (anyMaterial) {
    return "MATERIAL_GEOMETRY_DIFFERENCES_FOUND";
  }
  return "PARTIALLY_REPRODUCED";
}

function buildBlockedResult(input: {
  outputReportDir: string;
  parentDatasetPath: string;
  sourceLockPath: string;
  parentDatasetSha256?: string | null;
  sourceLockSha256?: string | null;
  buildDate?: string;
  reason: string;
  byteVerification?: Array<Record<string, unknown>>;
}): TurkeyGeoBoundariesFullBuilderReplayResult {
  return {
    schemaVersion: TURKEY_GEOBOUNDARIES_FULL_BUILDER_REPLAY_SCHEMA_VERSION,
    classification: "BLOCKED_BY_MISSING_EVIDENCE",
    pathBTechnicalRecommendation: "NO-GO",
    legalReviewStatus: "PENDING_REVIEW",
    migrationAuthorizationStatus: "NOT_AUTHORIZED",
    replayConfiguration: { blockedReason: input.reason, buildDate: input.buildDate ?? null },
    inputChecksums: {
      canonicalParentDatasetSha256: input.parentDatasetSha256 ?? null,
      sourcesLockSha256: input.sourceLockSha256 ?? null,
      geoBoundariesGitReleaseCommit: TURKEY_GEOBOUNDARIES_GIT_RELEASE_COMMIT
    },
    replaySummary: {
      ADM0: { identityMatched: 0, geometryHashMatches: 0, geometryHashMismatches: 0 },
      ADM1: { identityMatched: 0, geometryHashMatches: 0, geometryHashMismatches: 0 },
      ADM2: { identityMatched: 0, geometryHashMatches: 0, geometryHashMismatches: 0 }
    },
    determinism: {
      firstRunDatasetSha256: null,
      secondRunDatasetSha256: null,
      byteIdentical: false,
      skipped: true
    },
    reportPaths: { outputDir: input.outputReportDir }
  };
}

async function writeReplayReports(
  result: TurkeyGeoBoundariesFullBuilderReplayResult,
  outputReportDir: string,
  cwd: string,
  payloads?: {
    replayInputs?: Record<string, unknown>;
    transformationStages?: Record<string, unknown>;
    geometryDifferences?: Array<Record<string, unknown>>;
    geographicEquivalence?: Array<Record<string, unknown>>;
    stableIdComparison?: Array<Record<string, unknown>>;
    determinismReport?: Record<string, unknown>;
    downstreamImpactMarkdown?: string;
    replayConclusionMarkdown?: string;
  }
): Promise<void> {
  const writeJson = async (name: string, body: unknown) => {
    const filePath = path.join(outputReportDir, name);
    await writeFile(filePath, `${serializeJsonStable(body as Record<string, unknown>)}\n`, "utf8");
    return filePath;
  };

  const readme = `# Türkiye geoBoundaries tam ülke builder replay

Bu dizin \`pnpm data:tr:geoboundaries:parent:replay\` çıktısıdır. Büyük ulusal geometri Git dışında tutulur; kanıt özetleri JSON/Markdown olarak saklanır.

**Sınıflandırma:** \`${result.classification}\`

Path B metadata migrasyonu bu raporla **otomatik yetkilendirilmez** (\`legalReviewStatus: PENDING_REVIEW\`).
`;
  await writeFile(path.join(outputReportDir, "README.md"), `${readme}\n`, "utf8");

  if (payloads?.replayInputs) {
    await writeJson("replay-inputs.json", {
      schemaVersion: TURKEY_GEOBOUNDARIES_FULL_BUILDER_REPLAY_SCHEMA_VERSION,
      ...payloads.replayInputs,
      classification: result.classification
    });
  }
  if (payloads?.transformationStages) {
    await writeJson("transformation-stages.json", {
      schemaVersion: TURKEY_GEOBOUNDARIES_FULL_BUILDER_REPLAY_SCHEMA_VERSION,
      ...payloads.transformationStages
    });
  }
  if (payloads?.geometryDifferences) {
    await writeJson("geometry-differences.json", {
      schemaVersion: TURKEY_GEOBOUNDARIES_FULL_BUILDER_REPLAY_SCHEMA_VERSION,
      mismatchCount: payloads.geometryDifferences.length,
      mismatches: payloads.geometryDifferences
    });
  }
  if (payloads?.geographicEquivalence) {
    await writeJson("geographic-equivalence.json", {
      schemaVersion: TURKEY_GEOBOUNDARIES_FULL_BUILDER_REPLAY_SCHEMA_VERSION,
      rows: payloads.geographicEquivalence
    });
  }
  if (payloads?.stableIdComparison) {
    await writeJson("stable-id-comparison.json", {
      schemaVersion: TURKEY_GEOBOUNDARIES_FULL_BUILDER_REPLAY_SCHEMA_VERSION,
      rows: payloads.stableIdComparison
    });
  }
  if (payloads?.determinismReport) {
    await writeJson("determinism-report.json", {
      schemaVersion: TURKEY_GEOBOUNDARIES_FULL_BUILDER_REPLAY_SCHEMA_VERSION,
      ...payloads.determinismReport
    });
  }
  if (payloads?.downstreamImpactMarkdown) {
    await writeFile(
      path.join(outputReportDir, "downstream-impact.md"),
      payloads.downstreamImpactMarkdown.endsWith("\n")
        ? payloads.downstreamImpactMarkdown
        : `${payloads.downstreamImpactMarkdown}\n`,
      "utf8"
    );
  }
  if (payloads?.replayConclusionMarkdown) {
    await writeFile(
      path.join(outputReportDir, "replay-conclusion.md"),
      payloads.replayConclusionMarkdown.endsWith("\n")
        ? payloads.replayConclusionMarkdown
        : `${payloads.replayConclusionMarkdown}\n`,
      "utf8"
    );
  }

  result.reportPaths = {
    outputDir: path.relative(cwd, outputReportDir),
    readme: path.relative(cwd, path.join(outputReportDir, "README.md"))
  };
}

function renderDownstreamImpactMarkdown(): string {
  return `# Path B metadata-only downstream impact (read-only)

## ADM3 national clip

- ADM3 üretimi ebeveyn ADM2 poligonlarına göre kırpılır (\`buildTurkeyV2NationalDataset\` / hybrid clip).
- **Metadata-only Path B** (katalog/registry/source-lock metinleri) canonical ebeveyn **geometri baytlarını** değiştirmezse ADM3 clip girdisi değişmez; clip replay beklenen etki: **yok**.
- Ebeveyn geometri baytları değişirse ADM3 effective geometry, coverage ve MVT hash'leri etkilenir — bu sprint canonical baytları değiştirmedi.

## Manifest, cache ve tüketici

- \`datasets/generated/countries/TR/manifest.json\` checksum'ları geometry tier hash'lerine bağlıdır.
- Metadata-only değişiklik manifest \`sourceProvider\` / attribution alanlarını güncelleyebilir; geometry checksum'ları aynı kalırsa tüketici geometry cache'i invalidate olmayabilir — **doğrulanmadı, production öncesi rc.7 replay zorunlu**.

## Rush&Claim

- Bu sprint Rush&Claim veya hosted delivery'ye dokunmaz.

## Önkoşullar (Path B metadata GO)

1. \`legalReviewStatus: PENDING_REVIEW\` çözümü (CC BY-SA 2.0 / ODbL 1.0 / adapter CC BY 4.0 çelişkisi).
2. ADR-006 / DEC-008 onayı.
3. Tam builder replay kanıtı + ADM3 clip regression planı.
`;
}

function renderReplayConclusionMarkdown(
  result: TurkeyGeoBoundariesFullBuilderReplayResult,
  mismatchCount: number
): string {
  return `# Tam ülke builder replay sonucu

- **Sınıflandırma:** \`${result.classification}\`
- **Path B teknik öneri:** \`${result.pathBTechnicalRecommendation}\` (lisans onayı değildir)
- **Migrasyon yetkisi:** \`${result.migrationAuthorizationStatus}\`
- **Serileştirilmiş geometri uyuşmazlığı:** ${mismatchCount} bölge (kimlik eşleşen çiftler)
- **Determinizm (dataset.json SHA-256):** ${
    result.determinism.skipped
      ? "atlandı"
      : result.determinism.byteIdentical
        ? "iki koşu bayt-identical"
        : "iki koşu farklı — nondeterminism araştırılmalı"
  }

Canonical \`datasets/generated/countries/TR/dataset.json\` üzerine yazılmadı. Replay \`dataset.json\` SHA-256 canonical ile aynı olması beklenmez.

Kök neden: onaylanmış \`dependency-version\` iddiası yok; çoğu uyuşmazlık \`unresolved\` + olası açıklama (tarihsel repair/runtime kanıtı eksik). geoBoundaries ADM2 source-lock \`sourceFeatureCount: 999\` vs simplified GeoJSON 973 farkı korunur.
`;
}

export function verifyTurkeyGeoBoundariesFullBuilderReplay(
  result: TurkeyGeoBoundariesFullBuilderReplayResult,
  options: { strict?: boolean } = {}
): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (result.legalReviewStatus !== "PENDING_REVIEW") {
    issues.push("legalReviewStatus must remain PENDING_REVIEW without explicit legal approval.");
  }
  if (result.migrationAuthorizationStatus !== "NOT_AUTHORIZED") {
    issues.push("migrationAuthorizationStatus must remain NOT_AUTHORIZED in research replay.");
  }
  if (result.pathBTechnicalRecommendation === "GO") {
    issues.push(
      "pathBTechnicalRecommendation GO is forbidden in replay tooling until legalReviewStatus is APPROVED_WITH_AUTHORIZATION."
    );
  }
  if (
    result.pathBTechnicalRecommendation === "GO" &&
    result.classification !== "FULL_REPLAY_VERIFIED"
  ) {
    issues.push("pathBTechnicalRecommendation GO requires FULL_REPLAY_VERIFIED classification.");
  }
  if (
    result.classification === "FULL_REPLAY_VERIFIED" &&
    (result.replaySummary.ADM1.identityMatched !== TURKEY_PARENT_INVENTORY_EXPECTED.ADM1 ||
      result.replaySummary.ADM2.identityMatched !== TURKEY_PARENT_INVENTORY_EXPECTED.ADM2)
  ) {
    issues.push("FULL_REPLAY_VERIFIED requires complete ADM inventory coverage.");
  }
  if (options.strict && result.classification === "BLOCKED_BY_MISSING_EVIDENCE") {
    issues.push("Replay blocked by missing evidence.");
  }
  return { ok: issues.length === 0, issues };
}
