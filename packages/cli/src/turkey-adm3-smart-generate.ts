import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { validateTurkeyV2Dataset } from "@territory-kit/dataset/turkey-v2";
import type { LngLat, TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";
import {
  buildTurkeyGameZonesWithAdjacency,
  buildTurkeySmartFallbackWithAdjacency,
  createTurkeySmartFallbackDataset,
  normalizeTurkeySmartFallbackBarriers,
  resolveTurkeySmartFallbackConfiguration
} from "@territory-kit/generators/turkey-adm3";
import type {
  TurkeyGameZoneFragmentStrategy,
  TurkeyGameZoneProfile,
  TurkeySmartFallbackLocalitySeed,
  TurkeySmartFallbackOptions,
  TurkeySmartFallbackProfile
} from "@territory-kit/generators/turkey-adm3";
import type { FeatureCollection } from "geojson";

type CliFlagMap = Map<string, string | true>;

interface CliIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
}

export interface TurkeyAdm3SmartGenerateInput {
  startedAt: number;
  flags: CliFlagMap;
  district: TerritoryZone;
  provinceCode: string;
  districtCode: string;
  outputRoot: string;
  profileRaw: string;
  seed?: string;
  targetAreaKm2?: number;
  targetZoneCount?: number;
  minAreaKm2?: number;
  maxAreaKm2?: number;
  maxZonesPerDistrict?: number;
  minFragmentAreaKm2?: number;
  population?: number;
  populationDensityPerKm2?: number;
  urbanityHint?: "urban" | "suburban" | "rural";
  fragmentStrategy?: TurkeyGameZoneFragmentStrategy;
}

