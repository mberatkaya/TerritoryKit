import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { inspectTurkeyMunicipalShapefileCompanionBundle } from "../packages/generators/dist/turkey-adm3.mjs";
import {
  SPRINT_2G_REPORT_ROOT,
  buildGameplayOverlayReport,
  classifyDistrictOutcome,
  loadRc8DistrictContext,
  orderedIstanbulPilots
} from "./lib/tr-sprint-2g-geometry-validation.mjs";
import { FATIH_REGRESSION_METRICS } from "./lib/tr-mahalle-identity-istanbul-pilots.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_DIR = join(REPO_ROOT, SPRINT_2G_REPORT_ROOT);
const RC8_ROOT = ".territory/national-geometry-remediation/candidate-rc8-impl-rev1";

test("Kadıköy companion bytes remain structurally invalid (negative control)", async () => {
  const acquisition = JSON.parse(
    await readFile(join(REPO_ROOT, "reports/tr-adm3/audit/kadikoy-acquisition.json"), "utf8")
  );
  const bytes = new Uint8Array(16);
  const files = acquisition.map((entry) => ({
    fileName: entry.url.split("/").at(-1),
    bytes
  }));
  const report = inspectTurkeyMunicipalShapefileCompanionBundle(files);
  assert.equal(report.uniqueSha256Count, 1);
  assert.ok(report.reasonCodes.includes("IDENTICAL_COMPANION_BYTES"));
});

test("seed-only features are never classified as official polygon outcomes", () => {
  const pilot = orderedIstanbulPilots().find((row) => row.slug === "fatih");
  assert.ok(pilot);
  const outcome = classifyDistrictOutcome({
    pilot,
    kadikoyBlocked: false,
    osmPolygonCount: 0,
    officialVerified: false,
    experimentalImproved: false
  });
  assert.equal(outcome, "BASELINE_PRESERVED");
});

test("gameplay overlay report stays analysis-only", () => {
  const report = buildGameplayOverlayReport({
    generatedAt: "2026-10-17T00:00:00.000Z",
    gameplayZones: [],
    osmZones: []
  });
  assert.equal(report.ownershipMigrationPerformed, false);
  assert.equal(report.eligibleForMigration, false);
  assert.equal(report.status, "NOT_ASSESSED");
  assert.doesNotMatch(JSON.stringify(report), /newOfficialTerritoryId/);
});

test("Fatih rc.8 canonical immutability pins match identity layer helpers", async (t) => {
  const pilot = orderedIstanbulPilots().find((row) => row.slug === "fatih");
  assert.ok(pilot);
  const shard = join(REPO_ROOT, RC8_ROOT, "districts/tr_adm2_54988432b39641834885080/dataset.json");
  if (!existsSync(shard)) {
    t.skip("BLOCKED_BY_SOURCE: local rc.8 Fatih shard unavailable");
    return;
  }
  const context = await loadRc8DistrictContext(REPO_ROOT, pilot, RC8_ROOT);
  assert.equal(context.blocked, false);
  assert.equal(context.zoneIdSetSha256, FATIH_REGRESSION_METRICS.zoneIdSetSha256);
  assert.equal(context.geometryHashSetSha256, FATIH_REGRESSION_METRICS.geometryHashSetSha256);
});

test("Sprint 2G generator outputs decision artifact when local rc.8 + OSM bytes exist", async (t) => {
  const shard = join(REPO_ROOT, RC8_ROOT, "districts/tr_adm2_54988432b39641834885080/dataset.json");
  const pbf = join(REPO_ROOT, ".territory/cache/osm/TR/TR-5ec68ce5e0b2be55/turkey.osm.pbf");
  if (!existsSync(shard) || !existsSync(pbf)) {
    t.skip("BLOCKED_BY_SOURCE: local rc.8 shards or pinned OSM PBF unavailable");
    return;
  }

  execSync("node scripts/generate-tr-sprint-2g-geometry-validation.mjs", {
    cwd: REPO_ROOT,
    stdio: "pipe",
    env: {
      ...process.env,
      SPRINT_2G_GENERATED_AT: "2026-10-17T18:00:00.000Z"
    },
    maxBuffer: 20 * 1024 * 1024
  });

  const decision = JSON.parse(await readFile(join(REPORT_DIR, "sprint-2g-decision.json"), "utf8"));
  assert.equal(decision.schemaVersion, "territorykit-tr-sprint-2g-decision@1");
  assert.equal(decision.counts.verifiedOfficialPolygons, 0);
  assert.equal(decision.geographicalProductAcceptance, "NO_GO");
  assert.equal(decision.gates.gateF_productionReadiness, "NO_GO");
  assert.equal(decision.repository.mainBaselineSha, "ba03eedeea27c28dd0562d5744f070e94f6d3247");
  assert.ok(decision.repository.evaluatedCommit);
  assert.ok(decision.counts.verifiedOsmAdministrativePolygons >= 1);

  const matrix = JSON.parse(
    await readFile(join(REPORT_DIR, "istanbul-eight-district-geometry-matrix.json"), "utf8")
  );
  assert.equal(matrix.districts.length, 8);
  const kadikoy = matrix.districts.find((row) => row.slug === "kadikoy");
  assert.equal(kadikoy.classification, "BLOCKED_BY_SOURCE");

  const fatih = matrix.districts.find((row) => row.slug === "fatih");
  assert.ok(fatih);
  assert.equal(fatih.gameplayZoneCount, 30);
  const containment = fatih.geometryQa.polygonTechnical.gameplayParentContainmentNote;
  assert.ok(containment);
  assert.equal(containment.classification, "parent-containment-exceeds-default-tolerance");
  assert.equal(fatih.geometryQa.polygonTechnical.gameplaySpatialOk, false);
  assert.equal(containment.errors[0].outsideAreaM2, 2);
});
