import type { TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";

export interface TurkeyV2DeliveryIndex {
  datasetVersion: string;
  canonicalGeometryHash: string;
  contentHash: string;
  shards: Record<string, { sha256: string; byteSize: number }>;
  artifacts: Record<string, { path: string; sha256: string; byteSize: number }>;
}

export interface TurkeyV2BoundaryMetadata {
  id: string;
  parentAdm2Id: string;
  boundaryKind?: string;
  sourceClass?: string;
  confidence?: string;
  sourceVersion?: string;
  datasetVersion: string;
  administrative: boolean;
  authoritative: boolean;
  license?: string;
  attribution?: string;
  geometryHash?: string;
  generatorVersion?: string;
}

export interface TurkeyV2ResolvedBoundaries {
  features: TerritoryZone[];
  metadata: TurkeyV2BoundaryMetadata[];
  datasetVersion: string;
  sourceComposition: Record<string, number>;
  artifactPath: string;
  cacheIdentity: string;
}

/** Resolve one district from a checksum-verified shard without loading nationwide geometry. */
export async function resolveTurkeyV2Boundaries(input: {
  manifest: TurkeyV2DeliveryIndex;
  adm2Id: string;
  allowEstimated?: boolean;
  loadShard: (path: string) => Promise<Uint8Array>;
  sha256?: (bytes: Uint8Array) => string | Promise<string>;
}): Promise<TurkeyV2ResolvedBoundaries> {
  const path = `districts/${input.adm2Id.replace(/[^a-zA-Z0-9_-]/g, "_")}/dataset.json`;
  const expected = input.manifest.shards[path];
  if (!expected)
    throw new Error(`District shard is absent from delivery manifest: ${input.adm2Id}`);
  const bytes = await input.loadShard(path);
  const sha256 = input.sha256 ? await input.sha256(bytes) : await sha256WebCrypto(bytes);
  if (sha256 !== expected.sha256) throw new Error(`District shard checksum mismatch: ${path}`);
  const dataset = JSON.parse(new TextDecoder().decode(bytes)) as TerritoryDataset;
  if (
    !Array.isArray(dataset.zones) ||
    !dataset.manifest ||
    dataset.manifest.datasetVersion !== input.manifest.datasetVersion
  )
    throw new Error(`District shard version mismatch: ${path}`);
  const features = dataset.zones.filter((zone) => {
    const territory = record(zone.properties.territory);
    if (zone.level !== 3 || (zone.parentId ?? territory.parentId) !== input.adm2Id) return false;
    return (
      input.allowEstimated === true ||
      (territory.boundaryKind !== "estimated" &&
        territory.boundarySourceClass !== "smart-derived" &&
        territory.sourceClass !== "generated")
    );
  });
  const metadata = features.map((zone) => {
    const territory = record(zone.properties.territory);
    const source = record(territory.source);
    const boundaryKind = string(territory.boundaryKind);
    const sourceClass = string(territory.boundarySourceClass) ?? string(territory.sourceClass);
    const confidence = string(territory.confidence);
    const sourceVersion = string(territory.sourceVersion) ?? string(source.sourceVersion);
    const license = string(territory.license) ?? string(source.license);
    const attribution = string(territory.attribution) ?? string(source.attribution);
    const geometryHash = string(territory.geometryHash);
    const generatorVersion =
      string(territory.generatorVersion) ?? string(territory.algorithmVersion);
    return {
      id: zone.id,
      parentAdm2Id: input.adm2Id,
      ...(boundaryKind ? { boundaryKind } : {}),
      ...(sourceClass ? { sourceClass } : {}),
      ...(confidence ? { confidence } : {}),
      ...(sourceVersion ? { sourceVersion } : {}),
      datasetVersion: input.manifest.datasetVersion,
      administrative: territory.administrative === true,
      authoritative: territory.authoritative === true,
      ...(license ? { license } : {}),
      ...(attribution ? { attribution } : {}),
      ...(geometryHash ? { geometryHash } : {}),
      ...(generatorVersion ? { generatorVersion } : {})
    } satisfies TurkeyV2BoundaryMetadata;
  });
  const sourceComposition: Record<string, number> = {};
  for (const item of metadata)
    sourceComposition[item.sourceClass ?? "unknown"] =
      (sourceComposition[item.sourceClass ?? "unknown"] ?? 0) + 1;
  return {
    features,
    metadata,
    datasetVersion: input.manifest.datasetVersion,
    sourceComposition,
    artifactPath: path,
    cacheIdentity: createTurkeyV2ArtifactCacheKey(input.manifest, path)
  };
}

async function sha256WebCrypto(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("SHA-256 requires Web Crypto or an injected sha256 adapter.");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createTurkeyV2ArtifactCacheKey(
  manifest: TurkeyV2DeliveryIndex,
  path: string
): string {
  const artifact =
    manifest.shards[path] ?? Object.values(manifest.artifacts).find((entry) => entry.path === path);
  if (!artifact) throw new Error(`Artifact is absent from delivery manifest: ${path}`);
  return `${manifest.datasetVersion}:${manifest.canonicalGeometryHash}:${path}:${artifact.sha256}`;
}

export function getTurkeyV2Attribution(
  attribution: {
    groups: readonly { zoneIds: readonly string[]; attribution: string; license: string }[];
  },
  zoneIds: readonly string[]
): Array<{ attribution: string; license: string }> {
  const selected = new Set(zoneIds);
  return attribution.groups
    .filter((group) => group.zoneIds.some((id) => selected.has(id)))
    .map((group) => ({ attribution: group.attribution, license: group.license }))
    .filter(
      (entry, index, entries) =>
        entries.findIndex(
          (other) => other.attribution === entry.attribution && other.license === entry.license
        ) === index
    );
}

export function getTurkeyV2Neighbors(
  adjacency: { edges: readonly { from: string; to: string }[] },
  id: string
): string[] {
  return [
    ...new Set(
      adjacency.edges.flatMap((edge) =>
        edge.from === id ? [edge.to] : edge.to === id ? [edge.from] : []
      )
    )
  ].sort();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
