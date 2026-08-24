import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { loadTerritoryDataset } from "@territory-kit/dataset";
import type { LngLat, TerritoryGeometry } from "@territory-kit/dataset";
import { createSpatialMigrationPlan } from "@territory-kit/migration";
import type { SourceSpatialRecord, SpatialMigrationStrategy } from "@territory-kit/migration";

export async function runMigrateSpatial(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const positional = getPositionalArgs(args);
  const sourcePath = getFlag(flags, "source") ?? positional[0];
  const targetDatasetPath =
    getFlag(flags, "target-dataset") ?? getFlag(flags, "dataset") ?? positional[1];
  const outputPath = getFlag(flags, "output") ?? getFlag(flags, "out");
  const strategy = getSpatialMigrationStrategy(getFlag(flags, "strategy") ?? "max-overlap");
  const targetLevel =
    getOptionalNumberFlag(flags, "target-level") ?? getOptionalNumberFlag(flags, "level");

  if (!sourcePath || !targetDatasetPath || !strategy) {
    printJson({
      ok: false,
      command: "migrate-spatial",
      issues: [
        createCliIssue(
          "Usage: territory migrate-spatial --source source-zones.json --target-dataset dataset.json --strategy centroid|max-overlap"
        )
      ]
    });
    return 1;
  }

  const sourceVersion = getFlag(flags, "source-version");
  const toolVersion = getFlag(flags, "tool-version");
  const minOverlapRatio = getOptionalNumberFlag(flags, "min-overlap-ratio");
  const ambiguityDeltaRatio = getOptionalNumberFlag(flags, "ambiguity-delta-ratio");
  const plan = createSpatialMigrationPlan(parseSourceSpatialRecords(await readJson(sourcePath)), {
    sourceSystem: getFlag(flags, "source-system") ?? "legacy-spatial",
    ...(sourceVersion ? { sourceVersion } : {}),
    targetDataset: loadTerritoryDataset(await readJson(targetDatasetPath)),
    ...(targetLevel === undefined ? {} : { targetLevel }),
    strategy,
    generatedAt: getCliBuildDate(flags),
    ...(toolVersion ? { toolVersion } : {}),
    ...(minOverlapRatio === undefined ? {} : { minOverlapRatio }),
    ...(ambiguityDeltaRatio === undefined ? {} : { ambiguityDeltaRatio })
  });

  if (outputPath) {
    await writeJsonOutput(outputPath, plan, flags.has("force"));
  }

  printJson({
    ok: true,
    command: "migrate-spatial",
    data: {
      ...(outputPath ? { outputPath } : {}),
      manifest: plan.manifest,
      conflicts: plan.conflicts,
      mappings: outputPath ? undefined : plan.mappings
    }
  });
  return 0;
}

function getSpatialMigrationStrategy(
  input: string | undefined
): SpatialMigrationStrategy | undefined {
  return input === "centroid" || input === "max-overlap" ? input : undefined;
}

function parseSourceSpatialRecords(input: unknown): SourceSpatialRecord[] {
  const rows = Array.isArray(input)
    ? input
    : isRecordValue(input) && Array.isArray(input.sources)
      ? input.sources
      : isRecordValue(input) && Array.isArray(input.records)
        ? input.records
        : isRecordValue(input) && Array.isArray(input.zones)
          ? input.zones
          : undefined;

  if (!rows) {
    throw new Error(
      "Spatial migration source must be an array or object with sources/records/zones."
    );
  }

  return rows.map((row, index) => parseSourceSpatialRecord(row, index));
}

function parseSourceSpatialRecord(input: unknown, index: number): SourceSpatialRecord {
  if (!isRecordValue(input)) {
    throw new Error(`Spatial migration source record ${index} must be an object.`);
  }

  const sourceSpatialId = readStringField(
    input,
    "sourceSpatialId",
    "sourceZoneId",
    "oldZoneId",
    "h3Index",
    "id"
  );

  if (!sourceSpatialId) {
    throw new Error(`Spatial migration source record ${index} is missing sourceSpatialId/id.`);
  }

  const center = readLngLatField(input, "center", "sourceCenter") ?? readLngLatParts(input);
  const geometry = readGeometryField(input, "geometry", "polygon", "oldPolygon");
  const score = readNumberField(input, "score", "totalScore");
  const ownerId = readStringField(input, "ownerId", "ownerUserId", "userId");

  return {
    sourceSpatialId,
    ...(geometry ? { geometry } : {}),
    ...(center ? { center } : {}),
    ...(score === undefined ? {} : { score }),
    ...(ownerId ? { ownerId } : {}),
    properties: input
  };
}

function readStringField(
  input: Record<string, unknown>,
  ...fields: readonly string[]
): string | undefined {
  for (const field of fields) {
    const value = input[field];

    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

function readNumberField(
  input: Record<string, unknown>,
  ...fields: readonly string[]
): number | undefined {
  for (const field of fields) {
    const value = input[field];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}

function readLngLatField(
  input: Record<string, unknown>,
  ...fields: readonly string[]
): LngLat | undefined {
  for (const field of fields) {
    const value = input[field];

    if (
      Array.isArray(value) &&
      typeof value[0] === "number" &&
      typeof value[1] === "number" &&
      Number.isFinite(value[0]) &&
      Number.isFinite(value[1])
    ) {
      return [value[0], value[1]];
    }
  }

  return undefined;
}

function readLngLatParts(input: Record<string, unknown>): LngLat | undefined {
  const lng = readNumberField(input, "lng", "longitude", "centerLng");
  const lat = readNumberField(input, "lat", "latitude", "centerLat");

  return lng === undefined || lat === undefined ? undefined : [lng, lat];
}

function readGeometryField(
  input: Record<string, unknown>,
  ...fields: readonly string[]
): TerritoryGeometry | undefined {
  for (const field of fields) {
    const value = input[field];

    if (
      isRecordValue(value) &&
      (value.type === "Polygon" || value.type === "MultiPolygon") &&
      Array.isArray(value.coordinates)
    ) {
      return value as unknown as TerritoryGeometry;
    }
  }

  return undefined;
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

function getOptionalNumberFlag(flags: Map<string, string | true>, key: string): number | undefined {
  const value = getFlag(flags, key);

  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getCliBuildDate(flags: Map<string, string | true>): string {
  const buildDate = getFlag(flags, "build-date");

  if (buildDate) {
    return buildDate;
  }

  if (process.env.SOURCE_DATE_EPOCH) {
    return new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString();
  }

  return new Date().toISOString();
}

async function readJson(filePath: string): Promise<unknown> {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as unknown;
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

function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function createCliIssue(message: string): {
  code: string;
  message: string;
  path: string;
  severity: string;
} {
  return {
    code: "CLI_USAGE",
    message,
    path: "$",
    severity: "error"
  };
}

function isRecordValue(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
