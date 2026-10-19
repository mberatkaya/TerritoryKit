import { describe, expect, it } from "vitest";
import {
  buildSettlementIdentityLayer,
  settlementHasLawfulPolygonEvidence,
  validateSettlementIdentityLayer,
  type SettlementIdentityLayer,
  type SettlementIdentitySeedInput,
  type TerritoryDataset,
  type TerritoryZone
} from "../src/index.js";

function squareZone(id: string, west: number, south: number, size: number): TerritoryZone {
  const east = west + size;
  const north = south + size;
  return {
    id,
    datasetId: "territory-kit-tr-v2-playable",
    level: 3,
    name: id,
    parentId: "tr:adm2:parent",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south]
        ]
      ]
    },
    neighborIds: [],
    center: [(west + east) / 2, (south + north) / 2],
    bbox: [west, south, east, north],
    properties: {}
  };
}

function buildFixtureDataset(): TerritoryDataset {
  const parent: TerritoryZone = {
    id: "tr:adm2:parent",
    datasetId: "territory-kit-tr-v2-playable",
    level: 2,
    name: "Parent",
    geometry: squareZone("parent-geom", 0, 0, 10).geometry,
    neighborIds: [],
    center: [5, 5],
    bbox: [0, 0, 10, 10],
    properties: {}
  };

  return {
    manifest: {
      datasetId: "territory-kit-tr-v2-playable",
      datasetVersion: "2.1.0-rc.8",
      schemaVersion: "territory-schema@1",
      sourceDate: "test",
      geometryHash: "test-geometry-hash",
      license: "Apache-2.0",
      name: "Fixture"
    },
    zones: [parent, squareZone("z-a", 0, 0, 5), squareZone("z-b", 5, 0, 5)]
  };
}

function buildFixtureLayer(seeds: SettlementIdentitySeedInput[]): SettlementIdentityLayer {
  const dataset = buildFixtureDataset();
  const parent = dataset.zones[0]!;
  return buildSettlementIdentityLayer({
    gameplayZones: dataset.zones.filter((zone) => zone.level === 3),
    parentAdm2Zone: parent,
    seeds,
    gameplayDatasetVersion: dataset.manifest.datasetVersion,
    identityLayerVersion: "test@1",
    generatedAt: "2026-10-15T00:00:00.000Z",
    defaultProvenance: {
      providerId: "openstreetmap",
      licenseState: "pending",
      permissionStatus: "redistribution-unknown",
      sourceLockState: "unknown",
      snapshotChecksum: "sha256:test-snapshot"
    }
  });
}

describe("validateSettlementIdentityLayer", () => {
  const dataset = buildFixtureDataset();
  const validLayer = buildFixtureLayer([
    { name: "Alpha", coordinate: [1, 1], sourceId: "osm:node:1", type: "quarter" }
  ]);

  it("accepts aligned gameplay dataset and identity layer", () => {
    const report = validateSettlementIdentityLayer({
      layer: validLayer,
      gameplayDataset: dataset,
      pins: { parentAdm2Id: "tr:adm2:parent" }
    });
    expect(report.ok).toBe(true);
    expect(report.issues).toHaveLength(0);
  });

  it("rejects wrong dataset version pin", () => {
    const report = validateSettlementIdentityLayer({
      layer: validLayer,
      gameplayDataset: dataset,
      pins: {
        parentAdm2Id: "tr:adm2:parent",
        gameplayDatasetVersion: "2.1.0-rc.7"
      }
    });
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.code === "DATASET_VERSION_MISMATCH")).toBe(true);
  });

  it("rejects geometry hash pin mismatch", () => {
    const report = validateSettlementIdentityLayer({
      layer: validLayer,
      gameplayDataset: dataset,
      pins: {
        parentAdm2Id: "tr:adm2:parent",
        geometryHashSetSha256: "deadbeef"
      }
    });
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.code === "GEOMETRY_HASH_SET_MISMATCH")).toBe(true);
  });

  it("rejects stale source snapshot checksum", () => {
    const report = validateSettlementIdentityLayer({
      layer: validLayer,
      gameplayDataset: dataset,
      pins: {
        parentAdm2Id: "tr:adm2:parent",
        expectedOsmSnapshotChecksum: "sha256:stale"
      }
    });
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.code === "SOURCE_SNAPSHOT_MISMATCH")).toBe(true);
  });

  it("rejects forged polygon evidence claims", () => {
    const forged = {
      ...validLayer.settlements[0]!,
      polygonEvidenceState: "verified-official-polygon" as const
    };
    const layer: SettlementIdentityLayer = {
      ...validLayer,
      settlements: [forged]
    };
    const report = validateSettlementIdentityLayer({
      layer,
      gameplayDataset: dataset,
      pins: { parentAdm2Id: "tr:adm2:parent" }
    });
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.code === "FORGED_POLYGON_EVIDENCE")).toBe(true);
    expect(settlementHasLawfulPolygonEvidence(forged)).toBe(false);
  });

  it("rejects duplicate settlement IDs", () => {
    const duplicate = validLayer.settlements[0]!;
    const layer: SettlementIdentityLayer = {
      ...validLayer,
      settlements: [duplicate, duplicate]
    };
    const report = validateSettlementIdentityLayer({
      layer,
      gameplayDataset: dataset,
      pins: { parentAdm2Id: "tr:adm2:parent" }
    });
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.code === "DUPLICATE_SETTLEMENT_ID")).toBe(true);
  });

  it("rejects unknown zone references", () => {
    const layer: SettlementIdentityLayer = {
      ...validLayer,
      associations: [
        {
          ...validLayer.associations[0]!,
          zoneId: "tr:adm3:missing"
        }
      ]
    };
    const report = validateSettlementIdentityLayer({
      layer,
      gameplayDataset: dataset,
      pins: { parentAdm2Id: "tr:adm2:parent" }
    });
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.code === "UNKNOWN_ZONE_REFERENCE")).toBe(true);
  });

  it("rejects wrong schema version", () => {
    const layer = {
      ...validLayer,
      schemaVersion:
        "territorykit-settlement-identity-layer@0" as SettlementIdentityLayer["schemaVersion"]
    };
    const report = validateSettlementIdentityLayer({
      layer,
      gameplayDataset: dataset,
      pins: { parentAdm2Id: "tr:adm2:parent" }
    });
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.code === "SCHEMA_VERSION_MISMATCH")).toBe(true);
  });
});
