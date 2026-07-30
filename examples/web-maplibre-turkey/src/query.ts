import { createTerritoryEngine } from "@territory-kit/core";
import { loadTerritoryDataset } from "@territory-kit/dataset";
import type { TerritoryAdminLevel, TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";
import { turkeyNationalCoverage } from "@territory-kit/data-tr";
import type { TerritoryRegistryClient, TerritoryRegistryDataset } from "@territory-kit/registry";
import { createTurkeyAdm3DemoDataset } from "@territory-kit/shared-testkit";
import { adminLevelDepth, childDemoLevel, parentDemoLevel } from "./levels.js";
import type {
  DemoAdminLevel,
  DemoMetadata,
  QueryCacheTelemetry,
  TerritoryDetails,
  TerritoryQueryService,
  TerritorySearchResult
} from "./types.js";

type LoadedDatasetByLevel = Partial<Record<TerritoryAdminLevel, TerritoryDataset>>;
type EngineByLevel = Partial<Record<TerritoryAdminLevel, ReturnType<typeof createTerritoryEngine>>>;

const DETAIL_LIST_LIMIT = 80;
const QUERY_LEVELS: readonly TerritoryAdminLevel[] = ["ADM0", "ADM1", "ADM2", "ADM3"];

export function createFixtureQueryService(): TerritoryQueryService {
  const dataset = createTurkeyAdm3DemoDataset();
  const datasets = Object.fromEntries(
    QUERY_LEVELS.map((level) => [level, createLevelDataset(dataset, level)])
  ) as LoadedDatasetByLevel;
  const engines = createEngines(datasets);
  const zonesById = new Map(dataset.zones.map((zone) => [zone.id, zone]));

  return createQueryServiceFromStore({
    metadata: createFixtureMetadata(dataset),
    datasets,
    engines,
    zonesById,
    artifactCount: QUERY_LEVELS.length,
    cachePrefix: "fixture memory"
  });
}

export function createRegistryQueryService(input: {
  registry: TerritoryRegistryClient;
  datasetId: string;
  datasetVersion: string;
  datasetVersionPinned: boolean;
  allowPrerelease: boolean;
}): TerritoryQueryService {
  const datasets: LoadedDatasetByLevel = {};
  const engines: EngineByLevel = {};
  const zonesById = new Map<string, TerritoryZone>();
  let artifactCount = 0;

  async function ensureLevels(
    levels: readonly TerritoryAdminLevel[],
    signal: AbortSignal | undefined
  ): Promise<void> {
    assertNotAborted(signal);
    const missing = [...new Set(levels)].filter((level) => !datasets[level]);

    if (missing.length === 0) {
      return;
    }

    const installed = await input.registry.installDataset({
      datasetId: input.datasetId,
      version: input.datasetVersion,
      allowPrerelease: input.allowPrerelease,
      levels: missing,
      ...(signal ? { signal } : {})
    });
    artifactCount = Math.max(artifactCount, installed.installedArtifacts.length);

    for (const artifact of installed.installedArtifacts) {
      assertNotAborted(signal);
      const path = artifact.artifact.path;
      const level = readLevelFromDatasetPath(path);

      if (!path || !level || !missing.includes(level)) {
        continue;
      }

      const dataset = JSON.parse(await installed.readText(path)) as TerritoryDataset;
      datasets[level] = dataset;
      engines[level] = createTerritoryEngine({ dataset: toEngineDataset(dataset) });

      for (const zone of dataset.zones) {
        zonesById.set(zone.id, zone);
      }
    }
  }

  return createQueryServiceFromStore({
    metadata: createRegistryPlaceholderMetadata(input),
    datasets,
    engines,
    zonesById,
    artifactCount: () => artifactCount,
    cachePrefix: "registry memory",
    ensureLevels
  });
}

export function createMetadataFromRegistryDataset(input: {
  dataset: TerritoryRegistryDataset;
  datasetVersionPinned: boolean;
  registryHash?: string;
}): DemoMetadata {
  const sourceProvider = input.dataset.source.provider;

  return {
    datasetId: input.dataset.id,
    datasetVersion: input.dataset.version,
    datasetVersionPinned: input.datasetVersionPinned,
    sourceProvider,
    ...(input.dataset.source.url ? { sourceUrl: input.dataset.source.url } : {}),
    sourceAttribution:
      input.dataset.source.attribution ??
      input.dataset.license.attribution ??
      `${sourceProvider} via TerritoryKit registry`,
    license: input.dataset.license,
    coverage: {
      ADM1: input.dataset.levels.includes("ADM1") ? "verified" : "unknown",
      ADM2: input.dataset.levels.includes("ADM2") ? "verified" : "unknown",
      ADM3: turkeyNationalCoverage.levels.ADM3.status
    },
    ...(input.registryHash ? { registryHash: input.registryHash } : {})
  };
}

function createQueryServiceFromStore(input: {
  metadata: DemoMetadata;
  datasets: LoadedDatasetByLevel;
  engines: EngineByLevel;
  zonesById: Map<string, TerritoryZone>;
  artifactCount: number | (() => number);
  cachePrefix: string;
  ensureLevels?: (
    levels: readonly TerritoryAdminLevel[],
    signal: AbortSignal | undefined
  ) => Promise<void>;
}): TerritoryQueryService {
  async function ensureLevels(
    levels: readonly TerritoryAdminLevel[],
    signal: AbortSignal | undefined
  ): Promise<void> {
    if (input.ensureLevels) {
      await input.ensureLevels(levels, signal);
    }

    assertNotAborted(signal);
  }

  function readZone(id: string): TerritoryZone | undefined {
    return input.zonesById.get(id);
  }

  return {
    metadata: input.metadata,
    async search(query, options) {
      assertNotAborted(options.signal);

      const levels = options.levels.length > 0 ? options.levels : (["ADM1", "ADM2"] as const);
      await ensureLevels(levels, options.signal);

      const normalized = normalizeSearchText(query);

      if (!normalized) {
        return [];
      }

      return levels
        .flatMap((level) => input.datasets[level]?.zones ?? [])
        .filter((zone) => matchesSearch(zone, normalized))
        .sort((left, right) => compareSearchRank(left, right, normalized))
        .slice(0, options.limit)
        .map(toSearchResult);
    },
    async locate(coordinate, options) {
      const level = options.level;
      await ensureLevels([level], options.signal);
      const engine = input.engines[level];
      const zoneId = engine?.latLngToZone(coordinate, { level: adminLevelDepth(level) });

      return zoneId
        ? this.getTerritoryDetails(zoneId, {
            level,
            ...(options.signal ? { signal: options.signal } : {})
          })
        : undefined;
    },
    async getTerritoryDetails(territoryId, options = {}) {
      const hintLevels = options.level
        ? [options.level]
        : (["ADM1", "ADM2", "ADM3"] as readonly TerritoryAdminLevel[]);

      await ensureLevels(hintLevels, options.signal);

      let zone = readZone(territoryId);

      if (!zone) {
        await ensureLevels(QUERY_LEVELS, options.signal);
        zone = readZone(territoryId);
      }

      if (!zone) {
        return undefined;
      }

      const parentLevel =
        zone.level > 0 ? (`ADM${zone.level - 1}` as TerritoryAdminLevel) : undefined;
      const currentLevel = `ADM${zone.level}` as TerritoryAdminLevel;
      const childLevel =
        zone.level < 3 ? (`ADM${zone.level + 1}` as TerritoryAdminLevel) : undefined;

      await ensureLevels(
        [parentLevel, currentLevel, childLevel].filter((level): level is TerritoryAdminLevel =>
          Boolean(level)
        ),
        options.signal
      );

      const parent = zone.parentId ? readZone(zone.parentId) : undefined;
      const children = readChildren(zone, input.zonesById);
      const neighbors = readNeighbors(zone, input.zonesById);

      return {
        zone,
        ...(parent ? { parent } : {}),
        children: children.slice(0, DETAIL_LIST_LIMIT),
        neighbors: neighbors.slice(0, DETAIL_LIST_LIMIT),
        childrenLimited: children.length > DETAIL_LIST_LIMIT,
        neighborsLimited: neighbors.length > DETAIL_LIST_LIMIT
      };
    },
    getRenderDataset(level, adm3ParentId) {
      const dataset = input.datasets[level] ?? createEmptyDataset(input.metadata, level);
      const zones =
        level === "ADM3" && adm3ParentId
          ? dataset.zones.filter((zone) => zone.parentId === adm3ParentId)
          : dataset.zones;

      return { ...dataset, zones };
    },
    async getCacheTelemetry() {
      const loadedLevels = QUERY_LEVELS.filter((level) => Boolean(input.datasets[level]));
      const artifactCount =
        typeof input.artifactCount === "function" ? input.artifactCount() : input.artifactCount;
      const zoneCount = [...input.zonesById.values()].length;

      return {
        loadedLevels,
        zoneCount,
        artifactCount,
        cacheLabel: `${input.cachePrefix}: ${loadedLevels.length} levels, ${zoneCount} zones`
      } satisfies QueryCacheTelemetry;
    }
  };
}

function createFixtureMetadata(dataset: TerritoryDataset): DemoMetadata {
  return {
    datasetId: dataset.manifest.datasetId,
    datasetVersion: dataset.manifest.datasetVersion,
    datasetVersionPinned: true,
    sourceProvider: dataset.manifest.sourceProvider ?? "synthetic-demo",
    sourceAttribution: dataset.manifest.attribution ?? "Synthetic TerritoryKit demo fixture",
    license: {
      id: dataset.manifest.license ?? "Apache-2.0",
      attribution: dataset.manifest.attribution ?? "Synthetic TerritoryKit demo fixture"
    },
    coverage: {
      ADM1: "verified",
      ADM2: "verified",
      ADM3: "partial"
    }
  };
}

function createRegistryPlaceholderMetadata(input: {
  datasetId: string;
  datasetVersion: string;
  datasetVersionPinned: boolean;
}): DemoMetadata {
  return {
    datasetId: input.datasetId,
    datasetVersion: input.datasetVersion,
    datasetVersionPinned: input.datasetVersionPinned,
    sourceProvider: "registry manifest pending",
    sourceAttribution: "Registry metadata will load with the first artifact.",
    license: {
      id: "unknown",
      attribution: "Registry metadata pending"
    },
    coverage: {
      ADM1: "unknown",
      ADM2: "unknown",
      ADM3: "partial"
    }
  };
}

function createLevelDataset(
  dataset: TerritoryDataset,
  level: TerritoryAdminLevel
): TerritoryDataset {
  const depth = Number(level.slice(3));
  const zones = dataset.zones.filter((zone) => zone.level === depth);

  return {
    manifest: {
      ...dataset.manifest,
      adminLevels: [level],
      name: `${dataset.manifest.name ?? dataset.manifest.datasetId} ${level}`
    },
    zones
  };
}

function createEmptyDataset(metadata: DemoMetadata, level: DemoAdminLevel): TerritoryDataset {
  return {
    manifest: {
      datasetId: metadata.datasetId,
      datasetVersion: metadata.datasetVersion,
      schemaVersion: "territory-schema@1",
      sourceDate: "runtime-empty",
      geometryHash: "runtime-empty",
      adminLevels: [level],
      license: metadata.license.id,
      attribution: metadata.license.attribution,
      sourceProvider: metadata.sourceProvider
    },
    zones: []
  };
}

function createEngines(datasets: LoadedDatasetByLevel): EngineByLevel {
  return Object.fromEntries(
    Object.entries(datasets).map(([level, dataset]) => [
      level,
      createTerritoryEngine({ dataset: toEngineDataset(dataset) })
    ])
  ) as EngineByLevel;
}

function toEngineDataset(dataset: TerritoryDataset): TerritoryDataset {
  return loadTerritoryDataset({
    ...dataset,
    zones: dataset.zones.map((zone) => {
      const { childIds: _childIds, parentId: _parentId, ...standaloneZone } = zone;
      return standaloneZone;
    })
  });
}

function readChildren(zone: TerritoryZone, zonesById: Map<string, TerritoryZone>): TerritoryZone[] {
  const childIds = zone.childIds ?? [];
  const explicitChildren = childIds.flatMap((childId) => {
    const child = zonesById.get(childId);
    return child ? [child] : [];
  });

  if (explicitChildren.length > 0) {
    return explicitChildren.sort(compareZones);
  }

  return [...zonesById.values()]
    .filter((candidate) => candidate.parentId === zone.id)
    .sort(compareZones);
}

function readNeighbors(
  zone: TerritoryZone,
  zonesById: Map<string, TerritoryZone>
): TerritoryZone[] {
  return (zone.neighborIds ?? [])
    .flatMap((neighborId) => {
      const neighbor = zonesById.get(neighborId);
      return neighbor ? [neighbor] : [];
    })
    .sort(compareZones);
}

function toSearchResult(zone: TerritoryZone): TerritorySearchResult {
  const level = `ADM${zone.level}` as DemoAdminLevel;

  return {
    id: zone.id,
    name: displayZoneName(zone),
    level,
    ...(zone.parentId ? { parentId: zone.parentId } : {})
  };
}

function matchesSearch(zone: TerritoryZone, normalizedQuery: string): boolean {
  const haystack = normalizeSearchText(
    [zone.id, zone.name, zone.localName, zone.properties.name].filter(Boolean).join(" ")
  );

  return haystack.includes(normalizedQuery);
}

function compareSearchRank(
  left: TerritoryZone,
  right: TerritoryZone,
  normalizedQuery: string
): number {
  const leftName = normalizeSearchText(displayZoneName(left));
  const rightName = normalizeSearchText(displayZoneName(right));
  const leftStarts = leftName.startsWith(normalizedQuery) ? 0 : 1;
  const rightStarts = rightName.startsWith(normalizedQuery) ? 0 : 1;

  return leftStarts - rightStarts || left.level - right.level || compareZones(left, right);
}

function compareZones(left: TerritoryZone, right: TerritoryZone): number {
  return (
    displayZoneName(left).localeCompare(displayZoneName(right), "tr") ||
    left.id.localeCompare(right.id)
  );
}

function displayZoneName(zone: TerritoryZone): string {
  return zone.localName ?? zone.name ?? String(zone.properties.name ?? zone.id);
}

function normalizeSearchText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("tr")
    .trim();
}

function readLevelFromDatasetPath(path: string | undefined): TerritoryAdminLevel | undefined {
  const match = /^levels\/(ADM[0-5])\/dataset\.json$/.exec(path ?? "");
  const level = match?.[1] as TerritoryAdminLevel | undefined;
  return level && QUERY_LEVELS.includes(level) ? level : undefined;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Territory query request was cancelled.", "AbortError");
  }
}

export function adm3ParentHint(details: TerritoryDetails | undefined): string | undefined {
  if (!details) {
    return undefined;
  }

  if (details.zone.level === 2) {
    return details.zone.id;
  }

  if (details.zone.level === 3) {
    return details.zone.parentId;
  }

  return undefined;
}

export function relatedNavigationLevel(
  details: TerritoryDetails,
  direction: "parent" | "child"
): DemoAdminLevel | undefined {
  const level = `ADM${details.zone.level}` as DemoAdminLevel;
  return direction === "parent" ? parentDemoLevel(level) : childDemoLevel(level);
}
