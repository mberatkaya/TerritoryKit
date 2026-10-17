import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { evaluateTurkeyOsmSourceEvidence } from "../packages/generators/dist/index.mjs";
import { buildMahalleHumanReviewQueue } from "./lib/tr-mahalle-human-review-queue.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPRINT_ROOT = "reports/tr-adm3/sprint-2e-source-evidence";

test("human review queue defaults remain pending without auto display promotion", async () => {
  const queue = await buildMahalleHumanReviewQueue({
    repoRoot: REPO_ROOT,
    reportRoot: "reports/tr-adm3/mahalle-identity-layer"
  });
  assert.ok(queue.records.length > 0);
  for (const record of queue.records) {
    assert.equal(record.reviewDecision, "pending");
    assert.equal(record.autoDisplayNameAllowed, false);
  }
  assert.equal(queue.summary.districtCount, 8);
  assert.equal(queue.summary.gameplayZoneCount, 206);
  assert.equal(queue.summary.reviewRecordCount, 173);
  assert.equal(queue.summary.ambiguousZoneRecords, 73);
  assert.equal(queue.summary.unseededZoneRecords, 84);
  assert.equal(queue.summary.duplicateNormalizedNameRecords, 5);
  assert.equal(queue.summary.officialSourceOnlyRecords, 11);
  assert.doesNotMatch(
    queue.records.find((row) => row.ambiguityReasonCodes.includes("AMBIGUOUS_MULTI_SEED_ZONE"))
      ?.proposedAction ?? "",
    /split-zone/
  );
});

test("Sprint 2E decision artifacts classify Kadıköy official source as blocked", async (t) => {
  const decisionPath = join(REPO_ROOT, SPRINT_ROOT, "sprint-2e-decision.json");
  try {
    await readFile(decisionPath, "utf8");
  } catch {
    t.skip("Run pnpm data:tr:sprint2e:source-evidence to generate Sprint 2E reports");
    return;
  }

  const decision = JSON.parse(await readFile(decisionPath, "utf8"));
  assert.equal(decision.decisions.officialMahalleAccuracy, "NO_GO");
  assert.equal(decision.decisions.productionRelease, "NO_GO");
  assert.equal(decision.kadikoyStatus, "BLOCKED_BY_SOURCE");
});

test("OSM source evidence metadata-only evaluation never marks bytes verified", async (t) => {
  const lockPath = join(REPO_ROOT, ".territory/cache/osm/TR/TR-5ec68ce5e0b2be55/source-lock.json");
  try {
    await readFile(lockPath, "utf8");
  } catch {
    t.skip("BLOCKED_BY_SOURCE: pinned OSM source lock unavailable in this environment");
    return;
  }

  const evaluation = await evaluateTurkeyOsmSourceEvidence({
    repoRoot: REPO_ROOT,
    sourceLockPath: ".territory/cache/osm/TR/TR-5ec68ce5e0b2be55/source-lock.json",
    verifySnapshotBytes: false,
    barrierManifest: {
      adm2Id: "tr:adm2:54988432b39641834885080",
      source: {
        providerId: "geofabrik-osm-extracts",
        providerName: "Geofabrik OpenStreetMap extracts",
        sourceUrl: "https://download.geofabrik.de/europe/turkey.html",
        sourceDatasetId: "geofabrik:europe:turkey",
        snapshotSha256: "5ec68ce5e0b2be55b2c34ee7cd1ff91b6b3d8db8acab5a6be2fa7beb633eaedc",
        snapshotDate: "2026-08-27T20:21:06.000Z",
        license: "ODbL-1.0",
        attribution: "OpenStreetMap contributors",
        format: "osm-pbf"
      },
      sourceSnapshotChecksum: "5ec68ce5e0b2be55b2c34ee7cd1ff91b6b3d8db8acab5a6be2fa7beb633eaedc"
    },
    expectedAdm2Id: "tr:adm2:54988432b39641834885080"
  });

  assert.equal(evaluation.gates.sourceBytesVerified, false);
  assert.equal(evaluation.sourceLockState, "pending");
  assert.ok(evaluation.reasonCodes.includes("SOURCE_BYTES_VERIFICATION_SKIPPED"));
  assert.equal(evaluation.gates.redistributionRightsApproved, false);
});

test("OSM source evidence verifies pinned snapshot bytes when present", async (t) => {
  const lockPath = join(REPO_ROOT, ".territory/cache/osm/TR/TR-5ec68ce5e0b2be55/source-lock.json");
  let lock;
  try {
    lock = JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    t.skip("BLOCKED_BY_SOURCE: pinned OSM source lock unavailable in this environment");
    return;
  }

  const evaluation = await evaluateTurkeyOsmSourceEvidence({
    repoRoot: REPO_ROOT,
    sourceLockPath: ".territory/cache/osm/TR/TR-5ec68ce5e0b2be55/source-lock.json",
    verifySnapshotBytes: true,
    barrierManifest: {
      adm2Id: "tr:adm2:54988432b39641834885080",
      source: {
        providerId: "geofabrik-osm-extracts",
        providerName: "Geofabrik OpenStreetMap extracts",
        sourceUrl: "https://download.geofabrik.de/europe/turkey.html",
        sourceDatasetId: "geofabrik:europe:turkey",
        snapshotSha256: lock.sha256,
        snapshotDate: lock.snapshotDate,
        license: lock.license,
        attribution: lock.attribution,
        format: lock.format
      },
      sourceSnapshotChecksum: lock.sha256
    },
    expectedAdm2Id: "tr:adm2:54988432b39641834885080"
  });

  if (!evaluation.gates.sourceBytesVerified) {
    t.skip("BLOCKED_BY_SOURCE: pinned OSM snapshot bytes unavailable in this environment");
    return;
  }

  assert.equal(evaluation.sourceLockState, "verified");
  assert.equal(evaluation.gates.redistributionRightsApproved, false);
});
