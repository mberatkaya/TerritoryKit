import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import type { TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";
import {
  buildTurkeyV2HybridBatch,
  buildTurkeyV2HybridDistrict,
  createTurkeyOsmSmartFallbackGeneratedOptions,
  readTurkeyOsmAdm2BarrierArtifact
} from "@territory-kit/generators/turkey-adm3";
import type {
  TurkeyGameZoneFragmentStrategy,
  TurkeyGameZoneProfile,
  TurkeyV2HybridGeneratedOptions
} from "@territory-kit/generators/turkey-adm3";

interface CliIssue {
  code: string;
  message: string;
  path?: string;
  severity: "error" | "warning";
}

export async function runTurkeyAdm3Hybrid(args: string[]): Promise<number> {
  const [subcommand] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printJson({
      ok: true,
      command: "tr adm3 hybrid",
      data: {
        commands: ["build"],
        usage:
          "territory tr adm3 hybrid build --district <adm2.json> --official <adm3.json> --osm <adm3.json> [--osm-barriers <dir>] --output <dir>"
      }
    });
    return 0;
  }

  if (subcommand === "build") {
    return runTurkeyAdm3HybridBuild(args.slice(1));
  }

  printJson({
    ok: false,
    command: "tr adm3 hybrid",
    issues: [createCliIssue(`Unsupported Turkey ADM3 hybrid command '${subcommand}'.`)]
  });
  return 2;
}

