import { describe, expect, it } from "vitest";
import {
  hashTerritoryGeometry,
  repairGeometryDataset,
  validateGeometryDataset
} from "../src/index.js";
import type { TerritoryDataset, TerritoryGeometry, TerritoryZone } from "../src/index.js";

describe("validateGeometryDataset", () => {
  it("validates a simple hierarchy with full geometry checks", () => {
    const result = validateGeometryDataset(validDataset(), { checks: "full" });

    expect(result.ok).toBe(true);
    expect(result.summary).toMatchObject({
      zoneCount: 3,
      errorCount: 0,
      backend: "typescript"
    });
    expect(result.summary.performance.candidatePairCount).toBeGreaterThan(0);
  });

  it("reports self-intersections and sibling overlaps without repairing input", () => {
    const dataset = validDataset();
    dataset.zones[1] = {
      ...dataset.zones[1]!,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [4, 4],
            [4, 0],
            [0, 4],
            [0, 0]
          ]
        ]
      }
    };
    dataset.zones[2] = square("right", 1, 2, 0, 6, 4, { parentId: "root" });
    const hashBeforeValidation = hashTerritoryGeometry(dataset.zones[1]!.geometry);

    const result = validateGeometryDataset(dataset, { checks: "full" });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SELF_INTERSECTION", zoneId: "left" }),
        expect.objectContaining({ code: "SIBLING_GEOMETRY_OVERLAP", zoneId: "left" })
      ])
    );
    expect(hashTerritoryGeometry(dataset.zones[1]!.geometry)).toBe(hashBeforeValidation);
  });

  it("does not flag the closing segment as intersecting the first segment after bbox sorting", () => {
    const dataset = validDataset();
    dataset.zones[1] = {
      ...dataset.zones[1]!,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [4, 0],
            [4, 4],
            [0, 4],
            [0, 0],
            [4, 0]
          ]
        ]
      }
    };

    const result = validateGeometryDataset(dataset, {
      checks: { coordinates: true, rings: true, selfIntersections: true }
    });

    expect(result.ok).toBe(true);
  });
});

describe("repairGeometryDataset", () => {
  it("applies only safe audited repairs and revalidates the repaired dataset", () => {
    const dataset = validDataset();
    dataset.zones[1] = {
      ...dataset.zones[1]!,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [4, 0],
            [4, 0],
            [4, 4],
            [0, 4]
          ]
        ]
      },
      bbox: [99, 99, 100, 100],
      center: [99, 99]
    };

    const validation = validateGeometryDataset(dataset, { checks: "basic" });
    expect(validation.ok).toBe(false);

    const result = repairGeometryDataset(dataset, { checks: "basic" });

    expect(result.ok).toBe(true);
    expect(result.repairs).toHaveLength(1);
    expect(result.repairs[0]).toMatchObject({
      zoneId: "left",
      accepted: true
    });
    expect(result.repairs[0]!.operations.map((operation) => operation.type)).toEqual([
      "remove-consecutive-duplicate-coordinate",
      "close-ring",
      "recompute-bbox",
      "recompute-center"
    ]);
    expect(result.revalidation.ok).toBe(true);
    expect(result.dataset.zones[1]!.geometry.coordinates[0]).toEqual([
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [0, 0]
    ]);
  });
});

function validDataset(): TerritoryDataset {
  return {
    manifest: {
      datasetId: "quality-test",
      datasetVersion: "0.1.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-07",
      geometryHash: "quality-test"
    },
    zones: [
      {
        ...square("root", 0, 0, 0, 10, 10),
        childIds: ["left", "right"]
      },
      square("left", 1, 0, 0, 4, 4, { parentId: "root" }),
      square("right", 1, 6, 0, 10, 4, { parentId: "root" })
    ]
  };
}

function square(
  id: string,
  level: number,
  west: number,
  south: number,
  east: number,
  north: number,
  options: { parentId?: string } = {}
): TerritoryZone {
  const geometry: TerritoryGeometry = {
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
  };

  return {
    id,
    datasetId: "quality-test",
    level,
    ...(options.parentId ? { parentId: options.parentId } : {}),
    neighborIds: [],
    geometry,
    center: [(west + east) / 2, (south + north) / 2],
    bbox: [west, south, east, north],
    properties: {}
  };
}