export async function runTurkeyAdm3SmartGenerate(
  input: TurkeyAdm3SmartGenerateInput
): Promise<number> {
  const {
    startedAt,
    flags,
    district,
    provinceCode,
    districtCode,
    outputRoot,
    profileRaw,
    seed,
    targetAreaKm2,
    targetZoneCount,
    minAreaKm2,
    maxAreaKm2,
    maxZonesPerDistrict,
    minFragmentAreaKm2,
    population,
    populationDensityPerKm2,
    urbanityHint,
    fragmentStrategy
  } = input;
  const flagIssues: CliIssue[] = [];
  const minBarrierStrength = readOptionalNonNegativeNumberFlag(
    flags,
    "min-barrier-strength",
    flagIssues
  );
  const minBarrierLengthKm = readOptionalNonNegativeNumberFlag(
    flags,
    "min-barrier-length",
    flagIssues
  );
  const minMeanQualityScore = readOptionalNonNegativeNumberFlag(
    flags,
    "min-quality-score",
    flagIssues
  );
  const minMeanBarrierAlignment = readOptionalNonNegativeNumberFlag(
    flags,
    "min-barrier-alignment",
    flagIssues
  );
  const maxSyntheticSplits = readOptionalNonNegativeIntegerFlag(
    flags,
    "max-synthetic-splits",
    flagIssues
  );
  const requireBarrierForMultiTerritory = readOptionalBooleanFlag(
    flags,
    "require-barrier",
    flagIssues
  );

  if (flagIssues.length > 0) {
    printJson({ ok: false, command: "tr adm3 generate", issues: flagIssues });
    return 2;
  }

  const smartLayers = await readTurkeyAdm3SmartFallbackLayers(flags);
  const localitySeeds = await readTurkeyAdm3SmartLocalitySeedsFlag(flags);
  const sourceMetadata = createTurkeyAdm3SmartFallbackSourceMetadata(flags);
  const smartOptions = {
    ...(seed ? { seed } : {}),
    ...(targetAreaKm2 !== undefined ? { targetAreaKm2 } : {}),
    ...(targetZoneCount !== undefined ? { targetTerritoryCount: targetZoneCount } : {}),
    ...(minAreaKm2 !== undefined ? { minAreaKm2 } : {}),
    ...(maxAreaKm2 !== undefined ? { maxAreaKm2 } : {}),
    ...(maxZonesPerDistrict !== undefined ? { maxTerritories: maxZonesPerDistrict } : {}),
    ...(minFragmentAreaKm2 !== undefined ? { minFragmentAreaKm2 } : {}),
    ...(minBarrierStrength !== undefined ? { minBarrierStrength } : {}),
    ...(minBarrierLengthKm !== undefined ? { minBarrierLengthKm } : {}),
    ...(minMeanQualityScore !== undefined ? { minMeanQualityScore } : {}),
    ...(minMeanBarrierAlignment !== undefined ? { minMeanBarrierAlignment } : {}),
    ...(maxSyntheticSplits !== undefined ? { maxSyntheticSplits } : {}),
    ...(requireBarrierForMultiTerritory !== undefined ? { requireBarrierForMultiTerritory } : {}),
    ...(sourceMetadata ? { sourceMetadata } : {})
  } satisfies TurkeySmartFallbackOptions;
  const smartInput = {
    parent: district,
    provinceCode,
    districtCode,
    profile: toTurkeyAdm3SmartFallbackProfile(profileRaw),
    ...smartLayers,
    ...(localitySeeds ? { localitySeeds } : {}),
    options: smartOptions
  };
  const resolution = resolveTurkeySmartFallbackConfiguration(smartInput);
  const barriers = normalizeTurkeySmartFallbackBarriers(smartInput);

  if (flags.has("dry-run") || flags.has("plan")) {
    printJson({
      ok: resolution.ok,
      command: "tr adm3 generate",
      data: {
        dryRun: true,
        strategy: "smart",
        districtId: district.id,
        provinceCode,
        districtCode,
        configuration: resolution.configuration,
        barrierSummary: summarizeTurkeySmartFallbackBarriers(barriers),
        issues: resolution.issues
      }
    });
    return resolution.ok ? 0 : 2;
  }

  const result = await buildTurkeySmartFallbackWithAdjacency(smartInput);
  const dataset = createTurkeySmartFallbackDataset({
    parent: district,
    zones: result.zones,
    datasetId: "tr-adm3-smart-fallback-build",
    sourceDate: result.configuration.algorithmVersion
  });
  const trV2Validation = validateTurkeyV2Dataset(dataset);
  const legacyComparison = flags.has("no-legacy-comparison")
    ? undefined
    : await buildTurkeyGameZonesWithAdjacency({
        district,
        provinceCode,
        districtCode,
        profile: toTurkeyAdm3LegacyFallbackProfile(profileRaw),
        ...(seed ? { seed } : {}),
        ...(targetAreaKm2 ? { targetAreaKm2 } : {}),
        ...(targetZoneCount ? { targetZoneCount } : {}),
        ...(minAreaKm2 ? { minAreaKm2 } : {}),
        ...(maxAreaKm2 ? { maxAreaKm2 } : {}),
        ...(maxZonesPerDistrict ? { maxZonesPerDistrict } : {}),
        ...(minFragmentAreaKm2 ? { minFragmentAreaKm2 } : {}),
        ...(population !== undefined ? { population } : {}),
        ...(populationDensityPerKm2 !== undefined ? { populationDensityPerKm2 } : {}),
        ...(urbanityHint ? { urbanityHint } : {}),
        ...(fragmentStrategy ? { fragmentStrategy } : {})
      });
  const artifactPaths = {
    dataset: join(outputRoot, "dataset.json"),
    fullGeoJson: join(outputRoot, "full.geojson"),
    coverage: join(outputRoot, "coverage.json"),
    quality: join(outputRoot, "quality-report.json"),
    adjacency: join(outputRoot, "adjacency.json"),
    buildSummary: join(outputRoot, "build-summary.json"),
    configuration: join(outputRoot, "configuration.json"),
    manifest: join(outputRoot, "manifest.json"),
    comparison: join(outputRoot, "comparison.json"),
    checksums: join(outputRoot, "checksums.json")
  };
  const fullGeoJson = territoryDatasetToFeatureCollection(dataset);
  const comparison = {
    schemaVersion: "territorykit-tr-adm3-smart-fallback-comparison@1",
    districtId: district.id,
    smart: {
      algorithmVersion: result.configuration.algorithmVersion,
      selectedProfile: result.selectedProfile,
      producedZoneCount: result.zones.length,
      finalCoveragePercent: result.quality.coveragePercent,
      meanQualityScore: result.quality.meanQualityScore,
      meanBarrierAlignment: result.quality.meanBarrierAlignment,
      deterministicHash: result.deterministicHash,
      qualityOk: result.quality.ok
    },
    ...(legacyComparison
      ? {
          legacy: {
            algorithmVersion: legacyComparison.configuration.algorithmVersion,
            selectedProfile: legacyComparison.selectedProfile,
            producedZoneCount: legacyComparison.zones.length,
            finalCoveragePercent: legacyComparison.coverage.finalCoveragePercent,
            deterministicHash: legacyComparison.deterministicHash,
            qualityOk: legacyComparison.quality.ok
          }
        }
      : {})
  };
  const summary = {
    schemaVersion: "territorykit-tr-adm3-smart-fallback-build-summary@1",
    command: "tr adm3 generate",
    strategy: "smart",
    districtId: district.id,
    provinceCode,
    districtCode,
    selectedProfile: result.selectedProfile,
    algorithmVersion: result.configuration.algorithmVersion,
    producedZoneCount: result.zones.length,
    finalCoveragePercent: result.quality.coveragePercent,
    overlapAreaKm2: result.quality.overlapAreaKm2,
    parentContainmentErrorCount: result.quality.spillAreaKm2 > 0 ? 1 : 0,
    invalidGeometryCount: result.quality.invalidGeometryCount,
    meanQualityScore: result.quality.meanQualityScore,
    meanBarrierAlignment: result.quality.meanBarrierAlignment,
    barrierSummary: summarizeTurkeySmartFallbackBarriers(result.barriers),
    deterministicHash: result.deterministicHash,
    qualityOk: result.quality.ok,
    trV2ValidationOk: trV2Validation.ok,
    durationMs: Math.round(performance.now() - startedAt),
    artifacts: artifactPaths
  };
  const filePayloads = new Map<string, unknown>([
    [artifactPaths.dataset, dataset],
    [artifactPaths.fullGeoJson, fullGeoJson],
    [artifactPaths.coverage, result.quality],
    [artifactPaths.quality, result.quality],
    [artifactPaths.adjacency, result.adjacency ?? { edges: [] }],
    [artifactPaths.buildSummary, summary],
    [artifactPaths.configuration, result.configuration],
    [artifactPaths.manifest, result.manifest],
    [artifactPaths.comparison, comparison]
  ]);
  const checksums = createArtifactChecksums(filePayloads);

  for (const [path, payload] of filePayloads) {
    await writeJsonOutput(path, payload, flags.has("force"));
  }
  await writeJsonOutput(artifactPaths.checksums, checksums, flags.has("force"));

  const ok =
    result.quality.ok &&
    result.issues.every((issue) => issue.severity !== "error") &&
    trV2Validation.ok;

  printJson({
    ok,
    command: "tr adm3 generate",
    data: summary,
    issues: [
      ...result.issues,
      ...trV2Validation.issues.map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        message: issue.message,
        zoneId: issue.zoneId,
        parentId: issue.parentId
      }))
    ]
  });
  return ok ? 0 : 1;
}

