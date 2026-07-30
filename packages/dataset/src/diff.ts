import {
  computeGeometryBBox,
  computeGeometryCenter,
  geometryToPolygons,
  hasRingSelfIntersection
} from "./geometry.js";
import type {
  LngLat,
  TerritoryBBox,
  TerritoryDataset,
  TerritoryDatasetManifest,
  TerritoryGeometry,
  TerritoryZone
} from "./types.js";

export const TERRITORY_DATASET_DIFF_SCHEMA_VERSION = "territory-dataset-diff@1" as const;
export const TERRITORY_MIGRATION_PLAN_SCHEMA_VERSION = "territory-migration-plan@1" as const;

export const TERRITORY_DIFF_CATEGORIES = [
  "added",
  "removed",
  "unchanged",
  "renamed",
  "reparented",
  "geometry-changed",
  "metadata-changed",
  "split-candidate",
  "merge-candidate",
  "ambiguous-match",
  "stable-id-conflict",
  "hierarchy-invalid",
  "license-changed",
  "source-changed"
] as const;

export type TerritoryDiffCategory = (typeof TERRITORY_DIFF_CATEGORIES)[number];

export type TerritoryDiffMatchStrategy =
  | "stable-id"
  | "source-native-id"
  | "parent-normalized-name"
  | "geometry-similarity"
  | "manual-review";

export type TerritoryMigrationMappingType =
  | "unchanged"
  | "renamed"
  | "reparented"
  | "geometry-changed"
  | "metadata-changed"
  | "license-changed"
  | "source-changed";

export interface TerritoryDiffOptions {
  automaticConfidenceThreshold?: number;
  ambiguousConfidenceDelta?: number;
  geometryCandidateMinConfidence?: number;
  geometryChangedAreaPercent?: number;
  geometryChangedCentroidMeters?: number;
  geometryChangedMinIoU?: number;
  majorGeometryAreaPercent?: number;
  majorGeometryCentroidMeters?: number;
  majorGeometryMinIoU?: number;
  splitMergeMinOverlapRatio?: number;
  splitMergeMinCoverageRatio?: number;
  spatialPaddingRatio?: number;
  spatialMinPaddingDegrees?: number;
}

export interface TerritoryDatasetRef {
  datasetId: string;
  datasetVersion: string;
  geometryHash: string;
  sourceDate: string;
  adminLevels?: string[];
  countryCodes?: string[];
  license?: string;
  sourceProvider?: string;
}

export interface TerritoryZoneRef {
  id: string;
  level: number;
  bbox: TerritoryBBox;
  center: LngLat;
  countryCode?: string;
  localName?: string;
  name?: string;
  parentId?: string;
  sourceNativeIds: string[];
}

export interface TerritoryGeometryDiffSignals {
  areaChangePercent: number;
  bboxAreaChangePercent: number;
  bboxChanged: boolean;
  centroidDistanceMeters: number;
  geometryTypeChanged: boolean;
  intersectionOverUnion: number;
  newArea: number;
  newTopologyValid: boolean;
  newWithinParent: boolean | null;
  oldArea: number;
  oldTopologyValid: boolean;
  oldWithinParent: boolean | null;
}

export interface TerritoryDiffCandidateSignal {
  id: string;
  confidence: number;
  intersectionOverUnion: number;
  overlapRatioNew: number;
  overlapRatioOld: number;
}

export interface TerritoryDiffChange {
  id: string;
  category: TerritoryDiffCategory;
  breaking: boolean;
  confidence: number;
  reason: string;
  requiresReview: boolean;
  strategy: TerritoryDiffMatchStrategy;
  candidates?: TerritoryDiffCandidateSignal[];
  fields?: string[];
  newId?: string;
  newIds?: string[];
  newZone?: TerritoryZoneRef;
  oldId?: string;
  oldIds?: string[];
  oldZone?: TerritoryZoneRef;
  signals?: TerritoryGeometryDiffSignals;
}

export interface TerritoryDiffMatch {
  oldId: string;
  newId: string;
  categories: TerritoryDiffCategory[];
  confidence: number;
  requiresReview: boolean;
  strategy: TerritoryDiffMatchStrategy;
  signals?: TerritoryGeometryDiffSignals;
}

export interface TerritoryBreakingChange {
  code:
    | "REMOVED_ZONE"
    | "SPLIT_CANDIDATE"
    | "MERGE_CANDIDATE"
    | "AMBIGUOUS_MATCH"
    | "STABLE_ID_CONFLICT"
    | "HIERARCHY_INVALID"
    | "LICENSE_CHANGED"
    | "SOURCE_CHANGED"
    | "REPARENTED"
    | "ADM_LEVEL_CHANGED"
    | "GEOMETRY_MAJOR_CHANGE";
  message: string;
  newId?: string;
  oldId?: string;
  severity: "error" | "warning";
}

export interface TerritoryCoverageChangeReport {
  zoneCount: {
    old: number;
    new: number;
    delta: number;
    deltaPercent: number;
  };
  byCountry: TerritoryCoverageCountChange[];
  byLevel: TerritoryCoverageCountChange[];
  countryCodes: TerritoryCoverageSetChange;
  manifestAdminLevels: TerritoryCoverageSetChange;
}

export interface TerritoryCoverageCountChange {
  key: string;
  old: number;
  new: number;
  added: number;
  removed: number;
  delta: number;
}

export interface TerritoryCoverageSetChange {
  old: string[];
  new: string[];
  added: string[];
  removed: string[];
}

export interface TerritoryDiffPerformanceReport {
  candidatePairCount: number;
  duplicateStableIdCount: number;
  estimatedMemoryBytes: number;
  matchCountsByStrategy: Record<TerritoryDiffMatchStrategy, number>;
  newZoneCount: number;
  oldZoneCount: number;
  spatialCandidateCount: number;
  spatialQueryCount: number;
  streamingRecommended: boolean;
}

export interface TerritoryDatasetDiffSummary {
  automaticMigrationCount: number;
  breakingChangeCount: number;
  changedCount: number;
  countsByCategory: Record<TerritoryDiffCategory, number>;
  newZoneCount: number;
  oldZoneCount: number;
  requiresReviewCount: number;
  unchangedCount: number;
}

export interface TerritoryDatasetDiffReport {
  schemaVersion: typeof TERRITORY_DATASET_DIFF_SCHEMA_VERSION;
  fromDataset: TerritoryDatasetRef;
  toDataset: TerritoryDatasetRef;
  breakingChanges: TerritoryBreakingChange[];
  changes: TerritoryDiffChange[];
  coverageChangeReport: TerritoryCoverageChangeReport;
  matches: TerritoryDiffMatch[];
  performance: TerritoryDiffPerformanceReport;
  summary: TerritoryDatasetDiffSummary;
}

export interface TerritoryMigrationMapping {
  oldId: string;
  newId: string;
  type: TerritoryMigrationMappingType;
  confidence: number;
  requiresReview: boolean;
  categories: TerritoryDiffCategory[];
  strategy: TerritoryDiffMatchStrategy;
}

export interface TerritoryMigrationReviewItem {
  category: TerritoryDiffCategory;
  reason: string;
  confidence: number;
  newId?: string;
  newIds?: string[];
  oldId?: string;
  oldIds?: string[];
}

export interface TerritoryDatasetMigrationPlan {
  schemaVersion: typeof TERRITORY_MIGRATION_PLAN_SCHEMA_VERSION;
  fromDataset: TerritoryDatasetRef;
  toDataset: TerritoryDatasetRef;
  mappings: TerritoryMigrationMapping[];
  reviewItems: TerritoryMigrationReviewItem[];
  breakingChanges: TerritoryBreakingChange[];
  summary: {
    automaticMappingCount: number;
    breakingChangeCount: number;
    requiresReviewCount: number;
    totalMappingCount: number;
  };
}

export interface TerritoryMigrationPlanValidationIssue {
  code:
    | "PLAN_SCHEMA"
    | "DATASET_REF"
    | "MAPPING_FIELD"
    | "DUPLICATE_OLD_ID"
    | "DUPLICATE_NEW_ID"
    | "LOW_CONFIDENCE_AUTOMATION";
  message: string;
  path: string;
  severity: "error" | "warning";
}

export interface TerritoryMigrationPlanValidationResult {
  ok: boolean;
  issues: TerritoryMigrationPlanValidationIssue[];
  plan?: TerritoryDatasetMigrationPlan;
}

export const territoryDatasetDiffJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://territorykit.dev/schemas/territory-dataset-diff-1.json",
  title: "TerritoryKit Dataset Diff Report",
  type: "object",
  required: [
    "schemaVersion",
    "fromDataset",
    "toDataset",
    "summary",
    "changes",
    "matches",
    "breakingChanges",
    "coverageChangeReport",
    "performance"
  ],
  additionalProperties: false,
  properties: {
    schemaVersion: { const: TERRITORY_DATASET_DIFF_SCHEMA_VERSION },
    fromDataset: { $ref: "#/$defs/datasetRef" },
    toDataset: { $ref: "#/$defs/datasetRef" },
    summary: { type: "object" },
    changes: { type: "array" },
    matches: { type: "array" },
    breakingChanges: { type: "array" },
    coverageChangeReport: { type: "object" },
    performance: { type: "object" }
  },
  $defs: {
    datasetRef: {
      type: "object",
      required: ["datasetId", "datasetVersion", "geometryHash", "sourceDate"],
      additionalProperties: true,
      properties: {
        datasetId: { type: "string", minLength: 1 },
        datasetVersion: { type: "string", minLength: 1 },
        geometryHash: { type: "string", minLength: 1 },
        sourceDate: { type: "string", minLength: 1 }
      }
    }
  }
} as const;

