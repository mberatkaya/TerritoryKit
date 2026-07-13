import type { TerritoryGeometry } from "@territory-kit/dataset";
import { describe, expect, it } from "vitest";
import {
  bboxIntersectsBounds,
  boundsIntersectBounds,
  geometryIntersectsGeometry,
  pointIntersectsGeometry
} from "../src/geometry.js";
import { bboxToBounds } from "../src/types.js";
import { defaultZoomLevelStrategy, zoomToDefaultLevel } from "../src/zoom.js";

const square: TerritoryGeometry = {
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
      [4, 2],
      [4, 4],
      [2, 4],
      [2, 2]
    ]
  ]
};

describe("core geometry helpers", () => {
  it("handles holes, boundaries, and bbox intersections", () => {
    expect(pointIntersectsGeometry([1, 1], square, "covers")).toBe(true);
    expect(pointIntersectsGeometry([3, 3], square, "covers")).toBe(false);
    expect(pointIntersectsGeometry([0, 5], square, "covers")).toBe(true);
    expect(pointIntersectsGeometry([0, 5], square, "contains")).toBe(false);
    expect(bboxIntersectsBounds([0, 0, 1, 1], { west: 1, south: 1, east: 2, north: 2 })).toBe(true);
    expect(
      boundsIntersectBounds(
        { west: 0, south: 0, east: 1, north: 1 },
        { west: 2, south: 2, east: 3, north: 3 }
      )
    ).toBe(false);
    expect(bboxToBounds([1, 2, 3, 4])).toEqual({ west: 1, south: 2, east: 3, north: 4 });
  });

  it("detects geometry intersections by bbox, vertices, and crossing segments", () => {
    const disjoint: TerritoryGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [20, 20],
          [21, 20],
          [21, 21],
          [20, 21],
          [20, 20]
        ]
      ]
    };
    const crossingHorizontal: TerritoryGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [2, 0],
          [2, 0.2],
          [0, 0.2],
          [0, 0]
        ]
      ]
    };
    const crossingVertical: TerritoryGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [1, -1],
          [1.2, -1],
          [1.2, 1],
          [1, 1],
          [1, -1]
        ]
      ]
    };

    expect(geometryIntersectsGeometry(square, disjoint, "covers")).toBe(false);
    expect(geometryIntersectsGeometry(square, crossingHorizontal, "covers")).toBe(true);
    expect(geometryIntersectsGeometry(crossingHorizontal, crossingVertical, "covers")).toBe(true);
  });
});

describe("zoom helpers", () => {
  it("maps zooms to levels and falls back to available levels deterministically", () => {
    expect([1, 4, 7, 10, 13, 16].map(zoomToDefaultLevel)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(
      defaultZoomLevelStrategy.resolveLevel({
        zoom: 9,
        availableLevels: [],
        dataset: sampleDataset()
      })
    ).toBe(3);
    expect(
      defaultZoomLevelStrategy.resolveLevel({
        zoom: 16,
        availableLevels: [0, 2, 4],
        dataset: sampleDataset()
      })
    ).toBe(4);
    expect(
      defaultZoomLevelStrategy.resolveLevel({
        zoom: 1,
        availableLevels: [2, 4],
        dataset: sampleDataset()
      })
    ).toBe(2);
  });
});

function sampleDataset() {
  return {
    manifest: {
      datasetId: "zoom-test",
      datasetVersion: "0.0.0",
      schemaVersion: "territory-schema@1" as const,
      sourceDate: "test",
      geometryHash: "test"
    },
    zones: []
  };
}
