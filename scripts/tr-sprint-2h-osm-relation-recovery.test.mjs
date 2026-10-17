import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { TURKEY_ADM3_OSM_PARSER_IMPLEMENTATION_REVISION } from "../packages/generators/dist/turkey-adm3.mjs";
import { SPRINT_2H_REPORT_ROOT } from "./lib/tr-sprint-2h-osm-relation-recovery.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_DIR = join(REPO_ROOT, SPRINT_2H_REPORT_ROOT);

test("Sprint 2H parser revision documents multipolygon stitch", () => {
  assert.match(TURKEY_ADM3_OSM_PARSER_IMPLEMENTATION_REVISION, /sprint-2h-multipolygon-stitch/);
});

test("Fatih polygon clip recovers many more OSM admin polygons than Sprint 2G baseline", async (t) => {
  const clip = ".territory/sprint-2g/osm-clip-poly-54988432b39641834885080.osm.pbf";
  const shard =
    ".territory/national-geometry-remediation/candidate-rc8-impl-rev1/districts/tr_adm2_54988432b39641834885080/dataset.json";
  if (!existsSync(join(REPO_ROOT, clip)) || !existsSync(join(REPO_ROOT, shard))) {
    t.skip("BLOCKED_BY_SOURCE: Fatih clip or rc.8 shard unavailable");
    return;
  }
  const { extractTurkeyAdm3OsmPbf } = await import("../packages/generators/dist/turkey-adm3.mjs");
  const dataset = JSON.parse(await readFile(join(REPO_ROOT, shard), "utf8"));
  const parent = dataset.zones.find((zone) => zone.level === 2);
  const result = await extractTurkeyAdm3OsmPbf({
    pbfPath: join(REPO_ROOT, clip),
    generatedAt: "2026-10-17T21:00:00.000Z",
    provinceCode: "34",
    districtZones: [parent]
  });
  assert.ok(result.zones.length >= 40, `expected >=40 polygons, got ${result.zones.length}`);
});

test("Sprint 2H decision artifact exists after generator run", async (t) => {
  const decisionPath = join(REPORT_DIR, "sprint-2h-decision.json");
  if (!existsSync(decisionPath)) {
    t.skip("NOT_RUN: run pnpm data:tr:sprint2h:osm-relation-recovery first");
    return;
  }
  const decision = JSON.parse(await readFile(decisionPath, "utf8"));
  assert.equal(decision.geographicalAcceptance, "NO_GO");
  assert.ok(decision.meaningfulProgress);
});
