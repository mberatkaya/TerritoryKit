import { describe, expect, it } from "vitest";
import {
  classifyTerritoryGeometryRelation,
  computeSharedBoundaryMeters,
  computeTerritoryAdjacencyContentHash,
  createTerritoryAdjacencyIndex,
  validateTerritoryAdjacencyArtifact
} from "../src/index.js";
import type {
  TerritoryAdjacencyArtifact,
  TerritoryAdjacencyEdge,
  TerritoryDataset,
  TerritoryGeometry,
  TerritoryZone
} from "../src/index.js";

describe("territory adjacency geometry", () => {
  it("classifies exact polygon relations without relying on bbox adjacency", () => {
    const shared = classifyTerritoryGeometryRelation(
      squareGeometry(0, 0, 1, 1),
      squareGeometry(1, 0, 2, 1)
    );
    const pointTouch = classifyTerritoryGeometryRelation(
      squareGeometry(0, 0, 1, 1),
      squareGeometry(1, 1, 2, 2)
    );
    const overlap = classifyTerritoryGeometryRelation(
      squareGeometry(0, 0, 1, 1),
      squareGeometry(0.5, 0.5, 1.5, 1.5)
    );

    expect(shared.relation).toBe("shared-border");
    expect(shared.sharedBoundaryMeters).toBeGreaterThan(100_000);
    expect(
      computeSharedBoundaryMeters(squareGeometry(0, 0, 1, 1), squareGeometry(1, 0, 2, 1))
    ).toBe(shared.sharedBoundaryMeters);
    expect(pointTouch).toMatchObject({ relation: "point-touch", sharedBoundaryMeters: 0 });
    expect(overlap.relation).toBe("overlap");
  });
});

describe("territory adjacency artifacts", () => {
  it("validates canonical edges and exposes a typed query index", () => {
    const dataset = adjacencyDataset();
    const artifact = adjacencyArtifact(dataset, [
      {
        from: "a",
        to: "b",
        type: "shared-border",
        source: "computed",
        sharedBoundaryMeters: 111_195.08,
        confidence: 1
      },
      {
        from: "a",
        to: "d",
        type: "logical",
        source: "manual",
        properties: { reason: "bridge tunnel override" }
      }
    ]);
    const validation = validateTerritoryAdjacencyArtifact(dataset, artifact);
    const index = createTerritoryAdjacencyIndex(artifact);

    expect(validation.ok).toBe(true);
    expect(index.getNeighbors("a")).toEqual(["b", "d"]);
    expect(index.getNeighbors("a", { types: ["shared-border"] })).toEqual(["b"]);
    expect(index.getNeighbors("a", { types: ["logical"] })).toEqual(["d"]);
    expect(index.areAdjacent("b", "a", { types: ["shared-border"] })).toBe(true);
    expect(index.getRelation("b", "a")[0]).toMatchObject({
      from: "a",
      to: "b",
      type: "shared-border"
    });

    const timestampChanged = { ...artifact, generatedAt: "2030-01-01T00:00:00.000Z" };
    expect(validateTerritoryAdjacencyArtifact(dataset, timestampChanged).ok).toBe(true);
  });

  it("reports invalid computed/manual relation payloads", () => {
    const dataset = adjacencyDataset();
    const artifact = adjacencyArtifact(dataset, [
      {
        from: "a",
        to: "missing",
        type: "maritime",
        source: "computed"
      }
    ]);
    const report = validateTerritoryAdjacencyArtifact(dataset, artifact);

    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNKNOWN_ZONE" }),
        expect.objectContaining({ code: "COMPUTED_MARITIME" })
      ])
    );
  });
});

function adjacencyDataset(): TerritoryDataset {
  return {
    manifest: {
      datasetId: "adjacency-test",
      datasetVersion: "0.1.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-07",
      geometryHash: "adjacency-test-hash"
    },
    zones: [
      squareZone("a", 0, 0, 0, 1, 1),
      squareZone("b", 0, 1, 0, 2, 1),
      squareZone("c", 0, 1, 1, 2, 2),
      squareZone("d", 0, 3, 0, 4, 1)
    ]
  };
}

function adjacencyArtifact(
  dataset: TerritoryDataset,
  edges: TerritoryAdjacencyEdge[]
): TerritoryAdjacencyArtifact {
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
      includePointTouches: true,
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
      candidatePairCount: 0,
      exactComparisonCount: 0,
      disjointPairCount: 0,
      sharedBorderCount: 0,
      pointTouchCount: 0,
      overlapRejectedCount: 0,
      ambiguousCount: 0,
      manualAddCount: 0,
      manualRemoveCount: 0,
      finalEdgeCount: edges.length,
      totalSharedBoundaryMeters: edges.reduce(
        (sum, edge) => sum + (edge.sharedBoundaryMeters ?? 0),
        0
      )
    },
    overrides: {
      addCount: 0,
      removeCount: 0
    },
    edges
  };

  return {
    ...artifactWithoutHash,
    contentHash: computeTerritoryAdjacencyContentHash(artifactWithoutHash)
  };
}

function squareZone(
  id: string,
  level: number,
  west: number,
  south: number,
  east: number,
  north: number
): TerritoryZone {
  return {
    id,
    datasetId: "adjacency-test",
    level,
    neighborIds: [],
    geometry: squareGeometry(west, south, east, north),
    center: [(west + east) / 2, (south + north) / 2],
    bbox: [west, south, east, north],
    properties: {}
  };
}

function squareGeometry(
  west: number,
  south: number,
  east: number,
  north: number
): TerritoryGeometry {
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
