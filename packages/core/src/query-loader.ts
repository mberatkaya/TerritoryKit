import { loadTerritoryDataset } from "@territory-kit/dataset";
import type { TerritoryAdminLevel, TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";
import { createTerritoryEngine } from "./engine.js";
import type { LatLng, TerritoryEngine } from "./types.js";
import type {
  TerritoryInstalledDatasetArtifactResolver,
  TerritoryRegistryLike
} from "./country-loader.js";

export interface TerritoryQueryDatasetLoadOptions {
  registry: TerritoryRegistryLike;
  datasetId: string;
  levels?: readonly TerritoryAdminLevel[];
  detail?: string;
}

export interface TerritoryQueryDatasetHandle {
  datasetId: string;
  levels: readonly TerritoryAdminLevel[];
  datasets: Partial<Record<TerritoryAdminLevel, TerritoryDataset>>;
  getZoneById(id: string): TerritoryZone | undefined;
  latLngToZone(coordinate: LatLng, options?: { level?: number }): string | null;
  getParent(zoneId: string): TerritoryZone | undefined;
  getChildren(zoneId: string): TerritoryZone[];
}

export async function loadTerritoryQueryDataset(
  options: TerritoryQueryDatasetLoadOptions
): Promise<TerritoryQueryDatasetHandle> {
  const installed = await options.registry.installDataset({
    datasetId: options.datasetId,
    ...(options.levels ? { levels: options.levels } : {}),
    ...(options.detail ? { detail: options.detail } : {})
  });
  assertInstalledDatasetHandle(installed);
  const datasets: Partial<Record<TerritoryAdminLevel, TerritoryDataset>> = {};
  const engines: Partial<Record<TerritoryAdminLevel, TerritoryEngine>> = {};
  const zoneById = new Map<string, TerritoryZone>();

  for (const artifact of installed.installedArtifacts) {
    const path = artifact.artifact.path;

    if (!path?.startsWith("levels/") || !path.endsWith("/dataset.json")) {
      continue;
    }

    const level = path.split("/")[1] as TerritoryAdminLevel | undefined;

    if (!level) {
      continue;
    }

    const dataset = loadTerritoryDataset(JSON.parse(await installed.readText(path)) as unknown);
    datasets[level] = dataset;
    engines[level] = createTerritoryEngine({ dataset });

    for (const zone of dataset.zones) {
      zoneById.set(zone.id, zone);
    }
  }

  const levels = Object.keys(datasets).sort(compareAdminLevels) as TerritoryAdminLevel[];

  return {
    datasetId: options.datasetId,
    levels,
    datasets,
    getZoneById(id) {
      return zoneById.get(id);
    },
    latLngToZone(coordinate, locateOptions) {
      const level = locateOptions?.level;
      const candidateLevels =
        level === undefined
          ? [...levels].reverse()
          : levels.filter((item) => Number(item.slice(3)) === level);

      for (const candidateLevel of candidateLevels) {
        const engine = engines[candidateLevel];
        const match = engine?.latLngToZone(coordinate, locateOptions);

        if (match) {
          return match;
        }
      }

      return null;
    },
    getParent(zoneId) {
      const zone = zoneById.get(zoneId);
      return zone?.parentId ? zoneById.get(zone.parentId) : undefined;
    },
    getChildren(zoneId) {
      const zone = zoneById.get(zoneId);

      if (zone?.childIds) {
        return zone.childIds.flatMap((childId) => {
          const child = zoneById.get(childId);
          return child ? [child] : [];
        });
      }

      return [...zoneById.values()].filter((candidate) => candidate.parentId === zoneId);
    }
  };
}

function compareAdminLevels(left: string, right: string): number {
  return Number(left.slice(3)) - Number(right.slice(3));
}

function assertInstalledDatasetHandle(
  input: TerritoryInstalledDatasetArtifactResolver
): asserts input is TerritoryInstalledDatasetArtifactResolver & {
  installedArtifacts: ReadonlyArray<{ artifact: { path?: string } }>;
  readText(path: string): Promise<string>;
} {
  if (!input.installedArtifacts || !input.readText) {
    throw new Error("Registry query loading requires an installed dataset handle.");
  }
}
