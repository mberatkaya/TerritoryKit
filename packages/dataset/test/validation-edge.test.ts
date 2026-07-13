import { describe, expect, it } from "vitest";
import {
  TerritoryDatasetValidationError,
  assertValidTerritoryDataset,
  loadTerritoryDataset,
  validateTerritoryDataset
} from "../src/index.js";
import type { TerritoryDataset, TerritoryZone } from "../src/index.js";

describe("dataset validation edge cases", () => {
  it("throws typed validation errors with issue summaries", () => {
    const result = validateTerritoryDataset(null);

    expect(result.ok).toBe(false);
    expect(() => loadTerritoryDataset(null)).toThrow(TerritoryDatasetValidationError);
    expect(() => assertValidTerritoryDataset(null)).toThrow("DATASET_SHAPE at $");
  });

  it("reports invalid manifest, zone shape, field, graph, bbox, and geometry issues", () => {
    const result = validateTerritoryDataset({
      manifest: {
        datasetId: "edge",
        datasetVersion: "0.0.0",
        schemaVersion: "territory-schema@1",
        sourceDate: "test",
        geometryHash: "hash",
        compatibility: {
          minCoreVersion: "0.1.0",
          maxCoreVersion: "1.0.0",
          notes: ["test"]
        }
      },
      zones: [
        "not-a-zone",
        {
          ...square("bad-fields", 0),
          datasetId: "wrong",
          level: -1,
          parentId: 12,
          childIds: [123],
          neighborIds: [false],
          geometry: null,
          center: ["lng", "lat"],
          bbox: [1, 2, 0, 3],
          properties: null
        },
        {
          ...square("parent", 2),
          childIds: ["missing-child", "child"]
        },
        {
          ...square("child", 1),
          parentId: "parent",
          neighborIds: ["missing-neighbor"]
        },
        {
          ...square("mismatch-parent", 0),
          childIds: ["mismatch-child"]
        },
        {
          ...square("mismatch-child", 1),
          parentId: "other-parent"
        },
        {
          ...square("bad-multipolygon", 0),
          geometry: {
            type: "MultiPolygon",
            coordinates: "bad"
          }
        },
        {
          ...square("empty-polygon", 0),
          geometry: {
            type: "Polygon",
            coordinates: []
          }
        },
        {
          ...square("open-ring", 0),
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1]
              ]
            ]
          }
        },
        {
          ...square("unsupported-geometry", 0),
          geometry: {
            type: "Point",
            coordinates: [0, 0]
          }
        }
      ]
    });

    const codes = result.issues.map((issue) => issue.code);

    expect(result.ok).toBe(false);
    expect(codes).toEqual(
      expect.arrayContaining([
        "ZONE_FIELD",
        "DATASET_ID_MISMATCH",
        "GEOMETRY_TYPE",
        "CENTER_FIELD",
        "BBOX_FIELD",
        "PARENT_LEVEL",
        "CHILD_MISSING",
        "CHILD_PARENT_MISMATCH",
        "NEIGHBOR_MISSING",
        "GEOMETRY_COORDINATES",
        "GEOMETRY_RING"
      ])
    );
  });

  it("rejects unsupported schema versions and missing zone arrays", () => {
    const result = validateTerritoryDataset({
      manifest: {
        datasetId: "edge",
        datasetVersion: "0.0.0",
        schemaVersion: "territory-schema@2",
        sourceDate: "test",
        geometryHash: "hash"
      },
      zones: {}
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["MANIFEST_FIELD", "DATASET_SHAPE"])
    );
  });

  it("loads compatibility metadata when present", () => {
    const dataset = loadTerritoryDataset({
      ...validDataset(),
      manifest: {
        ...validDataset().manifest,
        compatibility: {
          minCoreVersion: "0.1.0",
          notes: ["compatible"]
        }
      }
    });

    expect(dataset.manifest.compatibility?.minCoreVersion).toBe("0.1.0");
    expect(dataset.manifest.compatibility?.notes).toEqual(["compatible"]);
  });
});

function validDataset(): TerritoryDataset {
  return {
    manifest: {
      datasetId: "edge",
      datasetVersion: "0.0.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "test",
      geometryHash: "hash"
    },
    zones: [square("root", 0)]
  };
}

function square(id: string, level: number): TerritoryZone {
  return {
    id,
    datasetId: "edge",
    level,
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