export async function runTurkeyAdm3HybridBuild(args: string[]): Promise<number> {
  const startedAt = performance.now();
  const flags = parseFlags(args);
  const inputPath =
    getFlag(flags, "district") ?? getFlag(flags, "input") ?? getFlag(flags, "dataset");
  const outputRoot = getFlag(flags, "output");
  const officialPath = getFlag(flags, "official") ?? getFlag(flags, "official-artifact");
  const osmPath = getFlag(flags, "osm") ?? getFlag(flags, "osm-artifact");
  const osmBarrierRoot = getFlag(flags, "osm-barriers") ?? getFlag(flags, "osm-barrier-root");
  const osmBarrierArtifact = getFlag(flags, "osm-barrier-artifact");
  const migrationBaselinePath = getFlag(flags, "migration-baseline");
  const districtId = getFlag(flags, "district-id") ?? getFlag(flags, "zone-id");
  const buildDate = getFlag(flags, "build-date") ?? "1970-01-01T00:00:00.000Z";
  const flagIssues: CliIssue[] = [];
  const targetAreaKm2 = readOptionalPositiveNumberFlag(flags, "target-area", flagIssues);
  const targetZoneCount = readOptionalPositiveIntegerFlag(flags, "target-zone-count", flagIssues);
  const minAreaKm2 = readOptionalPositiveNumberFlag(flags, "min-area", flagIssues);
  const maxAreaKm2 = readOptionalPositiveNumberFlag(flags, "max-area", flagIssues);
  const maxZonesPerDistrict = readOptionalPositiveIntegerFlag(flags, "max-zones", flagIssues);
  const minFragmentAreaKm2 = readOptionalPositiveNumberFlag(flags, "min-fragment-area", flagIssues);
  const minimumEffectiveAreaKm2 = readOptionalPositiveNumberFlag(
    flags,
    "minimum-effective-area",
    flagIssues
  );
  const overlapToleranceKm2 = readOptionalNonNegativeNumberFlag(
    flags,
    "overlap-tolerance",
    flagIssues
  );
  const gapToleranceKm2 = readOptionalNonNegativeNumberFlag(flags, "gap-tolerance", flagIssues);
  const parentOutsideToleranceKm2 = readOptionalNonNegativeNumberFlag(
    flags,
    "parent-outside-tolerance",
    flagIssues
  );
  const profile = (getFlag(flags, "profile") ?? "auto") as TurkeyGameZoneProfile;
  const fragmentStrategy = getFlag(flags, "fragment-strategy") as
    TurkeyGameZoneFragmentStrategy | undefined;
  const seed = getFlag(flags, "seed");
  const generatedFlag = flags.get("generated");
  const generatedEnabled =
    flags.has("no-generated") || generatedFlag === "false" || generatedFlag === "0" ? false : true;
  const force = flags.has("force");
  const batch = flags.has("batch");

  if (!inputPath || !outputRoot) {
    printJson({
      ok: false,
      command: "tr adm3 hybrid build",
      issues: [
        ...(!inputPath ? [createCliIssue("--district, --input, or --dataset is required.")] : []),
        ...(!outputRoot ? [createCliIssue("--output is required.")] : [])
      ]
    });
    return 2;
  }

  if (flagIssues.length > 0) {
    printJson({ ok: false, command: "tr adm3 hybrid build", issues: flagIssues });
    return 2;
  }

  try {
    const generated: TurkeyV2HybridGeneratedOptions = {
      enabled: generatedEnabled,
      profile,
      ...(seed ? { seed } : {}),
      ...(targetAreaKm2 ? { targetAreaKm2 } : {}),
      ...(targetZoneCount ? { targetZoneCount } : {}),
      ...(minAreaKm2 ? { minAreaKm2 } : {}),
      ...(maxAreaKm2 ? { maxAreaKm2 } : {}),
      ...(maxZonesPerDistrict ? { maxZonesPerDistrict } : {}),
      ...(minFragmentAreaKm2 ? { minFragmentAreaKm2 } : {}),
      ...(fragmentStrategy ? { fragmentStrategy } : {})
    };
    const districts = await readTurkeyAdm3Adm2Zones(inputPath);
    const selectedDistricts = selectTurkeyAdm3HybridDistricts(districts, districtId, batch);
    const officialByParent = groupTurkeyAdm3ZonesByParent(
      await readTurkeyAdm3Adm3Zones(officialPath)
    );
    const osmByParent = groupTurkeyAdm3ZonesByParent(await readTurkeyAdm3Adm3Zones(osmPath));
    const migrationBaselineByParent = groupTurkeyAdm3ZonesByParent(
      await readTurkeyAdm3Adm3Zones(migrationBaselinePath)
    );

    if (batch) {
      const sourcesByDistrictEntries = await Promise.all(
        selectedDistricts.map(
          async (district) =>
            [
              district.id,
              {
                officialZones: officialByParent.get(district.id) ?? [],
                osmZones: osmByParent.get(district.id) ?? [],
                generated: await resolveOsmBarrierGeneratedOptions({
                  district,
                  generated,
                  ...(osmBarrierRoot ? { osmBarrierRoot } : {}),
                  ...(osmBarrierArtifact ? { osmBarrierArtifact } : {})
                })
              }
            ] as const
        )
      );
      const sourcesByDistrict = Object.fromEntries(sourcesByDistrictEntries);
      const result = await buildTurkeyV2HybridBatch({
        districts: selectedDistricts,
        sourcesByDistrict,
        generatedDefaults: generated,
        buildDate,
        continueOnError: flags.has("continue-on-error"),
        ...(minimumEffectiveAreaKm2 !== undefined ? { minimumEffectiveAreaKm2 } : {}),
        ...(overlapToleranceKm2 !== undefined ? { overlapToleranceKm2 } : {}),
        ...(gapToleranceKm2 !== undefined ? { gapToleranceKm2 } : {}),
        ...(parentOutsideToleranceKm2 !== undefined ? { parentOutsideToleranceKm2 } : {}),
        ...(flags.has("allow-experimental") ? { allowExperimental: true } : {})
      });
      const summary = {
        schemaVersion: "territorykit-tr-v2-hybrid-build-summary@1",
        command: "tr adm3 hybrid build",
        mode: "batch",
        buildDate,
        districtCount: result.coverage.districtCount,
        successfulDistrictCount: result.coverage.successfulDistrictCount,
        failedDistrictCount: result.coverage.failedDistrictCount,
        finalCoveragePercent: result.coverage.finalCoveragePercent,
        deterministicHash: result.deterministicHash,
        qualityOk: result.quality.ok,
        durationMs: Math.round(performance.now() - startedAt)
      };

      await writeTurkeyAdm3HybridBatchArtifacts({
        outputRoot,
        result,
        summary,
        configuration: {
          buildDate,
          generated,
          sourcePriority: ["official", "osm", "generated"],
          allowExperimental: flags.has("allow-experimental")
        },
        sourceLockSummary: await createTurkeyAdm3HybridSourceLockSummary({
          buildDate,
          districtPath: inputPath,
          ...(officialPath ? { officialPath } : {}),
          ...(osmPath ? { osmPath } : {}),
          ...(migrationBaselinePath ? { migrationBaselinePath } : {})
        }),
        force
      });

      printJson({ ok: result.quality.ok, command: "tr adm3 hybrid build", data: summary });
      return result.quality.ok ? 0 : 1;
    }

    const [district] = selectedDistricts;

    if (!district) {
      throw new Error("No ADM2 district was selected for hybrid build.");
    }

    const { provinceCode, districtCode } = resolveTurkeyAdm3GenerateCodes(district, flags);
    const resolvedGenerated = await resolveOsmBarrierGeneratedOptions({
      district,
      generated,
      ...(osmBarrierRoot ? { osmBarrierRoot } : {}),
      ...(osmBarrierArtifact ? { osmBarrierArtifact } : {})
    });
    const result = await buildTurkeyV2HybridDistrict({
      district,
      provinceCode,
      districtCode,
      officialZones: officialByParent.get(district.id) ?? [],
      osmZones: osmByParent.get(district.id) ?? [],
      generated: resolvedGenerated,
      buildDate,
      migrationBaselineZones: migrationBaselineByParent.get(district.id) ?? [],
      ...(minimumEffectiveAreaKm2 !== undefined ? { minimumEffectiveAreaKm2 } : {}),
      ...(overlapToleranceKm2 !== undefined ? { overlapToleranceKm2 } : {}),
      ...(gapToleranceKm2 !== undefined ? { gapToleranceKm2 } : {}),
      ...(parentOutsideToleranceKm2 !== undefined ? { parentOutsideToleranceKm2 } : {}),
      ...(flags.has("allow-experimental") ? { allowExperimental: true } : {})
    });
    const summary = {
      schemaVersion: "territorykit-tr-v2-hybrid-build-summary@1",
      command: "tr adm3 hybrid build",
      mode: "district",
      buildDate,
      districtId: district.id,
      provinceCode,
      districtCode,
      officialEffectiveCount: result.coverage.officialEffectiveCount,
      osmEffectiveCount: result.coverage.osmEffectiveCount,
      generatedEffectiveCount: result.coverage.generatedEffectiveCount,
      finalCoveragePercent: result.coverage.finalCoveragePercent,
      remainingGapAreaKm2: result.coverage.remainingGapAreaKm2,
      deterministicHash: result.deterministicHash,
      qualityOk: result.quality.ok,
      trV2ValidationOk: result.quality.strictValidation.ok,
      durationMs: Math.round(performance.now() - startedAt)
    };

    await writeTurkeyAdm3HybridDistrictArtifacts({
      outputRoot,
      result,
      summary,
      configuration: {
        buildDate,
        generated,
        sourcePriority: ["official", "osm", "generated"],
        allowExperimental: flags.has("allow-experimental"),
        publishReady: flags.has("publish-ready") || flags.has("strict")
      },
      sourceLockSummary: await createTurkeyAdm3HybridSourceLockSummary({
        buildDate,
        districtPath: inputPath,
        ...(officialPath ? { officialPath } : {}),
        ...(osmPath ? { osmPath } : {}),
        ...(migrationBaselinePath ? { migrationBaselinePath } : {})
      }),
      force
    });

    printJson({
      ok: result.quality.ok,
      command: "tr adm3 hybrid build",
      data: summary,
      issues: result.issues
    });
    return result.quality.ok ? 0 : 1;
  } catch (error) {
    printJson({
      ok: false,
      command: "tr adm3 hybrid build",
      issues: [createCliIssue(error instanceof Error ? error.message : String(error))]
    });
    return 2;
  }
}