async function readTurkeyAdm3SmartFallbackLayers(flags: CliFlagMap): Promise<{
  roads?: FeatureCollection;
  railways?: FeatureCollection;
  water?: FeatureCollection;
  landuse?: FeatureCollection;
  parks?: FeatureCollection;
}> {
  const roads = await readOptionalFeatureCollectionFlag(flags, "roads");
  const railways = await readOptionalFeatureCollectionFlag(flags, "railways");
  const water = await readOptionalFeatureCollectionFlag(flags, "water");
  const landuse = await readOptionalFeatureCollectionFlag(flags, "landuse");
  const parks = await readOptionalFeatureCollectionFlag(flags, "parks");

  return {
    ...(roads ? { roads } : {}),
    ...(railways ? { railways } : {}),
    ...(water ? { water } : {}),
    ...(landuse ? { landuse } : {}),
    ...(parks ? { parks } : {})
  };
}

async function readOptionalFeatureCollectionFlag(
  flags: CliFlagMap,
  key: string
): Promise<FeatureCollection | undefined> {
  const path = getFlag(flags, key);

  if (!path) {
    return undefined;
  }

  const input = await readJson(path);

  if (!isFeatureCollectionValue(input)) {
    throw new Error(`--${key} must point to a GeoJSON FeatureCollection.`);
  }

  return input;
}

