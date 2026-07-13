import { createSampleTerritoryDataset } from "@territory-kit/shared-testkit";
import { describe, expect, it } from "vitest";
import {
  createDatasetGeometryHash,
  createSyntheticGridDataset,
  createWeightedVoronoiDataset,
  inferBBoxAdjacency,
  inferBBoxAdjacencyConnections
} from "../src/index.js";

describe("generators", () => {
  it("creates deterministic geometry hashes", () => {
    const dataset = createSampleTerritoryDataset();

    expect(createDatasetGeometryHash(dataset)).toHaveLength(64);
    expect(createDatasetGeometryHash(dataset)).toBe(createDatasetGeometryHash(dataset));
  });

  it("infers bbox adjacency for zones sharing an edge", () => {
    const dataset = createSampleTerritoryDataset();
    const adjacency = inferBBoxAdjacency(dataset.zones.filter((zone) => zone.level === 3));

    expect(adjacency["tr:34:fatih"]).toEqual(["tr:34:kadikoy"]);
    expect(inferBBoxAdjacencyConnections(dataset.zones.filter((zone) => zone.level === 3))).toEqual(
      [
        {
          fromZoneId: "tr:34:fatih",
          toZoneId: "tr:34:kadikoy",
          type: "geometric"
        }
      ]
    );
  });

  it("creates deterministic synthetic grid datasets", () => {
    const dataset = createSyntheticGridDataset({
      datasetId: "generated-grid",
      rows: 2,
      columns: 3
    });

    expect(dataset.zones).toHaveLength(6);
    expect(dataset.manifest.geometryHash).toBe(createDatasetGeometryHash(dataset));
  });

  it("creates a deterministic weighted Voronoi MVP dataset", () => {
    const dataset = createWeightedVoronoiDataset({
      datasetId: "voronoi-demo",
      bounds: { west: 0, south: 0, east: 10, north: 10 },
      seeds: [
        { id: "a", lng: 1, lat: 5, weight: 1 },
        { id: "b", lng: 9, lat: 5, weight: 3 }
      ]
    });

    expect(dataset.zones.map((zone) => zone.id)).toEqual(["a", "b"]);
    expect(dataset.zones[0]?.bbox).toEqual([0, 0, 2.5, 10]);
    expect(dataset.zones[1]?.bbox).toEqual([2.5, 0, 10, 10]);
  });
});