function selectTurkeyAdm3HybridDistricts(
  districts: readonly TerritoryZone[],
  districtId: string | undefined,
  batch: boolean
): TerritoryZone[] {
  const selectedIds = districtId
    ? new Set(
        districtId
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      )
    : undefined;
  const selected = selectedIds
    ? districts.filter((district) => selectedIds.has(district.id))
    : batch
      ? [...districts]
      : districts.slice(0, 1);

  if (selectedIds && selected.length !== selectedIds.size) {
    const found = new Set(selected.map((district) => district.id));
    const missing = [...selectedIds].filter((id) => !found.has(id)).sort();
    throw new Error(`District zone(s) not found: ${missing.join(", ")}`);
  }

  if (!batch && selected.length > 1) {
    throw new Error("Multiple district ids require --batch.");
  }

  return selected.sort((left, right) => left.id.localeCompare(right.id));
}

async function writeTurkeyAdm3HybridDistrictArtifacts(input: {
  outputRoot: string;
  result: Awaited<ReturnType<typeof buildTurkeyV2HybridDistrict>>;
  summary: Record<string, unknown>;
  configuration: Record<string, unknown>;
  sourceLockSummary: Record<string, unknown>;
  force: boolean;
}): Promise<void> {
  const jsonPayloads = new Map<string, unknown>([
    [join(input.outputRoot, "dataset.json"), input.result.dataset],
    [
      join(input.outputRoot, "full.geojson"),
      territoryDatasetToFeatureCollection(input.result.dataset)
    ],
    [join(input.outputRoot, "build-summary.json"), input.summary],
    [join(input.outputRoot, "coverage.json"), input.result.coverage],
    [join(input.outputRoot, "quality-report.json"), input.result.quality],
    [join(input.outputRoot, "provenance.json"), input.result.provenance],
    [join(input.outputRoot, "rejection-report.json"), input.result.rejections],
    [join(input.outputRoot, "migration-plan.json"), input.result.migration],
    [join(input.outputRoot, "attribution.json"), input.result.attribution],
    [join(input.outputRoot, "licenses.json"), input.result.licenses],
    [join(input.outputRoot, "distribution-policy.json"), input.result.distributionPolicy],
    [join(input.outputRoot, "adjacency/adjacency.json"), input.result.adjacency],
    [
      join(input.outputRoot, "adjacency/build-report.json"),
      {
        issues: input.result.issues.filter((issue: { code: string }) =>
          issue.code.startsWith("ADJACENCY_")
        ),
        statistics: input.result.adjacencyStatistics
      }
    ],
    [join(input.outputRoot, "configuration.json"), input.configuration],
    [join(input.outputRoot, "source-lock-summary.json"), input.sourceLockSummary]
  ]);
  const textPayloads = new Map<string, string>([
    [join(input.outputRoot, "attribution.txt"), input.result.attribution.text]
  ]);

  await writeHybridArtifactPayloads(input.outputRoot, jsonPayloads, textPayloads, input.force);
}

