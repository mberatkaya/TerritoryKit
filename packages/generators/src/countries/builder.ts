import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  encodeTerritoryBinarySpatialIndex,
  inspectTerritoryBinarySpatialIndex
} from "@territory-kit/core";
import {
  DEFAULT_TERRITORY_RENDER_LEVEL_POLICY,
  TERRITORY_SCHEMA_VERSION,
  computeGeometryBBox,
  computeTerritoryAdjacencyContentHash,
  createTerritoryQueryArtifact,
  getAdminLevelDepth,
  validateGeometryDataset,
  validateTerritoryAdjacencyArtifact,
  validateTerritoryDataset
} from "@territory-kit/dataset";
import type {
  TerritoryAdminLevel,
  TerritoryAdjacencyArtifact,
  TerritoryDataset,
  TerritoryGeometry,
  TerritoryZone
} from "@territory-kit/dataset";
import { buildTerritoryAdjacency, serializeTerritoryAdjacencyArtifact } from "../adjacency.js";
import {
  computeGeometryRepresentativePoint,
  repairTerritoryGeometries
} from "../geometry-repair.js";
import type { TerritoryGeometryRepairReport } from "../geometry-repair.js";
import { buildTerritoryRenderArtifacts } from "../render-artifacts.js";
import {
  createDatasetGeometryHash,
  isRecord,
  readStringPropertyPath,
  serializeJsonStable,
  sha256Hex,
  writeFilesAtomically
} from "../sources/utils.js";
import {
  createTurkeyAdm3CoverageManifest,
  createTurkeyAdm3SyntheticSourceLockLevel,
  loadTurkeyAdm3ParsedFeatures
} from "../turkey-adm3-ingestion.js";
import type {
  TurkeyAdm3ProvinceBuildStatus,
  TurkeyAdm3ProvenanceReport,
  TurkeyAdm3QualityGateReport,
  TurkeyAdm3SourceLockExtension
} from "../turkey-adm3-ingestion.js";
import {
  applyHierarchyResolutions,
  attachChildIds,
  resolveTerritoryCountryHierarchy
} from "./hierarchy.js";
import {
  createTerritoryCountryIdentity,
  summarizeIdentityStability,
  validateTerritoryIdentityMap
} from "./identity.js";
import { getTerritoryCountryConfig } from "./registry.js";
import {
  acquireBoundarySourceArtifact,
  computeTerritoryCountrySourceLockHash
} from "./source-lock.js";
import type {
  BuiltCountryZone,
  ParsedCountryFeature,
  TerritoryCountryBuildIssue,
  TerritoryCountryBuildOptions,
  TerritoryCountryBuildPhase,
  TerritoryCountryBuildPhaseEvent,
  TerritoryCountryBuildReport,
  TerritoryCountryBuildResult,
  TerritoryCountryBuildStatistics,
  TerritoryCountryDatasetManifest,
  TerritoryCountryGeometryRepairSummary,
  TerritoryCountryInspectSummary,
  TerritoryCountryQualityReport,
  TerritoryCountrySourceLockLevel,
  TerritoryCountrySourceLock,
  TerritoryCountryValidateResult,
  TerritoryIdentityMap
} from "./types.js";

