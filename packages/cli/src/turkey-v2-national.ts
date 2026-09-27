import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeTerritoryAreaM2 } from "@territory-kit/dataset";
import type { TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";
import {
  TURKEY_V2_NATIONAL_EXPECTED_COUNTS,
  TURKEY_SMART_FALLBACK_ALGORITHM_VERSION,
  TURKEY_V2_NATIONAL_DATASET_ID,
  buildTurkeyV2NationalDataset,
  createTurkeyV2NationalArtifactPayloads,
  createDatasetGeometryHash,
  createTurkeyV2NationalSourceLock,
  createTurkeyOsmSmartFallbackGeneratedOptions,
  readTurkeyOsmAdm2BarrierArtifact,
  verifyTurkeyOsmSnapshot,
  validateTurkeyV2NationalArtifactIntegrity,
  validateTurkeyV2NationalCompleteness
} from "@territory-kit/generators/turkey-adm3";
import type {
  TurkeyV2NationalAdmSourceLock,
  TurkeyV2NationalBuildResult,
  TurkeyV2NationalOutputMode,
  TurkeyV2NationalRealProviderLock,
  TurkeyV2HybridDistrictBuildResult,
  TurkeyV2HybridDistrictBuildOptions,
  TurkeyV2NationalSourceStatus
} from "@territory-kit/generators/turkey-adm3";

interface CliIssue {
  code: string;
  message: string;
  path?: string;
  artifactId?: string;
  expected?: string | number | boolean;
  actual?: string | number | boolean;
  severity: "error" | "warning";
}

const WORKSPACE_ROOT = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const DEFAULT_ADM0_ADM2_DATASET = workspacePath("datasets/generated/countries/TR/dataset.json");
const DEFAULT_NATIONAL_SOURCE = workspacePath("datasets/sources/TR/national.json");
const DEFAULT_OFFICIAL_ARTIFACT = workspacePath(
  ".territory/build/TR/ADM3/official/levels/ADM3/dataset.json"
);
const DEFAULT_OUTPUT = workspacePath(".territory/sprint-6/candidate");
const DEFAULT_REPORTS_OUTPUT = workspacePath("reports/tr-v2-smart-candidate");
const DEFAULT_BUILD_DATE = "2026-09-27T00:00:00.000Z";
const DEFAULT_SMART_CANDIDATE_VERSION = "2.1.0-rc.1";
const DISTRICT_CHECKPOINT_SCHEMA = "territorykit-tr-smart-district-checkpoint@4";

export async function runTurkeyV2(args: string[]): Promise<number> {
  const [subcommand] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printJson({
      ok: true,
      command: "tr v2",
      data: {
        commands: ["national"],
        usage: "territory tr v2 national <plan|build|publish-ready|validate|benchmark>"
      }
    });
    return 0;
  }

  if (subcommand === "national") {
    return runTurkeyV2National(args.slice(1));
  }

  printJson({
    ok: false,
    command: "tr v2",
    issues: [issue(`Unsupported Turkey V2 command '${subcommand}'.`)]
  });
  return 2;
}

export async function runTurkeyV2National(args: string[]): Promise<number> {
  const [subcommand = "plan", ...rest] = args;

  if (subcommand === "--help" || subcommand === "-h") {
    printHelp();
    return 0;
  }

  if (subcommand === "plan") {
    return runPlan(rest);
  }

  if (subcommand === "build" || subcommand === "publish-ready") {
    return runBuild(rest, subcommand);
  }

  if (subcommand === "validate") {
    return runValidate(rest);
  }

  if (subcommand === "benchmark") {
    return runBenchmark(rest);
  }

  printJson({
    ok: false,
    command: "tr v2 national",
    issues: [issue(`Unsupported Turkey V2 national command '${subcommand}'.`)]
  });
  return 2;
}

async function runPlan(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const admDataset = await readDataset(
    getFlag(flags, "adm0-adm2-dataset") ?? DEFAULT_ADM0_ADM2_DATASET
  );
  const source = await readNationalSource(
    getFlag(flags, "source-metadata") ?? DEFAULT_NATIONAL_SOURCE
  );
  const counts = countLevels(admDataset);
  const officialPath = resolveOptionalArtifactPath(
    flags,
    "official-artifact",
    DEFAULT_OFFICIAL_ARTIFACT
  );
  const osmPath = getFlag(flags, "osm-artifact");
  const seed = getFlag(flags, "seed") ?? "territory-kit-tr-v2-national";

  printJson({
    ok: true,
    command: "tr v2 national plan",
    data: {
      schemaVersion: "territorykit-tr-v2-national-plan@1",
      datasetId: TURKEY_V2_NATIONAL_DATASET_ID,
      datasetVersion: getFlag(flags, "dataset-version") ?? DEFAULT_SMART_CANDIDATE_VERSION,
      adm0Count: counts.ADM0,
      adm1Count: counts.ADM1,
      adm2Count: counts.ADM2,
      canonicalAdm2SourceCount: source.levels.ADM2.actualFeatureCount,
      officialStatus: officialPath ? "artifact-loaded" : "not-built",
      osmStatus: osmPath && existsSync(resolve(osmPath)) ? "artifact-loaded" : "not-built",
      generatedStatus: flags.has("no-generated") ? "disabled" : "built",
      barrierArtifactRoot: getFlag(flags, "osm-barriers") ?? null,
      osmSourceLock: getFlag(flags, "osm-source-lock") ?? null,
      legacyGridAllowed: flags.has("allow-legacy-grid-emergency"),
      organicFallbackEnabled: true,
      expectedProvinceBatches: counts.ADM1,
      resumeEnabled: !flags.has("no-resume"),
      buildDate: getFlag(flags, "build-date") ?? DEFAULT_BUILD_DATE,
      sourceLockHash: createSourceLockForCli({
        source,
        buildDate: getFlag(flags, "build-date") ?? DEFAULT_BUILD_DATE,
        officialStatus: officialPath ? "artifact-loaded" : "not-built",
        officialLoadedZoneCount: 0,
        osmStatus: osmPath && existsSync(resolve(osmPath)) ? "artifact-loaded" : "not-built",
        osmLoadedZoneCount: 0,
        officialProviders: [],
        generatedSeed: seed
      }).contentHash
    }
  });
  return 0;
}

