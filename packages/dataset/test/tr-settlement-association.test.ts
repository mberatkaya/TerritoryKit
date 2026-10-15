import { describe, expect, it } from "vitest";
import type { TerritoryDataset, TerritoryZone } from "../src/types.js";
import {
  buildTrSettlementAssociations,
  createTrSettlementRefId,
  normalizeTrSettlementName,
  validateTrSettlementAssociationArtifact
} from "../src/tr-settlement-association.js";
import { isLngLatInsideTerritoryGeometry } from "../src/geometry.js";

function squareZone(id: string, west: number, south: number, size: number): TerritoryZone {
  const east = west + size;
  const north = south + size;
  return {
    id,
    datasetId: "test",
    level: 3,
    parentId: "tr:adm2:parent",
    neighborIds: [],
    name: id,
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
    center: [(west + east) / 2, (south + north) / 2],
    bbox: [west, south, east, north],
    properties: {
      territory: {
        geometryHash: `sha256:${id}`
      }
    }
  };
}

function createDataset(zones: TerritoryZone[]): TerritoryDataset {
  return {
    manifest: {
      schemaVersion: "territory-schema@1",
      datasetId: "territory-kit-tr-test",
      datasetVersion: "2.1.0-rc.8",
      sourceDate: "2026-01-01T00:00:00.000Z",
      geometryHash: "manifest-hash"
    },
    zones: [
      {
        id: "tr:adm2:parent",
        datasetId: "test",
        level: 2,
        neighborIds: [],
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [2, 0],
              [2, 2],
              [0, 2],
              [0, 0]
            ]
          ]
        },
        center: [1, 1],
        bbox: [0, 0, 2, 2],
        properties: {}
      },
      ...zones
    ]
  };
}

describe("tr-settlement-association", () => {
  it("normalizes Turkish settlement names deterministically", () => {
    expect(normalizeTrSettlementName("  İSTANBUL  ")).toBe("istanbul");
    expect(normalizeTrSettlementName("Sümbül Efendi")).toBe("sümbül efendi");
  });

  it("builds stable settlementRefId without source-native id", () => {
    const ref = createTrSettlementRefId(
      { name: "Yedikule", coordinate: [28.9, 41.0] },
      { sourceSnapshotChecksum: "a".repeat(64) }
    );
    expect(ref.startsWith("tr:settlement-ref:")).toBe(true);
    expect(ref).toContain("name-");
  });

  it("classifies single-seed, ambiguous, and unseeded zones", () => {
    const dataset = createDataset([
      squareZone("zone-a", 0, 0, 1),
      squareZone("zone-b", 1, 0, 1),
      squareZone("zone-c", 0, 1, 1)
    ]);

    const artifact = buildTrSettlementAssociations({
      dataset,
      parentAdm2Id: "tr:adm2:parent",
      builtAt: "2026-10-15T00:00:00.000Z",
      source: {
        license: "ODbL-1.0",
        licenseState: "approved",
        sourceSnapshotChecksum: "b".repeat(64)
      },
      seeds: [
        { name: "Alpha", coordinate: [0.25, 0.25], sourceId: "node:1" },
        { name: "Beta", coordinate: [1.25, 0.25], sourceId: "node:2" },
        { name: "Gamma", coordinate: [1.25, 0.75], sourceId: "node:3" },
        { name: "Delta", coordinate: [1.25, 0.25], sourceId: "node:4" },
        { name: "Epsilon", coordinate: [1.25, 0.75], sourceId: "node:5" }
      ]
    });

    const summaryByZone = new Map(artifact.zoneSummaries.map((row) => [row.zoneId, row]));
    expect(summaryByZone.get("zone-a")?.associationStatus).toBe("SINGLE_SEED_MATCH");
    expect(summaryByZone.get("zone-b")?.associationStatus).toBe("AMBIGUOUS_REVIEW_REQUIRED");
    expect(summaryByZone.get("zone-c")?.associationStatus).toBe("UNSEEDED");

    const validation = validateTrSettlementAssociationArtifact(dataset, artifact);
    expect(validation.ok).toBe(true);
    expect(artifact.contentHash).toMatch(/^fnv1a32:/);
  });

  it("flags boundary and duplicate source ids", () => {
    const dataset = createDataset([squareZone("zone-edge", 0, 0, 1)]);
    const artifact = buildTrSettlementAssociations({
      dataset,
      parentAdm2Id: "tr:adm2:parent",
      builtAt: "2026-10-15T00:00:00.000Z",
      source: { sourceSnapshotChecksum: "c".repeat(64) },
      seeds: [
        { name: "Edge", coordinate: [1, 0.5], sourceId: "dup" },
        { name: "Edge B", coordinate: [0.5, 0.5], sourceId: "dup" }
      ]
    });

    const record = artifact.associations[0];
    expect(record?.reasonCodes).toContain("SEED_ON_BOUNDARY");
    expect(record?.reasonCodes).toContain("DUPLICATE_SOURCE_ID");
    expect(record?.associationStatus).toBe("SOURCE_REVIEW_REQUIRED");
  });

  it("does not treat names alone as stable ids", () => {
    const left = createTrSettlementRefId(
      { name: "Same", coordinate: [1, 1] },
      { sourceSnapshotChecksum: "d".repeat(64) }
    );
    const right = createTrSettlementRefId(
      { name: "Same", coordinate: [2, 2] },
      { sourceSnapshotChecksum: "d".repeat(64) }
    );
    expect(left).not.toBe(right);
  });

  it("supports point-in-zone geometry helper", () => {
    const zone = squareZone("z", 0, 0, 1);
    expect(isLngLatInsideTerritoryGeometry([0.5, 0.5], zone.geometry)).toBe(true);
    expect(isLngLatInsideTerritoryGeometry([2, 2], zone.geometry)).toBe(false);
  });
});
