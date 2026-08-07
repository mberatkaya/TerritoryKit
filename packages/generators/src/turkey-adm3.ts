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
