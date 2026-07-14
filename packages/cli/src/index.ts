#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createTerritoryEngine } from "@territory-kit/core";
import {
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
  buildTerritoryAdjacencyPath,
  buildTerritoryCountryDatasetPath,
  buildWorldCountriesDatasetFromSourcePipeline,
  createTerritoryCountrySourceLock,
  createDatasetGeometryHash,
  createSyntheticGridDataset,
  createWeightedVoronoiDataset,
  getTerritorySourceAdapter,
  getTerritoryCountryConfig,
  hasTerritorySourceAdapter,
  inspectTerritoryCountryDatasetPath,
  listTerritoryCountryConfigs,
  inferBBoxAdjacency,
  inferBBoxAdjacencyConnections,
  listTerritorySourceAdapters,
  readTerritoryCountrySourceLockPath,
  readTerritoryAdjacencyArtifactPath,
  repairTerritoryDatasetPath,
  runTerritorySourcePipeline,
  validateTerritoryCountryDatasetPath,
  verifyTerritoryCountrySourceLock,
  validateTerritoryAdjacencyPath,
  validateTerritoryDatasetPath,
  writeGeometryQualityReport
} from "@territory-kit/generators";
import type {
  GenericGeoJsonSourceOptions,
  GeoBoundariesSourceOptions,
  NaturalEarthAdm0Detail,
  NaturalEarthSourceOptions,
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

    if (command === "source") {
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
      ...(flags.has("allow-non-publish-ready") ? { allowNonPublishReady: true } : {}),
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

  if (subcommand === "info") {
    if (!sourceId || sourceId === "--help" || sourceId === "-h") {
      printSourceInfoHelp();
      return sourceId ? 0 : 1;
    }

    try {
      const description = getTerritorySourceAdapter(sourceId).describe();

      if (json) {
        printJson({
          ok: true,
          command: "source info",
          data: description
        });
      } else {
        console.log(formatSourceDescription(description));
      }

      return 0;
    } catch (error) {
      printJson({
        ok: false,
        command: "source info",
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
  const validLevels = new Set(["ADM0", "ADM1", "ADM2", "ADM3", "ADM4"]);
  const invalid = levels.find((level) => !validLevels.has(level));

  if (!invalid && levels.length > 0) {
    return [...new Set(levels)] as TerritoryAdminLevel[];
  }

  return [
    createCliIssue(
      invalid
        ? `Invalid --levels entry '${invalid}'. Expected ADM0, ADM1, ADM2, ADM3, or ADM4.`
        : "--levels must include at least one admin level."
    )
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

  if (levels.length === 5) {
    return "ADM0-ADM4";
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

function getFlag(flags: Map<string, string | true>, key: string): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function getNumberFlag(flags: Map<string, string | true>, key: string, fallback: number): number {
  const value = getFlag(flags, key);
  const parsed = value === undefined ? Number.NaN : Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
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
  geometry   Validate or safely repair dataset geometry
  index      Build a spatial-index metadata summary
  adjacency  Build, validate, inspect, or legacy-infer territory adjacency
  country    Build and inspect pilot country dataset artifacts
  import     Import a GeoJSON file or source adapter artifact
  source     List and inspect source adapters
  dataset    Build curated dataset artifacts, including world-countries
  simplify   Emit a deterministic no-op simplification result for pipeline wiring
  generate   Generate grid or weighted-voronoi MVP datasets as JSON`);
}

function printCountryHelp(): void {
  console.log(`territory country <command>

Commands:
  list                         List configured pilot countries
  info <country>               Show pilot country config
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
  --levels ADM0,ADM1,ADM2
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
  --levels ADM0,ADM1,ADM2
  --build-adjacency
  --strict
  --allow-non-publish-ready
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

function printSourceHelp(): void {
  console.log(`territory source <command>

Commands:
  list                 List registered source adapters
  info <source-id>     Show source adapter details

Options:
  --json               Emit machine-readable JSON`);
}

function printSourceInfoHelp(): void {
  console.log(`territory source info <source-id>

Examples:
  territory source info natural-earth
  territory source info geoboundaries --json`);
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
  build  Build a curated TerritoryKit dataset artifact`);
}

function printDatasetBuildHelp(): void {
  console.log(`territory dataset build world-countries --source <natural-earth.geojson> --output <dir>

Options:
  --detail low|medium|high
  --source-version <version>
  --source-url <url>
  --source-sha256 <sha256>
  --build-date <iso-date>
  --strict
  --force`);
}

const currentEntry = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;

if (currentEntry === import.meta.url) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
