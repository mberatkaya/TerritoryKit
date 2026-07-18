/**
 * @deprecated Import registry APIs from `@territory-kit/registry` for new code.
 * This compatibility entrypoint remains for the current major line while runtime
 * and registry responsibilities move out of `@territory-kit/core`.
 */
export { createTerritoryRegistryClient } from "@territory-kit/registry";

export type {
  TerritoryDatasetRegistry,
  TerritoryInstalledDatasetHandle,
  TerritoryInstalledDatasetSummary,
  TerritoryRegistryArtifact,
  TerritoryRegistryArtifactFormat,
  TerritoryRegistryArtifactPurpose,
  TerritoryRegistryCache,
  TerritoryRegistryClient,
  TerritoryRegistryClientOptions,
  TerritoryRegistryDataset,
  TerritoryRegistryInstallOptions,
  TerritoryRegistryResolveDeepestAvailableTerritoryArtifactOptions,
  TerritoryRegistryResolveArtifactOptions,
  TerritoryRegistryResolvedTerritoryArtifact,
  TerritoryRegistryResolveTerritoryArtifactOptions,
  TerritoryRegistryResolvedArtifact,
  TerritoryRegistryTerritoryArtifactFallback,
  TerritoryRegistryTransport
} from "@territory-kit/registry";