export const territoryMigrationPlanJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://territorykit.dev/schemas/territory-migration-plan-1.json",
  title: "TerritoryKit Dataset Migration Plan",
  type: "object",
  required: [
    "schemaVersion",
    "fromDataset",
    "toDataset",
    "mappings",
    "reviewItems",
    "breakingChanges",
    "summary"
  ],
  additionalProperties: false,
  properties: {
    schemaVersion: { const: TERRITORY_MIGRATION_PLAN_SCHEMA_VERSION },
    fromDataset: { $ref: "#/$defs/datasetRef" },
    toDataset: { $ref: "#/$defs/datasetRef" },
    mappings: {
      type: "array",
      items: {
        type: "object",
        required: [
          "oldId",
          "newId",
          "type",
          "confidence",
          "requiresReview",
          "categories",
          "strategy"
        ],
        additionalProperties: false,
        properties: {
          oldId: { type: "string", minLength: 1 },
          newId: { type: "string", minLength: 1 },
          type: {
            enum: [
              "unchanged",
              "renamed",
              "reparented",
              "geometry-changed",
              "metadata-changed",
              "license-changed",
              "source-changed"
            ]
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          requiresReview: { type: "boolean" },
          categories: {
            type: "array",
            items: { enum: TERRITORY_DIFF_CATEGORIES }
          },
          strategy: {
            enum: [
              "stable-id",
              "source-native-id",
              "parent-normalized-name",
              "geometry-similarity",
              "manual-review"
            ]
          }
        }
      }
    },
    reviewItems: { type: "array" },
    breakingChanges: { type: "array" },
    summary: { type: "object" }
  },
  $defs: {
    datasetRef: {
      type: "object",
      required: ["datasetId", "datasetVersion", "geometryHash", "sourceDate"],
      additionalProperties: true,
      properties: {
        datasetId: { type: "string", minLength: 1 },
        datasetVersion: { type: "string", minLength: 1 },
        geometryHash: { type: "string", minLength: 1 },
        sourceDate: { type: "string", minLength: 1 }
      }
    }
  }
} as const;

interface NormalizedDiffOptions {
  automaticConfidenceThreshold: number;
  ambiguousConfidenceDelta: number;
  geometryCandidateMinConfidence: number;
  geometryChangedAreaPercent: number;
  geometryChangedCentroidMeters: number;
  geometryChangedMinIoU: number;
  majorGeometryAreaPercent: number;
  majorGeometryCentroidMeters: number;
  majorGeometryMinIoU: number;
  splitMergeMinOverlapRatio: number;
  splitMergeMinCoverageRatio: number;
  spatialPaddingRatio: number;
  spatialMinPaddingDegrees: number;
}

interface PreparedDataset {
  dataset: TerritoryDataset;
  duplicateIds: Map<string, ZoneSnapshot[]>;
  snapshots: ZoneSnapshot[];
  snapshotsByUniqueId: Map<string, ZoneSnapshot>;
  sourceKeyIndex: Map<string, ZoneSnapshot[]>;
  nameKeyIndex: Map<string, ZoneSnapshot[]>;
  spatialIndex: ZoneSnapshot[];
}

interface ZoneSnapshot {
  key: string;
  index: number;
  zone: TerritoryZone;
  area: number;
  bbox: TerritoryBBox;
  center: LngLat;
  names: string[];
  normalizedNames: string[];
  sourceNativeIds: string[];
  topologyValid: boolean;
}

interface InternalMatch {
  oldZone: ZoneSnapshot;
  newZone: ZoneSnapshot;
  confidence: number;
  requiresReview: boolean;
  strategy: TerritoryDiffMatchStrategy;
  categories: TerritoryDiffCategory[];
  signals?: TerritoryGeometryDiffSignals;
}

interface MatchingState {
  ambiguousKeys: Set<string>;
  blockedOldKeys: Set<string>;
  blockedNewKeys: Set<string>;
  candidatePairCount: number;
  matches: InternalMatch[];
  matchedNewKeys: Set<string>;
  matchedOldKeys: Set<string>;
  spatialCandidateCount: number;
  spatialQueryCount: number;
}

interface OverlapSignal {
  oldZone: ZoneSnapshot;
  newZone: ZoneSnapshot;
  confidence: number;
  intersectionOverUnion: number;
  overlapRatioNew: number;
  overlapRatioOld: number;
}

interface GeometryProposal {
  oldZone: ZoneSnapshot;
  newZone: ZoneSnapshot;
  confidence: number;
  secondConfidence: number;
  ambiguous: boolean;
  candidates: TerritoryDiffCandidateSignal[];
}

const MATCH_STRATEGIES: TerritoryDiffMatchStrategy[] = [
  "stable-id",
  "source-native-id",
  "parent-normalized-name",
  "geometry-similarity",
  "manual-review"
];

const DEFAULT_DIFF_OPTIONS: NormalizedDiffOptions = {
  automaticConfidenceThreshold: 0.85,
  ambiguousConfidenceDelta: 0.05,
  geometryCandidateMinConfidence: 0.62,
  geometryChangedAreaPercent: 0.5,
  geometryChangedCentroidMeters: 100,
  geometryChangedMinIoU: 0.995,
  majorGeometryAreaPercent: 20,
  majorGeometryCentroidMeters: 5_000,
  majorGeometryMinIoU: 0.7,
  splitMergeMinOverlapRatio: 0.2,
  splitMergeMinCoverageRatio: 0.55,
  spatialPaddingRatio: 0.1,
  spatialMinPaddingDegrees: 0.01
};

export function diffDatasets(
  oldDataset: TerritoryDataset,
  newDataset: TerritoryDataset,
  options: TerritoryDiffOptions = {}
): TerritoryDatasetDiffReport {
  const normalizedOptions = normalizeDiffOptions(options);
  const oldPrepared = prepareDataset(oldDataset);
  const newPrepared = prepareDataset(newDataset);
  const state = createMatchingState();
  const changes: TerritoryDiffChange[] = [];

  addDuplicateStableIdConflicts(changes, oldPrepared, newPrepared);
  matchStableIds(oldPrepared, newPrepared, state);
  matchUniqueIndex(
    oldPrepared.sourceKeyIndex,
    newPrepared.sourceKeyIndex,
    "source-native-id",
    0.96,
    state,
    changes
  );
  matchUniqueIndex(
    oldPrepared.nameKeyIndex,
    newPrepared.nameKeyIndex,
    "parent-normalized-name",
    0.88,
    state,
    changes
  );

  const overlapSignals = collectOverlapSignals(oldPrepared, newPrepared, state, normalizedOptions);
  addSplitMergeCandidates(changes, overlapSignals, state, normalizedOptions);
  matchByGeometry(oldPrepared, newPrepared, state, changes, normalizedOptions);

  for (const match of state.matches) {
    classifyMatch(match, oldPrepared, newPrepared, normalizedOptions);
    addMatchChanges(changes, match);
  }

  addManifestChanges(changes, oldDataset.manifest, newDataset.manifest);
  addHierarchyInvalidChanges(changes, oldPrepared, "old");
  addHierarchyInvalidChanges(changes, newPrepared, "new");
  addAddedRemovedChanges(changes, oldPrepared, newPrepared, state);

  const sortedChanges = sortChanges(dedupeChanges(changes));
  const matches = state.matches.map(toPublicMatch).sort(compareMatches);
  const breakingChanges = createBreakingChanges(sortedChanges);
  const summary = createSummary(oldPrepared, newPrepared, sortedChanges, matches, breakingChanges);

  return {
    schemaVersion: TERRITORY_DATASET_DIFF_SCHEMA_VERSION,
    fromDataset: createDatasetRef(oldDataset.manifest),
    toDataset: createDatasetRef(newDataset.manifest),
    breakingChanges,
    changes: sortedChanges,
    coverageChangeReport: createCoverageChangeReport(oldPrepared, newPrepared),
    matches,
    performance: createPerformanceReport(oldPrepared, newPrepared, state),
    summary
  };
}

export function diffIdentities(
  oldDataset: TerritoryDataset,
  newDataset: TerritoryDataset,
  options: TerritoryDiffOptions = {}
): TerritoryDatasetDiffReport {
  const report = diffDatasets(oldDataset, newDataset, options);
  const changes = report.changes.filter((change) => change.category !== "geometry-changed");
  const matches = report.matches.map((match) => {
    const categories = match.categories.filter((category) => category !== "geometry-changed");

    return {
      ...match,
      categories: categories.length > 0 ? categories : (["unchanged"] as TerritoryDiffCategory[])
    };
  });
  const breakingChanges = createBreakingChanges(changes);

  return {
    ...report,
    changes,
    matches,
    breakingChanges,
    summary: createSummaryFromPublic(report, changes, matches, breakingChanges)
  };
}

export function createMigrationPlan(
  oldDataset: TerritoryDataset,
  newDataset: TerritoryDataset,
  options: TerritoryDiffOptions = {}
): TerritoryDatasetMigrationPlan {
  const report = diffDatasets(oldDataset, newDataset, options);
  const automaticThreshold = normalizeDiffOptions(options).automaticConfidenceThreshold;
  const mappings = report.matches
    .filter((match) => !match.categories.includes("stable-id-conflict"))
    .filter((match) => !match.categories.includes("split-candidate"))
    .filter((match) => !match.categories.includes("merge-candidate"))
    .filter((match) => !match.categories.includes("ambiguous-match"))
    .map((match): TerritoryMigrationMapping => {
      const requiresReview = match.requiresReview || match.confidence < automaticThreshold;

      return {
        oldId: match.oldId,
        newId: match.newId,
        type: selectMappingType(match.categories),
        confidence: match.confidence,
        requiresReview,
        categories: match.categories,
        strategy: match.strategy
      };
    })
    .sort(compareMappings);
  const reviewItems = report.changes
    .filter((change) => change.requiresReview)
    .map((change): TerritoryMigrationReviewItem => ({
      category: change.category,
      reason: change.reason,
      confidence: change.confidence,
      ...(change.oldId ? { oldId: change.oldId } : {}),
      ...(change.newId ? { newId: change.newId } : {}),
      ...(change.oldIds ? { oldIds: [...change.oldIds] } : {}),
      ...(change.newIds ? { newIds: [...change.newIds] } : {})
    }))
    .sort(compareReviewItems);

  return {
    schemaVersion: TERRITORY_MIGRATION_PLAN_SCHEMA_VERSION,
    fromDataset: report.fromDataset,
    toDataset: report.toDataset,
    mappings,
    reviewItems,
    breakingChanges: report.breakingChanges,
    summary: {
      automaticMappingCount: mappings.filter((mapping) => !mapping.requiresReview).length,
      breakingChangeCount: report.breakingChanges.length,
      requiresReviewCount:
        reviewItems.length + mappings.filter((mapping) => mapping.requiresReview).length,
      totalMappingCount: mappings.length
    }
  };
}

