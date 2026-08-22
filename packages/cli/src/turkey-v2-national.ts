import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";
import {
  TURKEY_V2_NATIONAL_EXPECTED_COUNTS,
  TURKEY_V2_NATIONAL_DATASET_ID,
  TURKEY_V2_NATIONAL_DATASET_VERSION,
  buildTurkeyV2NationalDataset,
  createTurkeyV2NationalArtifactPayloads,
  createTurkeyV2NationalSourceLock,
  validateTurkeyV2NationalArtifactIntegrity,
  validateTurkeyV2NationalCompleteness
} from "@territory-kit/generators/turkey-adm3";
import type {
  TurkeyV2NationalAdmSourceLock,
  TurkeyV2NationalBuildResult,
  TurkeyV2NationalOutputMode,
  TurkeyV2NationalRealProviderLock,
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
const DEFAULT_OUTPUT = workspacePath(".territory/build/TR/V2-national");
const DEFAULT_REPORTS_OUTPUT = workspacePath("reports/tr-v2-national");
const DEFAULT_BUILD_DATE = "2026-08-22T00:00:00.000Z";

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
      datasetVersion: getFlag(flags, "dataset-version") ?? TURKEY_V2_NATIONAL_DATASET_VERSION,
      adm0Count: counts.ADM0,
      adm1Count: counts.ADM1,
      adm2Count: counts.ADM2,
      canonicalAdm2SourceCount: source.levels.ADM2.actualFeatureCount,
      officialStatus: officialPath ? "artifact-loaded" : "not-built",
      osmStatus: osmPath && existsSync(resolve(osmPath)) ? "artifact-loaded" : "not-built",
      generatedStatus: flags.has("no-generated") ? "disabled" : "built",
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
  const datasetVersion = getFlag(flags, "dataset-version") ?? TURKEY_V2_NATIONAL_DATASET_VERSION;
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

  return commandOk ? 0 : mode === "publish-ready" ? 1 : 0;
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
    const summary = await readJson(join(scenarioOutput, "build-summary.json"));
    results.push({
      districtLimit,
      code,
      durationMs: Date.now() - startedAt,
      peakRssBytes: process.memoryUsage().rss,
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

Common flags:
  --adm0-adm2-dataset <dataset.json>
  --official-artifact <dataset.json>
  --osm-artifact <dataset.json>
  --output <dir>
  --reports-output <dir>
  --dataset-version 2.0.0
  --build-date 2026-08-22T00:00:00.000Z
  --max-districts <n>
  --force
`);
}
