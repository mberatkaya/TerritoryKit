import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  generateGeoBoundariesParentReports,
  isGeoBoundariesParentAuditCliEntry
} from "./tr-geoboundaries-parent-audit.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_PARENT = path.join(
  REPO_ROOT,
  "packages/generators/test/fixtures/tr-parent-provenance/canonical-parent-snapshot.json"
);
const FIXTURE_SOURCE_LOCK = path.join(
  REPO_ROOT,
  "packages/generators/test/fixtures/tr-geoboundaries-parent/source-lock.json"
);
const FIXTURE_GB_ADM0 = path.join(
  REPO_ROOT,
  "packages/generators/test/fixtures/tr-geoboundaries-parent/gb-adm0-tiny.geojson"
);
const AUDIT_SCRIPT = path.join(REPO_ROOT, "scripts/tr-geoboundaries-parent-audit.mjs");

test("geoboundaries audit CLI entry detection", () => {
  assert.equal(isGeoBoundariesParentAuditCliEntry(["node", "/other.mjs"]), false);
});

test("generateGeoBoundariesParentReports never returns verified without full national evidence", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "territory-gb-parent-audit-"));
  try {
    const { verification, inspection } = await generateGeoBoundariesParentReports({
      outputDir,
      parentDatasetPath: FIXTURE_PARENT,
      sourceLockPath: FIXTURE_SOURCE_LOCK,
      geoBoundariesCacheRoot: path.join(
        REPO_ROOT,
        "packages/generators/test/fixtures/tr-geoboundaries-parent/cache"
      ),
      diagnosticMode: true,
      strict: false
    });
    assert.equal(verification.verified, false);
    assert.notEqual(inspection.pathBFeasibility, "PATH_B_VERIFIED_CANDIDATE");
    const feasibility = await readFile(path.join(outputDir, "path-b-feasibility.md"), "utf8");
    assert.match(feasibility, /Path B/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("CLI subprocess exits non-zero in strict mode for fixture parent", () => {
  const outputDir = path.join(os.tmpdir(), `territory-gb-cli-${Date.now()}`);
  const result = spawnSync(
    process.execPath,
    [
      AUDIT_SCRIPT,
      "--parent-dataset",
      FIXTURE_PARENT,
      "--source-lock",
      FIXTURE_SOURCE_LOCK,
      "--geoboundaries-cache",
      path.join(REPO_ROOT, "packages/generators/test/fixtures/tr-geoboundaries-parent/cache"),
      "--output-dir",
      outputDir,
      "--allow-incomplete-evidence"
    ],
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
  assert.notEqual(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.verified, false);
});

test("optional full national audit when local generated parent exists", async (t) => {
  const parentDatasetPath = path.join(REPO_ROOT, "datasets/generated/countries/TR/dataset.json");
  const sourceLockPath = path.join(REPO_ROOT, "datasets/generated/countries/TR/sources.lock.json");
  if (!existsSync(parentDatasetPath) || !existsSync(sourceLockPath)) {
    t.skip("gitignored TR parent artifacts not present locally");
  }
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "territory-gb-parent-full-"));
  try {
    const { inspection } = await generateGeoBoundariesParentReports({
      outputDir,
      parentDatasetPath,
      sourceLockPath,
      diagnosticMode: true,
      strict: false
    });
    assert.ok(inspection.identityComparison.length > 0);
    const bytes = JSON.parse(
      await readFile(path.join(outputDir, "source-byte-verification.json"), "utf8")
    );
    assert.equal(typeof bytes.geoBoundariesUpstreamBytesVerified, "boolean");
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
