import { describe, expect, it } from "vitest";
import { buildTrSettlementAssociations } from "@territory-kit/dataset/tr-settlement-association";
import type { TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";
import { createTrSettlementAssociationQuery } from "../src/settlement-association-query.js";
import { loadTrSettlementAssociationConsumer } from "../src/settlement-association-loader.js";

function zone(id: string): TerritoryZone {
  return {
    id,
    datasetId: "test",
    level: 3,
    parentId: "tr:adm2:parent",
    neighborIds: [],
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0]
        ]
      ]
    },
    center: [0.5, 0.5],
    bbox: [0, 0, 1, 1],
    properties: {}
  };
}

const dataset = {
  manifest: {
    schemaVersion: "territory-schema@1",
    datasetId: "territory-kit-tr-test",
    datasetVersion: "2.1.0-rc.8",
    sourceDate: "2026-01-01T00:00:00.000Z",
    geometryHash: "hash"
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
    zone("zone-1"),
    {
      ...zone("zone-empty"),
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [1, 0],
            [2, 0],
            [2, 1],
            [1, 1],
            [1, 0]
          ]
        ]
      },
      center: [1.5, 0.5],
      bbox: [1, 0, 2, 1]
    }
  ]
} as TerritoryDataset;

describe("settlement association consumer loader", () => {
  it("fail-closes invalid artifacts and exposes query only when valid", () => {
    const artifact = buildTrSettlementAssociations({
      dataset,
      parentAdm2Id: "tr:adm2:parent",
      builtAt: "2026-10-15T00:00:00.000Z",
      source: {
        providerId: "osm",
        license: "ODbL-1.0",
        licenseState: "approved",
        sourceSnapshotChecksum: "e".repeat(64)
      },
      seeds: [{ name: "Mahalle", coordinate: [0.5, 0.5], sourceId: "node:99" }]
    });

    const invalid = loadTrSettlementAssociationConsumer({
      dataset,
      artifact: { ...artifact, datasetVersion: "wrong" },
      expectedSourceSnapshotChecksum: "e".repeat(64)
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.query).toBeNull();

    const ready = loadTrSettlementAssociationConsumer({
      dataset,
      artifact,
      expectedSourceSnapshotChecksum: "e".repeat(64)
    });
    expect(ready.ok).toBe(true);
    expect(ready.query).not.toBeNull();
  });

  it("distinguishes unknown zones from unseeded zones", () => {
    const artifact = buildTrSettlementAssociations({
      dataset,
      parentAdm2Id: "tr:adm2:parent",
      builtAt: "2026-10-15T00:00:00.000Z",
      source: {
        licenseState: "approved",
        license: "test",
        sourceSnapshotChecksum: "f".repeat(64)
      },
      seeds: [{ name: "Mahalle", coordinate: [0.5, 0.5], sourceId: "node:99" }]
    });

    const query = createTrSettlementAssociationQuery(artifact, {
      dataset,
      parentAdm2Id: artifact.parentAdm2Id
    });

    expect(query.getAssociationsForZone("zone-1").zoneResolution).toBe("associated");
    expect(query.getAssociationsForZone("zone-empty").zoneResolution).toBe("unseeded");
    expect(query.getAssociationsForZone("tr:adm3:does-not-exist").zoneResolution).toBe(
      "unknown-zone"
    );
  });
});
