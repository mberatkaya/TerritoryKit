import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  FATIH_REGRESSION_METRICS,
  ISTANBUL_SETTLEMENT_IDENTITY_PILOTS
} from "./lib/tr-mahalle-identity-istanbul-pilots.mjs";

const REPORT_DIR = "reports/tr-adm3/mahalle-identity-layer";
const RC8_ROOT = ".territory/national-geometry-remediation/candidate-rc8-impl-rev1/districts";

function rc8ShardPath(adm2Suffix) {
  return `${RC8_ROOT}/tr_adm2_${adm2Suffix}/dataset.json`;
}

test("Istanbul identity pilot registry covers eight districts with parent validation metadata", () => {
  assert.equal(ISTANBUL_SETTLEMENT_IDENTITY_PILOTS.length, 8);
  const slugs = new Set(ISTANBUL_SETTLEMENT_IDENTITY_PILOTS.map((row) => row.slug));
  assert.equal(slugs.size, 8);
  for (const pilot of ISTANBUL_SETTLEMENT_IDENTITY_PILOTS) {
    assert.ok(pilot.adm2Suffix);
    assert.ok(pilot.expectedParentNames?.length);
  }
});

test("Fatih mahalle identity committed reports preserve geometry immutability contract", async () => {
  const immutability = JSON.parse(
    await readFile(`${REPORT_DIR}/fatih-geometry-immutability.json`, "utf8")
  );
  assert.equal(immutability.schemaVersion, "territorykit-tr-mahalle-identity-immutability@1");
  assert.equal(immutability.zoneCount, FATIH_REGRESSION_METRICS.zoneCount);
  assert.equal(immutability.zoneIdSetSha256, FATIH_REGRESSION_METRICS.zoneIdSetSha256);
  assert.equal(immutability.geometryHashSetSha256, FATIH_REGRESSION_METRICS.geometryHashSetSha256);
  assert.equal(immutability.determinismVerified, true);
});

test("Istanbul pilot committed artifacts enforce consumer safety invariants", async (t) => {
  const matrixPath = `${REPORT_DIR}/istanbul-pilot-matrix.json`;
  if (!existsSync(matrixPath)) {
    t.skip("Run data:tr:mahalle-identity:istanbul to generate Sprint 2D reports");
    return;
  }

  const matrix = JSON.parse(await readFile(matrixPath, "utf8"));
  for (const row of matrix.districts) {
    if (row.technicalPilotDecision === "BLOCKED_BY_SOURCE") {
      continue;
    }

    const associations = JSON.parse(
      await readFile(`${REPORT_DIR}/${row.slug}-zone-associations.json`, "utf8")
    );
    assert.ok(
      associations.associations.every((entry) => entry.reviewDecision === "pending"),
      `${row.district}: automatic associations must not claim human review approval`
    );
    assert.ok(
      associations.zoneSummaries.every((entry) => entry.autoDisplayNameAllowed === false),
      `${row.district}: auto display naming must remain disabled`
    );

    const consumerPin = JSON.parse(
      await readFile(`${REPORT_DIR}/${row.slug}-consumer-pin.json`, "utf8")
    );
    assert.equal(consumerPin.zoneIdSetSha256, row.zoneIdSetSha256);
    assert.equal(consumerPin.geometryHashSetSha256, row.geometryHashSetSha256);

    const smoke = JSON.parse(await readFile(`${REPORT_DIR}/${row.slug}-lookup-smoke.json`, "utf8"));
    assert.equal(smoke.consumerLoadOk, true, `${row.district}: consumer loader smoke must pass`);
  }
});

test("Pinned rc.8 shards exist for all Istanbul identity pilots or BLOCKED_BY_SOURCE", () => {
  for (const pilot of ISTANBUL_SETTLEMENT_IDENTITY_PILOTS) {
    const present = existsSync(rc8ShardPath(pilot.adm2Suffix));
    if (!present) {
      assert.ok(
        process.env.CI,
        `${pilot.district} rc.8 shard missing locally — expected BLOCKED_BY_SOURCE in CI without bytes`
      );
    }
  }
});
