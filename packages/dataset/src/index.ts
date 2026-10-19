export { createTerritoryDatasetFromGeoJson, loadTerritoryDatasetFromGeoJson } from "./geojson.js";
export {
  canonicalizeTerritoryGeometry,
  computeGeometryBBox,
  computeGeometryCenter,
  computeTerritoryAreaM2,
  computeTerritoryRepresentativePoint,
  createTerritoryGeometryVersion,
  geometryToPolygons,
  hasRingSelfIntersection,
  pointIntersectsGeometry
} from "./geometry.js";
export {
  SETTLEMENT_ASSOCIATION_METHODS,
  SETTLEMENT_ASSOCIATION_STATUSES,
  SETTLEMENT_GEOMETRY_AVAILABILITY,
  SETTLEMENT_IDENTITY_LAYER_SCHEMA_VERSION,
  SETTLEMENT_LOCALITY_TYPES,
  SETTLEMENT_PERMISSION_STATUSES,
  SETTLEMENT_POLYGON_EVIDENCE_STATES,
  SETTLEMENT_SOURCE_LOCK_STATES,
  SETTLEMENT_CONSUMER_NAME_SEMANTICS,
  SETTLEMENT_VERIFICATION_STATES,
  buildSettlementIdentityLayer,
  computeSettlementIdentityLayerContentChecksum,
  createSettlementIdFromSeed,
  dedupeSettlementSeeds,
  normalizeTurkishSettlementName,
  resolveSettlementGeometryAvailability,
  settlementHasLawfulPolygonEvidence
} from "./settlement-identity.js";
export {
  MAHALLE_HUMAN_REVIEW_DECISION_ENTRY_SCHEMA_VERSION,
  MAHALLE_HUMAN_REVIEW_DECISION_LEDGER_SCHEMA_VERSION,
  MAHALLE_HUMAN_REVIEW_DECISION_STATES,
  MAHALLE_HUMAN_REVIEW_QUEUE_SCHEMA_VERSION,
  MAHALLE_HUMAN_REVIEW_VALIDATION_CODES,
  appendMahalleHumanReviewDecisionHistory,
  buildMahalleHumanReviewContextPin,
  compareMahalleHumanReviewPins,
  computeMahalleHumanReviewRecordId,
  countAttributedHumanReviewDecisions,
  countMahalleHumanReviewDecisionStates,
  createPendingMahalleHumanReviewDecisionEntry,
  resolveMahalleReviewAutoDisplayNameAllowed,
  validateMahalleHumanReviewDecisionLedger,
  validateMahalleHumanReviewDecisionSubmission,
  type MahalleHumanReviewContextPin,
  type MahalleHumanReviewDecisionEntry,
  type MahalleHumanReviewDecisionHistoryEntry,
  type MahalleHumanReviewDecisionLedger,
  type MahalleHumanReviewDecisionState,
  type MahalleHumanReviewQueueRecord,
  type MahalleHumanReviewReviewer,
  type MahalleHumanReviewValidationIssue
} from "./mahalle-human-review.js";
export {
  SETTLEMENT_IDENTITY_VALIDATION_CODES,
  collectGameplayAdm3Zones,
  computeSettlementIdentityGeometryHashSetSha256,
  computeSettlementIdentityZoneIdSetSha256,
  validateSettlementIdentityLayer,
  type SettlementIdentityPinExpectations,
  type SettlementIdentityValidationIssue,
  type SettlementIdentityValidationReport
} from "./settlement-identity-validation.js";
export {
  applyTerritoryAdjacencyOverrides,
  canonicalTerritoryAdjacencyPair,
  classifyTerritoryGeometryRelation,
  compareTerritoryAdjacencyEdges,
  computeSharedBoundaryMeters,
  computeTerritoryAdjacencyContentHash,
  createTerritoryAdjacencyIndex,
  createTerritoryAdjacencyTolerance,
  getTerritoryBoundarySegments,
  normalizeTerritoryAdjacencyEdge,
  normalizeTerritoryAdjacencyEdges,
  validateTerritoryAdjacencyArtifact
} from "./adjacency.js";
export {
  BASIC_GEOMETRY_QUALITY_CHECKS,
  FULL_GEOMETRY_QUALITY_CHECKS,
  hashTerritoryGeometry,
  normalizeGeometryQualityChecks,
  repairGeometryDataset,
  typescriptGeometryQualityBackend,
  validateGeometryDataset
} from "./quality.js";
export {
  TERRITORY_ERROR_CODES,
  TerritoryDatasetValidationError,
  TerritoryError,
  deserializeTerritoryError,
  isTerritoryError,
  serializeTerritoryError
} from "./errors.js";
export {
  TERRITORY_ADMIN_LEVELS,
  TERRITORY_BOUNDARY_CONFIDENCES,
  TERRITORY_BOUNDARY_KINDS,
  TERRITORY_BOUNDARY_SOURCE_CLASSES,
  TERRITORY_COVERAGE_STATUSES,
  TERRITORY_GEOMETRY_DETAIL_LEVELS,
  TERRITORY_LICENSE_STATES,
  TERRITORY_SOURCE_CLASSES,
  TERRITORY_SEMANTIC_REVIEW_STATUSES,
  TERRITORY_SEMANTIC_ADMIN_TYPES,
  compareAdminLevels,
  createTerritoryGlobalId,
  getAdminLevelDepth,
  getChildAdminLevel,
  getParentAdminLevel,
  isTerritoryAdminLevel,
  normalizeTerritoryAdminLevel,
  normalizeTerritoryCountryCode,
  slugifyTerritoryIdPart,
  validateGlobalDatasetManifest,
  validateTerritoryGlobalId,
  validateTerritoryGlobalMetadata
} from "./global.js";
export { TERRITORY_SCHEMA_VERSION, territoryDatasetJsonSchema } from "./schema.js";
export {
  TERRITORY_DATASET_DIFF_SCHEMA_VERSION,
  TERRITORY_DIFF_CATEGORIES,
  TERRITORY_MIGRATION_PLAN_SCHEMA_VERSION,
  createMigrationPlan,
  diffDatasets,
  diffIdentities,
  territoryDatasetDiffJsonSchema,
  territoryMigrationPlanJsonSchema,
  validateMigrationPlan
} from "./diff.js";
export {
  assertValidTerritoryDataset,
  loadTerritoryDataset,
  validateTerritoryDataset
} from "./validation.js";
export {
  DEFAULT_TERRITORY_RENDER_LEVEL_POLICY,
  createTerritoryQueryArtifact,
  createTerritoryRenderArtifactManifest,
  createTerritoryRenderFeatureCollection,
  normalizeRenderPolicies,
  validateTerritoryQueryRenderCompatibility,
  zoneToAdminLevel
} from "./artifacts.js";
export type {
  TerritoryAdjacencyArtifact,
  TerritoryAdjacencyBuildOptions,
  TerritoryAdjacencyBuildStatistics,
  TerritoryAdjacencyEdge,
  TerritoryAdjacencyIndex,
  TerritoryAdjacencyOverrides,
  TerritoryAdjacencyPair,
  TerritoryAdjacencyProgress,
  TerritoryAdjacencyQueryOptions,
  TerritoryAdjacencySource,
  TerritoryAdjacencyTolerance,
  TerritoryAdjacencyType,
  TerritoryAdjacencyValidationCode,
  TerritoryAdjacencyValidationIssue,
  TerritoryAdjacencyValidationReport,
  TerritoryAdjacencyValidationSeverity,
  TerritoryBoundarySegment,
  TerritoryGeometryRelation,
  TerritoryGeometryRelationOptions,
  TerritoryGeometryRelationResult,
  TerritoryManualAdjacencyAdd,
  TerritoryManualAdjacencyRemove
} from "./adjacency.js";
export type { TerritoryPointBoundaryMode } from "./geometry.js";
export type {
  BuildSettlementIdentityLayerOptions,
  GameplayTerritoryAssociation,
  SettlementAssociationEvidence,
  SettlementAssociationMethod,
  SettlementAssociationStatus,
  SettlementGeometryAvailability,
  SettlementIdentity,
  SettlementIdentityLayer,
  SettlementIdentitySeedInput,
  SettlementIdentitySourceProvenance,
  SettlementIdentityZoneSummary,
  SettlementLocalityType,
  SettlementPermissionStatus,
  SettlementVerificationState
} from "./settlement-identity.js";
export type {
  TerritoryAdminLevel,
  LngLat,
  TerritoryBBox,
  TerritoryBoundaryConfidence,
  TerritoryBoundaryKind,
  TerritoryBoundarySourceClass,
  TerritoryCoverageStatus,
  TerritoryCodes,
  TerritoryDataset,
  TerritoryDatasetCompatibility,
  TerritoryDatasetManifest,
  TerritoryGeoJsonImportOptions,
  TerritoryGeometry,
  TerritoryGeometryDetailLevel,
  TerritoryGlobalDatasetManifest,
  TerritoryGlobalMetadata,
  TerritoryLicenseState,
  TerritoryNames,
  TerritorySchemaVersion,
  TerritorySemanticAdminType,
  TerritorySemanticReviewStatus,
  TerritoryGeneratedZoneMetadata,
  TerritorySourceClass,
  TerritorySourceMetadata,
  TerritoryValidationCode,
  TerritoryValidationIssue,
  TerritoryValidationResult,
  TerritoryValidationSeverity,
  TerritoryZone
} from "./types.js";
export type {
  SerializedTerritoryError,
  SerializedTerritoryErrorCause,
  TerritoryErrorCode,
  TerritoryErrorDetails,
  TerritoryErrorDetailValue,
  TerritoryErrorOptions
} from "./errors.js";
export type {
  TerritoryQueryArtifact,
  TerritoryQueryRenderCompatibilityIssue,
  TerritoryQueryRenderCompatibilityResult,
  TerritoryRenderArtifactManifest,
  TerritoryRenderFeatureProperties,
  TerritoryRenderLayerManifest,
  TerritoryRenderLevelPolicy
} from "./artifacts.js";
export type {
  TerritoryGlobalIdParts,
  TerritoryGlobalValidationIssue,
  TerritoryGlobalValidationResult
} from "./global.js";
export type {
  GeometryQualityBackend,
  GeometryQualityBackendId,
  GeometryQualityCheckName,
  GeometryQualityCheckPreset,
  GeometryQualityChecks,
  GeometryQualityIssue,
  GeometryQualityIssueCode,
  GeometryQualityMode,
  GeometryQualityOptions,
  GeometryQualityPerformance,
  GeometryQualityReport,
  GeometryQualitySeverity,
  GeometryQualitySummary,
  GeometryRepairDatasetResult,
  GeometryRepairOperation,
  GeometryRepairOperationType,
  GeometryRepairOptions,
  GeometryRepairRecord,
  GeometryRepairStrategy,
  GeometryRepairSummary,
  NormalizedGeometryQualityChecks
} from "./quality.js";
export type {
  TerritoryBreakingChange,
  TerritoryCoverageChangeReport,
  TerritoryCoverageCountChange,
  TerritoryCoverageSetChange,
  TerritoryDatasetDiffReport,
  TerritoryDatasetDiffSummary,
  TerritoryDatasetMigrationPlan,
  TerritoryDatasetRef,
  TerritoryDiffCandidateSignal,
  TerritoryDiffCategory,
  TerritoryDiffChange,
  TerritoryDiffMatch,
  TerritoryDiffMatchStrategy,
  TerritoryDiffOptions,
  TerritoryDiffPerformanceReport,
  TerritoryGeometryDiffSignals,
  TerritoryMigrationMapping,
  TerritoryMigrationMappingType,
  TerritoryMigrationPlanValidationIssue,
  TerritoryMigrationPlanValidationResult,
  TerritoryMigrationReviewItem
} from "./diff.js";
