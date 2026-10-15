import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const REPORT_DIR = "reports/tr-adm3/mahalle-identity-layer";

const EXPECTED_IMMUTABILITY = {
  zoneIdSetSha256: "334ba60d9e4bf65c2acfce7d3724e7bf430ec082ad897459a902c19d3660852f",
  geometryHashSetSha256: "3b4c2dd9214f6aa1023277a3426e100bd9c2902f5c06e4a49b2478e462866645",
  zoneCount: 30,
  ambiguousZoneCount: 15,
  singleSeedZoneCount: 10,
  unseededZoneCount: 5,
  distinctSeedsRepresented: 71
};

test("Fatih mahalle identity committed reports preserve geometry immutability contract", async () => {
  const immutability = JSON.parse(
    await readFile(`${REPORT_DIR}/fatih-geometry-immutability.json`, "utf8")
  );
  assert.equal(immutability.schemaVersion, "territorykit-tr-mahalle-identity-immutability@1");
  assert.equal(immutability.zoneCount, EXPECTED_IMMUTABILITY.zoneCount);
  assert.equal(immutability.zoneIdSetSha256, EXPECTED_IMMUTABILITY.zoneIdSetSha256);
  assert.equal(immutability.geometryHashSetSha256, EXPECTED_IMMUTABILITY.geometryHashSetSha256);
  assert.equal(immutability.determinismVerified, true);

  const ambiguity = JSON.parse(await readFile(`${REPORT_DIR}/fatih-ambiguity-report.json`, "utf8"));
  assert.equal(ambiguity.ambiguousZoneCount, EXPECTED_IMMUTABILITY.ambiguousZoneCount);
  assert.equal(ambiguity.singleSeedZoneCount, EXPECTED_IMMUTABILITY.singleSeedZoneCount);
  assert.equal(ambiguity.unseededZoneCount, EXPECTED_IMMUTABILITY.unseededZoneCount);
  assert.equal(ambiguity.distinctSeedsRepresented, EXPECTED_IMMUTABILITY.distinctSeedsRepresented);

  const associations = JSON.parse(
    await readFile(`${REPORT_DIR}/fatih-zone-associations.json`, "utf8")
  );
  assert.equal(associations.schemaVersion, "territorykit-tr-mahalle-zone-associations@1");
  assert.equal(associations.boundaryMode, "covers");
  assert.ok(associations.associations.length > 0);
  assert.ok(
    associations.associations.every((row) => row.reviewDecision === "pending"),
    "automatic associations must not claim human review approval"
  );
  assert.ok(
    associations.zoneSummaries.every((row) => row.autoDisplayNameAllowed === false),
    "auto display naming must remain disabled without explicit review evidence"
  );

  const coverage = JSON.parse(
    await readFile(`${REPORT_DIR}/fatih-coverage-and-provenance.json`, "utf8")
  );
  assert.equal(coverage.officialPolygonCoverage.settlementCountWithOfficialPolygon, 0);
  assert.equal(
    coverage.officialPolygonCoverage.settlementCountSeedOnly,
    EXPECTED_IMMUTABILITY.distinctSeedsRepresented
  );
});
