import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  CANONICAL_ADM1_HIERARCHY_REPORT,
  DEFAULT_PARENT_REGISTRY,
  METADATA_LOOKUP_ADM1_IDENTITY_SCOPE,
  adm1LookupRefFromProvinceCode,
  districtRow,
  generateCoverage,
  inspectFile,
  parentInventoryFromRegistry,
  resolveCanonicalParentInventory
} from "./tr-adm3-quality-source-audit.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

test("metadata-only parent inventory keeps parent area measurements null", () => {
  const row = districtRow({
    district: { ...district, geometry: null },
    zones: [],
    available: false
  });
  assert.equal(row.parentAreaM2, null);
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

test("registry metadata enumerates the canonical 973/81 parent inventory", async () => {
  const registry = JSON.parse(
    await readFile(path.join(REPO_ROOT, DEFAULT_PARENT_REGISTRY), "utf8")
  );
  const inventory = parentInventoryFromRegistry(registry);
  assert.equal(inventory.parentInventorySource, "METADATA_REGISTRY_ONLY");
  assert.equal(inventory.parentGeometryAvailable, false);
  assert.equal(inventory.parentAdm1IdentityScope, METADATA_LOOKUP_ADM1_IDENTITY_SCOPE);
  assert.equal(inventory.parents.zones.length, 973);
  assert.equal(inventory.provinces.zones.length, 81);
  assert.ok(
    inventory.provinces.zones.every(
      (zone) =>
        zone.properties.territory.identityScope === METADATA_LOOKUP_ADM1_IDENTITY_SCOPE &&
        zone.properties.territory.authoritativeProductionIdentity === false
    )
  );
});

test("province-code ADM1 lookup refs match locked national hierarchy ids", async () => {
  const hierarchy = JSON.parse(
    await readFile(path.join(REPO_ROOT, CANONICAL_ADM1_HIERARCHY_REPORT), "utf8")
  );
  const expected = new Set(hierarchy.countryChildIds);
  for (let code = 1; code <= 81; code += 1) {
    const provinceCode = String(code).padStart(2, "0");
    const lookupRef = adm1LookupRefFromProvinceCode(provinceCode);
    assert.ok(expected.has(lookupRef), lookupRef);
  }
  assert.equal(expected.size, 81);
});

test("an unavailable national candidate exports all 973 parents with null polygon measurements", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "territory-audit-missing-"));
  try {
    const result = await generateCoverage({
      artifactRoot: path.join(root, "missing"),
      parentDataset: path.join(root, "also-missing.json"),
      output: root
    });
    assert.equal(result.districts.length, 973);
    assert.equal(new Set(result.districts.map((d) => d.provinceCode)).size, 81);
    assert.equal(result.totals, null);
    assert.equal(result.parentInventorySource, "METADATA_REGISTRY_ONLY");
    assert.equal(result.parentGeometryAvailable, false);
    assert.ok(
      result.districts.every(
        (d) =>
          d.generatedFeatureCount === null &&
          d.officialAreaPercent === null &&
          d.parentAreaM2 === null &&
          d.reasonCode === "ARTIFACT_NOT_AVAILABLE"
      )
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("checksum-mismatched ADM2 bytes fall back to registry metadata instead of failing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "territory-audit-parent-mismatch-"));
  try {
    const artifactRoot = path.join(root, "candidate");
    const adm2Path = path.join(artifactRoot, "levels/ADM2/dataset.json");
    await mkdir(path.dirname(adm2Path), { recursive: true });
    await writeFile(adm2Path, '{"zones":[]}', "utf8");
    await writeFile(
      path.join(artifactRoot, "checksums.json"),
      JSON.stringify({
        files: {
          "levels/ADM2/dataset.json": { sha256: "0".repeat(64), byteSize: 1 }
        }
      }),
      "utf8"
    );
    const resolved = await resolveCanonicalParentInventory({
      artifactRoot,
      parentDataset: path.join(root, "missing-parent.json"),
      parentRegistry: path.join(REPO_ROOT, DEFAULT_PARENT_REGISTRY)
    });
    assert.equal(resolved.parentInventorySource, "METADATA_REGISTRY_ONLY");
    assert.equal(resolved.parentResolutionAttempts[0].fileEvidence.status, "CHECKSUM_MISMATCH");
    assert.equal(resolved.parents.zones.length, 973);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ADM2 inventory without usable geometries cannot enable parent area measurements", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "territory-audit-parent-null-geo-"));
  try {
    const registry = JSON.parse(
      await readFile(path.join(REPO_ROOT, DEFAULT_PARENT_REGISTRY), "utf8")
    );
    const inventory = parentInventoryFromRegistry(registry);
    const parentDataset = path.join(root, "parents-null-geometry.json");
    await writeFile(
      parentDataset,
      JSON.stringify({
        zones: [
          ...inventory.provinces.zones,
          ...inventory.parents.zones.map((zone) => ({ ...zone, geometry: null }))
        ]
      }),
      "utf8"
    );
    const resolved = await resolveCanonicalParentInventory({
      artifactRoot: path.join(root, "missing-candidate"),
      parentDataset,
      parentRegistry: path.join(REPO_ROOT, DEFAULT_PARENT_REGISTRY)
    });
    assert.equal(resolved.parentInventorySource, "METADATA_REGISTRY_ONLY");
    assert.equal(resolved.parentGeometryAvailable, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("available polygon parents are preferred over registry metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "territory-audit-parent-polygon-"));
  try {
    const registry = JSON.parse(
      await readFile(path.join(REPO_ROOT, DEFAULT_PARENT_REGISTRY), "utf8")
    );
    const inventory = parentInventoryFromRegistry(registry);
    const parentDataset = path.join(root, "parents.json");
    await writeFile(
      parentDataset,
      JSON.stringify({
        zones: [
          ...inventory.provinces.zones.map((zone) => ({ ...zone, geometry })),
          ...inventory.parents.zones.map((zone) => ({ ...zone, geometry }))
        ]
      }),
      "utf8"
    );
    const resolved = await resolveCanonicalParentInventory({
      artifactRoot: path.join(root, "missing-candidate"),
      parentDataset,
      parentRegistry: path.join(REPO_ROOT, DEFAULT_PARENT_REGISTRY)
    });
    assert.equal(resolved.parentInventorySource, "CONFIGURED_PARENT_DATASET");
    assert.equal(resolved.parentGeometryAvailable, true);
    assert.equal(resolved.parents.zones.filter((zone) => zone.level === 2).length, 973);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unavailable parents throw only when registry metadata is also missing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "territory-audit-no-parents-"));
  try {
    await assert.rejects(
      () =>
        resolveCanonicalParentInventory({
          artifactRoot: path.join(root, "candidate"),
          parentDataset: path.join(root, "missing-parent.json"),
          parentRegistry: path.join(root, "missing-registry.json")
        }),
      /Canonical ADM1\/ADM2 parent inventory is unavailable/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("partial ADM3 bytes with checksum mismatch keep measurements null", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "territory-audit-partial-"));
  try {
    const artifactRoot = path.join(root, "candidate");
    const adm3Path = path.join(artifactRoot, "levels/ADM3/dataset.json");
    await mkdir(path.dirname(adm3Path), { recursive: true });
    const manifest = {
      datasetVersion: "fixture",
      geometryHash: "deadbeef"
    };
    await writeFile(
      adm3Path,
      JSON.stringify({
        manifest,
        zones: [
          {
            id: "tr:adm3:fixture",
            level: 3,
            geometry,
            parentId: "tr:adm2:54988432b39717738295698",
            properties: { territory: { sourceClass: "generated" } }
          }
        ]
      }),
      "utf8"
    );
    await writeFile(
      path.join(artifactRoot, "checksums.json"),
      JSON.stringify({
        files: {
          "levels/ADM3/dataset.json": { sha256: "0".repeat(64), byteSize: 1 }
        }
      }),
      "utf8"
    );
    const result = await generateCoverage({
      artifactRoot,
      parentDataset: path.join(root, "missing-parent.json"),
      output: root
    });
    assert.equal(result.fileEvidence.status, "CHECKSUM_MISMATCH");
    assert.equal(result.totals, null);
    assert.equal(result.districts[0].generatedFeatureCount, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
