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

    expect(features.features[0]?.properties).toMatchObject({
      territoryId: "world:europe",
      parentId: "world",
      sourceAdminLevel: "ADM1",
      semanticType: "region",
      localName: "Europe",
      sourceProvider: "fixture",
      sourceAttribution: "fixture attribution"
    });
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

  it("carries estimated source and confidence evidence into render features", () => {
    const dataset = createArtifactDataset();
    const zone = dataset.zones[0]!;
    zone.properties.territory = {
      ...(zone.properties.territory as Record<string, unknown>),
      sourceClass: "generated",
      sourceVersion: "snapshot-v1",
      boundaryKind: "estimated",
      boundarySourceClass: "smart-derived",
      administrative: false,
      authoritative: false,
      confidence: "low",
      algorithmVersion: "smart-derived-v1.7",
      sourceSnapshotChecksum: "sha256:source",
      geometryHash: "sha256:geometry"
    };
    expect(createTerritoryRenderFeatureCollection(dataset).features[0]?.properties).toMatchObject({
      sourceClass: "generated",
      boundarySourceClass: "smart-derived",
      sourceVersion: "snapshot-v1",
      administrative: false,
      authoritative: false,
      boundaryKind: "estimated",
      confidence: "low",
      generatorVersion: "smart-derived-v1.7",
      sourceSnapshotChecksum: "sha256:source",
      geometryHash: "sha256:geometry"
    });
  });

  it("keeps an explicit administrative boundary kind and ADM3 parent identity", () => {
    const dataset = createArtifactDataset();
    const zone = dataset.zones[0]!;
    zone.level = 3;
    delete zone.parentId;
    zone.properties.territory = {
      parentId: "world",
      sourceClass: "official",
      boundaryKind: "administrative",
      sourceVersion: "official-2026",
      administrative: true,
      authoritative: true
    };
    expect(createTerritoryRenderFeatureCollection(dataset).features[0]?.properties).toMatchObject({
      territoryId: "world:europe",
      parentAdm2Id: "world",
      boundaryKind: "administrative",
      sourceVersion: "official-2026",
      administrative: true
    });
  });
});

function createArtifactDataset(): TerritoryDataset {
  return {
    manifest: {
      datasetId: "artifact-test",
      datasetVersion: "1.0.0",
      schemaVersion: "territory-schema@1",
      sourceDate: "2026-01",
      geometryHash: "hash",
      sourceProvider: "fixture",
      attribution: "fixture attribution",
      license: "Apache-2.0"
    },
    zones: [square("world:europe", 1, 0, 0, 1, 1)]
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
    parentId: "world",
    level,
    sourceAdminLevel: "ADM1",
    semanticType: "region",
    localName: "Europe",
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
    properties: {
      name: id,
      territory: {
        adminLevel: "ADM1",
        source: {
          provider: "fixture",
          attribution: "fixture attribution"
        }
      }
    }
  };
}
