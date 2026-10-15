import { describe, expect, it } from "vitest";
import { buildTrSettlementAssociations } from "@territory-kit/dataset/tr-settlement-association";
import type { TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";
import { createTrSettlementAssociationQuery } from "../src/settlement-association-query.js";

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
    zone("zone-1")
  ]
} as TerritoryDataset;

describe("settlement association query", () => {
  it("queries by zone and settlement ref with provenance", () => {
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

    const query = createTrSettlementAssociationQuery(artifact);
    const zoneResult = query.getAssociationsForZone("zone-1");
    expect(zoneResult.associationStatus).toBe("SINGLE_SEED_MATCH");
    expect(zoneResult.associations).toHaveLength(1);
    expect(zoneResult.provenance.providerId).toBe("osm");

    const refId = zoneResult.associations[0]!.settlementRefId;
    expect(query.getZonesForSettlement(refId)).toEqual(["zone-1"]);
  });
});
