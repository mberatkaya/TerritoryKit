import { createTerritoryEngine } from "@territory-kit/core";
import { loadTerritoryDataset } from "@territory-kit/dataset";
import type { TerritoryAdminLevel, TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";
import { turkeyNationalCoverage } from "@territory-kit/data-tr";
import type {
  TerritoryRegistryClient,
  TerritoryRegistryDataset,
  TerritoryRegistryResolvedTerritoryArtifact
} from "@territory-kit/registry";
import {
  resolveTurkeyV2Boundaries,
  validateTurkeyV2DeliveryManifest,
  type TurkeyV2DeliveryIndex
} from "@territory-kit/runtime/turkey-v2-delivery";
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
  deliveryManifestUrl?: string;
  deliveryManifestHash?: string;
}): TerritoryQueryService {
  const datasets: LoadedDatasetByLevel = {};
  const engines: EngineByLevel = {};
  const zonesById = new Map<string, TerritoryZone>();
  let artifactCount = 0;
  const loadedDistricts = new Set<string>();
  let deliveryManifest: TurkeyV2DeliveryIndex | undefined;

  async function ensureDeliveryManifest(
    signal: AbortSignal | undefined
  ): Promise<TurkeyV2DeliveryIndex> {
    if (deliveryManifest) return deliveryManifest;
    const url = input.deliveryManifestUrl;
    if (!url) throw new Error("Delivery manifest URL is not configured.");
    const bytes = await fetchBoundedBytes(url, 5_000_000, signal);
    const manifest = JSON.parse(new TextDecoder().decode(bytes)) as TurkeyV2DeliveryIndex;
    await validateTurkeyV2DeliveryManifest(manifest, input.deliveryManifestHash);
    if (
      manifest.datasetId !== input.datasetId ||
      (input.datasetVersionPinned && manifest.datasetVersion !== input.datasetVersion)
    ) {
      throw new Error("Delivery manifest dataset identity mismatch.");
    }
    assertNotAborted(signal);
    deliveryManifest = manifest;
    return manifest;
  }

  async function ensureDistrict(parentId: string, signal: AbortSignal | undefined): Promise<void> {
    if (loadedDistricts.has(parentId)) return;
    assertNotAborted(signal);
    if (input.deliveryManifestUrl) {
      const manifest = await ensureDeliveryManifest(signal);
      const resolved = await resolveTurkeyV2Boundaries({
        manifest,
        adm2Id: parentId,
        allowEstimated: true,
        ...(input.deliveryManifestHash
          ? { expectedManifestContentHash: input.deliveryManifestHash }
          : {}),
        maxShardBytes: 16_000_000,
        loadShard: (path) =>
          fetchBoundedBytes(new URL(path, input.deliveryManifestUrl).href, 16_000_000, signal)
      });
      assertNotAborted(signal);
      for (const zone of resolved.features) zonesById.set(zone.id, zone);
      loadedDistricts.add(parentId);
      artifactCount += 1;
      return;
    }
    const resolved = await input.registry.resolveTerritoryArtifact({
      country: "TR",
      level: "ADM3",
      parentId,
      purpose: "query",
      fallback: "none",
      version: input.datasetVersion,
      allowPrerelease: input.allowPrerelease,
      formatPreference: ["territory-json"]
    });
    const artifact = resolved.artifact;
    if (resolved.dataset.id !== input.datasetId)
      throw new Error("District shard dataset mismatch.");
    if (
      !/^districts\/[^/]+\/dataset\.json$/.test(artifact.path ?? "") ||
      !Array.isArray(artifact.coveredParentIds) ||
      !artifact.coveredParentIds.includes(parentId) ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
      artifact.sizeBytes > 16_000_000
    ) {
      throw new Error("ADM3 query requires a checksum-verified district shard.");
    }
    const dataset = await fetchVerifiedRegistryDataset(resolved, signal);
    if (
      dataset.manifest.datasetVersion !== resolved.dataset.version ||
      dataset.zones.some((zone) => zone.level === 3 && zone.parentId !== parentId)
    ) {
      throw new Error("District shard identity mismatch.");
    }
    for (const zone of dataset.zones.filter((candidate) => candidate.level === 3)) {
      const territory = zone.properties.territory as Record<string, unknown> | undefined;
      if (
        !territory ||
        !["administrative", "estimated"].includes(String(territory.boundaryKind)) ||
        !["official-national", "official-local", "osm-administrative", "smart-derived"].includes(
          String(territory.boundarySourceClass)
        ) ||
        !["official", "osm", "generated"].includes(String(territory.sourceClass)) ||
        !["authoritative", "high", "medium", "low"].includes(String(territory.confidence)) ||
        ((territory.boundaryKind === "estimated" ||
          territory.boundarySourceClass === "smart-derived") &&
          (territory.administrative === true || territory.authoritative === true)) ||
        (territory.authoritative === true &&
          (territory.sourceClass !== "official" ||
            !["official-national", "official-local"].includes(
              String(territory.boundarySourceClass)
            ) ||
            territory.boundaryKind !== "administrative" ||
            territory.administrative !== true ||
            territory.confidence !== "authoritative"))
      ) {
        throw new Error("District shard boundary semantics are invalid.");
      }
    }
    assertNotAborted(signal);
    for (const zone of dataset.zones) zonesById.set(zone.id, zone);
    loadedDistricts.add(parentId);
    artifactCount += 1;
  }

  async function ensureLevels(
    levels: readonly TerritoryAdminLevel[],
    signal: AbortSignal | undefined
  ): Promise<void> {
    assertNotAborted(signal);
    const missing = [...new Set(levels)].filter((level) => level !== "ADM3" && !datasets[level]);

    if (missing.length === 0) {
      return;
    }

    for (const level of missing) {
      assertNotAborted(signal);
      const resolved = await input.registry.resolveTerritoryArtifact({
        country: "TR",
        level,
        purpose: "query",
        fallback: "none",
        version: input.datasetVersion,
        allowPrerelease: input.allowPrerelease,
        formatPreference: ["territory-json"]
      });
      if (resolved.dataset.id !== input.datasetId)
        throw new Error(`Registry ${level} dataset mismatch.`);
      if (
        resolved.artifact.path !== `levels/${level}/dataset.json` ||
        resolved.artifact.levels?.length !== 1 ||
        resolved.artifact.levels[0] !== level
      ) {
        throw new Error(`Registry ${level} query requires an exact level dataset artifact.`);
      }
      const dataset = await fetchVerifiedRegistryDataset(resolved, signal);
      if (
        dataset.manifest.datasetVersion !== resolved.dataset.version ||
        dataset.zones.some((zone) => zone.level !== Number(level.slice(3)))
      ) {
        throw new Error(`Registry ${level} query dataset identity mismatch.`);
      }
      assertNotAborted(signal);
      datasets[level] = dataset;
      engines[level] = createTerritoryEngine({ dataset: toEngineDataset(dataset) });
      artifactCount += 1;

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
    ensureLevels,
    ensureDistrict
  });
}

