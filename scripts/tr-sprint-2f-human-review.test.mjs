import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  appendMahalleHumanReviewDecisionHistory,
  buildMahalleHumanReviewContextPin,
  compareMahalleHumanReviewPins,
  createPendingMahalleHumanReviewDecisionEntry,
  validateMahalleHumanReviewDecisionSubmission
} from "../packages/dataset/dist/index.mjs";
import { buildMahalleHumanReviewQueue } from "./lib/tr-mahalle-human-review-queue.mjs";
import {
  buildInitialMahalleHumanReviewDecisionLedger,
  loadDistrictReviewPins,
  summarizeMahalleHumanReviewProgress
} from "./lib/tr-mahalle-human-review-workflow.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPRINT_2F_ROOT = "reports/tr-adm3/sprint-2f-human-review";

test("human review queue assigns stable reviewRecordId to 173 baseline records", async () => {
  const queue = await buildMahalleHumanReviewQueue({
    repoRoot: REPO_ROOT,
    reportRoot: "reports/tr-adm3/mahalle-identity-layer"
  });
  assert.equal(queue.records.length, 173);
  const ids = new Set(queue.records.map((row) => row.reviewRecordId));
  assert.equal(ids.size, 173);
  for (const record of queue.records) {
    assert.match(record.reviewRecordId, /^tr:mahalle-review:[a-f0-9]{32}$/);
  }
});

test("initial decision ledger keeps all records pending with zero attributed decisions", async (t) => {
  const queue = await buildMahalleHumanReviewQueue({
    repoRoot: REPO_ROOT,
    reportRoot: "reports/tr-adm3/mahalle-identity-layer"
  });
  const districtPins = await loadDistrictReviewPins({ repoRoot: REPO_ROOT, queue });
  if (districtPins.size === 0) {
    t.skip("BLOCKED_BY_SOURCE: rc.8 shards / identity reports unavailable locally");
    return;
  }

  const ledger = buildInitialMahalleHumanReviewDecisionLedger({
    repoRoot: REPO_ROOT,
    queue,
    districtPins
  });
  assert.equal(ledger.entries.length, 173);
  const progress = summarizeMahalleHumanReviewProgress(ledger);
  assert.equal(progress.attributedHumanDecisions, 0);
  assert.equal(progress.pendingRecords, 173);
  assert.equal(progress.autoDisplayNameAllowedCount, 0);
});

test("stale snapshot rejection blocks silent decision carry-over", () => {
  const record = {
    stableZoneId: "tr:adm3:zone",
    district: "Fatih",
    parentAdm2Id: "tr:adm2:x",
    settlementIds: ["tr:settlement:osm:node:1"],
    ambiguityReasonCodes: ["UNSEEDED_GAMEPLAY_ZONE"],
    evidenceLinks: ["reports/example.json"],
    sourceProvenance: { barrierSnapshotSha256: "aaa" }
  };
  const pins = buildMahalleHumanReviewContextPin({
    queueRecord: record,
    reviewQueueGeneratedAt: "2026-10-17T00:00:00.000Z"
  });
  const entry = createPendingMahalleHumanReviewDecisionEntry({
    queueRecord: record,
    reviewQueueGeneratedAt: "2026-10-17T00:00:00.000Z",
    pins
  });
  const stalePins = { ...pins, osmSnapshotSha256: "bbb" };
  const validation = validateMahalleHumanReviewDecisionSubmission({
    entry,
    redistributionRightsApproved: false,
    submission: {
      state: "approved-semantic-label",
      reviewer: { id: "human@example.org" },
      rationale: "Reviewed with updated snapshot context.",
      reviewedAt: "2026-10-17T12:00:00.000Z",
      pins: stalePins,
      approvedSemanticLabel: "Label"
    }
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((issue) => issue.code === "STALE_SOURCE_SNAPSHOT"));
});

test("wrong parent ADM2 and dataset version are stale", () => {
  const expected = buildMahalleHumanReviewContextPin({
    queueRecord: {
      stableZoneId: null,
      district: "Fatih",
      parentAdm2Id: "tr:adm2:expected",
      settlementIds: [],
      ambiguityReasonCodes: ["DUPLICATE_NORMALIZED_NAME"],
      evidenceLinks: []
    },
    reviewQueueGeneratedAt: "2026-10-17T00:00:00.000Z",
    districtPins: {
      gameplayDatasetVersion: "2.1.0-rc.8",
      identityLayerVersion: "v1"
    }
  });
  const observed = {
    ...expected,
    parentAdm2Id: "tr:adm2:other",
    gameplayDatasetVersion: "2.1.0-rc.9"
  };
  const issues = compareMahalleHumanReviewPins(expected, observed);
  assert.ok(issues.some((issue) => issue.code === "STALE_PARENT_ADM2"));
  assert.ok(issues.some((issue) => issue.code === "STALE_DATASET_VERSION"));
});

test("rejected decisions never enable auto display promotion", () => {
  const record = {
    stableZoneId: "tr:adm3:zone",
    district: "Fatih",
    parentAdm2Id: "tr:adm2:x",
    settlementIds: [],
    ambiguityReasonCodes: ["UNSEEDED_GAMEPLAY_ZONE"],
    evidenceLinks: ["reports/example.json"]
  };
  const pins = buildMahalleHumanReviewContextPin({
    queueRecord: record,
    reviewQueueGeneratedAt: "2026-10-17T00:00:00.000Z"
  });
  const entry = createPendingMahalleHumanReviewDecisionEntry({
    queueRecord: record,
    reviewQueueGeneratedAt: "2026-10-17T00:00:00.000Z",
    pins
  });
  const updated = appendMahalleHumanReviewDecisionHistory(entry, {
    state: "rejected",
    reviewer: { id: "human@example.org" },
    rationale: "Insufficient evidence for label promotion.",
    reviewedAt: "2026-10-17T12:00:00.000Z",
    pins
  });
  assert.equal(updated.autoDisplayNameAllowed, false);
  assert.equal(updated.currentState, "rejected");
});

test("Sprint 2F generated artifacts preserve regression baseline when present", async (t) => {
  const ledgerPath = join(REPO_ROOT, SPRINT_2F_ROOT, "human-review-decision-ledger.json");
  try {
    await readFile(ledgerPath, "utf8");
  } catch {
    t.skip("Run pnpm data:tr:sprint2f:human-review to generate Sprint 2F reports");
    return;
  }
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  assert.equal(ledger.entries.length, 173);
  assert.equal(ledger.officialVerifiedPolygonCount, 0);
  assert.equal(ledger.redistributionRightsApproved, false);
});
