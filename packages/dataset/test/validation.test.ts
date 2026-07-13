import { describe, expect, it } from "vitest";
import { loadTerritoryDataset, validateTerritoryDataset } from "../src/index.js";
import type { TerritoryDataset, TerritoryZone } from "../src/index.js";

function square(
  id: string,
  level: number,
  west: number,
  south: number,
  east: number,
  north: number
): TerritoryZone {
  return {
    id,
    datasetId: "test-dataset",
    level,
    neighborIds: [],
    geometry: {
      type: "Polygon" as const,
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
    properties: {}
  };
}

function validDataset(): TerritoryDataset {
  return {
    manifest: {
      datasetId: "test-dataset",
      datasetVersion: "0.1.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-07",
      geometryHash: "test"
    },
    zones: [
      {
        ...square("root", 0, 0, 0, 10, 10),
        childIds: ["child"]
      },
      {
        ...square("child", 1, 0, 0, 5, 5),
        parentId: "root"
      }
    ]
  };
}

describe("validateTerritoryDataset", () => {
  it("loads a valid dataset", () => {
    const dataset = loadTerritoryDataset(validDataset());

    expect(dataset.manifest.datasetId).toBe("test-dataset");
    expect(dataset.zones).toHaveLength(2);
  });

  it("rejects duplicate ids", () => {
    const dataset = validDataset();
    dataset.zones[1] = { ...dataset.zones[1]!, id: "root" };

    const result = validateTerritoryDataset(dataset);

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === "DUPLICATE_ZONE_ID")).toBe(true);
  });

  it("rejects missing parents", () => {
    const dataset = validDataset();
    dataset.zones[1] = { ...dataset.zones[1]!, parentId: "missing" };

    const result = validateTerritoryDataset(dataset);

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === "PARENT_MISSING")).toBe(true);
  });

  it("rejects hierarchy cycles", () => {
    const dataset = validDataset();
    dataset.zones[0] = { ...dataset.zones[0]!, level: 2, parentId: "child" };
    dataset.zones[1] = { ...dataset.zones[1]!, childIds: ["root"] };

    const result = validateTerritoryDataset(dataset);

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === "HIERARCHY_CYCLE")).toBe(true);
  });

  it("rejects self-intersecting rings", () => {
    const dataset = validDataset();
    dataset.zones[0] = {
      ...dataset.zones[0]!,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [10, 10],
            [10, 0],
            [0, 10],
            [0, 0]
          ]
        ]
      }
    };

    const result = validateTerritoryDataset(dataset);

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === "SELF_INTERSECTION")).toBe(true);
  });

  it("rejects stale geometry metadata", () => {
    const dataset = validDataset();
    dataset.zones[1] = {
      ...dataset.zones[1]!,
      bbox: [0, 0, 10, 10],
      center: [20, 20]
    };

    const result = validateTerritoryDataset(dataset);

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "BBOX_MISMATCH",
        zoneId: "child",
        repairSuggestion: expect.stringContaining("Recompute bbox")
      })
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "CENTER_OUT_OF_BOUNDS",
        zoneId: "child"
      })
    );
  });

  it("warns about non-reciprocal neighbor links without rejecting the dataset", () => {
    const dataset = validDataset();
    dataset.zones[0] = {
      ...dataset.zones[0]!,
      neighborIds: ["child"]
    };

    const result = validateTerritoryDataset(dataset);

    expect(result.ok).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "NEIGHBOR_NOT_RECIPROCAL",
        severity: "warning",
        zoneId: "root"
      })
    );
  });
});
