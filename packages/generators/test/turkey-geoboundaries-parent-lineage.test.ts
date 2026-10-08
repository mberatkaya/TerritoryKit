import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { TerritoryAdminLevel, TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";
import {
  findGeoBoundariesArtifactBySha256,
  inspectTurkeyGeoBoundariesParentLineage,
  verifyGeoBoundariesSourceArtifactBytes,
  verifyTurkeyGeoBoundariesParentLineage
} from "../src/turkey-geoboundaries-parent-lineage.js";
import { auditGeometryHash } from "../src/turkey-parent-provenance.js";

const FIXTURE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/tr-geoboundaries-parent"
);

const square = {
  type: "Polygon" as const,
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

function zone(input: {
  id: string;
  level: number;
  name: string;
  sourceId: string;
  geometry?: TerritoryZone["geometry"];
}): TerritoryZone {
  return {
    id: input.id,
    datasetId: "fixture",
    countryCode: "TR",
    level: input.level,
    sourceAdminLevel: `ADM${input.level}` as TerritoryAdminLevel,
    semanticType: input.level === 0 ? "country" : input.level === 1 ? "province" : "district",
    name: input.name,
    neighborIds: [],
    geometry: input.geometry ?? square,
    center: [28.5, 40.5],
    bbox: [28, 40, 29, 41],
    properties: {
      territory: {
        source: { provider: "geoboundaries", sourceId: input.sourceId }
      }
    }
  };
}

function dataset(zones: TerritoryZone[]): TerritoryDataset {
  return {
    manifest: {
      datasetId: "fixture-tr-geoboundaries-parent",
      datasetVersion: "fixture",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-01-26",
      buildDate: "2026-01-26T00:00:00.000Z",
      geometryHash: "fixture",
      adminLevels: ["ADM0", "ADM1", "ADM2"],
      countryCodes: ["TR"],
      crs: "EPSG:4326",
      geometryDetail: "source",
      license: "fixture",
      attribution: "fixture"
    },
    zones
  } as TerritoryDataset;
}

describe("turkey-geoboundaries-parent-lineage", () => {
  it("detects corrupted upstream bytes", async () => {
    const artifactPath = join(FIXTURE_ROOT, "gb-adm0-tiny.geojson");
    const expectedSha256 = createHash("sha256")
      .update(await readFile(artifactPath))
      .digest("hex");
    const verified = await verifyGeoBoundariesSourceArtifactBytes({
      adminLevel: "ADM0",
      artifactPath,
      expectedSha256: `${expectedSha256.slice(0, -1)}0`
    });
    expect(verified.status).toBe("CHECKSUM_MISMATCH");
  });

  it("matches parent geometry after repair for fixture source", async () => {
    const sourcePath = join(FIXTURE_ROOT, "gb-adm0-tiny.geojson");
    const source = JSON.parse(await readFile(sourcePath, "utf8"));
    const shapeId = source.features[0].properties.shapeID as string;
    const parent = dataset([
      zone({ id: "tr", level: 0, name: "Turkey", sourceId: shapeId, geometry: square })
    ]);
    const lockPath = join(FIXTURE_ROOT, "source-lock.json");
    const inspection = await inspectTurkeyGeoBoundariesParentLineage({
      parentDataset: parent,
      sourceLockPath: lockPath,
      sourceArtifactPaths: { ADM0: sourcePath }
    });
    expect(inspection.byteVerification[0]?.status).toBe("LOCKED_BYTES_VERIFIED");
    expect(inspection.geometryComparison[0]?.repairedSerializedGeometryHashMatches).toBe(1);
    expect(verifyTurkeyGeoBoundariesParentLineage(inspection, { diagnosticMode: true }).ok).toBe(
      true
    );
    expect(verifyTurkeyGeoBoundariesParentLineage(inspection, { strict: true }).verified).toBe(
      false
    );
  });

  it("reports missing artifacts without claiming verified", async () => {
    const inspection = await inspectTurkeyGeoBoundariesParentLineage({
      parentDataset: dataset([zone({ id: "tr", level: 0, name: "Turkey", sourceId: "missing" })]),
      sourceLockPath: join(FIXTURE_ROOT, "source-lock.json")
    });
    expect(inspection.geoBoundariesUpstreamBytesVerified).toBe(false);
    expect(inspection.pathBFeasibility).toBe("PATH_B_BLOCKED_BY_MISSING_EVIDENCE");
    expect(verifyTurkeyGeoBoundariesParentLineage(inspection, { strict: true }).verified).toBe(
      false
    );
  });

  it("finds cache artifacts by pinned sha256", async () => {
    const artifactPath = join(FIXTURE_ROOT, "gb-adm0-tiny.geojson");
    const sha256 = createHash("sha256")
      .update(await readFile(artifactPath))
      .digest("hex");
    const cacheRoot = join(FIXTURE_ROOT, "cache");
    const found = await findGeoBoundariesArtifactBySha256(cacheRoot, sha256);
    expect(found?.artifactPath).toContain("artifact");
  });

  it("records real geometric differences after repair", async () => {
    const sourcePath = join(FIXTURE_ROOT, "gb-adm0-geometry-drift.geojson");
    const source = JSON.parse(await readFile(sourcePath, "utf8"));
    const shapeId = source.features[0].properties.shapeID as string;
    const parent = dataset([
      zone({
        id: "tr",
        level: 0,
        name: "Turkey",
        sourceId: shapeId,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [30, 40],
              [31, 40],
              [31, 41],
              [30, 41],
              [30, 40]
            ]
          ]
        }
      })
    ]);
    const inspection = await inspectTurkeyGeoBoundariesParentLineage({
      parentDataset: parent,
      sourceLockPath: join(FIXTURE_ROOT, "source-lock.json"),
      sourceArtifactPaths: { ADM0: sourcePath }
    });
    expect(inspection.geometryComparison[0]?.serializedGeometryHashMismatches).toBe(1);
    expect(inspection.geometryComparison[0]?.repairedSerializedGeometryHashMatches).toBe(0);
  });

  it("parsed GeoJSON comparison ignores on-disk serialization-only file differences", async () => {
    const sourcePath = join(FIXTURE_ROOT, "gb-adm0-serialization-only.geojson");
    const source = JSON.parse(await readFile(sourcePath, "utf8"));
    const shapeId = source.features[0].properties.shapeID as string;
    const parent = dataset([
      zone({
        id: "tr",
        level: 0,
        name: "Turkey",
        sourceId: shapeId,
        geometry: square
      })
    ]);
    const inspection = await inspectTurkeyGeoBoundariesParentLineage({
      parentDataset: parent,
      sourceLockPath: join(FIXTURE_ROOT, "source-lock.json"),
      sourceArtifactPaths: { ADM0: sourcePath }
    });
    expect(inspection.geometryComparison[0]?.rawSerializedGeometryHashMatches).toBe(1);
    expect(auditGeometryHash(parent.zones[0]!.geometry)).toBe(auditGeometryHash(square));
  });
});
