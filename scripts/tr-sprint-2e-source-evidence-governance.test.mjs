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

test("OSM source evidence rejects contentHash-only forgeries", async () => {
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
    }
  });

  if (!evaluation.gates.sourceBytesVerified) {
    t.skip("BLOCKED_BY_SOURCE: pinned OSM snapshot bytes unavailable in this environment");
    return;
  }

  assert.equal(evaluation.sourceLockState, "verified");
  assert.equal(evaluation.gates.redistributionRightsApproved, false);
});