async function fetchVerifiedRegistryDataset(
  resolved: TerritoryRegistryResolvedTerritoryArtifact,
  signal: AbortSignal | undefined
): Promise<TerritoryDataset> {
  const artifact = resolved.artifact;
  const maxBytes = 16_000_000;
  if (
    artifact.format !== "territory-json" ||
    (artifact.compression && artifact.compression !== "none") ||
    !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
    artifact.sizeBytes > maxBytes ||
    artifact.sizeBytes < 1
  ) {
    throw new Error("Registry query artifact has invalid size, format, or checksum metadata.");
  }
  const response = await fetch(resolved.url, { ...(signal ? { signal } : {}) });
  if (!response.ok || !response.body)
    throw new Error(`Registry query artifact failed: HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > artifact.sizeBytes || total > maxBytes)
        throw new Error("Registry query artifact exceeds declared size.");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  assertNotAborted(signal);
  if (total !== artifact.sizeBytes) throw new Error("Registry query artifact size mismatch.");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  if (sha256 !== artifact.sha256) throw new Error("Registry query artifact checksum mismatch.");
  assertNotAborted(signal);
  const dataset = JSON.parse(new TextDecoder().decode(bytes)) as TerritoryDataset;
  // A scoped level or district shard can legitimately reference parents outside the shard.
  toEngineDataset(dataset);
  return dataset;
}

async function fetchBoundedBytes(
  url: string,
  maxBytes: number,
  signal: AbortSignal | undefined
): Promise<Uint8Array> {
  const response = await fetch(url, { ...(signal ? { signal } : {}) });
  if (!response.ok || !response.body)
    throw new Error(`Delivery artifact failed: HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("Delivery artifact exceeds size limit.");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  assertNotAborted(signal);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
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
      ADM0: input.dataset.levels.includes("ADM0") ? "verified" : "unknown",
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
  ensureDistrict?: (parentId: string, signal: AbortSignal | undefined) => Promise<void>;
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
        .flatMap((level) =>
          level === "ADM3" && input.ensureDistrict
            ? [...input.zonesById.values()].filter((zone) => zone.level === 3)
            : (input.datasets[level]?.zones ?? [])
        )
        .filter((zone) => matchesSearch(zone, normalized))
        .sort((left, right) => compareSearchRank(left, right, normalized))
        .slice(0, options.limit)
        .map(toSearchResult);
    },
    async locate(coordinate, options) {
      const level = options.level;
      if (level === "ADM3" && input.ensureDistrict) {
        await ensureLevels(["ADM2"], options.signal);
        const districtId = input.engines.ADM2?.latLngToZone(coordinate, { level: 2 });
        if (!districtId) return undefined;
        await input.ensureDistrict(districtId, options.signal);
        const zones = [...input.zonesById.values()].filter(
          (zone) => zone.level === 3 && zone.parentId === districtId
        );
        const engine = createTerritoryEngine({
          dataset: toEngineDataset({
            ...createEmptyDataset(input.metadata, "ADM3"),
            zones
          })
        });
        const id = engine.latLngToZone(coordinate, { level: 3 });
        return id
          ? this.getTerritoryDetails(id, {
              level,
              parentId: districtId,
              ...(options.signal ? { signal: options.signal } : {})
            })
          : undefined;
      }
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
      const hintLevels =
        options.level === "ADM3"
          ? (["ADM2"] as const)
          : options.level
            ? [options.level]
            : (["ADM1", "ADM2"] as readonly TerritoryAdminLevel[]);

      await ensureLevels(hintLevels, options.signal);
      if (options.level === "ADM3" && options.parentId) {
        await input.ensureDistrict?.(options.parentId, options.signal);
      }

      let zone = readZone(territoryId);

      if (!zone) {
        await ensureLevels(["ADM0", "ADM1", "ADM2"], options.signal);
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
      if (zone.level === 2 && input.ensureDistrict) {
        try {
          await input.ensureDistrict(zone.id, options.signal);
        } catch (error) {
          if (options.signal?.aborted) throw error;
        }
      }

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
      const loadedLevels = QUERY_LEVELS.filter(
        (level) =>
          Boolean(input.datasets[level]) ||
          (level === "ADM3" && [...input.zonesById.values()].some((zone) => zone.level === 3))
      );
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
      ADM0: "verified",
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
      ADM0: "unknown",
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
