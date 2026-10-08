import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { districtRow, generateCoverage, inspectFile } from "./tr-adm3-quality-source-audit.mjs";

const geometry = {
  type: "Polygon",
  coordinates: [
    [
      [28, 40],
      [29, 40],
      [29, 41],
      [28, 41],
      [28, 40]
    ]
  ]
};
const district = {
  id: "parent",
  name: "Fixture",
  geometry,
  properties: { territory: { provinceCode: "34" } }
};

test("missing polygon artifact leaves all measurements null even with optimistic recorded QA", () => {
  const row = districtRow({
    district,
    zones: [],
    available: false,
    smart: { confidence: "high", smartAcceptanceStatus: "USABLE_HIGH_CONFIDENCE" }
  });
  for (const key of [
    "officialFeatureCount",
    "osmAdministrativeFeatureCount",
    "generatedFeatureCount",
    "officialAreaPercent",
    "osmAreaPercent",
    "estimatedAreaPercent",
    "geometryHash",
    "confidence",
    "availableArtifactPath"
  ])
    assert.equal(row[key], null, key);
  assert.equal(row.reasonCode, "ARTIFACT_NOT_AVAILABLE");
  assert.equal(row.acceptanceStatus, "UNAVAILABLE");
});

test("OSM barriers used by a generated zone never count as OSM administrative coverage", () => {
  const zone = {
    id: "zone",
    level: 3,
    geometry,
    properties: {
      territory: {
        parentAdm2Id: "parent",
        sourceClass: "generated",
        providerId: "geofabrik-osm-extracts"
      }
    }
  };
  const row = districtRow({
    district,
    zones: [zone],
    available: true,
    artifactPath: "fixture.json"
  });
  assert.equal(row.generatedFeatureCount, 1);
  assert.equal(row.osmAdministrativeFeatureCount, 0);
  assert.equal(row.officialFeatureCount, 0);
  assert.equal(row.estimatedAreaPercent, 100);
  assert.equal(row.effectiveGeometryQAStatus, "QUALITY_NOT_AVAILABLE");
  assert.equal(row.hostedOrMobileEvidenceStatus, "NOT_OBSERVED");
});

test("an unknown source class is exposed instead of silently labelled official or generated", () => {
  const row = districtRow({
    district,
    zones: [{ id: "unknown", geometry, level: 3 }],
    available: true
  });
  assert.equal(row.unknownSourceFeatureCount, 1);
  assert.equal(row.reasonCode, "UNCLASSIFIED_SOURCE_CLASS");
  assert.equal(row.officialFeatureCount, 0);
});

test("locked file evidence distinguishes missing, unpinned, exact and mismatched bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "territory-audit-"));
  try {
    const file = path.join(root, "artifact.json");
    assert.equal((await inspectFile(file)).status, "ARTIFACT_NOT_AVAILABLE");
    await writeFile(file, "{}");
    const evidence = await inspectFile(file);
    assert.equal(evidence.status, "BYTES_AVAILABLE_UNPINNED");
    assert.equal((await inspectFile(file, evidence)).status, "LOCKED_BYTES_VERIFIED");
    assert.equal(
      (await inspectFile(file, { ...evidence, sha256: "0".repeat(64) })).status,
      "CHECKSUM_MISMATCH"
    );
    assert.equal(
      (await inspectFile(file, { ...evidence, byteSize: 3 })).status,
      "CHECKSUM_MISMATCH"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an unavailable national candidate exports all 973 parents with null polygon measurements", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "territory-audit-missing-"));
  try {
    const result = await generateCoverage({
      artifactRoot: path.join(root, "missing"),
      output: root
    });
    assert.equal(result.districts.length, 973);
    assert.equal(new Set(result.districts.map((d) => d.provinceCode)).size, 81);
    assert.equal(result.totals, null);
    assert.ok(
      result.districts.every(
        (d) =>
          d.generatedFeatureCount === null &&
          d.officialAreaPercent === null &&
          d.reasonCode === "ARTIFACT_NOT_AVAILABLE"
      )
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
