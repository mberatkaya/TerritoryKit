import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const reportRoot = join(root, "reports/tr-adm3/mahalle-first-program");

test("fatih settlement association comparison documents expected baseline", async () => {
  const comparison = JSON.parse(
    await readFile(join(reportRoot, "fatih-settlement-association-comparison.json"), "utf8")
  );
  assert.equal(comparison.expectedBaseline.zoneCount, 30);
  assert.equal(comparison.officialMahalleInventoryComparison, "NOT_ASSESSED");
  assert.equal(comparison.validationOk, true);
});

test("fatih settlement geometry invariant is independently recorded", async () => {
  const invariant = JSON.parse(
    await readFile(join(reportRoot, "fatih-settlement-geometry-invariant.json"), "utf8")
  );
  assert.equal(invariant.rc8SelfInvariant.ok, true);
  assert.equal(typeof invariant.v17ReplayVsRc8.ok, "boolean");
});
