import { sha256HexFromUtf8 } from "./sha256-hex.js";

export const MAHALLE_HUMAN_REVIEW_QUEUE_SCHEMA_VERSION =
  "territorykit-tr-mahalle-human-review-queue@1";

export const MAHALLE_HUMAN_REVIEW_DECISION_LEDGER_SCHEMA_VERSION =
  "territorykit-tr-mahalle-human-review-decision-ledger@1";

export const MAHALLE_HUMAN_REVIEW_DECISION_ENTRY_SCHEMA_VERSION =
  "territorykit-tr-mahalle-human-review-decision-entry@1";

export const MAHALLE_HUMAN_REVIEW_DECISION_STATES = [
  "pending",
  "needs-evidence",
  "approved-semantic-label",
  "rejected",
  "superseded"
] as const;

export type MahalleHumanReviewDecisionState = (typeof MAHALLE_HUMAN_REVIEW_DECISION_STATES)[number];

export const MAHALLE_HUMAN_REVIEW_VALIDATION_CODES = [
  "REVIEW_RECORD_ID_MISSING",
  "REVIEW_RECORD_ID_DUPLICATE",
  "REVIEWER_MISSING",
  "REVIEWER_CONFLICT",
  "RATIONALE_MISSING",
  "DECISION_STATE_INVALID",
  "STALE_ZONE_ID",
  "STALE_GEOMETRY_HASH",
  "STALE_SETTLEMENT_IDS",
  "STALE_SOURCE_SNAPSHOT",
  "STALE_IDENTITY_LAYER_VERSION",
  "STALE_IDENTITY_LAYER_CHECKSUM",
  "STALE_DATASET_VERSION",
  "STALE_PARENT_ADM2",
  "STALE_REASON_CODES",
  "EVIDENCE_LINKS_MISSING",
  "UNAUTHORIZED_LABEL_PROMOTION",
  "MISSING_REDISTRIBUTION_APPROVAL",
  "OFFICIAL_BOUNDARY_CONFLATION",
  "HISTORY_INTEGRITY_BREACH",
  "SUPERSEDED_WITHOUT_TARGET",
  "PENDING_CANNOT_PUBLISH"
] as const;

export type MahalleHumanReviewValidationCode =
  (typeof MAHALLE_HUMAN_REVIEW_VALIDATION_CODES)[number];

export interface MahalleHumanReviewValidationIssue {
  code: MahalleHumanReviewValidationCode | string;
  severity: "error" | "warning";
  message: string;
  reviewRecordId?: string;
  path?: string;
}

export interface MahalleHumanReviewQueueRecord {
  reviewRecordId?: string;
  stableZoneId: string | null;
  district: string;
  parentAdm2Id: string | null;
  settlementIds: string[];
  seedNames?: string[];
  coordinates?: number[][];
  sourceProvenance?: {
    gameplayShard?: string;
    barrierSnapshotSha256?: string | null;
    osmSourceLockState?: string;
  } | null;
  geometryClassification?: string;
  ambiguityReasonCodes: string[];
  reviewPriority?: number;
  proposedAction?: string;
  reviewer?: string | null;
  reviewDecision?: string;
  autoDisplayNameAllowed?: boolean;
  evidenceLinks?: string[];
}

export interface MahalleHumanReviewContextPin {
  stableZoneId: string | null;
  parentAdm2Id: string | null;
  settlementIds: string[];
  ambiguityReasonCodes: string[];
  zoneGeometryHash: string | null;
  districtZoneIdSetSha256: string | null;
  districtGeometryHashSetSha256: string | null;
  identityLayerVersion: string | null;
  identityLayerContentChecksum: string | null;
  gameplayDatasetVersion: string | null;
  osmSnapshotSha256: string | null;
  reviewQueueGeneratedAt: string | null;
}

export interface MahalleHumanReviewReviewer {
  id: string;
  displayName?: string;
}

export interface MahalleHumanReviewDecisionHistoryEntry {
  decisionSchemaVersion: string;
  state: MahalleHumanReviewDecisionState;
  reviewer: MahalleHumanReviewReviewer;
  reviewedAt: string;
  rationale: string;
  pins: MahalleHumanReviewContextPin;
  approvedSemanticLabel?: string | null;
  /** Semantic review only — never promotes gameplay polygon to official mahalle boundary. */
  officialBoundaryVerification: false;
  redistributionRightsApproved: false;
  supersededBy?: string | null;
}

