import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const OUT_DIR = resolve(ROOT, "reports/tr-adm3/sprint-3-national-rc");
const CANDIDATE = resolve(ROOT, ".territory/sprint-6/final/candidate");

test("generate-tr-sprint-3-national-rc-reports produces sprint-3 deliverables", async () => {
  execSync("node scripts/generate-tr-sprint-3-national-rc-reports.mjs", {
    cwd: ROOT,
    stdio: "pipe",
    env: { ...process.env }
  });

  const required = [
    "README.md",
    "artifact-inventory.json",
    "national-coverage-validation.json",
    "province-source-consistency.json",
    "shard-integrity.json",
    "mvt-validation.json",
    "delivery-manifest-validation.json",
    "consumer-contract-results.json",
    "hosted-delivery-readiness.md",
    "source-lock-impact.json",
    "authorization-gates.json",
    "rushclaim-sprint-4-handoff.md",
    "final-decision.md"
  ];
  for (const name of required) {
    assert.ok(existsSync(resolve(OUT_DIR, name)), `missing ${name}`);
  }

  const inventory = JSON.parse(await readFile(resolve(OUT_DIR, "artifact-inventory.json"), "utf8"));
  if (existsSync(CANDIDATE)) {
    assert.equal(inventory.classification, "REAL_ARTIFACT_VERIFIED");
    assert.equal(inventory.observedIdentity.datasetVersion, "2.1.0-rc.7");
    const provinces = JSON.parse(
      await readFile(resolve(OUT_DIR, "province-source-consistency.json"), "utf8")
    );
    assert.equal(provinces.provinceCount, 81);
    const coverage = JSON.parse(
      await readFile(resolve(OUT_DIR, "national-coverage-validation.json"), "utf8")
    );
    assert.equal(coverage.observedCounts.adm2, 973);
    const consumer = JSON.parse(
      await readFile(resolve(OUT_DIR, "consumer-contract-results.json"), "utf8")
    );
    assert.equal(consumer.scope, "LOCAL_CONSUMER_VERIFIED_NOT_HOSTED");
    assert.ok(consumer.districts.length >= 6);
  } else {
    assert.equal(inventory.classification, "BLOCKED_BY_MISSING_ARTIFACT");
  }

  const gates = JSON.parse(await readFile(resolve(OUT_DIR, "authorization-gates.json"), "utf8"));
  assert.equal(gates.classification, "BLOCKED_BY_AUTHORIZATION");
  assert.ok(gates.items.some((item) => item.id === "NATIONAL_DATASET_PROMOTION"));

  const mvt = JSON.parse(await readFile(resolve(OUT_DIR, "mvt-validation.json"), "utf8"));
  assert.equal(mvt.consumerSourceLayerContract, "territory_adm3");
  if (existsSync(CANDIDATE)) {
    assert.ok(mvt.deliveryReadinessGate);
    for (const sample of mvt.representativeSamples) {
      assert.notEqual(sample.classification, "PASS");
      if (sample.classification === "ACTUAL_LAYER_MATCH") {
        assert.equal(sample.encodedProtobufLayer, "territory_adm3");
      }
    }
    const handoff = await readFile(resolve(OUT_DIR, "rushclaim-sprint-4-handoff.md"), "utf8");
    assert.ok(handoff.includes("territory_adm3"));
  }
});
