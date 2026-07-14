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
  buildWorldCountriesDataset,
  createDatasetGeometryHash,
  createSyntheticGridDataset,
  createWeightedVoronoiDataset,
  inferBBoxAdjacency,
  inferBBoxAdjacencyConnections
} from "@territory-kit/generators";
import type { NaturalEarthAdm0Detail } from "@territory-kit/generators";

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

    if (command === "import") {
      return runImport(filePath, parseFlags(argv.slice(2)));
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
  const result = await buildWorldCountriesDataset({
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

function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function createCliIssue(message: string): CliIssue {
  return {
    code: "CLI_USAGE",
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
  import     Import a GeoJSON FeatureCollection into a TerritoryKit dataset
  dataset    Build curated dataset artifacts, including world-countries
  simplify   Emit a deterministic no-op simplification result for pipeline wiring
  generate   Generate grid or weighted-voronoi MVP datasets as JSON`);
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
