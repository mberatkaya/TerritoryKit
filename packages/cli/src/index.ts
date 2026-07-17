#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { createTerritoryEngine } from "@territory-kit/core";
import {
  TERRITORY_ADMIN_LEVELS,
  TERRITORY_SCHEMA_VERSION,
  createTerritoryAdjacencyIndex,
  createTerritoryDatasetFromGeoJson,
  loadTerritoryDataset,
  validateTerritoryDataset
} from "@territory-kit/dataset";
import type {
  GeometryQualityCheckPreset,
  GeometryQualityOptions,
  GeometryRepairOptions,
  GeometryRepairStrategy,
  TerritoryAdminLevel,
  TerritoryAdjacencyBuildOptions,
  TerritoryAdjacencyType,
  TerritoryDataset,
  TerritoryDatasetManifest,
  TerritoryGeoJsonImportOptions,
  TerritoryValidationIssue
} from "@territory-kit/dataset";
import {
  NATURAL_EARTH_ADM0_DETAILS,
  WORLD_COUNTRIES_DATASET_ID,
  GLOBAL_ADMIN_ADM0_OUTPUT,
  GLOBAL_ADMIN_DATASET_ID,
  NATURAL_EARTH_ADM0_GEOJSON_URL,
  buildAllTerritoryCountryDatasets,
  buildGlobalAdminAdm0Artifacts,
  buildTerritoryAdjacencyPath,
  buildTerritoryCoverageRegistryFromArtifacts,
  buildTerritoryCountryDatasetPath,
  buildWorldCountriesDatasetFromSourcePipeline,
  createTerritoryCountrySourceLock,
  createDatasetGeometryHash,
  createSyntheticGridDataset,
  createWeightedVoronoiDataset,
  getTerritorySourceAdapter,
  getTerritoryCountryConfig,
  hasTerritorySourceAdapter,
  inspectTerritorySourceCapabilities,
  inspectTerritoryCountryDatasetPath,
  listTerritoryCountryConfigs,
  inferBBoxAdjacency,
  inferBBoxAdjacencyConnections,
  listTerritorySourceAdapters,
  readTerritoryCountrySourceLockPath,
  readTerritoryAdjacencyArtifactPath,
  repairTerritoryDatasetPath,
  buildTerritoryRenderArtifactPath,
  compareTerritoryQueryRenderArtifacts,
  runTerritorySourcePipeline,
  inspectTerritoryRenderArtifactPath,
  validateTerritoryCountryDatasetPath,
  verifyTerritoryCountrySourceLock,
  validateTerritoryAdjacencyPath,
  validateTerritoryDatasetPath,
  validateTerritoryRenderArtifactPath,
  writeGeometryQualityReport
} from "@territory-kit/generators";
import { validateTerritoryDatasetRegistry } from "@territory-kit/registry";
import {
  buildTerritoryDatasetRegistryFromArtifacts,
  createNodeTerritoryRegistryCache,
  createNodeTerritoryRegistryClient,
  readRegistryFile
} from "@territory-kit/registry/node";
import type {
  GenericGeoJsonSourceOptions,
  GeoBoundariesSourceOptions,
  NaturalEarthAdm0Detail,
  NaturalEarthSourceOptions,
  TerritoryProviderCapabilitiesResult,
  TerritorySourceDescription,
  TerritorySourceIssue,
  TerritorySourcePipelineResult,
  TerritorySourceRequest
} from "@territory-kit/generators";

interface CliIssue {
  code: string;
  message: string;
  column?: number;
  featureId?: string;
  line?: number;
  path?: string;
  repairSuggestion?: string;
  severity: "error" | "warning";
  sourcePath?: string;
  zoneId?: string;
}

interface JsonSource {
  input: unknown;
  lineIndex: JsonLineIndex;
}

interface JsonLineIndex {
  findLineForIssue(issue: TerritoryValidationIssue): number | undefined;
}

interface CliBenchmarkResult {
  schemaVersion: "territorykit-benchmark-result@1";
  mode: "fixture" | "local-real";
  scenario: string;
  generatedAt: string;
  runtime: {
    node: string;
    platform: string;
    arch: string;
  };
  source: Record<string, unknown>;
  inputs: {
    datasetId?: string;
    datasetVersion?: string;
    featureCount: number;
    iterations?: number;
  };
  metrics: Record<string, number>;
  skipped?: string[];
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [command] = argv;

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }

  try {
    if (command === "dataset") {
      return runDataset(argv.slice(1));
    }

    if (command === "registry") {
      return runRegistry(argv.slice(1));
    }

    if (command === "cache") {
      return runCache(argv.slice(1));
    }

    if (command === "source" || command === "sources") {
      return runSource(argv.slice(1));
    }

    if (command === "import") {
      return runImportCommand(argv.slice(1));
    }

    if (command === "geometry") {
      return runGeometry(argv.slice(1));
    }

    if (command === "adjacency") {
      return runAdjacency(argv.slice(1));
    }

    if (command === "render") {
      return runRender(argv.slice(1));
    }

    if (command === "benchmark") {
      return runBenchmark(argv.slice(1));
    }

    if (command === "country") {
      return runCountry(argv.slice(1));
    }

    if (command === "generate") {
      return runGenerate(argv.slice(1));
    }

    const [filePath] = argv.slice(1).filter((value) => !value.startsWith("--"));

    if (!filePath) {
      printJson({
        ok: false,
        command,
        issues: [createCliIssue(`Missing input path for command '${command}'.`)]
      });
      return 1;
    }

    const input = await readJson(filePath);

    if (command === "validate") {
      const result = validateTerritoryDataset(input);

      printJson({
        ok: result.ok,
        command,
        ...(result.ok ? { data: { issues: result.issues } } : { issues: result.issues })
      });
      return result.ok ? 0 : 1;
    }

    const dataset = loadTerritoryDataset(input);

    if (command === "index") {
      const engine = createTerritoryEngine({ dataset });
      printJson({
        ok: true,
        command,
        data: {
          datasetId: dataset.manifest.datasetId,
          geometryHash: createDatasetGeometryHash(dataset),
          levels: engine.availableLevels,
          zoneCount: dataset.zones.length
        }
      });
      return 0;
    }

    if (command === "simplify") {
      printJson({
        ok: true,
        command,
        data: {
          ...dataset,
          manifest: {
            ...dataset.manifest,
            geometryHash: createDatasetGeometryHash(dataset)
          }
        }
      });
      return 0;
    }

    printJson({
      ok: false,
      command,
      issues: [createCliIssue(`Unknown command '${command}'.`)]
    });
    return 1;
  } catch (error) {
    printJson({
      ok: false,
      command,
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 1;
  }
}

async function runCountry(args: string[]): Promise<number> {
  const [subcommand] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printCountryHelp();
    return 0;
  }

  if (subcommand === "list") {
    return runCountryList(args.slice(1));
  }

  if (subcommand === "info") {
    return runCountryInfo(args.slice(1));
  }

  if (subcommand === "source") {
    return runCountrySource(args.slice(1));
  }

  if (subcommand === "source-lock") {
    return runCountrySourceLock(args.slice(1));
  }

  if (subcommand === "source-verify") {
    return runCountrySourceVerify(args.slice(1));
  }

  if (subcommand === "build") {
    return runCountryBuild(args.slice(1));
  }

  if (subcommand === "validate") {
    return runCountryValidate(args.slice(1));
  }

  if (subcommand === "inspect") {
    return runCountryInspect(args.slice(1));
  }

  printJson({
    ok: false,
    command: "country",
    issues: [createCliIssue(`Unsupported country command '${subcommand}'.`)]
  });
  return 2;
}

function runCountryList(args: string[]): number {
  const flags = parseFlags(args);
  const countries = listTerritoryCountryConfigs();

  if (flags.has("json")) {
    printJson({
      ok: true,
      command: "country list",
      data: countries.map((config) => ({
        country: config.countryCodeAlpha2,
        alpha3: config.countryCodeAlpha3,
        name: config.displayName,
        datasetId: config.datasetId,
        packageName: config.loaderPackageName,
        levels: config.requestedLevels,
        sourceProvider: config.sourceProvider
      }))
    });
    return 0;
  }

  console.log(
    countries
      .map((config) =>
        [
          config.countryCodeAlpha2.padEnd(4),
          config.countryCodeAlpha3.padEnd(5),
          config.requestedLevels.join(",").padEnd(16),
          config.loaderPackageName
        ].join("  ")
      )
      .join("\n")
  );
  return 0;
}

