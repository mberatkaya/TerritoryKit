import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  EVIDENCE,
  QUALITY_STATUS,
  assessNationalQaCloseout,
  buildBlockers,
  buildDistrictQualityMatrix,
  buildReplacementMap,
  deriveDistrictQualityStatus,
  resolveAdm2ParentAdm1Id,
  resolveBaselineAdm3GeometryHash,
  validateAdm2Layer
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

test("resolveAdm2ParentAdm1Id uses provinceCode when parentId absent (rc.7)", () => {
  const parent = resolveAdm2ParentAdm1Id({
    id: "tr:adm2:test",
    properties: { territory: { provinceCode: "34" } }
  });
  assert.equal(parent, "tr:adm1:tr-34");
});

test("validateAdm2Layer does not false-positive orphan parents on rc.7 ADM2", async () => {
  if (!existsSync(CANDIDATE)) return;
  const adm1 = JSON.parse(await readFile(resolve(CANDIDATE, "levels/ADM1/dataset.json"), "utf8"));
  const adm2 = JSON.parse(await readFile(resolve(CANDIDATE, "levels/ADM2/dataset.json"), "utf8"));
  const validation = validateAdm2Layer({ adm1, adm2, manifest: adm2.manifest });
  assert.equal(validation.orphanParentCount, 0);
  assert.equal(validation.adm2ParentLinkageOk, true);
  assert.equal(validation.rawParentIdFieldOrphanCount, 973);
});

test("buildBlockers reads human-approvals items and Kadıköy pilot", () => {
  const blockers = buildBlockers({
    matrix: [],
    sourceMatrix: [],
    humanGates: {
      items: [{ id: "LEGAL", status: "PENDING_REVIEW", summary: "test" }]
    },
    kadikoyPilot: {
      kadikoyOfficialPilot: {
        pilotStatus: "BLOCKED_BY_SOURCE",
        bundle: { status: "BLOCKED_DUPLICATE_RESPONSE", productionEligibility: "NOT_ELIGIBLE" }
      }
    },
    qualityMetrics: {
      lowConfidenceDistrictCount: 0,
      warningReviewDistrictCount: 0,
      geometryBlockedDistrictCount: 0
    }
  });
  assert.ok(blockers.blockers.some((b) => b.code === "LEGAL"));
  assert.ok(blockers.blockers.some((b) => b.code === "KADIKOY_SHP_BUNDLE_INVALID"));
});

test("assessNationalQaCloseout fails when ADM2 parent linkage broken", () => {
  const bad = assessNationalQaCloseout({
    artifactExists: true,
    matrix: new Array(973),
    adm2Validation: { orphanParentCount: 973, adm2ParentLinkageOk: false }
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.failures.includes("ADM2_PARENT_LINKAGE"));
});

test("generate-tr-national-quality-closeout-reports produces deliverables", async () => {
  const skipGeometry = existsSync(CANDIDATE) ? [] : ["--skip-geometry-rerun"];
  const tempOut = mkdtempSync(join(tmpdir(), "tk-national-closeout-"));
  execSync(
    `node scripts/generate-tr-national-quality-closeout-reports.mjs --skip-coverage-refresh --skip-validate --out-dir ${tempOut} ${skipGeometry.join(" ")}`,
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
    assert.ok(existsSync(resolve(tempOut, name)), `missing ${name}`);
  }

  const matrix = JSON.parse(
    await readFile(resolve(tempOut, "district-quality-matrix.json"), "utf8")
  );
  if (existsSync(CANDIDATE)) {
    assert.equal(matrix.districts.length, 973);
    assert.equal(matrix.artifactClassification, EVIDENCE.REAL_ARTIFACT_VERIFIED);
    const low = matrix.districts.filter((d) => d.confidence === "low").length;
    assert.ok(low >= 600 && low <= 650, `unexpected low confidence count ${low}`);
  } else {
    assert.equal(matrix.districts.length, 973);
  }

  const replacement = JSON.parse(await readFile(resolve(tempOut, "replacement-map.json"), "utf8"));
  if (existsSync(CANDIDATE)) {
    assert.equal(replacement.reasonCode, "RC7_BASELINE_UNCHANGED");
    const blockers = JSON.parse(await readFile(resolve(tempOut, "blockers.json"), "utf8"));
    assert.equal(blockers.adm2Validation.orphanParentCount, 0);
    assert.ok(blockers.blockers.some((b) => b.code === "KADIKOY_SHP_BUNDLE_INVALID"));
    const geometry = blockers.blockers.find(
      (b) => b.code === "DISTRICT_GEOMETRY_VALIDATION_ERRORS"
    );
    assert.ok(geometry?.count === 3);
    assert.equal(blockers.closeoutAssessment.nationalQaCloseoutVerdict, "CONDITIONAL_GO");
  }

  await rm(tempOut, { recursive: true, force: true });
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
