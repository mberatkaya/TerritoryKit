import { describe, expect, it } from "vitest";
import {
  loadTerritoryDataset,
  TERRITORY_SCHEMA_VERSION,
  territoryDatasetJsonSchema
} from "../src/index.js";
import type { TerritoryDataset } from "../src/index.js";

describe("dataset compatibility", () => {
  it("keeps territory-schema@1 stable for legacy fixture datasets", () => {
    const legacyDataset: TerritoryDataset = {
      manifest: {
        datasetId: "legacy-fixture",
        datasetVersion: "0.1.0-alpha.1",
        schemaVersion: "territory-schema@1",
        sourceDate: "2026-07",
        geometryHash: "legacy-fixture-v1"
      },
      zones: [
        {
          id: "legacy:root",
          datasetId: "legacy-fixture",
          level: 0,
          childIds: ["legacy:child"],
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
        },
        {
          id: "legacy:child",
          datasetId: "legacy-fixture",
          level: 1,
          parentId: "legacy:root",
          neighborIds: [],
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0.25, 0.25],
                [0.75, 0.25],
                [0.75, 0.75],
                [0.25, 0.75],
                [0.25, 0.25]
              ]
            ]
          },
          center: [0.5, 0.5],
          bbox: [0.25, 0.25, 0.75, 0.75],
          properties: {}
        }
      ]
    };
    const loadedDataset = loadTerritoryDataset(legacyDataset);

    expect(TERRITORY_SCHEMA_VERSION).toBe("territory-schema@1");
    expect(territoryDatasetJsonSchema.properties.manifest.properties.schemaVersion.const).toBe(
      "territory-schema@1"
    );
    expect(loadedDataset.manifest.datasetVersion).toBe("0.1.0-alpha.1");
    expect(loadedDataset.zones.map((zone) => zone.id)).toEqual(["legacy:root", "legacy:child"]);
  });
});
