import { validateTerritoryAdjacencyArtifact } from "@territory-kit/dataset";
import { describe, expect, it } from "vitest";
import { buildTerritoryAdjacency, serializeTerritoryAdjacencyArtifact } from "../src/index.js";
import type { TerritoryDataset, TerritoryGeometry, TerritoryZone } from "@territory-kit/dataset";

describe("buildTerritoryAdjacency", () => {
  it("builds deterministic shared-border and point-touch artifacts from polygon geometry", async () => {
    const dataset = adjacencyDataset();
    const first = await buildTerritoryAdjacency(dataset, {
      includePointTouches: true,
      batchSize: 1,
      buildDate: "2026-01-01T00:00:00.000Z"
    });
    const second = await buildTerritoryAdjacency(dataset, {
      includePointTouches: true,
      batchSize: 1,
      buildDate: "2026-01-01T00:00:00.000Z"
    });

    expect(first.issues).toEqual([]);
    expect(first.artifact.edges.map((edge) => `${edge.from}:${edge.to}:${edge.type}`)).toEqual([
      "a:b:shared-border",
      "a:c:point-touch",
      "b:c:shared-border"
    ]);
    expect(first.artifact.statistics).toMatchObject({
      zoneCount: 5,
      eligibleZoneCount: 5,
      candidatePairCount: 3,
      exactComparisonCount: 3,
      finalEdgeCount: 3
    });
    expect(validateTerritoryAdjacencyArtifact(dataset, first.artifact).ok).toBe(true);
    expect(serializeTerritoryAdjacencyArtifact(first.artifact)).toBe(
      serializeTerritoryAdjacencyArtifact(second.artifact)
    );
  });

  it("keeps point touches opt-in and applies manual overrides after computed edges", async () => {
    const dataset = adjacencyDataset();
    const result = await buildTerritoryAdjacency(dataset, {
      includePointTouches: false,
      buildDate: "2026-01-01T00:00:00.000Z",
      overrides: {
        remove: [{ a: "a", b: "b", reason: "fixture exercises manual removal" }],
        add: [
          {
            a: "a",
            b: "d",
            type: "maritime",
            reason: "short ferry route",
            sourceReference: "fixture://ferry"
          }
        ]
      }
    });

    expect(result.artifact.edges.map((edge) => `${edge.from}:${edge.to}:${edge.type}`)).toEqual([
      "a:d:maritime",
      "b:c:shared-border"
    ]);
    expect(result.artifact.edges[0]).toMatchObject({
      source: "manual",
      properties: {
        reason: "short ferry route",
        sourceReference: "fixture://ferry"
      }
    });
    expect(result.artifact.statistics).toMatchObject({
      pointTouchCount: 1,
      manualAddCount: 1,
      manualRemoveCount: 1,
      finalEdgeCount: 2
    });
    expect(validateTerritoryAdjacencyArtifact(dataset, result.artifact).ok).toBe(true);
  });
});

function adjacencyDataset(): TerritoryDataset {
  return {
    manifest: {
      datasetId: "adjacency-build-test",
      datasetVersion: "0.1.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-07",
      geometryHash: "adjacency-build-test-hash"
    },
    zones: [
      {
        ...squareZone("root", 0, 0, 0, 4, 2),
        childIds: ["a", "b", "c", "d"]
      },
      squareZone("a", 1, 0, 0, 1, 1, "root"),
      squareZone("b", 1, 1, 0, 2, 1, "root"),
      squareZone("c", 1, 1, 1, 2, 2, "root"),
      squareZone("d", 1, 3, 0, 4, 1, "root")
    ]
  };
}

function squareZone(
  id: string,
  level: number,
  west: number,
  south: number,
  east: number,
  north: number,
  parentId?: string
): TerritoryZone {
  return {
    id,
    datasetId: "adjacency-build-test",
    level,
    ...(parentId ? { parentId } : {}),
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
