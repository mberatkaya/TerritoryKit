import { describe, expect, it } from "vitest";
import {
  createTerritoryDatasetFromGeoJson,
  loadTerritoryDatasetFromGeoJson
} from "../src/index.js";
import type { TerritoryDatasetManifest } from "../src/index.js";

const manifest: TerritoryDatasetManifest = {
  datasetId: "geojson-test",
  datasetVersion: "0.1.0-alpha.1",
  schemaVersion: "territory-schema@1",
  sourceDate: "2026-07",
  geometryHash: "fixture",
  compatibility: {
    minCoreVersion: "0.1.0-alpha.1",
    notes: ["Fixture used by import tests."]
  }
};

describe("createTerritoryDatasetFromGeoJson", () => {
  it("imports Polygon and MultiPolygon features with holes and islands", () => {
    const dataset = loadTerritoryDatasetFromGeoJson(
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "hole-zone",
            properties: {
              level: 0,
              childIds: ["island-zone"]
            },
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [0, 0],
                  [10, 0],
                  [10, 10],
                  [0, 10],
                  [0, 0]
                ],
                [
                  [2, 2],
                  [2, 4],
                  [4, 4],
                  [4, 2],
                  [2, 2]
                ]
              ]
            }
          },
          {
            type: "Feature",
            id: "island-zone",
            properties: {
              level: 1,
              parentId: "hole-zone",
              neighborIds: []
            },
            geometry: {
              type: "MultiPolygon",
              coordinates: [
                [
                  [
                    [20, 20],
                    [22, 20],
                    [22, 22],
                    [20, 22],
                    [20, 20]
                  ]
                ],
                [
                  [
                    [24, 20],
                    [26, 20],
                    [26, 22],
                    [24, 22],
                    [24, 20]
                  ]
                ]
              ]
            }
          }
        ]
      },
      { manifest, sourcePath: "fixtures/islands.geojson" }
    );

    expect(dataset.zones).toHaveLength(2);
    expect(dataset.zones[0]?.geometry.type).toBe("Polygon");
    expect(dataset.zones[1]?.geometry.type).toBe("MultiPolygon");
  });

  it("returns feature-aware issues for duplicate feature ids", () => {
    const result = createTerritoryDatasetFromGeoJson(
      {
        type: "FeatureCollection",
        features: [squareFeature("same-id", 0, 0, 0, 1, 1), squareFeature("same-id", 0, 2, 2, 3, 3)]
      },
      { manifest, sourcePath: "fixtures/duplicate.geojson" }
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "DUPLICATE_FEATURE_ID",
        featureId: "same-id",
        sourcePath: "fixtures/duplicate.geojson",
        repairSuggestion: expect.any(String)
      })
    );
  });

  it("flags invalid rings and out-of-range coordinates with repair suggestions", () => {
    const result = createTerritoryDatasetFromGeoJson(
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "broken-ring",
            properties: { level: 0 },
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [0, 0],
                  [190, 0],
                  [1, 1]
                ]
              ]
            }
          }
        ]
      },
      { manifest, sourcePath: "fixtures/dirty.geojson" }
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "COORDINATE_RANGE",
        featureId: "broken-ring",
        repairSuggestion: expect.stringContaining("EPSG:4326")
      })
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "GEOMETRY_RING",
        zoneId: "broken-ring",
        sourcePath: "fixtures/dirty.geojson"
      })
    );
  });

  it("reports invalid hierarchy array properties during import", () => {
    const result = createTerritoryDatasetFromGeoJson(
      {
        type: "FeatureCollection",
        features: [
          {
            ...squareFeature("bad-neighbors", 0, 0, 0, 1, 1),
            properties: {
              level: 0,
              neighborIds: ["ok", ""]
            }
          }
        ]
      },
      { manifest, sourcePath: "fixtures/bad-neighbors.geojson" }
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "ZONE_FIELD",
        featureId: "bad-neighbors",
        path: "$.features[0].properties.neighborIds",
        repairSuggestion: expect.stringContaining("string ids")
      })
    );
  });
});

function squareFeature(
  id: string,
  level: number,
  west: number,
  south: number,
  east: number,
  north: number
): Record<string, unknown> {
  return {
    type: "Feature",
    id,
    properties: { level },
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
    }
  };
}
