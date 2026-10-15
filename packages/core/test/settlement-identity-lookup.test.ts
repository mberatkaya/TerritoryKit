import { describe, expect, it } from "vitest";
import {
  SETTLEMENT_IDENTITY_LAYER_SCHEMA_VERSION,
  buildSettlementIdentityLayer,
  type SettlementIdentitySeedInput,
  type TerritoryZone
} from "@territory-kit/dataset";
import { createSettlementIdentityLookup } from "../src/settlement-identity-lookup.js";

describe("createSettlementIdentityLookup", () => {
  const parent: TerritoryZone = {
    id: "tr:adm2:parent",
    datasetId: "test",
    level: 2,
    name: "Parent",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0]
        ]
      ]
    },
    neighborIds: [],
    center: [5, 5],
    bbox: [0, 0, 10, 10],
    properties: {}
  };

  const zone: TerritoryZone = {
    id: "z-a",
    datasetId: "test",
    level: 3,
    name: "Zone A",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [5, 0],
          [5, 5],
          [0, 5],
          [0, 0]
        ]
      ]
    },
    neighborIds: [],
    center: [2.5, 2.5],
    bbox: [0, 0, 5, 5],
    properties: {}
  };

  const seeds: SettlementIdentitySeedInput[] = [
    { name: "Alpha", coordinate: [1, 1], sourceId: "osm:node:1", type: "quarter" }
  ];

  const layer = buildSettlementIdentityLayer({
    gameplayZones: [zone],
    parentAdm2Zone: parent,
    seeds,
    gameplayDatasetVersion: "2.1.0-rc.8",
    identityLayerVersion: "test@1",
    generatedAt: "2026-10-15T00:00:00.000Z",
    defaultProvenance: {
      providerId: "openstreetmap",
      licenseState: "pending",
      permissionStatus: "redistribution-unknown",
      sourceLockState: "unknown"
    }
  });

  it("answers zone and settlement queries", () => {
    expect(layer.schemaVersion).toBe(SETTLEMENT_IDENTITY_LAYER_SCHEMA_VERSION);
    const lookup = createSettlementIdentityLookup({ layer });
    const zoneView = lookup.listSettlementsForZone("z-a");
    expect(zoneView.settlements).toHaveLength(1);
    expect(zoneView.autoDisplayNameAllowed).toBe(false);
    expect(zoneView.associations.every((row) => row.reviewDecision === "pending")).toBe(true);
    expect(zoneView.isAmbiguous).toBe(false);

    const settlementId = zoneView.settlements[0]!.settlementId;
    const seedView = lookup.findZonesForSettlement(settlementId);
    expect(seedView?.zoneIds).toEqual(["z-a"]);
    expect(seedView?.lawfulPolygonExists).toBe(false);
    expect(seedView?.geometryAvailability).toBe("seed-only");
  });
});