export function validateMigrationPlan(input: unknown): TerritoryMigrationPlanValidationResult {
  const issues: TerritoryMigrationPlanValidationIssue[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [
        {
          code: "PLAN_SCHEMA",
          message: "Migration plan must be an object.",
          path: "$",
          severity: "error"
        }
      ]
    };
  }

  if (input.schemaVersion !== TERRITORY_MIGRATION_PLAN_SCHEMA_VERSION) {
    issues.push({
      code: "PLAN_SCHEMA",
      message: `Migration plan schemaVersion must be '${TERRITORY_MIGRATION_PLAN_SCHEMA_VERSION}'.`,
      path: "$.schemaVersion",
      severity: "error"
    });
  }

  validateDatasetRef(input.fromDataset, "$.fromDataset", issues);
  validateDatasetRef(input.toDataset, "$.toDataset", issues);

  if (!Array.isArray(input.mappings)) {
    issues.push({
      code: "PLAN_SCHEMA",
      message: "mappings must be an array.",
      path: "$.mappings",
      severity: "error"
    });
  } else {
    validateMappings(input.mappings, issues);
  }

  if (!Array.isArray(input.reviewItems)) {
    issues.push({
      code: "PLAN_SCHEMA",
      message: "reviewItems must be an array.",
      path: "$.reviewItems",
      severity: "error"
    });
  }

  if (!Array.isArray(input.breakingChanges)) {
    issues.push({
      code: "PLAN_SCHEMA",
      message: "breakingChanges must be an array.",
      path: "$.breakingChanges",
      severity: "error"
    });
  }

  const ok = issues.every((issue) => issue.severity !== "error");

  return {
    ok,
    issues,
    ...(ok ? { plan: input as unknown as TerritoryDatasetMigrationPlan } : {})
  };
}

function normalizeDiffOptions(options: TerritoryDiffOptions): NormalizedDiffOptions {
  return {
    automaticConfidenceThreshold:
      options.automaticConfidenceThreshold ?? DEFAULT_DIFF_OPTIONS.automaticConfidenceThreshold,
    ambiguousConfidenceDelta:
      options.ambiguousConfidenceDelta ?? DEFAULT_DIFF_OPTIONS.ambiguousConfidenceDelta,
    geometryCandidateMinConfidence:
      options.geometryCandidateMinConfidence ?? DEFAULT_DIFF_OPTIONS.geometryCandidateMinConfidence,
    geometryChangedAreaPercent:
      options.geometryChangedAreaPercent ?? DEFAULT_DIFF_OPTIONS.geometryChangedAreaPercent,
    geometryChangedCentroidMeters:
      options.geometryChangedCentroidMeters ?? DEFAULT_DIFF_OPTIONS.geometryChangedCentroidMeters,
    geometryChangedMinIoU:
      options.geometryChangedMinIoU ?? DEFAULT_DIFF_OPTIONS.geometryChangedMinIoU,
    majorGeometryAreaPercent:
      options.majorGeometryAreaPercent ?? DEFAULT_DIFF_OPTIONS.majorGeometryAreaPercent,
    majorGeometryCentroidMeters:
      options.majorGeometryCentroidMeters ?? DEFAULT_DIFF_OPTIONS.majorGeometryCentroidMeters,
    majorGeometryMinIoU: options.majorGeometryMinIoU ?? DEFAULT_DIFF_OPTIONS.majorGeometryMinIoU,
    splitMergeMinOverlapRatio:
      options.splitMergeMinOverlapRatio ?? DEFAULT_DIFF_OPTIONS.splitMergeMinOverlapRatio,
    splitMergeMinCoverageRatio:
      options.splitMergeMinCoverageRatio ?? DEFAULT_DIFF_OPTIONS.splitMergeMinCoverageRatio,
    spatialPaddingRatio: options.spatialPaddingRatio ?? DEFAULT_DIFF_OPTIONS.spatialPaddingRatio,
    spatialMinPaddingDegrees:
      options.spatialMinPaddingDegrees ?? DEFAULT_DIFF_OPTIONS.spatialMinPaddingDegrees
  };
}

function prepareDataset(dataset: TerritoryDataset): PreparedDataset {
  const snapshots = dataset.zones.map((zone, index): ZoneSnapshot => {
    const bbox = normalizeBBox(zone.bbox ?? computeGeometryBBox(zone.geometry));
    const center = normalizeLngLat(zone.center ?? computeGeometryCenter(zone.geometry));
    const names = extractNames(zone);
    const sourceNativeIds = extractSourceNativeIds(zone);

    return {
      key: `${index}\u0000${zone.id}`,
      index,
      zone,
      area: Math.max(geometryArea(zone.geometry), bboxArea(bbox)),
      bbox,
      center,
      names,
      normalizedNames: uniqueSorted(names.map(normalizeDiffName).filter(Boolean)),
      sourceNativeIds,
      topologyValid: isGeometryTopologyValid(zone.geometry)
    };
  });
  const duplicateIds = new Map<string, ZoneSnapshot[]>();
  const idGroups = groupSnapshots(snapshots, (snapshot) => snapshot.zone.id);
  const snapshotsByUniqueId = new Map<string, ZoneSnapshot>();

  for (const [id, group] of idGroups) {
    if (group.length === 1) {
      const [snapshot] = group;

      if (snapshot) {
        snapshotsByUniqueId.set(id, snapshot);
      }
    } else {
      duplicateIds.set(id, group);
    }
  }

  return {
    dataset,
    duplicateIds,
    snapshots,
    snapshotsByUniqueId,
    sourceKeyIndex: buildSourceKeyIndex(snapshots),
    nameKeyIndex: buildNameKeyIndex(snapshots),
    spatialIndex: [...snapshots].sort(compareSnapshotsByWest)
  };
}

function createMatchingState(): MatchingState {
  return {
    ambiguousKeys: new Set(),
    blockedOldKeys: new Set(),
    blockedNewKeys: new Set(),
    candidatePairCount: 0,
    matches: [],
    matchedNewKeys: new Set(),
    matchedOldKeys: new Set(),
    spatialCandidateCount: 0,
    spatialQueryCount: 0
  };
}

function addDuplicateStableIdConflicts(
  changes: TerritoryDiffChange[],
  oldPrepared: PreparedDataset,
  newPrepared: PreparedDataset
): void {
  for (const [id, snapshots] of oldPrepared.duplicateIds) {
    changes.push(
      createChange({
        category: "stable-id-conflict",
        confidence: 1,
        oldId: id,
        oldIds: snapshots.map((snapshot) => snapshot.zone.id).sort(),
        reason: `Old dataset contains ${snapshots.length} zones with stable id '${id}'.`,
        requiresReview: true,
        breaking: true,
        strategy: "stable-id"
      })
    );
  }

  for (const [id, snapshots] of newPrepared.duplicateIds) {
    changes.push(
      createChange({
        category: "stable-id-conflict",
        confidence: 1,
        newId: id,
        newIds: snapshots.map((snapshot) => snapshot.zone.id).sort(),
        reason: `New dataset contains ${snapshots.length} zones with stable id '${id}'.`,
        requiresReview: true,
        breaking: true,
        strategy: "stable-id"
      })
    );
  }
}

function matchStableIds(
  oldPrepared: PreparedDataset,
  newPrepared: PreparedDataset,
  state: MatchingState
): void {
  const ids = [...oldPrepared.snapshotsByUniqueId.keys()]
    .filter((id) => newPrepared.snapshotsByUniqueId.has(id))
    .sort();

  for (const id of ids) {
    const oldZone = oldPrepared.snapshotsByUniqueId.get(id);
    const newZone = newPrepared.snapshotsByUniqueId.get(id);

    if (oldZone && newZone) {
      addInternalMatch(state, oldZone, newZone, "stable-id", 1);
    }
  }
}

function matchUniqueIndex(
  oldIndex: Map<string, ZoneSnapshot[]>,
  newIndex: Map<string, ZoneSnapshot[]>,
  strategy: TerritoryDiffMatchStrategy,
  confidence: number,
  state: MatchingState,
  changes: TerritoryDiffChange[]
): void {
  const keys = [...oldIndex.keys()].filter((key) => newIndex.has(key)).sort();

  for (const key of keys) {
    const oldCandidates = (oldIndex.get(key) ?? []).filter((snapshot) =>
      isSnapshotMatchable(snapshot, state, "old")
    );
    const newCandidates = (newIndex.get(key) ?? []).filter((snapshot) =>
      isSnapshotMatchable(snapshot, state, "new")
    );

    if (oldCandidates.length === 1 && newCandidates.length === 1) {
      const [oldZone] = oldCandidates;
      const [newZone] = newCandidates;

      if (oldZone && newZone) {
        addInternalMatch(state, oldZone, newZone, strategy, confidence);
      }
      continue;
    }

    if (oldCandidates.length + newCandidates.length <= 2) {
      continue;
    }

    const oldIds = oldCandidates.map((snapshot) => snapshot.zone.id).sort();
    const newIds = newCandidates.map((snapshot) => snapshot.zone.id).sort();

    for (const snapshot of oldCandidates) {
      state.blockedOldKeys.add(snapshot.key);
      state.ambiguousKeys.add(snapshot.key);
    }

    for (const snapshot of newCandidates) {
      state.blockedNewKeys.add(snapshot.key);
      state.ambiguousKeys.add(snapshot.key);
    }

    changes.push(
      createChange({
        category: "ambiguous-match",
        confidence,
        oldIds,
        newIds,
        reason: `Multiple zones share the ${strategy} key '${key}'.`,
        requiresReview: true,
        breaking: true,
        strategy,
        candidates: [
          ...oldCandidates.map((snapshot) => ({
            id: snapshot.zone.id,
            confidence,
            intersectionOverUnion: 0,
            overlapRatioNew: 0,
            overlapRatioOld: 0
          })),
          ...newCandidates.map((snapshot) => ({
            id: snapshot.zone.id,
            confidence,
            intersectionOverUnion: 0,
            overlapRatioNew: 0,
            overlapRatioOld: 0
          }))
        ].sort(compareCandidateSignals)
      })
    );
  }
}

function collectOverlapSignals(
  oldPrepared: PreparedDataset,
  newPrepared: PreparedDataset,
  state: MatchingState,
  options: NormalizedDiffOptions
): OverlapSignal[] {
  const signals: OverlapSignal[] = [];

  for (const oldZone of oldPrepared.snapshots) {
    if (!isSnapshotMatchable(oldZone, state, "old")) {
      continue;
    }

    for (const newZone of querySpatialCandidates(oldZone, newPrepared, state, options)) {
      if (!isSnapshotMatchable(newZone, state, "new")) {
        continue;
      }

      const intersection = bboxIntersectionArea(oldZone.bbox, newZone.bbox);

      if (intersection <= 0) {
        continue;
      }

      const overlapRatioOld = oldZone.area > 0 ? intersection / oldZone.area : 0;
      const overlapRatioNew = newZone.area > 0 ? intersection / newZone.area : 0;
      const intersectionOverUnion = computeIntersectionOverUnion(oldZone, newZone, intersection);
      const confidence = computeGeometryConfidence(oldZone, newZone, intersectionOverUnion);

      signals.push({
        oldZone,
        newZone,
        confidence,
        intersectionOverUnion,
        overlapRatioNew: roundRatio(overlapRatioNew),
        overlapRatioOld: roundRatio(overlapRatioOld)
      });
    }
  }

  return signals.sort(compareOverlapSignals);
}

