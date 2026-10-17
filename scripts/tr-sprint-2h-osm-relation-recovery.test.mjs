import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { TURKEY_ADM3_OSM_PARSER_IMPLEMENTATION_REVISION } from "../packages/generators/dist/turkey-adm3.mjs";
import { pilotBySlug } from "./lib/tr-mahalle-identity-istanbul-pilots.mjs";
import {
  SPRINT_2H_REPORT_ROOT,
  assertPilotRegistryClipConsistency,
  expectedParentAdm2Id,
  resolveDistrictExtractionClipRel,
  sprint2gClipBboxRel,
  sprint2gClipPolyRel,
  validateDistrictClipAssignment
} from "./lib/tr-sprint-2h-osm-relation-recovery.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_DIR = join(REPO_ROOT, SPRINT_2H_REPORT_ROOT);

test("Sprint 2H parser revision documents multipolygon stitch", () => {
  assert.match(TURKEY_ADM3_OSM_PARSER_IMPLEMENTATION_REVISION, /sprint-2h-multipolygon-stitch/);
});

test("Istanbul pilot clip paths embed canonical adm2Suffix (no manual swap table)", () => {
  const registry = assertPilotRegistryClipConsistency();
  assert.equal(registry.ok, true, JSON.stringify(registry.mismatches));

  const uskudar = pilotBySlug("uskudar");
  assert.equal(uskudar.adm2Suffix, "54988432b79162079631621");
  assert.ok(sprint2gClipBboxRel(uskudar).includes("54988432b79162079631621"));
  assert.ok(!sprint2gClipBboxRel(uskudar).includes("54988432b71345383711908"));
});

test("validateDistrictClipAssignment rejects wrong clip suffix", () => {
  const uskudar = pilotBySlug("uskudar");
  const parent = { id: expectedParentAdm2Id(uskudar) };
  const wrongClip = ".territory/sprint-2g/osm-clip-bbox-54988432b71345383711908.osm.pbf";
  const result = validateDistrictClipAssignment(uskudar, parent, wrongClip);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((row) => row.code === "CLIP_SUFFIX_MISMATCH"));
});

test("validateDistrictClipAssignment rejects parent mismatch", () => {
  const fatih = pilotBySlug("fatih");
  const clip = resolveDistrictExtractionClipRel(fatih);
  const result = validateDistrictClipAssignment(fatih, { id: "tr:adm2:wrong" }, clip);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((row) => row.code === "PARENT_ADM2_MISMATCH"));
});

test("Fatih polygon clip recovers many more OSM admin polygons than Sprint 2G baseline", async (t) => {
  const clip = sprint2gClipPolyRel(pilotBySlug("fatih"));
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

  const matrix = JSON.parse(
    await readFile(join(REPORT_DIR, "istanbul-eight-district-recovery-matrix.json"), "utf8")
  );
  const uskudar = matrix.districts.find((row) => row.slug === "uskudar");
  assert.ok(uskudar);
  assert.equal(uskudar.adm2Suffix, "54988432b79162079631621");
  assert.ok(String(uskudar.clipRel).includes("54988432b79162079631621"));

  const qa = JSON.parse(await readFile(join(REPORT_DIR, "polygon-technical-qa.json"), "utf8"));
  const fatihQa = qa.byDistrict.fatih;
  assert.ok(fatihQa);
  assert.equal(fatihQa.status, "ASSESSED");
  assert.ok(fatihQa.ringValidation?.ok !== undefined);
  assert.equal(typeof fatihQa.structurallyValidPolygonCount, "number");
});
