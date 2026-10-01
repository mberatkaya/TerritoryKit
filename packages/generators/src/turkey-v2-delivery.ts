import { createHash } from "node:crypto";

export interface TurkeyV2DeliveryManifest {
  schemaVersion: "territorykit-tr-v2-delivery@1";
  datasetId: string;
  datasetVersion: string;
  buildDate: string;
  canonicalGeometryHash: string;
  sourceLockHash: string;
  generatorVersion: string;
  mvt: {
    tileTemplate: string;
    minZoom: number;
    maxZoom: number;
    extent: 4096;
    buffer: 64;
    tolerance: 3;
    tileCount: number;
    checksumIndexHash: string;
  };
  artifacts: Record<string, { path: string; sha256: string; byteSize: number }>;
  shards: Record<string, { sha256: string; byteSize: number }>;
  adm2Shards?: Record<string, string>;
  cacheIdentity: string;
  contentHash: string;
}

type Checksum = { sha256: string; byteSize: number };

/** Assemble an immutable delivery index from validated Sprint 6 artifact inventories. */
export function createTurkeyV2DeliveryManifest(input: {
  canonical: {
    datasetId: string;
    datasetVersion: string;
    buildDate: string;
    geometryHash: string;
    sourceLockHash: string;
  };
  sourceLock: { generated: { algorithmVersion: string }; contentHash: string };
  render: {
    datasetVersion: string;
    tileTemplate: string;
    layers: readonly { minZoom: number; maxZoom: number }[];
  };
  checksums: { files: Record<string, Checksum> };
  adm2Ids?: readonly string[];
  shards: {
    datasetVersion: string;
    sourceLockHash: string;
    files: Record<string, { sha256: string; sizeBytes: number }>;
  };
}): TurkeyV2DeliveryManifest {
  const { canonical, sourceLock, render, checksums, shards } = input;
  if (
    canonical.datasetVersion !== render.datasetVersion ||
    canonical.datasetVersion !== shards.datasetVersion ||
    canonical.sourceLockHash !== sourceLock.contentHash ||
    canonical.sourceLockHash !== shards.sourceLockHash
  ) {
    throw new Error("Delivery inputs have mismatched dataset versions or source locks.");
  }
  if (render.layers.length === 0) throw new Error("MVT render policy has no layers.");
  const tiles = Object.entries(checksums.files)
    .filter(([path]) => /^render\/tiles\/\d+\/\d+\/\d+\.mvt$/.test(path))
    .sort(([a], [b]) => a.localeCompare(b));
  const checksumIndexHash = sha256(JSON.stringify(tiles));
  const artifacts: TurkeyV2DeliveryManifest["artifacts"] = {};
  for (const [key, path] of Object.entries({
    canonical: "levels/ADM3/dataset.json",
    fullGeoJson: "levels/ADM3/full.geojson",
    adjacency: "levels/ADM3/adjacency/adjacency.json",
    spatialIndex: "query/query-artifact.json",
    attribution: "attribution.json",
    migration: "migration-plan.json"
  })) {
    const checksum = checksums.files[path];
    if (!checksum) throw new Error(`Missing delivery checksum: ${path}`);
    artifacts[key] = { path, ...checksum };
  }
  const orderedShards = Object.fromEntries(
    Object.entries(shards.files)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, entry]) => [path, { sha256: entry.sha256, byteSize: entry.sizeBytes }])
  );
  const adm2Shards: Record<string, string> = {};
  const usedPaths = new Set<string>();
  for (const id of [...(input.adm2Ids ?? [])].sort()) {
    const path = `districts/${id.replace(/[^a-zA-Z0-9_-]/g, "_")}/dataset.json`;
    if (!orderedShards[path] || usedPaths.has(path))
      throw new Error(`Missing or colliding ADM2 shard mapping: ${id}`);
    adm2Shards[id] = path;
    usedPaths.add(path);
  }
  const body = {
    schemaVersion: "territorykit-tr-v2-delivery@1" as const,
    datasetId: canonical.datasetId,
    datasetVersion: canonical.datasetVersion,
    buildDate: canonical.buildDate,
    canonicalGeometryHash: canonical.geometryHash,
    sourceLockHash: canonical.sourceLockHash,
    generatorVersion: sourceLock.generated.algorithmVersion,
    mvt: {
      tileTemplate: `render/${render.tileTemplate}`,
      minZoom: Math.min(...render.layers.map((layer) => layer.minZoom)),
      maxZoom: Math.max(...render.layers.map((layer) => layer.maxZoom)),
      extent: 4096 as const,
      buffer: 64 as const,
      tolerance: 3 as const,
      tileCount: tiles.length,
      checksumIndexHash
    },
    artifacts,
    shards: orderedShards,
    ...(input.adm2Ids ? { adm2Shards } : {}),
    cacheIdentity: `${canonical.datasetVersion}:${canonical.geometryHash}:${checksumIndexHash}`
  };
  return { ...body, contentHash: sha256(JSON.stringify(body)) };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