function addSplitMergeCandidates(
  changes: TerritoryDiffChange[],
  overlapSignals: OverlapSignal[],
  state: MatchingState,
  options: NormalizedDiffOptions
): void {
  const byOld = groupBy(overlapSignals, (signal) => signal.oldZone.key);
  const byNew = groupBy(overlapSignals, (signal) => signal.newZone.key);

  for (const signals of [...byOld.values()].sort(compareOverlapSignalGroups)) {
    const significant = signals
      .filter((signal) => signal.overlapRatioOld >= options.splitMergeMinOverlapRatio)
      .sort(compareOverlapSignals);
    const coverage = significant.reduce((sum, signal) => sum + signal.overlapRatioOld, 0);
    const oldZone = significant[0]?.oldZone;

    if (!oldZone || significant.length < 2 || coverage < options.splitMergeMinCoverageRatio) {
      continue;
    }

    const newIds = uniqueSorted(significant.map((signal) => signal.newZone.zone.id));

    state.blockedOldKeys.add(oldZone.key);
    for (const signal of significant) {
      state.blockedNewKeys.add(signal.newZone.key);
    }

    changes.push(
      createChange({
        category: "split-candidate",
        confidence: roundRatio(Math.max(...significant.map((signal) => signal.confidence))),
        oldId: oldZone.zone.id,
        oldZone: toZoneRef(oldZone),
        newIds,
        reason: `Old zone '${oldZone.zone.id}' overlaps ${newIds.length} new zones with ${roundPercent(coverage)}% coverage.`,
        requiresReview: true,
        breaking: true,
        strategy: "geometry-similarity",
        candidates: significant
          .map((signal) => ({
            id: signal.oldZone.zone.id,
            confidence: roundRatio(signal.confidence),
            intersectionOverUnion: roundRatio(signal.intersectionOverUnion),
            overlapRatioNew: roundRatio(signal.overlapRatioNew),
            overlapRatioOld: roundRatio(signal.overlapRatioOld)
          }))
          .sort(compareCandidateSignals)
      })
    );
  }

  for (const signals of [...byNew.values()].sort(compareOverlapSignalGroups)) {
    const significant = signals
      .filter((signal) => signal.overlapRatioNew >= options.splitMergeMinOverlapRatio)
      .sort(compareOverlapSignals);
    const coverage = significant.reduce((sum, signal) => sum + signal.overlapRatioNew, 0);
    const newZone = significant[0]?.newZone;

    if (!newZone || significant.length < 2 || coverage < options.splitMergeMinCoverageRatio) {
      continue;
    }

    const oldIds = uniqueSorted(significant.map((signal) => signal.oldZone.zone.id));

    state.blockedNewKeys.add(newZone.key);
    for (const signal of significant) {
      state.blockedOldKeys.add(signal.oldZone.key);
    }

    changes.push(
      createChange({
        category: "merge-candidate",
        confidence: roundRatio(Math.max(...significant.map((signal) => signal.confidence))),
        oldIds,
        newId: newZone.zone.id,
        newZone: toZoneRef(newZone),
        reason: `${oldIds.length} old zones overlap new zone '${newZone.zone.id}' with ${roundPercent(coverage)}% coverage.`,
        requiresReview: true,
        breaking: true,
        strategy: "geometry-similarity",
        candidates: significant.map(toCandidateSignal).sort(compareCandidateSignals)
      })
    );
  }
}

function matchByGeometry(
  oldPrepared: PreparedDataset,
  newPrepared: PreparedDataset,
  state: MatchingState,
  changes: TerritoryDiffChange[],
  options: NormalizedDiffOptions
): void {
  const proposals: GeometryProposal[] = [];

  for (const oldZone of oldPrepared.snapshots) {
    if (!isSnapshotMatchable(oldZone, state, "old")) {
      continue;
    }

    const candidates = querySpatialCandidates(oldZone, newPrepared, state, options)
      .filter((newZone) => isSnapshotMatchable(newZone, state, "new"))
      .map((newZone) => {
        const intersection = bboxIntersectionArea(oldZone.bbox, newZone.bbox);
        const intersectionOverUnion = computeIntersectionOverUnion(oldZone, newZone, intersection);
        const confidence = computeGeometryConfidence(oldZone, newZone, intersectionOverUnion);
        const overlapRatioOld = oldZone.area > 0 ? intersection / oldZone.area : 0;
        const overlapRatioNew = newZone.area > 0 ? intersection / newZone.area : 0;

        return {
          id: newZone.zone.id,
          newZone,
          confidence,
          intersectionOverUnion,
          overlapRatioNew,
          overlapRatioOld
        };
      })
      .filter((candidate) => candidate.confidence >= options.geometryCandidateMinConfidence)
      .sort(compareGeometryCandidates);
    const [best, second] = candidates;

    if (!best) {
      continue;
    }

    proposals.push({
      oldZone,
      newZone: best.newZone,
      confidence: best.confidence,
      secondConfidence: second?.confidence ?? 0,
      ambiguous:
        Boolean(second) &&
        best.confidence - (second?.confidence ?? 0) <= options.ambiguousConfidenceDelta,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        confidence: roundRatio(candidate.confidence),
        intersectionOverUnion: roundRatio(candidate.intersectionOverUnion),
        overlapRatioNew: roundRatio(candidate.overlapRatioNew),
        overlapRatioOld: roundRatio(candidate.overlapRatioOld)
      }))
    });
  }

  for (const proposal of proposals
    .filter((item) => item.ambiguous)
    .sort(compareGeometryProposals)) {
    state.blockedOldKeys.add(proposal.oldZone.key);
    for (const candidate of proposal.candidates) {
      const snapshot = newPrepared.snapshotsByUniqueId.get(candidate.id);

      if (snapshot) {
        state.blockedNewKeys.add(snapshot.key);
      }
    }

    changes.push(
      createChange({
        category: "ambiguous-match",
        confidence: roundRatio(proposal.confidence),
        oldId: proposal.oldZone.zone.id,
        oldZone: toZoneRef(proposal.oldZone),
        newIds: proposal.candidates.map((candidate) => candidate.id).sort(),
        reason: `Geometry candidates for '${proposal.oldZone.zone.id}' are within ${roundRatio(proposal.confidence - proposal.secondConfidence)} confidence.`,
        requiresReview: true,
        breaking: true,
        strategy: "geometry-similarity",
        candidates: proposal.candidates.sort(compareCandidateSignals)
      })
    );
  }

  for (const proposal of proposals
    .filter((item) => !item.ambiguous)
    .sort(compareGeometryProposals)) {
    if (
      !isSnapshotMatchable(proposal.oldZone, state, "old") ||
      !isSnapshotMatchable(proposal.newZone, state, "new")
    ) {
      continue;
    }

    addInternalMatch(
      state,
      proposal.oldZone,
      proposal.newZone,
      "geometry-similarity",
      roundRatio(proposal.confidence)
    );
  }
}

function classifyMatch(
  match: InternalMatch,
  oldPrepared: PreparedDataset,
  newPrepared: PreparedDataset,
  options: NormalizedDiffOptions
): void {
  const categories: TerritoryDiffCategory[] = [];
  const oldZone = match.oldZone.zone;
  const newZone = match.newZone.zone;
  const signals = compareGeometry(match.oldZone, match.newZone, oldPrepared, newPrepared);
  const metadataFields = changedMetadataFields(oldZone, newZone);
  const sourceChanged = zoneSourceFingerprint(oldZone) !== zoneSourceFingerprint(newZone);
  const licenseChanged = zoneLicense(oldZone) !== zoneLicense(newZone);
  const renamed =
    oldZone.id !== newZone.id ||
    displayName(oldZone) !== displayName(newZone) ||
    (oldZone.localName ?? null) !== (newZone.localName ?? null);
  const reparented = (oldZone.parentId ?? null) !== (newZone.parentId ?? null);
  const geometryChanged =
    signals.geometryTypeChanged ||
    !signals.oldTopologyValid ||
    !signals.newTopologyValid ||
    signals.bboxChanged ||
    signals.areaChangePercent >= options.geometryChangedAreaPercent ||
    signals.centroidDistanceMeters >= options.geometryChangedCentroidMeters ||
    signals.intersectionOverUnion < options.geometryChangedMinIoU;
  const stableConflict =
    match.strategy === "stable-id" &&
    oldZone.id === newZone.id &&
    hasStableIdSemanticConflict(match.oldZone, match.newZone, signals);

  if (stableConflict) {
    categories.push("stable-id-conflict");
  }

  if (renamed) {
    categories.push("renamed");
  }

  if (reparented) {
    categories.push("reparented");
  }

  if (geometryChanged) {
    categories.push("geometry-changed");
  }

  if (metadataFields.length > 0) {
    categories.push("metadata-changed");
  }

  if (licenseChanged) {
    categories.push("license-changed");
  }

  if (sourceChanged) {
    categories.push("source-changed");
  }

  match.signals = signals;
  match.categories = categories.length > 0 ? uniqueCategories(categories) : ["unchanged"];
  match.requiresReview =
    match.confidence < options.automaticConfidenceThreshold ||
    stableConflict ||
    licenseChanged ||
    sourceChanged ||
    isMajorGeometryChange(signals, options);
}

function addMatchChanges(changes: TerritoryDiffChange[], match: InternalMatch): void {
  if (match.categories.length === 1 && match.categories[0] === "unchanged") {
    return;
  }

  for (const category of match.categories) {
    const fields =
      category === "metadata-changed"
        ? changedMetadataFields(match.oldZone.zone, match.newZone.zone)
        : [];
    const breaking =
      category === "stable-id-conflict" ||
      category === "license-changed" ||
      category === "source-changed" ||
      category === "reparented" ||
      (category === "metadata-changed" && fields.some((field) => isAdminLevelField(field))) ||
      (category === "geometry-changed" && match.requiresReview);

    changes.push(
      createChange({
        category,
        confidence: match.confidence,
        oldId: match.oldZone.zone.id,
        newId: match.newZone.zone.id,
        oldZone: toZoneRef(match.oldZone),
        newZone: toZoneRef(match.newZone),
        reason: createMatchChangeReason(category, match, fields),
        requiresReview:
          match.requiresReview ||
          category === "stable-id-conflict" ||
          category === "license-changed" ||
          category === "source-changed",
        breaking,
        strategy: match.strategy,
        ...(fields.length > 0 ? { fields } : {}),
        ...(category === "geometry-changed" && match.signals ? { signals: match.signals } : {})
      })
    );
  }
}