async function writeTurkeyAdm3HybridBatchArtifacts(input: {
  outputRoot: string;
  result: Awaited<ReturnType<typeof buildTurkeyV2HybridBatch>>;
  summary: Record<string, unknown>;
  configuration: Record<string, unknown>;
  sourceLockSummary: Record<string, unknown>;
  force: boolean;
}): Promise<void> {
  const jsonPayloads = new Map<string, unknown>([
    [join(input.outputRoot, "dataset.json"), input.result.dataset],
    [
      join(input.outputRoot, "full.geojson"),
      territoryDatasetToFeatureCollection(input.result.dataset)
    ],
    [join(input.outputRoot, "batch-summary.json"), input.summary],
    [join(input.outputRoot, "build-summary.json"), input.summary],
    [join(input.outputRoot, "coverage.json"), input.result.coverage],
    [join(input.outputRoot, "quality-report.json"), input.result.quality],
    [join(input.outputRoot, "provenance.json"), input.result.provenance],
    [join(input.outputRoot, "attribution.json"), input.result.attribution],
    [
      join(input.outputRoot, "failed-districts.json"),
      {
        schemaVersion: "territorykit-tr-v2-hybrid-failed-districts@1",
        failures: input.result.failures
      }
    ],
    [join(input.outputRoot, "configuration.json"), input.configuration],
    [join(input.outputRoot, "source-lock-summary.json"), input.sourceLockSummary]
  ]);
  const textPayloads = new Map<string, string>([
    [join(input.outputRoot, "attribution.txt"), input.result.attribution.text]
  ]);

  for (const districtResult of input.result.districts) {
    const districtRoot = join(
      input.outputRoot,
      "districts",
      safeArtifactSegment(districtResult.district.id)
    );
    jsonPayloads.set(join(districtRoot, "coverage.json"), districtResult.coverage);
    jsonPayloads.set(join(districtRoot, "quality-report.json"), districtResult.quality);
    jsonPayloads.set(join(districtRoot, "provenance.json"), districtResult.provenance);
    jsonPayloads.set(join(districtRoot, "rejection-report.json"), districtResult.rejections);
    jsonPayloads.set(join(districtRoot, "migration-plan.json"), districtResult.migration);
    jsonPayloads.set(join(districtRoot, "adjacency/adjacency.json"), districtResult.adjacency);
  }

  await writeHybridArtifactPayloads(input.outputRoot, jsonPayloads, textPayloads, input.force);
}