async function runBuild(args: string[], mode: TurkeyV2NationalOutputMode): Promise<number> {
  const flags = parseFlags(args);
  const startedAt = Date.now();
  const outputRoot = resolve(getFlag(flags, "output") ?? DEFAULT_OUTPUT);
  const reportsRoot = resolve(getFlag(flags, "reports-output") ?? DEFAULT_REPORTS_OUTPUT);
  const explicitBuildDate = getFlag(flags, "build-date");
  if (mode === "publish-ready" && explicitBuildDate === undefined) {
    printJson({
      ok: false,
      command: "tr v2 national publish-ready",
      issues: [
        issue("Publish-ready Turkey V2 builds require an explicit --build-date.", undefined, {
          code: "BUILD_DATE_REQUIRED",
          expected: DEFAULT_BUILD_DATE,
          actual: "missing"
        })
      ]
    });
    return 2;
  }
  const buildDate = getFlag(flags, "build-date") ?? DEFAULT_BUILD_DATE;
  const datasetVersion = getFlag(flags, "dataset-version") ?? DEFAULT_SMART_CANDIDATE_VERSION;
  const admDataset = await readDataset(
    getFlag(flags, "adm0-adm2-dataset") ?? DEFAULT_ADM0_ADM2_DATASET
  );
  const source = await readNationalSource(
    getFlag(flags, "source-metadata") ?? DEFAULT_NATIONAL_SOURCE
  );
  const officialPath = resolveOptionalArtifactPath(
    flags,
    "official-artifact",
    DEFAULT_OFFICIAL_ARTIFACT
  );
  const osmPath = resolveOptionalArtifactPath(flags, "osm-artifact");
  const seed = getFlag(flags, "seed") ?? "territory-kit-tr-v2-national";
  const officialZones = flags.has("no-official") ? [] : await readAdm3Zones(officialPath);
  const osmZones = flags.has("no-osm") ? [] : await readAdm3Zones(osmPath);
  const officialStatus: TurkeyV2NationalSourceStatus = flags.has("no-official")
    ? "disabled"
    : officialPath
      ? "artifact-loaded"
      : "not-built";
  const osmStatus: TurkeyV2NationalSourceStatus = flags.has("no-osm")
    ? "disabled"
    : osmPath
      ? "artifact-loaded"
      : "not-built";
  const sourceLock = createSourceLockForCli({
    source,
    buildDate,
    datasetVersion,
    officialStatus,
    officialLoadedZoneCount: officialZones.length,
    osmStatus,
    osmLoadedZoneCount: osmZones.length,
    officialProviders: createOfficialProviderLocks(officialZones),
    generatedSeed: seed
  });
  const barrierRoot = getFlag(flags, "osm-barriers");
  const osmSourceLockPath = getFlag(flags, "osm-source-lock");
  const allowLegacyGridEmergency = flags.has("allow-legacy-grid-emergency");
  if (
    !flags.has("no-generated") &&
    !allowLegacyGridEmergency &&
    (!barrierRoot || !osmSourceLockPath)
  ) {
    printJson({
      ok: false,
      command: `tr v2 national ${mode}`,
      issues: [
        issue(
          "Smart production builds require --osm-barriers and --osm-source-lock; legacy is developer emergency only.",
          undefined,
          { code: "PRODUCTION_LEGACY_GRID_FORBIDDEN" }
        )
      ]
    });
    return 2;
  }
  let snapshotChecksum = "";
  if (osmSourceLockPath) {
    const verification = await verifyTurkeyOsmSnapshot({ sourceLockPath: osmSourceLockPath });
    if (!verification.ok) {
      printJson({ ok: false, issues: verification.issues });
      return 1;
    }
    const lock = JSON.parse(await readFile(osmSourceLockPath, "utf8"));
    snapshotChecksum = lock.sha256;
  }
  Object.assign(sourceLock, {
    productionFallbackPolicy: {
      legacyGridAllowed: allowLegacyGridEmergency,
      organicFallbackEnabled: true
    },
    osmBarrierSnapshotChecksum: snapshotChecksum
  });
  sourceLock.generated.algorithmVersion = allowLegacyGridEmergency
    ? sourceLock.generated.algorithmVersion
    : TURKEY_SMART_FALLBACK_ALGORITHM_VERSION;
  sourceLock.generated.generatorConfigHash = stableHash({
    organicAlgorithm: "organic-locality-v1",
    organicNetworkRefinementDepth: 3,
    organicBarrierRouting: "shared-junction-and-corridor-graph-v4",
    organicCoarseTargetCounts: { roadDensityBelow3: 16, other: 32, realismRetries: [16, 8] },
    organicRoutingCorridorMeters: [400, 2000, 5000],
    organicRoutingMaximumChordShare: 0.4,
    organicStraightChainMinimumMeters: 100,
    organicStraightChainMaximumHeadingDegrees: 3,
    organicRealismMaximumStraightRatio: { roadDensityBelow3: 0.95, other: 0.8 },
    organicGeographicRefinement:
      "real-network-and-existing-boundary-vertices-after-maximum-area-rejection",
    clippingRetryPrecisionDecimals: [12, 10, 9, 8],
    preservePrevalidatedSmartPartition: true,
    hybridUnionRetry: "twelve-decimal-then-sequential",
    smartBoundaryPrecisionRegularization: "self-union-on-exact-self-intersection",
    migrationAlgorithm: "overlap-components-v2",
    maxTerritoriesLarge: 32,
    maxTerritoriesCompact: 128,
    largeParentAreaM2: 100_000_000,
    axisAlignedUnsupportedGate: 0.15,
    legacyGridAllowed: allowLegacyGridEmergency
  });
  const lockIdentity = { ...sourceLock };
  delete (lockIdentity as Partial<typeof sourceLock>).contentHash;
  sourceLock.contentHash = `sha256:${stableHash(lockIdentity)}`;
  const districtTimings: Array<{ adm2Id: string; durationMs: number; resumed: boolean }> = [];
  const districtStarts = new Map<string, number>();
  const resumedDistricts = new Set<string>();
  const originalGenerationDurations = new Map<string, number>();
  const checkpointRoot = join(outputRoot, "districts");
  const checkpointPath = (id: string) =>
    join(checkpointRoot, `${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
  const checkpointKey = (options: TurkeyV2HybridDistrictBuildOptions) =>
    stableHash({
      options,
      officialNationalPriorityPolicy: options.officialZones?.some((zone) => {
        const t = isRecord(zone.properties.territory) ? zone.properties.territory : {};
        return (
          (t.boundarySourceClass ??
            (isRecord(t.source) ? t.source.boundarySourceClass : undefined)) === "official-national"
        );
      })
        ? "national-before-local-v1"
        : undefined,
      snapshotChecksum,
      datasetVersion,
      checkpointSchema: DISTRICT_CHECKPOINT_SCHEMA,
      sourceLockHash: sourceLock.contentHash,
      algorithm: TURKEY_SMART_FALLBACK_ALGORITHM_VERSION
    });
  const districtLimit = readPositiveIntegerFlag(flags, "max-districts");
  const result = await buildTurkeyV2NationalDataset({
    adm0Adm2Dataset: admDataset,
    officialSources: {
      zones: officialZones,
      status: officialStatus,
      providers: createOfficialProviderLocks(officialZones)
    },
    osmSources: { zones: osmZones, status: osmStatus },
    sourceLock,
    buildDate,
    datasetVersion,
    outputMode: mode,
    continueOnError: flags.has("continue-on-error") && mode !== "publish-ready",
    ...(districtLimit ? { districtLimit } : {}),
    allowLegacyGridEmergency,
    ...(getFlag(flags, "migration-baseline")
      ? { migrationBaselineZones: await readAdm3Zones(getFlag(flags, "migration-baseline")) }
      : {}),
    ...(barrierRoot
      ? {
          loadGeneratedOptions: async (district: TerritoryZone) => {
            districtStarts.set(district.id, Date.now());
            const artifact = await readTurkeyOsmAdm2BarrierArtifact(barrierRoot, district.id);
            if (
              artifact.manifest.sourceSnapshotChecksum !== snapshotChecksum ||
              artifact.manifest.parentGeometryHash !== stableHash(district.geometry)
            ) {
              throw new Error(`OSM_BARRIER_LINEAGE_MISMATCH: ${district.id}`);
            }
            const areaM2 = computeTerritoryAreaM2(district.geometry);
            return createTurkeyOsmSmartFallbackGeneratedOptions(artifact, {
              smartFallbackOptions: {
                maxTerritories: areaM2 > 100_000_000 ? 32 : 128
              }
            });
          }
        }
      : {}),
    restoreDistrictResult: async (options: TurkeyV2HybridDistrictBuildOptions) => {
      if (flags.has("no-resume")) return undefined;
      try {
        const stored = JSON.parse(await readFile(checkpointPath(options.district.id), "utf8"));
        if (
          stored.schemaVersion !== DISTRICT_CHECKPOINT_SCHEMA ||
          stored.result?.quality?.ok !== true ||
          stored.key !== checkpointKey(options) ||
          stableHash(stored.result) !== stored.resultHash
        )
          return undefined;
        resumedDistricts.add(options.district.id);
        if (
          typeof stored.generationDurationMs === "number" &&
          Number.isFinite(stored.generationDurationMs) &&
          stored.generationDurationMs >= 0
        )
          originalGenerationDurations.set(options.district.id, stored.generationDurationMs);
        internCheckpointGeometry(stored.result);
        return stored.result as TurkeyV2HybridDistrictBuildResult;
      } catch {
        return undefined;
      }
    },
    onDistrictComplete: async (
      result: TurkeyV2HybridDistrictBuildResult,
      options: TurkeyV2HybridDistrictBuildOptions
    ) => {
      const durationMs = Date.now() - (districtStarts.get(result.district.id) ?? Date.now());
      const resumed = resumedDistricts.has(result.district.id);
      districtTimings.push({ adm2Id: result.district.id, durationMs, resumed });
      const generationDurationMs = resumed
        ? originalGenerationDurations.get(result.district.id)
        : durationMs;
      if (generationDurationMs !== undefined)
        originalGenerationDurations.set(result.district.id, generationDurationMs);
      await mkdir(checkpointRoot, { recursive: true });
      const target = checkpointPath(result.district.id);
      await writeFile(
        `${target}.pending`,
        JSON.stringify({
          schemaVersion: DISTRICT_CHECKPOINT_SCHEMA,
          generationDurationMs,
          key: checkpointKey(options),
          resultHash: stableHash(result),
          result
        })
      );
      await rename(`${target}.pending`, target);
    },
    generatedDefaults: {
      enabled: !flags.has("no-generated"),
      profile: "auto",
      seed
    },
    buildArtifacts: {
      adjacency: !flags.has("no-adjacency"),
      query: true,
      render: !flags.has("no-render"),
      mvt: !flags.has("no-mvt"),
      binaryIndex: !flags.has("no-binary-index")
    }
  });

  await writeNationalArtifacts(outputRoot, result, {
    force: flags.has("force"),
    includeRender: !flags.has("no-render") && !flags.has("no-mvt")
  });
  await writeNationalReports(reportsRoot, result, flags.has("force"));
  const times = districtTimings.map((d) => d.durationMs).sort((a, b) => a - b);
  await writeJson(
    join(reportsRoot, "performance.json"),
    {
      durationMs: Date.now() - startedAt,
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
      resumedAdm2Count: districtTimings.filter((d) => d.resumed).length,
      newlyBuiltAdm2Count: districtTimings.filter((d) => !d.resumed).length,
      measuredGenerationAdm2Count: originalGenerationDurations.size,
      generationTimingScope:
        "Original generation durations when recorded; absent measurements from older checkpoints are not inferred.",
      p50RecordedGenerationMs:
        [...originalGenerationDurations.values()].sort((a, b) => a - b)[
          Math.floor(originalGenerationDurations.size * 0.5)
        ] ?? null,
      p95RecordedGenerationMs:
        [...originalGenerationDurations.values()].sort((a, b) => a - b)[
          Math.floor(originalGenerationDurations.size * 0.95)
        ] ?? null,
      p50Adm2Ms: times[Math.floor(times.length * 0.5)] ?? 0,
      p95Adm2Ms: times[Math.floor(times.length * 0.95)] ?? 0,
      slowestAdm2: districtTimings.slice().sort((a, b) => b.durationMs - a.durationMs)[0],
      districtTimings
    },
    true
  );
  const smartManifest = createSmartCoverageManifest(result);
  await writeJson(join(reportsRoot, "smart-coverage.json"), smartManifest, true);
  await writeJson(join(outputRoot, "smart-coverage.json"), smartManifest, true);
  await writeJson(
    join(reportsRoot, "official-source-backlog.json"),
    smartManifest.districts
      .filter(
        (d) =>
          d.selectedSourceTier === "organic-smart" ||
          d.selectedSourceTier === "unavailable" ||
          d.reasonCodes.some((code) => code.includes("LICENSE"))
      )
      .sort(
        (a, b) =>
          Number(a.selectedSourceTier !== "unavailable") -
            Number(b.selectedSourceTier !== "unavailable") ||
          Number(!a.reasonCodes.some((code) => code.includes("LICENSE"))) -
            Number(!b.reasonCodes.some((code) => code.includes("LICENSE"))) ||
          Number(!a.reasonCodes.some((code) => code.includes("INSUFFICIENT_BARRIERS"))) -
            Number(!b.reasonCodes.some((code) => code.includes("INSUFFICIENT_BARRIERS"))) ||
          (a.quality ?? Infinity) - (b.quality ?? Infinity) ||
          (b.axisAlignedInternalBoundaryRatio ?? 0) - (a.axisAlignedInternalBoundaryRatio ?? 0) ||
          a.adm2Id.localeCompare(b.adm2Id)
      ),
    true
  );
  const shardFiles: Record<string, { sha256: string; sizeBytes: number }> = {};
  const writeShard = async (path: string, payload: unknown) => {
    const content = `${JSON.stringify(payload, null, 2)}\n`;
    await writeText(join(outputRoot, path), content, true);
    shardFiles[path] = {
      sha256: createHash("sha256").update(content).digest("hex"),
      sizeBytes: Buffer.byteLength(content)
    };
  };
  for (const province of smartManifest.provinces) {
    await writeJson(
      join(reportsRoot, "provinces", `${province.provinceCode}.json`),
      province,
      true
    );
    const districts = result.districts.filter(
      (d) => d.coverage.provinceCode === province.provinceCode
    );
    const parent = result.dataset.zones.find(
      (z) =>
        z.level === 1 &&
        (z.properties.territory as Record<string, unknown>)?.provinceCode === province.provinceCode
    );
    if (!parent) throw new Error(`Province parent missing: ${province.provinceCode}`);
    const scopedParent = {
      ...parent,
      properties: {
        ...parent.properties,
        territory: { ...(parent.properties.territory as Record<string, unknown>) }
      }
    };
    delete scopedParent.parentId;
    delete scopedParent.properties.territory.parentId;
    const districtIds = new Set(districts.map((d) => d.district.id));
    scopedParent.childIds = [...districtIds].sort();
    const zones = [
      scopedParent,
      ...result.dataset.zones.filter(
        (z) => districtIds.has(z.id) || (z.level === 3 && districtIds.has(z.parentId ?? ""))
      )
    ].sort((a, b) => a.id.localeCompare(b.id));
    await writeShard(`provinces/${province.provinceCode}/dataset.json`, {
      manifest: {
        ...result.dataset.manifest,
        adminLevels: ["ADM1", "ADM2", "ADM3"],
        geometryHash: createDatasetGeometryHash({ zones }),
        name: `Turkey ${province.province} Smart candidate`
      },
      zones
    });
    for (const district of districts) {
      await writeShard(
        `districts/${district.district.id.replace(/[^a-zA-Z0-9_-]/g, "_")}/dataset.json`,
        {
          ...district.dataset,
          manifest: {
            ...district.dataset.manifest,
            datasetVersion,
            name: `Turkey ${district.district.name ?? district.district.id} Smart candidate`
          }
        }
      );
    }
  }

  const shardIdentity = {
    schemaVersion: "territorykit-tr-smart-shards@1",
    datasetVersion,
    sourceLockHash: sourceLock.contentHash,
    files: shardFiles
  };
  await writeJson(
    join(outputRoot, "shards.json"),
    { ...shardIdentity, contentHash: stableHash(shardIdentity) },
    true
  );
  const summary = {
    ...createCliSummary(result),
    outputRoot,
    reportsRoot,
    durationMs: Date.now() - startedAt
  };
  const commandOk = mode === "publish-ready" ? result.quality.publishReady : result.quality.ok;
  const failureGates =
    mode === "publish-ready"
      ? result.quality.publishReadyGateFailures
      : result.quality.hardGateFailures;

  printJson({
    ok: commandOk,
    command: `tr v2 national ${mode}`,
    data: summary,
    issues: commandOk
      ? []
      : failureGates.map((gate) => issue(`Quality gate failed: ${gate}`, undefined, { code: gate }))
  });

  return commandOk ? 0 : 1;
}

async function runValidate(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const outputRoot = resolve(getFlag(flags, "output") ?? DEFAULT_OUTPUT);
  const strictPublishReady = flags.has("strict") || flags.has("publish-ready");
  const issues: CliIssue[] = [];
  const coverage = await readJsonForValidation(outputRoot, "coverage.json", issues);
  const quality = await readJsonForValidation(outputRoot, "quality-report.json", issues);
  const sourceLock = await readJsonForValidation(outputRoot, "source-lock.json", issues);
  const checksums = await readJsonForValidation(outputRoot, "checksums.json", issues);
  const registry = await readJsonForValidation(outputRoot, "registry-entry.json", issues);
  const artifactPlan = await readJsonForValidation(outputRoot, "artifact-plan.json", issues);

  if (!isRecord(coverage) || coverage.schemaVersion !== "territorykit-tr-v2-national-coverage@1") {
    issues.push(
      issue("Coverage report is missing or invalid.", "coverage.json", {
        code: "COVERAGE_SCHEMA_INVALID"
      })
    );
  }

  if (!isRecord(quality) || quality.schemaVersion !== "territorykit-tr-v2-national-quality@1") {
    issues.push(
      issue("Quality report is missing or invalid.", "quality-report.json", {
        code: "QUALITY_SCHEMA_INVALID"
      })
    );
  } else if (quality.ok !== true) {
    issues.push(
      issue("Quality report is not ok.", "quality-report.json", {
        code: "QUALITY_NOT_OK",
        expected: true,
        actual: String(quality.ok)
      })
    );
  }

  if (!isRecord(checksums) || !isRecord(checksums.files)) {
    issues.push(
      issue("Checksums are missing or invalid.", "checksums.json", {
        code: "CHECKSUMS_SCHEMA_INVALID"
      })
    );
  }

  if (
    !isRecord(registry) ||
    registry.schemaVersion !== "territorykit-tr-v2-national-registry-entry@1"
  ) {
    issues.push(
      issue("Registry entry is missing or invalid.", "registry-entry.json", {
        code: "REGISTRY_SCHEMA_INVALID"
      })
    );
  }

  if (
    !isRecord(artifactPlan) ||
    artifactPlan.schemaVersion !== "territorykit-tr-v2-national-artifact-plan@1"
  ) {
    issues.push(
      issue("Artifact plan is missing or invalid.", "artifact-plan.json", {
        code: "ARTIFACT_PLAN_SCHEMA_INVALID"
      })
    );
  }

  if (isRecord(registry) && isRecord(checksums)) {
    const integrity = await validateTurkeyV2NationalArtifactIntegrity({
      registry,
      checksums,
      outputRoot,
      mandatoryArtifactIds: ["dataset", "coverage", "quality", "query", "adm3"]
    });
    issues.push(...integrity.errors.map(validationIssueToCliIssue));
  }

  if (isRecord(coverage) && isRecord(quality)) {
    const completeness = validateTurkeyV2NationalCompleteness({
      coverage,
      quality,
      ...(isRecord(sourceLock) ? { sourceLock } : {}),
      strictPublishReady
    });
    issues.push(...completeness.errors.map(validationIssueToCliIssue));
  }

  if (strictPublishReady) {
    if (isRecord(sourceLock)) {
      const identity = { ...sourceLock };
      delete identity.contentHash;
      if (sourceLock.contentHash !== `sha256:${stableHash(identity)}`) {
        issues.push(
          issue("Source lock identity is invalid.", "source-lock.json", {
            code: "SOURCE_LOCK_IDENTITY_INVALID"
          })
        );
      }
    }
    const smartCoverage = await readJsonForValidation(outputRoot, "smart-coverage.json", issues);
    if (isRecord(smartCoverage)) {
      const identity = { ...smartCoverage };
      delete identity.contentHash;
      if (smartCoverage.contentHash !== stableHash(identity)) {
        issues.push(
          issue("Smart coverage identity is invalid.", "smart-coverage.json", {
            code: "SMART_COVERAGE_IDENTITY_INVALID"
          })
        );
      }
      if (
        !isRecord(smartCoverage.totals) ||
        smartCoverage.totals.adm2Total !== TURKEY_V2_NATIONAL_EXPECTED_COUNTS.ADM2 ||
        smartCoverage.totals.adm2Failed !== 0 ||
        smartCoverage.totals.legacyProductionDistricts !== 0 ||
        smartCoverage.totals.gridThresholdViolations !== 0 ||
        smartCoverage.totals.unsupportedStraightThresholdViolations !== 0
      ) {
        issues.push(
          issue(
            "Smart coverage does not meet national production requirements.",
            "smart-coverage.json",
            {
              code: "SMART_NATIONAL_COVERAGE_INCOMPLETE"
            }
          )
        );
      }
    }
    const shards = await readJsonForValidation(outputRoot, "shards.json", issues);
    if (isRecord(shards) && isRecord(shards.files)) {
      const identity = { ...shards };
      delete identity.contentHash;
      const paths = Object.keys(shards.files);
      if (
        shards.contentHash !== stableHash(identity) ||
        shards.sourceLockHash !== (isRecord(sourceLock) ? sourceLock.contentHash : undefined) ||
        paths.filter((p) => p.startsWith("provinces/")).length !==
          TURKEY_V2_NATIONAL_EXPECTED_COUNTS.ADM1 ||
        paths.filter((p) => p.startsWith("districts/")).length !==
          TURKEY_V2_NATIONAL_EXPECTED_COUNTS.ADM2
      ) {
        issues.push(
          issue("Shard manifest identity or completeness is invalid.", "shards.json", {
            code: "SMART_SHARD_MANIFEST_INVALID"
          })
        );
      }
      for (const path of paths) {
        const entry = shards.files[path];
        if (
          !/^(provinces\/[0-9]{2}|districts\/[a-zA-Z0-9_-]+)\/dataset\.json$/.test(path) ||
          !isRecord(entry)
        ) {
          issues.push(issue("Invalid shard path or entry.", path, { code: "SMART_SHARD_INVALID" }));
          continue;
        }
        try {
          const bytes = await readFile(join(outputRoot, path));
          const shard = JSON.parse(bytes.toString("utf8")) as TerritoryDataset;
          if (
            entry.sha256 !== createHash("sha256").update(bytes).digest("hex") ||
            entry.sizeBytes !== bytes.length ||
            shard.manifest.geometryHash !== createDatasetGeometryHash(shard)
          ) {
            issues.push(
              issue("Shard checksum or geometry hash mismatch.", path, {
                code: "SMART_SHARD_INTEGRITY_INVALID"
              })
            );
          }
        } catch {
          issues.push(issue("Shard is missing or invalid.", path, { code: "SMART_SHARD_INVALID" }));
        }
      }
    } else {
      issues.push(
        issue("Shard manifest is missing or invalid.", "shards.json", {
          code: "SMART_SHARD_MANIFEST_INVALID"
        })
      );
    }
    const dataset = await readDataset(join(outputRoot, "dataset.json"));
    for (const zone of dataset.zones.filter((z) => z.level === 3)) {
      const t = isRecord(zone.properties.territory) ? zone.properties.territory : {};
      if (t.generated === true && !String(t.algorithmVersion).startsWith("smart-derived")) {
        issues.push(
          issue(`Legacy generated zone ${zone.id} cannot be publish-ready.`, undefined, {
            code: "PRODUCTION_LEGACY_GRID_FORBIDDEN"
          })
        );
      }
      if (
        t.boundarySourceClass === "smart-derived" &&
        (t.administrative !== false ||
          t.authoritative !== false ||
          t.boundaryKind !== "estimated" ||
          !t.sourceSnapshotChecksum ||
          !t.barrierArtifactChecksum ||
          !t.attribution)
      ) {
        issues.push(
          issue(`Invalid Smart semantics or lineage for ${zone.id}.`, undefined, {
            code: "SMART_PROVENANCE_INVALID"
          })
        );
      }
    }
  }

  if (isRecord(coverage) && isRecord(sourceLock)) {
    const sourceLockHash =
      typeof sourceLock.contentHash === "string" ? sourceLock.contentHash : undefined;
    if (coverage.sourceLockHash !== sourceLockHash) {
      issues.push(
        issue("Coverage source-lock hash does not match source-lock.json.", "source-lock.json", {
          code: "SOURCE_LOCK_HASH_MISMATCH",
          expected: String(coverage.sourceLockHash),
          actual: sourceLockHash ?? "missing"
        })
      );
    }
  }

  if (isRecord(coverage) && isRecord(registry) && Array.isArray(registry.datasets)) {
    const dataset = registry.datasets.find(isRecord);
    if (dataset) {
      if (dataset.id !== coverage.datasetId) {
        issues.push(
          issue("Registry dataset id does not match coverage report.", "registry-entry.json", {
            code: "REGISTRY_DATASET_ID_MISMATCH",
            expected: String(coverage.datasetId),
            actual: String(dataset.id)
          })
        );
      }
      if (dataset.version !== coverage.datasetVersion) {
        issues.push(
          issue("Registry dataset version does not match coverage report.", "registry-entry.json", {
            code: "REGISTRY_DATASET_VERSION_MISMATCH",
            expected: String(coverage.datasetVersion),
            actual: String(dataset.version)
          })
        );
      }
    }
  }

  printJson({
    ok: issues.length === 0,
    command: "tr v2 national validate",
    strictPublishReady,
    data: {
      outputRoot,
      datasetId: isRecord(coverage) ? coverage.datasetId : undefined,
      datasetVersion: isRecord(coverage) ? coverage.datasetVersion : undefined,
      expectedAdm0Count: TURKEY_V2_NATIONAL_EXPECTED_COUNTS.ADM0,
      expectedAdm1Count: TURKEY_V2_NATIONAL_EXPECTED_COUNTS.ADM1,
      expectedAdm2Count: TURKEY_V2_NATIONAL_EXPECTED_COUNTS.ADM2,
      adm0Count: isRecord(coverage) ? coverage.adm0Count : undefined,
      provinceCount: isRecord(coverage) ? coverage.provinceCount : undefined,
      districtCount: isRecord(coverage) ? coverage.districtCount : undefined,
      successfulDistrictCount: isRecord(coverage) ? coverage.successfulDistrictCount : undefined,
      failedDistrictCount: isRecord(coverage) ? coverage.failedDistrictCount : undefined,
      buildMode: isRecord(quality) ? quality.buildMode : undefined,
      publishReady: isRecord(quality) ? quality.publishReady : undefined,
      finalCoveragePercent: isRecord(coverage) ? coverage.finalCoveragePercent : undefined
    },
    issues
  });
  return issues.length === 0 ? 0 : 1;
}

async function runBenchmark(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const outputRoot = resolve(
    getFlag(flags, "output") ?? workspacePath(".territory/build/TR/V2-national-benchmark")
  );
  const reportsRoot = resolve(getFlag(flags, "reports-output") ?? DEFAULT_REPORTS_OUTPUT);
  const scenarios = [10, 100];
  const results = [];

  for (const districtLimit of scenarios) {
    const scenarioOutput = join(outputRoot, String(districtLimit));
    const scenarioReportsRoot = join(reportsRoot, "benchmark", String(districtLimit));
    const startedAt = Date.now();
    const code = await runBuild(
      [
        ...args,
        "--output",
        scenarioOutput,
        "--reports-output",
        scenarioReportsRoot,
        "--max-districts",
        String(districtLimit),
        "--force",
        "--no-render",
        "--no-mvt"
      ],
      "build"
    );
    if (code !== 0) return code;
    const summary = await readJson(join(scenarioOutput, "build-summary.json"));
    results.push({
      districtLimit,
      code,
      durationMs: Date.now() - startedAt,
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
      summary
    });
  }

  const report = {
    schemaVersion: "territorykit-tr-v2-national-benchmark@1",
    generatedAt: DEFAULT_BUILD_DATE,
    scenarios: results
  };
  await writeJson(join(reportsRoot, "benchmark.json"), report, true);
  printJson({ ok: true, command: "tr v2 national benchmark", data: report });
  return 0;
}

export function createSmartCoverageManifest(result: TurkeyV2NationalBuildResult) {
  const districts = result.levels.ADM2.zones.map((parent) => {
    const t = isRecord(parent.properties.territory) ? parent.properties.territory : {};
    const c = result.coverage.districts.find((c) => c.districtId === parent.id) ?? {
      districtId: parent.id,
      provinceCode: String(t.provinceCode),
      provinceName: "",
      districtName: parent.name ?? parent.id,
      zoneCount: 0,
      finalCoveragePercent: 0
    };
    const d = result.districts.find((d) => d.district.id === c.districtId);
    const q = d?.smartFallbackResult?.quality;
    const organic = d?.smartFallbackResult?.configuration.organic === true;
    const legacy = d?.generatedResult !== undefined;
    const generatedCount = d?.effective.generated.length ?? 0;
    const officialCount = d?.effective.official.length ?? 0;
    const osmCount = d?.effective.osm.length ?? 0;
    const tier = legacy
      ? "legacy"
      : generatedCount > 0
        ? organic
          ? "organic-smart"
          : "standard-smart"
        : officialCount > 0
          ? "official"
          : osmCount > 0
            ? "osm-administrative"
            : "unavailable";
    const rejectedHybridGates = Object.entries(d?.quality.gates ?? {})
      .filter(([, accepted]) => !accepted)
      .map(([gate]) => gate)
      .sort();
    return {
      adm2Id: c.districtId,
      failureReason:
        result.failures.find((f) => f.districtId === c.districtId)?.message ??
        (rejectedHybridGates.length
          ? `HYBRID_QUALITY_REJECTED: ${rejectedHybridGates.join(", ")}`
          : null),
      provinceCode: c.provinceCode,
      province: c.provinceName,
      district: c.districtName,
      selectedSourceTier: tier,
      boundaryKind: !d ? "unavailable" : generatedCount ? "estimated" : "administrative",
      sourceClass: generatedCount ? "smart-derived" : tier,
      confidence: !d
        ? "unavailable"
        : organic ||
            d.effective.generated.some(
              (z) => (z.properties.territory as Record<string, unknown>)?.confidence === "low"
            )
          ? "low"
          : String(
              (d.effective.zones[0]?.properties.territory as Record<string, unknown>)?.confidence ??
                "unavailable"
            ),
      qualityAccepted: d?.quality.ok === true,
      zoneCount: c.zoneCount,
      coverage: c.finalCoveragePercent,
      spill: q?.outsideSpillKm2 ?? 0,
      overlap: q?.overlapAreaKm2 ?? 0,
      barrierAlignment: q?.meanBarrierAlignment ?? null,
      realBarrierRatio: q?.meanRealBarrierRatio ?? null,
      syntheticBoundaryRatio: q?.meanSyntheticBoundaryRatio ?? null,
      axisAlignedInternalBoundaryRatio: q?.axisAlignedInternalBoundaryRatio ?? null,
      longUnsupportedStraightBoundaryRatio: q?.longUnsupportedStraightBoundaryRatio ?? null,
      barrierFollowingInternalBoundaryRatio: q?.barrierFollowingInternalBoundaryRatio ?? null,
      totalInternalBoundaryLengthKm: q?.totalInternalBoundaryLengthKm ?? null,
      quality: q?.meanQualityScore ?? null,
      qualityGates: { ...(q?.gates ?? {}), ...(d?.quality.gates ?? {}) },
      smartQualityGates: q?.gates ?? {},
      hybridQualityGates: d?.quality.gates ?? {},
      reasonCodes: [
        ...new Set([
          ...(d?.issues.map((i) => i.code) ?? ["DISTRICT_BUILD_FAILED"]),
          ...rejectedHybridGates.map(
            (gate) =>
              `HYBRID_QUALITY_${gate.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}_REJECTED`
          )
        ])
      ].sort(),
      zones: {
        official: officialCount,
        osmAdministrative: osmCount,
        standardSmart: organic ? 0 : generatedCount,
        organicSmart: organic ? generatedCount : 0
      },
      areaKm2: {
        parent: computeTerritoryAreaM2(parent.geometry) / 1_000_000,
        official: d?.coverage.officialEffectiveAreaKm2 ?? 0,
        osmAdministrative: d?.coverage.osmEffectiveAreaKm2 ?? 0,
        standardSmart: organic ? 0 : (d?.coverage.generatedEffectiveAreaKm2 ?? 0),
        organicSmart: organic ? (d?.coverage.generatedEffectiveAreaKm2 ?? 0) : 0
      },
      barrierArtifactChecksum:
        d?.effective.generated[0]?.properties.territory &&
        (d.effective.generated[0].properties.territory as Record<string, unknown>)
          .barrierArtifactChecksum
    };
  });
  const totals = {
    adm2ExpectedNational: result.sourceLock.adm0Adm2.levels.ADM2.actualFeatureCount,
    adm2Total: districts.length,
    adm2Attempted: result.districts.length + result.failures.length,
    adm2Successful: districts.filter(
      (d) => d.qualityAccepted && d.zoneCount > 0 && d.coverage >= 99.99
    ).length,
    adm2Failed: districts.filter(
      (d) => !d.qualityAccepted || d.zoneCount === 0 || d.coverage < 99.99
    ).length,
    officialDistricts: districts.filter((d) => d.selectedSourceTier === "official").length,
    officialContributingDistricts: districts.filter((d) => d.zones.official > 0).length,
    osmAdministrativeDistricts: districts.filter(
      (d) => d.selectedSourceTier === "osm-administrative"
    ).length,
    osmAdministrativeContributingDistricts: districts.filter((d) => d.zones.osmAdministrative > 0)
      .length,
    standardSmartDistricts: districts.filter((d) => d.selectedSourceTier === "standard-smart")
      .length,
    organicSmartDistricts: districts.filter((d) => d.selectedSourceTier === "organic-smart").length,
    legacyProductionDistricts: districts.filter((d) => d.selectedSourceTier === "legacy").length,
    unavailableDistricts: districts.filter((d) => d.zoneCount === 0).length,
    gridThresholdViolations: districts.filter(
      (d) => (d.axisAlignedInternalBoundaryRatio ?? 0) > 0.15
    ).length,
    unsupportedStraightThresholdViolations: districts.filter(
      (d) =>
        "geographicRealism" in d.smartQualityGates &&
        d.smartQualityGates.geographicRealism === false
    ).length
  };
  const keys = ["official", "osmAdministrative", "standardSmart", "organicSmart"] as const;
  const zoneTotals = Object.fromEntries(
    keys.map((k) => [k, districts.reduce((n, d) => n + d.zones[k], 0)])
  );
  const parentArea = districts.reduce((n, d) => n + d.areaKm2.parent, 0);
  const areaCoveragePercent = Object.fromEntries(
    keys.map((k) => [
      k,
      parentArea ? (districts.reduce((n, d) => n + d.areaKm2[k], 0) / parentArea) * 100 : 0
    ])
  );
  const provinces = result.levels.ADM1.zones.map((parent) => {
    const t = isRecord(parent.properties.territory) ? parent.properties.territory : {};
    const p = { provinceCode: String(t.provinceCode), provinceName: parent.name ?? parent.id };
    const rows = districts.filter((d) => d.provinceCode === p.provinceCode);
    const qualities = rows.filter((d) => d.quality !== null);
    const reasons: Record<string, number> = {};
    rows.forEach((d) =>
      d.reasonCodes.forEach((code) => {
        reasons[code] = (reasons[code] ?? 0) + 1;
      })
    );
    return {
      provinceCode: p.provinceCode,
      province: p.provinceName,
      adm2Count: rows.length,
      officialCount: rows.filter((d) => d.selectedSourceTier === "official").length,
      officialContributingCount: rows.filter((d) => d.zones.official > 0).length,
      osmAdministrativeCount: rows.filter((d) => d.selectedSourceTier === "osm-administrative")
        .length,
      osmAdministrativeContributingCount: rows.filter((d) => d.zones.osmAdministrative > 0).length,
      standardSmartCount: rows.filter((d) => d.selectedSourceTier === "standard-smart").length,
      organicSmartCount: rows.filter((d) => d.selectedSourceTier === "organic-smart").length,
      failedCount: rows.filter((d) => !d.qualityAccepted || d.zoneCount === 0 || d.coverage < 99.99)
        .length,
      coveragePercent: rows.length ? rows.reduce((n, d) => n + d.coverage, 0) / rows.length : 0,
      meanSmartQuality: qualities.length
        ? qualities.reduce((n, d) => n + (d.quality ?? 0), 0) / qualities.length
        : null,
      lowConfidenceCount: rows.filter((d) => d.confidence === "low").length,
      reasonCodeDistribution: reasons
    };
  });
  const identity = {
    schemaVersion: "territorykit-tr-national-smart-coverage@1",
    sourceLockHash: result.sourceLock.contentHash,
    productionFallbackPolicy: {
      legacyGridAllowed: result.sourceLock.productionFallbackPolicy?.legacyGridAllowed ?? false,
      organicFallbackEnabled: true
    },
    totals,
    zoneTotals,
    areaCoveragePercent,
    uncoveredPercent: Math.max(
      0,
      100 - Object.values(areaCoveragePercent).reduce((n, v) => n + v, 0)
    ),
    districts,
    provinces
  };
  const metricKeys = [
    "realBarrierRatio",
    "syntheticBoundaryRatio",
    "longUnsupportedStraightBoundaryRatio",
    "axisAlignedInternalBoundaryRatio",
    "barrierFollowingInternalBoundaryRatio"
  ] as const;
  const geographicQuality = Object.fromEntries(
    ["standard-smart", "organic-smart"].map((tier) => {
      const rows = districts.filter((d) => d.selectedSourceTier === tier);
      return [
        tier,
        Object.fromEntries(
          metricKeys.map((metric) => {
            const values = rows
              .map((d) => d[metric])
              .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
              .sort((a, b) => a - b);
            const quantile = (p: number) => {
              if (!values.length) return null;
              const index = (values.length - 1) * p,
                lo = Math.floor(index),
                hi = Math.ceil(index);
              return Number((values[lo]! + (values[hi]! - values[lo]!) * (index - lo)).toFixed(6));
            };
            return [
              metric,
              {
                count: values.length,
                min: quantile(0),
                p10: quantile(0.1),
                median: quantile(0.5),
                p90: quantile(0.9),
                max: quantile(1)
              }
            ];
          })
        )
      ];
    })
  );
  const eligible = districts.filter((d) => (d.totalInternalBoundaryLengthKm ?? 0) > 0);
  const worstDistricts = Object.fromEntries(
    [
      ["realBarrierRatio", false],
      ["syntheticBoundaryRatio", true],
      ["longUnsupportedStraightBoundaryRatio", true],
      ["quality", false]
    ].map(([metric, descending]) => {
      const field = metric as
        | "realBarrierRatio"
        | "syntheticBoundaryRatio"
        | "longUnsupportedStraightBoundaryRatio"
        | "quality";
      return [
        field,
        [...eligible]
          .sort(
            (a, b) =>
              ((a[field] ?? 0) - (b[field] ?? 0)) * (descending ? -1 : 1) ||
              a.adm2Id.localeCompare(b.adm2Id)
          )
          .slice(0, 20)
          .map((d) => ({
            adm2Id: d.adm2Id,
            district: d.district,
            province: d.province,
            tier: d.selectedSourceTier,
            metric: d[field],
            qualityAccepted: d.qualityAccepted
          }))
      ];
    })
  );
  const report = { ...identity, geographicQuality, worstDistricts };
  return { ...report, contentHash: stableHash(report) };
}

// JSON checkpoints repeat the same geometry across candidates, effective zones and
// datasets. Restore shared geometry without changing any serialized values.
function internCheckpointGeometry(value: unknown): void {
  const geometries = new Map<string, unknown>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!isRecord(node)) return;
    for (const key of Object.keys(node)) {
      if (key === "geometry" && isRecord(node[key])) {
        const hash = createHash("sha256").update(JSON.stringify(node[key])).digest("hex");
        const existing = geometries.get(hash);
        if (existing) node[key] = existing;
        else geometries.set(hash, node[key]);
      } else visit(node[key]);
    }
  };
  visit(value);
}

function stableHash(value: unknown): string {
  return createHash("sha256")
    .update(`${JSON.stringify(JSON.parse(stableSerialize(value)), null, 2)}\n`)
    .digest("hex");
}
function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableSerialize(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

async function writeNationalArtifacts(
  outputRoot: string,
  result: TurkeyV2NationalBuildResult,
  options: { force: boolean; includeRender: boolean }
): Promise<void> {
  const payloads = createTurkeyV2NationalArtifactPayloads({
    result,
    includeDataset: true,
    includeGeoJson: true,
    includeRender: options.includeRender
  });

  for (const [path, payload] of payloads.json.entries()) {
    await writeJson(join(outputRoot, path), payload, options.force);
  }

  for (const [path, payload] of payloads.text.entries()) {
    await writeText(join(outputRoot, path), payload, options.force);
  }

  for (const [path, payload] of payloads.bytes.entries()) {
    await writeBytes(join(outputRoot, path), payload, options.force);
  }
}

async function writeNationalReports(
  reportsRoot: string,
  result: TurkeyV2NationalBuildResult,
  force: boolean
): Promise<void> {
  await writeJson(join(reportsRoot, "build-summary.json"), createCliSummary(result), force);
  await writeJson(join(reportsRoot, "coverage.json"), result.coverage, force);
  await writeJson(join(reportsRoot, "quality-report.json"), result.quality, force);
  await writeJson(join(reportsRoot, "hierarchy-report.json"), result.hierarchy, force);
  await writeJson(join(reportsRoot, "source-lock.json"), result.sourceLock, force);
  await writeJson(join(reportsRoot, "provenance.json"), createProvenanceSummary(result), force);
  await writeJson(join(reportsRoot, "attribution.json"), createAttributionSummary(result), force);
  await writeText(join(reportsRoot, "attribution.txt"), result.attribution.text, force);
  await writeJson(join(reportsRoot, "licenses.json"), result.licenses, force);
  await writeJson(
    join(reportsRoot, "distribution-policy.json"),
    createDistributionPolicySummary(result),
    force
  );
  await writeJson(join(reportsRoot, "registry-entry.json"), result.registry, force);
  await writeJson(join(reportsRoot, "artifact-plan.json"), result.artifactPlan, force);
  await writeJson(join(reportsRoot, "checksums.json"), result.checksums, force);
}

function createProvenanceSummary(result: TurkeyV2NationalBuildResult): Record<string, unknown> {
  const providers = new Map<
    string,
    {
      providerId: string;
      providerName: string;
      sourceClass: string;
      license: string;
      attribution: string;
      zoneCount: number;
    }
  >();

  for (const zone of result.provenance.zones) {
    const key = [zone.providerId, zone.sourceClass, zone.license, zone.attribution].join("\u0000");
    const existing = providers.get(key) ?? {
      providerId: zone.providerId,
      providerName: zone.providerName,
      sourceClass: zone.sourceClass,
      license: zone.license,
      attribution: zone.attribution,
      zoneCount: 0
    };
    existing.zoneCount += 1;
    providers.set(key, existing);
  }

  return {
    schemaVersion: "territorykit-tr-v2-national-provenance-summary@1",
    buildDate: result.provenance.buildDate,
    summary: result.provenance.summary,
    providers: [...providers.values()].sort(
      (left, right) =>
        left.sourceClass.localeCompare(right.sourceClass) ||
        left.providerId.localeCompare(right.providerId) ||
        left.license.localeCompare(right.license)
    )
  };
}

function createAttributionSummary(result: TurkeyV2NationalBuildResult): Record<string, unknown> {
  return {
    schemaVersion: "territorykit-tr-v2-national-attribution-summary@1",
    districtId: result.attribution.districtId,
    buildDate: result.attribution.buildDate,
    text: result.attribution.text,
    groups: result.attribution.groups
      .map((group) => ({
        sourceClass: group.sourceClass,
        providerIds: group.providerIds,
        license: group.license,
        attribution: group.attribution,
        zoneCount: group.zoneIds.length
      }))
      .sort(
        (left, right) =>
          left.sourceClass.localeCompare(right.sourceClass) ||
          left.providerIds.join(",").localeCompare(right.providerIds.join(",")) ||
          left.license.localeCompare(right.license)
      )
  };
}

function createDistributionPolicySummary(
  result: TurkeyV2NationalBuildResult
): Record<string, unknown> {
  return {
    schemaVersion: "territorykit-tr-v2-national-distribution-policy-summary@1",
    districtId: result.distributionPolicy.districtId,
    policies: result.distributionPolicy.policies
      .map((policy) => ({
        sourceClass: policy.sourceClass,
        providerClass: policy.providerClass,
        license: policy.license,
        redistributionPolicy: policy.redistributionPolicy,
        commercialUsePolicy: policy.commercialUsePolicy,
        modificationPolicy: policy.modificationPolicy,
        zoneCount: policy.zoneIds.length
      }))
      .sort(
        (left, right) =>
          left.sourceClass.localeCompare(right.sourceClass) ||
          left.providerClass.localeCompare(right.providerClass) ||
          left.license.localeCompare(right.license)
      )
  };
}

function createCliSummary(result: TurkeyV2NationalBuildResult): Record<string, unknown> {
  return {
    schemaVersion: "territorykit-tr-v2-national-cli-summary@1",
    datasetId: result.coverage.datasetId,
    datasetVersion: result.coverage.datasetVersion,
    buildDate: result.coverage.buildDate,
    buildMode: result.quality.buildMode,
    publishReady: result.quality.publishReady,
    expectedAdm0Count: TURKEY_V2_NATIONAL_EXPECTED_COUNTS.ADM0,
    expectedAdm1Count: TURKEY_V2_NATIONAL_EXPECTED_COUNTS.ADM1,
    expectedAdm2Count: TURKEY_V2_NATIONAL_EXPECTED_COUNTS.ADM2,
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
    districtsBelow9999: result.coverage.districtsBelow9999,
    qualityOk: result.quality.ok,
    hardGateFailures: result.quality.hardGateFailures,
    publishReadyGateFailures: result.quality.publishReadyGateFailures,
    sourceStatus: result.coverage.sourceStatus,
    deterministicHash: result.deterministicHash,
    sourceLockHash: result.sourceLock.contentHash
  };
}

function createSourceLockForCli(input: {
  source: NationalSourceMetadata;
  buildDate: string;
  datasetVersion?: string;
  officialStatus: TurkeyV2NationalSourceStatus;
  officialLoadedZoneCount: number;
  osmStatus: TurkeyV2NationalSourceStatus;
  osmLoadedZoneCount: number;
  officialProviders: readonly TurkeyV2NationalRealProviderLock[];
  generatedSeed: string;
}) {
  return createTurkeyV2NationalSourceLock({
    adm0Adm2: {
      provider: input.source.provider,
      sourceId: input.source.sourceId,
      sourceUrl: input.source.sourceUrl,
      ...(input.source.downloadUrl ? { downloadUrl: input.source.downloadUrl } : {}),
      sourceDate: input.source.sourceDate,
      ...(input.source.retrievedAt ? { retrievedAt: input.source.retrievedAt } : {}),
      license: input.source.license,
      ...(input.source.licenseUrl ? { licenseUrl: input.source.licenseUrl } : {}),
      attribution: input.source.attribution,
      redistributionAllowed: input.source.redistributionAllowed,
      commercialUseAllowed: input.source.commercialUseAllowed,
      modificationAllowed: input.source.modificationAllowed,
      sha256: input.source.sha256,
      byteSize: input.source.byteSize,
      levels: input.source.levels
    } satisfies TurkeyV2NationalAdmSourceLock,
    buildDate: input.buildDate,
    ...(input.datasetVersion ? { datasetVersion: input.datasetVersion } : {}),
    officialAdm3: {
      status: input.officialStatus,
      approvedProviderCount: input.officialProviders.length,
      loadedZoneCount: input.officialLoadedZoneCount,
      providers: [...input.officialProviders]
    },
    osm: {
      status: input.osmStatus,
      providerCount: 81,
      loadedZoneCount: input.osmLoadedZoneCount,
      sourceUrl: "https://download.geofabrik.de/europe/turkey.html",
      downloadUrl: "https://download.geofabrik.de/europe/turkey-latest.osm.pbf",
      license: "ODbL-1.0",
      attribution: "OpenStreetMap contributors, ODbL 1.0; extract by Geofabrik"
    },
    generated: {
      seed: input.generatedSeed
    }
  });
}

function createOfficialProviderLocks(
  zones: readonly TerritoryZone[]
): TurkeyV2NationalRealProviderLock[] {
  const providers = new Map<string, TurkeyV2NationalRealProviderLock>();

  for (const zone of zones) {
    const territory = isRecord(zone.properties.territory) ? zone.properties.territory : {};
    const source = isRecord(territory.source) ? territory.source : {};
    const providerId =
      readString(territory.providerId) ??
      readString(source.provider) ??
      "unknown-official-provider";
    const provinceCode =
      readString(territory.provinceCode) ??
      (isRecord(territory.adm3) ? readString(territory.adm3.provinceCode) : undefined) ??
      "00";

    if (!providers.has(providerId)) {
      const sourceUrl = readString(territory.sourceUrl) ?? readString(source.sourceUrl);
      const sourceDate = readString(territory.sourceDate) ?? readString(source.sourceDate);
      const license = readString(territory.license) ?? readString(source.license);
      const attribution = readString(territory.attribution) ?? readString(source.attribution);

      providers.set(providerId, {
        providerId,
        providerName:
          readString(territory.providerName) ?? readString(source.provider) ?? providerId,
        provinceCode,
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(sourceDate ? { sourceDate } : {}),
        ...(license ? { license } : {}),
        ...(attribution ? { attribution } : {}),
        redistributionPolicy: "allowed",
        commercialUsePolicy: "allowed",
        modificationPolicy: "allowed"
      });
    }
  }

  return [...providers.values()].sort((left, right) =>
    left.providerId.localeCompare(right.providerId)
  );
}

async function readDataset(path: string): Promise<TerritoryDataset> {
  const input = await readJson(path);
  if (!isRecord(input) || !Array.isArray(input.zones) || !isRecord(input.manifest)) {
    throw new Error(`Bad Territory dataset: ${path}`);
  }
  return input as unknown as TerritoryDataset;
}

async function readAdm3Zones(path: string | undefined): Promise<TerritoryZone[]> {
  if (!path) {
    return [];
  }
  const dataset = await readDataset(path);
  return dataset.zones
    .filter((zone) => zone.level === 3 || zone.sourceAdminLevel === "ADM3")
    .map((zone) => {
      const territory = isRecord(zone.properties.territory) ? zone.properties.territory : {};
      const parentId =
        zone.parentId ??
        readString(territory.parentId) ??
        readString(territory.sourceParentId) ??
        readString(territory.parentAdm2Id);
      return parentId ? { ...zone, parentId } : zone;
    })
    .filter((zone) => typeof zone.parentId === "string");
}

interface NationalSourceMetadata {
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
  levels: TurkeyV2NationalAdmSourceLock["levels"];
}

async function readNationalSource(path: string): Promise<NationalSourceMetadata> {
  const input = await readJson(path);
  if (!isRecord(input) || input.country !== "TR" || !isRecord(input.levels)) {
    throw new Error(`Bad Turkey national source metadata: ${path}`);
  }

  return input as unknown as NationalSourceMetadata;
}

function countLevels(dataset: TerritoryDataset): Record<"ADM0" | "ADM1" | "ADM2" | "ADM3", number> {
  return {
    ADM0: dataset.zones.filter((zone) => zone.level === 0 || zone.sourceAdminLevel === "ADM0")
      .length,
    ADM1: dataset.zones.filter((zone) => zone.level === 1 || zone.sourceAdminLevel === "ADM1")
      .length,
    ADM2: dataset.zones.filter((zone) => zone.level === 2 || zone.sourceAdminLevel === "ADM2")
      .length,
    ADM3: dataset.zones.filter((zone) => zone.level === 3 || zone.sourceAdminLevel === "ADM3")
      .length
  };
}

function resolveOptionalArtifactPath(
  flags: Map<string, string | true>,
  flagName: string,
  fallback?: string
): string | undefined {
  const explicit = getFlag(flags, flagName);
  const candidate = explicit ?? fallback;

  if (!candidate) {
    return undefined;
  }

  const absolute = resolve(candidate);
  return existsSync(absolute) ? absolute : undefined;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
}

async function readJsonForValidation(
  outputRoot: string,
  relativePath: string,
  issues: CliIssue[]
): Promise<unknown> {
  try {
    return await readJson(join(outputRoot, relativePath));
  } catch (error) {
    issues.push(
      issue(
        `Unable to read ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
        relativePath,
        {
          code: "JSON_READ_ERROR"
        }
      )
    );
    return undefined;
  }
}

