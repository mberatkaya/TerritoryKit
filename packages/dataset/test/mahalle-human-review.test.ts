import { describe, expect, it } from "vitest";
import {
  MAHALLE_HUMAN_REVIEW_DECISION_ENTRY_SCHEMA_VERSION,
  appendMahalleHumanReviewDecisionHistory,
  buildMahalleHumanReviewContextPin,
  compareMahalleHumanReviewPins,
  computeMahalleHumanReviewRecordId,
  countAttributedHumanReviewDecisions,
  createPendingMahalleHumanReviewDecisionEntry,
  validateMahalleHumanReviewDecisionLedger,
  validateMahalleHumanReviewDecisionSubmission,
  type MahalleHumanReviewDecisionLedger,
  type MahalleHumanReviewQueueRecord
} from "../src/mahalle-human-review.js";

const baseQueueRecord: MahalleHumanReviewQueueRecord = {
  stableZoneId: "tr:adm3:zone-a",
  district: "Fatih",
  parentAdm2Id: "tr:adm2:54988432b39641834885080",
  settlementIds: ["tr:settlement:osm:node:1", "tr:settlement:osm:node:2"],
  ambiguityReasonCodes: ["AMBIGUOUS_MULTI_SEED_ZONE"],
  evidenceLinks: ["reports/tr-adm3/mahalle-identity-layer/fatih-zone-associations.json"],
  sourceProvenance: {
    barrierSnapshotSha256: "abc123"
  }
};

function basePins() {
  return buildMahalleHumanReviewContextPin({
    queueRecord: baseQueueRecord,
    reviewQueueGeneratedAt: "2026-10-17T14:03:06.653Z",
    zoneGeometryHash: "geom-hash-a",
    districtPins: {
      zoneIdSetSha256: "zone-set",
      geometryHashSetSha256: "geom-set",
      identityLayerVersion: "tr-mahalle-identity-fatih-pilot@2026-10-15",
      identityLayerContentChecksum: "layer-checksum",
      gameplayDatasetVersion: "2.1.0-rc.8"
    }
  });
}

