import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TerritoryZone } from "@territory-kit/dataset";
import {
  TURKEY_OSM_BARRIER_DEFAULT_OUTPUT_ROOT,
  acquireTurkeyOsmSnapshot,
  buildTurkeyOsmBarrierArtifacts,
  createTurkeyGeofabrikSnapshotDescriptor,
  createTurkeyOsmBarrierBuildPlan,
  createTurkeyOsmSmartCoverageReport,
  parseTurkeyOsmSnapshotSourceLock,
  readAdm2ZonesFromDataset,
  readTurkeyOsmAdm2BarrierArtifact,
  verifyTurkeyOsmSnapshot
} from "@territory-kit/generators/turkey-adm3";
import type {
  OsmSnapshotDescriptor,
  TurkeyOsmAdm2BarrierArtifact,
  TurkeyOsmBarrierBuildMode,
  TurkeyOsmSnapshotSourceLock
} from "@territory-kit/generators/turkey-adm3";

interface CliIssue {
  code: string;
  message: string;
  path?: string;
  severity: "error" | "warning";
}

export async function runTurkeyOsm(args: string[]): Promise<number> {
  const [subcommand] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printJson({
      ok: true,
      command: "tr osm",
      data: {
        commands: ["acquire", "verify", "barriers", "smart"],
        usage: [
          "territory tr osm acquire [--dry-run]",
          "territory tr osm verify --source-lock <source-lock.json> [--snapshot <turkey.osm.pbf>]",
          "territory tr osm barriers build --adm2 <adm0-adm2-dataset.json> --source-lock <source-lock.json> [--snapshot <turkey.osm.pbf>] [--offline] [--dry-run]",
          "territory tr osm barriers inspect --barriers <dir> --adm2 <adm2-id>",
          "territory tr osm smart coverage --adm2 <adm0-adm2-dataset.json> --barriers <dir>"
        ]
      }
    });
    return 0;
  }

  if (subcommand === "acquire") {
    return runTurkeyOsmAcquire(args.slice(1));
  }

  if (subcommand === "verify") {
    return runTurkeyOsmVerify(args.slice(1));
  }

  if (subcommand === "barriers") {
    return runTurkeyOsmBarriers(args.slice(1));
  }

  if (subcommand === "smart") {
    return runTurkeyOsmSmart(args.slice(1));
  }

  printJson({
    ok: false,
    command: "tr osm",
    issues: [createCliIssue(`Unsupported Turkey OSM command '${subcommand}'.`)]
  });
  return 2;
}

async function runTurkeyOsmAcquire(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const dryRun = flags.has("dry-run");
  const cacheRoot = getFlag(flags, "cache") ?? getFlag(flags, "cache-root");
  const result = await acquireTurkeyOsmSnapshot({
    dryRun,
    ...(cacheRoot ? { cacheRoot } : {})
  });

  printJson({ ok: true, command: "tr osm acquire", data: result });
  return 0;
}

async function runTurkeyOsmVerify(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const sourceLockPath = getFlag(flags, "source-lock") ?? getFlag(flags, "lock");
  const snapshotPath = getFlag(flags, "snapshot") ?? getFlag(flags, "pbf");

  if (!sourceLockPath) {
    printJson({
      ok: false,
      command: "tr osm verify",
      issues: [createCliIssue("--source-lock is required.")]
    });
    return 2;
  }

  const result = await verifyTurkeyOsmSnapshot({
    sourceLockPath,
    ...(snapshotPath ? { snapshotPath } : {})
  });

  printJson({
    ok: result.ok,
    command: "tr osm verify",
    ...(result.ok ? { data: result } : { issues: result.issues, data: result })
  });
  return result.ok ? 0 : 1;
}

async function runTurkeyOsmBarriers(args: string[]): Promise<number> {
  const [subcommand] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printJson({
      ok: true,
      command: "tr osm barriers",
      data: {
        commands: ["build", "inspect"],
        usage:
          "territory tr osm barriers build --adm2 <dataset.json> --source-lock <source-lock.json>"
      }
    });
    return 0;
  }

  if (subcommand === "build") {
    return runTurkeyOsmBarriersBuild(args.slice(1));
  }

  if (subcommand === "inspect") {
    return runTurkeyOsmBarriersInspect(args.slice(1));
  }

  printJson({
    ok: false,
    command: "tr osm barriers",
    issues: [createCliIssue(`Unsupported Turkey OSM barriers command '${subcommand}'.`)]
  });
  return 2;
}

