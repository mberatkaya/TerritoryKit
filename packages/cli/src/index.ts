#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createTerritoryEngine } from "@territory-kit/core";
import {
  TERRITORY_SCHEMA_VERSION,
  createTerritoryDatasetFromGeoJson,
  loadTerritoryDataset,
  validateTerritoryDataset
} from "@territory-kit/dataset";
import type {
  TerritoryDataset,
  TerritoryDatasetManifest,
  TerritoryGeoJsonImportOptions,
  TerritoryValidationIssue
} from "@territory-kit/dataset";
import {
  NATURAL_EARTH_ADM0_DETAILS,
  WORLD_COUNTRIES_DATASET_ID,
  buildWorldCountriesDatasetFromSourcePipeline,
  createDatasetGeometryHash,
  createSyntheticGridDataset,
  createWeightedVoronoiDataset,
  getTerritorySourceAdapter,
  hasTerritorySourceAdapter,
  inferBBoxAdjacency,
  inferBBoxAdjacencyConnections,
  listTerritorySourceAdapters,
  runTerritorySourcePipeline
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

    if (command === "adjacency") {
      printJson({
        ok: true,
        command,
        data: {
          adjacency: inferBBoxAdjacency(dataset.zones),
          connections: inferBBoxAdjacencyConnections(dataset.zones)
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

  printJson({
    ok: result.ok,
    command: `import ${sourceId}`,
    ...(result.ok
      ? {
          data: {
            provider: result.provider,
            outputPath: result.output?.outputPath,
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
  index      Build a spatial-index metadata summary
  adjacency  Infer bbox adjacency and typed geometric connections
  import     Import a GeoJSON file or source adapter artifact
  source     List and inspect source adapters
  dataset    Build curated dataset artifacts, including world-countries
  simplify   Emit a deterministic no-op simplification result for pipeline wiring
  generate   Generate grid or weighted-voronoi MVP datasets as JSON`);
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
