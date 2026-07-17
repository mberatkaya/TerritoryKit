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

  it("preserves additive semantic zone metadata", () => {
    const dataset = validDataset();
    dataset.manifest = {
      ...dataset.manifest,
      adminLevels: ["ADM0", "ADM3", "ADM5"]
    };
    dataset.zones[1] = {
      ...dataset.zones[1]!,
      countryCode: "TR",
      sourceAdminLevel: "ADM1",
      semanticType: "province",
      name: "Istanbul",
      localName: "Istanbul",
      properties: {
        territory: {
          adminLevel: "ADM3",
          sourceAdminLevel: "ADM3",
          semanticType: "neighbourhood",
          localTypeName: "Mahalle",
          hierarchyDepth: 3,
          parentId: "root",
          sourceParentId: "TR-34-FATIH",
          semanticReviewStatus: "reviewed",
          coverageStatus: "partial"
        }
      }
    };

    const loadedDataset = loadTerritoryDataset(dataset);

    expect(loadedDataset.manifest.adminLevels).toEqual(["ADM0", "ADM3", "ADM5"]);
    expect(loadedDataset.zones[1]).toEqual(
      expect.objectContaining({
        countryCode: "TR",
        sourceAdminLevel: "ADM1",
        semanticType: "province",
        name: "Istanbul",
        localName: "Istanbul"
      })
    );
  });

  it("rejects invalid lower-admin territory metadata", () => {
    const dataset = validDataset();
    dataset.zones[1] = {
      ...dataset.zones[1]!,
      properties: {
        territory: {
          adminLevel: "ADM6",
          semanticType: "neighborhood",
          hierarchyDepth: 9,
          semanticReviewStatus: "done",
          coverageStatus: "complete"
        }
      }
    };

    const result = validateTerritoryDataset(dataset);

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "$.zones[1].properties.territory.adminLevel" }),
        expect.objectContaining({ path: "$.zones[1].properties.territory.semanticType" }),
        expect.objectContaining({ path: "$.zones[1].properties.territory.hierarchyDepth" }),
        expect.objectContaining({
          path: "$.zones[1].properties.territory.semanticReviewStatus"
        }),
        expect.objectContaining({ path: "$.zones[1].properties.territory.coverageStatus" })
      ])
    );
  });

  it("rejects unknown semantic zone metadata", () => {
    const dataset = validDataset();
    dataset.zones[1] = {
      ...dataset.zones[1]!,
      semanticType: "city-but-not-really" as never
    };

    const result = validateTerritoryDataset(dataset);

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "ZONE_FIELD",
        path: "$.zones[1].semanticType"
      })
    );
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
