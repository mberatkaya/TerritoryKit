import { describe, expect, it } from "vitest";
import type { TerritoryDataset } from "@territory-kit/dataset";
import {
  createTurkeyV2ArtifactCacheKey,
  getTurkeyV2Attribution,
  getTurkeyV2Neighbors,
  resolveTurkeyV2Boundaries,
  validateTurkeyV2DeliveryManifest
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
          boundarySourceClass: "official-local",
          sourceClass: "official",
          confidence: "authoritative",
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
          sourceClass: "generated",
          administrative: false,
          authoritative: false,
          confidence: "low",
          sourceVersion: "osm-v1"
        }
      }
    },
    {
      id: "tr:adm2:test",
      level: 2,
      properties: { territory: {} }
    }
  ]
} as unknown as TerritoryDataset;
const bytes = new TextEncoder().encode(JSON.stringify(dataset));
const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes.slice().buffer);
const checksum = Array.from(new Uint8Array(digest), (byte) =>
  byte.toString(16).padStart(2, "0")
).join("");
async function seal<T extends { contentHash: string }>(value: T): Promise<T> {
  const body = { ...value } as Record<string, unknown>;
  delete body.contentHash;
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(body))
  );
  return {
    ...value,
    contentHash: Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("")
  };
}
const manifest = await seal({
  schemaVersion: "territorykit-tr-v2-delivery@1" as const,
  datasetId: "territory-kit-tr",
  datasetVersion: "2.1.0-rc.7",
  canonicalGeometryHash: "a".repeat(64),
  sourceLockHash: `sha256:${"b".repeat(64)}`,
  mvt: {
    tileTemplate: "render/tiles/{z}/{x}/{y}.mvt",
    minZoom: 10,
    maxZoom: 12,
    extent: 4096,
    buffer: 64,
    tolerance: 3,
    tileCount: 1,
    checksumIndexHash: "c".repeat(64)
  },
  contentHash: "",
  shards: { [path]: { sha256: checksum, byteSize: bytes.byteLength } },
  artifacts: {},
  adm2Shards: { "tr:adm2:test": path }
});

