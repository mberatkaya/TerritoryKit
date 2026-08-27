export {
  TURKEY_ADM3_GAME_ZONE_ALGORITHM_VERSION,
  TURKEY_GAME_ZONE_CONFIGURATION_SCHEMA_VERSION,
  TURKEY_GAME_ZONE_QUALITY_SCHEMA_VERSION,
  buildTurkeyGameZones,
  buildTurkeyGameZonesWithAdjacency,
  createTurkeyGameZoneDataset,
  resolveTurkeyGameZoneConfiguration,
  validateTurkeyGameZoneGeneratorOptions
} from "./turkey-game-zones.js";
export {
  DEFAULT_TURKEY_SMART_FALLBACK_BARRIER_CONFIG,
  TURKEY_SMART_FALLBACK_ALGORITHM_VERSION,
  TURKEY_SMART_FALLBACK_CONFIGURATION_SCHEMA_VERSION,
  TURKEY_SMART_FALLBACK_MANIFEST_SCHEMA_VERSION,
  TURKEY_SMART_FALLBACK_QUALITY_SCHEMA_VERSION,
  buildTurkeySmartFallback,
  buildTurkeySmartFallbackWithAdjacency,
  createTurkeySmartFallbackDataset,
  normalizeTurkeySmartFallbackBarriers,
  resolveTurkeySmartFallbackConfiguration
} from "./turkey-smart-fallback.js";
export {
  TURKEY_V2_ADM3_STABLE_ID_STANDARD,
  createTurkeyV2Adm3StableKey,
  createTurkeyV2Adm3TerritoryId
} from "./turkey-adm3-ingestion.js";
export {
  TURKEY_ADM3_DEFAULT_PROVIDER_PRIORITY,
  TURKEY_ADM3_FALLBACK_SCHEMA_VERSION,
  TURKEY_ADM3_GENERATED_ALGORITHM_VERSION,
  TURKEY_ADM3_PROVIDER_CLASSES,
  TURKEY_ADM3_PROVIDER_REGISTRY_SCHEMA_VERSION,
  buildTurkeyAdm3EffectiveZones,
  buildTurkeyAdm3GeneratedZones,
  computeTurkeyAdm3DistrictCoverage,
  createDefaultGeneratedZoneConfig,
  createTurkeyAdm3GeneratedGeometryHash,
  createTurkeyAdm3GeneratedMigrationReport,
  createTurkeyAdm3GeometryHash,
  computeTurkeyAdm3GeometryAreaKm2,
  createTurkeyAdm3ProviderHealthReport,
  createTurkeyAdm3Registry,
  filterOsmAdministrativeBoundaryPolygons,
  inspectTurkeyAdm3SpatialQuality,
  resolveTurkeyAdm3Provider,
  validateTurkeyAdm3ProviderRegistry
} from "./turkey-adm3-full-coverage.js";
export {
  TURKEY_ADM3_OSM_ATTRIBUTION,
  TURKEY_ADM3_OSM_DOWNLOAD_URL,
  TURKEY_ADM3_OSM_LICENSE,
  TURKEY_ADM3_OSM_SOURCE_URL,
  createTurkeyAdm3OsmDataset,
  extractTurkeyAdm3OsmPbf
} from "./turkey-adm3-osm.js";
export {
  TURKEY_V2_HYBRID_ATTRIBUTION_SCHEMA_VERSION,
  TURKEY_V2_HYBRID_BATCH_SCHEMA_VERSION,
  TURKEY_V2_HYBRID_COVERAGE_SCHEMA_VERSION,
  TURKEY_V2_HYBRID_MIGRATION_SCHEMA_VERSION,
  TURKEY_V2_HYBRID_PROVENANCE_SCHEMA_VERSION,
  TURKEY_V2_HYBRID_QUALITY_SCHEMA_VERSION,
  TURKEY_V2_HYBRID_REJECTION_SCHEMA_VERSION,
  buildTurkeyV2HybridBatch,
  buildTurkeyV2HybridDistrict,
  createTurkeyV2ZoneMigrationPlan
} from "./turkey-v2-hybrid.js";
export {
  TURKEY_V2_ADM0_EXPECTED_COUNT,
  TURKEY_V2_ADM1_EXPECTED_COUNT,
  TURKEY_V2_ADM2_EXPECTED_COUNT,
  TURKEY_V2_NATIONAL_BUILD_SUMMARY_SCHEMA_VERSION,
  TURKEY_V2_NATIONAL_COVERAGE_SCHEMA_VERSION,
  TURKEY_V2_NATIONAL_DATASET_ID,
  TURKEY_V2_NATIONAL_DATASET_VERSION,
  TURKEY_V2_NATIONAL_HIERARCHY_SCHEMA_VERSION,
  TURKEY_V2_NATIONAL_PROVENANCE_SCHEMA_VERSION,
  TURKEY_V2_NATIONAL_QUALITY_SCHEMA_VERSION,
  TURKEY_V2_NATIONAL_REGISTRY_ENTRY_SCHEMA_VERSION,
  TURKEY_V2_NATIONAL_SOURCE_LOCK_SCHEMA_VERSION,
  buildTurkeyV2NationalDataset,
  createTurkeyV2NationalArtifactPayloads,
  createTurkeyV2NationalSourceLock
} from "./turkey-v2-national.js";
export {
  TURKEY_V2_NATIONAL_EXPECTED_COUNTS,
  computeFileSha256,
  validateTurkeyV2NationalArtifactIntegrity,
  validateTurkeyV2NationalCompleteness
} from "./turkey-v2-national-validation.js";
export type {
  ResolvedTurkeyGameZoneConfiguration,
  ResolvedTurkeyGameZoneProfile,
  TurkeyGameZoneBuildResult,
  TurkeyGameZoneConfigurationResolution,
  TurkeyGameZoneFragmentStrategy,
  TurkeyGameZoneGeneratorOptions,
  TurkeyGameZoneIssue,
  TurkeyGameZoneIssueCode,
  TurkeyGameZoneIssueSeverity,
  TurkeyGameZoneProfile,
  TurkeyGameZoneProfileDecision,
  TurkeyGameZoneQualityReport,
  TurkeyGameZoneUrbanityHint
} from "./turkey-game-zones.js";
export type {
  ResolvedTurkeySmartFallbackProfile,
  TurkeySmartFallbackBarrier,
  TurkeySmartFallbackBarrierClass,
  TurkeySmartFallbackBarrierConfig,
  TurkeySmartFallbackBarrierLayer,
  TurkeySmartFallbackBarrierStrengthClass,
  TurkeySmartFallbackBuildResult,
  TurkeySmartFallbackConfiguration,
  TurkeySmartFallbackInput,
  TurkeySmartFallbackIssue,
  TurkeySmartFallbackIssueCode,
  TurkeySmartFallbackLocalitySeed,
  TurkeySmartFallbackManifest,
  TurkeySmartFallbackOptions,
  TurkeySmartFallbackProfile,
  TurkeySmartFallbackQualityReport,
  TurkeySmartFallbackSourceMetadata,
  TurkeySmartFallbackSourceStrategy,
  TurkeySmartFallbackStatus,
  TurkeySmartFallbackZoneQuality
} from "./turkey-smart-fallback.js";
export type {
  TurkeyV2Adm3StableIdInput,
  TurkeyV2Adm3StableIdSourceClass
} from "./turkey-adm3-ingestion.js";
export type {
  GeneratedZoneConfig,
  ProviderHealth,
  TurkeyAdm3DefaultProviderClass,
  TurkeyAdm3DistrictCoverageReport,
  TurkeyAdm3DistrictFallbackRecord,
  TurkeyAdm3EffectiveZoneBuildOptions,
  TurkeyAdm3EffectiveZoneBuildResult,
  TurkeyAdm3FallbackRegistry,
  TurkeyAdm3GeneratedBuildOptions,
  TurkeyAdm3GeneratedBuildResult,
  TurkeyAdm3GeneratedMigrationReport,
  TurkeyAdm3ProviderClass,
  TurkeyAdm3ProviderFormat,
  TurkeyAdm3ProviderRecord,
  TurkeyAdm3ProviderRegistry,
  TurkeyAdm3RegistryIssue,
  TurkeyAdm3RegistryValidationResult,
  TurkeyAdm3ResolveOptions,
  TurkeyAdm3SpatialQualityOptions,
  TurkeyAdm3SpatialQualityReport
} from "./turkey-adm3-full-coverage.js";
export type {
  TurkeyAdm3OsmExtractOptions,
  TurkeyAdm3OsmExtractResult,
  TurkeyAdm3OsmParentConfidence,
  TurkeyAdm3OsmSemanticType
} from "./turkey-adm3-osm.js";
export type {
  TurkeyV2HybridAttributionManifest,
  TurkeyV2HybridBatchBuildOptions,
  TurkeyV2HybridBatchBuildResult,
  TurkeyV2HybridBatchCoverageSummary,
  TurkeyV2HybridBatchQualityReport,
  TurkeyV2HybridBatchSourceEntry,
  TurkeyV2HybridDistributionPolicyManifest,
  TurkeyV2HybridDistrictBuildOptions,
  TurkeyV2HybridDistrictBuildResult,
  TurkeyV2HybridGeneratedOptions,
  TurkeyV2HybridIssue,
  TurkeyV2HybridIssueSeverity,
  TurkeyV2HybridLicenseManifest,
  TurkeyV2HybridMigrationChangeType,
  TurkeyV2HybridProviderClass,
  TurkeyV2HybridProvenanceItem,
  TurkeyV2HybridProvenanceReport,
  TurkeyV2HybridQualityReport,
  TurkeyV2HybridRejectionReason,
  TurkeyV2HybridRejectionRecord,
  TurkeyV2HybridRejectionReport,
  TurkeyV2HybridSourceClass,
  TurkeyV2ZoneMigrationPlan,
  TurkeyV2ZoneMigrationRecord
} from "./turkey-v2-hybrid.js";
export type {
  TurkeyV2DistrictBuildOverride,
  TurkeyV2NationalAdmLevelLock,
  TurkeyV2NationalAdmSourceLock,
  TurkeyV2NationalArtifactPayloads,
  TurkeyV2NationalArtifactPlan,
  TurkeyV2NationalBuildMode,
  TurkeyV2NationalBuildOptions,
  TurkeyV2NationalBuildResult,
  TurkeyV2NationalChecksums,
  TurkeyV2NationalCoverageReport,
  TurkeyV2NationalDistrictCoverage,
  TurkeyV2NationalHierarchyReport,
  TurkeyV2NationalOsmSourceLock,
  TurkeyV2NationalOutputMode,
  TurkeyV2NationalProvenanceReport,
  TurkeyV2NationalProvinceCoverage,
  TurkeyV2NationalQualityReport,
  TurkeyV2NationalRealProviderLock,
  TurkeyV2NationalRealSourceLock,
  TurkeyV2NationalRegistryArtifact,
  TurkeyV2NationalRegistryEntry,
  TurkeyV2NationalSourceCatalog,
  TurkeyV2NationalSourceLock,
  TurkeyV2NationalSourceStatus,
  TurkeyV2NationalGeneratedSourceLock
} from "./turkey-v2-national.js";
export type {
  TurkeyV2NationalArtifactIntegrityErrorCode,
  TurkeyV2NationalCompletenessErrorCode,
  TurkeyV2NationalValidationErrorCode,
  TurkeyV2NationalValidationIssue,
  TurkeyV2NationalValidationResult
} from "./turkey-v2-national-validation.js";
