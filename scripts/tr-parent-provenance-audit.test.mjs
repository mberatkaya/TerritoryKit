import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { generateParentProvenanceReports } from "./tr-parent-provenance-audit.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("tracked Turkey parent dataset disagrees with HDX catalog provider lock", async () => {
  const { inspection, verification } = await generateParentProvenanceReports({
    outputDir: path.join(REPO_ROOT, "reports/tr-adm3/provenance")
  });
  assert.equal(inspection.lineageStatus, "CATALOG_LOCK_DIFFERS_FROM_PARENT_POLYGONS");
  assert.equal(inspection.observedDominantProvider, "geoboundaries");
  assert.equal(inspection.catalogProvider, "hdx-cod-ab");
  assert.equal(verification.ok, false);
  const lineage = JSON.parse(
    await readFile(path.join(REPO_ROOT, "reports/tr-adm3/provenance/parent-lineage.json"), "utf8")
  );
  assert.equal(lineage.inspection.classification, "CONFIRMED_ROOT_CAUSE");
});