function addManifestChanges(
  changes: TerritoryDiffChange[],
  oldManifest: TerritoryDatasetManifest,
  newManifest: TerritoryDatasetManifest
): void {
  if ((oldManifest.license ?? null) !== (newManifest.license ?? null)) {
    changes.push(
      createChange({
        category: "license-changed",
        confidence: 1,
        reason: `Dataset license changed from '${oldManifest.license ?? "unspecified"}' to '${newManifest.license ?? "unspecified"}'.`,
        requiresReview: true,
        breaking: true,
        strategy: "stable-id"
      })
    );
  }

  const sourceFields = [
    "sourceProvider",
    "sourceDate",
    "attribution",
    "sourceUrl",
    "boundaryPolicy",
    "worldview"
  ];
  const changed = sourceFields.filter(
    (field) => readObjectString(oldManifest, field) !== readObjectString(newManifest, field)
  );

  if (changed.length > 0) {
    changes.push(
      createChange({
        category: "source-changed",
        confidence: 1,
        fields: changed,
        reason: `Dataset source metadata changed: ${changed.join(", ")}.`,
        requiresReview: true,
        breaking: true,
        strategy: "stable-id"
      })
    );
  }
}

function addHierarchyInvalidChanges(
  changes: TerritoryDiffChange[],
  prepared: PreparedDataset,
  side: "old" | "new"
): void {
  const byId = prepared.snapshotsByUniqueId;

  for (const snapshot of prepared.snapshots) {
    const parentId = snapshot.zone.parentId;

    if (!parentId) {
      continue;
    }

    const parent = byId.get(parentId);

    if (!parent) {
      changes.push(
        createChange({
          category: "hierarchy-invalid",
          confidence: 1,
          ...(side === "old" ? { oldId: snapshot.zone.id } : { newId: snapshot.zone.id }),
          reason: `${capitalize(side)} zone '${snapshot.zone.id}' references missing parent '${parentId}'.`,
          requiresReview: true,
          breaking: true,
          strategy: "manual-review"
        })
      );
      continue;
    }

    if (parent.zone.level >= snapshot.zone.level) {
      changes.push(
        createChange({
          category: "hierarchy-invalid",
          confidence: 1,
          ...(side === "old" ? { oldId: snapshot.zone.id } : { newId: snapshot.zone.id }),
          reason: `${capitalize(side)} zone '${snapshot.zone.id}' parent '${parentId}' is not a lower administrative level.`,
          requiresReview: true,
          breaking: true,
          strategy: "manual-review"
        })
      );
    }
  }

  for (const snapshot of prepared.snapshots) {
    if (hasParentCycle(snapshot, byId)) {
      changes.push(
        createChange({
          category: "hierarchy-invalid",
          confidence: 1,
          ...(side === "old" ? { oldId: snapshot.zone.id } : { newId: snapshot.zone.id }),
          reason: `${capitalize(side)} zone '${snapshot.zone.id}' participates in a parent cycle.`,
          requiresReview: true,
          breaking: true,
          strategy: "manual-review"
        })
      );
    }
  }
}

function addAddedRemovedChanges(
  changes: TerritoryDiffChange[],
  oldPrepared: PreparedDataset,
  newPrepared: PreparedDataset,
  state: MatchingState
): void {
  for (const oldZone of oldPrepared.snapshots) {
    if (
      state.matchedOldKeys.has(oldZone.key) ||
      state.blockedOldKeys.has(oldZone.key) ||
      oldPrepared.duplicateIds.has(oldZone.zone.id)
    ) {
      continue;
    }

    changes.push(
      createChange({
        category: "removed",
        confidence: 1,
        oldId: oldZone.zone.id,
        oldZone: toZoneRef(oldZone),
        reason: `Old zone '${oldZone.zone.id}' has no safe match in the new dataset.`,
        requiresReview: true,
        breaking: true,
        strategy: "manual-review"
      })
    );
  }

  for (const newZone of newPrepared.snapshots) {
    if (
      state.matchedNewKeys.has(newZone.key) ||
      state.blockedNewKeys.has(newZone.key) ||
      newPrepared.duplicateIds.has(newZone.zone.id)
    ) {
      continue;
    }

    changes.push(
      createChange({
        category: "added",
        confidence: 1,
        newId: newZone.zone.id,
        newZone: toZoneRef(newZone),
        reason: `New zone '${newZone.zone.id}' was added.`,
        requiresReview: false,
        breaking: false,
        strategy: "manual-review"
      })
    );
  }
}

function addInternalMatch(
  state: MatchingState,
  oldZone: ZoneSnapshot,
  newZone: ZoneSnapshot,
  strategy: TerritoryDiffMatchStrategy,
  confidence: number
): void {
  if (
    state.matchedOldKeys.has(oldZone.key) ||
    state.matchedNewKeys.has(newZone.key) ||
    state.blockedOldKeys.has(oldZone.key) ||
    state.blockedNewKeys.has(newZone.key)
  ) {
    return;
  }

  state.matchedOldKeys.add(oldZone.key);
  state.matchedNewKeys.add(newZone.key);
  state.matches.push({
    oldZone,
    newZone,
    confidence: roundRatio(confidence),
    requiresReview: false,
    strategy,
    categories: ["unchanged"]
  });
}

function querySpatialCandidates(
  oldZone: ZoneSnapshot,
  newPrepared: PreparedDataset,
  state: MatchingState,
  options: NormalizedDiffOptions
): ZoneSnapshot[] {
  state.spatialQueryCount += 1;
  const queryBBox = expandBBox(oldZone.bbox, options);
  const candidates: ZoneSnapshot[] = [];

  for (const candidate of newPrepared.spatialIndex) {
    if (candidate.bbox[0] > queryBBox[2]) {
      break;
    }

    if (candidate.bbox[2] < queryBBox[0]) {
      continue;
    }

    state.candidatePairCount += 1;

    if (bboxesIntersect(queryBBox, candidate.bbox)) {
      candidates.push(candidate);
      state.spatialCandidateCount += 1;
    }
  }

  return candidates.sort(compareSnapshotIds);
}

function compareGeometry(
  oldZone: ZoneSnapshot,
  newZone: ZoneSnapshot,
  oldPrepared: PreparedDataset,
  newPrepared: PreparedDataset
): TerritoryGeometryDiffSignals {
  const intersection = bboxIntersectionArea(oldZone.bbox, newZone.bbox);
  const oldBBoxArea = bboxArea(oldZone.bbox);
  const newBBoxArea = bboxArea(newZone.bbox);
  const bboxAreaChangePercent = percentChange(oldBBoxArea, newBBoxArea);

  return {
    areaChangePercent: percentChange(oldZone.area, newZone.area),
    bboxAreaChangePercent,
    bboxChanged: !bboxesEqual(oldZone.bbox, newZone.bbox),
    centroidDistanceMeters: roundMeters(haversineMeters(oldZone.center, newZone.center)),
    geometryTypeChanged: oldZone.zone.geometry.type !== newZone.zone.geometry.type,
    intersectionOverUnion: computeIntersectionOverUnion(oldZone, newZone, intersection),
    newArea: roundMetric(newZone.area),
    newTopologyValid: newZone.topologyValid,
    newWithinParent: isWithinParentBoundary(newZone, newPrepared),
    oldArea: roundMetric(oldZone.area),
    oldTopologyValid: oldZone.topologyValid,
    oldWithinParent: isWithinParentBoundary(oldZone, oldPrepared)
  };
}

function isWithinParentBoundary(snapshot: ZoneSnapshot, prepared: PreparedDataset): boolean | null {
  if (!snapshot.zone.parentId) {
    return null;
  }

  const parent = prepared.snapshotsByUniqueId.get(snapshot.zone.parentId);

  if (!parent) {
    return false;
  }

  return pointWithinBBox(snapshot.center, parent.bbox);
}

function computeGeometryConfidence(
  oldZone: ZoneSnapshot,
  newZone: ZoneSnapshot,
  intersectionOverUnion: number
): number {
  const centroidDistance = haversineMeters(oldZone.center, newZone.center);
  const diagonal = Math.max(
    1,
    haversineMeters([oldZone.bbox[0], oldZone.bbox[1]], [oldZone.bbox[2], oldZone.bbox[3]])
  );
  const centroidScore = 1 / (1 + centroidDistance / diagonal);
  const areaScore = 1 - Math.min(1, percentChange(oldZone.area, newZone.area) / 100);
  const nameScore = sameNameSet(oldZone, newZone) ? 1 : 0;
  const parentScore = (oldZone.zone.parentId ?? "") === (newZone.zone.parentId ?? "") ? 1 : 0;

  return roundRatio(
    clamp(
      intersectionOverUnion * 0.58 +
        centroidScore * 0.2 +
        areaScore * 0.14 +
        nameScore * 0.05 +
        parentScore * 0.03,
      0,
      1
    )
  );
}

function computeIntersectionOverUnion(
  oldZone: ZoneSnapshot,
  newZone: ZoneSnapshot,
  intersection: number
): number {
  if (intersection <= 0) {
    return 0;
  }

  const union = oldZone.area + newZone.area - intersection;
  return union <= 0 ? 0 : roundRatio(intersection / union);
}

function isMajorGeometryChange(
  signals: TerritoryGeometryDiffSignals,
  options: NormalizedDiffOptions
): boolean {
  return (
    signals.areaChangePercent >= options.majorGeometryAreaPercent ||
    signals.centroidDistanceMeters >= options.majorGeometryCentroidMeters ||
    signals.intersectionOverUnion < options.majorGeometryMinIoU ||
    signals.geometryTypeChanged ||
    !signals.oldTopologyValid ||
    !signals.newTopologyValid
  );
}

function hasStableIdSemanticConflict(
  oldZone: ZoneSnapshot,
  newZone: ZoneSnapshot,
  signals: TerritoryGeometryDiffSignals
): boolean {
  const hasSourceIds = oldZone.sourceNativeIds.length > 0 && newZone.sourceNativeIds.length > 0;
  const sourceDisjoint =
    hasSourceIds &&
    oldZone.sourceNativeIds.every((id) => !newZone.sourceNativeIds.includes(id)) &&
    newZone.sourceNativeIds.every((id) => !oldZone.sourceNativeIds.includes(id));

  return sourceDisjoint && !sameNameSet(oldZone, newZone) && signals.intersectionOverUnion < 0.25;
}

