import { describe, expect, it } from "vitest";
import { createSquareZone } from "@territory-kit/shared-testkit";
import type { TerritoryDataset, TerritoryGeometry, TerritoryZone } from "@territory-kit/dataset";
import {
  createTerritoryEngine,
  createTerritoryGeometryVersion,
  createTerritoryIdentity
} from "../src/index.js";

describe("H3 removal readiness identity regressions", () => {
  it("keeps geometry versions stable across non-semantic ring changes", () => {
    const square: TerritoryGeometry = rectangle(0, 0, 1, 1);
    const rotated: TerritoryGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [1, 1],
          [0, 1],
          [0, 0],
          [1, 0],
          [1, 1]
        ]
      ]
    };
    const reversedWithDifferentStart: TerritoryGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
          [0, 1]
        ]
      ]
    };

    expect(createTerritoryGeometryVersion(rotated)).toBe(createTerritoryGeometryVersion(square));
    expect(createTerritoryGeometryVersion(reversedWithDifferentStart)).toBe(
      createTerritoryGeometryVersion(square)
    );
  });

  it("changes geometryVersion for real geometry changes while keeping territoryId stable", () => {
    const dataset = createVersionDataset(rectangle(0, 0, 1, 1));
    const changed = createVersionDataset(rectangle(0, 0, 2, 1));
    const identity = createTerritoryIdentity(dataset, dataset.zones[0]!);
    const changedIdentity = createTerritoryIdentity(changed, changed.zones[0]!);

    expect(changedIdentity.territoryId).toBe(identity.territoryId);
    expect(changedIdentity.geometryVersion).not.toBe(identity.geometryVersion);
  });

  it("returns deterministic Node runtime results for point, bounds, hierarchy, and adjacency", () => {
    const dataset = createVersionDataset(rectangle(0, 0, 1, 1));
    const engine = createTerritoryEngine({ dataset });

    expect(engine.latLngToZone({ lat: 0.5, lng: 0.5 }, { level: 3 })).toBe("stable:child");
    expect(
      engine.getZonesInBounds({ west: 0, south: 0, east: 1, north: 1, level: 3 })
    ).toHaveLength(1);
    expect(engine.getHierarchy("stable:child")?.ancestorIds).toEqual(["stable:root"]);
    expect(engine.getAdjacentTerritories("stable:child")).toEqual([]);
  });
});

function createVersionDataset(geometry: TerritoryGeometry): TerritoryDataset {
  const child: TerritoryZone = {
    ...createSquareZone({
      id: "stable:child",
      datasetId: "stable-regression",
      level: 3,
      west: 0,
      south: 0,
      east: 1,
      north: 1,
      parentId: "stable:root",
      properties: {
        territory: {
          stableId: "source-native-stable-child",
          sourceClass: "official",
          sourceProvider: "fixture",
          sourceNativeId: "stable-child"
        }
      }
    }),
    geometry
  };
  const root = createSquareZone({
    id: "stable:root",
    datasetId: "stable-regression",
    level: 2,
    west: 0,
    south: 0,
    east: 2,
    north: 2,
    childIds: ["stable:child"]
  });

  return {
    manifest: {
      datasetId: "stable-regression",
      datasetVersion: "2.0.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-08-24",
      geometryHash: "stable-regression-v1",
      adminLevels: ["ADM2", "ADM3"],
      license: "Apache-2.0"
    },
    zones: [child, root]
  };
}

function rectangle(west: number, south: number, east: number, north: number): TerritoryGeometry {
  return {
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
}
