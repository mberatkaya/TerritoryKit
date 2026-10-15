import { describe, expect, it } from "vitest";
import {
  buildSettlementIdentityLayer,
  dedupeSettlementSeeds,
  normalizeTurkishSettlementName,
  pointIntersectsGeometry,
  type SettlementIdentitySeedInput,
  type TerritoryZone
} from "../src/index.js";

function squareZone(id: string, west: number, south: number, size: number): TerritoryZone {
  const east = west + size;
  const north = south + size;
  return {
    id,
    datasetId: "test",
    level: 3,
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
    neighborIds: [],
    center: [(west + east) / 2, (south + north) / 2],
    bbox: [west, south, east, north],
    properties: {}
  };
}

describe("normalizeTurkishSettlementName", () => {
  it("applies Turkish locale rules for dotted/dotless I", () => {
    expect(normalizeTurkishSettlementName("İSTANBUL")).toBe("istanbul");
    expect(normalizeTurkishSettlementName("IŞIK")).toBe("ışık");
  });
});

describe("pointIntersectsGeometry boundary policy", () => {
  const geometry = {
    type: "Polygon" as const,
    coordinates: [
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
        [0, 0]
      ]
    ]
  };

  it("treats boundary points as inside under covers", () => {
    expect(pointIntersectsGeometry([0, 1], geometry, "covers")).toBe(true);
  });

  it("treats boundary points as outside under contains", () => {
    expect(pointIntersectsGeometry([0, 1], geometry, "contains")).toBe(false);
  });
});

describe("buildSettlementIdentityLayer", () => {
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

  const baseOptions = {
    gameplayZones: [squareZone("z-a", 0, 0, 5), squareZone("z-b", 5, 0, 5)],
    parentAdm2Zone: parent,
    gameplayDatasetVersion: "2.1.0-rc.8",
    identityLayerVersion: "tr-mahalle-identity-fatih@2026-10-15",
    generatedAt: "2026-10-15T00:00:00.000Z",
    defaultProvenance: {
      providerId: "openstreetmap",
      licenseState: "approved" as const,
      permissionStatus: "redistribution-approved" as const,
      license: "ODbL-1.0",
      attribution: "OpenStreetMap contributors"
    }
  };

  it("marks multi-seed zones as ambiguous and blocks auto display naming", () => {
    const seeds: SettlementIdentitySeedInput[] = [
      { name: "Alpha", coordinate: [1, 1], sourceId: "osm:node:1", type: "quarter" },
      { name: "Beta", coordinate: [2, 2], sourceId: "osm:node:2", type: "quarter" }
    ];
    const layer = buildSettlementIdentityLayer({ ...baseOptions, seeds });
    const summary = layer.zoneSummaries.find((row) => row.zoneId === "z-a");
    expect(summary?.associationStatus).toBe("multiple-candidates");
    expect(summary?.autoDisplayNameAllowed).toBe(false);
  });

  it("rejects seeds outside parent ADM2", () => {
    const seeds: SettlementIdentitySeedInput[] = [
      { name: "Outside", coordinate: [20, 20], sourceId: "osm:node:99" }
    ];
    const { rejected } = dedupeSettlementSeeds(seeds, parent.geometry);
    expect(rejected[0]?.reasonCode).toBe("OUTSIDE_PARENT_ADM2");
  });

  it("is deterministic for identical inputs", () => {
    const seeds: SettlementIdentitySeedInput[] = [
      { name: "Yedikule", coordinate: [1, 1], sourceId: "osm:node:10", type: "quarter" }
    ];
    const first = buildSettlementIdentityLayer({ ...baseOptions, seeds });
    const second = buildSettlementIdentityLayer({ ...baseOptions, seeds });
    expect(first.contentChecksum).toBe(second.contentChecksum);
  });
});