function changedMetadataFields(oldZone: TerritoryZone, newZone: TerritoryZone): string[] {
  const fields: string[] = [];
  const fieldPairs: Array<[string, unknown, unknown]> = [
    ["countryCode", oldZone.countryCode, newZone.countryCode],
    ["level", oldZone.level, newZone.level],
    ["sourceAdminLevel", oldZone.sourceAdminLevel, newZone.sourceAdminLevel],
    ["semanticType", oldZone.semanticType, newZone.semanticType],
    [
      "territory.adminLevel",
      readTerritoryString(oldZone, "adminLevel"),
      readTerritoryString(newZone, "adminLevel")
    ],
    [
      "territory.sourceAdminLevel",
      readTerritoryString(oldZone, "sourceAdminLevel"),
      readTerritoryString(newZone, "sourceAdminLevel")
    ],
    [
      "territory.semanticType",
      readTerritoryString(oldZone, "semanticType"),
      readTerritoryString(newZone, "semanticType")
    ],
    [
      "territory.coverageStatus",
      readTerritoryString(oldZone, "coverageStatus"),
      readTerritoryString(newZone, "coverageStatus")
    ],
    [
      "territory.codes",
      stableStringify(readTerritoryRecord(oldZone, "codes")),
      stableStringify(readTerritoryRecord(newZone, "codes"))
    ]
  ];

  for (const [field, oldValue, newValue] of fieldPairs) {
    if ((oldValue ?? null) !== (newValue ?? null)) {
      fields.push(field);
    }
  }

  return fields.sort();
}

function createMatchChangeReason(
  category: TerritoryDiffCategory,
  match: InternalMatch,
  fields: string[]
): string {
  const oldId = match.oldZone.zone.id;
  const newId = match.newZone.zone.id;

  if (category === "renamed") {
    if (oldId !== newId) {
      return `Identity migrated from '${oldId}' to '${newId}' by ${match.strategy}.`;
    }

    return `Zone '${oldId}' name changed from '${displayName(match.oldZone.zone)}' to '${displayName(match.newZone.zone)}'.`;
  }

  if (category === "reparented") {
    return `Zone '${oldId}' parent changed from '${match.oldZone.zone.parentId ?? "none"}' to '${match.newZone.zone.parentId ?? "none"}'.`;
  }

  if (category === "geometry-changed") {
    return `Zone '${oldId}' geometry changed with IoU ${match.signals?.intersectionOverUnion ?? 0}.`;
  }

  if (category === "metadata-changed") {
    return `Zone '${oldId}' metadata changed: ${fields.join(", ")}.`;
  }

  if (category === "stable-id-conflict") {
    return `Stable id '${oldId}' may refer to a different real-world region.`;
  }

  if (category === "license-changed") {
    return `Zone '${oldId}' source license metadata changed.`;
  }

  if (category === "source-changed") {
    return `Zone '${oldId}' source metadata changed.`;
  }

  return `Zone '${oldId}' changed.`;
}

function createSummary(
  oldPrepared: PreparedDataset,
  newPrepared: PreparedDataset,
  changes: TerritoryDiffChange[],
  matches: TerritoryDiffMatch[],
  breakingChanges: TerritoryBreakingChange[]
): TerritoryDatasetDiffSummary {
  const countsByCategory = createCategoryCounts();

  for (const change of changes) {
    countsByCategory[change.category] += 1;
  }

  const unchangedCount = matches.filter(
    (match) => match.categories.length === 1 && match.categories[0] === "unchanged"
  ).length;
  countsByCategory.unchanged = unchangedCount;

  return {
    automaticMigrationCount: matches.filter((match) => !match.requiresReview).length,
    breakingChangeCount: breakingChanges.length,
    changedCount: changes.length,
    countsByCategory,
    newZoneCount: newPrepared.snapshots.length,
    oldZoneCount: oldPrepared.snapshots.length,
    requiresReviewCount:
      changes.filter((change) => change.requiresReview).length +
      matches.filter((match) => match.requiresReview).length,
    unchangedCount
  };
}

function createSummaryFromPublic(
  report: TerritoryDatasetDiffReport,
  changes: TerritoryDiffChange[],
  matches: TerritoryDiffMatch[],
  breakingChanges: TerritoryBreakingChange[]
): TerritoryDatasetDiffSummary {
  const countsByCategory = createCategoryCounts();

  for (const change of changes) {
    countsByCategory[change.category] += 1;
  }

  const unchangedCount = matches.filter(
    (match) => match.categories.length === 1 && match.categories[0] === "unchanged"
  ).length;
  countsByCategory.unchanged = unchangedCount;

  return {
    ...report.summary,
    automaticMigrationCount: matches.filter((match) => !match.requiresReview).length,
    breakingChangeCount: breakingChanges.length,
    changedCount: changes.length,
    countsByCategory,
    requiresReviewCount:
      changes.filter((change) => change.requiresReview).length +
      matches.filter((match) => match.requiresReview).length,
    unchangedCount
  };
}

function createBreakingChanges(changes: readonly TerritoryDiffChange[]): TerritoryBreakingChange[] {
  return changes
    .flatMap((change): TerritoryBreakingChange[] => {
      if (!change.breaking) {
        return [];
      }

      const base = {
        message: change.reason,
        ...(change.oldId ? { oldId: change.oldId } : {}),
        ...(change.newId ? { newId: change.newId } : {})
      };

      if (change.category === "removed") {
        return [{ ...base, code: "REMOVED_ZONE", severity: "error" }];
      }

      if (change.category === "split-candidate") {
        return [{ ...base, code: "SPLIT_CANDIDATE", severity: "error" }];
      }

      if (change.category === "merge-candidate") {
        return [{ ...base, code: "MERGE_CANDIDATE", severity: "error" }];
      }

      if (change.category === "ambiguous-match") {
        return [{ ...base, code: "AMBIGUOUS_MATCH", severity: "error" }];
      }

      if (change.category === "stable-id-conflict") {
        return [{ ...base, code: "STABLE_ID_CONFLICT", severity: "error" }];
      }

      if (change.category === "hierarchy-invalid") {
        return [{ ...base, code: "HIERARCHY_INVALID", severity: "error" }];
      }

      if (change.category === "license-changed") {
        return [{ ...base, code: "LICENSE_CHANGED", severity: "error" }];
      }

      if (change.category === "source-changed") {
        return [{ ...base, code: "SOURCE_CHANGED", severity: "warning" }];
      }

      if (change.category === "reparented") {
        return [{ ...base, code: "REPARENTED", severity: "warning" }];
      }

      if (change.category === "metadata-changed" && change.fields?.some(isAdminLevelField)) {
        return [{ ...base, code: "ADM_LEVEL_CHANGED", severity: "error" }];
      }

      if (change.category === "geometry-changed") {
        return [{ ...base, code: "GEOMETRY_MAJOR_CHANGE", severity: "warning" }];
      }

      return [];
    })
    .sort(compareBreakingChanges);
}

function createCoverageChangeReport(
  oldPrepared: PreparedDataset,
  newPrepared: PreparedDataset
): TerritoryCoverageChangeReport {
  return {
    zoneCount: {
      old: oldPrepared.snapshots.length,
      new: newPrepared.snapshots.length,
      delta: newPrepared.snapshots.length - oldPrepared.snapshots.length,
      deltaPercent: percentChange(oldPrepared.snapshots.length, newPrepared.snapshots.length)
    },
    byCountry: createCountChanges(
      countBy(oldPrepared.snapshots, (snapshot) => snapshot.zone.countryCode ?? "unknown"),
      countBy(newPrepared.snapshots, (snapshot) => snapshot.zone.countryCode ?? "unknown")
    ),
    byLevel: createCountChanges(
      countBy(oldPrepared.snapshots, (snapshot) => String(snapshot.zone.level)),
      countBy(newPrepared.snapshots, (snapshot) => String(snapshot.zone.level))
    ),
    countryCodes: createSetChange(
      oldPrepared.dataset.manifest.countryCodes ??
        uniqueSorted(
          oldPrepared.snapshots.map((snapshot) => snapshot.zone.countryCode).filter(isString)
        ),
      newPrepared.dataset.manifest.countryCodes ??
        uniqueSorted(
          newPrepared.snapshots.map((snapshot) => snapshot.zone.countryCode).filter(isString)
        )
    ),
    manifestAdminLevels: createSetChange(
      oldPrepared.dataset.manifest.adminLevels ??
        uniqueSorted(oldPrepared.snapshots.map((snapshot) => `ADM${snapshot.zone.level}`)),
      newPrepared.dataset.manifest.adminLevels ??
        uniqueSorted(newPrepared.snapshots.map((snapshot) => `ADM${snapshot.zone.level}`))
    )
  };
}

function createPerformanceReport(
  oldPrepared: PreparedDataset,
  newPrepared: PreparedDataset,
  state: MatchingState
): TerritoryDiffPerformanceReport {
  const matchCountsByStrategy = Object.fromEntries(
    MATCH_STRATEGIES.map((strategy) => [
      strategy,
      state.matches.filter((match) => match.strategy === strategy).length
    ])
  ) as Record<TerritoryDiffMatchStrategy, number>;
  const zoneCount = oldPrepared.snapshots.length + newPrepared.snapshots.length;

  return {
    candidatePairCount: state.candidatePairCount,
    duplicateStableIdCount: oldPrepared.duplicateIds.size + newPrepared.duplicateIds.size,
    estimatedMemoryBytes: zoneCount * 384 + state.candidatePairCount * 64,
    matchCountsByStrategy,
    newZoneCount: newPrepared.snapshots.length,
    oldZoneCount: oldPrepared.snapshots.length,
    spatialCandidateCount: state.spatialCandidateCount,
    spatialQueryCount: state.spatialQueryCount,
    streamingRecommended: zoneCount > 100_000
  };
}

function createDatasetRef(manifest: TerritoryDatasetManifest): TerritoryDatasetRef {
  return {
    datasetId: manifest.datasetId,
    datasetVersion: manifest.datasetVersion,
    geometryHash: manifest.geometryHash,
    sourceDate: manifest.sourceDate,
    ...(manifest.adminLevels ? { adminLevels: [...manifest.adminLevels] } : {}),
    ...(manifest.countryCodes ? { countryCodes: [...manifest.countryCodes] } : {}),
    ...(manifest.license ? { license: manifest.license } : {}),
    ...(manifest.sourceProvider ? { sourceProvider: manifest.sourceProvider } : {})
  };
}

function createChange(input: Omit<TerritoryDiffChange, "id">): TerritoryDiffChange {
  const oldPart = input.oldId ?? input.oldIds?.join("+") ?? "-";
  const newPart = input.newId ?? input.newIds?.join("+") ?? "-";

  return {
    id: `${input.category}:${oldPart}:${newPart}`,
    ...input
  };
}

function toPublicMatch(match: InternalMatch): TerritoryDiffMatch {
  return {
    oldId: match.oldZone.zone.id,
    newId: match.newZone.zone.id,
    categories: match.categories,
    confidence: match.confidence,
    requiresReview: match.requiresReview,
    strategy: match.strategy,
    ...(match.signals ? { signals: match.signals } : {})
  };
}