async function runTurkeyOsmBarriersBuild(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const adm2Path = getFlag(flags, "adm2") ?? getFlag(flags, "adm2-dataset");
  const sourceLockPath = getFlag(flags, "source-lock") ?? getFlag(flags, "lock");
  const snapshotFlag = getFlag(flags, "snapshot") ?? getFlag(flags, "pbf");
  const outputRoot = getFlag(flags, "output") ?? TURKEY_OSM_BARRIER_DEFAULT_OUTPUT_ROOT;
  const dryRun = flags.has("dry-run");
  const force = flags.has("force");
  const adm2Ids = readCommaSeparatedFlag(flags, "adm2-id");
  const maxDistricts = readOptionalPositiveIntegerFlag(flags, "max-districts");
  const concurrency = readOptionalPositiveIntegerFlag(flags, "concurrency");
  const maxPrimitiveBlocks = readOptionalPositiveIntegerFlag(flags, "max-primitive-blocks");
  const mode: TurkeyOsmBarrierBuildMode = flags.has("best-effort") ? "best-effort" : "strict";

  if (!adm2Path || !sourceLockPath) {
    printJson({
      ok: false,
      command: "tr osm barriers build",
      issues: [
        ...(!adm2Path ? [createCliIssue("--adm2 is required.")] : []),
        ...(!sourceLockPath ? [createCliIssue("--source-lock is required.")] : [])
      ]
    });
    return 2;
  }

  const sourceLock = await readSourceLock(sourceLockPath);
  const adm2Zones = readAdm2ZonesFromDataset(await readJson(adm2Path));
  const selectedAdm2Zones = selectAdm2ForCli(adm2Zones, adm2Ids, maxDistricts);
  const snapshotPath = snapshotFlag ?? sourceLock.cachePath;

  if (dryRun) {
    const plan = createTurkeyOsmBarrierBuildPlan({
      descriptor: sourceLockToDescriptor(sourceLock),
      outputRoot,
      adm2Zones: selectedAdm2Zones
    });
    printJson({ ok: true, command: "tr osm barriers build", data: plan });
    return 0;
  }

  const verify = await verifyTurkeyOsmSnapshot({
    sourceLockPath,
    snapshotPath
  });

  if (!verify.ok) {
    printJson({ ok: false, command: "tr osm barriers build", issues: verify.issues, data: verify });
    return 1;
  }

  const result = await buildTurkeyOsmBarrierArtifacts({
    snapshotPath,
    sourceLock,
    adm2Zones,
    outputRoot,
    force,
    mode,
    ...(adm2Ids.length > 0 ? { adm2Ids } : {}),
    ...(maxDistricts !== undefined ? { maxDistricts } : {}),
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(maxPrimitiveBlocks !== undefined ? { maxPrimitiveBlocks } : {})
  });

  printJson({
    ok: result.ok,
    command: "tr osm barriers build",
    ...(result.ok ? { data: result } : { issues: result.issues, data: result })
  });
  return result.ok ? 0 : 1;
}

async function runTurkeyOsmBarriersInspect(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const root = getFlag(flags, "barriers") ?? getFlag(flags, "input");
  const adm2Id = getFlag(flags, "adm2") ?? getFlag(flags, "adm2-id");

  if (!root || !adm2Id) {
    printJson({
      ok: false,
      command: "tr osm barriers inspect",
      issues: [
        ...(!root ? [createCliIssue("--barriers is required.")] : []),
        ...(!adm2Id ? [createCliIssue("--adm2 is required.")] : [])
      ]
    });
    return 2;
  }

  const artifact = await readTurkeyOsmAdm2BarrierArtifact(root, adm2Id);
  printJson({
    ok: true,
    command: "tr osm barriers inspect",
    data: {
      manifest: artifact.manifest,
      quality: artifact.quality
    }
  });
  return 0;
}

async function runTurkeyOsmSmart(args: string[]): Promise<number> {
  const [subcommand] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printJson({
      ok: true,
      command: "tr osm smart",
      data: {
        commands: ["coverage"],
        usage: "territory tr osm smart coverage --adm2 <dataset.json> --barriers <dir>"
      }
    });
    return 0;
  }

  if (subcommand === "coverage") {
    return runTurkeyOsmSmartCoverage(args.slice(1));
  }

  printJson({
    ok: false,
    command: "tr osm smart",
    issues: [createCliIssue(`Unsupported Turkey OSM smart command '${subcommand}'.`)]
  });
  return 2;
}

