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
import { computeTurkeyAdm3GeometryAreaKm2 } from "./turkey-adm3-full-coverage.js";
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
import { serializeJsonStable, sha256Hex } from "./sources/utils.js";

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
  | "dependency-version"
  | "historical-build-configuration"
  | "source-input-mismatch"
  | "genuine-geographic-boundary-difference"
  | "missing-evidence";

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

type ClippingMultiPolygon = polygonClipping.MultiPolygon;

function geometryToClipping(geometry: TerritoryGeometry): ClippingMultiPolygon {
  if (geometry.type === "Polygon") {
    return [geometry.coordinates];
  }
  return geometry.coordinates;
}

function clippingToGeometry(geometry: ClippingMultiPolygon): TerritoryGeometry | null {
  if (geometry.length === 0) {
    return null;
  }
  if (geometry.length === 1) {
    return { type: "Polygon", coordinates: geometry[0]! };
  }
  return { type: "MultiPolygon", coordinates: geometry };
}

function assessGeographicPair(
  left: TerritoryGeometry,
  right: TerritoryGeometry
): {
  equivalenceClass: GeographicEquivalenceClass;
  intersectionOverUnion: number | null;
  symmetricDifferenceAreaKm2: number | null;
  relativeAreaDifference: number | null;
  leftAreaKm2: number;
  rightAreaKm2: number;
} {
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
      rightAreaKm2
    };
  }

  try {
    const leftClip = geometryToClipping(left);
    const rightClip = geometryToClipping(right);
    const intersection = CLIPPER.intersection(leftClip, rightClip) as ClippingMultiPolygon;
    const union = CLIPPER.union(leftClip, rightClip) as ClippingMultiPolygon;
    const intersectionGeom = clippingToGeometry(intersection);
    const unionGeom = clippingToGeometry(union);
    const symDiffGeom = clippingToGeometry(
      CLIPPER.difference(CLIPPER.union(leftClip, rightClip), intersection) as ClippingMultiPolygon
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
    } else if (iou >= 0.999 && relativeAreaDifference <= GEOGRAPHIC_RELATIVE_AREA_TOLERANCE) {
      equivalenceClass = "TOPOLOGICALLY_EQUIVALENT";
    }

    return {
      equivalenceClass,
      intersectionOverUnion: iou,
      symmetricDifferenceAreaKm2: symDiffKm2,
      relativeAreaDifference,
      leftAreaKm2,
      rightAreaKm2
    };
  } catch {
    return {
      equivalenceClass: "NOT_ASSESSABLE",
      intersectionOverUnion: null,
      symmetricDifferenceAreaKm2: null,
      relativeAreaDifference: null,
      leftAreaKm2,
      rightAreaKm2
    };
  }
}

function AREA_TOLERANCE_KM2(featureAreaKm2: number): number {
  return Math.max(0.000001, featureAreaKm2 * GEOGRAPHIC_RELATIVE_AREA_TOLERANCE);
}

function inferRootCause(input: {
  firstDivergingStage: GeometryPipelineStage;
  geographic: GeographicEquivalenceClass;
  parsedMatchesCanonical: boolean;
  adapterMatchesCanonical: boolean;
  repairMatchesCanonical: boolean;
  builderMatchesCanonical: boolean;
  replayPipelineSelfConsistent: boolean;
}): GeometryMismatchRootCause {
  if (input.builderMatchesCanonical) {
    return "missing-evidence";
  }
  if (!input.adapterMatchesCanonical && input.repairMatchesCanonical) {
    return "polygon-multipolygon-representation";
  }
  if (!input.repairMatchesCanonical && input.builderMatchesCanonical) {
    return "geometry-normalization";
  }
  if (
    input.replayPipelineSelfConsistent &&
    !input.repairMatchesCanonical &&
    input.geographic === "GEOGRAPHICALLY_EQUIVALENT_WITHIN_TOLERANCE"
  ) {
    return "dependency-version";
  }
  if (
    input.replayPipelineSelfConsistent &&
    !input.repairMatchesCanonical &&
    input.geographic === "TOPOLOGICALLY_EQUIVALENT"
  ) {
    return "geometry-repair";
  }
  if (
    !input.parsedMatchesCanonical &&
    !input.repairMatchesCanonical &&
    input.replayPipelineSelfConsistent
  ) {
    if (input.geographic === "MATERIALLY_DIFFERENT") {
      return "genuine-geographic-boundary-difference";
    }
    return "dependency-version";
  }
  if (!input.parsedMatchesCanonical) {
    return "source-input-mismatch";
  }
  if (input.firstDivergingStage === "geometry-repair") {
    return "geometry-repair";
  }
  if (input.geographic === "GEOGRAPHICALLY_EQUIVALENT_WITHIN_TOLERANCE") {
    return "ring-direction-or-start-vertex";
  }
  if (input.geographic === "MATERIALLY_DIFFERENT") {
    return "genuine-geographic-boundary-difference";
  }
  return "historical-build-configuration";
}

