import { describe, expect, it } from "vitest";
import { createTurkeyV2DeliveryManifest } from "../src/turkey-v2-delivery.js";

const input = {
  canonical: {
    datasetId: "tr",
    datasetVersion: "2.1.0-rc.7",
    buildDate: "2026-09-27",
    geometryHash: "geometry",
    sourceLockHash: "lock"
  },
  sourceLock: { generated: { algorithmVersion: "smart-v1" }, contentHash: "lock" },
  render: {
    datasetVersion: "2.1.0-rc.7",
    tileTemplate: "tiles/{z}/{x}/{y}.mvt",
    layers: [{ minZoom: 10, maxZoom: 12 }]
  },
  checksums: {
    files: Object.fromEntries(
      [
        "levels/ADM3/dataset.json",
        "levels/ADM3/full.geojson",
        "levels/ADM3/adjacency/adjacency.json",
        "query/query-artifact.json",
        "attribution.json",
        "migration-plan.json",
        "render/tiles/10/1/2.mvt"
      ].map((path) => [path, { sha256: path, byteSize: 10 }])
    )
  },
  shards: {
    datasetVersion: "2.1.0-rc.7",
    sourceLockHash: "lock",
    files: { "districts/example/dataset.json": { sha256: "shard", sizeBytes: 20 } }
  }
};

describe("Turkey V2 delivery manifest", () => {
  it("indexes existing artifacts deterministically", () => {
    const first = createTurkeyV2DeliveryManifest(input);
    expect(first).toMatchObject({
      datasetVersion: "2.1.0-rc.7",
      canonicalGeometryHash: "geometry",
      mvt: { tileCount: 1, minZoom: 10, maxZoom: 12 },
      shards: { "districts/example/dataset.json": { sha256: "shard" } }
    });
    expect(createTurkeyV2DeliveryManifest(input)).toEqual(first);
  });

  it("refuses mixed source locks", () => {
    expect(() =>
      createTurkeyV2DeliveryManifest({
        ...input,
        shards: { ...input.shards, sourceLockHash: "other" }
      })
    ).toThrow("mismatched");
  });
});