export async function buildTerritoryCountryDataset(
  options: TerritoryCountryBuildOptions
): Promise<TerritoryCountryBuildResult> {
  const cwd = options.cwd ?? process.cwd();
  const config = getTerritoryCountryConfig(options.country);
  const buildDate = resolveBuildTimestamp(options.buildDate);
  const requestedLevels = normalizeLevels(options.levels ?? config.requestedLevels);
  const issues: TerritoryCountryBuildIssue[] = [];
  const builtByLevel: Partial<Record<TerritoryAdminLevel, BuiltCountryZone[]>> = {};
  const repairReportsByLevel: Partial<Record<TerritoryAdminLevel, TerritoryGeometryRepairReport>> =
    {};
  const sourceBytesByLevel: Partial<Record<TerritoryAdminLevel, number>> = {};
  const sourceDates: Record<string, string> = {};
  const unavailableLevels: TerritoryAdminLevel[] = [];
  const turkeyAdm3Extension =
    config.countryCodeAlpha2 === "TR" ? options.sourceLock.extensions?.turkeyAdm3 : undefined;
  let turkeyAdm3ProvinceStatuses: Record<string, TurkeyAdm3ProvinceBuildStatus> | undefined;
  let turkeyAdm3QualityReport: TurkeyAdm3QualityGateReport | undefined;
  let turkeyAdm3ProvenanceReport: TurkeyAdm3ProvenanceReport | undefined;
  const runPhase = createPhaseRunner({
    country: config.countryCodeAlpha2,
    ...(options.phaseTimeoutMs ? { timeoutMs: options.phaseTimeoutMs } : {}),
    ...(options.onPhase ? { onPhase: options.onPhase } : {})
  });

  for (const level of requestedLevels) {
    if (level === "ADM3" && turkeyAdm3Extension) {
      const parsed = await runPhase("download", { level }, () =>
        loadTurkeyAdm3ParsedFeatures({
          extension: turkeyAdm3Extension,
          allowPartial: options.allowPartial ?? false,
          cwd,
          buildDate,
          ...(options.cacheDir ? { cacheDir: options.cacheDir } : {}),
          ...(options.noCache ? { noCache: true } : {}),
          ...(options.refresh ? { refresh: true } : {}),
          acquireSource: acquireBoundarySourceArtifact
        })
      );
      issues.push(...parsed.issues);
      turkeyAdm3ProvinceStatuses = parsed.provinceStatuses;
      turkeyAdm3QualityReport = parsed.qualityReport;
      turkeyAdm3ProvenanceReport = parsed.provenance;

      if (parsed.features.length === 0) {
        unavailableLevels.push(level);
        if (!options.allowPartial) {
          issues.push({
            code: "TR_ADM3_NO_BUILDABLE_PROVINCES",
            severity: "error",
            message: "No Turkey ADM3 province source produced buildable features.",
            level
          });
        }
        sourceBytesByLevel[level] = parsed.sourceBytes;
        sourceDates[level] = Object.values(parsed.sourceDates).sort().join(",") || "unknown";
        continue;
      }

      const repairReport = await runPhase(
        "geometry-repair",
        { level, inputBytes: parsed.sourceBytes, featureCount: parsed.features.length },
        () =>
          repairTerritoryGeometries(
            parsed.features.map((feature, index) => ({
              id: String(index),
              geometry: feature.geometry
            }))
          )
      );
      repairReportsByLevel[level] = repairReport;
      const repairByIndex = new Map(
        repairReport.results.map((result) => [Number(result.id), result])
      );
      const repairedFeatures = parsed.features.flatMap((feature, index) => {
        const repair = repairByIndex.get(index);

        if (!repair || repair.status === "rejected" || !repair.geometry) {
          issues.push({
            code: "GEOMETRY_REPAIR_REJECTED",
            severity: "error",
            message: `${level} feature '${feature.sourceId ?? feature.name}' could not be repaired: ${
              repair?.message ?? "missing repair result"
            }`,
            level,
            details: {
              engine: repairReport.engine,
              engineVersion: repairReport.engineVersion,
              mode: repairReport.mode,
              componentsDiscarded: repair?.componentsDiscarded ?? 0
            }
          });
          return [];
        }

        return [
          {
            ...feature,
            geometry: repair.geometry,
            ...(repair.center ? { center: repair.center } : {}),
            ...(repair.bbox ? { bbox: repair.bbox } : {})
          }
        ];
      });

      if (repairReport.featuresRepaired > 0 || repairReport.componentsDiscarded > 0) {
        issues.push({
          code: "GEOMETRY_REPAIRED",
          severity: "info",
          message: `${level} geometry repair changed ${repairReport.featuresRepaired} feature(s) with ${repairReport.componentsDiscarded} discarded non-area component(s).`,
          level,
          details: { ...summarizeGeometryRepairReport(repairReport) }
        });
      }

      builtByLevel[level] = await runPhase(
        "derived-metadata",
        { level, inputBytes: parsed.sourceBytes, featureCount: repairedFeatures.length },
        async () =>
          buildLevelZones({
            config,
            level,
            features: repairedFeatures,
            sourceLockLevel: createTurkeyAdm3SyntheticSourceLockLevel(turkeyAdm3Extension),
            sourceDatasetVersion: turkeyAdm3Extension.catalogHash,
            buildDate
          })
      );
      sourceBytesByLevel[level] = parsed.sourceBytes;
      sourceDates[level] = Object.values(parsed.sourceDates).sort().join(",") || "unknown";
      continue;
    }

    const lockLevel = options.sourceLock.levels[level];

    if (!lockLevel || lockLevel.status !== "available") {
      unavailableLevels.push(level);
      issues.push({
        code: "COUNTRY_LEVEL_UNAVAILABLE",
        severity: config.levelMappings[level]?.required ? "error" : "warning",
        message: lockLevel?.unavailableReason ?? `${level} is unavailable in the source lock.`,
        level
      });
      continue;
    }

    const sourceUrl = lockLevel.sourcePath ?? lockLevel.sourceUrl;

    if (!sourceUrl) {
      unavailableLevels.push(level);
      issues.push({
        code: "SOURCE_URL_MISSING",
        severity: "error",
        message: `${level} source lock entry does not include a source path or URL.`,
        level
      });
      continue;
    }

    const artifact = await runPhase(
      "download",
      { level, ...(lockLevel.sizeBytes !== undefined ? { inputBytes: lockLevel.sizeBytes } : {}) },
      () =>
        acquireBoundarySourceArtifact(
          {
            provider: options.sourceLock.provider,
            sourceUrl,
            ...(lockLevel.sha256 ? { expectedSha256: lockLevel.sha256 } : {}),
            ...(lockLevel.sourceVersion ? { sourceVersion: lockLevel.sourceVersion } : {})
          },
          {
            cwd,
            buildDate,
            ...(options.cacheDir ? { cacheDir: options.cacheDir } : {}),
            ...(options.noCache ? { noCache: true } : {}),
            ...(options.refresh ? { refresh: true } : {})
          }
        )
    );
    await runPhase("extraction", { level, inputBytes: artifact.sizeBytes }, async () => undefined);
    const features = await runPhase(
      "parsing",
      { level, inputBytes: artifact.sizeBytes },
      async () => {
        const parsed = JSON.parse(await readFile(artifact.localPath, "utf8")) as unknown;
        return readCountryFeatures(parsed, {
          config,
          level,
          ...(lockLevel.sourceVersion ? { sourceDatasetVersion: lockLevel.sourceVersion } : {}),
          issues
        });
      }
    );
    const repairReport = await runPhase(
      "geometry-repair",
      { level, inputBytes: artifact.sizeBytes, featureCount: features.length },
      () =>
        repairTerritoryGeometries(
          features.map((feature, index) => ({ id: String(index), geometry: feature.geometry }))
        )
    );
    repairReportsByLevel[level] = repairReport;
    const repairByIndex = new Map(
      repairReport.results.map((result) => [Number(result.id), result])
    );
    const repairedFeatures = features.flatMap((feature, index) => {
      const repair = repairByIndex.get(index);

      if (!repair || repair.status === "rejected" || !repair.geometry) {
        issues.push({
          code: "GEOMETRY_REPAIR_REJECTED",
          severity: "error",
          message: `${level} feature '${feature.sourceId ?? feature.name}' could not be repaired: ${
            repair?.message ?? "missing repair result"
          }`,
          level,
          details: {
            engine: repairReport.engine,
            engineVersion: repairReport.engineVersion,
            mode: repairReport.mode,
            componentsDiscarded: repair?.componentsDiscarded ?? 0
          }
        });
        return [];
      }

      return [
        {
          ...feature,
          geometry: repair.geometry,
          ...(repair.center ? { center: repair.center } : {}),
          ...(repair.bbox ? { bbox: repair.bbox } : {})
        }
      ];
    });

    if (repairReport.featuresRepaired > 0 || repairReport.componentsDiscarded > 0) {
      issues.push({
        code: "GEOMETRY_REPAIRED",
        severity: "info",
        message: `${level} geometry repair changed ${repairReport.featuresRepaired} feature(s) with ${repairReport.componentsDiscarded} discarded non-area component(s).`,
        level,
        details: { ...summarizeGeometryRepairReport(repairReport) }
      });
    }

    builtByLevel[level] = await runPhase(
      "derived-metadata",
      { level, inputBytes: artifact.sizeBytes, featureCount: repairedFeatures.length },
      async () =>
        buildLevelZones({
          config,
          level,
          features: repairedFeatures,
          sourceLockLevel: lockLevel,
          ...(lockLevel.sourceVersion ? { sourceDatasetVersion: lockLevel.sourceVersion } : {}),
          buildDate
        })
    );
    sourceBytesByLevel[level] = artifact.sizeBytes;
    sourceDates[level] = lockLevel.sourceDate ?? lockLevel.boundaryYearRepresented ?? "unknown";
  }

  const hierarchyReport = await runPhase("derived-metadata", {}, async () =>
    resolveTerritoryCountryHierarchy({
      parentsByLevel: builtByLevel,
      childrenByLevel: builtByLevel,
      tolerance: config.hierarchyStrategy.spatialContainmentTolerance
    })
  );
  issues.push(
    ...hierarchyReport.resolutions.flatMap((resolution) =>
      resolution.issues.map((issue) => ({
        code: issue.code,
        severity:
          (issue.code === "PARENT_LEVEL_EMPTY" || issue.code === "PARENT_UNRESOLVED") &&
          !config.qualityPolicy.rejectUnresolvedParents
            ? ("warning" as const)
            : issue.code === "PARENT_AMBIGUOUS" && !config.qualityPolicy.rejectAmbiguousParents
              ? ("warning" as const)
              : issue.severity,
        message: issue.message,
        zoneId: resolution.childId
      }))
    )
  );

  const allBuilt = attachChildIds(
    applyHierarchyResolutions(
      Object.values(builtByLevel)
        .flatMap((value) => value ?? [])
        .sort((left, right) => left.zone.id.localeCompare(right.zone.id)),
      hierarchyReport
    )
  );
  const rebuiltByLevel = groupBuiltZonesByLevel(allBuilt);
  const levelDatasets = await runPhase(
    "simplification",
    { featureCount: allBuilt.length },
    async () =>
      createLevelDatasets(
        config,
        rebuiltByLevel,
        {
          buildDate,
          sourceDates,
          ...(options.sourceLock.releaseType ? { releaseType: options.sourceLock.releaseType } : {})
        },
        { standalone: true }
      )
  );
  const adjacencyLevelDatasets = createLevelDatasets(
    config,
    rebuiltByLevel,
    {
      buildDate,
      sourceDates,
      ...(options.sourceLock.releaseType ? { releaseType: options.sourceLock.releaseType } : {})
    },
    { standalone: false }
  );
  const combinedDataset = createCombinedDataset(config, allBuilt, {
    buildDate,
    sourceDates,
    ...(options.sourceLock.releaseType ? { releaseType: options.sourceLock.releaseType } : {})
  });
  const qualityReport = createQualityReport(levelDatasets, combinedDataset);
  const identityMap: TerritoryIdentityMap = {
    identityVersion: "1",
    entries: allBuilt
      .map((built) => built.identity)
      .sort((left, right) => left.territoryId.localeCompare(right.territoryId))
  };
  issues.push(...validateTerritoryIdentityMap(identityMap));
  const adjacencyArtifacts = options.buildAdjacency
    ? await runPhase("adjacency-generation", { featureCount: allBuilt.length }, () =>
        buildAdjacencyArtifacts(config, adjacencyLevelDatasets, {
          buildDate,
          publishedLevelDatasets: levelDatasets,
          ...(options.batchSize ? { batchSize: options.batchSize } : {}),
          issues
        })
      )
    : { artifacts: {}, reports: {} };
  const publishReadyFailures = evaluatePublishReadyFailures({
    config,
    issues,
    qualityReport,
    hierarchyReport,
    identityMap,
    unavailableLevels
  });
  const publishReady = publishReadyFailures.length === 0;

  if (options.strict && !publishReady && !options.allowNonPublishReady) {
    issues.push({
      code: "COUNTRY_NOT_PUBLISH_READY",
      severity: "error",
      message: "Strict country build rejected a non publish-ready artifact."
    });
  }

  const statistics = createBuildStatistics({
    config,
    requestedLevels,
    unavailableLevels,
    levelDatasets,
    allBuilt,
    hierarchyReport,
    qualityReport,
    adjacencyArtifacts: adjacencyArtifacts.artifacts,
    adjacencyReports: adjacencyArtifacts.reports,
    repairReportsByLevel,
    sourceBytesByLevel,
    publishReady
  });
  const buildReport: TerritoryCountryBuildReport = {
    reportVersion: "1",
    statistics,
    issues: issues.sort(compareIssues)
  };
  await runPhase("spatial-index", { featureCount: allBuilt.length }, async () => undefined);
  const files = await runPhase("serialization", { featureCount: allBuilt.length }, async () =>
    createCountryArtifactFiles({
      config,
      sourceLock: options.sourceLock,
      levelDatasets,
      combinedDataset,
      builtZones: allBuilt,
      identityMap,
      hierarchyReport,
      qualityReport,
      adjacencyArtifacts: adjacencyArtifacts.artifacts,
      adjacencyReports: adjacencyArtifacts.reports,
      repairReportsByLevel,
      buildReport,
      buildDate,
      sourceDates,
      publishReady,
      publishReadyFailures,
      buildQueryArtifacts: options.buildQueryArtifacts ?? false,
      buildRenderArtifacts: options.buildRenderArtifacts ?? false,
      buildBinaryIndex: options.buildBinaryIndex ?? false,
      ...(turkeyAdm3Extension
        ? {
            turkeyAdm3: {
              extension: turkeyAdm3Extension,
              allowPartial: options.allowPartial ?? false,
              ...(turkeyAdm3ProvinceStatuses
                ? { provinceStatuses: turkeyAdm3ProvinceStatuses }
                : {}),
              ...(turkeyAdm3QualityReport ? { qualityReport: turkeyAdm3QualityReport } : {}),
              ...(turkeyAdm3ProvenanceReport
                ? { provenanceReport: turkeyAdm3ProvenanceReport }
                : {})
            }
          }
        : {})
    })
  );
  statistics.artifactBytes = [...files.values()].reduce(
    (sum, content) => sum + Buffer.byteLength(content),
    0
  );

  await runPhase("checksum", { inputBytes: statistics.artifactBytes }, async () => undefined);

  if (options.outputPath) {
    const outputPath = options.outputPath;
    await runPhase("artifact-write", { inputBytes: statistics.artifactBytes }, () =>
      writeFilesAtomically(resolve(cwd, outputPath), files, {
        force: options.force ?? false
      })
    );
  }

  const manifestContent = files.get("manifest.json");

  return {
    manifest: JSON.parse(
      typeof manifestContent === "string" ? manifestContent : "{}"
    ) as TerritoryCountryDatasetManifest,
    levelDatasets,
    combinedDataset,
    identityMap,
    sourceLock: options.sourceLock,
    qualityReport,
    hierarchyReport,
    adjacencyArtifacts: adjacencyArtifacts.artifacts,
    buildReport,
    issues: buildReport.issues,
    files,
    ...(options.outputPath ? { outputPath: resolve(cwd, options.outputPath) } : {})
  };
}