describe("Turkey V2 scoped delivery", () => {
  it("requires explicit opt-in for estimated boundaries", async () => {
    const loadShard = async () => bytes;
    const official = await resolveTurkeyV2Boundaries({
      manifest,
      adm2Id: "tr:adm2:test",
      loadShard
    });
    expect(official.features.map((zone) => zone.id)).toEqual(["official"]);
    expect(official.metadata[0]).toMatchObject({
      administrative: true,
      sourceClass: "official-local",
      sourceVersion: "local-v1",
      geometryHash: "full-a"
    });
    const all = await resolveTurkeyV2Boundaries({
      manifest,
      adm2Id: "tr:adm2:test",
      allowEstimated: true,
      loadShard
    });
    expect(all.sourceComposition).toEqual({ "official-local": 1, "smart-derived": 1 });
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
    ).rejects.toThrow("byteSize mismatch");
    const changed = { ...manifest, shards: { [path]: { sha256: "b".repeat(64), byteSize: 10 } } };
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
  it("rejects semantic contradictions before returning estimated features", async () => {
    const invalid = structuredClone(dataset);
    const smart = invalid.zones[1]!;
    (smart.properties.territory as Record<string, unknown>).administrative = true;
    const invalidBytes = new TextEncoder().encode(JSON.stringify(invalid));
    const hash = await globalThis.crypto.subtle.digest("SHA-256", invalidBytes);
    const sha256 = Array.from(new Uint8Array(hash), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    await expect(
      resolveTurkeyV2Boundaries({
        manifest: await seal({
          ...manifest,
          shards: { [path]: { sha256, byteSize: invalidBytes.byteLength } }
        }),
        adm2Id: "tr:adm2:test",
        allowEstimated: true,
        loadShard: async () => invalidBytes
      })
    ).rejects.toThrow("Contradictory boundary semantics");
  });

  it("rejects wrong parent and unsafe or colliding shard paths", async () => {
    const invalid = structuredClone(dataset);
    invalid.zones[0]!.parentId = "tr:adm2:other";
    const invalidBytes = new TextEncoder().encode(JSON.stringify(invalid));
    const hash = await globalThis.crypto.subtle.digest("SHA-256", invalidBytes);
    const sha256 = Array.from(new Uint8Array(hash), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    await expect(
      resolveTurkeyV2Boundaries({
        manifest: await seal({
          ...manifest,
          shards: { [path]: { sha256, byteSize: invalidBytes.byteLength } }
        }),
        adm2Id: "tr:adm2:test",
        loadShard: async () => invalidBytes
      })
    ).rejects.toThrow("parent mismatch");
    await expect(
      validateTurkeyV2DeliveryManifest({
        ...manifest,
        shards: { "districts/%252e%252e/dataset.json": { sha256: checksum, byteSize: 1 } }
      })
    ).rejects.toThrow("Unsafe artifact path");
    await expect(
      validateTurkeyV2DeliveryManifest({ ...manifest, adm2Shards: { a: path, b: path } })
    ).rejects.toThrow("colliding");
  });

  it("recomputes full manifest self-hash and checks optional pin", async () => {
    const full = manifest;
    await expect(validateTurkeyV2DeliveryManifest(full, full.contentHash)).resolves.toBeUndefined();
    await expect(
      validateTurkeyV2DeliveryManifest({ ...full, datasetVersion: "tampered" })
    ).rejects.toThrow("contentHash mismatch");
    await expect(validateTurkeyV2DeliveryManifest(full, "c".repeat(64))).rejects.toThrow("Pinned");
  });
  it.each(["high", "medium", "low"])(
    "returns Smart %s metadata without administrative semantics",
    async (confidence) => {
      const candidate = structuredClone(dataset);
      (candidate.zones[1]!.properties.territory as Record<string, unknown>).confidence = confidence;
      const candidateBytes = new TextEncoder().encode(JSON.stringify(candidate));
      const digest = await globalThis.crypto.subtle.digest("SHA-256", candidateBytes);
      const sha256 = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("");
      const result = await resolveTurkeyV2Boundaries({
        manifest: await seal({
          ...manifest,
          shards: { [path]: { sha256, byteSize: candidateBytes.byteLength } }
        }),
        adm2Id: "tr:adm2:test",
        allowEstimated: true,
        loadShard: async () => candidateBytes
      });
      expect(result.metadata[1]).toMatchObject({
        boundaryKind: "estimated",
        sourceClass: "smart-derived",
        confidence,
        administrative: false,
        authoritative: false,
        datasetVersion: "2.1.0-rc.7",
        parentAdm2Id: "tr:adm2:test",
        sourceVersion: "osm-v1"
      });
    }
  );
  it.each([
    ["confidence", "mystery", "Invalid confidence"],
    ["boundaryKind", "invented", "Invalid boundary kind"],
    ["boundarySourceClass", "invented", "Invalid boundary source class"],
    ["boundarySourceClass", "synthetic-test", "not publishable"]
  ])("rejects unknown %s", async (field, value, message) => {
    const candidate = structuredClone(dataset);
    (candidate.zones[1]!.properties.territory as Record<string, unknown>)[field] = value;
    const candidateBytes = new TextEncoder().encode(JSON.stringify(candidate));
    const digest = await globalThis.crypto.subtle.digest("SHA-256", candidateBytes);
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    await expect(
      resolveTurkeyV2Boundaries({
        manifest: await seal({
          ...manifest,
          shards: { [path]: { sha256, byteSize: candidateBytes.byteLength } }
        }),
        adm2Id: "tr:adm2:test",
        allowEstimated: true,
        loadShard: async () => candidateBytes
      })
    ).rejects.toThrow(message);
  });

  it("rejects a checksum-valid shard with a mismatched dataset version", async () => {
    const candidate = structuredClone(dataset);
    candidate.manifest.datasetVersion = "older";
    const candidateBytes = new TextEncoder().encode(JSON.stringify(candidate));
    const digest = await globalThis.crypto.subtle.digest("SHA-256", candidateBytes);
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    await expect(
      resolveTurkeyV2Boundaries({
        manifest: await seal({
          ...manifest,
          shards: { [path]: { sha256, byteSize: candidateBytes.byteLength } }
        }),
        adm2Id: "tr:adm2:test",
        loadShard: async () => candidateBytes
      })
    ).rejects.toThrow("version mismatch");
  });
});
