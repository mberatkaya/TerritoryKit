import type { TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";

export interface TurkeyV2DeliveryIndex {
  datasetVersion: string;
  canonicalGeometryHash: string;
  contentHash: string;
  shards: Record<string, { sha256: string; byteSize: number }>;
  artifacts: Record<string, { path: string; sha256: string; byteSize: number }>;
  schemaVersion: "territorykit-tr-v2-delivery@1";
  datasetId: string;
  sourceLockHash: string;
  mvt: Record<string, unknown>;
  adm2Shards?: Record<string, string>;
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
  expectedManifestContentHash?: string;
  maxShardBytes?: number;
}): Promise<TurkeyV2ResolvedBoundaries> {
  if (!/^[a-zA-Z0-9:_-]+$/.test(input.adm2Id)) throw new Error("Unsafe ADM2 id");
  await validateTurkeyV2DeliveryManifest(input.manifest, input.expectedManifestContentHash);
  const legacyPath = `districts/${input.adm2Id.replace(/[^a-zA-Z0-9_-]/g, "_")}/dataset.json`;
  if (input.manifest.adm2Shards && !input.manifest.adm2Shards[input.adm2Id])
    throw new Error(`ADM2 shard mapping is absent: ${input.adm2Id}`);
  const path = input.manifest.adm2Shards?.[input.adm2Id] ?? legacyPath;
  assertSafeArtifactPath(path);
  const expected = input.manifest.shards[path];
  if (!expected)
    throw new Error(`District shard is absent from delivery manifest: ${input.adm2Id}`);
  if (input.maxShardBytes !== undefined && expected.byteSize > input.maxShardBytes)
    throw new Error(`District shard exceeds maxShardBytes: ${path}`);
  const bytes = await input.loadShard(path);
  if (bytes.byteLength !== expected.byteSize)
    throw new Error(`District shard byteSize mismatch: ${path}`);
  const sha256 = input.sha256 ? await input.sha256(bytes) : await sha256WebCrypto(bytes);
  if (sha256 !== expected.sha256) throw new Error(`District shard checksum mismatch: ${path}`);
  const dataset = JSON.parse(new TextDecoder().decode(bytes)) as TerritoryDataset;
  if (
    !Array.isArray(dataset.zones) ||
    !dataset.manifest ||
    dataset.manifest.datasetVersion !== input.manifest.datasetVersion
  )
    throw new Error(`District shard version mismatch: ${path}`);
  for (const zone of dataset.zones) {
    const territory = record(zone.properties?.territory);
    if (zone.level === 2 && zone.id === input.adm2Id) continue;
    if (zone.level !== 3 || (zone.parentId ?? territory.parentId) !== input.adm2Id)
      throw new Error(`District shard parent mismatch: ${path}`);
    assertBoundarySemantics(territory);
  }
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
  assertSafeArtifactPath(path);
  return `${manifest.datasetVersion}:${manifest.canonicalGeometryHash}:${manifest.contentHash}:${path}:${artifact.sha256}`;
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

function hasControl(value: string): boolean {
  return [...value].some(
    (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
  );
}

function assertSafeArtifactPath(path: string): void {
  if (
    !path ||
    path.includes("\\") ||
    hasControl(path) ||
    path.startsWith("/") ||
    /^[a-z][a-z0-9+.-]*:/i.test(path)
  )
    throw new Error("Unsafe artifact path");
  let decoded = path;
  for (let index = 0; index < 3; index++) {
    const next = decodeURIComponent(decoded);
    if (next === decoded) break;
    decoded = next;
  }
  if (
    decoded.startsWith("/") ||
    decoded.includes("\\") ||
    decoded.split("/").some((part) => part === "" || part === ".." || part === ".")
  )
    throw new Error("Unsafe artifact path");
}

function assertBoundarySemantics(territory: Record<string, unknown>): void {
  const kind = territory.boundaryKind;
  const source = territory.boundarySourceClass;
  const sourceClass = territory.sourceClass;
  const confidence = territory.confidence;
  if (!(["administrative", "estimated"] as unknown[]).includes(kind))
    throw new Error("Invalid boundary kind");
  if (
    !(
      [
        "official-national",
        "official-local",
        "osm-administrative",
        "smart-derived",
        "synthetic-test"
      ] as unknown[]
    ).includes(source)
  )
    throw new Error("Invalid boundary source class");
  if (!(["official", "osm", "generated"] as unknown[]).includes(sourceClass))
    throw new Error("Invalid source class");
  if (!(["authoritative", "high", "medium", "low"] as unknown[]).includes(confidence))
    throw new Error("Invalid confidence");
  if (source === "synthetic-test") throw new Error("Synthetic-test boundary is not publishable");
  if (
    (kind === "estimated" || source === "smart-derived") &&
    (territory.administrative === true || territory.authoritative === true)
  )
    throw new Error("Contradictory boundary semantics");
  if (
    territory.authoritative === true &&
    (sourceClass !== "official" ||
      !["official-national", "official-local"].includes(String(source)) ||
      kind !== "administrative" ||
      territory.administrative !== true ||
      confidence !== "authoritative")
  )
    throw new Error("Invalid authoritative source");
}

export async function validateTurkeyV2DeliveryManifest(
  manifest: TurkeyV2DeliveryIndex,
  expectedHash?: string
): Promise<void> {
  if (
    manifest.schemaVersion !== undefined &&
    manifest.schemaVersion !== "territorykit-tr-v2-delivery@1"
  )
    throw new Error("Invalid delivery manifest schemaVersion");
  if (!manifest.datasetVersion || !/^[a-f0-9]{64}$/.test(manifest.canonicalGeometryHash))
    throw new Error("Invalid delivery manifest identity");
  const paths = new Set<string>();
  for (const [path, entry] of Object.entries(manifest.shards)) {
    assertSafeArtifactPath(path);
    if (paths.has(path)) throw new Error("Duplicate delivery artifact path");
    paths.add(path);
    if (
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !Number.isSafeInteger(entry.byteSize) ||
      entry.byteSize < 0
    )
      throw new Error("Invalid shard checksum or byteSize");
  }
  for (const entry of Object.values(manifest.artifacts)) {
    assertSafeArtifactPath(entry.path);
    if (paths.has(entry.path)) throw new Error("Duplicate delivery artifact path");
    paths.add(entry.path);
    if (
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !Number.isSafeInteger(entry.byteSize) ||
      entry.byteSize < 0
    )
      throw new Error("Invalid artifact checksum or byteSize");
  }
  if (manifest.adm2Shards) {
    const mapped = new Set<string>();
    for (const path of Object.values(manifest.adm2Shards)) {
      if (!manifest.shards[path] || mapped.has(path))
        throw new Error("Unsafe or colliding ADM2 shard mapping");
      mapped.add(path);
    }
  }
  {
    if (!manifest.datasetId || !/^[a-z0-9][a-z0-9._-]*$/i.test(manifest.datasetId))
      throw new Error("Invalid delivery datasetId");
    if (!manifest.sourceLockHash || !/^sha256:[a-f0-9]{64}$/.test(manifest.sourceLockHash))
      throw new Error("Invalid delivery sourceLockHash");
    if (!manifest.mvt || typeof manifest.mvt.tileTemplate !== "string")
      throw new Error("Invalid delivery MVT config");
    assertSafeArtifactPath(manifest.mvt.tileTemplate);
    if (!/^render\/tiles\/\{z\}\/\{x\}\/\{y\}\.mvt$/.test(manifest.mvt.tileTemplate))
      throw new Error("Invalid delivery tile template");
    if (
      !Number.isSafeInteger(manifest.mvt.minZoom) ||
      !Number.isSafeInteger(manifest.mvt.maxZoom) ||
      Number(manifest.mvt.minZoom) < 0 ||
      Number(manifest.mvt.maxZoom) > 22 ||
      Number(manifest.mvt.minZoom) > Number(manifest.mvt.maxZoom)
    )
      throw new Error("Invalid delivery MVT zooms");
    if (
      manifest.mvt.extent !== 4096 ||
      manifest.mvt.buffer !== 64 ||
      manifest.mvt.tolerance !== 3 ||
      !Number.isSafeInteger(manifest.mvt.tileCount) ||
      !/^[a-f0-9]{64}$/.test(String(manifest.mvt.checksumIndexHash))
    )
      throw new Error("Invalid delivery MVT policy");
    const body = { ...manifest } as Record<string, unknown>;
    delete body.contentHash;
    const computed = await sha256Text(JSON.stringify(body));
    if (computed !== manifest.contentHash)
      throw new Error("Delivery manifest contentHash mismatch");
  }
  if (expectedHash && manifest.contentHash !== expectedHash)
    throw new Error("Pinned delivery manifest hash mismatch");
}

async function sha256Text(value: string): Promise<string> {
  return sha256WebCrypto(new TextEncoder().encode(value));
}