async function readTurkeyAdm3SmartLocalitySeedsFlag(
  flags: CliFlagMap
): Promise<TurkeySmartFallbackLocalitySeed[] | undefined> {
  const path = getFlag(flags, "locality-seeds") ?? getFlag(flags, "seeds");

  if (!path) {
    return undefined;
  }

  const input = await readJson(path);

  if (Array.isArray(input)) {
    return input.map(parseTurkeyAdm3SmartLocalitySeed);
  }

  if (isFeatureCollectionValue(input)) {
    return input.features.flatMap((feature, index) => {
      if (!feature.geometry || feature.geometry.type !== "Point") {
        return [];
      }

      const properties = isRecordValue(feature.properties) ? feature.properties : {};
      const coordinate = readLngLatValue(feature.geometry.coordinates);
      const id = feature.id !== undefined ? String(feature.id) : undefined;
      const source = readStringValue(properties.source);
      const sourceId = readStringValue(properties.osm_id);
      const type = normalizeTurkeyAdm3SmartSeedType(readStringValue(properties.place));
      const name =
        readStringValue(properties.name) ??
        readStringValue(properties["name:tr"]) ??
        readStringValue(properties.local_name) ??
        id ??
        `Seed ${index + 1}`;

      if (!coordinate) {
        return [];
      }

      return [
        {
          name,
          coordinate,
          ...(id ? { id } : {}),
          ...(source ? { source } : {}),
          ...(sourceId ? { sourceId } : {}),
          type,
          authoritative: false as const
        }
      ];
    });
  }

  throw new Error("--locality-seeds must point to a JSON array or Point FeatureCollection.");
}

function parseTurkeyAdm3SmartLocalitySeed(
  input: unknown,
  index: number
): TurkeySmartFallbackLocalitySeed {
  if (!isRecordValue(input)) {
    throw new Error(`Invalid locality seed at index ${index}.`);
  }

  const coordinate =
    readLngLatValue(input.coordinate) ??
    readLngLatPair(input.lng, input.lat) ??
    readLngLatPair(input.longitude, input.latitude);
  const id = readStringValue(input.id);
  const source = readStringValue(input.source);
  const sourceId = readStringValue(input.sourceId);
  const type = normalizeTurkeyAdm3SmartSeedType(readStringValue(input.type));
  const name = readStringValue(input.name) ?? readStringValue(input.id) ?? `Seed ${index + 1}`;

  if (!coordinate) {
    throw new Error(`Locality seed '${name}' is missing a valid coordinate.`);
  }

  return {
    name,
    coordinate,
    ...(id ? { id } : {}),
    ...(source ? { source } : {}),
    ...(sourceId ? { sourceId } : {}),
    type,
    authoritative: false,
    ...(typeof input.confidence === "number" ? { confidence: input.confidence } : {})
  };
}

