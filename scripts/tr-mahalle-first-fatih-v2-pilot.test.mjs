import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const REPORT_REV3 = join(
  "reports/tr-adm3/mahalle-first-program/fatih-v2-impl-rev3-comparison.json"
);

test("fatih v2 impl-rev3 comparison report exists when pilot output is present", async () => {
  try {
    const payload = JSON.parse(await readFile(REPORT_REV3, "utf8"));
    assert.equal(payload.district, "Fatih");
    assert.equal(payload.v2Pilot.algorithmVersion, "smart-derived-v2.0-pilot");
    assert.equal(payload.v2Pilot.implementationRevision, "impl-rev3");
    assert.equal(typeof payload.v2Pilot.determinismVerified, "boolean");
    assert.ok(payload.hypothesisEvaluation?.selectedVariantId);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
});
