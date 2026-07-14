export { buildAllTerritoryCountryDatasets } from "./build-all.js";
export { buildTerritoryCoverageRegistryFromArtifacts } from "./coverage.js";
export {
  buildTerritoryCountryDataset,
  buildTerritoryCountryDatasetPath,
  inspectTerritoryCountryDatasetPath,
  validateTerritoryCountryDatasetPath
} from "./builder.js";
export {
  applyHierarchyResolutions,
  attachChildIds,
  resolveTerritoryCountryHierarchy
} from "./hierarchy.js";
export {
  compareTerritoryIdentityMaps,
  createTerritoryCountryIdentity,
  summarizeIdentityStability,
  validateTerritoryIdentityMap
} from "./identity.js";
export {
  getTerritoryCountryConfig,
  hasTerritoryCountryConfig,
  listTerritoryCountryConfigs
} from "./registry.js";
export { ISO_3166_COUNTRIES, getIso3166CountryEntry } from "./iso3166.js";
export type { TerritoryIsoCountryEntry } from "./iso3166.js";
export {
  acquireBoundarySourceArtifact,
  computeTerritoryCountrySourceLockHash,
  createTerritoryCountrySourceLock,
  readTerritoryCountrySourceLockPath,
  validateTerritoryCountrySourceLock,
  verifyTerritoryCountrySourceLock
} from "./source-lock.js";
export { resolveTerritoryBoundarySource } from "./source-resolver.js";
export type {
  BuiltCountryZone,
  ParsedCountryFeature,
  TerritoryArtifactStatus,
  TerritoryCountryAdjacencyPolicy,
  TerritoryCountryBuildAllCountryResult,
  TerritoryCountryBuildAllLevelResult,
  TerritoryCountryBuildAllOptions,
  TerritoryCountryBuildAllOutcome,
  TerritoryCountryBuildAllReport,
  TerritoryCountryBuildIssue,
  TerritoryCountryBuildOptions,
  TerritoryCountryBuildReport,
  TerritoryCountryBuildResult,
  TerritoryCountryBuildStatistics,
  TerritoryCountryDatasetConfig,
  TerritoryCountryDatasetManifest,
  TerritoryCountryInspectSummary,
  TerritoryCountryLevelConfig,
  TerritoryCountryLicensePolicy,
  TerritoryCountryQualityPolicy,
  TerritoryCountryQualityReport,
  TerritoryCountrySourceLock,
  TerritoryCountrySourceLockLevel,
  TerritoryCountryValidateResult,
  TerritoryHierarchyIssue,
  TerritoryHierarchyReport,
  TerritoryHierarchyResolution,
  TerritoryHierarchyStrategyConfig,
  TerritoryIdentityDiff,
  TerritoryIdentityMap,
  TerritoryIdentityMapEntry,
  TerritoryIdentityStability,
  TerritoryResolvedBoundarySource,
  TerritorySourceLockCreateOptions
} from "./types.js";