function createTurkeyAdm3SmartFallbackSourceMetadata(
  flags: CliFlagMap
): TurkeySmartFallbackOptions["sourceMetadata"] | undefined {
  const providerId = getFlag(flags, "source-provider") ?? getFlag(flags, "provider");
  const providerName = getFlag(flags, "source-provider-name") ?? getFlag(flags, "provider-name");
  const sourceDatasetId = getFlag(flags, "source-dataset-id");
  const sourceId = getFlag(flags, "source-id");
  const sourceDate = getFlag(flags, "source-date");
  const sourceVersion = getFlag(flags, "source-version");
  const sourceUrl = getFlag(flags, "source-url");
  const sourceSnapshotId = getFlag(flags, "source-snapshot-id");
  const sourceSnapshotChecksum = getFlag(flags, "source-snapshot-checksum");
  const license = getFlag(flags, "license");
  const attribution = getFlag(flags, "attribution");

  if (
    !providerId &&
    !providerName &&
    !sourceDatasetId &&
    !sourceId &&
    !sourceDate &&
    !sourceVersion &&
    !sourceUrl &&
    !sourceSnapshotId &&
    !sourceSnapshotChecksum &&
    !license &&
    !attribution
  ) {
    return undefined;
  }

  return {
    ...(providerId ? { providerId } : {}),
    ...(providerName ? { providerName } : {}),
    ...(sourceDatasetId ? { sourceDatasetId } : {}),
    ...(sourceId ? { sourceId } : {}),
    ...(sourceDate ? { sourceDate } : {}),
    ...(sourceVersion ? { sourceVersion } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(sourceSnapshotId ? { sourceSnapshotId } : {}),
    ...(sourceSnapshotChecksum ? { sourceSnapshotChecksum } : {}),
    ...(license ? { license } : {}),
    ...(attribution ? { attribution } : {})
  };
}

function summarizeTurkeySmartFallbackBarriers(
  barriers: ReturnType<typeof normalizeTurkeySmartFallbackBarriers>
): Record<string, unknown> {
  const byLayer = countBy(barriers, (barrier) => barrier.sourceLayer);
  const byClass = countBy(barriers, (barrier) => barrier.barrierClass);
  const byStrength = countBy(barriers, (barrier) => barrier.strengthClass);
  const lengthKm = barriers.reduce((total, barrier) => total + barrier.lengthKm, 0);

  return {
    count: barriers.length,
    byLayer,
    byClass,
    byStrength,
    lengthKm: roundMetric(lengthKm),
    strongOrMediumCount: (byStrength.strong ?? 0) + (byStrength.medium ?? 0)
  };
}

function toTurkeyAdm3SmartFallbackProfile(input: string): TurkeySmartFallbackProfile {
  return input as TurkeySmartFallbackProfile;
}

function toTurkeyAdm3LegacyFallbackProfile(input: string): TurkeyGameZoneProfile {
  return input === "dense-urban" ? "urban" : (input as TurkeyGameZoneProfile);
}

function normalizeTurkeyAdm3SmartSeedType(
  input: string | undefined
): Exclude<TurkeySmartFallbackLocalitySeed["type"], undefined> {
  if (
    input === "neighbourhood" ||
    input === "suburb" ||
    input === "quarter" ||
    input === "village" ||
    input === "locality"
  ) {
    return input;
  }

  return "unknown";
}

function isFeatureCollectionValue(input: unknown): input is FeatureCollection {
  return (
    isRecordValue(input) && input.type === "FeatureCollection" && Array.isArray(input.features)
  );
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

function createArtifactChecksums(
  filePayloads: ReadonlyMap<string, unknown>
): Record<string, unknown> {
  const files = Object.fromEntries(
    [...filePayloads.entries()]
      .map(([path, payload]) => {
        const serialized = `${JSON.stringify(payload, null, 2)}\n`;
        return [
          path.split("/").pop() ?? path,
          {
            sha256: sha256Text(serialized),
            byteSize: Buffer.byteLength(serialized)
          }
        ] as const;
      })
      .sort(([left], [right]) => left.localeCompare(right))
  );

  return {
    schemaVersion: "territorykit-tr-adm3-smart-fallback-checksums@1",
    files
  };
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJsonOutput(path: string, payload: unknown, force: boolean): Promise<void> {
  if (!force) {
    try {
      await readFile(path);
      throw new Error(`Refusing to overwrite ${path}; pass --force to replace it.`);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function getFlag(flags: CliFlagMap, key: string): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function readOptionalNonNegativeNumberFlag(
  flags: CliFlagMap,
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

function readOptionalNonNegativeIntegerFlag(
  flags: CliFlagMap,
  key: string,
  issues: CliIssue[]
): number | undefined {
  const value = getFlag(flags, key);

  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    issues.push(createCliIssue(`--${key} must be a non-negative integer.`));
    return undefined;
  }

  return parsed;
}

function readOptionalBooleanFlag(
  flags: CliFlagMap,
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

function isRecordValue(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function readStringValue(input: unknown): string | undefined {
  if (typeof input !== "string" && typeof input !== "number") {
    return undefined;
  }

  const value = String(input).trim();
  return value.length > 0 ? value : undefined;
}

function readLngLatValue(input: unknown): LngLat | undefined {
  return Array.isArray(input) ? readLngLatPair(input[0], input[1]) : undefined;
}

function readLngLatPair(longitudeInput: unknown, latitudeInput: unknown): LngLat | undefined {
  const longitude = Number(longitudeInput);
  const latitude = Number(latitudeInput);

  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return undefined;
  }

  return [longitude, latitude];
}

function countBy<T>(input: readonly T[], keyFor: (item: T) => string): Record<string, number> {
  const result: Record<string, number> = {};

  for (const item of input) {
    const key = keyFor(item);
    result[key] = (result[key] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(result).sort(([left], [right]) => left.localeCompare(right))
  );
}

function roundMetric(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
}

function sha256Text(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function createCliIssue(message: string): CliIssue {
  return { code: "CLI_ERROR", severity: "error", message };
}
