import { describe, expect, it } from "vitest";
import type { TerritoryDataset } from "@territory-kit/dataset";
import {
  createTurkeyV2ArtifactCacheKey,
  getTurkeyV2Attribution,
  getTurkeyV2Neighbors,
  resolveTurkeyV2Boundaries
} from "../src/turkey-v2-delivery.js";

const path = "districts/tr_adm2_test/dataset.json";
const dataset = {
  manifest: { datasetVersion: "2.1.0-rc.7" },
  zones: [
    {
      id: "official",
      level: 3,
      parentId: "tr:adm2:test",
      properties: {
        territory: {
          boundaryKind: "administrative",
          boundarySourceClass: "official",
          administrative: true,
          authoritative: true,
          sourceVersion: "local-v1",
          license: "open",
          attribution: "City",
          geometryHash: "full-a"
        }
      }
    },
    {
      id: "smart",
      level: 3,
      parentId: "tr:adm2:test",
      properties: {
        territory: {
          boundaryKind: "estimated",
          boundarySourceClass: "smart-derived",
          administrative: false,
          authoritative: false,
          confidence: "low",
          sourceVersion: "osm-v1"
        }
      }
    }
  ]
} as unknown as TerritoryDataset;
const bytes = new TextEncoder().encode(JSON.stringify(dataset));
const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes.slice().buffer);
const checksum = Array.from(new Uint8Array(digest), (byte) =>
  byte.toString(16).padStart(2, "0")
).join("");
const manifest = {
  datasetVersion: "2.1.0-rc.7",
  canonicalGeometryHash: "geometry-a",
  contentHash: "manifest-a",
  shards: { [path]: { sha256: checksum, byteSize: bytes.byteLength } },
  artifacts: {}
};

describe("Turkey V2 scoped delivery", () => {
  it("defaults to official boundaries and discloses estimated results when enabled", async () => {
    const loadShard = async () => bytes;
    const official = await resolveTurkeyV2Boundaries({
      manifest,
      adm2Id: "tr:adm2:test",
      loadShard
    });
    expect(official.features.map((zone) => zone.id)).toEqual(["official"]);
    expect(official.metadata[0]).toMatchObject({
      administrative: true,
      sourceClass: "official",
      sourceVersion: "local-v1",
      geometryHash: "full-a"
    });
    const all = await resolveTurkeyV2Boundaries({
      manifest,
      adm2Id: "tr:adm2:test",
      allowEstimated: true,
      loadShard
    });
    expect(all.sourceComposition).toEqual({ official: 1, "smart-derived": 1 });
    expect(all.metadata[1]).toMatchObject({
      boundaryKind: "estimated",
      confidence: "low",
      administrative: false
    });
  });

  it("rejects stale shards and changes cache identity with checksum", async () => {
    await expect(
      resolveTurkeyV2Boundaries({
        manifest,
        adm2Id: "tr:adm2:test",
        loadShard: async () => new TextEncoder().encode("wrong")
      })
    ).rejects.toThrow("checksum mismatch");
    const changed = { ...manifest, shards: { [path]: { sha256: "shard-b", byteSize: 10 } } };
    expect(createTurkeyV2ArtifactCacheKey(manifest, path)).not.toBe(
      createTurkeyV2ArtifactCacheKey(changed, path)
    );
  });

  it("accepts a mobile checksum adapter when Web Crypto is unavailable", async () => {
    const result = await resolveTurkeyV2Boundaries({
      manifest,
      adm2Id: "tr:adm2:test",
      loadShard: async () => bytes,
      sha256: async () => checksum
    });
    expect(result.features.map((zone) => zone.id)).toEqual(["official"]);
  });

  it("selects source attribution and canonical adjacency", () => {
    expect(
      getTurkeyV2Attribution(
        { groups: [{ zoneIds: ["smart"], attribution: "OSM", license: "ODbL" }] },
        ["smart"]
      )
    ).toEqual([{ attribution: "OSM", license: "ODbL" }]);
    expect(getTurkeyV2Neighbors({ edges: [{ from: "official", to: "smart" }] }, "smart")).toEqual([
      "official"
    ]);
  });
});