async function runTurkeyOsmSmartCoverage(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const adm2Path = getFlag(flags, "adm2") ?? getFlag(flags, "adm2-dataset");
  const barriersRoot = getFlag(flags, "barriers") ?? getFlag(flags, "barrier-root");
  const officialPath = getFlag(flags, "official") ?? getFlag(flags, "official-artifact");
  const osmPath = getFlag(flags, "osm") ?? getFlag(flags, "osm-administrative");
  const outputPath = getFlag(flags, "output");

  if (!adm2Path || !barriersRoot) {
    printJson({
      ok: false,
      command: "tr osm smart coverage",
      issues: [
        ...(!adm2Path ? [createCliIssue("--adm2 is required.")] : []),
        ...(!barriersRoot ? [createCliIssue("--barriers is required.")] : [])
      ]
    });
    return 2;
  }

  const adm2Zones = readAdm2ZonesFromDataset(await readJson(adm2Path));
  const barrierArtifacts = await readBarrierArtifactsForAdm2(barriersRoot, adm2Zones);
  const report = createTurkeyOsmSmartCoverageReport({
    adm2Zones,
    barrierArtifacts,
    ...(officialPath ? { officialZones: await readZones(officialPath) } : {}),
    ...(osmPath ? { osmAdministrativeZones: await readZones(osmPath) } : {})
  });

  if (outputPath) {
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  printJson({ ok: report.consistency.ok, command: "tr osm smart coverage", data: report });
  return report.consistency.ok ? 0 : 1;
}

async function readBarrierArtifactsForAdm2(
  root: string,
  adm2Zones: readonly TerritoryZone[]
): Promise<TurkeyOsmAdm2BarrierArtifact[]> {
  const artifacts: TurkeyOsmAdm2BarrierArtifact[] = [];

  for (const adm2 of adm2Zones) {
    try {
      artifacts.push(await readTurkeyOsmAdm2BarrierArtifact(root, adm2.id));
    } catch {
      continue;
    }
  }

  if (artifacts.length === 0) {
    try {
      const directories = await readdir(join(root, "ADM2"), { withFileTypes: true });

      for (const directory of directories.filter((entry) => entry.isDirectory())) {
        try {
          artifacts.push(
            await readTurkeyOsmAdm2BarrierArtifact(join(root, "ADM2", directory.name))
          );
        } catch {
          continue;
        }
      }
    } catch {
      return artifacts;
    }
  }

  return artifacts;
}

async function readZones(path: string): Promise<TerritoryZone[]> {
  const input = await readJson(path);

  if (Array.isArray(input)) {
    return input.filter(isTerritoryZone);
  }

  if (isRecord(input) && Array.isArray(input.zones)) {
    return input.zones.filter(isTerritoryZone);
  }

  return [];
}

async function readSourceLock(path: string): Promise<TurkeyOsmSnapshotSourceLock> {
  return parseTurkeyOsmSnapshotSourceLock(await readJson(path));
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function sourceLockToDescriptor(sourceLock: TurkeyOsmSnapshotSourceLock): OsmSnapshotDescriptor {
  const fallback = createTurkeyGeofabrikSnapshotDescriptor();

  return {
    providerId: sourceLock.providerId,
    providerName: sourceLock.providerName,
    countryCode: sourceLock.countryCode,
    sourceUrl: sourceLock.sourceUrl,
    downloadUrl: sourceLock.downloadUrl,
    sourceDatasetId: sourceLock.sourceDatasetId,
    format: sourceLock.format,
    license: sourceLock.license,
    attribution: sourceLock.attribution,
    expectedFileName: fallback.expectedFileName
  };
}

function selectAdm2ForCli(
  zones: readonly TerritoryZone[],
  adm2Ids: readonly string[],
  maxDistricts: number | undefined
): TerritoryZone[] {
  const ids = new Set(adm2Ids);
  const selected = zones
    .filter((zone) => ids.size === 0 || ids.has(zone.id))
    .sort((left, right) => left.id.localeCompare(right.id));

  return maxDistricts !== undefined ? selected.slice(0, maxDistricts) : selected;
}

function parseFlags(args: string[]): Map<string, string> {
  const flags = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg?.startsWith("--")) {
      continue;
    }

    const withoutPrefix = arg.slice(2);
    const [rawKey, inlineValue] = withoutPrefix.split("=", 2);
    const key = rawKey ?? "";

    if (!key) {
      continue;
    }

    if (inlineValue !== undefined) {
      flags.set(key, inlineValue);
      continue;
    }

    const next = args[index + 1];

    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      index += 1;
    } else {
      flags.set(key, "true");
    }
  }

  return flags;
}

function getFlag(flags: ReadonlyMap<string, string>, name: string): string | undefined {
  const value = flags.get(name);
  return value && value !== "true" ? value : undefined;
}

function readCommaSeparatedFlag(flags: ReadonlyMap<string, string>, name: string): string[] {
  const value = getFlag(flags, name);

  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function readOptionalPositiveIntegerFlag(
  flags: ReadonlyMap<string, string>,
  name: string
): number | undefined {
  const raw = getFlag(flags, name);

  if (!raw) {
    return undefined;
  }

  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function createCliIssue(message: string, code = "CLI_USAGE"): CliIssue {
  return {
    code,
    severity: "error",
    message
  };
}

function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function isTerritoryZone(input: unknown): input is TerritoryZone {
  return isRecord(input) && typeof input.id === "string" && typeof input.level === "number";
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