export async function buildTerritoryCountryDatasetPath(options: {
  country: string;
  sourceLockPath: string;
  outputPath: string;
  levels?: readonly TerritoryAdminLevel[];
  buildAdjacency?: boolean;
  buildQueryArtifacts?: boolean;
  buildRenderArtifacts?: boolean;
  buildBinaryIndex?: boolean;
  allowPartial?: boolean;
  strict?: boolean;
  allowNonPublishReady?: boolean;
  buildDate?: string;
  batchSize?: number;
  cacheDir?: string;
  noCache?: boolean;
  refresh?: boolean;
  force?: boolean;
  cwd?: string;
  phaseTimeoutMs?: number;
  onPhase?: (event: TerritoryCountryBuildPhaseEvent) => void;
}): Promise<TerritoryCountryBuildResult> {
  const lock = JSON.parse(
    await readFile(resolve(options.cwd ?? process.cwd(), options.sourceLockPath), "utf8")
  ) as TerritoryCountrySourceLock;

  return buildTerritoryCountryDataset({
    country: options.country,
    sourceLock: lock,
    outputPath: options.outputPath,
    ...(options.levels ? { levels: options.levels } : {}),
    ...(options.buildAdjacency ? { buildAdjacency: true } : {}),
    ...(options.buildQueryArtifacts ? { buildQueryArtifacts: true } : {}),
    ...(options.buildRenderArtifacts ? { buildRenderArtifacts: true } : {}),
    ...(options.buildBinaryIndex ? { buildBinaryIndex: true } : {}),
    ...(options.allowPartial ? { allowPartial: true } : {}),
    ...(options.strict ? { strict: true } : {}),
    ...(options.allowNonPublishReady ? { allowNonPublishReady: true } : {}),
    ...(options.buildDate ? { buildDate: options.buildDate } : {}),
    ...(options.batchSize ? { batchSize: options.batchSize } : {}),
    ...(options.cacheDir ? { cacheDir: options.cacheDir } : {}),
    ...(options.noCache ? { noCache: true } : {}),
    ...(options.refresh ? { refresh: true } : {}),
    ...(options.force ? { force: true } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.phaseTimeoutMs ? { phaseTimeoutMs: options.phaseTimeoutMs } : {}),
    ...(options.onPhase ? { onPhase: options.onPhase } : {})
  });
}

export async function validateTerritoryCountryDatasetPath(
  inputPath: string,
  options: { strict?: boolean } = {}
): Promise<TerritoryCountryValidateResult> {
  const root = resolve(inputPath);
  const issues: TerritoryCountryBuildIssue[] = [];
  const manifest = JSON.parse(
    await readFile(resolve(root, "manifest.json"), "utf8")
  ) as TerritoryCountryDatasetManifest;
  const checksums = JSON.parse(await readFile(resolve(root, "checksums.json"), "utf8")) as {
    files: Record<string, string>;
  };

  for (const [relativePath, expected] of Object.entries(checksums.files).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    if (relativePath === "checksums.json") {
      continue;
    }

    const content = await readFile(resolve(root, relativePath));
    const actual = sha256Hex(content);

    if (actual !== expected) {
      issues.push({
        code: "COUNTRY_CHECKSUM_MISMATCH",
        severity: "error",
        message: `Checksum mismatch for ${relativePath}.`
      });
    }
  }

  for (const level of manifest.supportedLevels) {
    const datasetInput = JSON.parse(
      await readFile(resolve(root, "levels", level, "dataset.json"), "utf8")
    ) as unknown;
    const validation = validateTerritoryDataset(datasetInput);

    if (!validation.ok || !validation.dataset) {
      issues.push({
        code: "COUNTRY_LEVEL_DATASET_INVALID",
        severity: "error",
        message: `${level} dataset is invalid.`,
        level
      });
      continue;
    }

    if (level !== "ADM0") {
      const adjacencyPath = resolve(root, "adjacency", level, "adjacency.json");

      if (await pathExists(adjacencyPath)) {
        const adjacency = JSON.parse(
          await readFile(adjacencyPath, "utf8")
        ) as TerritoryAdjacencyArtifact;
        const adjacencyReport = validateTerritoryAdjacencyArtifact(validation.dataset, adjacency);

        if (!adjacencyReport.ok) {
          issues.push({
            code: "COUNTRY_ADJACENCY_INVALID",
            severity: "error",
            message: `${level} adjacency artifact is invalid.`,
            level
          });
        }
      }
    }
  }

  if (options.strict && !manifest.publishReady) {
    issues.push({
      code: "COUNTRY_NOT_PUBLISH_READY",
      severity: "error",
      message: "Country artifact is not publish-ready."
    });
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    manifest,
    issues: issues.sort(compareIssues)
  };
}

function createPhaseRunner(input: {
  country: string;
  timeoutMs?: number;
  onPhase?: (event: TerritoryCountryBuildPhaseEvent) => void;
}) {
  return async function runPhase<T>(
    phase: TerritoryCountryBuildPhase,
    details: {
      inputBytes?: number;
      outputBytes?: number;
      featureCount?: number;
      artifactCount?: number;
      warningCount?: number;
      errorCount?: number;
      level?: TerritoryAdminLevel;
      reason?: string;
    },
    action: () => Promise<T>
  ): Promise<T> {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const startedMemory = readMemoryUsageBytes();
    input.onPhase?.({
      country: input.country,
      phase,
      status: "started",
      durationMs: 0,
      startedAt,
      ...(startedMemory !== undefined ? { peakMemoryBytes: startedMemory } : {}),
      ...details
    });

    try {
      const value = await runWithOptionalTimeout(action, input.timeoutMs, phase);
      const completedAt = new Date().toISOString();
      const inferredDetails = inferCompletedPhaseDetails(value);
      const completedMemory = readMemoryUsageBytes();
      input.onPhase?.({
        country: input.country,
        phase,
        status: "completed",
        durationMs: Date.now() - started,
        startedAt,
        completedAt,
        finishedAt: completedAt,
        ...details,
        ...inferredDetails,
        ...maxMemoryUsageDetails(startedMemory, completedMemory)
      });
      return value;
    } catch (error) {
      const completedAt = new Date().toISOString();
      const completedMemory = readMemoryUsageBytes();
      input.onPhase?.({
        country: input.country,
        phase,
        status: "failed",
        durationMs: Date.now() - started,
        startedAt,
        completedAt,
        finishedAt: completedAt,
        reason: error instanceof Error ? error.message : String(error),
        ...maxMemoryUsageDetails(startedMemory, completedMemory),
        ...details
      });
      throw error;
    }
  };
}

function inferCompletedPhaseDetails(value: unknown): {
  outputBytes?: number;
  artifactCount?: number;
  featureCount?: number;
} {
  if (value instanceof Map) {
    return {
      outputBytes: [...value.values()].reduce(
        (sum, content) => sum + Buffer.byteLength(content),
        0
      ),
      artifactCount: value.size
    };
  }

  if (Array.isArray(value)) {
    return { featureCount: value.length };
  }

  if (value && typeof value === "object" && "zones" in value) {
    const zones = (value as { zones?: unknown }).zones;

    if (Array.isArray(zones)) {
      return { featureCount: zones.length };
    }
  }

  return {};
}

function readMemoryUsageBytes(): number | undefined {
  if (typeof process === "undefined" || typeof process.memoryUsage !== "function") {
    return undefined;
  }

  return process.memoryUsage().rss;
}

function maxMemoryUsageDetails(
  left: number | undefined,
  right: number | undefined
): { peakMemoryBytes?: number } {
  const values = [left, right].filter((value): value is number => value !== undefined);

  if (values.length === 0) {
    return {};
  }

  return { peakMemoryBytes: Math.max(...values) };
}

