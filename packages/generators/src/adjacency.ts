import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
  applyTerritoryAdjacencyOverrides,
  classifyTerritoryGeometryRelation,
  computeTerritoryAdjacencyContentHash,
  normalizeTerritoryAdjacencyEdges,
  validateGeometryDataset,
  validateTerritoryAdjacencyArtifact
} from "@territory-kit/dataset";
import type {
  GeometryQualityIssueCode,
  TerritoryAdjacencyArtifact,
  TerritoryAdjacencyBuildOptions,
  TerritoryAdjacencyBuildStatistics,
  TerritoryAdjacencyEdge,
  TerritoryAdjacencyOverrides,
  TerritoryAdjacencyValidationReport,
  TerritoryBBox,
  TerritoryDataset,
  TerritoryZone
} from "@territory-kit/dataset";
import { readTerritoryDatasetPath } from "./geometry-quality.js";
import { pathExists, serializeJsonStable, writeFilesAtomically } from "./sources/utils.js";

export interface TerritoryAdjacencyBuildIssue {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  zoneId?: string;
  otherZoneId?: string;
  details?: Record<string, unknown>;
}

export interface TerritoryAdjacencyBuildResult {
  artifact: TerritoryAdjacencyArtifact;
  issues: TerritoryAdjacencyBuildIssue[];
  statistics: TerritoryAdjacencyBuildStatistics;
}

export interface TerritoryAdjacencyPathBuildOptions extends TerritoryAdjacencyBuildOptions {
  outputPath: string;
  reportPath?: string;
  overridesPath?: string;
  buildDate?: string;
  force?: boolean;
}

export interface TerritoryAdjacencyPathBuildResult {
  input: {
    datasetPath: string;
    sourcePath: string;
    dataset: TerritoryDataset;
  };
  outputPath: string;
  reportPath?: string;
  result: TerritoryAdjacencyBuildResult;
}

interface IndexedZone {
  index: number;
  zone: TerritoryZone;
  bbox: TerritoryBBox;
}

interface CandidatePair {
  left: TerritoryZone;
  right: TerritoryZone;
}

const GENERATORS_PACKAGE_VERSION = "1.1.0";
const INVALID_GEOMETRY_CODES = new Set<GeometryQualityIssueCode>([
  "GEOMETRY_TYPE_INVALID",
  "GEOMETRY_COORDINATES_INVALID",
  "COORDINATE_NOT_FINITE",
  "COORDINATE_OUT_OF_RANGE",
  "CONSECUTIVE_DUPLICATE_COORDINATE",
  "RING_TOO_SHORT",
  "RING_NOT_CLOSED",
  "RING_ZERO_AREA",
  "SELF_INTERSECTION",
  "HOLE_OUTSIDE_SHELL",
  "HOLE_SHELL_INTERSECTION",
  "HOLE_OVERLAP",
  "DUPLICATE_HOLE",
  "MULTIPOLYGON_COMPONENT_OVERLAP",
  "DUPLICATE_MULTIPOLYGON_COMPONENT",
  "ANTIMERIDIAN_CROSSING"
]);

