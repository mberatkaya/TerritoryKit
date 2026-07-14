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
  TerritoryCountryAdjacencyPolicy,
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
