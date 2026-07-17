import {
  createSampleTerritoryDataset,
  createSyntheticGridDataset,
  createTurkeyAdm3DemoDataset
} from "@territory-kit/shared-testkit";
import {
  computeTerritoryAdjacencyContentHash,
  validateTerritoryDataset
} from "@territory-kit/dataset";
import type { TerritoryAdjacencyArtifact, TerritoryDataset } from "@territory-kit/dataset";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createTerritoryEngine, TerritoryZoneNotFoundError } from "../src/index.js";

describe("createTerritoryEngine", () => {
  it("exposes O(1)-style id lookups and boundary helpers", () => {
    const engine = createTerritoryEngine({ dataset: createSampleTerritoryDataset() });

    expect(engine.getZoneById("tr:34")?.properties.name).toBe("Istanbul");
    expect(engine.getZoneLevel("tr:34")).toBe(2);
    expect(engine.zoneToCenter("tr:34:fatih")).toEqual([28.965, 41.025]);
    expect(engine.zoneToBoundary("tr:34:fatih").type).toBe("Polygon");
    expect(engine.isValidZone("missing")).toBe(false);
  });

  it("locates a coordinate by level", () => {
    const engine = createTerritoryEngine({ dataset: createSampleTerritoryDataset() });

    expect(engine.latLngToZone({ lat: 41.01, lng: 28.95 }, { level: 3 })).toBe("tr:34:fatih");
    expect(engine.latLngToZone({ lat: 39, lng: 35 }, { level: 1 })).toBe("tr");
    expect(engine.latLngToZone({ lat: 10, lng: 10 }, { level: 1 })).toBeNull();
    expect(engine.latLngToZone({ lat: Number.NaN, lng: 28.95 }, { level: 3 })).toBeNull();
    expect(engine.latLngToZone({ lat: 41.01, lng: 28.95 }, { level: -1 })).toBeNull();
  });

  it("loads the synthetic Turkey ADM3 neighbourhood demo without claiming broader coverage", () => {
    const dataset = createTurkeyAdm3DemoDataset();
    const engine = createTerritoryEngine({ dataset });

    expect(validateTerritoryDataset(dataset).ok).toBe(true);
    expect(engine.availableLevels).toEqual([0, 1, 2, 3]);
    expect(engine.zoneToChildren("tr:adm2:fatih")).toEqual([
      "tr:adm3:demo-neighbourhood-a",
      "tr:adm3:demo-neighbourhood-b",
      "tr:adm3:demo-neighbourhood-c"
    ]);
    expect(engine.zoneToParent("tr:adm3:demo-neighbourhood-a")).toBe("tr:adm2:fatih");
    expect(engine.zoneNeighbors("tr:adm3:demo-neighbourhood-b")).toEqual([
      "tr:adm3:demo-neighbourhood-a",
      "tr:adm3:demo-neighbourhood-c"
    ]);
    expect(engine.latLngToZone({ lat: 41.03, lng: 28.965 }, { level: 3 })).toBe(
      "tr:adm3:demo-neighbourhood-b"
    );
    expect(engine.getZoneById("tr:adm3:demo-neighbourhood-a")?.properties.territory).toMatchObject({
      semanticType: "neighbourhood",
      localTypeName: "Mahalle",
      coverageStatus: "partial"
    });
  });

  it("resolves synthetic grid center points to their generated zones", () => {
    const rows = 12;
    const columns = 14;
    const cellSize = 0.01;
    const dataset = createSyntheticGridDataset({ rows, columns, cellSize });
    const engine = createTerritoryEngine({ dataset });

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: rows - 1 }),
        fc.integer({ min: 0, max: columns - 1 }),
        (row, column) => {
          const lat = row * cellSize + cellSize / 2;
          const lng = column * cellSize + cellSize / 2;

          expect(engine.latLngToZone({ lat, lng }, { level: 0 })).toBe(`z:${row}:${column}`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("keeps indexed and brute-force grid lookups equivalent for random coordinates", () => {
    const rows = 10;
    const columns = 11;
    const cellSize = 0.05;
    const dataset = createSyntheticGridDataset({ rows, columns, cellSize });
    const indexedEngine = createTerritoryEngine({ dataset });
    const bruteForceEngine = createTerritoryEngine({
      dataset,
      debug: { bruteForceLookup: true }
    });

    fc.assert(
      fc.property(
        fc.double({ min: 0, max: rows * cellSize, noNaN: true }),
        fc.double({ min: 0, max: columns * cellSize, noNaN: true }),
        (lat, lng) => {
          expect(indexedEngine.latLngToZone({ lat, lng }, { level: 0 })).toBe(
            bruteForceEngine.latLngToZone({ lat, lng }, { level: 0 })
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it("matches random polygon rectangles to visible grid cells by center containment", () => {
    const rows = 8;
    const columns = 9;
    const cellSize = 0.1;
    const inset = cellSize / 10;
    const dataset = createSyntheticGridDataset({ rows, columns, cellSize });
    const engine = createTerritoryEngine({ dataset });

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: rows - 1 }),
        fc.integer({ min: 0, max: rows - 1 }),
        fc.integer({ min: 0, max: columns - 1 }),
        fc.integer({ min: 0, max: columns - 1 }),
        (firstRow, secondRow, firstColumn, secondColumn) => {
          const minRow = Math.min(firstRow, secondRow);
          const maxRow = Math.max(firstRow, secondRow);
          const minColumn = Math.min(firstColumn, secondColumn);
          const maxColumn = Math.max(firstColumn, secondColumn);
          const west = minColumn * cellSize + inset;
          const south = minRow * cellSize + inset;
          const east = (maxColumn + 1) * cellSize - inset;
          const north = (maxRow + 1) * cellSize - inset;
          const expectedIds = dataset.zones
            .filter((zone) => {
              const [lng, lat] = zone.center;

              return lng >= west && lng <= east && lat >= south && lat <= north;
            })
            .map((zone) => zone.id)
            .sort();

          const matchedIds = engine
            .polygonToZones(
              {
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
              { level: 0, mode: "contains-center" }
            )
            .map((zone) => zone.id)
            .sort();

          expect(matchedIds).toEqual(expectedIds);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("supports a debug brute-force spatial lookup path", () => {
    const engine = createTerritoryEngine({
      dataset: createSampleTerritoryDataset(),
      debug: { bruteForceLookup: true }
    });

    expect(engine.latLngToZone({ lat: 41.01, lng: 28.95 }, { level: 3 })).toBe("tr:34:fatih");
  });

  it("uses covers as the default boundary behavior", () => {
    const engine = createTerritoryEngine({ dataset: createSampleTerritoryDataset() });
    const pointOnBoundary = { lat: 41, lng: 28.95 };

    expect(engine.latLngToZone(pointOnBoundary, { level: 3 })).toBe("tr:34:fatih");
    expect(engine.latLngToZone(pointOnBoundary, { level: 3, boundaryMode: "contains" })).toBeNull();
  });

  it("returns hierarchy and adjacency data", () => {
    const engine = createTerritoryEngine({ dataset: createSampleTerritoryDataset() });

    expect(engine.zoneToParent("tr:34:fatih")).toBe("tr:34");
    expect(engine.zoneToChildren("tr:34")).toEqual(["tr:34:fatih", "tr:34:kadikoy"]);
    expect(engine.getAncestors("tr:34:fatih")).toEqual(["tr:34", "tr", "world:europe"]);
    expect(engine.getDescendants("tr")).toEqual(["tr:34", "tr:34:fatih", "tr:34:kadikoy"]);
    expect(engine.zoneNeighbors("tr:34:fatih")).toEqual(["tr:34:kadikoy"]);
  });

  it("supports typed logical adjacency connections", () => {
    const engine = createTerritoryEngine({
      dataset: createSampleTerritoryDataset(),
      adjacencyConnections: [
        {
          fromZoneId: "tr:34:fatih",
          toZoneId: "tr",
          type: "portal",
          properties: { label: "demo" }
        }
      ]
    });

    expect(engine.zoneNeighbors("tr:34:fatih")).toEqual(["tr", "tr:34:kadikoy"]);
    expect(engine.zoneNeighbors("tr:34:fatih", { connectionTypes: ["portal"] })).toEqual(["tr"]);
    expect(engine.getAdjacencyConnections("tr").map((connection) => connection.toZoneId)).toEqual([
      "tr:34:fatih"
    ]);
  });

  it("uses adjacency artifacts for typed neighbor queries", () => {
    const dataset = createSampleTerritoryDataset();
    const engine = createTerritoryEngine({
      dataset,
      adjacency: sampleAdjacencyArtifact(dataset)
    });

    expect(engine.zoneNeighbors("tr:34:fatih")).toEqual(["tr", "tr:34:kadikoy"]);
    expect(engine.zoneNeighbors("tr:34:fatih", { types: ["shared-border"] })).toEqual([
      "tr:34:kadikoy"
    ]);
    expect(engine.zoneNeighbors("tr:34:fatih", { types: ["logical"] })).toEqual(["tr"]);
    expect(engine.getAdjacencyRelations("tr:34:fatih", { types: ["shared-border"] })).toEqual([
      expect.objectContaining({
        from: "tr:34:fatih",
        to: "tr:34:kadikoy",
        type: "shared-border"
      })
    ]);
  });

  it("ignores logical adjacency connections that reference unknown zones", () => {
    const engine = createTerritoryEngine({
      dataset: createSampleTerritoryDataset(),
      adjacencyConnections: [
        {
          fromZoneId: "tr:34:fatih",
          toZoneId: "missing",
          type: "manual"
        }
      ]
    });

    expect(engine.zoneNeighbors("tr:34:fatih", { connectionTypes: ["manual"] })).toEqual([]);
  });

  it("filters viewport queries by bbox and zoom-selected level", () => {
    const engine = createTerritoryEngine({ dataset: createSampleTerritoryDataset() });

    expect(
      engine
        .getZonesInBounds({
          west: 28.94,
          south: 41,
          east: 29.02,
          north: 41.05,
          level: 3
        })
        .map((zone) => zone.id)
    ).toEqual(["tr:34:fatih", "tr:34:kadikoy"]);

    expect(
      engine
        .getZonesInBounds({
          west: 29.02,
          south: 41.05,
          east: 28.94,
          north: 41,
          level: 3
        })
        .map((zone) => zone.id)
    ).toEqual(["tr:34:fatih", "tr:34:kadikoy"]);

    expect(
      engine.getZonesInBounds({
        west: Number.NaN,
        south: 41,
        east: 29.02,
        north: 41.05,
        level: 3
      })
    ).toEqual([]);

    expect(
      engine
        .getVisibleZones({
          bounds: { west: 28, south: 40, east: 30, north: 42 },
          zoom: 10
        })
        .map((zone) => zone.id)
    ).toEqual(["tr:34:fatih", "tr:34:kadikoy"]);

    expect(
      engine.getViewportCacheKey({
        bounds: { west: 28, south: 40, east: 30, north: 42 },
        zoom: 10
      })
    ).toContain("territorykit-sample");
  });

  it("returns polygon query matches without generating grid cells", () => {
    const engine = createTerritoryEngine({ dataset: createSampleTerritoryDataset() });

    const zones = engine.polygonToZones(
      {
        type: "Polygon",
        coordinates: [
          [
            [28.94, 41],
            [29.02, 41],
            [29.02, 41.05],
            [28.94, 41.05],
            [28.94, 41]
          ]
        ]
      },
      { level: 3 }
    );

    expect(zones.map((zone) => zone.id)).toEqual(["tr:34:fatih", "tr:34:kadikoy"]);
  });

  it("returns transition payloads for zoom level changes", () => {
    const engine = createTerritoryEngine({ dataset: createSampleTerritoryDataset() });
    const transition = engine.getLevelTransition({
      bounds: { west: 28, south: 40, east: 30, north: 42 },
      fromZoom: 8,
      toZoom: 10
    });

    expect(transition.fromLevel).toBe(2);
    expect(transition.toLevel).toBe(3);
    expect(transition.exitingZoneIds).toEqual(["tr:34"]);
    expect(transition.enteringZoneIds).toEqual(["tr:34:fatih", "tr:34:kadikoy"]);
  });

  it("throws typed errors for invalid zone ids in programmer-error APIs", () => {
    const engine = createTerritoryEngine({ dataset: createSampleTerritoryDataset() });

    expect(() => engine.zoneToBoundary("missing")).toThrow(TerritoryZoneNotFoundError);
  });
});

function sampleAdjacencyArtifact(dataset: TerritoryDataset): TerritoryAdjacencyArtifact {
  const artifactWithoutHash: Omit<TerritoryAdjacencyArtifact, "contentHash"> = {
    artifactVersion: "1",
    dataset: {
      id: dataset.manifest.datasetId,
      version: dataset.manifest.datasetVersion,
      contentHash: dataset.manifest.geometryHash
    },
    generatedBy: {
      package: "@territory-kit/generators",
      version: "test"
    },
    generatedAt: "2026-01-01T00:00:00.000Z",
    measurement: {
      sharedBoundary: "geodesic-haversine",
      holeBoundaryPolicy: "outer-rings-only"
    },
    options: {
      sameParentOnly: true,
      sameAdminLevelOnly: true,
      includePointTouches: false,
      minimumSharedBoundaryMeters: 0,
      epsilon: 1e-9
    },
    tolerance: {
      coordinateEpsilon: 1e-9,
      collinearityEpsilon: 1e-9,
      lengthEpsilonMeters: 0.001
    },
    statistics: {
      zoneCount: dataset.zones.length,
      eligibleZoneCount: dataset.zones.length,
      skippedZoneCount: 0,
      candidatePairCount: 1,
      exactComparisonCount: 1,
      disjointPairCount: 0,
      sharedBorderCount: 1,
      pointTouchCount: 0,
      overlapRejectedCount: 0,
      ambiguousCount: 0,
      manualAddCount: 1,
      manualRemoveCount: 0,
      finalEdgeCount: 2,
      totalSharedBoundaryMeters: 6_500
    },
    overrides: {
      addCount: 1,
      removeCount: 0
    },
    edges: [
      {
        from: "tr:34:fatih",
        to: "tr:34:kadikoy",
        type: "shared-border",
        source: "computed",
        sharedBoundaryMeters: 6_500,
        confidence: 1
      },
      {
        from: "tr:34:fatih",
        to: "tr",
        type: "logical",
        source: "manual",
        properties: { reason: "metro connection" }
      }
    ]
  };

  return {
    ...artifactWithoutHash,
    contentHash: computeTerritoryAdjacencyContentHash(artifactWithoutHash)
  };
}