function toZoneRef(snapshot: ZoneSnapshot): TerritoryZoneRef {
  return {
    id: snapshot.zone.id,
    level: snapshot.zone.level,
    bbox: snapshot.bbox,
    center: snapshot.center,
    ...(snapshot.zone.countryCode ? { countryCode: snapshot.zone.countryCode } : {}),
    ...(snapshot.zone.localName ? { localName: snapshot.zone.localName } : {}),
    ...(snapshot.zone.name ? { name: snapshot.zone.name } : {}),
    ...(snapshot.zone.parentId ? { parentId: snapshot.zone.parentId } : {}),
    sourceNativeIds: snapshot.sourceNativeIds
  };
}

function toCandidateSignal(signal: OverlapSignal): TerritoryDiffCandidateSignal {
  return {
    id: signal.newZone.zone.id,
    confidence: roundRatio(signal.confidence),
    intersectionOverUnion: roundRatio(signal.intersectionOverUnion),
    overlapRatioNew: roundRatio(signal.overlapRatioNew),
    overlapRatioOld: roundRatio(signal.overlapRatioOld)
  };
}

function selectMappingType(
  categories: readonly TerritoryDiffCategory[]
): TerritoryMigrationMappingType {
  for (const category of [
    "renamed",
    "reparented",
    "metadata-changed",
    "geometry-changed",
    "license-changed",
    "source-changed"
  ] as const) {
    if (categories.includes(category)) {
      return category;
    }
  }

  return "unchanged";
}

function validateDatasetRef(
  input: unknown,
  path: string,
  issues: TerritoryMigrationPlanValidationIssue[]
): void {
  if (!isRecord(input)) {
    issues.push({
      code: "DATASET_REF",
      message: "Dataset ref must be an object.",
      path,
      severity: "error"
    });
    return;
  }

  for (const field of ["datasetId", "datasetVersion", "geometryHash", "sourceDate"]) {
    if (typeof input[field] !== "string" || input[field].length === 0) {
      issues.push({
        code: "DATASET_REF",
        message: `${field} must be a non-empty string.`,
        path: `${path}.${field}`,
        severity: "error"
      });
    }
  }
}

function validateMappings(
  mappings: unknown[],
  issues: TerritoryMigrationPlanValidationIssue[]
): void {
  const oldIds = new Set<string>();
  const newIds = new Set<string>();

  mappings.forEach((mapping, index) => {
    const path = `$.mappings[${index}]`;

    if (!isRecord(mapping)) {
      issues.push({
        code: "MAPPING_FIELD",
        message: "Mapping must be an object.",
        path,
        severity: "error"
      });
      return;
    }

    const oldId = typeof mapping.oldId === "string" ? mapping.oldId : undefined;
    const newId = typeof mapping.newId === "string" ? mapping.newId : undefined;
    const confidence = typeof mapping.confidence === "number" ? mapping.confidence : undefined;
    const requiresReview =
      typeof mapping.requiresReview === "boolean" ? mapping.requiresReview : undefined;

    if (!oldId) {
      issues.push({
        code: "MAPPING_FIELD",
        message: "oldId must be a non-empty string.",
        path: `${path}.oldId`,
        severity: "error"
      });
    } else if (oldIds.has(oldId)) {
      issues.push({
        code: "DUPLICATE_OLD_ID",
        message: `oldId '${oldId}' is mapped more than once.`,
        path: `${path}.oldId`,
        severity: "error"
      });
    } else {
      oldIds.add(oldId);
    }

    if (!newId) {
      issues.push({
        code: "MAPPING_FIELD",
        message: "newId must be a non-empty string.",
        path: `${path}.newId`,
        severity: "error"
      });
    } else if (newIds.has(newId) && requiresReview === false) {
      issues.push({
        code: "DUPLICATE_NEW_ID",
        message: `newId '${newId}' is automatically mapped more than once.`,
        path: `${path}.newId`,
        severity: "error"
      });
    } else {
      newIds.add(newId);
    }

    if (confidence === undefined || confidence < 0 || confidence > 1) {
      issues.push({
        code: "MAPPING_FIELD",
        message: "confidence must be a number from 0 through 1.",
        path: `${path}.confidence`,
        severity: "error"
      });
    }

    if (requiresReview === undefined) {
      issues.push({
        code: "MAPPING_FIELD",
        message: "requiresReview must be a boolean.",
        path: `${path}.requiresReview`,
        severity: "error"
      });
    }

    if (
      confidence !== undefined &&
      confidence < DEFAULT_DIFF_OPTIONS.automaticConfidenceThreshold &&
      requiresReview === false
    ) {
      issues.push({
        code: "LOW_CONFIDENCE_AUTOMATION",
        message: "Mappings below the automatic confidence threshold must require review.",
        path,
        severity: "error"
      });
    }
  });
}

function buildSourceKeyIndex(snapshots: readonly ZoneSnapshot[]): Map<string, ZoneSnapshot[]> {
  const entries: Array<[string, ZoneSnapshot]> = [];

  for (const snapshot of snapshots) {
    for (const sourceNativeId of snapshot.sourceNativeIds) {
      entries.push([
        [
          snapshot.zone.level,
          snapshot.zone.countryCode?.toUpperCase() ?? "",
          normalizeSourceNativeId(sourceNativeId)
        ].join("|"),
        snapshot
      ]);
    }
  }

  return groupEntries(entries);
}

function buildNameKeyIndex(snapshots: readonly ZoneSnapshot[]): Map<string, ZoneSnapshot[]> {
  const entries: Array<[string, ZoneSnapshot]> = [];

  for (const snapshot of snapshots) {
    for (const normalizedName of snapshot.normalizedNames) {
      entries.push([
        [
          snapshot.zone.level,
          snapshot.zone.countryCode?.toUpperCase() ?? "",
          snapshot.zone.parentId ?? "",
          normalizedName
        ].join("|"),
        snapshot
      ]);
    }
  }

  return groupEntries(entries);
}