describe("mahalle human review decisions", () => {
  it("computes stable review record ids", () => {
    const first = computeMahalleHumanReviewRecordId(baseQueueRecord);
    const second = computeMahalleHumanReviewRecordId({
      ...baseQueueRecord,
      settlementIds: ["tr:settlement:osm:node:2", "tr:settlement:osm:node:1"]
    });
    expect(first).toBe(second);
    expect(first.startsWith("tr:mahalle-review:")).toBe(true);
  });

  it("rejects decision submission without reviewer", () => {
    const entry = createPendingMahalleHumanReviewDecisionEntry({
      queueRecord: baseQueueRecord,
      reviewQueueGeneratedAt: "2026-10-17T14:03:06.653Z",
      pins: basePins()
    });
    const result = validateMahalleHumanReviewDecisionSubmission({
      entry,
      redistributionRightsApproved: false,
      submission: {
        state: "approved-semantic-label",
        reviewer: { id: "" },
        rationale: "Label association reviewed.",
        reviewedAt: "2026-10-17T15:00:00.000Z",
        pins: basePins(),
        approvedSemanticLabel: "Samatya"
      }
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === "REVIEWER_MISSING")).toBe(true);
  });

  it("rejects missing rationale and pending publish", () => {
    const entry = createPendingMahalleHumanReviewDecisionEntry({
      queueRecord: baseQueueRecord,
      reviewQueueGeneratedAt: "2026-10-17T14:03:06.653Z",
      pins: basePins()
    });
    const missingRationale = validateMahalleHumanReviewDecisionSubmission({
      entry,
      redistributionRightsApproved: false,
      submission: {
        state: "rejected",
        reviewer: { id: "reviewer@example.org" },
        rationale: "   ",
        reviewedAt: "2026-10-17T15:00:00.000Z",
        pins: basePins()
      }
    });
    expect(missingRationale.ok).toBe(false);

    const pendingPublish = validateMahalleHumanReviewDecisionSubmission({
      entry,
      redistributionRightsApproved: false,
      submission: {
        state: "pending",
        reviewer: { id: "reviewer@example.org" },
        rationale: "still pending",
        reviewedAt: "2026-10-17T15:00:00.000Z",
        pins: basePins()
      }
    });
    expect(pendingPublish.ok).toBe(false);
  });

  it("detects stale geometry and snapshot pins", () => {
    const expected = basePins();
    const observed = {
      ...basePins(),
      zoneGeometryHash: "geom-hash-b",
      osmSnapshotSha256: "different-snapshot"
    };
    const issues = compareMahalleHumanReviewPins(expected, observed);
    expect(issues.some((issue) => issue.code === "STALE_GEOMETRY_HASH")).toBe(true);
    expect(issues.some((issue) => issue.code === "STALE_SOURCE_SNAPSHOT")).toBe(true);
  });

  it("keeps autoDisplayNameAllowed false after semantic approval", () => {
    const entry = createPendingMahalleHumanReviewDecisionEntry({
      queueRecord: baseQueueRecord,
      reviewQueueGeneratedAt: "2026-10-17T14:03:06.653Z",
      pins: basePins()
    });
    const validation = validateMahalleHumanReviewDecisionSubmission({
      entry,
      redistributionRightsApproved: false,
      submission: {
        state: "approved-semantic-label",
        reviewer: { id: "human.reviewer@territorykit.local" },
        rationale: "Primary seed label selected for consumer display semantics only.",
        reviewedAt: "2026-10-17T15:00:00.000Z",
        pins: basePins(),
        approvedSemanticLabel: "Samatya"
      }
    });
    expect(validation.ok).toBe(true);
    const updated = appendMahalleHumanReviewDecisionHistory(entry, {
      state: "approved-semantic-label",
      reviewer: { id: "human.reviewer@territorykit.local" },
      rationale: "Primary seed label selected for consumer display semantics only.",
      reviewedAt: "2026-10-17T15:00:00.000Z",
      pins: basePins(),
      approvedSemanticLabel: "Samatya"
    });
    expect(updated.autoDisplayNameAllowed).toBe(false);
    expect(updated.history[0]?.officialBoundaryVerification).toBe(false);
  });

  it("validates ledger integrity and duplicate ids", () => {
    const entry = createPendingMahalleHumanReviewDecisionEntry({
      queueRecord: baseQueueRecord,
      reviewQueueGeneratedAt: "2026-10-17T14:03:06.653Z",
      pins: basePins()
    });
    const ledger: MahalleHumanReviewDecisionLedger = {
      schemaVersion: "territorykit-tr-mahalle-human-review-decision-ledger@1",
      generatedAt: "2026-10-17T15:00:00.000Z",
      programBaseline: {
        reviewQueueSchemaVersion: "territorykit-tr-mahalle-human-review-queue@1",
        reviewQueueGeneratedAt: "2026-10-17T14:03:06.653Z",
        reviewRecordCount: 1,
        gameplayZoneCount: 206,
        settlementRecords: 567
      },
      redistributionRightsApproved: false,
      officialVerifiedPolygonCount: 0,
      entries: [entry, { ...entry }]
    };
    const report = validateMahalleHumanReviewDecisionLedger(ledger);
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.code === "REVIEW_RECORD_ID_DUPLICATE")).toBe(true);
  });

  it("counts zero attributed decisions for pending-only ledger", () => {
    const entry = createPendingMahalleHumanReviewDecisionEntry({
      queueRecord: baseQueueRecord,
      reviewQueueGeneratedAt: "2026-10-17T14:03:06.653Z",
      pins: basePins()
    });
    const ledger: MahalleHumanReviewDecisionLedger = {
      schemaVersion: "territorykit-tr-mahalle-human-review-decision-ledger@1",
      generatedAt: "2026-10-17T15:00:00.000Z",
      programBaseline: {
        reviewQueueSchemaVersion: "territorykit-tr-mahalle-human-review-queue@1",
        reviewQueueGeneratedAt: "2026-10-17T14:03:06.653Z",
        reviewRecordCount: 1,
        gameplayZoneCount: 206,
        settlementRecords: 567
      },
      redistributionRightsApproved: false,
      officialVerifiedPolygonCount: 0,
      entries: [entry]
    };
    expect(countAttributedHumanReviewDecisions(ledger)).toBe(0);
    expect(entry.decisionSchemaVersion).toBe(MAHALLE_HUMAN_REVIEW_DECISION_ENTRY_SCHEMA_VERSION);
  });
});
