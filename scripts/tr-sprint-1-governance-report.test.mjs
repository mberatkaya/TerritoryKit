import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const OUT_DIR = resolve(ROOT, "reports/tr-adm3/sprint-1-governance");

test("generate-tr-sprint-1-governance-reports produces consistent 81-province readiness", async () => {
  execSync("node scripts/generate-tr-sprint-1-governance-reports.mjs", {
    cwd: ROOT,
    stdio: "pipe"
  });

  const readiness = JSON.parse(
    await readFile(resolve(OUT_DIR, "adm3-readiness-report.json"), "utf8")
  );
  assert.equal(readiness.provinceSummary.provinceCount, 81);
  assert.equal(
    Object.values(readiness.provinceSummary.byStatus).reduce((a, b) => a + b, 0),
    81
  );

  const governance = JSON.parse(
    await readFile(resolve(OUT_DIR, "source-governance-status.json"), "utf8")
  );
  assert.equal(governance.mergedResearchPrs.length, 3);
  assert.equal(governance.parentProvenance.fullBuilderReplay.geometryHashMismatches, 44);
  assert.equal(governance.parentProvenance.fullBuilderReplay.legalReviewStatus, "PENDING_REVIEW");

  const licensing = JSON.parse(
    await readFile(resolve(OUT_DIR, "licensing-evidence-matrix.json"), "utf8")
  );
  assert.equal(licensing.geoBoundariesPinnedParent.length, 3);
  assert.equal(
    licensing.legalReviewStatus ?? licensing.geoBoundariesPinnedParent[0].legalReviewStatus,
    "PENDING_REVIEW"
  );

  const pathMatrix = JSON.parse(
    await readFile(resolve(OUT_DIR, "path-a-vs-path-b-matrix.json"), "utf8")
  );
  assert.equal(pathMatrix.migrationAuthorized, false);
  assert.equal(pathMatrix.options.length, 2);
});