async function runWithOptionalTimeout<T>(
  action: () => Promise<T>,
  timeoutMs: number | undefined,
  phase: TerritoryCountryBuildPhase
): Promise<T> {
  if (!timeoutMs || timeoutMs < 1) {
    return action();
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      action(),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${phase} exceeded ${timeoutMs} ms phase timeout.`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function inspectTerritoryCountryDatasetPath(
  inputPath: string
): Promise<TerritoryCountryInspectSummary> {
  const root = resolve(inputPath);
  const manifest = JSON.parse(
    await readFile(resolve(root, "manifest.json"), "utf8")
  ) as TerritoryCountryDatasetManifest;
  const hierarchy = JSON.parse(await readFile(resolve(root, "hierarchy-report.json"), "utf8")) as {
    summary: TerritoryCountryInspectSummary["hierarchy"];
  };

  return {
    country: manifest.country.alpha2,
    datasetId: manifest.datasetId,
    levels: manifest.supportedLevels,
    features: manifest.featureCountByLevel,
    identity: manifest.identityStabilitySummary,
    hierarchy: hierarchy.summary,
    quality: {
      errors: manifest.geometryQualitySummary.errorCount,
      warnings: manifest.geometryQualitySummary.warningCount
    },
    adjacency: Object.fromEntries(
      Object.entries(manifest.adjacencySummary).map(([level, summary]) => [
        level,
        summary.edgeCount
      ])
    ),
    publishReady: manifest.publishReady
  };
}

function readCountryFeatures(
  input: unknown,
  context: {
    config: ReturnType<typeof getTerritoryCountryConfig>;
    level: TerritoryAdminLevel;
    sourceDatasetVersion?: string;
    issues: TerritoryCountryBuildIssue[];
  }
): ParsedCountryFeature[] {
  if (!isRecord(input) || input.type !== "FeatureCollection" || !Array.isArray(input.features)) {
    context.issues.push({
      code: "SOURCE_FORMAT_UNSUPPORTED",
      severity: "error",
      message: "Country source must be a GeoJSON FeatureCollection.",
      level: context.level
    });
    return [];
  }

  const levelConfig = context.config.levelMappings[context.level];
  const nameProperty = levelConfig?.sourceNameProperty ?? "shapeName";
  const sourceIdProperty = levelConfig?.sourceIdProperty ?? "shapeID";

  return input.features
    .filter(isRecord)
    .flatMap((feature, index): ParsedCountryFeature[] => {
      const properties = isRecord(feature.properties) ? feature.properties : {};
      const name =
        readStringPropertyPath(properties, nameProperty) ??
        readStringPropertyPath(properties, "name") ??
        readStringPropertyPath(properties, "NAME");
      const geometry = readGeometry(feature.geometry);

      if (!name || !geometry) {
        context.issues.push({
          code: "SOURCE_FEATURE_INVALID",
          severity: "warning",
          message: `Feature ${index} is missing name or polygon geometry.`,
          level: context.level
        });
        return [];
      }

      const expectedTypes = levelConfig?.expectedLocalTypes ?? ["administrative-unit"];
      const rawLocalType =
        readStringPropertyPath(properties, "shapeType") ??
        levelConfig?.semanticType ??
        expectedTypes.at(-1) ??
        "administrative-unit";
      const localType = normalizeLocalType(rawLocalType, expectedTypes);

      if (!expectedTypes.includes(rawLocalType) && !expectedTypes.includes(localType)) {
        context.issues.push({
          code: "COUNTRY_LOCAL_TYPE_UNEXPECTED",
          severity: "warning",
          message: `Unexpected ${context.level} local type '${rawLocalType}'.`,
          level: context.level,
          details: { fallbackLocalType: localType }
        });
      }

      const sourceId =
        readStringPropertyPath(properties, sourceIdProperty) ?? readFeatureId(feature);
      const officialCode = readFirstProperty(properties, levelConfig?.sourceCodeProperties ?? []);
      const stableCode = readStringPropertyPath(properties, sourceIdProperty);
      const parentSourceId = readFirstProperty(
        properties,
        levelConfig?.sourceParentProperties ?? []
      );
      const rawFeatureId = readFeatureId(feature);

      return [
        {
          ...(sourceId ? { sourceId } : {}),
          ...(officialCode ? { officialCode } : {}),
          ...(stableCode ? { stableCode } : {}),
          ...(parentSourceId ? { parentSourceId } : {}),
          name,
          localType,
          geometry,
          rawProperties: properties,
          ...(rawFeatureId ? { rawFeatureId } : {})
        }
      ];
    })
    .sort((left, right) => {
      const leftKey = left.sourceId ?? left.name;
      const rightKey = right.sourceId ?? right.name;
      return leftKey.localeCompare(rightKey);
    });
}

function buildLevelZones(input: {
  config: ReturnType<typeof getTerritoryCountryConfig>;
  level: TerritoryAdminLevel;
  features: readonly ParsedCountryFeature[];
  sourceLockLevel: TerritoryCountrySourceLockLevel;
  sourceDatasetVersion?: string;
  buildDate: string;
}): BuiltCountryZone[] {
  const parentKeyByFeature = new Map<string, string>();
  const prepared = input.features.map((feature) => {
    const parentKey = feature.parentSourceId
      ? (parentKeyByFeature.get(feature.parentSourceId) ?? feature.parentSourceId)
      : undefined;
    const identity = createTerritoryCountryIdentity({
      config: input.config,
      adminLevel: input.level,
      feature,
      ...(parentKey ? { parentKey } : {}),
      ...(input.sourceDatasetVersion ? { sourceDatasetVersion: input.sourceDatasetVersion } : {})
    });
    parentKeyByFeature.set(feature.sourceId ?? identity.territoryId, identity.territoryId);

    return { feature, identity, ...(parentKey ? { parentKey } : {}) };
  });
  const duplicateTerritoryIds = new Set(
    [...countBy(prepared.map((item) => item.identity.territoryId))]
      .filter(([, count]) => count > 1)
      .map(([territoryId]) => territoryId)
  );

  return prepared.map(({ feature, identity: initialIdentity, parentKey }) => {
    const identity = duplicateTerritoryIds.has(initialIdentity.territoryId)
      ? createTerritoryCountryIdentity({
          config: input.config,
          adminLevel: input.level,
          feature,
          ...(parentKey ? { parentKey } : {}),
          collisionDisambiguator: createIdentityCollisionDisambiguator(feature),
          ...(input.sourceDatasetVersion
            ? { sourceDatasetVersion: input.sourceDatasetVersion }
            : {})
        })
      : initialIdentity;
    const levelConfig = input.config.levelMappings[input.level];
    const featureSourceProvider =
      readStringPropertyPath(feature.rawProperties, "territorykit.provider") ??
      input.config.sourceProvider;
    const featureSemanticType =
      readAdm3SemanticType(feature.rawProperties) ?? levelConfig?.semanticType ?? "unknown";
    const featureSourceUrl =
      readStringPropertyPath(feature.rawProperties, "territorykit.sourceUrl") ??
      input.sourceLockLevel.sourceUrl;
    const featureSourceDate =
      readStringPropertyPath(feature.rawProperties, "territorykit.sourceDate") ??
      input.sourceLockLevel.sourceDate;
    const featureLicense =
      readStringPropertyPath(feature.rawProperties, "territorykit.license") ??
      input.sourceLockLevel.license;
    const featureAttribution =
      readStringPropertyPath(feature.rawProperties, "territorykit.attribution") ??
      input.sourceLockLevel.attribution;
    const featureSourceClass = readStringPropertyPath(
      feature.rawProperties,
      "territorykit.sourceClass"
    );
    const featureBoundaryKind = readStringPropertyPath(
      feature.rawProperties,
      "territorykit.boundaryKind"
    );
    const featureBoundarySourceClass = readStringPropertyPath(
      feature.rawProperties,
      "territorykit.boundarySourceClass"
    );
    const featureConfidence = readStringPropertyPath(
      feature.rawProperties,
      "territorykit.confidence"
    );
    const featureAdministrative = readBooleanPropertyPath(
      feature.rawProperties,
      "territorykit.administrative"
    );
    const featureProviderId = readStringPropertyPath(
      feature.rawProperties,
      "territorykit.providerId"
    );
    const featureProviderName = readStringPropertyPath(
      feature.rawProperties,
      "territorykit.providerName"
    );
    const featureSourceId =
      readStringPropertyPath(feature.rawProperties, "territorykit.sourceId") ?? feature.sourceId;
    const featureSourceNativeId = readStringPropertyPath(
      feature.rawProperties,
      "territorykit.sourceNativeId"
    );
    const featureSourceVersion = readStringPropertyPath(
      feature.rawProperties,
      "territorykit.sourceVersion"
    );
    const featureGeometryHash = readStringPropertyPath(
      feature.rawProperties,
      "territorykit.geometryHash"
    );
    const featureSourceSnapshotChecksum =
      readStringPropertyPath(feature.rawProperties, "territorykit.sourceSnapshotChecksum") ??
      input.sourceLockLevel.sha256;
    const featureLicenseState =
      readStringPropertyPath(feature.rawProperties, "territorykit.licenseState") ??
      (input.sourceLockLevel.redistributionStatus === "allowed" ? "approved" : undefined);
    const featureOfficial = readBooleanPropertyPath(feature.rawProperties, "territorykit.official");
    const featureGenerated = readBooleanPropertyPath(
      feature.rawProperties,
      "territorykit.generated"
    );
    const featureParentAdm2Id = readStringPropertyPath(
      feature.rawProperties,
      "territorykit.parentAdm2Id"
    );
    const adm3ProvinceCode = readStringPropertyPath(
      feature.rawProperties,
      "territorykit.provinceCode"
    );
    const adm3ProvinceName = readStringPropertyPath(
      feature.rawProperties,
      "territorykit.provinceName"
    );
    const zone: TerritoryZone = {
      id: identity.territoryId,
      datasetId: `${input.config.datasetId}-${input.level.toLowerCase()}`,
      countryCode: input.config.countryCodeAlpha2,
      level: Number(input.level.slice(3)),
      sourceAdminLevel: input.level,
      semanticType: featureSemanticType,
      name: feature.name,
      ...(input.config.defaultLocale && input.config.defaultLocale !== "en"
        ? { localName: feature.name }
        : {}),
      neighborIds: [],
      geometry: feature.geometry,
      center: feature.center ?? computeGeometryRepresentativePoint(feature.geometry),
      bbox: feature.bbox ?? computeGeometryBBox(feature.geometry),
      properties: {
        name: feature.name,
        territory: {
          adminLevel: input.level,
          sourceAdminLevel: input.level,
          semanticType: featureSemanticType,
          localType: feature.localType,
          ...(levelConfig?.localTypeName ? { localTypeName: levelConfig.localTypeName } : {}),
          hierarchyDepth: getAdminLevelDepth(input.level),
          ...(feature.parentSourceId ? { sourceParentId: feature.parentSourceId } : {}),
          ...(featureSourceClass ? { sourceClass: featureSourceClass } : {}),
          ...(featureBoundaryKind ? { boundaryKind: featureBoundaryKind } : {}),
          ...(featureBoundarySourceClass
            ? { boundarySourceClass: featureBoundarySourceClass }
            : {}),
          ...(featureConfidence ? { confidence: featureConfidence } : {}),
          ...(featureAdministrative !== undefined ? { administrative: featureAdministrative } : {}),
          ...(featureProviderId ? { providerId: featureProviderId } : {}),
          ...(featureProviderName ? { providerName: featureProviderName } : {}),
          ...(featureOfficial !== undefined ? { official: featureOfficial } : {}),
          ...(featureGenerated !== undefined ? { generated: featureGenerated } : {}),
          ...(featureSourceId ? { sourceId: featureSourceId } : {}),
          ...(featureSourceNativeId ? { sourceNativeId: featureSourceNativeId } : {}),
          ...(featureSourceVersion ? { sourceVersion: featureSourceVersion } : {}),
          ...(featureSourceSnapshotChecksum
            ? { sourceSnapshotChecksum: featureSourceSnapshotChecksum }
            : {}),
          ...(featureLicenseState ? { licenseState: featureLicenseState } : {}),
          ...(featureGeometryHash ? { geometryHash: featureGeometryHash } : {}),
          ...(featureParentAdm2Id ? { parentAdm2Id: featureParentAdm2Id } : {}),
          semanticReviewStatus:
            levelConfig?.reviewStatus === "reviewed" ? "reviewed" : "mapping-review-required",
          coverageStatus: featureSourceClass === "generated" ? "generated" : "verified",
          codes: {
            ...identity.officialCodes,
            ...(input.level === "ADM0" ? { iso3166_1: input.config.countryCodeAlpha2 } : {})
          },
          names: {
            default: feature.name,
            ...(input.config.defaultLocale ? { [input.config.defaultLocale]: feature.name } : {})
          },
          source: {
            provider: featureSourceProvider,
            ...(featureSourceClass ? { sourceClass: featureSourceClass } : {}),
            ...(featureBoundarySourceClass
              ? { boundarySourceClass: featureBoundarySourceClass }
              : {}),
            ...(featureProviderId ? { providerId: featureProviderId } : {}),
            ...(featureProviderName ? { providerName: featureProviderName } : {}),
            ...(featureSourceId ? { sourceId: featureSourceId } : {}),
            ...(featureSourceUrl ? { sourceUrl: featureSourceUrl } : {}),
            ...(featureSourceDate ? { sourceDate: featureSourceDate } : {}),
            ...(featureSourceNativeId ? { sourceNativeId: featureSourceNativeId } : {}),
            ...(featureSourceVersion ? { sourceVersion: featureSourceVersion } : {}),
            ...(featureSourceSnapshotChecksum
              ? { sourceSnapshotChecksum: featureSourceSnapshotChecksum }
              : {}),
            ...(featureLicenseState ? { licenseState: featureLicenseState } : {}),
            ...(featureLicense ? { license: featureLicense } : {}),
            ...(featureAttribution ? { attribution: featureAttribution } : {}),
            importedAt: input.buildDate
          },
          ...(adm3ProvinceCode
            ? {
                adm3: {
                  provinceCode: adm3ProvinceCode,
                  ...(adm3ProvinceName ? { provinceName: adm3ProvinceName } : {}),
                  providerId: featureSourceProvider
                }
              }
            : {}),
          nameProvenance: {
            default: {
              value: feature.name,
              sourceProperty: levelConfig?.sourceNameProperty ?? "shapeName"
            }
          }
        }
      }
    };

    return {
      zone,
      identity,
      ...(feature.parentSourceId ? { sourceParentId: feature.parentSourceId } : {}),
      ...(feature.sourceId ? { sourceId: feature.sourceId } : {}),
      ...(feature.officialCode ? { officialCode: feature.officialCode } : {})
    };
  });
}

function countBy(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return counts;
}

function createIdentityCollisionDisambiguator(feature: ParsedCountryFeature): string {
  const representativePoint = computeGeometryRepresentativePoint(feature.geometry);
  const bbox = computeGeometryBBox(feature.geometry);
  const parts = [
    feature.sourceId,
    feature.rawFeatureId,
    feature.parentSourceId,
    feature.localType,
    feature.name,
    `pt:${quantizeCoordinate(representativePoint[0])}:${quantizeCoordinate(representativePoint[1])}`,
    `bbox:${bbox.map(quantizeCoordinate).join(":")}`
  ].filter((part): part is string => Boolean(part));

  return parts.join("|");
}

function quantizeCoordinate(value: number): string {
  return value.toFixed(5);
}

function createLevelDatasets(
  config: ReturnType<typeof getTerritoryCountryConfig>,
  builtByLevel: Partial<Record<TerritoryAdminLevel, BuiltCountryZone[]>>,
  context: { buildDate: string; sourceDates: Record<string, string>; releaseType?: string },
  options: { standalone: boolean }
): Partial<Record<TerritoryAdminLevel, TerritoryDataset>> {
  return Object.fromEntries(
    Object.entries(builtByLevel).map(([level, built]) => [
      level,
      createDataset(
        config,
        built.map((item) => (options.standalone ? toStandaloneLevelZone(item.zone) : item.zone)),
        {
          datasetId: `${config.datasetId}-${level.toLowerCase()}`,
          adminLevels: [level as TerritoryAdminLevel],
          buildDate: context.buildDate,
          sourceDate: context.sourceDates[level] ?? "unknown",
          ...(context.releaseType ? { releaseType: context.releaseType } : {})
        }
      )
    ])
  ) as Partial<Record<TerritoryAdminLevel, TerritoryDataset>>;
}

function toStandaloneLevelZone(zone: TerritoryZone): TerritoryZone {
  const { childIds: _childIds, parentId: _parentId, ...standaloneZone } = zone;
  return standaloneZone;
}

function createCombinedDataset(
  config: ReturnType<typeof getTerritoryCountryConfig>,
  built: readonly BuiltCountryZone[],
  context: { buildDate: string; sourceDates: Record<string, string>; releaseType?: string }
): TerritoryDataset {
  return createDataset(
    config,
    built.map((item) => ({ ...item.zone, datasetId: config.datasetId })),
    {
      datasetId: config.datasetId,
      adminLevels: normalizeLevels([
        ...new Set(built.map((item) => `ADM${item.zone.level}` as TerritoryAdminLevel))
      ]),
      buildDate: context.buildDate,
      sourceDate: Object.values(context.sourceDates).sort().join(",") || "unknown",
      ...(context.releaseType ? { releaseType: context.releaseType } : {})
    }
  );
}

function createDataset(
  config: ReturnType<typeof getTerritoryCountryConfig>,
  zones: readonly TerritoryZone[],
  options: {
    datasetId: string;
    adminLevels: TerritoryAdminLevel[];
    buildDate: string;
    sourceDate: string;
    releaseType?: string;
  }
): TerritoryDataset {
  const dataset: TerritoryDataset = {
    manifest: {
      datasetId: options.datasetId,
      datasetVersion: "0.1.0",
      schemaVersion: TERRITORY_SCHEMA_VERSION,
      sourceDate: options.sourceDate,
      geometryHash: "pending",
      adminLevels: options.adminLevels,
      artifactChecksum: "recorded-in-country-checksums",
      attribution: `${config.sourceProvider} ${config.countryCodeAlpha2}`,
      boundaryPolicy: "source-boundaries-without-political-reconciliation",
      buildDate: options.buildDate,
      countryCodes: [config.countryCodeAlpha2.toLowerCase()],
      crs: "EPSG:4326",
      disputedAreaPolicy: "source-disputed-boundaries-not-authoritative",
      geometryDetail: "source",
      license: config.sourceProvider === "hdx-cod-ab" ? "CC BY-IGO" : "CC BY 4.0",
      name: `${config.displayName} ${options.adminLevels.join(",")}`,
      description: "Country dataset generated from locked source artifacts.",
      sourceProvider: config.sourceProvider,
      worldview: "source"
    },
    zones: [...zones].sort((left, right) => left.id.localeCompare(right.id))
  };

  return {
    ...dataset,
    manifest: {
      ...dataset.manifest,
      geometryHash: createDatasetGeometryHash(dataset),
      artifactChecksum: sha256Hex(JSON.stringify(dataset.zones))
    }
  };
}

function createQualityReport(
  levelDatasets: Partial<Record<TerritoryAdminLevel, TerritoryDataset>>,
  combinedDataset: TerritoryDataset
): TerritoryCountryQualityReport {
  const checks = {
    coordinates: true,
    rings: true,
    selfIntersections: false,
    holes: false,
    bbox: true,
    center: true,
    antimeridian: true,
    parentContainment: false,
    siblingOverlaps: false
  };

  return {
    qualityVersion: "1",
    levels: Object.fromEntries(
      Object.entries(levelDatasets).map(([level, dataset]) => [
        level,
        validateGeometryDataset(dataset as TerritoryDataset, { checks })
      ])
    ) as Partial<Record<TerritoryAdminLevel, ReturnType<typeof validateGeometryDataset>>>,
    combined: validateGeometryDataset(combinedDataset, { checks })
  };
}

async function buildAdjacencyArtifacts(
  config: ReturnType<typeof getTerritoryCountryConfig>,
  levelDatasets: Partial<Record<TerritoryAdminLevel, TerritoryDataset>>,
  context: {
    buildDate: string;
    publishedLevelDatasets: Partial<Record<TerritoryAdminLevel, TerritoryDataset>>;
    batchSize?: number;
    issues: TerritoryCountryBuildIssue[];
  }
) {
  const artifacts: Partial<
    Record<TerritoryAdminLevel, Awaited<ReturnType<typeof buildTerritoryAdjacency>>["artifact"]>
  > = {};
  const reports: Partial<
    Record<TerritoryAdminLevel, Awaited<ReturnType<typeof buildTerritoryAdjacency>>>
  > = {};

  for (const level of config.adjacencyPolicy.levels) {
    const dataset = levelDatasets[level];

    if (!dataset) {
      continue;
    }

    const result = await buildTerritoryAdjacency(dataset, {
      includePointTouches: config.adjacencyPolicy.includePointTouches,
      minimumSharedBoundaryMeters: config.adjacencyPolicy.minimumSharedBoundaryMeters,
      buildDate: context.buildDate,
      ...(context.batchSize ? { batchSize: context.batchSize } : {})
    });
    context.issues.push(
      ...result.issues.map((issue) => ({
        code: issue.code,
        severity: issue.code.startsWith("QUALITY_") ? ("warning" as const) : issue.severity,
        message: issue.message,
        level
      }))
    );
    const publishedDataset = context.publishedLevelDatasets[level];
    artifacts[level] = publishedDataset
      ? rebaseAdjacencyArtifactToDataset(result.artifact, publishedDataset)
      : result.artifact;
    reports[level] = {
      ...result,
      artifact: artifacts[level] ?? result.artifact
    };
  }

  return { artifacts, reports };
}

function rebaseAdjacencyArtifactToDataset(
  artifact: TerritoryAdjacencyArtifact,
  dataset: TerritoryDataset
): TerritoryAdjacencyArtifact {
  const rebased = {
    ...artifact,
    dataset: {
      id: dataset.manifest.datasetId,
      version: dataset.manifest.datasetVersion,
      contentHash: dataset.manifest.geometryHash
    }
  };

  return {
    ...rebased,
    contentHash: computeTerritoryAdjacencyContentHash(rebased)
  };
}

function evaluatePublishReadyFailures(input: {
  config: ReturnType<typeof getTerritoryCountryConfig>;
  issues: readonly TerritoryCountryBuildIssue[];
  qualityReport: TerritoryCountryQualityReport;
  hierarchyReport: ReturnType<typeof resolveTerritoryCountryHierarchy>;
  identityMap: TerritoryIdentityMap;
  unavailableLevels: readonly TerritoryAdminLevel[];
}): string[] {
  const failures: string[] = [];
  const geometryErrorCount = collectGeometryCounts(input.qualityReport).errors;
  const geometryWarningCount = collectGeometryCounts(input.qualityReport).warnings;
  const fallbackRatio =
    input.identityMap.entries.length === 0
      ? 0
      : input.identityMap.entries.filter((entry) => entry.stability === "name-parent-fallback")
          .length / input.identityMap.entries.length;

  if (input.config.qualityPolicy.rejectGeometryErrors && geometryErrorCount > 0) {
    failures.push("geometry-errors");
  }

  if (
    input.config.qualityPolicy.rejectUnresolvedParents &&
    input.hierarchyReport.summary.unresolvedCount > 0
  ) {
    failures.push("unresolved-parents");
  }

  if (
    input.config.qualityPolicy.rejectAmbiguousParents &&
    input.hierarchyReport.summary.ambiguousCount > 0
  ) {
    failures.push("ambiguous-parents");
  }

  if (
    input.config.qualityPolicy.maximumFallbackIdentityRatio !== undefined &&
    fallbackRatio > input.config.qualityPolicy.maximumFallbackIdentityRatio
  ) {
    failures.push("fallback-identity-ratio");
  }

  if (
    input.config.qualityPolicy.maximumGeometryWarningCount !== undefined &&
    geometryWarningCount > input.config.qualityPolicy.maximumGeometryWarningCount
  ) {
    failures.push("geometry-warning-count");
  }

  if (input.unavailableLevels.length > 0) {
    failures.push("unavailable-required-levels");
  }

  if (input.issues.some((issue) => issue.severity === "error")) {
    failures.push("build-errors");
  }

  return [...new Set(failures)].sort();
}

function summarizeGeometryRepairReport(
  report: TerritoryGeometryRepairReport
): TerritoryCountryGeometryRepairSummary {
  return {
    engine: report.engine,
    engineVersion: report.engineVersion,
    mode: report.mode,
    precision: report.precision,
    featuresRepaired: report.featuresRepaired,
    featuresUnchanged: report.featuresUnchanged,
    featuresRejected: report.featuresRejected,
    areaDifference: report.areaDifference,
    componentsDiscarded: report.componentsDiscarded
  };
}

function createBuildStatistics(input: {
  config: ReturnType<typeof getTerritoryCountryConfig>;
  requestedLevels: TerritoryAdminLevel[];
  unavailableLevels: TerritoryAdminLevel[];
  levelDatasets: Partial<Record<TerritoryAdminLevel, TerritoryDataset>>;
  allBuilt: readonly BuiltCountryZone[];
  hierarchyReport: ReturnType<typeof resolveTerritoryCountryHierarchy>;
  qualityReport: TerritoryCountryQualityReport;
  adjacencyArtifacts: Partial<
    Record<TerritoryAdminLevel, Awaited<ReturnType<typeof buildTerritoryAdjacency>>["artifact"]>
  >;
  adjacencyReports: Partial<
    Record<TerritoryAdminLevel, Awaited<ReturnType<typeof buildTerritoryAdjacency>>>
  >;
  repairReportsByLevel: Partial<Record<TerritoryAdminLevel, TerritoryGeometryRepairReport>>;
  sourceBytesByLevel: Partial<Record<TerritoryAdminLevel, number>>;
  publishReady: boolean;
}): TerritoryCountryBuildStatistics {
  const qualityCounts = collectGeometryCounts(input.qualityReport);
  const repairSummaries = Object.values(input.repairReportsByLevel).map((report) =>
    summarizeGeometryRepairReport(report)
  );

  return {
    countryCode: input.config.countryCodeAlpha2,
    requestedLevels: input.requestedLevels,
    builtLevels: normalizeLevels(Object.keys(input.levelDatasets) as TerritoryAdminLevel[]),
    unavailableLevels: input.unavailableLevels,
    sourceArtifactCount: Object.keys(input.sourceBytesByLevel).length,
    sourceBytes: Object.values(input.sourceBytesByLevel).reduce(
      (sum, value) => sum + (value ?? 0),
      0
    ),
    featureCountByLevel: Object.fromEntries(
      Object.entries(input.levelDatasets).map(([level, dataset]) => [
        level,
        dataset?.zones.length ?? 0
      ])
    ),
    polygonCount: input.allBuilt.filter((built) => built.zone.geometry.type === "Polygon").length,
    multiPolygonCount: input.allBuilt.filter((built) => built.zone.geometry.type === "MultiPolygon")
      .length,
    coordinateCount: input.allBuilt.reduce(
      (sum, built) => sum + countGeometryCoordinates(built.zone.geometry),
      0
    ),
    officialCodeIdentityCount: input.allBuilt.filter(
      (built) => built.identity.stability === "official-code"
    ).length,
    sourceIdentityCount: input.allBuilt.filter((built) => built.identity.stability === "source-id")
      .length,
    fallbackIdentityCount: input.allBuilt.filter(
      (built) => built.identity.stability === "name-parent-fallback"
    ).length,
    explicitParentCount: input.hierarchyReport.summary.explicitParentCount,
    spatialParentCount: input.hierarchyReport.summary.spatialParentCount,
    unresolvedParentCount: input.hierarchyReport.summary.unresolvedCount,
    ambiguousParentCount: input.hierarchyReport.summary.ambiguousCount,
    geometryErrorCount: qualityCounts.errors,
    geometryWarningCount: qualityCounts.warnings,
    geometryRepairedFeatureCount: repairSummaries.reduce(
      (sum, summary) => sum + summary.featuresRepaired,
      0
    ),
    geometryRejectedFeatureCount: repairSummaries.reduce(
      (sum, summary) => sum + summary.featuresRejected,
      0
    ),
    geometryRepairDiscardedComponentCount: repairSummaries.reduce(
      (sum, summary) => sum + summary.componentsDiscarded,
      0
    ),
    adjacencyEdgeCountByLevel: Object.fromEntries(
      Object.entries(input.adjacencyArtifacts).map(([level, artifact]) => [
        level,
        artifact?.edges.length ?? 0
      ])
    ),
    adjacencyStatisticsByLevel: Object.fromEntries(
      Object.entries(input.adjacencyReports).map(([level, report]) => [level, report?.statistics])
    ),
    artifactBytes: 0,
    publishReady: input.publishReady
  };
}

function createCountryArtifactFiles(input: {
  config: ReturnType<typeof getTerritoryCountryConfig>;
  sourceLock: TerritoryCountrySourceLock;
  levelDatasets: Partial<Record<TerritoryAdminLevel, TerritoryDataset>>;
  combinedDataset: TerritoryDataset;
  builtZones: readonly BuiltCountryZone[];
  identityMap: TerritoryIdentityMap;
  hierarchyReport: ReturnType<typeof resolveTerritoryCountryHierarchy>;
  qualityReport: TerritoryCountryQualityReport;
  adjacencyArtifacts: Partial<
    Record<TerritoryAdminLevel, Awaited<ReturnType<typeof buildTerritoryAdjacency>>["artifact"]>
  >;
  adjacencyReports: Partial<
    Record<TerritoryAdminLevel, Awaited<ReturnType<typeof buildTerritoryAdjacency>>>
  >;
  repairReportsByLevel: Partial<Record<TerritoryAdminLevel, TerritoryGeometryRepairReport>>;
  buildReport: TerritoryCountryBuildReport;
  buildDate: string;
  sourceDates: Record<string, string>;
  publishReady: boolean;
  publishReadyFailures: string[];
  buildQueryArtifacts: boolean;
  buildRenderArtifacts: boolean;
  buildBinaryIndex: boolean;
  turkeyAdm3?: {
    extension: TurkeyAdm3SourceLockExtension;
    allowPartial: boolean;
    provinceStatuses?: Record<string, TurkeyAdm3ProvinceBuildStatus>;
    qualityReport?: TurkeyAdm3QualityGateReport;
    provenanceReport?: TurkeyAdm3ProvenanceReport;
  };
}): Map<string, string | Uint8Array> {
  const files = new Map<string, string | Uint8Array>();

  files.set("sources.lock.json", serializeJsonStable(input.sourceLock));
  files.set("identity-map.json", serializeJsonStable(input.identityMap));
  files.set(
    "identity-diff-report.json",
    serializeJsonStable(createInitialIdentityDiffReport(input.identityMap))
  );
  files.set("hierarchy-report.json", serializeJsonStable(input.hierarchyReport));
  files.set("quality-report.json", serializeJsonStable(input.qualityReport));
  files.set("build-report.json", serializeJsonStable(input.buildReport));
  files.set("dataset.json", serializeJsonArtifact(input.combinedDataset));
  files.set("attribution.txt", createAttributionText(input.sourceLock));
  files.set("attribution.json", serializeJsonStable(createAttributionJson(input.sourceLock)));
  files.set("index.json", serializeJsonArtifact(createSpatialIndex(input.combinedDataset)));

  if (input.turkeyAdm3) {
    files.set(
      "coverage.json",
      serializeJsonStable(
        createTurkeyAdm3CoverageManifest({
          generatedAt: input.buildDate,
          extension: input.turkeyAdm3.extension,
          zones: input.builtZones,
          allowPartial: input.turkeyAdm3.allowPartial,
          ...(input.turkeyAdm3.provinceStatuses
            ? { provinceStatuses: input.turkeyAdm3.provinceStatuses }
            : {})
        })
      )
    );

    if (input.turkeyAdm3.qualityReport) {
      files.set("adm3-quality-gates.json", serializeJsonStable(input.turkeyAdm3.qualityReport));
    }

    if (input.turkeyAdm3.provenanceReport) {
      files.set(
        "adm3-source-provenance-report.json",
        serializeJsonStable(input.turkeyAdm3.provenanceReport)
      );
    }
  }

  if (input.buildQueryArtifacts) {
    files.set(
      "query/query-artifact.json",
      serializeJsonArtifact(
        createTerritoryQueryArtifact(input.combinedDataset, {
          datasetContentHash: input.combinedDataset.manifest.geometryHash
        })
      )
    );
  }

  if (input.buildBinaryIndex) {
    addBinaryIndexFiles(files, "index", input.combinedDataset);
  }

  if (input.buildRenderArtifacts) {
    for (const [relativePath, content] of buildTerritoryRenderArtifacts({
      dataset: input.combinedDataset,
      buildDate: input.buildDate,
      policies: DEFAULT_TERRITORY_RENDER_LEVEL_POLICY
    }).files) {
      files.set(relativePath, content);
    }
  }

  for (const [levelName, dataset] of Object.entries(input.levelDatasets).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    if (dataset) {
      const level = levelName as TerritoryAdminLevel;
      files.set(`levels/${level}/dataset.json`, serializeJsonArtifact(dataset));
      files.set(
        `levels/${level}/full.geojson`,
        serializeJsonArtifact(datasetToFeatureCollection(dataset))
      );
      files.set(`levels/${level}/index.json`, serializeJsonArtifact(createSpatialIndex(dataset)));
      if (input.buildQueryArtifacts) {
        files.set(
          `levels/${level}/query/query-artifact.json`,
          serializeJsonArtifact(
            createTerritoryQueryArtifact(dataset, {
              datasetContentHash: dataset.manifest.geometryHash
            })
          )
        );
      }
      if (input.buildBinaryIndex) {
        addBinaryIndexFiles(files, `levels/${level}/index`, dataset);
      }
      files.set(
        `levels/${level}/validation-report.json`,
        serializeJsonStable(
          createDatasetValidationReport(dataset, input.qualityReport.levels[level])
        )
      );
      files.set(
        `levels/${level}/simplification-report.json`,
        serializeJsonStable(createSimplificationReport(level as TerritoryAdminLevel, dataset))
      );
      files.set(
        `levels/${level}/manifest.json`,
        serializeJsonStable(createLevelArtifactManifest(level as TerritoryAdminLevel, dataset))
      );
    }
  }

  for (const [level, artifact] of Object.entries(input.adjacencyArtifacts).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    if (artifact) {
      const report = input.adjacencyReports[level as TerritoryAdminLevel];
      files.set(`adjacency/${level}/adjacency.json`, serializeTerritoryAdjacencyArtifact(artifact));
      files.set(
        `adjacency/${level}/build-report.json`,
        serializeJsonStable({
          ok: true,
          statistics: report?.statistics ?? artifact.statistics,
          issues: report?.issues ?? []
        })
      );
      files.set(
        `adjacency/${level}/checksums.json`,
        serializeJsonStable({
          "adjacency.json": artifact.contentHash
        })
      );
    }
  }
  files.set(
    "adjacency-report.json",
    serializeJsonStable({
      reportVersion: "1",
      levels: Object.fromEntries(
        Object.entries(input.adjacencyReports)
          .filter(([, report]) => Boolean(report))
          .map(([level, report]) => [
            level,
            {
              ok: report!.issues.every((issue) => issue.severity !== "error"),
              statistics: report!.statistics,
              issueCount: report!.issues.length
            }
          ])
      )
    })
  );

  const artifactChecksums = Object.fromEntries(
    [...files.entries()].map(([path, content]) => [path, sha256Hex(content)])
  );
  const sourceVersion = summarizeSourceVersions(input.sourceLock);
  const manifest: TerritoryCountryDatasetManifest = {
    manifestVersion: "1",
    datasetId: input.config.datasetId,
    datasetVersion: "0.1.0",
    schemaVersion: TERRITORY_SCHEMA_VERSION,
    country: {
      alpha2: input.config.countryCodeAlpha2,
      alpha3: input.config.countryCodeAlpha3,
      name: input.config.displayName
    },
    sourceProvider: input.config.sourceProvider,
    ...(input.sourceLock.releaseType ? { releaseType: input.sourceLock.releaseType } : {}),
    ...(sourceVersion ? { sourceVersion } : {}),
    sourceLockHash: computeTerritoryCountrySourceLockHash(input.sourceLock),
    supportedLevels: normalizeLevels(Object.keys(input.levelDatasets) as TerritoryAdminLevel[]),
    unavailableLevels: normalizeLevels(
      Object.values(input.sourceLock.levels)
        .filter(
          (level) =>
            level.status === "unavailable" &&
            !input.levelDatasets[level.adminLevel as TerritoryAdminLevel]
        )
        .map((level) => level.adminLevel)
    ),
    featureCountByLevel: Object.fromEntries(
      Object.entries(input.levelDatasets).map(([level, dataset]) => [
        level,
        dataset?.zones.length ?? 0
      ])
    ),
    identityStabilitySummary: summarizeIdentityStability(input.identityMap.entries),
    hierarchySummary: input.hierarchyReport.summary,
    geometryQualitySummary: {
      errorCount: collectGeometryCounts(input.qualityReport).errors,
      warningCount: collectGeometryCounts(input.qualityReport).warnings
    },
    geometryRepairSummary: Object.fromEntries(
      Object.entries(input.repairReportsByLevel).map(([level, report]) => [
        level,
        summarizeGeometryRepairReport(report)
      ])
    ) as Partial<Record<TerritoryAdminLevel, TerritoryCountryGeometryRepairSummary>>,
    adjacencySummary: Object.fromEntries(
      Object.entries(input.adjacencyArtifacts).map(([level, artifact]) => [
        level,
        { edgeCount: artifact?.edges.length ?? 0 }
      ])
    ),
    license: aggregateLicense(input.sourceLock),
    attribution: createAttributionText(input.sourceLock).trim(),
    sourceDates: input.sourceDates,
    buildDate: input.buildDate,
    boundaryPolicy: "source-boundaries-without-political-reconciliation",
    worldview: "source",
    disputedAreaPolicy: "source-disputed-boundaries-not-authoritative",
    artifacts: Object.fromEntries([...files.keys()].map((path) => [path, path])),
    artifactChecksums,
    publishReady: input.publishReady,
    publishReadyFailures: input.publishReadyFailures
  };

  files.set("manifest.json", serializeJsonStable(manifest));
  const allChecksums = Object.fromEntries(
    [...files.entries()].map(([path, content]) => [path, sha256Hex(content)])
  );
  files.set(
    "checksums.json",
    serializeJsonStable({
      algorithm: "sha256",
      files: allChecksums
    })
  );

  return new Map([...files.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function serializeJsonArtifact(input: unknown): string {
  return `${JSON.stringify(input, null, 2)}\n`;
}

function datasetToFeatureCollection(dataset: TerritoryDataset): Record<string, unknown> {
  return {
    type: "FeatureCollection",
    features: dataset.zones.map((zone) => ({
      type: "Feature",
      id: zone.id,
      properties: {
        ...zone.properties,
        id: zone.id,
        countryCode: zone.countryCode,
        level: zone.level,
        sourceAdminLevel: zone.sourceAdminLevel,
        semanticType: zone.semanticType,
        name: zone.name,
        localName: zone.localName,
        parentId: zone.parentId,
        childIds: zone.childIds ?? [],
        neighborIds: zone.neighborIds
      },
      geometry: zone.geometry
    }))
  };
}

function createSpatialIndex(dataset: TerritoryDataset): Record<string, unknown> {
  return {
    indexVersion: "1",
    algorithm: "bbox-linear",
    datasetId: dataset.manifest.datasetId,
    datasetVersion: dataset.manifest.datasetVersion,
    geometryHash: dataset.manifest.geometryHash,
    entries: dataset.zones.map((zone) => ({
      id: zone.id,
      countryCode: zone.countryCode,
      level: zone.level,
      sourceAdminLevel: zone.sourceAdminLevel,
      bbox: zone.bbox,
      center: zone.center
    }))
  };
}

function createInitialIdentityDiffReport(
  identityMap: TerritoryIdentityMap
): Record<string, unknown> {
  const added = identityMap.entries.map((entry) => entry.territoryId).sort();

  return {
    diffVersion: "1",
    previousIdentityMap: null,
    nextIdentityMap: "identity-map.json",
    summary: {
      unchanged: 0,
      added: added.length,
      removed: 0,
      sourceIdChanged: 0,
      nameChanged: 0,
      parentChanged: 0,
      ambiguousMatches: 0
    },
    diff: {
      unchanged: [],
      added,
      removed: [],
      sourceIdChanged: [],
      nameChanged: [],
      parentChanged: [],
      ambiguousMatches: []
    }
  };
}

function addBinaryIndexFiles(
  files: Map<string, string | Uint8Array>,
  outputDirectory: string,
  dataset: TerritoryDataset
): void {
  const index = encodeTerritoryBinarySpatialIndex(dataset);
  const metadata = inspectTerritoryBinarySpatialIndex(index);

  files.set(`${outputDirectory}/index.tksi`, new Uint8Array(index));
  files.set(
    `${outputDirectory}/index-metadata.json`,
    serializeJsonStable({
      indexVersion: metadata.schemaVersion,
      datasetId: metadata.datasetId,
      datasetVersion: metadata.datasetVersion,
      geometryHash: metadata.geometryHash,
      indexHash: metadata.indexHash,
      zoneCount: metadata.zoneCount,
      bboxRecordCount: metadata.bboxRecordCount,
      byteLength: metadata.byteLength,
      levels: metadata.levels
    })
  );
}

function createDatasetValidationReport(
  dataset: TerritoryDataset,
  geometryReport?: ReturnType<typeof validateGeometryDataset>
): Record<string, unknown> {
  const checks = {
    coordinates: true,
    rings: true,
    selfIntersections: false,
    holes: false,
    bbox: true,
    center: true,
    antimeridian: true,
    parentContainment: false,
    siblingOverlaps: false
  };

  return {
    reportVersion: "1",
    dataset: {
      ok: true,
      issueCount: 0,
      issues: [],
      validationMode: "generated-dataset-invariants",
      zoneCount: dataset.zones.length,
      geometryHash: dataset.manifest.geometryHash
    },
    geometry: geometryReport ?? validateGeometryDataset(dataset, { checks })
  };
}

function createSimplificationReport(
  level: TerritoryAdminLevel,
  dataset: TerritoryDataset
): Record<string, unknown> {
  return {
    reportVersion: "1",
    level,
    variants: {
      full: {
        path: "full.geojson",
        featureCount: dataset.zones.length,
        simplification: "source-geometry"
      }
    },
    omittedVariants: {
      medium: "not-generated-without-real-simplification",
      low: "not-generated-without-real-simplification"
    },
    note: "Country artifacts publish only source/full geometry unless a topology-safe simplification run creates distinct tier hashes."
  };
}

function createLevelArtifactManifest(
  level: TerritoryAdminLevel,
  dataset: TerritoryDataset
): Record<string, unknown> {
  return {
    manifestVersion: "1",
    datasetId: dataset.manifest.datasetId,
    datasetVersion: dataset.manifest.datasetVersion,
    schemaVersion: dataset.manifest.schemaVersion,
    level,
    featureCount: dataset.zones.length,
    geometryHash: dataset.manifest.geometryHash,
    artifacts: {
      dataset: "dataset.json",
      full: "full.geojson",
      index: "index.json",
      validationReport: "validation-report.json",
      simplificationReport: "simplification-report.json"
    }
  };
}

function createAttributionJson(sourceLock: TerritoryCountrySourceLock): Record<string, unknown> {
  return {
    attributionVersion: "1",
    providerId: sourceLock.provider,
    releaseType: sourceLock.releaseType,
    country: sourceLock.country,
    levels: Object.fromEntries(
      Object.entries(sourceLock.levels).map(([level, entry]) => [
        level,
        {
          providerId: sourceLock.provider,
          sourceUrl: entry?.sourceUrl ?? entry?.sourcePath,
          resolvedDownloadUrl: entry?.resolvedDownloadUrl ?? entry?.sourceUrl ?? entry?.sourcePath,
          downloadUrl: entry?.resolvedDownloadUrl ?? entry?.sourceUrl ?? entry?.sourcePath,
          licence: entry?.license,
          licenceUrl: entry?.licenseUrl,
          attribution: entry?.attribution,
          redistributionStatus:
            entry?.redistributionStatus ??
            (entry?.status === "available" ? "source-defined" : false),
          commercialUseStatus:
            entry?.commercialUseStatus ??
            (entry?.status === "available" ? "source-defined" : false),
          sourceDate: entry?.sourceDate ?? entry?.boundaryYearRepresented,
          downloadDate: sourceLock.resolvedAt,
          originalFilename: entry?.originalFilename,
          originalFormat: entry?.originalFormat,
          originalChecksum: entry?.sha256,
          country: sourceLock.country.alpha2,
          sourceAdministrativeLevel: entry?.adminLevel,
          sourceFeatureCount: entry?.sourceFeatureCount
        }
      ])
    )
  };
}

function groupBuiltZonesByLevel(
  built: readonly BuiltCountryZone[]
): Partial<Record<TerritoryAdminLevel, BuiltCountryZone[]>> {
  const grouped: Partial<Record<TerritoryAdminLevel, BuiltCountryZone[]>> = {};

  for (const item of built) {
    const level = `ADM${item.zone.level}` as TerritoryAdminLevel;
    grouped[level] = [...(grouped[level] ?? []), item];
  }

  return Object.fromEntries(
    Object.entries(grouped).map(([level, values]) => [
      level,
      (values ?? []).sort((left, right) => left.zone.id.localeCompare(right.zone.id))
    ])
  ) as Partial<Record<TerritoryAdminLevel, BuiltCountryZone[]>>;
}

function readGeometry(input: unknown): TerritoryGeometry | undefined {
  if (!isRecord(input) || (input.type !== "Polygon" && input.type !== "MultiPolygon")) {
    return undefined;
  }

  return input as unknown as TerritoryGeometry;
}

function readFeatureId(feature: Record<string, unknown>): string | undefined {
  const id = feature.id;
  return typeof id === "string" || typeof id === "number" ? String(id) : undefined;
}

function readFirstProperty(
  properties: Record<string, unknown>,
  paths: readonly string[]
): string | undefined {
  for (const path of paths) {
    const value = readStringPropertyPath(properties, path);

    if (value) {
      return value;
    }
  }

  return undefined;
}

function readAdm3SemanticType(
  properties: Record<string, unknown>
): TerritoryZone["semanticType"] | undefined {
  const value = readStringPropertyPath(properties, "territorykit.semanticType");

  if (!value) {
    return undefined;
  }

  return value as TerritoryZone["semanticType"];
}

function readBooleanPropertyPath(
  properties: Record<string, unknown>,
  path: string
): boolean | undefined {
  const parts = path.split(".").filter(Boolean);
  let current: unknown = properties;

  for (const part of parts) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[part];
  }

  return typeof current === "boolean" ? current : undefined;
}

function normalizeLocalType(rawLocalType: string, expectedTypes: readonly string[]): string {
  if (expectedTypes.includes(rawLocalType)) {
    return rawLocalType;
  }

  return expectedTypes.at(-1) ?? "administrative-unit";
}

function normalizeLevels(levels: readonly TerritoryAdminLevel[]): TerritoryAdminLevel[] {
  return [...levels].sort((left, right) => Number(left.slice(3)) - Number(right.slice(3)));
}

function collectGeometryCounts(qualityReport: TerritoryCountryQualityReport): {
  errors: number;
  warnings: number;
} {
  const reports = [
    ...Object.values(qualityReport.levels).filter(Boolean),
    ...(qualityReport.combined ? [qualityReport.combined] : [])
  ];

  return {
    errors: reports.reduce((sum, report) => sum + report.summary.errorCount, 0),
    warnings: reports.reduce((sum, report) => sum + report.summary.warningCount, 0)
  };
}

function countGeometryCoordinates(geometry: TerritoryGeometry): number {
  if (geometry.type === "Polygon") {
    return geometry.coordinates.flat(1).length;
  }

  return geometry.coordinates.flat(2).length;
}

function createAttributionText(sourceLock: TerritoryCountrySourceLock): string {
  return [
    ...new Set(
      Object.values(sourceLock.levels)
        .flatMap((level) =>
          level.attribution ? [`${level.adminLevel}: ${level.attribution}`] : []
        )
        .sort()
    )
  ].join("\n");
}

function aggregateLicense(sourceLock: TerritoryCountrySourceLock): string {
  const licenses = [
    ...new Set(
      Object.values(sourceLock.levels).flatMap((level) => (level.license ? [level.license] : []))
    )
  ].sort();

  return licenses.length === 0 ? "unknown" : licenses.join("; ");
}

function summarizeSourceVersions(sourceLock: TerritoryCountrySourceLock): string | undefined {
  const versions = [
    ...new Set(
      Object.values(sourceLock.levels).flatMap((level) =>
        level.sourceVersion ? [level.sourceVersion] : []
      )
    )
  ].sort();

  return versions.length > 0 ? versions.join(",") : undefined;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
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

function compareIssues(
  left: TerritoryCountryBuildIssue,
  right: TerritoryCountryBuildIssue
): number {
  return (
    (left.level ?? "").localeCompare(right.level ?? "") ||
    (left.zoneId ?? "").localeCompare(right.zoneId ?? "") ||
    left.code.localeCompare(right.code)
  );
}