export async function buildTerritoryAdjacency(
  dataset: TerritoryDataset,
  options: TerritoryAdjacencyBuildOptions & { buildDate?: string } = {}
): Promise<TerritoryAdjacencyBuildResult> {
  const normalizedOptions = normalizeAdjacencyBuildOptions(options);
  const issues: TerritoryAdjacencyBuildIssue[] = [];
  const statistics: TerritoryAdjacencyBuildStatistics = {
    zoneCount: dataset.zones.length,
    eligibleZoneCount: 0,
    skippedZoneCount: 0,
    candidatePairCount: 0,
    exactComparisonCount: 0,
    disjointPairCount: 0,
    sharedBorderCount: 0,
    pointTouchCount: 0,
    overlapRejectedCount: 0,
    ambiguousCount: 0,
    manualAddCount: normalizedOptions.overrides.add?.length ?? 0,
    manualRemoveCount: normalizedOptions.overrides.remove?.length ?? 0,
    finalEdgeCount: 0,
    totalSharedBoundaryMeters: 0
  };

  options.onProgress?.({ phase: "quality" });
  throwIfAborted(options.signal);
  const quality = validateGeometryDataset(dataset, {
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
    },
    epsilon: normalizedOptions.epsilon
  });
  const skippedZoneIds = new Set<string>();

  for (const issue of quality.issues) {
    if (issue.severity !== "error" || !issue.zoneId) {
      continue;
    }

    if (INVALID_GEOMETRY_CODES.has(issue.code)) {
      skippedZoneIds.add(issue.zoneId);
      issues.push({
        code: `QUALITY_${issue.code}`,
        severity: "error",
        message: issue.message,
        zoneId: issue.zoneId,
        details: { path: issue.path }
      });
    }
  }

  if (normalizedOptions.strict && skippedZoneIds.size > 0) {
    throw new Error(
      `Adjacency build rejected in strict mode because ${skippedZoneIds.size} zone(s) have geometry quality errors.`
    );
  }

  const eligibleZones = dataset.zones
    .filter((zone) => !skippedZoneIds.has(zone.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  statistics.eligibleZoneCount = eligibleZones.length;
  statistics.skippedZoneCount = dataset.zones.length - eligibleZones.length;

  options.onProgress?.({ phase: "candidates" });
  const candidates = createAdjacencyCandidatePairs(eligibleZones, normalizedOptions);
  statistics.candidatePairCount = candidates.length;

  const computedEdges: TerritoryAdjacencyEdge[] = [];
  const totalPairs = candidates.length;

  for (const [index, pair] of candidates.entries()) {
    throwIfAborted(options.signal);
    statistics.exactComparisonCount += 1;

    if (index % normalizedOptions.batchSize === 0 || index + 1 === totalPairs) {
      options.onProgress?.({
        phase: "exact-relations",
        processedPairs: index + 1,
        totalPairs
      });
    }

    const relation = classifyTerritoryGeometryRelation(pair.left.geometry, pair.right.geometry, {
      epsilon: normalizedOptions.epsilon
    });

    if (relation.relation === "shared-border") {
      statistics.sharedBorderCount += 1;

      if (relation.sharedBoundaryMeters + 0.001 >= normalizedOptions.minimumSharedBoundaryMeters) {
        computedEdges.push({
          from: pair.left.id,
          to: pair.right.id,
          type: "shared-border",
          source: "computed",
          sharedBoundaryMeters: relation.sharedBoundaryMeters,
          confidence: relation.confidence
        });
        statistics.totalSharedBoundaryMeters += relation.sharedBoundaryMeters;
      }
    } else if (relation.relation === "point-touch") {
      statistics.pointTouchCount += 1;

      if (normalizedOptions.includePointTouches) {
        computedEdges.push({
          from: pair.left.id,
          to: pair.right.id,
          type: "point-touch",
          source: "computed",
          confidence: relation.confidence
        });
      }
    } else if (relation.relation === "disjoint") {
      statistics.disjointPairCount += 1;
    } else if (
      relation.relation === "overlap" ||
      relation.relation === "contains" ||
      relation.relation === "within" ||
      relation.relation === "equal"
    ) {
      statistics.overlapRejectedCount += 1;
      issues.push({
        code: `RELATION_${relation.relation.toUpperCase()}`,
        severity: "warning",
        message: `Rejected adjacency for '${pair.left.id}' and '${pair.right.id}' because relation is ${relation.relation}.`,
        zoneId: pair.left.id,
        otherZoneId: pair.right.id
      });
    } else {
      statistics.ambiguousCount += 1;
      issues.push({
        code: "RELATION_AMBIGUOUS",
        severity: "warning",
        message: `Could not classify adjacency for '${pair.left.id}' and '${pair.right.id}'.`,
        zoneId: pair.left.id,
        otherZoneId: pair.right.id
      });
    }
  }

  options.onProgress?.({ phase: "overrides" });
  const finalEdges = applyTerritoryAdjacencyOverrides(
    normalizeTerritoryAdjacencyEdges(computedEdges),
    normalizedOptions.overrides
  );
  statistics.finalEdgeCount = finalEdges.length;
  statistics.totalSharedBoundaryMeters = roundMeters(
    finalEdges.reduce((sum, edge) => sum + (edge.sharedBoundaryMeters ?? 0), 0)
  );

  options.onProgress?.({ phase: "artifact" });
  const artifactWithoutHash: Omit<TerritoryAdjacencyArtifact, "contentHash"> = {
    artifactVersion: "1",
    dataset: {
      id: dataset.manifest.datasetId,
      version: dataset.manifest.datasetVersion,
      contentHash: dataset.manifest.geometryHash
    },
    generatedBy: {
      package: "@territory-kit/generators",
      version: GENERATORS_PACKAGE_VERSION
    },
    generatedAt: resolveBuildTimestamp(options.buildDate),
    measurement: {
      sharedBoundary: "geodesic-haversine",
      holeBoundaryPolicy: "outer-rings-only"
    },
    options: {
      sameParentOnly: normalizedOptions.sameParentOnly,
      sameAdminLevelOnly: normalizedOptions.sameAdminLevelOnly,
      includePointTouches: normalizedOptions.includePointTouches,
      minimumSharedBoundaryMeters: normalizedOptions.minimumSharedBoundaryMeters,
      epsilon: normalizedOptions.epsilon
    },
    tolerance: {
      coordinateEpsilon: normalizedOptions.epsilon,
      collinearityEpsilon: normalizedOptions.epsilon,
      lengthEpsilonMeters: 0.001
    },
    statistics,
    overrides: {
      addCount: normalizedOptions.overrides.add?.length ?? 0,
      removeCount: normalizedOptions.overrides.remove?.length ?? 0
    },
    edges: finalEdges
  };
  const artifact: TerritoryAdjacencyArtifact = {
    ...artifactWithoutHash,
    contentHash: computeTerritoryAdjacencyContentHash(artifactWithoutHash)
  };
  const validation = validateTerritoryAdjacencyArtifact(dataset, artifact);

  for (const issue of validation.issues) {
    issues.push({
      code: `ARTIFACT_${issue.code}`,
      severity: issue.severity,
      message: issue.message,
      ...(issue.zoneId ? { zoneId: issue.zoneId } : {})
    });
  }

  return {
    artifact,
    issues: issues.sort(
      (left, right) =>
        (left.zoneId ?? "").localeCompare(right.zoneId ?? "") ||
        (left.otherZoneId ?? "").localeCompare(right.otherZoneId ?? "") ||
        left.code.localeCompare(right.code)
    ),
    statistics
  };
}

export function applyTerritoryAdjacencyOverridesForBuild(
  edges: readonly TerritoryAdjacencyEdge[],
  overrides: TerritoryAdjacencyOverrides = {}
): TerritoryAdjacencyEdge[] {
  return applyTerritoryAdjacencyOverrides(edges, overrides);
}

export function serializeTerritoryAdjacencyArtifact(artifact: TerritoryAdjacencyArtifact): string {
  return serializeJsonStable(artifact);
}

export { computeTerritoryAdjacencyContentHash } from "@territory-kit/dataset";
export { applyTerritoryAdjacencyOverrides } from "@territory-kit/dataset";

export async function buildTerritoryAdjacencyPath(
  inputPath: string,
  options: TerritoryAdjacencyPathBuildOptions
): Promise<TerritoryAdjacencyPathBuildResult> {
  const input = await readTerritoryDatasetPath(inputPath);
  const overrides = options.overridesPath
    ? await readTerritoryAdjacencyOverridesPath(options.overridesPath)
    : options.overrides;
  const result = await buildTerritoryAdjacency(input.dataset, {
    ...options,
    ...(overrides ? { overrides } : {})
  });
  await writeTerritoryAdjacencyOutput(options.outputPath, result, {
    force: options.force ?? false
  });

  if (options.reportPath) {
    await writeJsonFileAtomically(options.reportPath, createBuildReport(result), {
      force: options.force ?? false
    });
  }

  return {
    input,
    outputPath: resolve(options.outputPath),
    ...(options.reportPath ? { reportPath: resolve(options.reportPath) } : {}),
    result
  };
}

export async function readTerritoryAdjacencyArtifactPath(
  inputPath: string
): Promise<TerritoryAdjacencyArtifact> {
  const resolved = resolve(inputPath);
  const stats = await stat(resolved);
  const artifactPath = stats.isDirectory() ? join(resolved, "adjacency.json") : resolved;
  return JSON.parse(await readFile(artifactPath, "utf8")) as TerritoryAdjacencyArtifact;
}

export async function readTerritoryAdjacencyOverridesPath(
  inputPath: string
): Promise<TerritoryAdjacencyOverrides> {
  return JSON.parse(await readFile(resolve(inputPath), "utf8")) as TerritoryAdjacencyOverrides;
}

export async function validateTerritoryAdjacencyPath(
  datasetPath: string,
  adjacencyPath: string
): Promise<{
  dataset: TerritoryDataset;
  artifact: TerritoryAdjacencyArtifact;
  report: TerritoryAdjacencyValidationReport;
}> {
  const input = await readTerritoryDatasetPath(datasetPath);
  const artifact = await readTerritoryAdjacencyArtifactPath(adjacencyPath);
  const report = validateTerritoryAdjacencyArtifact(input.dataset, artifact);

  return {
    dataset: input.dataset,
    artifact,
    report
  };
}

export async function writeTerritoryAdjacencyOutput(
  outputPath: string,
  result: TerritoryAdjacencyBuildResult,
  options: { force?: boolean } = {}
): Promise<void> {
  const resolvedOutputPath = resolve(outputPath);

  if (extname(resolvedOutputPath) === ".json") {
    await writeJsonFileAtomically(resolvedOutputPath, result.artifact, options);
    return;
  }

  const checksums = {
    "adjacency.json": result.artifact.contentHash,
    "build-report.json": computeBuildReportHash(result)
  };

  await writeFilesAtomically(
    resolvedOutputPath,
    new Map([
      ["adjacency.json", serializeTerritoryAdjacencyArtifact(result.artifact)],
      ["build-report.json", serializeJsonStable(createBuildReport(result))],
      ["checksums.json", serializeJsonStable(checksums)]
    ]),
    { force: options.force ?? false }
  );
}

function createAdjacencyCandidatePairs(
  zones: readonly TerritoryZone[],
  options: ReturnType<typeof normalizeAdjacencyBuildOptions>
): CandidatePair[] {
  const indexed = zones
    .map<IndexedZone>((zone, index) => ({
      index,
      zone,
      bbox: zone.bbox
    }))
    .sort(
      (left, right) =>
        left.bbox[0] - right.bbox[0] ||
        left.bbox[1] - right.bbox[1] ||
        left.zone.id.localeCompare(right.zone.id)
    );
  const pairs: CandidatePair[] = [];

  for (const [leftSortedIndex, left] of indexed.entries()) {
    for (
      let rightSortedIndex = leftSortedIndex + 1;
      rightSortedIndex < indexed.length;
      rightSortedIndex += 1
    ) {
      const right = indexed[rightSortedIndex];

      if (!right) {
        continue;
      }

      if (right.bbox[0] > left.bbox[2] + options.epsilon) {
        break;
      }

      if (!bboxesIntersect(left.bbox, right.bbox, options.epsilon)) {
        continue;
      }

      if (options.sameAdminLevelOnly && left.zone.level !== right.zone.level) {
        continue;
      }

      if (
        options.sameParentOnly &&
        (left.zone.parentId ?? "__root__") !== (right.zone.parentId ?? "__root__")
      ) {
        continue;
      }

      const [a, b] =
        left.zone.id.localeCompare(right.zone.id) <= 0
          ? [left.zone, right.zone]
          : [right.zone, left.zone];
      pairs.push({ left: a, right: b });
    }
  }

  return pairs.sort(
    (left, right) =>
      left.left.id.localeCompare(right.left.id) || left.right.id.localeCompare(right.right.id)
  );
}

function normalizeAdjacencyBuildOptions(
  options: TerritoryAdjacencyBuildOptions & { buildDate?: string }
) {
  const epsilon = readNonNegativeNumber(options.epsilon, 1e-9);
  const includePointTouches =
    options.relationMode === "all" ? true : (options.includePointTouches ?? false);

  return {
    relationMode: options.relationMode ?? "shared-border",
    sameParentOnly: options.sameParentOnly ?? true,
    sameAdminLevelOnly: options.sameAdminLevelOnly ?? true,
    includePointTouches,
    minimumSharedBoundaryMeters: readNonNegativeNumber(options.minimumSharedBoundaryMeters, 0),
    epsilon,
    batchSize: readPositiveInteger(options.batchSize, 500),
    strict: options.strict ?? false,
    overrides: options.overrides ?? {}
  };
}

function createBuildReport(result: TerritoryAdjacencyBuildResult): {
  ok: boolean;
  statistics: TerritoryAdjacencyBuildStatistics;
  issues: TerritoryAdjacencyBuildIssue[];
} {
  return {
    ok: result.issues.every((issue) => issue.severity !== "error"),
    statistics: result.statistics,
    issues: result.issues
  };
}

function computeBuildReportHash(result: TerritoryAdjacencyBuildResult): string {
  return `fnv1a32:${fnv1a32(serializeJsonStable(createBuildReport(result)))}`;
}

function resolveBuildTimestamp(buildDate: string | undefined): string {
  if (buildDate) {
    return new Date(buildDate).toISOString();
  }

  const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH;

  if (sourceDateEpoch && /^\d+$/.test(sourceDateEpoch)) {
    return new Date(Number(sourceDateEpoch) * 1000).toISOString();
  }

  return new Date().toISOString();
}

function bboxesIntersect(left: TerritoryBBox, right: TerritoryBBox, epsilon: number): boolean {
  return !(
    left[2] < right[0] - epsilon ||
    right[2] < left[0] - epsilon ||
    left[3] < right[1] - epsilon ||
    right[3] < left[1] - epsilon
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("Adjacency build aborted.");
  }
}

function readNonNegativeNumber(input: number | undefined, fallback: number): number {
  return Number.isFinite(input) && input !== undefined && input >= 0 ? input : fallback;
}

function readPositiveInteger(input: number | undefined, fallback: number): number {
  return Number.isInteger(input) && input !== undefined && input > 0 ? input : fallback;
}

function roundMeters(value: number): number {
  return Math.round(value * 1000) / 1000;
}

async function writeJsonFileAtomically(
  outputPath: string,
  input: unknown,
  options: { force?: boolean } = {}
): Promise<void> {
  const resolvedOutputPath = resolve(outputPath);

  if (!options.force && (await pathExists(resolvedOutputPath))) {
    throw new Error(`Output path '${resolvedOutputPath}' already exists.`);
  }

  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  const tempDirectory = await mkdtemp(
    join(dirname(resolvedOutputPath), `.${basename(resolvedOutputPath)}-tmp-`)
  );
  const tempPath = join(tempDirectory, basename(resolvedOutputPath));

  try {
    await writeFile(tempPath, serializeJsonStable(input), "utf8");
    await rename(tempPath, resolvedOutputPath);
    await rm(tempDirectory, { force: true, recursive: true });
  } catch (error) {
    await rm(tempDirectory, { force: true, recursive: true });
    throw error;
  }
}

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