function extractNames(zone: TerritoryZone): string[] {
  const territory = readTerritory(zone);
  const territoryNames = readRecord(territory?.names);
  const values = [
    zone.name,
    zone.localName,
    readString(zone.properties.name),
    readString(territoryNames?.default),
    ...Object.values(territoryNames ?? {}).map(readString)
  ];

  return uniqueSorted(
    values
      .filter(isString)
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function extractSourceNativeIds(zone: TerritoryZone): string[] {
  const territory = readTerritory(zone);
  const codes = readRecord(territory?.codes);
  const source = readRecord(territory?.source);
  const values = [
    readString(codes?.source),
    readString(codes?.official),
    readString(codes?.iso3166_2),
    readString(codes?.iso3166_1),
    readString(source?.sourceId),
    readString(zone.properties.sourceId),
    readString(zone.properties.sourceObjectId),
    readString(zone.properties.officialCode),
    readString(zone.properties.stableCode),
    readString(zone.properties.shapeID),
    readString(zone.properties.code)
  ];

  return uniqueSorted(
    values
      .filter(isString)
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function sameNameSet(left: ZoneSnapshot, right: ZoneSnapshot): boolean {
  if (left.normalizedNames.length === 0 || right.normalizedNames.length === 0) {
    return displayName(left.zone) === displayName(right.zone);
  }

  return left.normalizedNames.some((name) => right.normalizedNames.includes(name));
}

function zoneSourceFingerprint(zone: TerritoryZone): string {
  const territory = readTerritory(zone);
  return stableStringify(readRecord(territory?.source) ?? {});
}

function zoneLicense(zone: TerritoryZone): string | undefined {
  const source = readRecord(readTerritory(zone)?.source);
  return readString(source?.license);
}

function readTerritoryString(zone: TerritoryZone, key: string): string | undefined {
  return readString(readTerritory(zone)?.[key]);
}

function readTerritoryRecord(
  zone: TerritoryZone,
  key: string
): Record<string, unknown> | undefined {
  return readRecord(readTerritory(zone)?.[key]);
}

function readTerritory(zone: TerritoryZone): Record<string, unknown> | undefined {
  return readRecord(zone.properties.territory);
}

function displayName(zone: TerritoryZone): string {
  return zone.name ?? zone.localName ?? readString(zone.properties.name) ?? zone.id;
}

function normalizeDiffName(input: string): string {
  return input
    .replaceAll("İ", "I")
    .replaceAll("ı", "i")
    .replaceAll("Ğ", "G")
    .replaceAll("ğ", "g")
    .replaceAll("Ü", "U")
    .replaceAll("ü", "u")
    .replaceAll("Ş", "S")
    .replaceAll("ş", "s")
    .replaceAll("Ö", "O")
    .replaceAll("ö", "o")
    .replaceAll("Ç", "C")
    .replaceAll("ç", "c")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeSourceNativeId(input: string): string {
  return input.trim().toUpperCase();
}

function geometryArea(geometry: TerritoryGeometry): number {
  return geometryToPolygons(geometry).reduce((sum, polygon) => {
    const [outer, ...holes] = polygon;
    const outerArea = outer ? Math.abs(ringArea(outer)) : 0;
    const holeArea = holes.reduce((holeSum, ring) => holeSum + Math.abs(ringArea(ring)), 0);

    return sum + Math.max(0, outerArea - holeArea);
  }, 0);
}

function ringArea(ring: readonly LngLat[]): number {
  let area = 0;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index];
    const next = ring[index + 1];

    if (current && next) {
      area += current[0] * next[1] - next[0] * current[1];
    }
  }

  return area / 2;
}

function isGeometryTopologyValid(geometry: TerritoryGeometry): boolean {
  for (const polygon of geometryToPolygons(geometry)) {
    for (const ring of polygon) {
      const first = ring[0];
      const last = ring[ring.length - 1];

      if (!first || !last || ring.length < 4 || first[0] !== last[0] || first[1] !== last[1]) {
        return false;
      }

      if (hasRingSelfIntersection(ring)) {
        return false;
      }
    }
  }

  return true;
}

function normalizeBBox(input: TerritoryBBox): TerritoryBBox {
  return [
    roundCoordinate(input[0]),
    roundCoordinate(input[1]),
    roundCoordinate(input[2]),
    roundCoordinate(input[3])
  ];
}

function normalizeLngLat(input: LngLat): LngLat {
  return [roundCoordinate(input[0]), roundCoordinate(input[1])];
}

function expandBBox(bbox: TerritoryBBox, options: NormalizedDiffOptions): TerritoryBBox {
  const width = Math.max(0, bbox[2] - bbox[0]);
  const height = Math.max(0, bbox[3] - bbox[1]);
  const padding = Math.max(
    options.spatialMinPaddingDegrees,
    Math.max(width, height) * options.spatialPaddingRatio
  );

  return [bbox[0] - padding, bbox[1] - padding, bbox[2] + padding, bbox[3] + padding];
}

function bboxArea(bbox: TerritoryBBox): number {
  return Math.max(0, bbox[2] - bbox[0]) * Math.max(0, bbox[3] - bbox[1]);
}

function bboxIntersectionArea(left: TerritoryBBox, right: TerritoryBBox): number {
  const west = Math.max(left[0], right[0]);
  const south = Math.max(left[1], right[1]);
  const east = Math.min(left[2], right[2]);
  const north = Math.min(left[3], right[3]);

  return Math.max(0, east - west) * Math.max(0, north - south);
}

function bboxesIntersect(left: TerritoryBBox, right: TerritoryBBox): boolean {
  return !(left[2] < right[0] || right[2] < left[0] || left[3] < right[1] || right[3] < left[1]);
}

function bboxesEqual(left: TerritoryBBox, right: TerritoryBBox): boolean {
  return left.every((value, index) => Math.abs(value - (right[index] ?? Number.NaN)) <= 1e-9);
}

function pointWithinBBox(point: LngLat, bbox: TerritoryBBox): boolean {
  return point[0] >= bbox[0] && point[0] <= bbox[2] && point[1] >= bbox[1] && point[1] <= bbox[3];
}

function haversineMeters(left: LngLat, right: LngLat): number {
  const radiusMeters = 6_371_008.8;
  const leftLat = toRadians(left[1]);
  const rightLat = toRadians(right[1]);
  const deltaLat = toRadians(right[1] - left[1]);
  const deltaLng = toRadians(right[0] - left[0]);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(deltaLng / 2) ** 2;

  return radiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function percentChange(oldValue: number, newValue: number): number {
  if (oldValue === 0) {
    return newValue === 0 ? 0 : 100;
  }

  return roundMetric((Math.abs(newValue - oldValue) / Math.abs(oldValue)) * 100);
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}

function roundRatio(value: number): number {
  return Number(clamp(value, 0, 1).toFixed(6));
}

function roundMeters(value: number): number {
  return Number(value.toFixed(3));
}

function roundCoordinate(value: number): number {
  return Number(value.toFixed(9));
}

function roundPercent(value: number): number {
  return Number((value * 100).toFixed(2));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hasParentCycle(snapshot: ZoneSnapshot, byId: Map<string, ZoneSnapshot>): boolean {
  const visited = new Set<string>();
  let current: ZoneSnapshot | undefined = snapshot;

  while (current) {
    if (visited.has(current.zone.id)) {
      return true;
    }

    visited.add(current.zone.id);
    current = current.zone.parentId ? byId.get(current.zone.parentId) : undefined;
  }

  return false;
}

function isSnapshotMatchable(
  snapshot: ZoneSnapshot,
  state: MatchingState,
  side: "old" | "new"
): boolean {
  return side === "old"
    ? !state.matchedOldKeys.has(snapshot.key) && !state.blockedOldKeys.has(snapshot.key)
    : !state.matchedNewKeys.has(snapshot.key) && !state.blockedNewKeys.has(snapshot.key);
}

function createCategoryCounts(): Record<TerritoryDiffCategory, number> {
  return Object.fromEntries(TERRITORY_DIFF_CATEGORIES.map((category) => [category, 0])) as Record<
    TerritoryDiffCategory,
    number
  >;
}

function uniqueCategories(categories: readonly TerritoryDiffCategory[]): TerritoryDiffCategory[] {
  return TERRITORY_DIFF_CATEGORIES.filter((category) => categories.includes(category));
}

function createCountChanges(
  oldCounts: Map<string, number>,
  newCounts: Map<string, number>
): TerritoryCoverageCountChange[] {
  return uniqueSorted([...oldCounts.keys(), ...newCounts.keys()]).map((key) => {
    const oldValue = oldCounts.get(key) ?? 0;
    const newValue = newCounts.get(key) ?? 0;

    return {
      key,
      old: oldValue,
      new: newValue,
      added: Math.max(0, newValue - oldValue),
      removed: Math.max(0, oldValue - newValue),
      delta: newValue - oldValue
    };
  });
}

function createSetChange(
  oldValues: readonly string[],
  newValues: readonly string[]
): TerritoryCoverageSetChange {
  const oldSet = uniqueSorted(oldValues);
  const newSet = uniqueSorted(newValues);

  return {
    old: oldSet,
    new: newSet,
    added: newSet.filter((value) => !oldSet.includes(value)),
    removed: oldSet.filter((value) => !newSet.includes(value))
  };
}

function countBy<T>(items: readonly T[], getKey: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();

  for (const item of items) {
    const key = getKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

function groupSnapshots(
  snapshots: readonly ZoneSnapshot[],
  getKey: (snapshot: ZoneSnapshot) => string
): Map<string, ZoneSnapshot[]> {
  const groups = new Map<string, ZoneSnapshot[]>();

  for (const snapshot of snapshots) {
    const key = getKey(snapshot);
    const group = groups.get(key);

    if (group) {
      group.push(snapshot);
    } else {
      groups.set(key, [snapshot]);
    }
  }

  return groups;
}

function groupBy<T>(items: readonly T[], getKey: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const key = getKey(item);
    const group = groups.get(key);

    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  return groups;
}

function groupEntries<T>(entries: ReadonlyArray<[string, T]>): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const [key, value] of entries) {
    const group = groups.get(key);

    if (group) {
      group.push(value);
    } else {
      groups.set(key, [value]);
    }
  }

  return groups;
}

function stableStringify(input: unknown): string {
  if (input === null || typeof input !== "object") {
    return JSON.stringify(input);
  }

  if (Array.isArray(input)) {
    return `[${input.map(stableStringify).join(",")}]`;
  }

  const record = input as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function readRecord(input: unknown): Record<string, unknown> | undefined {
  return isRecord(input) ? input : undefined;
}

function readObjectString(input: object, key: string): string | undefined {
  return readString((input as Record<string, unknown>)[key]);
}

function readString(input: unknown): string | undefined {
  if (typeof input === "string" && input.length > 0) {
    return input;
  }

  if (typeof input === "number" && Number.isFinite(input)) {
    return String(input);
  }

  return undefined;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isString(input: unknown): input is string {
  return typeof input === "string" && input.length > 0;
}

function isAdminLevelField(field: string): boolean {
  return field === "level" || field === "sourceAdminLevel" || field.endsWith(".adminLevel");
}

function capitalize(input: string): string {
  return `${input.slice(0, 1).toUpperCase()}${input.slice(1)}`;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function dedupeChanges(changes: readonly TerritoryDiffChange[]): TerritoryDiffChange[] {
  const byId = new Map<string, TerritoryDiffChange>();

  for (const change of changes) {
    byId.set(change.id, change);
  }

  return [...byId.values()];
}

function sortChanges(changes: readonly TerritoryDiffChange[]): TerritoryDiffChange[] {
  return [...changes].sort((left, right) => {
    const category = categoryRank(left.category) - categoryRank(right.category);

    if (category !== 0) {
      return category;
    }

    return (
      (left.oldId ?? left.oldIds?.join(",") ?? "").localeCompare(
        right.oldId ?? right.oldIds?.join(",") ?? ""
      ) ||
      (left.newId ?? left.newIds?.join(",") ?? "").localeCompare(
        right.newId ?? right.newIds?.join(",") ?? ""
      ) ||
      left.reason.localeCompare(right.reason)
    );
  });
}

function categoryRank(category: TerritoryDiffCategory): number {
  return TERRITORY_DIFF_CATEGORIES.indexOf(category);
}

function compareMatches(left: TerritoryDiffMatch, right: TerritoryDiffMatch): number {
  return left.oldId.localeCompare(right.oldId) || left.newId.localeCompare(right.newId);
}

function compareMappings(
  left: TerritoryMigrationMapping,
  right: TerritoryMigrationMapping
): number {
  return left.oldId.localeCompare(right.oldId) || left.newId.localeCompare(right.newId);
}

function compareReviewItems(
  left: TerritoryMigrationReviewItem,
  right: TerritoryMigrationReviewItem
): number {
  return (
    categoryRank(left.category) - categoryRank(right.category) ||
    (left.oldId ?? left.oldIds?.join(",") ?? "").localeCompare(
      right.oldId ?? right.oldIds?.join(",") ?? ""
    ) ||
    (left.newId ?? left.newIds?.join(",") ?? "").localeCompare(
      right.newId ?? right.newIds?.join(",") ?? ""
    ) ||
    left.reason.localeCompare(right.reason)
  );
}

function compareBreakingChanges(
  left: TerritoryBreakingChange,
  right: TerritoryBreakingChange
): number {
  return (
    left.severity.localeCompare(right.severity) ||
    left.code.localeCompare(right.code) ||
    (left.oldId ?? "").localeCompare(right.oldId ?? "") ||
    (left.newId ?? "").localeCompare(right.newId ?? "") ||
    left.message.localeCompare(right.message)
  );
}

function compareSnapshotsByWest(left: ZoneSnapshot, right: ZoneSnapshot): number {
  return left.bbox[0] - right.bbox[0] || compareSnapshotIds(left, right);
}

function compareSnapshotIds(left: ZoneSnapshot, right: ZoneSnapshot): number {
  return left.zone.id.localeCompare(right.zone.id) || left.index - right.index;
}

function compareOverlapSignals(left: OverlapSignal, right: OverlapSignal): number {
  return (
    right.confidence - left.confidence ||
    left.oldZone.zone.id.localeCompare(right.oldZone.zone.id) ||
    left.newZone.zone.id.localeCompare(right.newZone.zone.id)
  );
}

function compareOverlapSignalGroups(left: OverlapSignal[], right: OverlapSignal[]): number {
  const leftFirst = left[0];
  const rightFirst = right[0];

  if (!leftFirst || !rightFirst) {
    return left.length - right.length;
  }

  return compareOverlapSignals(leftFirst, rightFirst);
}

function compareGeometryCandidates(
  left: {
    id: string;
    confidence: number;
  },
  right: {
    id: string;
    confidence: number;
  }
): number {
  return right.confidence - left.confidence || left.id.localeCompare(right.id);
}

function compareGeometryProposals(left: GeometryProposal, right: GeometryProposal): number {
  return (
    right.confidence - left.confidence ||
    left.oldZone.zone.id.localeCompare(right.oldZone.zone.id) ||
    left.newZone.zone.id.localeCompare(right.newZone.zone.id)
  );
}

function compareCandidateSignals(
  left: TerritoryDiffCandidateSignal,
  right: TerritoryDiffCandidateSignal
): number {
  return right.confidence - left.confidence || left.id.localeCompare(right.id);
}
