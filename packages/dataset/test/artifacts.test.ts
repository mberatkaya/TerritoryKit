import { describe, expect, it } from "vitest";
import {
  createTerritoryQueryArtifact,
  createTerritoryRenderArtifactManifest,
  createTerritoryRenderFeatureCollection,
  validateTerritoryQueryRenderCompatibility
} from "../src/artifacts.js";
import type { TerritoryDataset, TerritoryZone } from "../src/types.js";

describe("query and render artifacts", () => {
  it("keeps territory identity stable between query and render artifacts", () => {
    const dataset = createArtifactDataset();
    const query = createTerritoryQueryArtifact(dataset, { datasetContentHash: "hash-1" });
    const features = createTerritoryRenderFeatureCollection(dataset);
    const manifest = createTerritoryRenderArtifactManifest({
      dataset,
      datasetContentHash: "hash-1",
      format: "mvt",
      generatedAt: "2026-01-01T00:00:00.000Z",
      tileTemplate: "tiles/{z}/{x}/{y}.mvt"
    });

    expect(features.features[0]?.properties.territoryId).toBe("world:europe");
    expect(manifest.tileTemplate).toBe("tiles/{z}/{x}/{y}.mvt");
    expect(validateTerritoryQueryRenderCompatibility(query, { manifest, features })).toMatchObject({
      ok: true,
      issues: []
    });
    expect(
      validateTerritoryQueryRenderCompatibility(query, {
        manifest: { ...manifest, datasetContentHash: "other" },
        features
      }).issues
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "DATASET_CONTENT_HASH_MISMATCH" })])
    );
  });
});

function createArtifactDataset(): TerritoryDataset {
  return {
    manifest: {
      datasetId: "artifact-test",
      datasetVersion: "1.0.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-01",
      geometryHash: "hash"
    },
    zones: [square("world:europe", 0, 0, 0, 1, 1)]
  };
}

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
    datasetId: "artifact-test",
    level,
    neighborIds: [],
    geometry: {
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
    center: [(west + east) / 2, (south + north) / 2],
    bbox: [west, south, east, north],
    properties: { name: id }
  };
}
