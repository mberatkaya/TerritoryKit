import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  generateGeoBoundariesParentReports,
  isGeoBoundariesParentAuditCliEntry,
  prettifyMarkdownReports
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
const AUDIT_SCRIPT = path.join(REPO_ROOT, "scripts/tr-geoboundaries-parent-audit.mjs");

function assertPrettierCleanMarkdown(files) {
  execFileSync("pnpm", ["exec", "prettier", "--check", ...files], {
    cwd: REPO_ROOT,
    stdio: "pipe",
    env: { ...process.env, CI: "true" }
  });
}

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
    const requirements = JSON.parse(
      await readFile(path.join(outputDir, "path-b-evidence-requirements.json"), "utf8")
    );
    assert.equal(requirements.migrationAuthorizationStatus, "NOT_AUTHORIZED");
    assert.ok(requirements.unresolvedLicensingEvidence.length > 0);
    assert.ok(
      requirements.unresolvedGeometryEvidence.length > 0 ||
        requirements.unresolvedSourceInventoryEvidence.length > 0 ||
        requirements.missingArtifacts.length > 0
    );
    assertPrettierCleanMarkdown([
      path.join(outputDir, "path-b-feasibility.md"),
      path.join(outputDir, "README.md"),
      path.join(outputDir, "migration-impact-plan.md")
    ]);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("regenerating reports twice does not introduce prettier drift", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "territory-gb-parent-audit-drift-"));
  try {
    await generateGeoBoundariesParentReports({
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
    const normalize = (text) =>
      text
        .replace(/\*\*Üretim zamanı \(UTC\):\*\* .+\n/g, "")
        .replace(/\*\*İnceleme commit:\*\* `[^`]+`/g, "**İnceleme commit:** `PINNED`");
    const first = normalize(await readFile(path.join(outputDir, "path-b-feasibility.md"), "utf8"));
    await generateGeoBoundariesParentReports({
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
    const second = normalize(await readFile(path.join(outputDir, "path-b-feasibility.md"), "utf8"));
    assert.equal(first, second);
    prettifyMarkdownReports(outputDir);
    assertPrettierCleanMarkdown([
      path.join(outputDir, "path-b-feasibility.md"),
      path.join(outputDir, "README.md")
    ]);
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
    const inventory = JSON.parse(
      await readFile(path.join(outputDir, "source-feature-inventory.json"), "utf8")
    );
    const adm2 = inventory.rows.find((row) => row.adminLevel === "ADM2");
    assert.equal(adm2?.rawGeoJsonFeatureCount, 973);
    assert.equal(adm2?.parsedFeatureCount, 973);
    assert.equal(adm2?.lockMetadataFeatureCount, 999);
    assertPrettierCleanMarkdown([
      path.join(outputDir, "path-b-feasibility.md"),
      path.join(outputDir, "README.md")
    ]);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
