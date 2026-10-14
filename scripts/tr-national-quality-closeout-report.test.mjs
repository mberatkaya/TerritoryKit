import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import {
  EVIDENCE,
  QUALITY_STATUS,
  buildDistrictQualityMatrix,
  buildReplacementMap,
  deriveDistrictQualityStatus,
  resolveBaselineAdm3GeometryHash
} from "./lib/tr-national-quality-closeout.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const OUT_DIR = resolve(ROOT, "reports/tr-adm3/national-quality-closeout");
const CANDIDATE = resolve(ROOT, ".territory/sprint-6/final/candidate");

test("deriveDistrictQualityStatus respects low confidence", () => {
  const status = deriveDistrictQualityStatus({
    coverageRow: { generatedFeatureCount: 3, reasonCode: "ESTIMATED_GAMEPLAY_BOUNDARIES" },
    smartRow: { confidence: "low", smartAcceptanceStatus: "USABLE_LOW_CONFIDENCE" },
    geometrySummary: { errorCount: 0 },
    artifactAvailable: true
  });
  assert.equal(status, QUALITY_STATUS.WARNING_REVIEW_REQUIRED);
});

test("replacement map is identity summary when ADM3 hash unchanged", () => {
  const hash = "19f50ba312657f39f61d9ce8eb6562491fa66de106681eec5352b85ae1b6e333";
  const map = buildReplacementMap({
    baseline: {},
    baselineClaims: { claims: [{ adm3GeometryHash: hash }] },
    coverageReport: { declaredGeometryHash: hash, geometryHash: hash },
    adm3ZoneCount: 20392
  });
  assert.equal(map.summary.matchType, "IDENTITY_ALL");
  assert.equal(map.migrationEligibility, "DRY_RUN_IDENTITY");
});

test("resolveBaselineAdm3GeometryHash reads baseline-claims", () => {
  const hash = "abc";
  assert.equal(
    resolveBaselineAdm3GeometryHash(null, { claims: [{ adm3GeometryHash: hash }] }),
    hash
  );
});

test("generate-tr-national-quality-closeout-reports produces deliverables", async () => {
  const skipGeometry = existsSync(CANDIDATE) ? [] : ["--skip-geometry-rerun"];
  execSync(
    `node scripts/generate-tr-national-quality-closeout-reports.mjs --skip-coverage-refresh --skip-validate ${skipGeometry.join(" ")}`,
    {
      cwd: ROOT,
      stdio: "pipe",
      env: { ...process.env }
    }
  );

  for (const name of [
    "national-inventory.json",
    "province-summary.json",
    "district-quality-matrix.json",
    "neighborhood-identity-audit.json",
    "source-availability-matrix.json",
    "baseline-comparison.json",
    "blockers.json",
    "replacement-map.json",
    "final-decision.md",
    "README.md"
  ]) {
    assert.ok(existsSync(resolve(OUT_DIR, name)), `missing ${name}`);
  }

  const matrix = JSON.parse(
    await readFile(resolve(OUT_DIR, "district-quality-matrix.json"), "utf8")
  );
  if (existsSync(CANDIDATE)) {
    assert.equal(matrix.districts.length, 973);
    assert.equal(matrix.artifactClassification, EVIDENCE.REAL_ARTIFACT_VERIFIED);
    const low = matrix.districts.filter((d) => d.confidence === "low").length;
    assert.ok(low >= 600 && low <= 650, `unexpected low confidence count ${low}`);
  } else {
    assert.equal(matrix.districts.length, 973);
  }

  const replacement = JSON.parse(await readFile(resolve(OUT_DIR, "replacement-map.json"), "utf8"));
  if (existsSync(CANDIDATE)) {
    assert.equal(replacement.reasonCode, "RC7_BASELINE_UNCHANGED");
  }
});

test("district matrix fixture row counts zones", () => {
  const rows = buildDistrictQualityMatrix({
    coverageDistricts: [
      {
        provinceCode: "34",
        adm2Id: "tr:adm2:test",
        districtName: "Test",
        officialFeatureCount: 1,
        osmAdministrativeFeatureCount: 0,
        generatedFeatureCount: 2,
        unknownSourceFeatureCount: 0,
        reasonCode: "ESTIMATED_GAMEPLAY_BOUNDARIES",
        confidence: "medium"
      }
    ],
    smartByAdm2: new Map(),
    geometryByAdm2: new Map(),
    artifactAvailable: true
  });
  assert.equal(rows[0].adm3ZoneCount, 3);
});