function findFirstDivergingStage(
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

  let secondDatasetSha256: string | null = null;
  const determinismSkipped = Boolean(options.skipSecondDeterminismRun);
  const firstDatasetSha256 = await (async () => {
    try {
      return await sha256File(path.join(firstRunDir, "dataset.json"));
    } catch {
      return sha256Hex(
        serializeJsonStable(firstBuild.combinedDataset as unknown as Record<string, unknown>)
      );
    }
  })();

  if (!options.skipSecondDeterminismRun) {
    await mkdir(secondRunDir, { recursive: true });
    await buildTerritoryCountryDataset({
      ...buildCommon,
      outputPath: secondRunDir
    });
    secondDatasetSha256 = await sha256File(path.join(secondRunDir, "dataset.json"));
  }

  const replaySummary = {
    ADM0: { identityMatched: 0, geometryHashMatches: 0, geometryHashMismatches: 0 },
    ADM1: { identityMatched: 0, geometryHashMatches: 0, geometryHashMismatches: 0 },
    ADM2: { identityMatched: 0, geometryHashMatches: 0, geometryHashMismatches: 0 }
  };

  const geometryDifferences: Array<Record<string, unknown>> = [];
  const geographicEquivalence: Array<Record<string, unknown>> = [];
  const stableIdComparison: Array<Record<string, unknown>> = [];

  for (const level of TURKEY_V2_ADM_PARENT_LEVELS) {
    const canonicalZones = zonesForLevel(canonical, level);
    const replayZones = zonesForLevel(firstBuild.combinedDataset, level);
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
        const firstDivergingStage = findFirstDivergingStage(stageHashes, canonicalHash);
        const geo =
          replayZone && !options.skipGeographicEquivalence
            ? assessGeographicPair(canonicalZone.geometry, replayZone.geometry)
            : {
                equivalenceClass: "NOT_ASSESSABLE" as GeographicEquivalenceClass,
                intersectionOverUnion: null,
                symmetricDifferenceAreaKm2: null,
                relativeAreaDifference: null,
                leftAreaKm2: computeTurkeyAdm3GeometryAreaKm2(canonicalZone.geometry),
                rightAreaKm2: replayZone ? computeTurkeyAdm3GeometryAreaKm2(replayZone.geometry) : 0
              };
        const replayPipelineSelfConsistent =
          stageHashes["geometry-repair"] === stageHashes["country-builder-output"] &&
          stageHashes["adapter-output"] === stageHashes["parsed-upstream"];
        const rootCause = inferRootCause({
          firstDivergingStage,
          geographic: geo.equivalenceClass,
          parsedMatchesCanonical,
          adapterMatchesCanonical,
          repairMatchesCanonical,
          builderMatchesCanonical,
          replayPipelineSelfConsistent
        });
        geometryDifferences.push({
          adminLevel: level,
          territoryId: canonicalZone.id,
          sourceShapeId: sourceNativeId,
          canonicalGeometryHash: canonicalHash,
          replayGeometryHash: replayHash,
          stageGeometryHashes: stageHashes,
          firstDivergingPipelineStage: firstDivergingStage,
          rootCauseCategory: rootCause,
          supportingEvidence: {
            parsedMatchesCanonical,
            adapterMatchesCanonical,
            repairMatchesCanonical,
            builderMatchesCanonical,
            replayPipelineSelfConsistent,
            repairEngine: repairReport.engine,
            repairEngineVersion: repairReport.engineVersion,
            repairMode: repairReport.mode
          },
          geographicEquivalenceAssessment: geo.equivalenceClass,
          confidence:
            geo.equivalenceClass === "NOT_ASSESSABLE"
              ? "low"
              : geo.equivalenceClass === "MATERIALLY_DIFFERENT"
                ? "high"
                : "medium",
          remainingUncertainty:
            geo.equivalenceClass === "GEOGRAPHICALLY_EQUIVALENT_WITHIN_TOLERANCE"
              ? "Serialized bytes differ; geographic equivalence within IoU tolerance only."
              : null
        });
        geographicEquivalence.push({
          adminLevel: level,
          territoryId: canonicalZone.id,
          sourceShapeId: sourceNativeId,
          ...geo,
          crs: "EPSG:4326",
          measurementNote:
            "Areas and IoU from geodesic-ish km² helper (computeTurkeyAdm3GeometryAreaKm2) and polygon-clipping boolean ops in WGS84 coordinates."
        });
      }
    }
  }

  const classification = classifyFullBuilderReplay({
    replaySummary,
    geometryDifferenceCount: geometryDifferences.length,
    allBytesVerified,
    replayZoneCount: firstBuild.combinedDataset.zones.length,
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
      byteIdentical:
        firstDatasetSha256 !== null &&
        secondDatasetSha256 !== null &&
        firstDatasetSha256 === secondDatasetSha256,
      skipped: determinismSkipped
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
      ]
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

function classifyFullBuilderReplay(input: {
  replaySummary: TurkeyGeoBoundariesFullBuilderReplayResult["replaySummary"];
  geometryDifferenceCount: number;
  allBytesVerified: boolean;
  replayZoneCount: number;
  geographicEquivalence: Array<Record<string, unknown>>;
}): FullBuilderReplayClassification {
  if (!input.allBytesVerified || input.replayZoneCount === 0) {
    return "BLOCKED_BY_MISSING_EVIDENCE";
  }
  const totalExpected =
    TURKEY_PARENT_INVENTORY_EXPECTED.ADM0 +
    TURKEY_PARENT_INVENTORY_EXPECTED.ADM1 +
    TURKEY_PARENT_INVENTORY_EXPECTED.ADM2;
  const totalMatches =
    input.replaySummary.ADM0.geometryHashMatches +
    input.replaySummary.ADM1.geometryHashMatches +
    input.replaySummary.ADM2.geometryHashMatches;
  if (totalMatches === totalExpected && input.geometryDifferenceCount === 0) {
    return "FULL_REPLAY_VERIFIED";
  }
  const allGeoEquivalent = input.geographicEquivalence.every(
    (row) =>
      row.equivalenceClass === "GEOGRAPHICALLY_EQUIVALENT_WITHIN_TOLERANCE" ||
      row.equivalenceClass === "SERIALIZED_IDENTICAL" ||
      row.equivalenceClass === "TOPOLOGICALLY_EQUIVALENT"
  );
  if (input.geometryDifferenceCount > 0 && allGeoEquivalent) {
    return "GEOGRAPHICALLY_EQUIVALENT_WITH_DIFFERENCES";
  }
  if (totalMatches > 0 && totalMatches < totalExpected) {
    return "PARTIALLY_REPRODUCED";
  }
  if (input.geometryDifferenceCount > 0) {
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

Canonical \`datasets/generated/countries/TR/dataset.json\` üzerine yazılmadı. geoBoundaries ADM2 source-lock \`sourceFeatureCount: 999\` ile simplified GeoJSON 973 özelliği farkı dokümante edildi; bu sprint lock metadata'yı sessizce düzeltmedi.
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
  if (options.strict && result.classification === "BLOCKED_BY_MISSING_EVIDENCE") {
    issues.push("Replay blocked by missing evidence.");
  }
  return { ok: issues.length === 0, issues };
}
