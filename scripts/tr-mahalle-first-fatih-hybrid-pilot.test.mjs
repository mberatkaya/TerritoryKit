import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const COMPARISON = join("reports/tr-adm3/mahalle-first-program/fatih-v2-impl-rev4-comparison.json");

test("fatih impl-rev4 hybrid comparison exists when hybrid pilot output is present", async () => {
  try {
    const payload = JSON.parse(await readFile(COMPARISON, "utf8"));
    assert.equal(payload.district, "Fatih");
    assert.equal(payload.implRev4Hybrid.implementationRevision, "impl-rev4");
    assert.equal(typeof payload.implRev4Hybrid.determinismVerified, "boolean");
    assert.ok(payload.boundaryInventoryQa?.sharedInternalBoundaryMeters !== undefined);
    assert.ok(payload.decision?.status);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
});
