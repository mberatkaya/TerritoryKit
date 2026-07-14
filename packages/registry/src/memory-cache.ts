import type {
  TerritoryInstalledDatasetSummary,
  TerritoryRegistryArtifactCacheKey,
  TerritoryRegistryCache,
  TerritoryRegistryCachedArtifact,
  TerritoryRegistrySnapshot
} from "./types.js";

export function createMemoryTerritoryRegistryCache(): TerritoryRegistryCache {
  const artifacts = new Map<string, TerritoryRegistryCachedArtifact>();
  const snapshots = new Map<string, TerritoryRegistrySnapshot>();

  return {
    async getArtifact(key) {
      return artifacts.get(cacheKey(key));
    },

    async putArtifact(input) {
      const entry: TerritoryRegistryCachedArtifact = {
        key: input.key,
        artifact: input.artifact,
        metadata: input.metadata,
        bytes: input.decodedBytes ?? input.bytes
      };
      artifacts.set(cacheKey(input.key), entry);
      return entry;
    },

    async removeDataset(datasetId, version) {
      for (const [key, entry] of artifacts.entries()) {
        if (entry.key.datasetId === datasetId && (!version || entry.key.version === version)) {
          artifacts.delete(key);
        }
      }
    },

    async listInstalledDatasets() {
      const byDataset = new Map<string, TerritoryInstalledDatasetSummary>();

      for (const entry of artifacts.values()) {
        const key = `${entry.metadata.datasetId}@${entry.metadata.version}`;
        const previous = byDataset.get(key);
        byDataset.set(key, {
          datasetId: entry.metadata.datasetId,
          version: entry.metadata.version,
          artifactCount: (previous?.artifactCount ?? 0) + 1,
          installedAt: previous?.installedAt ?? entry.metadata.installedAt,
          verified: true,
          registryHash: entry.metadata.registryHash
        });
      }

      return [...byDataset.values()].sort((left, right) =>
        `${left.datasetId}@${left.version}`.localeCompare(`${right.datasetId}@${right.version}`)
      );
    },

    async writeRegistrySnapshot(snapshot) {
      snapshots.set(snapshot.registryUrl, snapshot);
    },

    async readRegistrySnapshot(registryUrl) {
      return snapshots.get(registryUrl);
    },

    async clear() {
      artifacts.clear();
      snapshots.clear();
    }
  };
}

function cacheKey(key: TerritoryRegistryArtifactCacheKey): string {
  return `${key.datasetId}/${key.version}/${key.artifactId}`;
}