async function writeJson(path: string, payload: unknown, force: boolean): Promise<void> {
  await writeText(path, `${JSON.stringify(payload, null, 2)}\n`, force);
}

async function writeText(path: string, payload: string, force: boolean): Promise<void> {
  if (!force && existsSync(path)) {
    throw new Error(`Refusing to overwrite existing output ${path}. Pass --force to replace it.`);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, payload.endsWith("\n") ? payload : `${payload}\n`, "utf8");
}

async function writeBytes(
  path: string,
  payload: Uint8Array | string,
  force: boolean
): Promise<void> {
  if (!force && existsSync(path)) {
    throw new Error(`Refusing to overwrite existing output ${path}. Pass --force to replace it.`);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, payload);
}

function parseFlags(args: readonly string[]): Map<string, string | true> {
  const flags = new Map<string, string | true>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey!;
    const next = args[index + 1];

    if (inlineValue !== undefined) {
      flags.set(key, inlineValue);
    } else if (next && !next.startsWith("--")) {
      flags.set(key, next);
      index += 1;
    } else {
      flags.set(key, true);
    }
  }

  return flags;
}

function getFlag(flags: Map<string, string | true>, key: string): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function readPositiveIntegerFlag(
  flags: Map<string, string | true>,
  key: string
): number | undefined {
  const value = getFlag(flags, key);
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readString(input: unknown): string | undefined {
  return typeof input === "string" && input.trim().length > 0 ? input.trim() : undefined;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function workspacePath(path: string): string {
  return resolve(WORKSPACE_ROOT, path);
}

function validationIssueToCliIssue(input: {
  code: string;
  message: string;
  path?: string;
  artifactId?: string;
  expected?: string | number | boolean;
  actual?: string | number | boolean;
}): CliIssue {
  return issue(input.message, input.path, {
    code: input.code,
    ...(input.artifactId ? { artifactId: input.artifactId } : {}),
    ...(input.expected !== undefined ? { expected: input.expected } : {}),
    ...(input.actual !== undefined ? { actual: input.actual } : {})
  });
}

function issue(
  message: string,
  path?: string,
  details: {
    code?: string;
    artifactId?: string;
    expected?: string | number | boolean;
    actual?: string | number | boolean;
  } = {}
): CliIssue {
  return {
    code: details.code ?? "TR_V2_NATIONAL",
    severity: "error",
    message,
    ...(path ? { path } : {}),
    ...(details.artifactId ? { artifactId: details.artifactId } : {}),
    ...(details.expected !== undefined ? { expected: details.expected } : {}),
    ...(details.actual !== undefined ? { actual: details.actual } : {})
  };
}

function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function printHelp(): void {
  console.log(`territory tr v2 national <command>

Commands:
  plan           Resolve canonical ADM0-ADM2 scope and source availability
  build          Build a local Turkey V2 national playable artifact
  publish-ready  Build with publish-ready quality gates
  validate       Validate a previously built artifact directory
  benchmark      Run bounded 10/100-district national benchmarks

Smart input:
  --osm-barriers <root> --osm-source-lock <source-lock.json>
  --migration-baseline <old-national-dataset.json>
  --no-resume
  --allow-legacy-grid-emergency (developer-only; never publish-ready)

Common flags:
  --adm0-adm2-dataset <dataset.json>
  --official-artifact <dataset.json>
  --osm-artifact <dataset.json>
  --output <dir>
  --reports-output <dir>
  --dataset-version 2.1.0-rc.1
  --build-date 2026-09-27T00:00:00.000Z
  --max-districts <n>
  --force
`);
}
