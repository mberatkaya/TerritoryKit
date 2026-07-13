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
  TerritoryDatasetManifest,
  TerritoryGeoJsonImportOptions
} from "@territory-kit/dataset";
import {
  createDatasetGeometryHash,
  createSyntheticGridDataset,
  createWeightedVoronoiDataset,
  inferBBoxAdjacency,
  inferBBoxAdjacencyConnections
} from "@territory-kit/generators";

interface CliIssue {
  code: string;
  message: string;
  path?: string;
  severity: "error" | "warning";
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [command] = argv;

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }

  try {
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

async function readJson(filePath: string): Promise<unknown> {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as unknown;
}

async function runImport(filePath: string, flags: Map<string, string | true>): Promise<number> {
  const input = await readJson(filePath);
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

  printJson({
    ok: result.ok,
    command: "import",
    ...(result.ok ? { data: result.dataset } : { issues: result.issues })
  });
  return result.ok ? 0 : 1;
}

function runGenerate(args: string[]): number {
  const flags = parseFlags(args);
  const kind = getFlag(flags, "kind") ?? "grid";
  const datasetId = getFlag(flags, "dataset-id") ?? "generated-territories";

  if (kind === "grid") {
    const gridOptions = {
      datasetId,
      rows: getNumberFlag(flags, "rows", 10),
      columns: getNumberFlag(flags, "columns", 10),
      cellSize: getNumberFlag(flags, "cell-size", 0.01),
      level: getNumberFlag(flags, "level", 0)
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
      bounds: {
        west: getNumberFlag(flags, "west", 0),
        south: getNumberFlag(flags, "south", 0),
        east: getNumberFlag(flags, "east", 1),
        north: getNumberFlag(flags, "north", 1)
      },
      level: getNumberFlag(flags, "level", 0),
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
  simplify   Emit a deterministic no-op simplification result for pipeline wiring
  generate   Generate grid or weighted-voronoi MVP datasets as JSON`);
}

const currentEntry = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;

if (currentEntry === import.meta.url) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