async function writeHybridArtifactPayloads(
  outputRoot: string,
  jsonPayloads: Map<string, unknown>,
  textPayloads: Map<string, string>,
  force: boolean
): Promise<void> {
  for (const [path, payload] of jsonPayloads) {
    await writeJsonOutput(path, payload, force);
  }

  for (const [path, payload] of textPayloads) {
    await writeTextOutput(path, payload, force);
  }

  await writeJsonOutput(
    join(outputRoot, "checksums.json"),
    createHybridArtifactChecksums(jsonPayloads, textPayloads),
    force
  );
}

function createHybridArtifactChecksums(
  jsonPayloads: ReadonlyMap<string, unknown>,
  textPayloads: ReadonlyMap<string, string>
): Record<string, unknown> {
  const files = [
    ...[...jsonPayloads.entries()].map(([path, payload]) => {
      const serialized = `${JSON.stringify(payload, null, 2)}\n`;
      return [relativeChecksumPath(path), checksumPayload(serialized)] as const;
    }),
    ...[...textPayloads.entries()].map(
      ([path, payload]) =>
        [
          relativeChecksumPath(path),
          checksumPayload(payload.endsWith("\n") ? payload : `${payload}\n`)
        ] as const
    )
  ].sort(([left], [right]) => left.localeCompare(right));

  return {
    schemaVersion: "territorykit-tr-v2-hybrid-checksums@1",
    files: Object.fromEntries(files)
  };
}

function checksumPayload(serialized: string): { sha256: string; byteSize: number } {
  return {
    sha256: sha256Text(serialized),
    byteSize: Buffer.byteLength(serialized)
  };
}

function relativeChecksumPath(path: string): string {
  const districtsIndex = path.indexOf("/districts/");

  if (districtsIndex >= 0) {
    return path.slice(districtsIndex + 1);
  }

  const adjacencyIndex = path.indexOf("/adjacency/");
  if (adjacencyIndex >= 0) {
    return path.slice(adjacencyIndex + 1);
  }

  return path.split("/").pop() ?? path;
}

async function createTurkeyAdm3HybridSourceLockSummary(input: {
  buildDate: string;
  districtPath: string;
  officialPath?: string;
  osmPath?: string;
  migrationBaselinePath?: string;
}): Promise<Record<string, unknown>> {
  const sources = [
    ["district", input.districtPath],
    ["official", input.officialPath],
    ["osm", input.osmPath],
    ["migration-baseline", input.migrationBaselinePath]
  ].flatMap(([kind, path]) => (path ? [{ kind, path }] : []));

  return {
    schemaVersion: "territorykit-tr-v2-hybrid-source-lock-summary@1",
    buildDate: input.buildDate,
    sources: await Promise.all(
      sources.map(async (source) => ({
        kind: source.kind,
        path: source.path,
        sha256: await sha256FileIfReadable(source.path)
      }))
    )
  };
}