export interface MahalleHumanReviewDecisionEntry {
  decisionSchemaVersion: string;
  reviewRecordId: string;
  district: string;
  parentAdm2Id: string | null;
  stableZoneId: string | null;
  currentState: MahalleHumanReviewDecisionState;
  autoDisplayNameAllowed: false;
  pins: MahalleHumanReviewContextPin;
  evidenceLinks: string[];
  history: MahalleHumanReviewDecisionHistoryEntry[];
}

export interface MahalleHumanReviewDecisionLedger {
  schemaVersion: string;
  generatedAt: string;
  programBaseline: {
    reviewQueueSchemaVersion: string;
    reviewQueueGeneratedAt: string;
    reviewRecordCount: number;
    gameplayZoneCount: number;
    settlementRecords: number;
  };
  redistributionRightsApproved: false;
  officialVerifiedPolygonCount: number;
  entries: MahalleHumanReviewDecisionEntry[];
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function sha256HexFromStableJson(input: unknown): string {
  return sha256HexFromUtf8(stableStringify(input));
}

export function computeMahalleHumanReviewRecordId(
  record: Pick<
    MahalleHumanReviewQueueRecord,
    "stableZoneId" | "district" | "ambiguityReasonCodes" | "settlementIds"
  >
): string {
  const payload = {
    district: record.district,
    stableZoneId: record.stableZoneId,
    ambiguityReasonCodes: [...record.ambiguityReasonCodes].sort(),
    settlementIds: [...record.settlementIds].sort((left, right) => left.localeCompare(right))
  };
  return `tr:mahalle-review:${sha256HexFromStableJson(payload).slice(0, 32)}`;
}

export function buildMahalleHumanReviewContextPin(input: {
  queueRecord: MahalleHumanReviewQueueRecord;
  reviewQueueGeneratedAt: string;
  zoneGeometryHash?: string | null;
  districtPins?: {
    zoneIdSetSha256?: string | null;
    geometryHashSetSha256?: string | null;
    identityLayerVersion?: string | null;
    identityLayerContentChecksum?: string | null;
    gameplayDatasetVersion?: string | null;
  };
}): MahalleHumanReviewContextPin {
  const { queueRecord } = input;
  return {
    stableZoneId: queueRecord.stableZoneId,
    parentAdm2Id: queueRecord.parentAdm2Id,
    settlementIds: [...queueRecord.settlementIds].sort((left, right) => left.localeCompare(right)),
    ambiguityReasonCodes: [...queueRecord.ambiguityReasonCodes].sort(),
    zoneGeometryHash: input.zoneGeometryHash ?? null,
    districtZoneIdSetSha256: input.districtPins?.zoneIdSetSha256 ?? null,
    districtGeometryHashSetSha256: input.districtPins?.geometryHashSetSha256 ?? null,
    identityLayerVersion: input.districtPins?.identityLayerVersion ?? null,
    identityLayerContentChecksum: input.districtPins?.identityLayerContentChecksum ?? null,
    gameplayDatasetVersion: input.districtPins?.gameplayDatasetVersion ?? null,
    osmSnapshotSha256: queueRecord.sourceProvenance?.barrierSnapshotSha256 ?? null,
    reviewQueueGeneratedAt: input.reviewQueueGeneratedAt
  };
}

export function createPendingMahalleHumanReviewDecisionEntry(input: {
  queueRecord: MahalleHumanReviewQueueRecord;
  reviewQueueGeneratedAt: string;
  pins: MahalleHumanReviewContextPin;
}): MahalleHumanReviewDecisionEntry {
  const reviewRecordId =
    input.queueRecord.reviewRecordId ?? computeMahalleHumanReviewRecordId(input.queueRecord);

  return {
    decisionSchemaVersion: MAHALLE_HUMAN_REVIEW_DECISION_ENTRY_SCHEMA_VERSION,
    reviewRecordId,
    district: input.queueRecord.district,
    parentAdm2Id: input.queueRecord.parentAdm2Id,
    stableZoneId: input.queueRecord.stableZoneId,
    currentState: "pending",
    autoDisplayNameAllowed: false,
    pins: input.pins,
    evidenceLinks: [...(input.queueRecord.evidenceLinks ?? [])],
    history: []
  };
}

export function resolveMahalleReviewAutoDisplayNameAllowed(input: {
  currentState: MahalleHumanReviewDecisionState;
  redistributionRightsApproved: boolean;
}): false {
  if (
    input.currentState === "approved-semantic-label" &&
    input.redistributionRightsApproved === true
  ) {
    return false;
  }
  return false;
}

export function compareMahalleHumanReviewPins(
  expected: MahalleHumanReviewContextPin,
  observed: MahalleHumanReviewContextPin
): MahalleHumanReviewValidationIssue[] {
  const issues: MahalleHumanReviewValidationIssue[] = [];

  if (expected.stableZoneId !== observed.stableZoneId) {
    issues.push({
      code: "STALE_ZONE_ID",
      severity: "error",
      message: `Stable zone ID changed (${expected.stableZoneId} → ${observed.stableZoneId}).`
    });
  }
  if (expected.parentAdm2Id !== observed.parentAdm2Id) {
    issues.push({
      code: "STALE_PARENT_ADM2",
      severity: "error",
      message: `Parent ADM2 changed (${expected.parentAdm2Id} → ${observed.parentAdm2Id}).`
    });
  }
  const expectedSettlements = [...expected.settlementIds].sort().join("|");
  const observedSettlements = [...observed.settlementIds].sort().join("|");
  if (expectedSettlements !== observedSettlements) {
    issues.push({
      code: "STALE_SETTLEMENT_IDS",
      severity: "error",
      message: "Settlement identity references changed since review context was pinned."
    });
  }
  const expectedReasons = [...expected.ambiguityReasonCodes].sort().join("|");
  const observedReasons = [...observed.ambiguityReasonCodes].sort().join("|");
  if (expectedReasons !== observedReasons) {
    issues.push({
      code: "STALE_REASON_CODES",
      severity: "error",
      message: "Review reason codes changed since review context was pinned."
    });
  }
  if (
    expected.zoneGeometryHash &&
    observed.zoneGeometryHash &&
    expected.zoneGeometryHash !== observed.zoneGeometryHash
  ) {
    issues.push({
      code: "STALE_GEOMETRY_HASH",
      severity: "error",
      message: "Gameplay zone geometry hash changed; prior human decisions are stale."
    });
  }
  if (
    expected.osmSnapshotSha256 &&
    observed.osmSnapshotSha256 &&
    expected.osmSnapshotSha256 !== observed.osmSnapshotSha256
  ) {
    issues.push({
      code: "STALE_SOURCE_SNAPSHOT",
      severity: "error",
      message: "OSM snapshot checksum changed since review context was pinned."
    });
  }
  if (
    expected.identityLayerVersion &&
    observed.identityLayerVersion &&
    expected.identityLayerVersion !== observed.identityLayerVersion
  ) {
    issues.push({
      code: "STALE_IDENTITY_LAYER_VERSION",
      severity: "error",
      message: "Identity layer version changed since review context was pinned."
    });
  }
  if (
    expected.identityLayerContentChecksum &&
    observed.identityLayerContentChecksum &&
    expected.identityLayerContentChecksum !== observed.identityLayerContentChecksum
  ) {
    issues.push({
      code: "STALE_IDENTITY_LAYER_CHECKSUM",
      severity: "error",
      message: "Identity layer content checksum changed since review context was pinned."
    });
  }
  if (
    expected.gameplayDatasetVersion &&
    observed.gameplayDatasetVersion &&
    expected.gameplayDatasetVersion !== observed.gameplayDatasetVersion
  ) {
    issues.push({
      code: "STALE_DATASET_VERSION",
      severity: "error",
      message: "Gameplay dataset version changed since review context was pinned."
    });
  }

  return issues;
}

export interface ValidateMahalleHumanReviewDecisionSubmissionOptions {
  entry: MahalleHumanReviewDecisionEntry;
  submission: {
    state: MahalleHumanReviewDecisionState;
    reviewer: MahalleHumanReviewReviewer;
    rationale: string;
    reviewedAt: string;
    pins: MahalleHumanReviewContextPin;
    approvedSemanticLabel?: string | null;
    supersededBy?: string | null;
  };
  redistributionRightsApproved: boolean;
}

export function validateMahalleHumanReviewDecisionSubmission(
  options: ValidateMahalleHumanReviewDecisionSubmissionOptions
): { ok: boolean; issues: MahalleHumanReviewValidationIssue[] } {
  const issues: MahalleHumanReviewValidationIssue[] = [];
  const { entry, submission, redistributionRightsApproved } = options;

  if (!entry.reviewRecordId) {
    issues.push({
      code: "REVIEW_RECORD_ID_MISSING",
      severity: "error",
      message: "Review record ID is required.",
      reviewRecordId: entry.reviewRecordId
    });
  }

  if (!submission.reviewer?.id?.trim()) {
    issues.push({
      code: "REVIEWER_MISSING",
      severity: "error",
      message: "Reviewer identity is required for attributable decisions.",
      reviewRecordId: entry.reviewRecordId
    });
  }

  if (!submission.rationale?.trim()) {
    issues.push({
      code: "RATIONALE_MISSING",
      severity: "error",
      message: "Decision rationale is required.",
      reviewRecordId: entry.reviewRecordId
    });
  }

  if (!MAHALLE_HUMAN_REVIEW_DECISION_STATES.includes(submission.state)) {
    issues.push({
      code: "DECISION_STATE_INVALID",
      severity: "error",
      message: `Invalid decision state: ${submission.state}`,
      reviewRecordId: entry.reviewRecordId
    });
  }

  if (submission.state === "pending") {
    issues.push({
      code: "PENDING_CANNOT_PUBLISH",
      severity: "error",
      message: "Cannot submit a decision history entry with pending state.",
      reviewRecordId: entry.reviewRecordId
    });
  }

  if (submission.state === "superseded" && !submission.supersededBy?.trim()) {
    issues.push({
      code: "SUPERSEDED_WITHOUT_TARGET",
      severity: "error",
      message: "Superseded decisions must reference supersededBy review record id.",
      reviewRecordId: entry.reviewRecordId
    });
  }

  if (entry.evidenceLinks.length === 0) {
    issues.push({
      code: "EVIDENCE_LINKS_MISSING",
      severity: "warning",
      message: "No evidence links on review record.",
      reviewRecordId: entry.reviewRecordId
    });
  }

  issues.push(...compareMahalleHumanReviewPins(entry.pins, submission.pins));

  if (submission.state === "approved-semantic-label") {
    if (!submission.approvedSemanticLabel?.trim()) {
      issues.push({
        code: "UNAUTHORIZED_LABEL_PROMOTION",
        severity: "error",
        message: "approved-semantic-label requires an explicit approvedSemanticLabel string.",
        reviewRecordId: entry.reviewRecordId
      });
    }
    if (!redistributionRightsApproved) {
      issues.push({
        code: "MISSING_REDISTRIBUTION_APPROVAL",
        severity: "warning",
        message:
          "Semantic label approval does not grant public distribution without redistribution rights clearance.",
        reviewRecordId: entry.reviewRecordId
      });
    }
  }

  const lastReviewer = entry.history.at(-1)?.reviewer.id;
  if (
    lastReviewer &&
    submission.reviewer.id &&
    lastReviewer !== submission.reviewer.id &&
    submission.state !== "superseded"
  ) {
    issues.push({
      code: "REVIEWER_CONFLICT",
      severity: "warning",
      message: `Reviewer changed from ${lastReviewer} to ${submission.reviewer.id} without supersede flow.`,
      reviewRecordId: entry.reviewRecordId
    });
  }

  const hardErrors = issues.filter((issue) => issue.severity === "error");
  return { ok: hardErrors.length === 0, issues };
}

export function appendMahalleHumanReviewDecisionHistory(
  entry: MahalleHumanReviewDecisionEntry,
  submission: ValidateMahalleHumanReviewDecisionSubmissionOptions["submission"]
): MahalleHumanReviewDecisionEntry {
  const historyEntry: MahalleHumanReviewDecisionHistoryEntry = {
    decisionSchemaVersion: MAHALLE_HUMAN_REVIEW_DECISION_ENTRY_SCHEMA_VERSION,
    state: submission.state,
    reviewer: submission.reviewer,
    reviewedAt: submission.reviewedAt,
    rationale: submission.rationale.trim(),
    pins: submission.pins,
    approvedSemanticLabel: submission.approvedSemanticLabel ?? null,
    officialBoundaryVerification: false,
    redistributionRightsApproved: false,
    supersededBy: submission.supersededBy ?? null
  };

  return {
    ...entry,
    currentState: submission.state,
    autoDisplayNameAllowed: false,
    pins: submission.pins,
    history: [...entry.history, historyEntry]
  };
}

export function validateMahalleHumanReviewDecisionLedger(
  ledger: MahalleHumanReviewDecisionLedger
): { ok: boolean; issues: MahalleHumanReviewValidationIssue[] } {
  const issues: MahalleHumanReviewValidationIssue[] = [];
  const ids = new Set<string>();

  if (ledger.schemaVersion !== MAHALLE_HUMAN_REVIEW_DECISION_LEDGER_SCHEMA_VERSION) {
    issues.push({
      code: "HISTORY_INTEGRITY_BREACH",
      severity: "error",
      message: `Unexpected ledger schema ${ledger.schemaVersion}.`
    });
  }

  if (ledger.redistributionRightsApproved !== false) {
    issues.push({
      code: "MISSING_REDISTRIBUTION_APPROVAL",
      severity: "error",
      message: "Ledger must not claim redistribution approval in Sprint 2F."
    });
  }

  for (const entry of ledger.entries) {
    if (!entry.reviewRecordId) {
      issues.push({
        code: "REVIEW_RECORD_ID_MISSING",
        severity: "error",
        message: "Entry missing reviewRecordId."
      });
      continue;
    }
    if (ids.has(entry.reviewRecordId)) {
      issues.push({
        code: "REVIEW_RECORD_ID_DUPLICATE",
        severity: "error",
        message: `Duplicate reviewRecordId ${entry.reviewRecordId}.`,
        reviewRecordId: entry.reviewRecordId
      });
    }
    ids.add(entry.reviewRecordId);

    if (entry.autoDisplayNameAllowed !== false) {
      issues.push({
        code: "UNAUTHORIZED_LABEL_PROMOTION",
        severity: "error",
        message: "autoDisplayNameAllowed must remain false until legal clearance exists.",
        reviewRecordId: entry.reviewRecordId
      });
    }

    for (let index = 0; index < entry.history.length; index += 1) {
      const row = entry.history[index];
      if (!row) {
        continue;
      }
      if (row.officialBoundaryVerification !== false) {
        issues.push({
          code: "OFFICIAL_BOUNDARY_CONFLATION",
          severity: "error",
          message: "Human semantic review cannot assert official boundary verification.",
          reviewRecordId: entry.reviewRecordId,
          path: `history[${index}].officialBoundaryVerification`
        });
      }
      if (row.redistributionRightsApproved !== false) {
        issues.push({
          code: "MISSING_REDISTRIBUTION_APPROVAL",
          severity: "error",
          message: "History entries must not claim redistribution approval.",
          reviewRecordId: entry.reviewRecordId,
          path: `history[${index}].redistributionRightsApproved`
        });
      }
      if (index > 0) {
        const previous = entry.history[index - 1];
        if (
          previous &&
          previous.state !== "superseded" &&
          row.reviewer.id !== previous.reviewer.id
        ) {
          issues.push({
            code: "REVIEWER_CONFLICT",
            severity: "warning",
            message: "Reviewer changed without superseding prior decision.",
            reviewRecordId: entry.reviewRecordId
          });
        }
      }
    }

    if (
      (entry.currentState === "rejected" || entry.currentState === "pending") &&
      entry.autoDisplayNameAllowed !== false
    ) {
      issues.push({
        code: "UNAUTHORIZED_LABEL_PROMOTION",
        severity: "error",
        message: "Rejected or pending records cannot enable display promotion.",
        reviewRecordId: entry.reviewRecordId
      });
    }
  }

  const hardErrors = issues.filter((issue) => issue.severity === "error");
  return { ok: hardErrors.length === 0, issues };
}

export function countMahalleHumanReviewDecisionStates(
  ledger: MahalleHumanReviewDecisionLedger
): Record<MahalleHumanReviewDecisionState, number> {
  const counts = Object.fromEntries(
    MAHALLE_HUMAN_REVIEW_DECISION_STATES.map((state) => [state, 0])
  ) as Record<MahalleHumanReviewDecisionState, number>;

  for (const entry of ledger.entries) {
    counts[entry.currentState] += 1;
  }
  return counts;
}

export function countAttributedHumanReviewDecisions(
  ledger: MahalleHumanReviewDecisionLedger
): number {
  let total = 0;
  for (const entry of ledger.entries) {
    total += entry.history.length;
  }
  return total;
}