function runCountryInfo(args: string[]): number {
  const [country] = args;
  const flags = parseFlags(args.slice(1));

  if (!country || country === "--help" || country === "-h") {
    printCountryInfoHelp();
    return country ? 0 : 2;
  }

  try {
    const config = getTerritoryCountryConfig(country);

    if (flags.has("json")) {
      printJson({ ok: true, command: "country info", data: config });
    } else {
      console.log(formatCountryConfig(config));
    }

    return 0;
  } catch (error) {
    printJson({
      ok: false,
      command: "country info",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 2;
  }
}

async function runCountrySource(args: string[]): Promise<number> {
  const [subcommand] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printCountrySourceHelp();
    return 0;
  }

  if (subcommand === "lock") {
    return runCountrySourceLock(args.slice(1));
  }

  if (subcommand === "verify") {
    return runCountrySourceVerify(args.slice(1));
  }

  printJson({
    ok: false,
    command: "country source",
    issues: [createCliIssue(`Unsupported country source command '${subcommand}'.`)]
  });
  return 2;
}

async function runCountrySourceLock(args: string[]): Promise<number> {
  const [country] = args;

  if (!country || country === "--help" || country === "-h") {
    printCountrySourceLockHelp();
    return country ? 0 : 2;
  }

  const flags = parseFlags(args.slice(1));
  const config = getTerritoryCountryConfig(country);
  const levels = readCountryLevelsFlag(flags, config.requestedLevels);
  const outputPath = getFlag(flags, "output");
  const metadataPath = getFlag(flags, "metadata") ?? getFlag(flags, "metadata-path");
  const metadataUrl = getFlag(flags, "metadata-url");
  const releaseType = getFlag(flags, "release-type");
  const buildDate = getFlag(flags, "build-date");
  const cacheDir = getFlag(flags, "cache-dir");

  if (isCliIssueArray(levels)) {
    printJson({ ok: false, command: "country source lock", issues: levels });
    return 2;
  }

  try {
    const result = await createTerritoryCountrySourceLock({
      country,
      levels: levels ?? [...config.requestedLevels],
      ...(releaseType ? { releaseType } : {}),
      ...(outputPath ? { outputPath } : {}),
      ...(metadataPath ? { metadataPath } : {}),
      ...(metadataUrl ? { metadataUrl } : {}),
      ...(buildDate ? { buildDate } : {}),
      ...(cacheDir ? { cacheDir } : {}),
      ...(flags.has("no-cache") ? { noCache: true } : {}),
      ...(flags.has("refresh") ? { refresh: true } : {}),
      ...(flags.has("force") ? { force: true } : {})
    });
    const ok = result.issues.every((issue) => issue.severity !== "error") && Boolean(result.lock);

    printJson({
      ok,
      command: "country source lock",
      data: {
        country: config.countryCodeAlpha2,
        outputPath: result.outputPath,
        lock: result.lock
      },
      issues: result.issues
    });
    return ok ? 0 : 1;
  } catch (error) {
    printJson({
      ok: false,
      command: "country source lock",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 2;
  }
}

async function runCountrySourceVerify(args: string[]): Promise<number> {
  const [lockPath] = args;

  if (!lockPath || lockPath === "--help" || lockPath === "-h") {
    printCountrySourceVerifyHelp();
    return lockPath ? 0 : 2;
  }

  const flags = parseFlags(args.slice(1));
  const buildDate = getFlag(flags, "build-date");

  try {
    const lock = await readTerritoryCountrySourceLockPath(lockPath);
    const result = await verifyTerritoryCountrySourceLock(lock, {
      ...(buildDate ? { buildDate } : {})
    });

    printJson({
      ok: result.ok,
      command: "country source verify",
      data: {
        country: lock.country.alpha2,
        provider: lock.provider,
        levels: Object.keys(lock.levels).sort()
      },
      issues: result.issues
    });
    return result.ok ? 0 : 1;
  } catch (error) {
    printJson({
      ok: false,
      command: "country source verify",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 2;
  }
}

async function runCountryBuild(args: string[]): Promise<number> {
  const [country] = args;

  if (!country || country === "--help" || country === "-h") {
    printCountryBuildHelp();
    return country ? 0 : 2;
  }

  const flags = parseFlags(args.slice(1));
  const sourceLockPath = getFlag(flags, "source-lock");
  const outputPath = getFlag(flags, "output");
  const levels = readCountryLevelsFlag(flags);
  const buildDate = getFlag(flags, "build-date");
  const batchSize = getFlag(flags, "batch-size");

  if (!sourceLockPath || !outputPath) {
    printJson({
      ok: false,
      command: "country build",
      issues: [
        ...(!sourceLockPath ? [createCliIssue("--source-lock is required.")] : []),
        ...(!outputPath ? [createCliIssue("--output is required.")] : [])
      ]
    });
    return 2;
  }

  if (isCliIssueArray(levels)) {
    printJson({ ok: false, command: "country build", issues: levels });
    return 2;
  }

  try {
    const result = await buildTerritoryCountryDatasetPath({
      country,
      sourceLockPath,
      outputPath,
      ...(levels ? { levels } : {}),
      ...(flags.has("build-adjacency") ? { buildAdjacency: true } : {}),
      ...(flags.has("strict") ? { strict: true } : {}),
      ...(flags.has("allow-non-publish-ready") || flags.has("allow-partial")
        ? { allowNonPublishReady: true }
        : {}),
      ...(buildDate ? { buildDate } : {}),
      ...(batchSize ? { batchSize: Number(batchSize) } : {}),
      ...(flags.has("force") ? { force: true } : {})
    });
    const ok = result.issues.every((issue) => issue.severity !== "error");

    printJson({
      ok,
      command: "country build",
      data: {
        country: result.manifest.country.alpha2,
        outputPath: result.outputPath,
        manifest: result.manifest,
        statistics: result.buildReport.statistics,
        ...(flags.has("json") ? { buildReport: result.buildReport } : {})
      },
      issues: result.issues
    });
    return ok ? 0 : 1;
  } catch (error) {
    printJson({
      ok: false,
      command: "country build",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return flags.has("strict") ? 3 : 2;
  }
}

async function runCountryValidate(args: string[]): Promise<number> {
  const [inputPath] = args;

  if (!inputPath || inputPath === "--help" || inputPath === "-h") {
    printCountryValidateHelp();
    return inputPath ? 0 : 2;
  }

  const flags = parseFlags(args.slice(1));

  try {
    const result = await validateTerritoryCountryDatasetPath(inputPath, {
      ...(flags.has("strict") ? { strict: true } : {})
    });

    printJson({
      ok: result.ok,
      command: "country validate",
      data: {
        manifest: result.manifest
      },
      issues: result.issues
    });
    return result.ok ? 0 : 1;
  } catch (error) {
    printJson({
      ok: false,
      command: "country validate",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 2;
  }
}

async function runCountryInspect(args: string[]): Promise<number> {
  const [inputPath] = args;

  if (!inputPath || inputPath === "--help" || inputPath === "-h") {
    printCountryInspectHelp();
    return inputPath ? 0 : 2;
  }

  try {
    const summary = await inspectTerritoryCountryDatasetPath(inputPath);

    printJson({
      ok: true,
      command: "country inspect",
      data: summary
    });
    return 0;
  } catch (error) {
    printJson({
      ok: false,
      command: "country inspect",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 2;
  }
}

async function runGeometry(args: string[]): Promise<number> {
  const [subcommand, inputPath] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printGeometryHelp();
    return 0;
  }

  if (subcommand !== "validate" && subcommand !== "repair") {
    printJson({
      ok: false,
      command: "geometry",
      issues: [createCliIssue(`Unsupported geometry command '${subcommand}'.`)]
    });
    return 2;
  }

  if (!inputPath || inputPath === "--help" || inputPath === "-h") {
    printGeometryHelp();
    return inputPath ? 0 : 2;
  }

  const flags = parseFlags(args.slice(2));

  try {
    const commonOptions = readGeometryQualityOptions(flags);

    if (Array.isArray(commonOptions)) {
      printJson({ ok: false, command: `geometry ${subcommand}`, issues: commonOptions });
      return 2;
    }

    if (subcommand === "validate") {
      const { input, report } = await validateTerritoryDatasetPath(inputPath, commonOptions);
      const reportPath = getFlag(flags, "report");

      if (reportPath) {
        await writeGeometryQualityReport(reportPath, report);
      }

      printJson({
        ok: report.ok,
        command: "geometry validate",
        data: {
          inputPath: input.sourcePath,
          datasetPath: input.datasetPath,
          datasetId: input.dataset.manifest.datasetId,
          reportPath,
          summary: report.summary,
          report
        },
        issues: report.issues
      });
      return report.ok ? 0 : 1;
    }

    const outputPath = getFlag(flags, "output");

    if (!outputPath) {
      printJson({
        ok: false,
        command: "geometry repair",
        issues: [createCliIssue("--output is required for geometry repair.")]
      });
      return 2;
    }

    const repairOptions = readGeometryRepairOptions(flags, commonOptions);

    if (Array.isArray(repairOptions)) {
      printJson({ ok: false, command: "geometry repair", issues: repairOptions });
      return 2;
    }

    const repaired = await repairTerritoryDatasetPath(inputPath, outputPath, repairOptions);
    const reportPath = getFlag(flags, "report");

    if (reportPath) {
      await writeGeometryQualityReport(reportPath, repaired.result.report);
    }

    printJson({
      ok: repaired.result.ok,
      command: "geometry repair",
      data: {
        inputPath: repaired.input.sourcePath,
        datasetPath: repaired.input.datasetPath,
        outputPath: repaired.outputPath,
        reportPath,
        summary: repaired.result.report.summary,
        repairSummary: repaired.result.repairSummary,
        report: repaired.result.report
      },
      issues: repaired.result.report.issues
    });
    return repaired.result.ok ? 0 : 3;
  } catch (error) {
    printJson({
      ok: false,
      command: `geometry ${subcommand}`,
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 2;
  }
}

async function runAdjacency(args: string[]): Promise<number> {
  const [subcommand] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printAdjacencyHelp();
    return 0;
  }

  if (subcommand === "build") {
    return runAdjacencyBuild(args.slice(1));
  }

  if (subcommand === "validate") {
    return runAdjacencyValidate(args.slice(1));
  }

  if (subcommand === "inspect") {
    return runAdjacencyInspect(args.slice(1));
  }

  return runLegacyBBoxAdjacency(subcommand);
}

async function runLegacyBBoxAdjacency(filePath: string): Promise<number> {
  const input = await readJson(filePath);
  const dataset = loadTerritoryDataset(input);

  printJson({
    ok: true,
    command: "adjacency",
    data: {
      note: "inferBBoxAdjacency is a bbox-based development helper; use 'territory adjacency build' for polygon adjacency.",
      adjacency: inferBBoxAdjacency(dataset.zones),
      connections: inferBBoxAdjacencyConnections(dataset.zones)
    }
  });
  return 0;
}

async function runAdjacencyBuild(args: string[]): Promise<number> {
  const [inputPath] = args;

  if (!inputPath || inputPath === "--help" || inputPath === "-h") {
    printAdjacencyBuildHelp();
    return inputPath ? 0 : 2;
  }

  const flags = parseFlags(args.slice(1));
  const outputPath = getFlag(flags, "output");

  if (!outputPath) {
    printJson({
      ok: false,
      command: "adjacency build",
      issues: [createCliIssue("--output is required for adjacency build.")]
    });
    return 2;
  }

  const options = readAdjacencyBuildOptions(flags);

  if (Array.isArray(options)) {
    printJson({ ok: false, command: "adjacency build", issues: options });
    return 2;
  }

  try {
    const reportPath = getFlag(flags, "report");
    const overridesPath = getFlag(flags, "overrides");
    const buildDate = getFlag(flags, "build-date");
    const result = await buildTerritoryAdjacencyPath(inputPath, {
      ...options,
      outputPath,
      ...(reportPath ? { reportPath } : {}),
      ...(overridesPath ? { overridesPath } : {}),
      ...(buildDate ? { buildDate } : {}),
      ...(flags.has("force") ? { force: true } : {})
    });
    const ok = result.result.issues.every((issue) => issue.severity !== "error");

    printJson({
      ok,
      command: "adjacency build",
      data: {
        inputPath: result.input.sourcePath,
        datasetPath: result.input.datasetPath,
        outputPath: result.outputPath,
        reportPath: result.reportPath,
        statistics: result.result.statistics,
        ...(flags.has("json") ? { artifact: result.result.artifact } : {})
      },
      issues: result.result.issues
    });
    return ok ? 0 : 1;
  } catch (error) {
    printJson({
      ok: false,
      command: "adjacency build",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return flags.has("strict") ? 3 : 2;
  }
}

async function runAdjacencyValidate(args: string[]): Promise<number> {
  const [datasetPath, adjacencyPath] = args;

  if (!datasetPath || !adjacencyPath || datasetPath === "--help" || datasetPath === "-h") {
    printAdjacencyValidateHelp();
    return datasetPath ? 0 : 2;
  }

  try {
    const result = await validateTerritoryAdjacencyPath(datasetPath, adjacencyPath);

    printJson({
      ok: result.report.ok,
      command: "adjacency validate",
      data: {
        datasetId: result.dataset.manifest.datasetId,
        edgeCount: result.artifact.edges.length,
        report: result.report
      },
      issues: result.report.issues
    });
    return result.report.ok ? 0 : 1;
  } catch (error) {
    printJson({
      ok: false,
      command: "adjacency validate",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 2;
  }
}

async function runAdjacencyInspect(args: string[]): Promise<number> {
  const [adjacencyPath, zoneId] = args;

  if (!adjacencyPath || !zoneId || adjacencyPath === "--help" || adjacencyPath === "-h") {
    printAdjacencyInspectHelp();
    return adjacencyPath ? 0 : 2;
  }

  const flags = parseFlags(args.slice(2));
  const types = readAdjacencyTypesFlag(flags);

  if (Array.isArray(types) && types.some((type) => typeof type !== "string")) {
    printJson({ ok: false, command: "adjacency inspect", issues: types });
    return 2;
  }

  try {
    const artifact = await readTerritoryAdjacencyArtifactPath(adjacencyPath);
    const index = createTerritoryAdjacencyIndex(artifact);
    const queryOptions = types ? { types: types as TerritoryAdjacencyType[] } : {};
    const neighbors = index.getNeighbors(zoneId, queryOptions);
    const relations = neighbors.flatMap((neighborId) =>
      index.getRelation(zoneId, neighborId, queryOptions)
    );

    if (flags.has("json")) {
      printJson({
        ok: true,
        command: "adjacency inspect",
        data: {
          zoneId,
          neighbors,
          relations
        }
      });
    } else {
      printAdjacencyInspection(zoneId, neighbors, relations);
    }

    return 0;
  } catch (error) {
    printJson({
      ok: false,
      command: "adjacency inspect",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 2;
  }
}

async function runDataset(args: string[]): Promise<number> {
  const [subcommand, datasetId] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printDatasetHelp();
    return 0;
  }

  if (subcommand === "search") {
    return runDatasetSearch(args.slice(1));
  }

  if (subcommand === "info") {
    return runDatasetInfo(args.slice(1));
  }

  if (subcommand === "resolve") {
    return runDatasetResolve(args.slice(1));
  }

  if (subcommand === "install") {
    return runDatasetInstall(args.slice(1));
  }

  if (subcommand === "update") {
    return runDatasetInstall(args.slice(1), { update: true });
  }

  if (subcommand === "verify") {
    return runDatasetVerify(args.slice(1));
  }

  if (subcommand === "remove") {
    return runDatasetRemove(args.slice(1));
  }

  if (subcommand === "list-installed") {
    return runDatasetListInstalled(args.slice(1));
  }

  if (subcommand === "coverage") {
    return runDatasetCoverage(args.slice(1));
  }

  if (subcommand === "build-all") {
    return runDatasetBuildAll(args.slice(1));
  }

  if (subcommand !== "build") {
    printJson({
      ok: false,
      command: "dataset",
      issues: [createCliIssue(`Unsupported dataset command '${subcommand}'.`)]
    });
    return 1;
  }

  if (!datasetId || datasetId === "--help" || datasetId === "-h") {
    printDatasetBuildHelp();
    return datasetId ? 0 : 1;
  }

  const flags = parseFlags(args.slice(2));

  if (datasetId === GLOBAL_ADMIN_DATASET_ID || datasetId === "global-admin-adm0") {
    return runGlobalAdminAdm0Build(args.slice(2));
  }

  if (datasetId !== WORLD_COUNTRIES_DATASET_ID) {
    printJson({
      ok: false,
      command: "dataset build",
      issues: [createCliIssue(`Unknown dataset '${datasetId}'.`)]
    });
    return 1;
  }

  const sourcePath = getFlag(flags, "source");
  const outputPath = getFlag(flags, "output");

  if (!sourcePath) {
    printJson({
      ok: false,
      command: "dataset build",
      issues: [createCliIssue("--source is required for dataset builds.")]
    });
    return 1;
  }

  if (!outputPath) {
    printJson({
      ok: false,
      command: "dataset build",
      issues: [createCliIssue("--output is required for dataset builds.")]
    });
    return 1;
  }

  const detail = getFlag(flags, "detail");
  const details = detail ? readDetailFlag(detail) : undefined;

  if (detail && !details) {
    printJson({
      ok: false,
      command: "dataset build",
      issues: [createCliIssue(`Invalid --detail '${detail}'. Expected low, medium, or high.`)]
    });
    return 1;
  }

  const sourceVersion = getFlag(flags, "source-version");
  const sourceUrl = getFlag(flags, "source-url");
  const sourceSha256 = getFlag(flags, "source-sha256");
  const sourceDate = getFlag(flags, "source-date");
  const buildDate = getFlag(flags, "build-date");
  const datasetVersion = getFlag(flags, "dataset-version");
  const result = await buildWorldCountriesDatasetFromSourcePipeline({
    sourcePath,
    outputPath,
    ...(details ? { details } : {}),
    ...(sourceVersion ? { sourceVersion } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(sourceSha256 ? { sourceSha256 } : {}),
    ...(sourceDate ? { sourceDate } : {}),
    ...(buildDate ? { buildDate } : {}),
    ...(datasetVersion ? { datasetVersion } : {}),
    ...(flags.has("force") ? { force: true } : {}),
    ...(flags.has("strict") ? { strict: true } : {})
  });

  printJson({
    ok: result.ok,
    command: "dataset build",
    ...(result.ok
      ? {
          data: {
            ...result.summary,
            manifest: result.manifest,
            checksums: result.checksums
          },
          issues: result.issues
        }
      : { issues: result.issues })
  });
  return result.ok ? 0 : 1;
}

async function runGlobalAdminAdm0Build(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const sourcePath = getFlag(flags, "source");
  const sourceUrl = getFlag(flags, "source-url") ?? NATURAL_EARTH_ADM0_GEOJSON_URL;
  const outputPath = getFlag(flags, "output") ?? GLOBAL_ADMIN_ADM0_OUTPUT;
  const buildDate = getFlag(flags, "build-date");
  const datasetVersion = getFlag(flags, "dataset-version");
  const sourceDate = getFlag(flags, "source-date");
  const sourceVersion = getFlag(flags, "source-version");
  const cacheDir = getFlag(flags, "cache-dir");
  const buildReportPath = getFlag(flags, "build-report");
  const artifactRootsFlag =
    getFlag(flags, "country-artifact-root") ?? getFlag(flags, "artifact-root");
  const countryArtifactRoots = artifactRootsFlag
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  try {
    const result = await buildGlobalAdminAdm0Artifacts({
      ...(sourcePath ? { sourcePath } : {}),
      sourceUrl,
      outputPath,
      ...(countryArtifactRoots && countryArtifactRoots.length > 0 ? { countryArtifactRoots } : {}),
      ...(buildReportPath ? { buildReportPath } : {}),
      ...(buildDate ? { buildDate } : {}),
      ...(datasetVersion ? { datasetVersion } : {}),
      ...(sourceDate ? { sourceDate } : {}),
      ...(sourceVersion ? { sourceVersion } : {}),
      ...(cacheDir ? { cacheDir } : {}),
      ...(flags.has("force") ? { force: true } : {})
    });

    printJson({
      ok: result.ok,
      command: "dataset build global-admin",
      data: {
        outputPath: result.outputPath,
        featureCount: result.featureCount,
        validatedArtifactCount: result.validatedArtifactCount,
        smoke: result.smoke
      },
      issues: result.issues
    });
    return result.ok ? 0 : 1;
  } catch (error) {
    printJson({
      ok: false,
      command: "dataset build global-admin",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 1;
  }
}

async function runDatasetBuildAll(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    printDatasetBuildAllHelp();
    return 0;
  }

  const flags = parseFlags(args);
  const outputRoot = getFlag(flags, "output") ?? "datasets/generated/countries";
  const reportPath = getFlag(flags, "report");
  const levels = readCountryLevelsFlag(flags, ["ADM1", "ADM2"]);
  const countriesFlag = getFlag(flags, "countries") ?? getFlag(flags, "country");
  const countries = countriesFlag
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const excludeFlag = getFlag(flags, "exclude");
  const excludeCountries = excludeFlag
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const concurrency = Number(getFlag(flags, "concurrency") ?? "2");
  const countryTimeoutMs = getFlag(flags, "country-timeout-ms")
    ? Number(getFlag(flags, "country-timeout-ms"))
    : undefined;
  const phaseTimeoutMs = getFlag(flags, "phase-timeout-ms")
    ? Number(getFlag(flags, "phase-timeout-ms"))
    : undefined;
  const releaseType = getFlag(flags, "release-type");
  const provider = getFlag(flags, "provider");
  const buildDate = getFlag(flags, "build-date");
  const cacheDir = getFlag(flags, "cache-dir");
  const maxSourceBytes = getFlag(flags, "max-source-bytes")
    ? Number(getFlag(flags, "max-source-bytes"))
    : undefined;

  if (isCliIssueArray(levels)) {
    printJson({ ok: false, command: "dataset build-all", issues: levels });
    return 2;
  }

  if (!Number.isInteger(concurrency) || concurrency < 1) {
    printJson({
      ok: false,
      command: "dataset build-all",
      issues: [createCliIssue("--concurrency must be a positive integer.")]
    });
    return 2;
  }

  if (maxSourceBytes !== undefined && (!Number.isInteger(maxSourceBytes) || maxSourceBytes < 1)) {
    printJson({
      ok: false,
      command: "dataset build-all",
      issues: [createCliIssue("--max-source-bytes must be a positive integer.")]
    });
    return 2;
  }

  if (
    countryTimeoutMs !== undefined &&
    (!Number.isInteger(countryTimeoutMs) || countryTimeoutMs < 1)
  ) {
    printJson({
      ok: false,
      command: "dataset build-all",
      issues: [createCliIssue("--country-timeout-ms must be a positive integer.")]
    });
    return 2;
  }

  if (phaseTimeoutMs !== undefined && (!Number.isInteger(phaseTimeoutMs) || phaseTimeoutMs < 1)) {
    printJson({
      ok: false,
      command: "dataset build-all",
      issues: [createCliIssue("--phase-timeout-ms must be a positive integer.")]
    });
    return 2;
  }

  try {
    const report = await buildAllTerritoryCountryDatasets({
      levels: levels ?? ["ADM1", "ADM2"],
      outputRoot,
      ...(reportPath ? { reportPath } : {}),
      ...(countries && countries.length > 0 ? { countries } : {}),
      ...(excludeCountries && excludeCountries.length > 0 ? { excludeCountries } : {}),
      concurrency,
      ...(releaseType ? { releaseType } : {}),
      ...(provider ? { provider } : {}),
      ...(buildDate ? { buildDate } : {}),
      ...(cacheDir ? { cacheDir } : {}),
      ...(maxSourceBytes ? { maxSourceBytes } : {}),
      ...(countryTimeoutMs ? { countryTimeoutMs } : {}),
      ...(phaseTimeoutMs ? { phaseTimeoutMs } : {}),
      ...(flags.has("skip-adjacency") ? { buildAdjacency: false } : {}),
      onPhase: (event) => {
        process.stderr.write(`${JSON.stringify(event)}\n`);
      },
      ...(flags.has("continue-on-error") ? { continueOnError: true } : {}),
      ...(flags.has("resume") ? { resume: true } : {}),
      ...(flags.has("retry-failed") ? { retryFailed: true } : {}),
      ...(flags.has("offline") ? { offline: true } : {}),
      ...(flags.has("force") ? { force: true } : {})
    });
    const ok =
      report.countriesFailed === 0 || flags.has("continue-on-error") || flags.has("allow-partial");

    printJson({
      ok,
      command: "dataset build-all",
      data: report
    });
    return ok ? 0 : 1;
  } catch (error) {
    printJson({
      ok: false,
      command: "dataset build-all",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 1;
  }
}

async function runDatasetCoverage(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const coveragePath = getFlag(flags, "input") ?? "datasets/registry/coverage.json";
  const selectedLevels = readCountryLevelsFlag(flags);

  if (isCliIssueArray(selectedLevels)) {
    printJson({ ok: false, command: "dataset coverage", issues: selectedLevels });
    return 2;
  }

  try {
    const coverageInput = flags.has("from-artifacts")
      ? await buildTerritoryCoverageRegistryFromArtifacts({
          generatedAt: getFlag(flags, "build-date") ?? new Date().toISOString(),
          artifactRoot: getFlag(flags, "artifact-root") ?? "datasets/generated/countries",
          globalAdm0Path: getFlag(flags, "global-adm0") ?? GLOBAL_ADMIN_ADM0_OUTPUT,
          ...(getFlag(flags, "build-report")
            ? { buildReportPath: getFlag(flags, "build-report") as string }
            : {})
        })
      : await readCoverageRegistry(coveragePath, flags.has("input"));
    const coverage = selectedLevels
      ? filterCoverageRegistryLevels(coverageInput, selectedLevels)
      : coverageInput;
    const outputPath = getFlag(flags, "output");

    if (outputPath) {
      await writeJsonOutput(outputPath, coverage, flags.has("force"));
    }

    if (flags.has("json")) {
      printJson({
        ok: true,
        command: "dataset coverage",
        data: coverage
      });
    } else {
      printDatasetCoverageSummary(coverage);
    }

    return 0;
  } catch (error) {
    printJson({
      ok: false,
      command: "dataset coverage",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 1;
  }
}

async function readCoverageRegistry(inputPath: string, explicit: boolean): Promise<unknown> {
  if (explicit) {
    return readJson(inputPath);
  }

  const candidates = [
    inputPath,
    join(process.cwd(), inputPath),
    join(process.cwd(), "..", inputPath),
    join(process.cwd(), "..", "..", inputPath)
  ];
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      return await readJson(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Unable to read ${inputPath}.`);
}

async function runRender(args: string[]): Promise<number> {
  const [subcommand] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printRenderHelp();
    return 0;
  }

  if (subcommand === "build") {
    const [datasetPath] = args.slice(1).filter((value) => !value.startsWith("--"));
    const flags = parseFlags(args.slice(1));
    const outputPath = getFlag(flags, "output");
    const format = getFlag(flags, "format") ?? "mvt";

    if (!datasetPath || !outputPath) {
      printJson({
        ok: false,
        command: "render build",
        issues: [createCliIssue("Dataset path and --output are required.")]
      });
      return 1;
    }

    if (format !== "mvt" && format !== "geojson") {
      printJson({
        ok: false,
        command: "render build",
        issues: [createCliIssue("--format must be mvt or geojson.")]
      });
      return 1;
    }

    const layerId = getFlag(flags, "layer");
    const minZoom = getOptionalNumberFlag(flags, "min-zoom");
    const maxZoom = getOptionalNumberFlag(flags, "max-zoom");
    const buildDate = getFlag(flags, "build-date");
    const result = await buildTerritoryRenderArtifactPath({
      inputPath: datasetPath,
      outputPath,
      format,
      ...(layerId ? { layerId } : {}),
      ...(minZoom !== undefined ? { minZoom } : {}),
      ...(maxZoom !== undefined ? { maxZoom } : {}),
      ...(buildDate ? { buildDate } : {}),
      ...(flags.has("force") ? { force: true } : {})
    });

    printJson({
      ok: true,
      command: "render build",
      data: {
        format: result.manifest.format,
        datasetId: result.manifest.datasetId,
        outputPath,
        fileCount: result.files.size,
        layers: result.manifest.layers
      }
    });
    return 0;
  }

  if (subcommand === "validate") {
    const [artifactPath] = args.slice(1).filter((value) => !value.startsWith("--"));

    if (!artifactPath) {
      printJson({
        ok: false,
        command: "render validate",
        issues: [createCliIssue("Render artifact path is required.")]
      });
      return 1;
    }

    const result = await validateTerritoryRenderArtifactPath(artifactPath);
    printJson({
      ok: result.ok,
      command: "render validate",
      ...(result.manifest ? { data: result.manifest } : {}),
      issues: result.issues
    });
    return result.ok ? 0 : 1;
  }

  if (subcommand === "inspect") {
    const [artifactPath] = args.slice(1).filter((value) => !value.startsWith("--"));

    if (!artifactPath) {
      printJson({
        ok: false,
        command: "render inspect",
        issues: [createCliIssue("Render artifact path is required.")]
      });
      return 1;
    }

    printJson({
      ok: true,
      command: "render inspect",
      data: await inspectTerritoryRenderArtifactPath(artifactPath)
    });
    return 0;
  }

  if (subcommand === "compare") {
    const [queryDatasetPath, renderArtifactPath] = args
      .slice(1)
      .filter((value) => !value.startsWith("--"));

    if (!queryDatasetPath || !renderArtifactPath) {
      printJson({
        ok: false,
        command: "render compare",
        issues: [createCliIssue("Query dataset path and render artifact path are required.")]
      });
      return 1;
    }

    const result = await compareTerritoryQueryRenderArtifacts({
      queryDatasetPath,
      renderArtifactPath
    });
    printJson({
      ok: result.ok,
      command: "render compare",
      issues: result.issues
    });
    return result.ok ? 0 : 1;
  }

  printJson({
    ok: false,
    command: "render",
    issues: [createCliIssue(`Unsupported render command '${subcommand}'.`)]
  });
  return 1;
}

async function runBenchmark(args: string[]): Promise<number> {
  const [subcommand] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printBenchmarkHelp();
    return 0;
  }

  if (subcommand === "run") {
    const flags = parseFlags(args.slice(1));
    const mode = getFlag(flags, "mode") ?? "fixture";

    if (mode !== "fixture" && mode !== "local-real") {
      printJson({
        ok: false,
        command: "benchmark run",
        issues: [createCliIssue("--mode must be fixture or local-real.")]
      });
      return 2;
    }

    const datasetPath = getFlag(flags, "dataset") ?? getPositionalArgs(args.slice(1)).find(Boolean);

    if (mode === "local-real" && !datasetPath) {
      const skipped = [
        "No local real-world dataset path was provided. Pass --dataset <dataset.json> to run this mode."
      ];
      printJson({
        ok: flags.has("allow-skip"),
        command: "benchmark run",
        data: createSkippedBenchmarkResult(flags, skipped),
        ...(flags.has("allow-skip")
          ? {}
          : { issues: skipped.map((message) => createCliIssue(message)) })
      });
      return flags.has("allow-skip") ? 0 : 2;
    }

    const result =
      mode === "fixture"
        ? createFixtureBenchmarkResult(flags)
        : createDatasetBenchmarkResult(loadTerritoryDataset(await readJson(datasetPath!)), {
            mode,
            scenario: getFlag(flags, "scenario") ?? "smoke",
            generatedAt: getBenchmarkGeneratedAt(flags),
            iterations: getPositiveIntegerFlag(flags, "iterations", 5_000),
            source: {
              type: "local-real",
              datasetPath
            }
          });

    printJson({
      ok: true,
      command: "benchmark run",
      data: result
    });
    return 0;
  }

  if (subcommand === "compare") {
    const flags = parseFlags(args.slice(1));
    const positional = getPositionalArgs(args.slice(1));
    const baselinePath = getFlag(flags, "baseline") ?? positional[0];
    const currentPath = getFlag(flags, "current") ?? positional[1];

    if (!baselinePath || !currentPath) {
      printJson({
        ok: false,
        command: "benchmark compare",
        issues: [createCliIssue("--baseline and --current are required.")]
      });
      return 2;
    }

    const comparison = compareCliBenchmarkResult(
      await readJson(currentPath),
      await readJson(baselinePath)
    );

    printJson({
      ok: comparison.ok,
      command: "benchmark compare",
      data: comparison
    });
    return comparison.ok ? 0 : 1;
  }

  printJson({
    ok: false,
    command: "benchmark",
    issues: [createCliIssue(`Unsupported benchmark command '${subcommand}'.`)]
  });
  return 2;
}

async function runRegistry(args: string[]): Promise<number> {
  const [subcommand] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printRegistryHelp();
    return 0;
  }

  if (subcommand === "build") {
    const flags = parseFlags(args.slice(1));
    const inputPath = getFlag(flags, "input");
    const outputPath = getFlag(flags, "output");
    const baseUrl = getFlag(flags, "base-url");

    if (!inputPath || !outputPath || !baseUrl) {
      printJson({
        ok: false,
        command: "registry build",
        issues: [createCliIssue("--input, --output, and --base-url are required.")]
      });
      return 1;
    }

    const generatedAt =
      getFlag(flags, "build-date") ??
      (process.env.SOURCE_DATE_EPOCH
        ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
        : new Date(0).toISOString());
    const registry = await buildTerritoryDatasetRegistryFromArtifacts({
      inputPath,
      baseUrl,
      generatedAt
    });
    await writeJsonOutput(outputPath, registry, flags.has("force"));
    printJson({
      ok: true,
      command: "registry build",
      data: {
        outputPath,
        datasetCount: registry.datasets.length,
        artifactCount: registry.datasets.reduce((sum, dataset) => sum + dataset.artifacts.length, 0)
      }
    });
    return 0;
  }

  if (subcommand === "validate") {
    const [registryPath] = args.slice(1).filter((value) => !value.startsWith("--"));

    if (!registryPath) {
      printJson({
        ok: false,
        command: "registry validate",
        issues: [createCliIssue("Registry path is required.")]
      });
      return 1;
    }

    const input = JSON.parse(await readFile(registryPath, "utf8")) as unknown;
    const validation = validateTerritoryDatasetRegistry(input);
    printJson({
      ok: validation.ok,
      command: "registry validate",
      ...(validation.ok
        ? { data: { datasetCount: validation.registry?.datasets.length ?? 0 } }
        : {}),
      issues: validation.issues
    });
    return validation.ok ? 0 : 1;
  }

  if (subcommand === "inspect" || subcommand === "list") {
    const flags = parseFlags(args.slice(1));
    const registryPath =
      getFlag(flags, "registry") ?? args.slice(1).find((value) => !value.startsWith("--"));

    if (!registryPath) {
      printJson({
        ok: false,
        command: `registry ${subcommand}`,
        issues: [createCliIssue("--registry is required.")]
      });
      return 1;
    }

    const registry = await readRegistryFile(registryPath);
    printJson({
      ok: true,
      command: `registry ${subcommand}`,
      data: {
        registryVersion: registry.registryVersion,
        generatedAt: registry.generatedAt,
        baseUrl: registry.baseUrl,
        datasets: registry.datasets.map((dataset) => ({
          id: dataset.id,
          version: dataset.version,
          displayName: dataset.displayName,
          levels: dataset.levels,
          artifactCount: dataset.artifacts.length
        }))
      }
    });
    return 0;
  }

  printJson({
    ok: false,
    command: "registry",
    issues: [createCliIssue(`Unsupported registry command '${subcommand}'.`)]
  });
  return 1;
}

async function runDatasetSearch(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const query = args.find((value) => !value.startsWith("--")) ?? "";
  const client = createCliRegistryClient(flags);
  const datasets = query ? await client.searchDatasets(query) : await client.listDatasets();

  printJson({
    ok: true,
    command: "dataset search",
    data: datasets.map((dataset) => ({
      id: dataset.id,
      version: dataset.version,
      displayName: dataset.displayName,
      levels: dataset.levels
    }))
  });
  return 0;
}

async function runDatasetInfo(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const datasetId = args.find((value) => !value.startsWith("--"));

  if (!datasetId) {
    printJson({
      ok: false,
      command: "dataset info",
      issues: [createCliIssue("Dataset id is required.")]
    });
    return 1;
  }

  const client = createCliRegistryClient(flags);
  const dataset = await client.getDatasetInfo(datasetId, getFlag(flags, "version"));
  printJson({
    ok: true,
    command: "dataset info",
    data: dataset
  });
  return 0;
}

async function runDatasetResolve(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const country = getFlag(flags, "country");
  const level = readAdminLevelFlag(flags, "level");

  if (!country || isCliIssueArray(level)) {
    printJson({
      ok: false,
      command: "dataset resolve",
      issues: [
        ...(!country ? [createCliIssue("--country is required.")] : []),
        ...(isCliIssueArray(level) ? level : [])
      ]
    });
    return 2;
  }

  const client = createCliRegistryClient(flags);
  const purpose = getFlag(flags, "purpose") ?? "render";
  const formatPreference = getFlag(flags, "format-preference")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const result = flags.has("deepest-available")
    ? await client.resolveDeepestAvailableTerritoryArtifact({
        country,
        requestedLevel: level,
        purpose: purpose as "query" | "render" | "metadata" | "adjacency" | "debug",
        fallback: "deepest-available",
        ...(formatPreference
          ? { formatPreference: formatPreference as Array<"mvt" | "geojson"> }
          : {})
      })
    : await client.resolveTerritoryArtifact({
        country,
        level,
        purpose: purpose as "query" | "render" | "metadata" | "adjacency" | "debug",
        ...(formatPreference
          ? { formatPreference: formatPreference as Array<"mvt" | "geojson"> }
          : {})
      });

  printJson({
    ok: true,
    command: "dataset resolve",
    data: result
  });
  return 0;
}

async function runDatasetInstall(
  args: string[],
  options: { update?: boolean } = {}
): Promise<number> {
  const flags = parseFlags(args);
  const datasetId = args.find((value) => !value.startsWith("--"));

  if (!datasetId) {
    printJson({
      ok: false,
      command: options.update ? "dataset update" : "dataset install",
      issues: [createCliIssue("Dataset id is required.")]
    });
    return 1;
  }

  const client = createCliRegistryClient(flags);
  const levels = parseLevelsFlag(getFlag(flags, "levels"));
  const detail = getFlag(flags, "detail");
  const version = getFlag(flags, "version");
  const handle = await client.installDataset({
    datasetId,
    ...(levels ? { levels } : {}),
    ...(detail ? { detail } : {}),
    ...(version ? { version } : {}),
    ...(flags.has("allow-prerelease") ? { allowPrerelease: true } : {}),
    ...(flags.has("load-adjacency") ? { loadAdjacency: true } : {}),
    ...(flags.has("refresh-registry") || flags.has("refresh") ? { refreshRegistry: true } : {}),
    ...(flags.has("remove-old") ? { removeOld: true } : {})
  });

  printJson({
    ok: true,
    command: options.update ? "dataset update" : "dataset install",
    data: handle.manifest
  });
  return 0;
}

async function runDatasetVerify(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const datasetId = args.find((value) => !value.startsWith("--"));

  if (!datasetId) {
    printJson({
      ok: false,
      command: "dataset verify",
      issues: [createCliIssue("Dataset id is required.")]
    });
    return 1;
  }

  const summary = await createCliRegistryClient(flags).verifyInstalledDataset(
    datasetId,
    getFlag(flags, "version")
  );
  printJson({ ok: true, command: "dataset verify", data: summary });
  return 0;
}

async function runDatasetRemove(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const datasetId = args.find((value) => !value.startsWith("--"));

  if (!datasetId) {
    printJson({
      ok: false,
      command: "dataset remove",
      issues: [createCliIssue("Dataset id is required.")]
    });
    return 1;
  }

  await createCliRegistryClient(flags).removeInstalledDataset(datasetId, getFlag(flags, "version"));
  printJson({ ok: true, command: "dataset remove", data: { datasetId } });
  return 0;
}

async function runDatasetListInstalled(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const data = await createCliRegistryClient(flags).listInstalledDatasets();
  printJson({ ok: true, command: "dataset list-installed", data });
  return 0;
}

async function runCache(args: string[]): Promise<number> {
  const [subcommand] = args;
  const flags = parseFlags(args.slice(1));
  const cacheDir = getFlag(flags, "cache-dir");
  const cache = createNodeTerritoryRegistryCache({
    ...(cacheDir ? { rootDir: cacheDir } : {})
  });

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printCacheHelp();
    return 0;
  }

  if (subcommand === "list" || subcommand === "verify") {
    const data = await cache.listInstalledDatasets();
    printJson({ ok: true, command: `cache ${subcommand}`, data });
    return 0;
  }

  if (subcommand === "clear") {
    if (!flags.has("force")) {
      printJson({
        ok: false,
        command: "cache clear",
        issues: [createCliIssue("--force is required to clear the cache.")]
      });
      return 1;
    }

    await cache.clear?.();
    printJson({ ok: true, command: "cache clear", data: { cleared: true } });
    return 0;
  }

  printJson({
    ok: false,
    command: "cache",
    issues: [createCliIssue(`Unsupported cache command '${subcommand}'.`)]
  });
  return 1;
}

async function runSource(args: string[]): Promise<number> {
  const [subcommand, sourceId] = args;
  const flags = parseFlags(subcommand === "info" ? args.slice(2) : args.slice(1));
  const json = flags.has("json");

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printSourceHelp();
    return 0;
  }

  if (subcommand === "list") {
    const adapters = listTerritorySourceAdapters();

    if (json) {
      printJson({
        ok: true,
        command: "source list",
        data: adapters.map((adapter) => adapter.describe())
      });
    } else {
      console.log(
        adapters
          .map((adapter) => {
            const description = adapter.describe();
            return [
              description.id.padEnd(16),
              formatAdminLevels(description).padEnd(16),
              description.supportedTransports.join(", ")
            ].join("  ");
          })
          .join("\n")
      );
    }

    return 0;
  }

  if (subcommand === "info" || subcommand === "inspect") {
    const inspectedSourceId =
      subcommand === "inspect" ? (getFlag(flags, "provider") ?? sourceId) : sourceId;

    if (!inspectedSourceId || inspectedSourceId === "--help" || inspectedSourceId === "-h") {
      printSourceInfoHelp();
      return inspectedSourceId ? 0 : 1;
    }

    try {
      const description = getTerritorySourceAdapter(inspectedSourceId).describe();
      const countryFlag = getFlag(flags, "country");
      const levelFlag = getFlag(flags, "level");
      const inspectRequest = {
        ...(countryFlag ? { country: countryFlag } : {}),
        ...(levelFlag ? { level: levelFlag } : {})
      };
      const capabilities =
        subcommand === "inspect"
          ? inspectTerritorySourceCapabilities({
              registry: {
                get: getTerritorySourceAdapter,
                list: listTerritorySourceAdapters,
                has: hasTerritorySourceAdapter
              },
              provider: inspectedSourceId,
              ...(countryFlag ? { country: countryFlag } : {}),
              ...(levelFlag ? { level: levelFlag } : {})
            })
          : undefined;

      if (json) {
        printJson({
          ok: true,
          command: subcommand === "inspect" ? "sources inspect" : "source info",
          data: {
            ...description,
            ...(Object.keys(inspectRequest).length > 0 ? { request: inspectRequest } : {}),
            ...(capabilities ? { capabilities } : {})
          }
        });
      } else {
        console.log(formatSourceDescription(description));
        if (Object.keys(inspectRequest).length > 0) {
          console.log(`Request: ${JSON.stringify(inspectRequest)}`);
        }
        if (capabilities) {
          console.log(formatSourceCapabilities(capabilities));
        }
      }

      return 0;
    } catch (error) {
      printJson({
        ok: false,
        command: subcommand === "inspect" ? "sources inspect" : "source info",
        issues: [
          createCliIssue(error instanceof Error ? error.message : String(error), {
            code: "SOURCE_ADAPTER_NOT_FOUND"
          })
        ]
      });
      return 1;
    }
  }

  printJson({
    ok: false,
    command: "source",
    issues: [createCliIssue(`Unsupported source command '${subcommand}'.`)]
  });
  return 1;
}

async function runImportCommand(args: string[]): Promise<number> {
  const [first] = args;

  if (!first || first === "--help" || first === "-h") {
    printImportHelp();
    return 0;
  }

  const flags = parseFlags(args.slice(1));

  if (hasTerritorySourceAdapter(first)) {
    return runSourceImport(first, flags);
  }

  if (looksLikeSourceImport(flags)) {
    printJson({
      ok: false,
      command: "import",
      issues: [
        createCliIssue(`Unknown source adapter '${first}'.`, {
          code: "SOURCE_ADAPTER_NOT_FOUND"
        })
      ]
    });
    return 1;
  }

  return runImport(first, flags);
}

async function runSourceImport(
  sourceId: string,
  flags: Map<string, string | true>
): Promise<number> {
  const outputPath = getFlag(flags, "output");

  if (!outputPath) {
    printJson({
      ok: false,
      command: `import ${sourceId}`,
      issues: [createCliIssue("--output is required for source imports.")]
    });
    return 1;
  }

  const request = createSourceRequest(flags);

  if (!request.input && !request.url) {
    printJson({
      ok: false,
      command: `import ${sourceId}`,
      issues: [createCliIssue("--input or --url is required for source imports.")]
    });
    return 1;
  }

  if (request.input && request.url) {
    printJson({
      ok: false,
      command: `import ${sourceId}`,
      issues: [createCliIssue("Use either --input or --url, not both.")]
    });
    return 1;
  }

  const buildDate = getFlag(flags, "build-date");
  const cacheDir = getFlag(flags, "cache-dir");
  const commonPipelineOptions = {
    outputPath,
    ...(flags.has("force") ? { force: true } : {}),
    ...(flags.has("strict") ? { strict: true } : {}),
    ...(flags.has("no-cache") ? { noCache: true } : {}),
    ...(cacheDir ? { cache: { enabled: true, directory: cacheDir } } : {}),
    ...(buildDate ? { now: () => new Date(buildDate).toISOString() } : {})
  };

  let result: TerritorySourcePipelineResult;

  try {
    if (sourceId === "natural-earth") {
      const detail = getFlag(flags, "detail");
      const details = detail ? readDetailFlags(detail) : undefined;

      if (detail && !details) {
        printJson({
          ok: false,
          command: "import natural-earth",
          issues: [createCliIssue(`Invalid --detail '${detail}'. Expected low, medium, or high.`)]
        });
        return 1;
      }

      const datasetVersion = getFlag(flags, "dataset-version");
      const sourceDate = getFlag(flags, "source-date");
      const sourceUrl = getFlag(flags, "source-url");
      const sourceVersion = getFlag(flags, "source-version");
      result = await runTerritorySourcePipeline<NaturalEarthSourceOptions>({
        adapter: sourceId,
        request,
        options: {
          ...(buildDate ? { buildDate: new Date(buildDate).toISOString() } : {}),
          ...(details ? { details } : {}),
          ...(datasetVersion ? { datasetVersion } : {}),
          ...(sourceDate ? { sourceDate } : {}),
          ...(sourceUrl ? { sourceUrl } : {}),
          ...(sourceVersion ? { sourceVersion } : {})
        },
        ...commonPipelineOptions
      });
    } else if (sourceId === "geoboundaries") {
      const options = readGeoBoundariesOptions(flags);

      if (Array.isArray(options)) {
        printJson({ ok: false, command: "import geoboundaries", issues: options });
        return 1;
      }

      result = await runTerritorySourcePipeline<GeoBoundariesSourceOptions>({
        adapter: sourceId,
        request,
        options,
        ...commonPipelineOptions
      });
    } else if (sourceId === "geojson") {
      const options = readGenericGeoJsonOptions(flags);

      if (Array.isArray(options)) {
        printJson({ ok: false, command: "import geojson", issues: options });
        return 1;
      }

      result = await runTerritorySourcePipeline<GenericGeoJsonSourceOptions>({
        adapter: sourceId,
        request,
        options,
        ...commonPipelineOptions
      });
    } else {
      printJson({
        ok: false,
        command: `import ${sourceId}`,
        issues: [
          createCliIssue(`Unknown source adapter '${sourceId}'.`, {
            code: "SOURCE_ADAPTER_NOT_FOUND"
          })
        ]
      });
      return 1;
    }
  } catch (error) {
    printJson({
      ok: false,
      command: `import ${sourceId}`,
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 1;
  }

  let adjacencyOutputPath: string | undefined;

  if (result.ok && flags.has("build-adjacency")) {
    const outputBasePath = result.output?.outputPath;

    if (!outputBasePath) {
      printJson({
        ok: false,
        command: `import ${sourceId}`,
        issues: [createCliIssue("Source import did not expose an output path for adjacency build.")]
      });
      return 1;
    }

    try {
      const adjacencyOverridesPath = getFlag(flags, "adjacency-overrides");
      adjacencyOutputPath = join(outputBasePath, "adjacency");
      await buildTerritoryAdjacencyPath(outputBasePath, {
        outputPath: adjacencyOutputPath,
        includePointTouches: flags.has("adjacency-include-point-touches"),
        minimumSharedBoundaryMeters: getNumberFlag(
          flags,
          "adjacency-minimum-shared-boundary-meters",
          0
        ),
        ...(adjacencyOverridesPath ? { overridesPath: adjacencyOverridesPath } : {}),
        ...(buildDate ? { buildDate } : {}),
        ...(flags.has("strict") ? { strict: true } : {}),
        ...(flags.has("force") ? { force: true } : {})
      });
    } catch (error) {
      printJson({
        ok: false,
        command: `import ${sourceId}`,
        issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
      });
      return 1;
    }
  }

  printJson({
    ok: result.ok,
    command: `import ${sourceId}`,
    ...(result.ok
      ? {
          data: {
            provider: result.provider,
            outputPath: result.output?.outputPath,
            adjacencyOutputPath,
            datasetId: result.transform?.dataset.manifest.datasetId,
            zoneCount: result.transform?.dataset.zones.length,
            cacheHit: result.artifact?.cacheHit ?? false,
            stages: result.events.map((event) => `${event.stage}:${event.status}`)
          },
          issues: result.issues
        }
      : { issues: normalizeSourceIssues(result.issues) })
  });
  return result.ok ? 0 : 1;
}

async function readJson(filePath: string): Promise<unknown> {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as unknown;
}

function createFixtureBenchmarkResult(flags: Map<string, string | true>): CliBenchmarkResult {
  const rows = getPositiveIntegerFlag(flags, "rows", 50);
  const columns = getPositiveIntegerFlag(flags, "columns", 50);
  const cellSize = getPositiveNumberFlag(flags, "cell-size", 0.01);
  const dataset = createSyntheticGridDataset({
    datasetId: getFlag(flags, "dataset-id") ?? "territorykit-fixture-benchmark",
    rows,
    columns,
    cellSize
  });

  return createDatasetBenchmarkResult(dataset, {
    mode: "fixture",
    scenario: getFlag(flags, "scenario") ?? "smoke",
    generatedAt: getBenchmarkGeneratedAt(flags),
    iterations: getPositiveIntegerFlag(flags, "iterations", 5_000),
    source: {
      type: "synthetic-grid",
      rows,
      columns,
      cellSize
    }
  });
}

function createDatasetBenchmarkResult(
  dataset: TerritoryDataset,
  options: {
    mode: "fixture" | "local-real";
    scenario: string;
    generatedAt: string;
    iterations: number;
    source: Record<string, unknown>;
  }
): CliBenchmarkResult {
  const validation = measureOnce(() => loadTerritoryDataset(dataset));
  const engineConstruction = measureOnce(() => createTerritoryEngine({ dataset }));
  const engine = engineConstruction.value;
  const lookupZone = dataset.zones[Math.floor(dataset.zones.length / 2)];

  if (!lookupZone) {
    throw new Error("Benchmark dataset must contain at least one zone.");
  }

  const [lng, lat] = lookupZone.center;
  const bbox = lookupZone.bbox;
  const bounds = {
    west: Math.max(-180, bbox[0] - 0.01),
    south: Math.max(-90, bbox[1] - 0.01),
    east: Math.min(180, bbox[2] + 0.01),
    north: Math.min(90, bbox[3] + 0.01),
    level: lookupZone.level
  };
  const getZoneById = measureRepeated(options.iterations, () => engine.getZoneById(lookupZone.id));
  const latLngToZone = measureRepeated(options.iterations, () =>
    engine.latLngToZone({ lat, lng }, { level: lookupZone.level })
  );
  const getZonesInBounds = measureRepeated(options.iterations, () =>
    engine.getZonesInBounds(bounds)
  );

  return {
    schemaVersion: "territorykit-benchmark-result@1",
    mode: options.mode,
    scenario: options.scenario,
    generatedAt: options.generatedAt,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch
    },
    source: options.source,
    inputs: {
      datasetId: dataset.manifest.datasetId,
      datasetVersion: dataset.manifest.datasetVersion,
      featureCount: dataset.zones.length,
      iterations: options.iterations
    },
    metrics: {
      datasetValidationMs: roundMetric(validation.durationMs),
      engineConstructionMs: roundMetric(engineConstruction.durationMs),
      getZoneByIdMeanMs: roundMetric(getZoneById.meanMs),
      latLngToZoneMeanMs: roundMetric(latLngToZone.meanMs),
      getZonesInBoundsMeanMs: roundMetric(getZonesInBounds.meanMs)
    }
  };
}

function createSkippedBenchmarkResult(
  flags: Map<string, string | true>,
  skipped: string[]
): CliBenchmarkResult {
  return {
    schemaVersion: "territorykit-benchmark-result@1",
    mode: "local-real",
    scenario: getFlag(flags, "scenario") ?? "smoke",
    generatedAt: getBenchmarkGeneratedAt(flags),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch
    },
    source: {
      type: "local-real"
    },
    inputs: {
      featureCount: 0
    },
    metrics: {},
    skipped
  };
}

function compareCliBenchmarkResult(
  current: unknown,
  baseline: unknown
): {
  ok: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  if (!isRecordValue(current) || current.schemaVersion !== "territorykit-benchmark-result@1") {
    issues.push("Current benchmark result must use territorykit-benchmark-result@1.");
  }

  if (!isRecordValue(baseline) || baseline.schemaVersion !== "territorykit-benchmark-baseline@1") {
    issues.push("Benchmark baseline must use territorykit-benchmark-baseline@1.");
  }

  if (issues.length > 0 || !isRecordValue(current) || !isRecordValue(baseline)) {
    return { ok: false, issues };
  }

  if (typeof baseline.mode === "string" && current.mode !== baseline.mode) {
    issues.push(`Expected mode '${baseline.mode}', got '${String(current.mode)}'.`);
  }

  if (typeof baseline.scenario === "string" && current.scenario !== baseline.scenario) {
    issues.push(`Expected scenario '${baseline.scenario}', got '${String(current.scenario)}'.`);
  }

  const inputs = isRecordValue(current.inputs) ? current.inputs : {};
  const featureCount = Number(inputs.featureCount ?? 0);

  if (
    typeof baseline.minimumFeatureCount === "number" &&
    featureCount < baseline.minimumFeatureCount
  ) {
    issues.push(`Expected at least ${baseline.minimumFeatureCount} features, got ${featureCount}.`);
  }

  const metrics = isRecordValue(current.metrics) ? current.metrics : {};
  const budgets = isRecordValue(baseline.budgets) ? baseline.budgets : {};

  for (const [metric, budget] of Object.entries(budgets)) {
    const maxValue = Number(budget);
    const value = Number(metrics[metric]);

    if (!Number.isFinite(maxValue)) {
      continue;
    }

    if (!Number.isFinite(value)) {
      issues.push(`Missing numeric benchmark metric '${metric}'.`);
      continue;
    }

    if (value > maxValue) {
      issues.push(`Metric '${metric}' exceeded budget ${maxValue}; got ${value}.`);
    }
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

function measureOnce<T>(callback: () => T): { value: T; durationMs: number } {
  const start = performance.now();
  const value = callback();

  return {
    value,
    durationMs: performance.now() - start
  };
}

function measureRepeated(iterations: number, callback: () => unknown): { meanMs: number } {
  const start = performance.now();
  let guard = 0;

  for (let index = 0; index < iterations; index += 1) {
    const value = callback();

    if (Array.isArray(value)) {
      guard += value.length;
    } else if (value) {
      guard += 1;
    }
  }

  if (guard < 0) {
    throw new Error("Benchmark guard overflowed.");
  }

  return {
    meanMs: (performance.now() - start) / iterations
  };
}

function getBenchmarkGeneratedAt(flags: Map<string, string | true>): string {
  return getFlag(flags, "build-date") ?? new Date().toISOString();
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}

function isRecordValue(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

async function readJsonSource(filePath: string): Promise<JsonSource> {
  const content = await readFile(filePath, "utf8");

  return {
    input: JSON.parse(content) as unknown,
    lineIndex: createJsonLineIndex(content)
  };
}

async function runImport(filePath: string, flags: Map<string, string | true>): Promise<number> {
  const { input, lineIndex } = await readJsonSource(filePath);
  const manifest = createManifestFromFlags(flags, "imported-territories");
  const importOptions: TerritoryGeoJsonImportOptions = {
    manifest,
    sourcePath: filePath
  };
  const idProperty = getFlag(flags, "id-property");
  const levelProperty = getFlag(flags, "level-property");
  const parentIdProperty = getFlag(flags, "parent-id-property");
  const childIdsProperty = getFlag(flags, "child-ids-property");
  const neighborIdsProperty = getFlag(flags, "neighbor-ids-property");

  if (idProperty) {
    importOptions.idProperty = idProperty;
  }

  if (levelProperty) {
    importOptions.levelProperty = levelProperty;
  }

  if (parentIdProperty) {
    importOptions.parentIdProperty = parentIdProperty;
  }

  if (childIdsProperty) {
    importOptions.childIdsProperty = childIdsProperty;
  }

  if (neighborIdsProperty) {
    importOptions.neighborIdsProperty = neighborIdsProperty;
  }

  const result = createTerritoryDatasetFromGeoJson(input, importOptions);
  const dataset = result.dataset ? withDeterministicGeometryHash(result.dataset) : undefined;

  printJson({
    ok: result.ok,
    command: "import",
    ...(result.ok ? { data: dataset } : { issues: withSourceLines(result.issues, lineIndex) })
  });
  return result.ok ? 0 : 1;
}

function withSourceLines(
  issues: TerritoryValidationIssue[],
  lineIndex: JsonLineIndex
): TerritoryValidationIssue[] {
  return issues.map((issue) => {
    if (issue.line !== undefined) {
      return issue;
    }

    const line = lineIndex.findLineForIssue(issue);

    return line === undefined ? issue : { ...issue, line };
  });
}

function createJsonLineIndex(content: string): JsonLineIndex {
  const lines = content.split(/\r?\n/);

  return {
    findLineForIssue(issue) {
      if (issue.featureId) {
        const featureIdLine = findFeatureIdLine(lines, issue.featureId);

        if (featureIdLine !== undefined) {
          return featureIdLine;
        }
      }

      return findFeaturePathLine(lines, issue.path);
    }
  };
}

function findFeatureIdLine(lines: string[], featureId: string): number | undefined {
  const serializedFeatureId = JSON.stringify(featureId);

  for (const [index, line] of lines.entries()) {
    if (/"id"\s*:/.test(line) && line.includes(serializedFeatureId)) {
      return index + 1;
    }
  }

  return undefined;
}

function findFeaturePathLine(lines: string[], path: string): number | undefined {
  const match = /^\$\.features\[(\d+)\]/.exec(path);

  if (!match) {
    return undefined;
  }

  const targetFeatureIndex = Number(match[1]);
  let currentFeatureIndex = -1;

  for (const [index, line] of lines.entries()) {
    if (/"type"\s*:\s*"Feature"/.test(line)) {
      currentFeatureIndex += 1;
    }

    if (currentFeatureIndex === targetFeatureIndex) {
      return index + 1;
    }
  }

  return undefined;
}

function runGenerate(args: string[]): number {
  const flags = parseFlags(args);
  const kind = getFlag(flags, "kind") ?? "grid";
  const datasetId = getFlag(flags, "dataset-id") ?? "generated-territories";

  if (kind === "grid") {
    const gridOptions = {
      datasetId,
      rows: getPositiveIntegerFlag(flags, "rows", 10),
      columns: getPositiveIntegerFlag(flags, "columns", 10),
      cellSize: getPositiveNumberFlag(flags, "cell-size", 0.01),
      level: getNonNegativeIntegerFlag(flags, "level", 0)
    };
    const datasetVersion = getFlag(flags, "dataset-version");
    const sourceDate = getFlag(flags, "source-date");

    const dataset = createSyntheticGridDataset({
      ...gridOptions,
      ...(datasetVersion ? { datasetVersion } : {}),
      ...(sourceDate ? { sourceDate } : {})
    });

    printJson({ ok: true, command: "generate", data: dataset });
    return 0;
  }

  if (kind === "voronoi" || kind === "weighted-voronoi") {
    const seeds = parseSeeds(getFlag(flags, "seeds"));
    const datasetVersion = getFlag(flags, "dataset-version");
    const sourceDate = getFlag(flags, "source-date");
    const dataset = createWeightedVoronoiDataset({
      datasetId,
      seeds,
      bounds: readBounds(flags),
      level: getNonNegativeIntegerFlag(flags, "level", 0),
      ...(datasetVersion ? { datasetVersion } : {}),
      ...(sourceDate ? { sourceDate } : {})
    });

    printJson({ ok: true, command: "generate", data: dataset });
    return 0;
  }

  printJson({
    ok: false,
    command: "generate",
    issues: [createCliIssue(`Unsupported generate kind '${kind}'.`)]
  });
  return 1;
}

function createManifestFromFlags(
  flags: Map<string, string | true>,
  fallbackDatasetId: string
): TerritoryDatasetManifest {
  return {
    datasetId: getFlag(flags, "dataset-id") ?? fallbackDatasetId,
    datasetVersion: getFlag(flags, "dataset-version") ?? "0.0.0-imported",
    schemaVersion: TERRITORY_SCHEMA_VERSION,
    sourceDate: getFlag(flags, "source-date") ?? "imported",
    geometryHash: getFlag(flags, "geometry-hash") ?? "import-pending",
    license: getFlag(flags, "license") ?? "Apache-2.0",
    name: getFlag(flags, "name") ?? "Imported TerritoryKit dataset"
  };
}

function withDeterministicGeometryHash(dataset: TerritoryDataset): TerritoryDataset {
  return {
    ...dataset,
    manifest: {
      ...dataset.manifest,
      geometryHash: createDatasetGeometryHash(dataset)
    }
  };
}

function createSourceRequest(flags: Map<string, string | true>): TerritorySourceRequest {
  const input = getFlag(flags, "input");
  const url = getFlag(flags, "url");
  const expectedSha256 = getFlag(flags, "source-sha256");
  const version = getFlag(flags, "source-version");

  return {
    ...(input ? { input } : {}),
    ...(url ? { url } : {}),
    ...(expectedSha256 ? { expectedSha256 } : {}),
    ...(version ? { version } : {}),
    ...(flags.has("refresh") ? { refresh: true } : {})
  };
}

function looksLikeSourceImport(flags: Map<string, string | true>): boolean {
  return [
    "input",
    "url",
    "output",
    "country",
    "admin-level",
    "source-sha256",
    "cache-dir",
    "no-cache",
    "refresh"
  ].some((flag) => flags.has(flag));
}

function readGeoBoundariesOptions(
  flags: Map<string, string | true>
): GeoBoundariesSourceOptions | CliIssue[] {
  const countryCode = getFlag(flags, "country");
  const adminLevel = getFlag(flags, "admin-level");
  const issues: CliIssue[] = [];

  if (!countryCode) {
    issues.push(createCliIssue("--country is required.", { code: "SOURCE_OPTIONS_INVALID" }));
  }

  if (!adminLevel) {
    issues.push(createCliIssue("--admin-level is required.", { code: "SOURCE_OPTIONS_INVALID" }));
  }

  if (!countryCode || !adminLevel) {
    return issues;
  }

  const buildDate = getFlag(flags, "build-date");
  const releaseType = getFlag(flags, "release-type");
  const sourceDate = getFlag(flags, "source-date");
  const sourceUrl = getFlag(flags, "source-url");
  const datasetId = getFlag(flags, "dataset-id");
  const datasetVersion = getFlag(flags, "dataset-version");
  const attribution = getFlag(flags, "attribution");

  return {
    countryCode,
    adminLevel,
    ...(releaseType ? { releaseType } : {}),
    ...(sourceDate ? { sourceDate } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(datasetId ? { datasetId } : {}),
    ...(datasetVersion ? { datasetVersion } : {}),
    ...(buildDate ? { buildDate: new Date(buildDate).toISOString() } : {}),
    ...(attribution ? { attribution } : {})
  };
}

function readGenericGeoJsonOptions(
  flags: Map<string, string | true>
): GenericGeoJsonSourceOptions | CliIssue[] {
  const countryCode = getFlag(flags, "country");
  const adminLevel = getFlag(flags, "admin-level");
  const nameProperty = getFlag(flags, "name-property");
  const issues: CliIssue[] = [];

  if (!countryCode) {
    issues.push(createCliIssue("--country is required.", { code: "SOURCE_OPTIONS_INVALID" }));
  }

  if (!adminLevel) {
    issues.push(createCliIssue("--admin-level is required.", { code: "SOURCE_OPTIONS_INVALID" }));
  }

  if (!nameProperty) {
    issues.push(createCliIssue("--name-property is required.", { code: "SOURCE_OPTIONS_INVALID" }));
  }

  if (!countryCode || !adminLevel || !nameProperty) {
    return issues;
  }

  const buildDate = getFlag(flags, "build-date");
  const idProperty = getFlag(flags, "id-property");
  const sourceIdProperty = getFlag(flags, "source-id-property");
  const parentProperty = getFlag(flags, "parent-property");
  const codeProperty = getFlag(flags, "code-property");
  const localType = getFlag(flags, "local-type");
  const provider = getFlag(flags, "provider");
  const sourceUrl = getFlag(flags, "source-url");
  const sourceDate = getFlag(flags, "source-date");
  const license = getFlag(flags, "license");
  const attribution = getFlag(flags, "attribution");
  const datasetId = getFlag(flags, "dataset-id");
  const datasetVersion = getFlag(flags, "dataset-version");

  return {
    countryCode,
    adminLevel,
    nameProperty,
    ...(idProperty ? { idProperty } : {}),
    ...(sourceIdProperty ? { sourceIdProperty } : {}),
    ...(parentProperty ? { parentProperty } : {}),
    ...(codeProperty ? { codeProperty } : {}),
    ...(localType ? { localType } : {}),
    ...(provider ? { provider } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(sourceDate ? { sourceDate } : {}),
    ...(license ? { license } : {}),
    ...(attribution ? { attribution } : {}),
    ...(datasetId ? { datasetId } : {}),
    ...(datasetVersion ? { datasetVersion } : {}),
    ...(buildDate ? { buildDate: new Date(buildDate).toISOString() } : {})
  };
}

function readGeometryQualityOptions(
  flags: Map<string, string | true>
): GeometryQualityOptions | CliIssue[] {
  const issues: CliIssue[] = [];
  const checks = readGeometryChecksFlag(flags, issues);
  const backend = getFlag(flags, "backend") ?? "typescript";
  const epsilon = readOptionalNonNegativeNumberFlag(flags, "epsilon", issues);
  const batchSize = readOptionalPositiveIntegerFlag(flags, "batch-size", issues);
  const allowHoleBoundaryTouch = readOptionalBooleanFlag(
    flags,
    "allow-hole-boundary-touch",
    issues
  );

  if (backend !== "typescript") {
    issues.push(
      createCliIssue(`Geometry backend '${backend}' is not available in this CLI build.`, {
        code: "GEOMETRY_BACKEND_UNAVAILABLE"
      })
    );
  }

  if (issues.length > 0 || !checks) {
    return issues;
  }

  return {
    mode: "validate-only",
    checks,
    ...(flags.has("strict") ? { strict: true } : {}),
    ...(epsilon === undefined ? {} : { epsilon }),
    ...(batchSize === undefined ? {} : { batchSize }),
    ...(allowHoleBoundaryTouch === undefined ? {} : { allowHoleBoundaryTouch })
  };
}

function readGeometryRepairOptions(
  flags: Map<string, string | true>,
  commonOptions: GeometryQualityOptions
): (GeometryRepairOptions & { force?: boolean }) | CliIssue[] {
  const issues: CliIssue[] = [];
  const repairStrategy = (getFlag(flags, "repair-strategy") ?? "safe") as GeometryRepairStrategy;
  const maximumAreaDeltaRatio = readOptionalNonNegativeNumberFlag(
    flags,
    "maximum-area-delta-ratio",
    issues
  );
  const normalizeRingOrientation = readOptionalBooleanFlag(
    flags,
    "normalize-ring-orientation",
    issues
  );

  if (repairStrategy !== "safe" && repairStrategy !== "postgis-make-valid") {
    issues.push(
      createCliIssue(
        `Invalid --repair-strategy '${repairStrategy}'. Expected safe or postgis-make-valid.`
      )
    );
  } else if (repairStrategy === "postgis-make-valid") {
    issues.push(
      createCliIssue("Repair strategy 'postgis-make-valid' requires a PostGIS backend.", {
        code: "GEOMETRY_REPAIR_STRATEGY_UNAVAILABLE"
      })
    );
  }

  if (issues.length > 0) {
    return issues;
  }

  return {
    ...commonOptions,
    mode: "repair",
    repairStrategy: "safe",
    ...(maximumAreaDeltaRatio === undefined ? {} : { maximumAreaDeltaRatio }),
    ...(normalizeRingOrientation === undefined ? {} : { normalizeRingOrientation }),
    ...(flags.has("force") ? { force: true } : {})
  };
}

function readAdjacencyBuildOptions(
  flags: Map<string, string | true>
): (TerritoryAdjacencyBuildOptions & { buildDate?: string }) | CliIssue[] {
  const issues: CliIssue[] = [];
  const epsilon = readOptionalNonNegativeNumberFlag(flags, "epsilon", issues);
  const batchSize = readOptionalPositiveIntegerFlag(flags, "batch-size", issues);
  const minimumSharedBoundaryMeters = readOptionalNonNegativeNumberFlag(
    flags,
    "minimum-shared-boundary-meters",
    issues
  );

  if (flags.has("same-parent-only") && flags.has("all-parents")) {
    issues.push(createCliIssue("Use either --same-parent-only or --all-parents, not both."));
  }

  if (flags.has("same-admin-level-only") && flags.has("cross-level")) {
    issues.push(createCliIssue("Use either --same-admin-level-only or --cross-level, not both."));
  }

  if (issues.length > 0) {
    return issues;
  }

  return {
    sameParentOnly: !flags.has("all-parents"),
    sameAdminLevelOnly: !flags.has("cross-level"),
    includePointTouches: flags.has("include-point-touches"),
    ...(minimumSharedBoundaryMeters === undefined ? {} : { minimumSharedBoundaryMeters }),
    ...(epsilon === undefined ? {} : { epsilon }),
    ...(batchSize === undefined ? {} : { batchSize }),
    ...(flags.has("strict") ? { strict: true } : {})
  };
}

function readAdjacencyTypesFlag(
  flags: Map<string, string | true>
): TerritoryAdjacencyType[] | CliIssue[] | undefined {
  const value = getFlag(flags, "type");

  if (!value) {
    return undefined;
  }

  const types = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const validTypes = new Set(["shared-border", "point-touch", "maritime", "logical"]);
  const invalid = types.find((type) => !validTypes.has(type));

  if (invalid) {
    return [createCliIssue(`Invalid adjacency type '${invalid}'.`)];
  }

  return types as TerritoryAdjacencyType[];
}

function readCountryLevelsFlag(
  flags: Map<string, string | true>,
  fallback?: readonly TerritoryAdminLevel[]
): TerritoryAdminLevel[] | CliIssue[] | undefined {
  const value = getFlag(flags, "levels");

  if (!value) {
    return fallback ? [...fallback] : undefined;
  }

  const levels = value
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);
  const validLevels = new Set<TerritoryAdminLevel>(TERRITORY_ADMIN_LEVELS);
  const invalid = levels.find((level) => !validLevels.has(level as TerritoryAdminLevel));

  if (!invalid && levels.length > 0) {
    return [...new Set(levels)] as TerritoryAdminLevel[];
  }

  return [
    createCliIssue(
      invalid
        ? `Invalid --levels entry '${invalid}'. Expected ${TERRITORY_ADMIN_LEVELS.join(", ")}.`
        : "--levels must include at least one admin level."
    )
  ];
}

function readAdminLevelFlag(
  flags: Map<string, string | true>,
  name: string
): TerritoryAdminLevel | CliIssue[] {
  const value = getFlag(flags, name);

  if (!value) {
    return [createCliIssue(`--${name} is required.`)];
  }

  const level = value.trim().toUpperCase();

  if (TERRITORY_ADMIN_LEVELS.includes(level as TerritoryAdminLevel)) {
    return level as TerritoryAdminLevel;
  }

  return [
    createCliIssue(`Invalid --${name} '${value}'. Expected ${TERRITORY_ADMIN_LEVELS.join(", ")}.`)
  ];
}

function isCliIssueArray(input: unknown): input is CliIssue[] {
  return (
    Array.isArray(input) &&
    input.some(
      (entry) =>
        typeof entry === "object" && entry !== null && "severity" in entry && "message" in entry
    )
  );
}

function printAdjacencyInspection(
  zoneId: string,
  neighbors: string[],
  relations: Array<{
    from: string;
    to: string;
    type: TerritoryAdjacencyType;
    sharedBoundaryMeters?: number;
  }>
): void {
  const grouped = new Map<TerritoryAdjacencyType, string[]>();

  for (const edge of relations) {
    const neighborId = edge.from === zoneId ? edge.to : edge.from;
    const label =
      edge.sharedBoundaryMeters === undefined
        ? neighborId
        : `${neighborId} - ${Math.round(edge.sharedBoundaryMeters)} m`;
    grouped.set(edge.type, [...(grouped.get(edge.type) ?? []), label]);
  }

  console.log(`Zone: ${zoneId}`);
  console.log(`Neighbors: ${neighbors.length}`);

  for (const type of ["shared-border", "point-touch", "maritime", "logical"] as const) {
    const values = grouped.get(type)?.sort();

    if (!values || values.length === 0) {
      continue;
    }

    console.log("");
    console.log(type);

    for (const value of values) {
      console.log(`- ${value}`);
    }
  }
}

function readGeometryChecksFlag(
  flags: Map<string, string | true>,
  issues: CliIssue[]
): GeometryQualityCheckPreset | undefined {
  const checks = getFlag(flags, "checks") ?? "full";

  if (checks === "basic" || checks === "full") {
    return checks;
  }

  issues.push(createCliIssue(`Invalid --checks '${checks}'. Expected basic or full.`));
  return undefined;
}

function normalizeSourceIssues(issues: TerritorySourceIssue[]): TerritorySourceIssue[] {
  return issues.map((issue) => {
    if (issue.code !== "SOURCE_INPUT_NOT_FOUND") {
      return issue;
    }

    return {
      ...issue,
      code: "SOURCE_NOT_FOUND"
    };
  });
}

function formatAdminLevels(description: TerritorySourceDescription): string {
  const levels = [...description.supportedAdminLevels];

  if (description.id === "geojson") {
    return "configurable";
  }

  if (levels.length === TERRITORY_ADMIN_LEVELS.length) {
    return "ADM0-ADM5";
  }

  return levels.join(",");
}

function formatSourceDescription(description: TerritorySourceDescription): string {
  return [
    `Source ID: ${description.id}`,
    `Display name: ${description.displayName}`,
    `Supported admin levels: ${formatAdminLevels(description)}`,
    `Supported transports: ${description.supportedTransports.join(", ")}`,
    `Input formats: ${description.inputFormats.join(", ")}`,
    `Default license: ${description.defaultLicense ?? "not declared"}`,
    `Attribution required: ${description.attributionRequired ? "yes" : "no"}`,
    `Options: ${description.options.map((option) => option.name).join(", ") || "none"}`,
    `Example: ${description.exampleCommand}`
  ].join("\n");
}

function formatSourceCapabilities(capabilities: TerritoryProviderCapabilitiesResult): string {
  const rows = Object.values(capabilities.levels)
    .filter((level) => Boolean(level))
    .map((level) => `${level.level}: ${level.status}${level.reason ? ` (${level.reason})` : ""}`)
    .join("\n");

  return ["", "Capabilities:", rows].join("\n");
}

function formatCountryConfig(config: ReturnType<typeof getTerritoryCountryConfig>): string {
  return [
    `Country: ${config.displayName} (${config.countryCodeAlpha2}/${config.countryCodeAlpha3})`,
    `Dataset ID: ${config.datasetId}`,
    `Loader package: ${config.loaderPackageName}`,
    `Source provider: ${config.sourceProvider}`,
    `Default release: ${config.defaultReleaseType ?? "not specified"}`,
    `Requested levels: ${config.requestedLevels.join(", ")}`,
    `Adjacency levels: ${config.adjacencyPolicy.levels.join(", ") || "none"}`,
    `License policy: ${config.licensePolicy.allowedReleaseTypes.join(", ")}`
  ].join("\n");
}

function parseFlags(args: string[]): Map<string, string | true> {
  const flags = new Map<string, string | true>();

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (!value?.startsWith("--")) {
      continue;
    }

    const key = value.slice(2);
    const next = args[index + 1];

    if (!next || next.startsWith("--")) {
      flags.set(key, true);
      continue;
    }

    flags.set(key, next);
    index += 1;
  }

  return flags;
}

function getPositionalArgs(args: string[]): string[] {
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (!value) {
      continue;
    }

    if (value.startsWith("--")) {
      const next = args[index + 1];

      if (next && !next.startsWith("--")) {
        index += 1;
      }

      continue;
    }

    positional.push(value);
  }

  return positional;
}

function getFlag(flags: Map<string, string | true>, key: string): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function getNumberFlag(flags: Map<string, string | true>, key: string, fallback: number): number {
  const value = getFlag(flags, key);
  const parsed = value === undefined ? Number.NaN : Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function getOptionalNumberFlag(flags: Map<string, string | true>, key: string): number | undefined {
  const value = getFlag(flags, key);

  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function createCliRegistryClient(flags: Map<string, string | true>) {
  const registryUrl = getFlag(flags, "registry");
  const cacheDir = getFlag(flags, "cache-dir");

  return createNodeTerritoryRegistryClient({
    ...(registryUrl ? { registryUrl } : {}),
    ...(cacheDir ? { cacheDir } : {}),
    ...(flags.has("offline") ? { offline: true } : {}),
    ...(flags.has("no-verify") ? { verifyChecksums: false } : {}),
    ...(flags.has("allow-http") ? { allowHttp: true } : {})
  });
}

function parseLevelsFlag(input: string | undefined): TerritoryAdminLevel[] | undefined {
  if (!input) {
    return undefined;
  }

  return input
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
    .map((value) => {
      if (TERRITORY_ADMIN_LEVELS.includes(value as TerritoryAdminLevel)) {
        return value as TerritoryAdminLevel;
      }

      throw new Error(
        `Invalid --levels entry '${value}'. Expected ${TERRITORY_ADMIN_LEVELS.join(", ")}.`
      );
    });
}

async function writeJsonOutput(path: string, payload: unknown, force: boolean): Promise<void> {
  if (!force) {
    try {
      await readFile(path);
      throw new Error(`Output path '${path}' already exists. Pass --force to overwrite.`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) {
        throw error;
      }
    }
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function readOptionalNonNegativeNumberFlag(
  flags: Map<string, string | true>,
  key: string,
  issues: CliIssue[]
): number | undefined {
  const value = getFlag(flags, key);

  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    issues.push(createCliIssue(`--${key} must be a non-negative number.`));
    return undefined;
  }

  return parsed;
}

function readOptionalPositiveIntegerFlag(
  flags: Map<string, string | true>,
  key: string,
  issues: CliIssue[]
): number | undefined {
  const value = getFlag(flags, key);

  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    issues.push(createCliIssue(`--${key} must be a positive integer.`));
    return undefined;
  }

  return parsed;
}

function readOptionalBooleanFlag(
  flags: Map<string, string | true>,
  key: string,
  issues: CliIssue[]
): boolean | undefined {
  const value = flags.get(key);

  if (value === undefined) {
    return undefined;
  }

  if (value === true) {
    return true;
  }

  if (["true", "1", "yes"].includes(value.toLowerCase())) {
    return true;
  }

  if (["false", "0", "no"].includes(value.toLowerCase())) {
    return false;
  }

  issues.push(createCliIssue(`--${key} must be true or false.`));
  return undefined;
}

function getPositiveIntegerFlag(
  flags: Map<string, string | true>,
  key: string,
  fallback: number
): number {
  const value = getNumberFlag(flags, key, fallback);

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--${key} must be a positive integer.`);
  }

  return value;
}

function getNonNegativeIntegerFlag(
  flags: Map<string, string | true>,
  key: string,
  fallback: number
): number {
  const value = getNumberFlag(flags, key, fallback);

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`--${key} must be a non-negative integer.`);
  }

  return value;
}

function getPositiveNumberFlag(
  flags: Map<string, string | true>,
  key: string,
  fallback: number
): number {
  const value = getNumberFlag(flags, key, fallback);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${key} must be a positive number.`);
  }

  return value;
}

function readBounds(flags: Map<string, string | true>): {
  west: number;
  south: number;
  east: number;
  north: number;
} {
  const bounds = {
    west: getNumberFlag(flags, "west", 0),
    south: getNumberFlag(flags, "south", 0),
    east: getNumberFlag(flags, "east", 1),
    north: getNumberFlag(flags, "north", 1)
  };

  if (bounds.west >= bounds.east || bounds.south >= bounds.north) {
    throw new Error("--west/--east and --south/--north must define ordered bounds.");
  }

  return bounds;
}

function parseSeeds(
  input: string | undefined
): Array<{ id: string; lng: number; lat: number; weight?: number }> {
  if (!input) {
    return [
      { id: "seed:0", lng: 0.25, lat: 0.5, weight: 1 },
      { id: "seed:1", lng: 0.75, lat: 0.5, weight: 1 }
    ];
  }

  const parsed = JSON.parse(input) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error("--seeds must be a JSON array.");
  }

  return parsed.map((seed, index) => {
    if (
      typeof seed === "object" &&
      seed !== null &&
      "id" in seed &&
      "lng" in seed &&
      "lat" in seed
    ) {
      const record = seed as Record<string, unknown>;

      return {
        id: String(record.id),
        lng: Number(record.lng),
        lat: Number(record.lat),
        ...(record.weight === undefined ? {} : { weight: Number(record.weight) })
      };
    }

    throw new Error(`Invalid seed at index ${index}.`);
  });
}

function readDetailFlag(input: string): NaturalEarthAdm0Detail[] | undefined {
  if (NATURAL_EARTH_ADM0_DETAILS.includes(input as NaturalEarthAdm0Detail)) {
    return [input as NaturalEarthAdm0Detail];
  }

  return undefined;
}

function readDetailFlags(input: string): NaturalEarthAdm0Detail[] | undefined {
  const details = input
    .split(",")
    .map((detail) => detail.trim())
    .filter(Boolean);

  if (
    details.length > 0 &&
    details.every((detail) => NATURAL_EARTH_ADM0_DETAILS.includes(detail as NaturalEarthAdm0Detail))
  ) {
    return details as NaturalEarthAdm0Detail[];
  }

  return undefined;
}

function printDatasetCoverageSummary(input: unknown): void {
  if (!isRecordValue(input) || !isRecordValue(input.summary)) {
    console.log("Coverage registry is missing a summary.");
    return;
  }

  const totalCountries = input.summary.totalCountries;
  const levels = isRecordValue(input.summary.levels) ? input.summary.levels : {};

  console.log(`Countries: ${typeof totalCountries === "number" ? totalCountries : "unknown"}`);

  for (const [level, rawStatuses] of Object.entries(levels)) {
    if (!isRecordValue(rawStatuses)) {
      continue;
    }

    const built = Number(rawStatuses.built ?? 0);
    const packaged = Number(rawStatuses.packaged ?? 0);
    const sourceAvailable = Number(rawStatuses["source-available"] ?? 0);
    const sourceUnavailable = Number(rawStatuses["source-unavailable"] ?? 0);
    const validationFailed = Number(rawStatuses["validation-failed"] ?? 0);
    const notReviewed = Number(rawStatuses["not-reviewed"] ?? 0);
    const licenseRestricted = Number(rawStatuses["license-restricted"] ?? 0);

    console.log(
      `${level.padEnd(14)} built=${built} packaged=${packaged} source-available=${sourceAvailable} source-unavailable=${sourceUnavailable} validation-failed=${validationFailed} not-reviewed=${notReviewed} license-restricted=${licenseRestricted}`
    );
  }
}

function filterCoverageRegistryLevels(
  input: unknown,
  levels: readonly TerritoryAdminLevel[]
): unknown {
  if (!isRecordValue(input)) {
    return input;
  }

  const selected = new Set(levels);
  const summary = isRecordValue(input.summary)
    ? {
        ...input.summary,
        ...(isRecordValue(input.summary.levels)
          ? { levels: filterRecordByKeys(input.summary.levels, selected) }
          : {}),
        ...(isRecordValue(input.summary.sourceStatus)
          ? { sourceStatus: filterRecordByKeys(input.summary.sourceStatus, selected) }
          : {}),
        ...(isRecordValue(input.summary.validationStatus)
          ? { validationStatus: filterRecordByKeys(input.summary.validationStatus, selected) }
          : {}),
        ...(isRecordValue(input.summary.semanticReviewStatus)
          ? {
              semanticReviewStatus: filterRecordByKeys(input.summary.semanticReviewStatus, selected)
            }
          : {})
      }
    : input.summary;

  return {
    ...input,
    ...(Array.isArray(input.levels)
      ? { levels: input.levels.filter((level) => selected.has(level as TerritoryAdminLevel)) }
      : {}),
    ...(summary ? { summary } : {}),
    ...(Array.isArray(input.countries)
      ? {
          countries: input.countries.map((country) =>
            isRecordValue(country) && isRecordValue(country.levels)
              ? { ...country, levels: filterRecordByKeys(country.levels, selected) }
              : country
          )
        }
      : {})
  };
}

function filterRecordByKeys(
  input: Record<string, unknown>,
  keys: ReadonlySet<TerritoryAdminLevel>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => keys.has(key as TerritoryAdminLevel))
  );
}

function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function createCliIssue(message: string, options: { code?: string } = {}): CliIssue {
  return {
    code: options.code ?? "CLI_USAGE",
    message,
    path: "$",
    severity: "error"
  };
}

function printHelp(): void {
  console.log(`territory <command> <dataset.json>

Commands:
  validate   Validate a TerritoryKit dataset
  registry   Build, validate, inspect, and list dataset registries
  geometry   Validate or safely repair dataset geometry
  index      Build a spatial-index metadata summary
  adjacency  Build, validate, inspect, or legacy-infer territory adjacency
  render     Build, validate, inspect, or compare render artifacts
  benchmark  Run or compare fixture/local-real benchmark results
  country    Build and inspect configured country dataset artifacts
  import     Import a GeoJSON file or source adapter artifact
  source     List and inspect source adapters (alias: sources)
  dataset    Build curated datasets and install registry artifacts
  cache      List, verify, or clear installed dataset cache artifacts
  simplify   Emit a deterministic no-op simplification result for pipeline wiring
  generate   Generate grid or weighted-voronoi MVP datasets as JSON`);
}

function printRegistryHelp(): void {
  console.log(`territory registry <command>

Commands:
  build --input <artifact-dir> --output <registry.json> --base-url <url>
  validate <registry.json>
  inspect --registry <registry.json>
  list --registry <registry.json>

Options:
  --build-date <iso-date>
  --force
  --json`);
}

function printCountryHelp(): void {
  console.log(`territory country <command>

Commands:
  list                         List configured countries
  info <country>               Show country config
  source lock <country>        Resolve and lock source artifacts
  source verify <lock.json>    Re-fetch/re-read locked source artifacts
  build <country>              Build country dataset artifacts from a source lock
  validate <artifact-dir>      Validate country artifact checksums and datasets
  inspect <artifact-dir>       Summarize a built country artifact

Aliases:
  territory country source-lock <country>
  territory country source-verify <lock.json>`);
}

function printCountryInfoHelp(): void {
  console.log(`territory country info <country>

Examples:
  territory country info TR
  territory country info united-states --json`);
}

function printCountrySourceHelp(): void {
  console.log(`territory country source <command>

Commands:
  lock <country>        Resolve source metadata, verify artifacts, and write sources.lock.json
  verify <lock.json>    Verify a source lock against its recorded checksums`);
}

function printCountrySourceLockHelp(): void {
  console.log(`territory country source lock <country> --output <sources.lock.json>

Options:
  --levels ADM0,ADM1,ADM2,ADM3,ADM4,ADM5
  --release-type gbOpen
  --metadata <metadata.json>
  --metadata-url <metadata-url>
  --cache-dir <dir>
  --no-cache
  --refresh
  --build-date <iso-date>
  --force
  --json`);
}

function printCountrySourceVerifyHelp(): void {
  console.log(`territory country source verify <sources.lock.json>

Options:
  --build-date <iso-date>
  --json`);
}

function printCountryBuildHelp(): void {
  console.log(`territory country build <country> --source-lock <sources.lock.json> --output <dir>

Options:
  --levels ADM0,ADM1,ADM2,ADM3,ADM4,ADM5
  --build-adjacency
  --strict
  --allow-non-publish-ready
  --allow-partial
  --build-date <iso-date>
  --batch-size <integer>
  --force
  --json`);
}

function printCountryValidateHelp(): void {
  console.log(`territory country validate <artifact-dir>

Options:
  --strict`);
}

function printCountryInspectHelp(): void {
  console.log("territory country inspect <artifact-dir>");
}

function printGeometryHelp(): void {
  console.log(`territory geometry <command> <dataset-path>

Commands:
  validate  Validate geometry quality for dataset.json or a dataset directory
  repair    Apply safe, audited geometry repairs and write a repaired dataset

Options:
  --checks basic|full
  --strict
  --backend typescript
  --epsilon <number>
  --maximum-area-delta-ratio <number>
  --allow-hole-boundary-touch true|false
  --repair-strategy safe
  --normalize-ring-orientation true|false
  --output <dir>
  --report <report.json>
  --force`);
}

function printAdjacencyHelp(): void {
  console.log(`territory adjacency <command>

Commands:
  build <dataset-path>                 Build polygon adjacency artifact
  validate <dataset-path> <artifact>    Validate adjacency artifact
  inspect <artifact> <zone-id>          Inspect zone neighbors

Legacy:
  territory adjacency <dataset.json>    Infer bbox adjacency helper output`);
}

function printAdjacencyBuildHelp(): void {
  console.log(`territory adjacency build <dataset-path> --output <adjacency.json|dir>

Options:
  --all-parents
  --cross-level
  --include-point-touches
  --minimum-shared-boundary-meters <number>
  --epsilon <number>
  --batch-size <integer>
  --overrides <overrides.json>
  --strict
  --report <report.json>
  --build-date <iso-date>
  --force
  --json`);
}

function printAdjacencyValidateHelp(): void {
  console.log("territory adjacency validate <dataset-path> <adjacency.json|dir>");
}

function printAdjacencyInspectHelp(): void {
  console.log(`territory adjacency inspect <adjacency.json|dir> <zone-id>

Options:
  --type shared-border|point-touch|maritime|logical
  --json`);
}

function printRenderHelp(): void {
  console.log(`territory render <command>

Commands:
  build <dataset.json> --output <dir>       Build render artifacts
  validate <artifact-dir>                   Validate render artifact structure
  inspect <artifact-dir>                    Print render manifest
  compare <dataset.json> <artifact-dir>     Compare query identity with render metadata

Options:
  --format mvt|geojson
  --layer <source-layer>
  --min-zoom <number>
  --max-zoom <number>
  --build-date <iso-date>
  --force
  --json`);
}

function printBenchmarkHelp(): void {
  console.log(`territory benchmark <command>

Commands:
  run                         Run a fixture or local-real benchmark smoke
  compare --baseline <json> --current <json>

Options:
  --mode fixture|local-real
  --dataset <dataset.json>
  --allow-skip
  --rows <number>
  --columns <number>
  --cell-size <number>
  --iterations <number>
  --build-date <iso-date>
  --json`);
}

function printSourceHelp(): void {
  console.log(`territory source <command>

Commands:
  list                        List registered source adapters
  info <source-id>            Show source adapter details
  inspect --provider <id>     Inspect a provider for a country/level request

Options:
  --country <ISO2>
  --level <ADM0|ADM1|ADM2|ADM3|ADM4|ADM5>
  --json               Emit machine-readable JSON`);
}

function printSourceInfoHelp(): void {
  console.log(`territory source info <source-id>

Examples:
  territory source info natural-earth
  territory source info geoboundaries --json
  territory sources inspect --provider geoboundaries --country TR --level ADM3 --json`);
}

function printImportHelp(): void {
  console.log(`territory import <source-id> --input <source.geojson> --output <dir>

Source adapters:
  natural-earth
  geoboundaries
  geojson

Legacy:
  territory import <regions.geojson> --dataset-id imported-territories`);
}

function printDatasetHelp(): void {
  console.log(`territory dataset <command>

Commands:
  build            Build a curated TerritoryKit dataset artifact
  build-all        Attempt configured country builds and write a machine-readable report
  coverage         Print or generate global coverage lifecycle summary
  search           Search registry datasets
  info             Show registry dataset metadata
  resolve          Resolve a country/level artifact, optionally with deepest-available fallback
  install          Install dataset artifacts into the local cache
  update           Refresh or switch installed dataset artifacts
  verify           Verify an installed dataset
  remove           Remove an installed dataset
  list-installed   List installed datasets`);
}

function printDatasetBuildHelp(): void {
  console.log(`territory dataset build world-countries --source <natural-earth.geojson> --output <dir>
territory dataset build global-admin --output datasets/generated/global/ADM0

Options:
  --detail low|medium|high
  --country-artifact-root <dir[,dir]>   Optional country-detail artifact roots for coverage.
  --levels <ADM0[,ADM1...ADM5]>         Filter coverage output by administrative level.
  --build-report <report.json>
  --source-version <version>
  --source-url <url>
  --source-sha256 <sha256>
  --build-date <iso-date>
  --strict
  --force`);
}

function printDatasetBuildAllHelp(): void {
  console.log(`territory dataset build-all --levels ADM0 --output datasets/generated/global-adm0-countries --report reports/global-adm0-build-all.json

Options:
  --levels <ADM0[,ADM1...ADM5]>
  --countries <ISO2[,ISO2...]>
  --exclude <ISO2[,ISO2...]>
  --output <dir>
  --report <report.json>
  --max-source-bytes <bytes>            Defer oversized country-detail builds as performance-deferred.
  --country-timeout-ms <ms>
  --phase-timeout-ms <ms>
  --skip-adjacency                      Build country datasets without adjacency artifacts.
  --continue-on-error
  --allow-partial
  --concurrency <number>
  --cache-dir <dir>
  --offline
  --provider <id>
  --resume
  --retry-failed
  --force`);
}

function printCacheHelp(): void {
  console.log(`territory cache <command>

Commands:
  list       List installed dataset cache entries
  verify     Verify installed cache metadata
  clear      Clear the dataset artifact cache

Options:
  --cache-dir <dir>
  --force`);
}

const currentEntry = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;

if (currentEntry === import.meta.url) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