async function sha256FileIfReadable(path: string): Promise<string | null> {
  try {
    return createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  } catch {
    return null;
  }
}

async function readTurkeyAdm3Adm2Zones(datasetPath: string): Promise<TerritoryZone[]> {
  const input = await readJson(datasetPath);

  if (!isRecordValue(input) || !Array.isArray(input.zones)) {
    throw new Error(`Bad Turkey ADM2 dataset ${datasetPath}`);
  }

  return input.zones
    .filter(isTerritoryZoneLike)
    .filter((zone) => zone.level === 2 || zone.sourceAdminLevel === "ADM2")
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function readTurkeyAdm3Adm3Zones(datasetPath: string | undefined): Promise<TerritoryZone[]> {
  if (!datasetPath) {
    return [];
  }

  const input = await readJson(datasetPath);

  if (!isRecordValue(input) || !Array.isArray(input.zones)) {
    throw new Error(`Bad Turkey ADM3 artifact ${datasetPath}`);
  }

  return input.zones
    .filter(isTerritoryZoneLike)
    .map((zone) => {
      const territory = isRecordValue(zone.properties.territory) ? zone.properties.territory : {};
      const parentId =
        typeof zone.parentId === "string"
          ? zone.parentId
          : (readTurkeyAdm3StringProperty(territory, "sourceParentId") ??
            readTurkeyAdm3StringProperty(territory, "parentAdm2Id"));

      return parentId ? { ...zone, parentId } : zone;
    })
    .filter(
      (zone) =>
        (zone.level === 3 || zone.sourceAdminLevel === "ADM3") && typeof zone.parentId === "string"
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

function groupTurkeyAdm3ZonesByParent(
  zones: readonly TerritoryZone[]
): Map<string, TerritoryZone[]> {
  const grouped = new Map<string, TerritoryZone[]>();

  for (const zone of zones) {
    if (!zone.parentId) {
      continue;
    }

    const siblings = grouped.get(zone.parentId) ?? [];
    siblings.push(zone);
    grouped.set(zone.parentId, siblings);
  }

  for (const [parentId, siblings] of grouped.entries()) {
    grouped.set(
      parentId,
      siblings.sort((left, right) => left.id.localeCompare(right.id))
    );
  }

  return grouped;
}

function resolveTurkeyAdm3GenerateCodes(
  district: TerritoryZone,
  flags: Map<string, string | true>
): { provinceCode: string; districtCode: string } {
  const territory = isRecordValue(district.properties.territory)
    ? district.properties.territory
    : {};
  const provinceCode =
    getFlag(flags, "province-code") ??
    readTurkeyAdm3StringProperty(territory, "provinceCode") ??
    readTurkeyAdm3StringProperty(territory, "adm2.provinceCode") ??
    "00";
  const districtCode =
    getFlag(flags, "district-code") ??
    readTurkeyAdm3StringProperty(territory, "districtCode") ??
    readTurkeyAdm3StringProperty(territory, "adm2.districtCode") ??
    district.id.replace(/^tr:adm2:/, "").slice(0, 12);

  return { provinceCode, districtCode };
}

function territoryDatasetToFeatureCollection(dataset: TerritoryDataset): Record<string, unknown> {
  return {
    type: "FeatureCollection",
    territoryKit: {
      datasetId: dataset.manifest.datasetId,
      datasetVersion: dataset.manifest.datasetVersion,
      geometryHash: dataset.manifest.geometryHash
    },
    features: dataset.zones.map((zone) => ({
      type: "Feature",
      id: zone.id,
      properties: {
        ...zone.properties,
        id: zone.id,
        datasetId: zone.datasetId,
        countryCode: zone.countryCode,
        level: zone.level,
        sourceAdminLevel: zone.sourceAdminLevel,
        semanticType: zone.semanticType,
        name: zone.name,
        localName: zone.localName,
        parentId: zone.parentId,
        childIds: zone.childIds,
        neighborIds: zone.neighborIds,
        bbox: zone.bbox,
        center: zone.center
      },
      geometry: zone.geometry
    }))
  };
}

function isTerritoryZoneLike(input: unknown): input is TerritoryZone {
  return (
    isRecordValue(input) &&
    typeof input.id === "string" &&
    typeof input.datasetId === "string" &&
    typeof input.level === "number" &&
    Array.isArray(input.neighborIds) &&
    isRecordValue(input.geometry) &&
    Array.isArray(input.bbox) &&
    Array.isArray(input.center) &&
    isRecordValue(input.properties)
  );
}

function readTurkeyAdm3StringProperty(
  input: Record<string, unknown>,
  path: string
): string | undefined {
  let current: unknown = input;

  for (const segment of path.split(".")) {
    if (!isRecordValue(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return typeof current === "string" && current.length > 0 ? current : undefined;
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

function readOptionalPositiveNumberFlag(
  flags: Map<string, string | true>,
  key: string,
  issues: CliIssue[]
): number | undefined {
  const value = getFlag(flags, key);

  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    issues.push(createCliIssue(`--${key} must be a positive number.`));
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

async function resolveOsmBarrierGeneratedOptions(input: {
  district: TerritoryZone;
  generated: TurkeyV2HybridGeneratedOptions;
  osmBarrierRoot?: string;
  osmBarrierArtifact?: string;
}): Promise<TurkeyV2HybridGeneratedOptions> {
  if (!input.generated.enabled || (!input.osmBarrierRoot && !input.osmBarrierArtifact)) {
    return input.generated;
  }

  try {
    const artifact = input.osmBarrierArtifact
      ? await readTurkeyOsmAdm2BarrierArtifact(input.osmBarrierArtifact)
      : await readTurkeyOsmAdm2BarrierArtifact(input.osmBarrierRoot!, input.district.id);

    if (artifact.manifest.adm2Id !== input.district.id || artifact.quality.status !== "eligible") {
      return input.generated;
    }

    const osmGenerated = createTurkeyOsmSmartFallbackGeneratedOptions(artifact, {
      fallbackToLegacyOnSmartFailure: input.generated.fallbackToLegacyOnSmartFailure ?? true
    });
    const osmSmartFallback = osmGenerated.smartFallback;

    if (!osmSmartFallback) {
      return input.generated;
    }

    return {
      ...input.generated,
      strategy: "smart",
      fallbackToLegacyOnSmartFailure:
        input.generated.fallbackToLegacyOnSmartFailure ??
        osmGenerated.fallbackToLegacyOnSmartFailure ??
        true,
      smartFallback: {
        ...osmSmartFallback,
        ...(input.generated.smartFallback?.profile
          ? { profile: input.generated.smartFallback.profile }
          : {}),
        options: {
          ...(osmSmartFallback.options ?? {}),
          ...(input.generated.smartFallback?.options ?? {})
        }
      }
    };
  } catch {
    return input.generated;
  }
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function writeJsonOutput(path: string, payload: unknown, force: boolean): Promise<void> {
  await assertCanWrite(path, force);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function writeTextOutput(path: string, payload: string, force: boolean): Promise<void> {
  await assertCanWrite(path, force);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, payload.endsWith("\n") ? payload : `${payload}\n`, "utf8");
}

async function assertCanWrite(path: string, force: boolean): Promise<void> {
  if (force) {
    return;
  }

  try {
    await readFile(path);
    throw new Error(`Output path '${path}' already exists. Pass --force to overwrite.`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already exists")) {
      throw error;
    }
  }
}

function safeArtifactSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9_.-]+/g, "-");
}

function isRecordValue(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function sha256Text(input: string): string {
  return createHash("sha256").update(input).digest("hex");
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
