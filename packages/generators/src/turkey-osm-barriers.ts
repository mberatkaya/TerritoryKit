import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  computeGeometryBBox,
  geometryToPolygons,
  loadTerritoryDataset
} from "@territory-kit/dataset";
import type {
  LngLat,
  TerritoryBBox,
  TerritoryGeometry,
  TerritoryZone
} from "@territory-kit/dataset";
import { readOsmPbf } from "@osmix/pbf";
import type { OsmPbfBlock, OsmPbfGroup, OsmPbfHeaderBlock } from "@osmix/pbf";
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  Geometry,
  LineString,
  MultiLineString,
  MultiPolygon,
  Polygon
} from "geojson";
import * as polygonClipping from "polygon-clipping";
import type {
  MultiPolygon as ClippingMultiPolygon,
  Polygon as ClippingPolygon
} from "polygon-clipping";
import type {
  TurkeySmartFallbackLocalitySeed,
  TurkeySmartFallbackOptions
} from "./turkey-smart-fallback.js";
import type { TurkeyV2HybridGeneratedOptions } from "./turkey-v2-hybrid.js";
import { isRecord, serializeJsonStable, sha256Hex } from "./sources/utils.js";

export const TURKEY_OSM_BARRIER_SNAPSHOT_SOURCE_LOCK_SCHEMA_VERSION =
  "territorykit-tr-osm-snapshot-source-lock@1" as const;
export const TURKEY_OSM_BARRIER_ARTIFACT_SCHEMA_VERSION =
  "territorykit-tr-osm-barrier-artifact@1" as const;
export const TURKEY_OSM_BARRIER_QUALITY_SCHEMA_VERSION =
  "territorykit-tr-osm-barrier-quality@1" as const;
export const TURKEY_OSM_SMART_COVERAGE_SCHEMA_VERSION =
  "territorykit-tr-osm-smart-coverage@1" as const;
export const TURKEY_OSM_BARRIER_ALGORITHM_VERSION = "tr-osm-barriers-v1" as const;
export const TURKEY_OSM_BARRIER_PROVIDER_ID = "geofabrik-osm-extracts" as const;
export const TURKEY_OSM_BARRIER_PROVIDER_NAME = "Geofabrik OpenStreetMap extracts" as const;
export const TURKEY_OSM_BARRIER_SOURCE_URL = "https://download.geofabrik.de/europe/turkey.html";
export const TURKEY_OSM_BARRIER_DOWNLOAD_URL =
  "https://download.geofabrik.de/europe/turkey-latest.osm.pbf";
export const TURKEY_OSM_BARRIER_LICENSE = "ODbL-1.0" as const;
export const TURKEY_OSM_BARRIER_ATTRIBUTION = "OpenStreetMap contributors, ODbL 1.0" as const;
export const TURKEY_OSM_BARRIER_DEFAULT_CACHE_ROOT = ".territory/cache";
export const TURKEY_OSM_BARRIER_DEFAULT_OUTPUT_ROOT = ".territory/build/TR/OSM-barriers";

export type TurkeyOsmBarrierLayer = "roads" | "railways" | "water" | "landuse" | "parks";
export type TurkeyOsmBarrierIssueSeverity = "error" | "warning" | "info";
export type TurkeyOsmBarrierBuildMode = "strict" | "best-effort";

export type TurkeyOsmBarrierIssueCode =
  | "OSM_SNAPSHOT_NOT_FOUND"
  | "OSM_SNAPSHOT_DOWNLOAD_FAILED"
  | "OSM_SNAPSHOT_CHECKSUM_MISMATCH"
  | "OSM_SNAPSHOT_PARSE_FAILED"
  | "OSM_SNAPSHOT_SOURCE_UNSUPPORTED"
  | "OSM_BARRIER_ARTIFACT_INVALID"
  | "OSM_BARRIER_INPUT_INSUFFICIENT"
  | "OSM_BARRIER_ADM2_PROCESSING_FAILED";

export interface TurkeyOsmBarrierIssue {
  code: TurkeyOsmBarrierIssueCode;
  severity: TurkeyOsmBarrierIssueSeverity;
  message: string;
  adm2Id?: string;
  path?: string;
  details?: Record<string, unknown>;
}

export interface OsmSnapshotProvider {
  id: string;
  name: string;
  resolveSnapshot(countryCode: string): Promise<OsmSnapshotDescriptor>;
  downloadSnapshot(
    descriptor: OsmSnapshotDescriptor,
    options?: TurkeyOsmSnapshotDownloadOptions
  ): Promise<OsmSnapshotArtifact>;
}

export interface OsmSnapshotDescriptor {
  providerId: string;
  providerName: string;
  countryCode: string;
  sourceUrl: string;
  downloadUrl: string;
  sourceDatasetId: string;
  format: "osm-pbf";
  license: typeof TURKEY_OSM_BARRIER_LICENSE;
  attribution: typeof TURKEY_OSM_BARRIER_ATTRIBUTION;
  expectedFileName: string;
}

export interface TurkeyOsmSnapshotDownloadOptions {
  cacheRoot?: string;
  downloadedAt?: string;
  fetchImpl?: typeof fetch;
}

export interface TurkeyOsmSnapshotAcquireOptions extends TurkeyOsmSnapshotDownloadOptions {
  countryCode?: string;
  provider?: OsmSnapshotProvider;
  dryRun?: boolean;
}

export interface OsmSnapshotArtifact {
  descriptor: OsmSnapshotDescriptor;
  sourceLock: TurkeyOsmSnapshotSourceLock;
  pbfPath: string;
  sourceLockPath: string;
  cacheDir: string;
}

export interface TurkeyOsmSnapshotSourceLock {
  schemaVersion: typeof TURKEY_OSM_BARRIER_SNAPSHOT_SOURCE_LOCK_SCHEMA_VERSION;
  providerId: string;
  providerName: string;
  countryCode: string;
  sourceUrl: string;
  downloadUrl: string;
  sourceDatasetId: string;
  snapshotDate: string;
  downloadedAt: string;
  fileSizeBytes: number;
  sha256: string;
  license: typeof TURKEY_OSM_BARRIER_LICENSE;
  attribution: typeof TURKEY_OSM_BARRIER_ATTRIBUTION;
  format: "osm-pbf";
  contentAddressedSnapshotId: string;
  cachePath: string;
  pbfHeader: {
    osmosisReplicationTimestamp?: string;
    osmosisReplicationSequenceNumber?: number;
    osmosisReplicationBaseUrl?: string;
    writingProgram?: string;
    source?: string;
  };
}

export interface TurkeyOsmSnapshotVerifyOptions {
  sourceLockPath: string;
  snapshotPath?: string;
}

export interface TurkeyOsmSnapshotVerifyResult {
  ok: boolean;
  sourceLock: TurkeyOsmSnapshotSourceLock;
  snapshotPath: string;
  expectedSha256: string;
  actualSha256: string;
  fileSizeBytes: number;
  issues: TurkeyOsmBarrierIssue[];
}

export interface TurkeyOsmBarrierFeatureProperties {
  "@id": string;
  osm_id: string;
  osm_type: "way" | "relation";
  barrierLayer: TurkeyOsmBarrierLayer;
  barrierClass: string;
  barrierStrength: string;
  source: "openstreetmap";
  sourceProvider: string;
  [key: string]: string;
}

export interface TurkeyOsmNormalizedBarriers {
  roads: FeatureCollection;
  railways: FeatureCollection;
  water: FeatureCollection;
  landuse: FeatureCollection;
  parks: FeatureCollection;
  localitySeeds: TurkeySmartFallbackLocalitySeed[];
  sourceLock: TurkeyOsmSnapshotSourceLock;
  parser: {
    package: "@osmix/pbf";
    passes: number;
    parsedPrimitiveBlocks: number;
    relevantWayCount: number;
    relationCount: number;
    neededNodeCount: number;
    resolvedNodeCount: number;
  };
  contentHash: string;
}

export interface TurkeyOsmBarrierExtractionOptions {
  pbfPath: string;
  sourceLock: TurkeyOsmSnapshotSourceLock;
  maxPrimitiveBlocks?: number;
  adm2Zones?: readonly TerritoryZone[];
  spatialPaddingDegrees?: number;
}

export interface TurkeyOsmAdm2BarrierArtifact {
  manifest: TurkeyOsmBarrierManifest;
  quality: TurkeyOsmBarrierQualityReport;
  roads: FeatureCollection;
  railways: FeatureCollection;
  water: FeatureCollection;
  landuse: FeatureCollection;
  parks: FeatureCollection;
  localitySeeds: TurkeySmartFallbackLocalitySeed[];
}

export interface TurkeyOsmBarrierManifest {
  schemaVersion: typeof TURKEY_OSM_BARRIER_ARTIFACT_SCHEMA_VERSION;
  countryCode: "TR";
  adm2Id: string;
  algorithmVersion: typeof TURKEY_OSM_BARRIER_ALGORITHM_VERSION;
  generatedAt: string;
  source: {
    providerId: string;
    providerName: string;
    sourceUrl: string;
    sourceDatasetId: string;
    snapshotSha256: string;
    snapshotDate: string;
    license: string;
    attribution: string;
    format: "osm-pbf";
  };
  counts: Record<TurkeyOsmBarrierLayer | "localitySeeds", number>;
  hashes: Record<TurkeyOsmBarrierLayer | "localitySeeds" | "quality", string>;
  artifactChecksum: string;
  sourceSnapshotChecksum: string;
}

export interface TurkeyOsmBarrierQualityReport {
  schemaVersion: typeof TURKEY_OSM_BARRIER_QUALITY_SCHEMA_VERSION;
  adm2Id: string;
  ok: boolean;
  status: "eligible" | "input-insufficient";
  roadFeatureCount: number;
  majorRoadCount: number;
  railFeatureCount: number;
  waterFeatureCount: number;
  parkFeatureCount: number;
  landuseFeatureCount: number;
  localitySeedCount: number;
  barrierLengthKm: number;
  majorBarrierLengthKm: number;
  inputCoverageConfidence: number;
  issues: TurkeyOsmBarrierIssue[];
}

export interface TurkeyOsmBarrierBuildOptions {
  snapshotPath: string;
  sourceLock: TurkeyOsmSnapshotSourceLock;
  adm2Zones: readonly TerritoryZone[];
  outputRoot?: string;
  generatedAt?: string;
  force?: boolean;
  dryRun?: boolean;
  adm2Ids?: readonly string[];
  maxDistricts?: number;
  concurrency?: number;
  mode?: TurkeyOsmBarrierBuildMode;
  maxPrimitiveBlocks?: number;
}

export interface TurkeyOsmBarrierBuildPlan {
  schemaVersion: "territorykit-tr-osm-barrier-build-plan@1";
  provider: {
    id: string;
    name: string;
    sourceUrl: string;
    downloadUrl: string;
    format: "osm-pbf";
    license: string;
    attribution: string;
  };
  cachePath: string;
  outputRoot: string;
  adm2Count: number;
  selectedAdm2Count: number;
  selectedFeatureClasses: Record<TurkeyOsmBarrierLayer | "localitySeeds", readonly string[]>;
  expectedOperations: readonly string[];
  estimatedOutputPaths: readonly string[];
}

export interface TurkeyOsmBarrierBuildResult {
  schemaVersion: "territorykit-tr-osm-barrier-build@1";
  ok: boolean;
  dryRun: boolean;
  outputRoot: string;
  sourceSnapshotChecksum: string;
  algorithmVersion: typeof TURKEY_OSM_BARRIER_ALGORITHM_VERSION;
  adm2Total: number;
  processedAdm2Count: number;
  skippedAdm2Count: number;
  failedAdm2Count: number;
  eligibleAdm2Count: number;
  inputInsufficientAdm2Count: number;
  rawPbfSizeBytes: number;
  normalizedArtifactSizeBytes: number;
  averageAdm2ArtifactSizeBytes: number;
  largestAdm2Artifact: {
    adm2Id?: string;
    sizeBytes: number;
  };
  durationMs: number;
  plan?: TurkeyOsmBarrierBuildPlan;
  artifacts: Array<{
    adm2Id: string;
    outputPath: string;
    artifactChecksum: string;
    qualityStatus: TurkeyOsmBarrierQualityReport["status"];
    sizeBytes: number;
    skipped: boolean;
  }>;
  issues: TurkeyOsmBarrierIssue[];
}

export interface TurkeyOsmSmartCoverageOptions {
  adm2Zones: readonly TerritoryZone[];
  barrierArtifacts: readonly TurkeyOsmAdm2BarrierArtifact[];
  officialZones?: readonly TerritoryZone[];
  osmAdministrativeZones?: readonly TerritoryZone[];
  smartGeneratedParentIds?: readonly string[];
  smartQualityRejectedParentIds?: readonly string[];
}

export interface TurkeyOsmSmartCoverageReport {
  schemaVersion: typeof TURKEY_OSM_SMART_COVERAGE_SCHEMA_VERSION;
  adm2Total: number;
  official: number;
  osmAdministrative: number;
  smart: {
    eligible: number;
    generated: number;
    qualityRejected: number;
    inputInsufficient: number;
  };
  legacyRequired: number;
  consistency: {
    accountedAdm2: number;
    ok: boolean;
  };
}

interface OsmNode {
  id: number;
  coordinate: LngLat;
  tags: Record<string, string>;
}

interface OsmWay {
  id: number;
  refs: number[];
  tags: Record<string, string>;
}

interface OsmRelation {
  id: number;
  members: Array<{ type: "node" | "way" | "relation"; ref: number; role: string }>;
  tags: Record<string, string>;
}

interface ClassifiedBarrier {
  layer: TurkeyOsmBarrierLayer;
  geometryKind: "line" | "polygon";
  barrierClass: string;
  strength: number;
}

interface PendingWay {
  osmType: "way";
  id: number;
  refs: number[];
  tags: Record<string, string>;
  classification: ClassifiedBarrier;
}

interface PendingRelation {
  osmType: "relation";
  id: number;
  members: Array<{ type: "node" | "way" | "relation"; ref: number; role: string }>;
  tags: Record<string, string>;
  classification: ClassifiedBarrier;
}

interface ParsedPbfInventory {
  ways: PendingWay[];
  relationMembers: Map<number, OsmWay>;
  relations: PendingRelation[];
  localitySeeds: TurkeySmartFallbackLocalitySeed[];
  neededNodeIds: NumberLookupSet;
  primitiveBlockCount: number;
  passes: number;
}

interface SpatialExtractionFilter {
  bboxes: readonly TerritoryBBox[];
}

interface SpatialCandidateNodes {
  nodeIds: NumberLookupSet;
  localitySeeds: TurkeySmartFallbackLocalitySeed[];
}

interface NumberLookupSet {
  readonly size: number;
  add(value: number): void;
  has(value: number): boolean;
}

interface OsmNodeLookup {
  readonly size: number;
  get(id: number): OsmNode | undefined;
}

class ShardedNumberLookupSet implements NumberLookupSet {
  private readonly buckets: Array<Set<number>>;
  private count = 0;

  constructor(bucketCount = OSM_LOOKUP_BUCKET_COUNT) {
    this.buckets = Array.from({ length: bucketCount }, () => new Set<number>());
  }

  get size(): number {
    return this.count;
  }

  add(value: number): void {
    const bucket = this.bucketFor(value);

    if (!bucket.has(value)) {
      bucket.add(value);
      this.count += 1;
    }
  }

  has(value: number): boolean {
    return this.bucketFor(value).has(value);
  }

  private bucketFor(value: number): Set<number> {
    const index = Math.abs(value) % this.buckets.length;
    return this.buckets[index]!;
  }
}

class ShardedOsmNodeLookup implements OsmNodeLookup {
  private readonly buckets: Array<Map<number, OsmNode>>;
  private count = 0;

  constructor(bucketCount = OSM_LOOKUP_BUCKET_COUNT) {
    this.buckets = Array.from({ length: bucketCount }, () => new Map<number, OsmNode>());
  }

  get size(): number {
    return this.count;
  }

  set(node: OsmNode): void {
    const bucket = this.bucketFor(node.id);

    if (!bucket.has(node.id)) {
      this.count += 1;
    }

    bucket.set(node.id, node);
  }

  get(id: number): OsmNode | undefined {
    return this.bucketFor(id).get(id);
  }

  private bucketFor(value: number): Map<number, OsmNode> {
    const index = Math.abs(value) % this.buckets.length;
    return this.buckets[index]!;
  }
}

const textDecoder = new TextDecoder();
const CLIPPER = {
  intersection: polygonClipping.intersection
};
const OSM_LOOKUP_BUCKET_COUNT = 256;
const TURKEY_OSM_SPATIAL_FILTER_PADDING_DEGREES = 0.03;
const TURKEY_OSM_EXTRACTION_FALLBACK_BATCH_SIZE = 16;
const TURKEY_OSM_SPATIAL_EXTRACTION_MIN_BYTES = 50_000_000;

const ROAD_TAGS = [
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
  "residential",
  "unclassified",
  "living_street"
] as const;
const RAILWAY_TAGS = ["rail", "light_rail", "subway", "tram"] as const;
const WATERWAY_TAGS = ["river", "canal", "stream"] as const;
const WATER_TAGS = ["river", "lake", "reservoir"] as const;
const LEISURE_TAGS = ["park", "nature_reserve"] as const;
const LANDUSE_TAGS = ["forest", "cemetery", "industrial"] as const;
const PLACE_TAGS = ["neighbourhood", "quarter", "suburb", "village", "town", "locality"] as const;

export function createGeofabrikOsmSnapshotProvider(
  options: { fetchImpl?: typeof fetch; cacheRoot?: string } = {}
): OsmSnapshotProvider {
  return {
    id: TURKEY_OSM_BARRIER_PROVIDER_ID,
    name: TURKEY_OSM_BARRIER_PROVIDER_NAME,
    async resolveSnapshot(countryCode: string): Promise<OsmSnapshotDescriptor> {
      const normalized = countryCode.trim().toUpperCase();

      if (normalized !== "TR") {
        throw new TurkeyOsmBarrierPipelineError(
          "OSM_SNAPSHOT_SOURCE_UNSUPPORTED",
          `Geofabrik Turkey snapshot provider only supports TR, received '${countryCode}'.`
        );
      }

      return createTurkeyGeofabrikSnapshotDescriptor();
    },
    async downloadSnapshot(
      descriptor: OsmSnapshotDescriptor,
      downloadOptions: TurkeyOsmSnapshotDownloadOptions = {}
    ): Promise<OsmSnapshotArtifact> {
      const resolvedOptions: TurkeyOsmSnapshotDownloadOptions = {};
      const cacheRoot = downloadOptions.cacheRoot ?? options.cacheRoot;
      const downloadedAt = downloadOptions.downloadedAt;
      const fetchImpl = downloadOptions.fetchImpl ?? options.fetchImpl;

      if (cacheRoot) {
        resolvedOptions.cacheRoot = cacheRoot;
      }

      if (downloadedAt) {
        resolvedOptions.downloadedAt = downloadedAt;
      }

      if (fetchImpl) {
        resolvedOptions.fetchImpl = fetchImpl;
      }

      return downloadTurkeyOsmSnapshot(descriptor, resolvedOptions);
    }
  };
}

export function createTurkeyGeofabrikSnapshotDescriptor(): OsmSnapshotDescriptor {
  return {
    providerId: TURKEY_OSM_BARRIER_PROVIDER_ID,
    providerName: TURKEY_OSM_BARRIER_PROVIDER_NAME,
    countryCode: "TR",
    sourceUrl: TURKEY_OSM_BARRIER_SOURCE_URL,
    downloadUrl: TURKEY_OSM_BARRIER_DOWNLOAD_URL,
    sourceDatasetId: "geofabrik:europe:turkey",
    format: "osm-pbf",
    license: TURKEY_OSM_BARRIER_LICENSE,
    attribution: TURKEY_OSM_BARRIER_ATTRIBUTION,
    expectedFileName: "turkey.osm.pbf"
  };
}

export async function acquireTurkeyOsmSnapshot(
  options: TurkeyOsmSnapshotAcquireOptions = {}
): Promise<OsmSnapshotArtifact | TurkeyOsmBarrierBuildPlan> {
  const provider = options.provider ?? createGeofabrikOsmSnapshotProvider(options);
  const descriptor = await provider.resolveSnapshot(options.countryCode ?? "TR");

  if (options.dryRun) {
    return createTurkeyOsmBarrierBuildPlan({
      descriptor,
      outputRoot: TURKEY_OSM_BARRIER_DEFAULT_OUTPUT_ROOT,
      adm2Zones: [],
      ...(options.cacheRoot ? { cacheRoot: options.cacheRoot } : {})
    });
  }

  return provider.downloadSnapshot(descriptor, options);
}

export async function verifyTurkeyOsmSnapshot(
  options: TurkeyOsmSnapshotVerifyOptions
): Promise<TurkeyOsmSnapshotVerifyResult> {
  const sourceLock = parseTurkeyOsmSnapshotSourceLock(
    JSON.parse(await readFile(options.sourceLockPath, "utf8"))
  );
  const snapshotPath = options.snapshotPath ?? sourceLock.cachePath;
  let actualSha256 = "";
  let fileSizeBytes = 0;
  const issues: TurkeyOsmBarrierIssue[] = [];

  try {
    fileSizeBytes = (await stat(snapshotPath)).size;
    actualSha256 = await sha256File(snapshotPath);
  } catch {
    issues.push({
      code: "OSM_SNAPSHOT_NOT_FOUND",
      severity: "error",
      message: `OSM snapshot was not found at '${snapshotPath}'.`,
      path: snapshotPath
    });

    return {
      ok: false,
      sourceLock,
      snapshotPath,
      expectedSha256: sourceLock.sha256,
      actualSha256,
      fileSizeBytes,
      issues
    };
  }

  if (actualSha256 !== sourceLock.sha256) {
    issues.push({
      code: "OSM_SNAPSHOT_CHECKSUM_MISMATCH",
      severity: "error",
      message: `Expected snapshot SHA-256 ${sourceLock.sha256}, received ${actualSha256}.`,
      path: snapshotPath,
      details: {
        expectedSha256: sourceLock.sha256,
        actualSha256
      }
    });
  }

  return {
    ok: issues.length === 0,
    sourceLock,
    snapshotPath,
    expectedSha256: sourceLock.sha256,
    actualSha256,
    fileSizeBytes,
    issues
  };
}

export async function extractTurkeyOsmBarriersFromPbf(
  options: TurkeyOsmBarrierExtractionOptions
): Promise<TurkeyOsmNormalizedBarriers> {
  try {
    const startedAt = performance.now();
    const parserOptions =
      options.maxPrimitiveBlocks !== undefined
        ? { maxPrimitiveBlocks: options.maxPrimitiveBlocks }
        : {};
    const spatialFilter = createSpatialExtractionFilter(
      options.adm2Zones ?? [],
      options.spatialPaddingDegrees ?? TURKEY_OSM_SPATIAL_FILTER_PADDING_DEGREES
    );
    const inventory = await collectTurkeyOsmBarrierInventory(
      options.pbfPath,
      parserOptions,
      spatialFilter
    );
    const nodes = await collectNeededNodes(options.pbfPath, inventory.neededNodeIds, parserOptions);
    const collections = createEmptyBarrierCollections();

    for (const way of inventory.ways.sort(comparePendingWays)) {
      const geometry = wayGeometry(way, nodes);

      if (!geometry) {
        continue;
      }

      pushBarrierFeature(collections[way.classification.layer], {
        osmType: way.osmType,
        osmId: way.id,
        tags: way.tags,
        classification: way.classification,
        geometry
      });
    }

    for (const relation of inventory.relations.sort(comparePendingRelations)) {
      const geometry = relationGeometry(relation, inventory.relationMembers, nodes);

      if (!geometry) {
        continue;
      }

      pushBarrierFeature(collections[relation.classification.layer], {
        osmType: relation.osmType,
        osmId: relation.id,
        tags: relation.tags,
        classification: relation.classification,
        geometry
      });
    }

    const normalized = normalizeBarrierCollections(collections);
    const localitySeeds = inventory.localitySeeds.sort(compareLocalitySeeds);
    const contentHash = sha256Hex(
      serializeJsonStable({
        roads: normalized.roads,
        railways: normalized.railways,
        water: normalized.water,
        landuse: normalized.landuse,
        parks: normalized.parks,
        localitySeeds,
        sourceSnapshotChecksum: options.sourceLock.sha256,
        algorithmVersion: TURKEY_OSM_BARRIER_ALGORITHM_VERSION
      })
    );

    return {
      ...normalized,
      localitySeeds,
      sourceLock: options.sourceLock,
      parser: {
        package: "@osmix/pbf",
        passes: inventory.passes + (inventory.neededNodeIds.size > 0 ? 1 : 0),
        parsedPrimitiveBlocks: inventory.primitiveBlockCount,
        relevantWayCount: inventory.ways.length,
        relationCount: inventory.relations.length,
        neededNodeCount: inventory.neededNodeIds.size,
        resolvedNodeCount: nodes.size
      },
      contentHash: sha256Hex(
        serializeJsonStable({
          contentHash,
          durationClass: Math.round(performance.now() - startedAt) >= 0 ? "completed" : "unknown"
        })
      )
    };
  } catch (error) {
    if (error instanceof TurkeyOsmBarrierPipelineError) {
      throw error;
    }

    throw new TurkeyOsmBarrierPipelineError(
      "OSM_SNAPSHOT_PARSE_FAILED",
      error instanceof Error ? error.message : String(error)
    );
  }
}

export async function buildTurkeyOsmBarrierArtifacts(
  options: TurkeyOsmBarrierBuildOptions
): Promise<TurkeyOsmBarrierBuildResult> {
  const startedAt = performance.now();
  const outputRoot = options.outputRoot ?? TURKEY_OSM_BARRIER_DEFAULT_OUTPUT_ROOT;
  const selectedAdm2 = selectAdm2Zones(options.adm2Zones, {
    ...(options.adm2Ids ? { adm2Ids: options.adm2Ids } : {}),
    ...(options.maxDistricts !== undefined ? { maxDistricts: options.maxDistricts } : {})
  });
  const plan = createTurkeyOsmBarrierBuildPlan({
    descriptor: sourceLockToDescriptor(options.sourceLock),
    outputRoot,
    adm2Zones: selectedAdm2
  });

  if (options.dryRun) {
    return {
      schemaVersion: "territorykit-tr-osm-barrier-build@1",
      ok: true,
      dryRun: true,
      outputRoot,
      sourceSnapshotChecksum: options.sourceLock.sha256,
      algorithmVersion: TURKEY_OSM_BARRIER_ALGORITHM_VERSION,
      adm2Total: options.adm2Zones.length,
      processedAdm2Count: 0,
      skippedAdm2Count: 0,
      failedAdm2Count: 0,
      eligibleAdm2Count: 0,
      inputInsufficientAdm2Count: 0,
      rawPbfSizeBytes: options.sourceLock.fileSizeBytes,
      normalizedArtifactSizeBytes: 0,
      averageAdm2ArtifactSizeBytes: 0,
      largestAdm2Artifact: { sizeBytes: 0 },
      durationMs: Math.round(performance.now() - startedAt),
      plan,
      artifacts: [],
      issues: []
    };
  }

  const rawPbfSizeBytes = (await stat(options.snapshotPath)).size;
  const artifacts: TurkeyOsmBarrierBuildResult["artifacts"] = [];
  const issues: TurkeyOsmBarrierIssue[] = [];
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 2));
  const mode = options.mode ?? "strict";
  const useSpatialExtraction = rawPbfSizeBytes >= TURKEY_OSM_SPATIAL_EXTRACTION_MIN_BYTES;

  await mkdir(outputRoot, { recursive: true });

  for (const batch of createOsmExtractionBatches(selectedAdm2)) {
    const pendingAdm2: TerritoryZone[] = [];

    for (const adm2 of batch) {
      if (options.force) {
        pendingAdm2.push(adm2);
        continue;
      }

      try {
        const existing = await readReusableArtifact(adm2, outputRoot, options.sourceLock);

        if (existing) {
          artifacts.push({
            adm2Id: adm2.id,
            outputPath: artifactDirectory(outputRoot, adm2.id),
            artifactChecksum: existing.manifest.artifactChecksum,
            qualityStatus: existing.quality.status,
            sizeBytes: await directorySizeBytes(artifactDirectory(outputRoot, adm2.id)),
            skipped: true
          });
          continue;
        }

        pendingAdm2.push(adm2);
      } catch {
        pendingAdm2.push(adm2);
      }
    }

    if (pendingAdm2.length === 0) {
      continue;
    }

    const normalized = await extractTurkeyOsmBarriersFromPbf({
      pbfPath: options.snapshotPath,
      sourceLock: options.sourceLock,
      ...(useSpatialExtraction ? { adm2Zones: pendingAdm2 } : {}),
      ...(options.maxPrimitiveBlocks !== undefined
        ? { maxPrimitiveBlocks: options.maxPrimitiveBlocks }
        : {})
    });
    let nextIndex = 0;

    async function worker(): Promise<void> {
      while (nextIndex < pendingAdm2.length) {
        const index = nextIndex;
        nextIndex += 1;
        const adm2 = pendingAdm2[index];

        if (!adm2) {
          continue;
        }

        try {
          const artifact = buildAdm2BarrierArtifact({
            adm2,
            normalized,
            generatedAt: options.generatedAt ?? new Date(0).toISOString()
          });
          const target = artifactDirectory(outputRoot, adm2.id);
          await writeAdm2BarrierArtifact(target, artifact);
          artifacts.push({
            adm2Id: adm2.id,
            outputPath: target,
            artifactChecksum: artifact.manifest.artifactChecksum,
            qualityStatus: artifact.quality.status,
            sizeBytes: await directorySizeBytes(target),
            skipped: false
          });
        } catch (error) {
          const issue: TurkeyOsmBarrierIssue = {
            code: "OSM_BARRIER_ADM2_PROCESSING_FAILED",
            severity: "error",
            message: error instanceof Error ? error.message : String(error),
            adm2Id: adm2.id
          };
          issues.push(issue);

          if (mode === "strict") {
            throw new TurkeyOsmBarrierPipelineError(issue.code, issue.message, { issue });
          }
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, pendingAdm2.length) }, () => worker())
    );
  }

  artifacts.sort((left, right) => left.adm2Id.localeCompare(right.adm2Id));
  issues.sort(compareIssues);
  const processedAdm2Count = artifacts.filter((artifact) => !artifact.skipped).length;
  const skippedAdm2Count = artifacts.filter((artifact) => artifact.skipped).length;
  const failedAdm2Count = issues.filter((issue) => issue.severity === "error").length;
  const eligibleAdm2Count = artifacts.filter(
    (artifact) => artifact.qualityStatus === "eligible"
  ).length;
  const inputInsufficientAdm2Count = artifacts.filter(
    (artifact) => artifact.qualityStatus === "input-insufficient"
  ).length;
  const totalArtifactSizeBytes = artifacts.reduce(
    (total, artifact) => total + artifact.sizeBytes,
    0
  );
  const largestArtifact = artifacts.reduce<TurkeyOsmBarrierBuildResult["largestAdm2Artifact"]>(
    (largest, artifact) =>
      artifact.sizeBytes > largest.sizeBytes
        ? { adm2Id: artifact.adm2Id, sizeBytes: artifact.sizeBytes }
        : largest,
    { sizeBytes: 0 }
  );

  return {
    schemaVersion: "territorykit-tr-osm-barrier-build@1",
    ok: failedAdm2Count === 0,
    dryRun: false,
    outputRoot,
    sourceSnapshotChecksum: options.sourceLock.sha256,
    algorithmVersion: TURKEY_OSM_BARRIER_ALGORITHM_VERSION,
    adm2Total: options.adm2Zones.length,
    processedAdm2Count,
    skippedAdm2Count,
    failedAdm2Count,
    eligibleAdm2Count,
    inputInsufficientAdm2Count,
    rawPbfSizeBytes,
    normalizedArtifactSizeBytes: totalArtifactSizeBytes,
    averageAdm2ArtifactSizeBytes:
      artifacts.length > 0 ? Math.round(totalArtifactSizeBytes / artifacts.length) : 0,
    largestAdm2Artifact: largestArtifact,
    durationMs: Math.round(performance.now() - startedAt),
    artifacts,
    issues
  };
}

export function createTurkeyOsmBarrierBuildPlan(input: {
  descriptor: OsmSnapshotDescriptor;
  cacheRoot?: string;
  outputRoot: string;
  adm2Zones: readonly TerritoryZone[];
}): TurkeyOsmBarrierBuildPlan {
  const cacheRoot = input.cacheRoot ?? TURKEY_OSM_BARRIER_DEFAULT_CACHE_ROOT;
  const selected = input.adm2Zones.slice(0, Math.min(3, input.adm2Zones.length));

  return {
    schemaVersion: "territorykit-tr-osm-barrier-build-plan@1",
    provider: {
      id: input.descriptor.providerId,
      name: input.descriptor.providerName,
      sourceUrl: input.descriptor.sourceUrl,
      downloadUrl: input.descriptor.downloadUrl,
      format: input.descriptor.format,
      license: input.descriptor.license,
      attribution: input.descriptor.attribution
    },
    cachePath: join(
      cacheRoot,
      "osm",
      input.descriptor.countryCode,
      "<sha256>",
      input.descriptor.expectedFileName
    ),
    outputRoot: input.outputRoot,
    adm2Count: input.adm2Zones.length,
    selectedAdm2Count: input.adm2Zones.length,
    selectedFeatureClasses: {
      roads: ROAD_TAGS,
      railways: RAILWAY_TAGS,
      water: [...WATERWAY_TAGS, "natural=water", "natural=coastline", ...WATER_TAGS],
      landuse: [...LANDUSE_TAGS, "natural=wood"],
      parks: LEISURE_TAGS,
      localitySeeds: PLACE_TAGS
    },
    expectedOperations: [
      "resolve snapshot descriptor",
      "download or verify cached PBF",
      "lock snapshot by SHA-256",
      "stream relevant OSM ways, relations, and locality nodes",
      "resolve referenced node coordinates",
      "clip normalized barriers to ADM2 geometry",
      "write deterministic ADM2 barrier artifacts",
      "emit manifest, quality, and size metrics"
    ],
    estimatedOutputPaths: selected.map((adm2) => artifactDirectory(input.outputRoot, adm2.id))
  };
}

export function createTurkeyOsmSmartFallbackGeneratedOptions(
  artifact: TurkeyOsmAdm2BarrierArtifact,
  options: {
    fallbackToLegacyOnSmartFailure?: boolean;
    smartFallbackOptions?: TurkeySmartFallbackOptions;
  } = {}
): TurkeyV2HybridGeneratedOptions {
  return {
    enabled: true,
    strategy: "smart",
    fallbackToLegacyOnSmartFailure: options.fallbackToLegacyOnSmartFailure ?? true,
    smartFallback: {
      roads: artifact.roads,
      railways: artifact.railways,
      water: artifact.water,
      landuse: artifact.landuse,
      parks: artifact.parks,
      localitySeeds: artifact.localitySeeds,
      options: {
        ...(options.smartFallbackOptions ?? {}),
        sourceMetadata: {
          providerId: artifact.manifest.source.providerId,
          providerName: artifact.manifest.source.providerName,
          sourceDatasetId: artifact.manifest.source.sourceDatasetId,
          sourceId: artifact.manifest.adm2Id,
          sourceDate: artifact.manifest.source.snapshotDate,
          sourceVersion: TURKEY_OSM_BARRIER_ALGORITHM_VERSION,
          sourceUrl: artifact.manifest.source.sourceUrl,
          sourceSnapshotId: artifact.manifest.source.snapshotSha256.slice(0, 16),
          sourceSnapshotChecksum: artifact.manifest.source.snapshotSha256,
          license: artifact.manifest.source.license,
          attribution: artifact.manifest.source.attribution
        }
      }
    }
  };
}

export async function readTurkeyOsmAdm2BarrierArtifact(
  artifactRootOrDirectory: string,
  adm2Id?: string
): Promise<TurkeyOsmAdm2BarrierArtifact> {
  const directory = adm2Id
    ? artifactDirectory(artifactRootOrDirectory, adm2Id)
    : artifactRootOrDirectory;
  const [manifest, quality, roads, railways, water, landuse, parks, localitySeeds] =
    await Promise.all([
      readJsonFile(join(directory, "manifest.json")),
      readJsonFile(join(directory, "quality.json")),
      readJsonFile(join(directory, "roads.geojson")),
      readJsonFile(join(directory, "railways.geojson")),
      readJsonFile(join(directory, "water.geojson")),
      readJsonFile(join(directory, "landuse.geojson")),
      readJsonFile(join(directory, "parks.geojson")),
      readJsonFile(join(directory, "locality-seeds.json"))
    ]);

  return {
    manifest: parseTurkeyOsmBarrierManifest(manifest),
    quality: parseTurkeyOsmBarrierQuality(quality),
    roads: parseFeatureCollection(roads),
    railways: parseFeatureCollection(railways),
    water: parseFeatureCollection(water),
    landuse: parseFeatureCollection(landuse),
    parks: parseFeatureCollection(parks),
    localitySeeds: parseLocalitySeeds(localitySeeds)
  };
}

export function createTurkeyOsmSmartCoverageReport(
  options: TurkeyOsmSmartCoverageOptions
): TurkeyOsmSmartCoverageReport {
  const officialParents = new Set(
    (options.officialZones ?? []).map((zone) => zone.parentId).filter(isString)
  );
  const osmParents = new Set(
    (options.osmAdministrativeZones ?? []).map((zone) => zone.parentId).filter(isString)
  );
  const generatedParents = new Set(options.smartGeneratedParentIds ?? []);
  const rejectedParents = new Set(options.smartQualityRejectedParentIds ?? []);
  const artifactsByAdm2 = new Map(
    options.barrierArtifacts.map((artifact) => [artifact.manifest.adm2Id, artifact])
  );
  let official = 0;
  let osmAdministrative = 0;
  let smartEligible = 0;
  let inputInsufficient = 0;
  let legacyRequired = 0;

  for (const adm2 of options.adm2Zones) {
    if (officialParents.has(adm2.id)) {
      official += 1;
      continue;
    }

    if (osmParents.has(adm2.id)) {
      osmAdministrative += 1;
      continue;
    }

    const artifact = artifactsByAdm2.get(adm2.id);

    if (artifact?.quality.status === "eligible") {
      smartEligible += 1;
      continue;
    }

    inputInsufficient += 1;
    legacyRequired += 1;
  }

  const smartGenerated = generatedParents.size;
  const smartQualityRejected = rejectedParents.size;
  const accountedAdm2 = official + osmAdministrative + smartEligible + inputInsufficient;

  return {
    schemaVersion: TURKEY_OSM_SMART_COVERAGE_SCHEMA_VERSION,
    adm2Total: options.adm2Zones.length,
    official,
    osmAdministrative,
    smart: {
      eligible: smartEligible,
      generated: smartGenerated,
      qualityRejected: smartQualityRejected,
      inputInsufficient
    },
    legacyRequired: legacyRequired + smartQualityRejected,
    consistency: {
      accountedAdm2,
      ok: accountedAdm2 === options.adm2Zones.length
    }
  };
}

export function readAdm2ZonesFromDataset(input: unknown): TerritoryZone[] {
  if (Array.isArray(input)) {
    return input.filter(isTerritoryZone).filter((zone) => zone.level === 2);
  }

  const dataset = loadTerritoryDataset(input);
  return dataset.zones.filter((zone) => zone.level === 2);
}

export function parseTurkeyOsmSnapshotSourceLock(input: unknown): TurkeyOsmSnapshotSourceLock {
  if (
    !isRecord(input) ||
    input.schemaVersion !== TURKEY_OSM_BARRIER_SNAPSHOT_SOURCE_LOCK_SCHEMA_VERSION
  ) {
    throw new TurkeyOsmBarrierPipelineError(
      "OSM_BARRIER_ARTIFACT_INVALID",
      "Invalid Turkey OSM snapshot source-lock schema."
    );
  }

  return input as unknown as TurkeyOsmSnapshotSourceLock;
}

export class TurkeyOsmBarrierPipelineError extends Error {
  readonly code: TurkeyOsmBarrierIssueCode;
  readonly details?: Record<string, unknown>;

  constructor(code: TurkeyOsmBarrierIssueCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "TurkeyOsmBarrierPipelineError";
    this.code = code;

    if (details) {
      this.details = details;
    }
  }
}

async function downloadTurkeyOsmSnapshot(
  descriptor: OsmSnapshotDescriptor,
  options: TurkeyOsmSnapshotDownloadOptions
): Promise<OsmSnapshotArtifact> {
  validateSnapshotDescriptor(descriptor);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (!fetchImpl) {
    throw new TurkeyOsmBarrierPipelineError(
      "OSM_SNAPSHOT_DOWNLOAD_FAILED",
      "No fetch implementation is available for OSM snapshot acquisition."
    );
  }

  const cacheRoot = options.cacheRoot ?? TURKEY_OSM_BARRIER_DEFAULT_CACHE_ROOT;
  await mkdir(join(cacheRoot, "osm", descriptor.countryCode), { recursive: true });
  const tempPath = join(
    cacheRoot,
    "osm",
    descriptor.countryCode,
    `.download-${Date.now()}-${Math.random().toString(16).slice(2)}.osm.pbf`
  );

  try {
    const response = await fetchImpl(descriptor.downloadUrl);

    if (!response.ok || !response.body) {
      throw new TurkeyOsmBarrierPipelineError(
        "OSM_SNAPSHOT_DOWNLOAD_FAILED",
        `OSM snapshot download failed with HTTP ${response.status}.`
      );
    }

    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(tempPath)
    );
    const fileSizeBytes = (await stat(tempPath)).size;
    const sha256 = await sha256File(tempPath);
    const header = await readPbfHeader(tempPath);
    const downloadedAt = options.downloadedAt ?? new Date().toISOString();
    const snapshotDate =
      header.osmosis_replication_timestamp !== undefined
        ? new Date(header.osmosis_replication_timestamp * 1000).toISOString()
        : response.headers.get("last-modified")
          ? new Date(response.headers.get("last-modified") ?? downloadedAt).toISOString()
          : downloadedAt;
    const snapshotId = `${descriptor.countryCode}-${sha256.slice(0, 16)}`;
    const cacheDir = join(cacheRoot, "osm", descriptor.countryCode, snapshotId);
    const pbfPath = join(cacheDir, descriptor.expectedFileName);
    const sourceLockPath = join(cacheDir, "source-lock.json");
    const sourceLock: TurkeyOsmSnapshotSourceLock = {
      schemaVersion: TURKEY_OSM_BARRIER_SNAPSHOT_SOURCE_LOCK_SCHEMA_VERSION,
      providerId: descriptor.providerId,
      providerName: descriptor.providerName,
      countryCode: descriptor.countryCode,
      sourceUrl: descriptor.sourceUrl,
      downloadUrl: descriptor.downloadUrl,
      sourceDatasetId: descriptor.sourceDatasetId,
      snapshotDate,
      downloadedAt,
      fileSizeBytes,
      sha256,
      license: descriptor.license,
      attribution: descriptor.attribution,
      format: descriptor.format,
      contentAddressedSnapshotId: snapshotId,
      cachePath: pbfPath,
      pbfHeader: {
        ...(header.osmosis_replication_timestamp !== undefined
          ? {
              osmosisReplicationTimestamp: new Date(
                header.osmosis_replication_timestamp * 1000
              ).toISOString()
            }
          : {}),
        ...(header.osmosis_replication_sequence_number !== undefined
          ? { osmosisReplicationSequenceNumber: header.osmosis_replication_sequence_number }
          : {}),
        ...(header.osmosis_replication_base_url
          ? { osmosisReplicationBaseUrl: header.osmosis_replication_base_url }
          : {}),
        ...(header.writingprogram ? { writingProgram: header.writingprogram } : {}),
        ...(header.source ? { source: header.source } : {})
      }
    };

    await mkdir(cacheDir, { recursive: true });
    await rename(tempPath, pbfPath);
    await writeFile(sourceLockPath, serializeJsonStable(sourceLock), "utf8");

    return {
      descriptor,
      sourceLock,
      pbfPath,
      sourceLockPath,
      cacheDir
    };
  } catch (error) {
    await rm(tempPath, { force: true });

    if (error instanceof TurkeyOsmBarrierPipelineError) {
      throw error;
    }

    throw new TurkeyOsmBarrierPipelineError(
      "OSM_SNAPSHOT_DOWNLOAD_FAILED",
      error instanceof Error ? error.message : String(error)
    );
  }
}

function validateSnapshotDescriptor(descriptor: OsmSnapshotDescriptor): void {
  const download = new URL(descriptor.downloadUrl);
  const source = new URL(descriptor.sourceUrl);

  if (download.protocol !== "https:" || source.protocol !== "https:") {
    throw new TurkeyOsmBarrierPipelineError(
      "OSM_SNAPSHOT_SOURCE_UNSUPPORTED",
      "OSM snapshot URLs must use HTTPS."
    );
  }

  if (descriptor.format !== "osm-pbf" || !descriptor.expectedFileName.endsWith(".osm.pbf")) {
    throw new TurkeyOsmBarrierPipelineError(
      "OSM_SNAPSHOT_SOURCE_UNSUPPORTED",
      "Turkey OSM barrier snapshots must use the osm-pbf format."
    );
  }
}

async function readPbfHeader(path: string): Promise<OsmPbfHeaderBlock> {
  const stream = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
  const { header } = await readOsmPbf(stream);
  return header;
}

function createSpatialExtractionFilter(
  adm2Zones: readonly TerritoryZone[],
  paddingDegrees: number
): SpatialExtractionFilter | undefined {
  if (adm2Zones.length === 0) {
    return undefined;
  }

  return {
    bboxes: adm2Zones
      .map((zone) => expandBbox(computeGeometryBBox(zone.geometry), paddingDegrees))
      .sort(compareBboxes)
  };
}

async function collectSpatialCandidateNodes(
  pbfPath: string,
  spatialFilter: SpatialExtractionFilter,
  options: { maxPrimitiveBlocks?: number }
): Promise<SpatialCandidateNodes> {
  const stream = Readable.toWeb(createReadStream(pbfPath)) as ReadableStream<Uint8Array>;
  const { blocks } = await readOsmPbf(stream);
  const nodeIds = new ShardedNumberLookupSet();
  const localitySeeds: TurkeySmartFallbackLocalitySeed[] = [];
  let primitiveBlockCount = 0;

  for await (const block of blocks) {
    for (const group of block.primitivegroup) {
      for (const node of readGroupNodes(block, group)) {
        if (!spatialFilterContainsPoint(spatialFilter, node.coordinate)) {
          continue;
        }

        nodeIds.add(node.id);
        const seed = localitySeedFromNode(node);

        if (seed) {
          localitySeeds.push(seed);
        }
      }
    }

    primitiveBlockCount += 1;

    if (
      options.maxPrimitiveBlocks !== undefined &&
      primitiveBlockCount >= options.maxPrimitiveBlocks
    ) {
      break;
    }
  }

  return { nodeIds, localitySeeds: dedupeLocalitySeeds(localitySeeds) };
}

async function collectTurkeyOsmBarrierInventory(
  pbfPath: string,
  options: { maxPrimitiveBlocks?: number },
  spatialFilter?: SpatialExtractionFilter
): Promise<ParsedPbfInventory> {
  const spatialCandidates = spatialFilter
    ? await collectSpatialCandidateNodes(pbfPath, spatialFilter, options)
    : undefined;
  const stream = Readable.toWeb(createReadStream(pbfPath)) as ReadableStream<Uint8Array>;
  const { blocks } = await readOsmPbf(stream);
  const ways: PendingWay[] = [];
  const relations: PendingRelation[] = [];
  const relationWayIds = new ShardedNumberLookupSet();
  const relationMembers = new Map<number, OsmWay>();
  const localitySeeds: TurkeySmartFallbackLocalitySeed[] = [];
  const neededNodeIds = new ShardedNumberLookupSet();
  let primitiveBlockCount = 0;
  let passes = spatialCandidates ? 2 : 1;

  for await (const block of blocks) {
    for (const group of block.primitivegroup) {
      if (!spatialCandidates) {
        for (const node of readGroupNodes(block, group)) {
          const seed = localitySeedFromNode(node);

          if (seed) {
            localitySeeds.push(seed);
          }
        }
      }

      for (const way of readGroupWays(block, group)) {
        const classification = classifyBarrierTags(way.tags, "way");

        if (
          !classification ||
          (spatialCandidates && !way.refs.some((ref) => spatialCandidates.nodeIds.has(ref)))
        ) {
          continue;
        }

        ways.push({ osmType: "way", id: way.id, refs: way.refs, tags: way.tags, classification });

        for (const ref of way.refs) {
          neededNodeIds.add(ref);
        }
      }

      for (const relation of readGroupRelations(block, group)) {
        const classification = classifyBarrierTags(relation.tags, "relation");

        if (!classification) {
          continue;
        }

        relations.push({
          osmType: "relation",
          id: relation.id,
          members: relation.members,
          tags: relation.tags,
          classification
        });

        for (const member of relation.members) {
          if (member.type === "way") {
            relationWayIds.add(member.ref);
          }
        }
      }
    }

    primitiveBlockCount += 1;

    if (
      options.maxPrimitiveBlocks !== undefined &&
      primitiveBlockCount >= options.maxPrimitiveBlocks
    ) {
      break;
    }
  }

  if (relationWayIds.size > 0) {
    const relationWayInventory = await collectRelationMemberWays(
      pbfPath,
      relationWayIds,
      options,
      spatialCandidates?.nodeIds
    );
    const retainedRelationWayIds = new Set<number>();
    passes += 1;

    for (const way of relationWayInventory) {
      if (
        spatialCandidates &&
        !way.refs.some((ref) => spatialCandidates.nodeIds.has(ref) || neededNodeIds.has(ref))
      ) {
        continue;
      }

      relationMembers.set(way.id, way);
      retainedRelationWayIds.add(way.id);

      for (const ref of way.refs) {
        neededNodeIds.add(ref);
      }
    }

    if (spatialCandidates) {
      relations.splice(
        0,
        relations.length,
        ...relations.filter((relation) =>
          relation.members.some(
            (member) => member.type === "way" && retainedRelationWayIds.has(member.ref)
          )
        )
      );
    }
  }

  return {
    ways,
    relationMembers,
    relations,
    localitySeeds: dedupeLocalitySeeds(
      spatialCandidates ? spatialCandidates.localitySeeds : localitySeeds
    ),
    neededNodeIds,
    primitiveBlockCount,
    passes
  };
}

async function collectRelationMemberWays(
  pbfPath: string,
  wantedWayIds: NumberLookupSet,
  options: { maxPrimitiveBlocks?: number },
  candidateNodeIds?: NumberLookupSet
): Promise<OsmWay[]> {
  const stream = Readable.toWeb(createReadStream(pbfPath)) as ReadableStream<Uint8Array>;
  const { blocks } = await readOsmPbf(stream);
  const ways: OsmWay[] = [];
  let primitiveBlockCount = 0;

  for await (const block of blocks) {
    for (const group of block.primitivegroup) {
      for (const way of readGroupWays(block, group)) {
        if (
          wantedWayIds.has(way.id) &&
          (!candidateNodeIds || way.refs.some((ref) => candidateNodeIds.has(ref)))
        ) {
          ways.push(way);
        }
      }
    }

    primitiveBlockCount += 1;

    if (
      options.maxPrimitiveBlocks !== undefined &&
      primitiveBlockCount >= options.maxPrimitiveBlocks
    ) {
      break;
    }
  }

  return ways;
}

async function collectNeededNodes(
  pbfPath: string,
  neededNodeIds: NumberLookupSet,
  options: { maxPrimitiveBlocks?: number }
): Promise<OsmNodeLookup> {
  const stream = Readable.toWeb(createReadStream(pbfPath)) as ReadableStream<Uint8Array>;
  const { blocks } = await readOsmPbf(stream);
  const nodes = new ShardedOsmNodeLookup();
  let primitiveBlockCount = 0;

  if (neededNodeIds.size === 0) {
    return nodes;
  }

  for await (const block of blocks) {
    for (const group of block.primitivegroup) {
      for (const node of readGroupNodes(block, group)) {
        if (neededNodeIds.has(node.id)) {
          nodes.set(node);
        }
      }
    }

    primitiveBlockCount += 1;

    if (
      options.maxPrimitiveBlocks !== undefined &&
      primitiveBlockCount >= options.maxPrimitiveBlocks
    ) {
      break;
    }
  }

  return nodes;
}

function readGroupNodes(block: OsmPbfBlock, group: OsmPbfGroup): OsmNode[] {
  const granularity = block.granularity ?? 100;
  const latOffset = block.lat_offset ?? 0;
  const lonOffset = block.lon_offset ?? 0;
  const nodes: OsmNode[] = [];

  for (const node of group.nodes) {
    nodes.push({
      id: node.id,
      coordinate: [
        decodeCoordinate(node.lon, granularity, lonOffset),
        decodeCoordinate(node.lat, granularity, latOffset)
      ],
      tags: readTags(block, node.keys, node.vals)
    });
  }

  if (group.dense) {
    let id = 0;
    let lat = 0;
    let lon = 0;
    let keyValueIndex = 0;

    for (let index = 0; index < group.dense.id.length; index += 1) {
      id += group.dense.id[index] ?? 0;
      lat += group.dense.lat[index] ?? 0;
      lon += group.dense.lon[index] ?? 0;
      const tags: Record<string, string> = {};

      while (keyValueIndex < group.dense.keys_vals.length) {
        const key = group.dense.keys_vals[keyValueIndex++] ?? 0;

        if (key === 0) {
          break;
        }

        const value = group.dense.keys_vals[keyValueIndex++] ?? 0;
        tags[stringAt(block, key)] = stringAt(block, value);
      }

      nodes.push({
        id,
        coordinate: [
          decodeCoordinate(lon, granularity, lonOffset),
          decodeCoordinate(lat, granularity, latOffset)
        ],
        tags
      });
    }
  }

  return nodes;
}

function readGroupWays(block: OsmPbfBlock, group: OsmPbfGroup): OsmWay[] {
  return group.ways.map((way) => ({
    id: way.id,
    refs: decodeDeltas(way.refs),
    tags: readTags(block, way.keys, way.vals)
  }));
}

function readGroupRelations(block: OsmPbfBlock, group: OsmPbfGroup): OsmRelation[] {
  return group.relations.map((relation) => {
    const refs = decodeDeltas(relation.memids);

    return {
      id: relation.id,
      tags: readTags(block, relation.keys, relation.vals),
      members: refs.map((ref, index) => ({
        ref,
        type: relationMemberType(relation.types[index] ?? 0),
        role: stringAt(block, relation.roles_sid[index] ?? 0)
      }))
    };
  });
}

function readTags(
  block: OsmPbfBlock,
  keys: readonly number[],
  vals: readonly number[]
): Record<string, string> {
  const tags: Record<string, string> = {};

  for (let index = 0; index < keys.length; index += 1) {
    tags[stringAt(block, keys[index] ?? 0)] = stringAt(block, vals[index] ?? 0);
  }

  return tags;
}

function stringAt(block: OsmPbfBlock, index: number): string {
  return textDecoder.decode(block.stringtable[index] ?? new Uint8Array());
}

function decodeDeltas(values: readonly number[]): number[] {
  let current = 0;

  return values.map((value) => {
    current += value;
    return current;
  });
}

function decodeCoordinate(value: number, granularity: number, offset: number): number {
  return roundCoordinate((offset + granularity * value) / 1_000_000_000);
}

function relationMemberType(value: number): "node" | "way" | "relation" {
  if (value === 1) {
    return "way";
  }

  if (value === 2) {
    return "relation";
  }

  return "node";
}

function localitySeedFromNode(node: OsmNode): TurkeySmartFallbackLocalitySeed | undefined {
  const place = node.tags.place;

  if (!isLocalityPlace(place)) {
    return undefined;
  }

  const name = node.tags.name ?? node.tags["name:tr"] ?? node.tags["name:en"];

  if (!name) {
    return undefined;
  }

  const type = normalizeLocalityPlace(place);

  return {
    id: `osm:node:${node.id}`,
    name,
    coordinate: node.coordinate,
    type,
    source: "openstreetmap",
    sourceId: `osm:node:${node.id}`,
    authoritative: false,
    confidence: place === "neighbourhood" || place === "quarter" ? 0.72 : 0.58
  };
}

function classifyBarrierTags(
  tags: Record<string, string>,
  osmType: "way" | "relation"
): ClassifiedBarrier | undefined {
  const highway = tags.highway;

  if (osmType === "way" && isRoadTag(highway)) {
    return {
      layer: "roads",
      geometryKind: "line",
      barrierClass: "road",
      strength: roadStrength(highway)
    };
  }

  const railway = tags.railway;

  if (osmType === "way" && isRailwayTag(railway)) {
    return {
      layer: "railways",
      geometryKind: "line",
      barrierClass: "rail",
      strength: railwayStrength(railway)
    };
  }

  const waterway = tags.waterway;
  const natural = tags.natural;
  const water = tags.water;

  if (osmType === "way" && isWaterwayTag(waterway)) {
    return {
      layer: "water",
      geometryKind: "line",
      barrierClass: "water",
      strength: waterwayStrength(waterway)
    };
  }

  if (osmType === "way" && natural === "coastline") {
    return {
      layer: "water",
      geometryKind: "line",
      barrierClass: "coastline",
      strength: 1
    };
  }

  if (natural === "water" || isWaterTag(water)) {
    return {
      layer: "water",
      geometryKind: "polygon",
      barrierClass: "water",
      strength: water === "reservoir" ? 0.85 : 0.9
    };
  }

  const leisure = tags.leisure;

  if (isLeisureTag(leisure)) {
    return {
      layer: "parks",
      geometryKind: "polygon",
      barrierClass: "park",
      strength: leisure === "nature_reserve" ? 0.75 : 0.65
    };
  }

  const landuse = tags.landuse;

  if (isLanduseTag(landuse) || natural === "wood") {
    return {
      layer: "landuse",
      geometryKind: "polygon",
      barrierClass: landuse === "forest" || natural === "wood" ? "forest" : "park",
      strength: landuse === "industrial" ? 0.5 : landuse === "cemetery" ? 0.45 : 0.7
    };
  }

  return undefined;
}

function wayGeometry(way: PendingWay, nodes: OsmNodeLookup): Geometry | undefined {
  const coordinates = refsToCoordinates(way.refs, nodes);

  if (coordinates.length < 2) {
    return undefined;
  }

  if (way.classification.geometryKind === "polygon") {
    const ring = normalizeRing(coordinates);

    if (ring.length < 4 || !ringHasArea(ring)) {
      return undefined;
    }

    return { type: "Polygon", coordinates: [ring] };
  }

  return { type: "LineString", coordinates: normalizeLineCoordinates(coordinates) };
}

function relationGeometry(
  relation: PendingRelation,
  ways: ReadonlyMap<number, OsmWay>,
  nodes: OsmNodeLookup
): Geometry | undefined {
  if (relation.classification.geometryKind !== "polygon") {
    return undefined;
  }

  const rings = relation.members
    .filter((member) => member.type === "way" && (member.role === "outer" || member.role === ""))
    .flatMap((member) => {
      const way = ways.get(member.ref);

      if (!way) {
        return [];
      }

      const ring = normalizeRing(refsToCoordinates(way.refs, nodes));
      return ring.length >= 4 && ringHasArea(ring) ? [ring] : [];
    });

  if (rings.length === 0) {
    return undefined;
  }

  if (rings.length === 1) {
    return { type: "Polygon", coordinates: [rings[0]!] };
  }

  return { type: "MultiPolygon", coordinates: rings.map((ring) => [ring]) };
}

function refsToCoordinates(refs: readonly number[], nodes: OsmNodeLookup): LngLat[] {
  const coordinates: LngLat[] = [];

  for (const ref of refs) {
    const node = nodes.get(ref);

    if (!node) {
      return [];
    }

    coordinates.push(node.coordinate);
  }

  return coordinates;
}

function pushBarrierFeature(
  collection: FeatureCollection,
  input: {
    osmType: "way" | "relation";
    osmId: number;
    tags: Record<string, string>;
    classification: ClassifiedBarrier;
    geometry: Geometry;
  }
): void {
  const sourceNativeId = `osm:${input.osmType}:${input.osmId}`;
  const properties: TurkeyOsmBarrierFeatureProperties = {
    ...Object.fromEntries(
      Object.entries(input.tags)
        .filter(([, value]) => value !== undefined && value !== "")
        .sort(([left], [right]) => left.localeCompare(right))
    ),
    "@id": sourceNativeId,
    osm_id: String(input.osmId),
    osm_type: input.osmType,
    barrierLayer: input.classification.layer,
    barrierClass: input.classification.barrierClass,
    barrierStrength: String(roundMetric(input.classification.strength)),
    source: "openstreetmap",
    sourceProvider: TURKEY_OSM_BARRIER_PROVIDER_ID
  };

  collection.features.push({
    type: "Feature",
    id: sourceNativeId,
    properties,
    geometry: input.geometry
  });
}

function buildAdm2BarrierArtifact(input: {
  adm2: TerritoryZone;
  normalized: TurkeyOsmNormalizedBarriers;
  generatedAt: string;
}): TurkeyOsmAdm2BarrierArtifact {
  const roads = clipFeatureCollectionToAdm2(input.normalized.roads, input.adm2);
  const railways = clipFeatureCollectionToAdm2(input.normalized.railways, input.adm2);
  const water = clipFeatureCollectionToAdm2(input.normalized.water, input.adm2);
  const landuse = clipFeatureCollectionToAdm2(input.normalized.landuse, input.adm2);
  const parks = clipFeatureCollectionToAdm2(input.normalized.parks, input.adm2);
  const localitySeeds = input.normalized.localitySeeds
    .filter((seed) => geometryContainsPoint(input.adm2.geometry, seed.coordinate))
    .sort(compareLocalitySeeds);
  const quality = createQualityReport({
    adm2Id: input.adm2.id,
    roads,
    railways,
    water,
    landuse,
    parks,
    localitySeeds
  });
  const hashes = {
    roads: sha256Hex(serializeJsonStable(roads)),
    railways: sha256Hex(serializeJsonStable(railways)),
    water: sha256Hex(serializeJsonStable(water)),
    landuse: sha256Hex(serializeJsonStable(landuse)),
    parks: sha256Hex(serializeJsonStable(parks)),
    localitySeeds: sha256Hex(serializeJsonStable(localitySeeds)),
    quality: sha256Hex(serializeJsonStable(quality))
  };
  const manifestWithoutChecksum = {
    schemaVersion: TURKEY_OSM_BARRIER_ARTIFACT_SCHEMA_VERSION,
    countryCode: "TR" as const,
    adm2Id: input.adm2.id,
    algorithmVersion: TURKEY_OSM_BARRIER_ALGORITHM_VERSION,
    generatedAt: input.generatedAt,
    source: {
      providerId: input.normalized.sourceLock.providerId,
      providerName: input.normalized.sourceLock.providerName,
      sourceUrl: input.normalized.sourceLock.sourceUrl,
      sourceDatasetId: input.normalized.sourceLock.sourceDatasetId,
      snapshotSha256: input.normalized.sourceLock.sha256,
      snapshotDate: input.normalized.sourceLock.snapshotDate,
      license: input.normalized.sourceLock.license,
      attribution: input.normalized.sourceLock.attribution,
      format: input.normalized.sourceLock.format
    },
    counts: {
      roads: roads.features.length,
      railways: railways.features.length,
      water: water.features.length,
      landuse: landuse.features.length,
      parks: parks.features.length,
      localitySeeds: localitySeeds.length
    },
    hashes,
    sourceSnapshotChecksum: input.normalized.sourceLock.sha256
  };
  const artifactChecksum = sha256Hex(
    serializeJsonStable({
      manifest: manifestWithoutChecksum,
      roads,
      railways,
      water,
      landuse,
      parks,
      localitySeeds
    })
  );
  const manifest: TurkeyOsmBarrierManifest = {
    ...manifestWithoutChecksum,
    artifactChecksum
  };

  return {
    manifest,
    quality,
    roads,
    railways,
    water,
    landuse,
    parks,
    localitySeeds
  };
}

function clipFeatureCollectionToAdm2(
  collection: FeatureCollection,
  adm2: TerritoryZone
): FeatureCollection {
  const adm2Bbox = computeGeometryBBox(adm2.geometry);
  const features = collection.features
    .filter(
      (feature) => feature.geometry && bboxesIntersect(geometryBBox(feature.geometry), adm2Bbox)
    )
    .flatMap((feature) => clipFeatureToAdm2(feature, adm2))
    .sort(compareFeatures);

  return {
    type: "FeatureCollection",
    features
  };
}

function clipFeatureToAdm2(feature: Feature, adm2: TerritoryZone): Feature[] {
  if (!feature.geometry) {
    return [];
  }

  const geometry = clipGeometryToAdm2(feature.geometry, adm2.geometry);

  if (!geometry) {
    return [];
  }

  return [
    {
      type: "Feature",
      id: feature.id,
      properties: normalizeGeoJsonProperties(feature.properties),
      geometry
    }
  ];
}

function clipGeometryToAdm2(
  geometry: Geometry,
  adm2Geometry: TerritoryGeometry
): Geometry | undefined {
  if (geometry.type === "LineString") {
    return clippedLinesToGeometry(
      clipLinePathToGeometry(geometry.coordinates as LngLat[], adm2Geometry)
    );
  }

  if (geometry.type === "MultiLineString") {
    return clippedLinesToGeometry(
      (geometry.coordinates as LngLat[][]).flatMap((path) =>
        clipLinePathToGeometry(path, adm2Geometry)
      )
    );
  }

  if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
    const clipped = intersectClippingGeometries(
      toClippingMultiPolygon(geometry as TerritoryGeometry),
      toClippingMultiPolygon(adm2Geometry)
    );
    return clippingMultiPolygonToGeoJsonGeometry(clipped);
  }

  return undefined;
}

function clipLinePathToGeometry(path: readonly LngLat[], geometry: TerritoryGeometry): LngLat[][] {
  const normalized = normalizeLineCoordinates(path);
  const output: LngLat[][] = [];
  let current: LngLat[] = [];

  for (let index = 1; index < normalized.length; index += 1) {
    const a = normalized[index - 1];
    const b = normalized[index];

    if (!a || !b || pointsEqual(a, b)) {
      continue;
    }

    const pieces = clipSegmentToGeometry(a, b, geometry);

    for (const piece of pieces) {
      const previous = current[current.length - 1];

      if (!previous || !pointsEqual(previous, piece[0])) {
        if (current.length >= 2) {
          output.push(current);
        }

        current = [piece[0], piece[1]];
      } else {
        current.push(piece[1]);
      }
    }
  }

  if (current.length >= 2) {
    output.push(current);
  }

  return output.map(normalizeLineCoordinates).filter((line) => line.length >= 2);
}

function clipSegmentToGeometry(
  a: LngLat,
  b: LngLat,
  geometry: TerritoryGeometry
): Array<[LngLat, LngLat]> {
  const ts = [0, 1, ...segmentIntersectionParameters(a, b, geometry)]
    .filter((value) => value >= -1e-10 && value <= 1 + 1e-10)
    .map((value) => Math.min(1, Math.max(0, value)))
    .sort((left, right) => left - right);
  const unique = uniqueNumbers(ts);
  const pieces: Array<[LngLat, LngLat]> = [];

  for (let index = 1; index < unique.length; index += 1) {
    const start = unique[index - 1] ?? 0;
    const end = unique[index] ?? 1;

    if (end - start < 1e-10) {
      continue;
    }

    const mid = interpolate(a, b, (start + end) / 2);
    const startPoint = interpolate(a, b, start);
    const endPoint = interpolate(a, b, end);

    if (
      geometryContainsPoint(geometry, mid) &&
      geometryContainsPoint(geometry, startPoint) &&
      geometryContainsPoint(geometry, endPoint)
    ) {
      pieces.push([startPoint, endPoint]);
    }
  }

  return pieces;
}

function segmentIntersectionParameters(
  a: LngLat,
  b: LngLat,
  geometry: TerritoryGeometry
): number[] {
  const parameters: number[] = [];

  for (const polygon of geometryToPolygons(geometry)) {
    for (const ring of polygon) {
      for (let index = 1; index < ring.length; index += 1) {
        const c = ring[index - 1];
        const d = ring[index];

        if (!c || !d) {
          continue;
        }

        const t = segmentIntersectionParameter(a, b, c, d);

        if (t !== undefined) {
          parameters.push(t);
        }
      }
    }
  }

  return parameters;
}

function segmentIntersectionParameter(
  a: LngLat,
  b: LngLat,
  c: LngLat,
  d: LngLat
): number | undefined {
  const r: LngLat = [b[0] - a[0], b[1] - a[1]];
  const s: LngLat = [d[0] - c[0], d[1] - c[1]];
  const denominator = cross(r[0], r[1], s[0], s[1]);

  if (Math.abs(denominator) < 1e-12) {
    return undefined;
  }

  const qMinusP: LngLat = [c[0] - a[0], c[1] - a[1]];
  const t = cross(qMinusP[0], qMinusP[1], s[0], s[1]) / denominator;
  const u = cross(qMinusP[0], qMinusP[1], r[0], r[1]) / denominator;

  if (t >= -1e-10 && t <= 1 + 1e-10 && u >= -1e-10 && u <= 1 + 1e-10) {
    return t;
  }

  return undefined;
}

function clippedLinesToGeometry(
  lines: readonly LngLat[][]
): LineString | MultiLineString | undefined {
  const normalized = lines.map(normalizeLineCoordinates).filter((line) => line.length >= 2);

  if (normalized.length === 0) {
    return undefined;
  }

  if (normalized.length === 1) {
    return { type: "LineString", coordinates: normalized[0]! };
  }

  return { type: "MultiLineString", coordinates: normalized };
}

function createQualityReport(input: {
  adm2Id: string;
  roads: FeatureCollection;
  railways: FeatureCollection;
  water: FeatureCollection;
  landuse: FeatureCollection;
  parks: FeatureCollection;
  localitySeeds: readonly TurkeySmartFallbackLocalitySeed[];
}): TurkeyOsmBarrierQualityReport {
  const majorRoadCount = input.roads.features.filter((feature) => {
    const highway = feature.properties?.highway;
    return typeof highway === "string" && roadStrength(highway) >= 0.45;
  }).length;
  const barrierLengthKm = roundMetric(
    collectionLengthKm(input.roads) +
      collectionLengthKm(input.railways) +
      collectionLengthKm(input.water) +
      collectionLengthKm(input.landuse) +
      collectionLengthKm(input.parks)
  );
  const majorBarrierLengthKm = roundMetric(
    collectionLengthKm(input.roads, 0.45) +
      collectionLengthKm(input.railways, 0.35) +
      collectionLengthKm(input.water, 0.55)
  );
  const coverageConfidence = roundMetric(
    Math.min(
      1,
      majorBarrierLengthKm / 2.5 +
        Math.min(0.25, input.localitySeeds.length * 0.05) +
        Math.min(0.25, input.roads.features.length * 0.02)
    )
  );
  const eligible =
    majorRoadCount >= 2 ||
    majorBarrierLengthKm >= 1 ||
    (input.localitySeeds.length >= 2 && input.roads.features.length >= 2);
  const issues: TurkeyOsmBarrierIssue[] = eligible
    ? []
    : [
        {
          code: "OSM_BARRIER_INPUT_INSUFFICIENT",
          severity: "warning",
          message: "OSM barrier input is too sparse for automatic smart-derived ADM3 generation.",
          adm2Id: input.adm2Id,
          details: {
            majorRoadCount,
            majorBarrierLengthKm,
            localitySeedCount: input.localitySeeds.length
          }
        }
      ];

  return {
    schemaVersion: TURKEY_OSM_BARRIER_QUALITY_SCHEMA_VERSION,
    adm2Id: input.adm2Id,
    ok: eligible,
    status: eligible ? "eligible" : "input-insufficient",
    roadFeatureCount: input.roads.features.length,
    majorRoadCount,
    railFeatureCount: input.railways.features.length,
    waterFeatureCount: input.water.features.length,
    parkFeatureCount: input.parks.features.length,
    landuseFeatureCount: input.landuse.features.length,
    localitySeedCount: input.localitySeeds.length,
    barrierLengthKm,
    majorBarrierLengthKm,
    inputCoverageConfidence: coverageConfidence,
    issues
  };
}

async function writeAdm2BarrierArtifact(
  target: string,
  artifact: TurkeyOsmAdm2BarrierArtifact
): Promise<void> {
  await mkdir(target, { recursive: true });
  await Promise.all([
    writeJsonFile(join(target, "manifest.json"), artifact.manifest),
    writeJsonFile(join(target, "quality.json"), artifact.quality),
    writeJsonFile(join(target, "roads.geojson"), artifact.roads),
    writeJsonFile(join(target, "railways.geojson"), artifact.railways),
    writeJsonFile(join(target, "water.geojson"), artifact.water),
    writeJsonFile(join(target, "landuse.geojson"), artifact.landuse),
    writeJsonFile(join(target, "parks.geojson"), artifact.parks),
    writeJsonFile(join(target, "locality-seeds.json"), artifact.localitySeeds)
  ]);
}

async function readReusableArtifact(
  adm2: TerritoryZone,
  outputRoot: string,
  sourceLock: TurkeyOsmSnapshotSourceLock
): Promise<TurkeyOsmAdm2BarrierArtifact | undefined> {
  try {
    const artifact = await readTurkeyOsmAdm2BarrierArtifact(outputRoot, adm2.id);
    const reusable =
      artifact.manifest.algorithmVersion === TURKEY_OSM_BARRIER_ALGORITHM_VERSION &&
      artifact.manifest.sourceSnapshotChecksum === sourceLock.sha256 &&
      artifact.manifest.adm2Id === adm2.id;

    return reusable ? artifact : undefined;
  } catch {
    return undefined;
  }
}

function normalizeBarrierCollections(
  collections: Record<TurkeyOsmBarrierLayer, FeatureCollection>
): Record<TurkeyOsmBarrierLayer, FeatureCollection> {
  return {
    roads: normalizeFeatureCollection(collections.roads),
    railways: normalizeFeatureCollection(collections.railways),
    water: normalizeFeatureCollection(collections.water),
    landuse: normalizeFeatureCollection(collections.landuse),
    parks: normalizeFeatureCollection(collections.parks)
  };
}

function normalizeFeatureCollection(collection: FeatureCollection): FeatureCollection {
  const features: Feature[] = [];

  for (const feature of collection.features) {
    const geometry = normalizeGeoJsonGeometry(feature.geometry);

    if (!geometry) {
      continue;
    }

    features.push({
      type: "Feature",
      ...(feature.id !== undefined ? { id: feature.id } : {}),
      properties: normalizeGeoJsonProperties(feature.properties),
      geometry
    });
  }

  return {
    type: "FeatureCollection",
    features: features.sort(compareFeatures)
  };
}

function normalizeGeoJsonGeometry(geometry: Geometry | null): Geometry | null {
  if (!geometry) {
    return null;
  }

  if (geometry.type === "LineString") {
    return {
      type: "LineString",
      coordinates: normalizeLineCoordinates(geometry.coordinates as LngLat[])
    };
  }

  if (geometry.type === "MultiLineString") {
    return {
      type: "MultiLineString",
      coordinates: (geometry.coordinates as LngLat[][])
        .map(normalizeLineCoordinates)
        .filter((line) => line.length >= 2)
        .sort(compareLines)
    };
  }

  if (geometry.type === "Polygon") {
    const clipped = clippingMultiPolygonToGeoJsonGeometry(
      toClippingMultiPolygon(geometry as Polygon)
    );
    return clipped ?? null;
  }

  if (geometry.type === "MultiPolygon") {
    const clipped = clippingMultiPolygonToGeoJsonGeometry(
      toClippingMultiPolygon(geometry as MultiPolygon)
    );
    return clipped ?? null;
  }

  return null;
}

function normalizeGeoJsonProperties(properties: GeoJsonProperties): Record<string, string> {
  if (!properties) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(properties)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(
        ([key, value]) =>
          [key, Array.isArray(value) ? String(value[0] ?? "") : String(value)] satisfies [
            string,
            string
          ]
      )
      .sort((left, right) => left[0].localeCompare(right[0]))
  );
}

function createEmptyBarrierCollections(): Record<TurkeyOsmBarrierLayer, FeatureCollection> {
  return {
    roads: { type: "FeatureCollection", features: [] },
    railways: { type: "FeatureCollection", features: [] },
    water: { type: "FeatureCollection", features: [] },
    landuse: { type: "FeatureCollection", features: [] },
    parks: { type: "FeatureCollection", features: [] }
  };
}

function sourceLockToDescriptor(sourceLock: TurkeyOsmSnapshotSourceLock): OsmSnapshotDescriptor {
  return {
    providerId: sourceLock.providerId,
    providerName: sourceLock.providerName,
    countryCode: sourceLock.countryCode,
    sourceUrl: sourceLock.sourceUrl,
    downloadUrl: sourceLock.downloadUrl,
    sourceDatasetId: sourceLock.sourceDatasetId,
    format: sourceLock.format,
    license: sourceLock.license,
    attribution: sourceLock.attribution,
    expectedFileName: basename(sourceLock.cachePath) || "turkey.osm.pbf"
  };
}

function selectAdm2Zones(
  adm2Zones: readonly TerritoryZone[],
  options: { adm2Ids?: readonly string[]; maxDistricts?: number }
): TerritoryZone[] {
  const ids = new Set(options.adm2Ids ?? []);
  const selected = adm2Zones
    .filter((zone) => ids.size === 0 || ids.has(zone.id))
    .sort((left, right) => left.id.localeCompare(right.id));

  return options.maxDistricts !== undefined ? selected.slice(0, options.maxDistricts) : selected;
}

function createOsmExtractionBatches(adm2Zones: readonly TerritoryZone[]): TerritoryZone[][] {
  const batchesByProvince = new Map<string, TerritoryZone[]>();
  const fallbackZones: TerritoryZone[] = [];

  for (const zone of adm2Zones) {
    const provinceCode = readAdm2ProvinceCode(zone);

    if (!provinceCode) {
      fallbackZones.push(zone);
      continue;
    }

    batchesByProvince.set(provinceCode, [...(batchesByProvince.get(provinceCode) ?? []), zone]);
  }

  const provinceBatches = [...batchesByProvince.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, zones]) => zones.sort(compareAdm2Zones));
  const fallbackBatches = chunk(
    fallbackZones.sort(compareAdm2Zones),
    TURKEY_OSM_EXTRACTION_FALLBACK_BATCH_SIZE
  );

  return [...provinceBatches, ...fallbackBatches];
}

function readAdm2ProvinceCode(zone: TerritoryZone): string | undefined {
  const properties = isRecord(zone.properties) ? zone.properties : undefined;
  const territory = properties && isRecord(properties.territory) ? properties.territory : undefined;
  const value = territory?.provinceCode;

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function compareAdm2Zones(left: TerritoryZone, right: TerritoryZone): number {
  return left.id.localeCompare(right.id);
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function artifactDirectory(outputRoot: string, adm2Id: string): string {
  return join(outputRoot, "ADM2", safePathPart(adm2Id));
}

function safePathPart(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");

  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function writeJsonFile(path: string, input: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeJsonStable(input), "utf8");
}

async function directorySizeBytes(path: string): Promise<number> {
  const files = [
    "manifest.json",
    "quality.json",
    "roads.geojson",
    "railways.geojson",
    "water.geojson",
    "landuse.geojson",
    "parks.geojson",
    "locality-seeds.json"
  ];
  const sizes = await Promise.all(
    files.map(async (file) => {
      try {
        return (await stat(join(path, file))).size;
      } catch {
        return 0;
      }
    })
  );
  return sizes.reduce((total, size) => total + size, 0);
}

function parseTurkeyOsmBarrierManifest(input: unknown): TurkeyOsmBarrierManifest {
  if (!isRecord(input) || input.schemaVersion !== TURKEY_OSM_BARRIER_ARTIFACT_SCHEMA_VERSION) {
    throw new TurkeyOsmBarrierPipelineError(
      "OSM_BARRIER_ARTIFACT_INVALID",
      "Invalid Turkey OSM barrier manifest schema."
    );
  }

  return input as unknown as TurkeyOsmBarrierManifest;
}

function parseTurkeyOsmBarrierQuality(input: unknown): TurkeyOsmBarrierQualityReport {
  if (!isRecord(input) || input.schemaVersion !== TURKEY_OSM_BARRIER_QUALITY_SCHEMA_VERSION) {
    throw new TurkeyOsmBarrierPipelineError(
      "OSM_BARRIER_ARTIFACT_INVALID",
      "Invalid Turkey OSM barrier quality schema."
    );
  }

  return input as unknown as TurkeyOsmBarrierQualityReport;
}

function parseFeatureCollection(input: unknown): FeatureCollection {
  if (!isRecord(input) || input.type !== "FeatureCollection" || !Array.isArray(input.features)) {
    throw new TurkeyOsmBarrierPipelineError(
      "OSM_BARRIER_ARTIFACT_INVALID",
      "Invalid OSM barrier FeatureCollection."
    );
  }

  return input as unknown as FeatureCollection;
}

function parseLocalitySeeds(input: unknown): TurkeySmartFallbackLocalitySeed[] {
  if (!Array.isArray(input)) {
    throw new TurkeyOsmBarrierPipelineError(
      "OSM_BARRIER_ARTIFACT_INVALID",
      "Invalid OSM locality seed artifact."
    );
  }

  return input as TurkeySmartFallbackLocalitySeed[];
}

function collectionLengthKm(collection: FeatureCollection, minimumStrength = 0): number {
  return collection.features.reduce((total, feature) => {
    const strength = Number(feature.properties?.barrierStrength ?? 0);

    if (strength < minimumStrength) {
      return total;
    }

    return total + geometryLengthKm(feature.geometry);
  }, 0);
}

function geometryLengthKm(geometry: Geometry | null): number {
  if (!geometry) {
    return 0;
  }

  if (geometry.type === "LineString") {
    return lineLengthKm(geometry.coordinates as LngLat[]);
  }

  if (geometry.type === "MultiLineString") {
    return (geometry.coordinates as LngLat[][]).reduce(
      (total, line) => total + lineLengthKm(line),
      0
    );
  }

  if (geometry.type === "Polygon") {
    return (geometry.coordinates as LngLat[][]).reduce(
      (total, ring) => total + lineLengthKm(ring),
      0
    );
  }

  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as LngLat[][][]).reduce(
      (total, polygon) =>
        total + polygon.reduce((polygonTotal, ring) => polygonTotal + lineLengthKm(ring), 0),
      0
    );
  }

  return 0;
}

function lineLengthKm(coordinates: readonly LngLat[]): number {
  let total = 0;

  for (let index = 1; index < coordinates.length; index += 1) {
    const a = coordinates[index - 1];
    const b = coordinates[index];

    if (a && b) {
      total += haversineKm(a, b);
    }
  }

  return total;
}

function geometryContainsPoint(geometry: TerritoryGeometry, point: LngLat): boolean {
  const bbox = computeGeometryBBox(geometry);

  if (point[0] < bbox[0] || point[0] > bbox[2] || point[1] < bbox[1] || point[1] > bbox[3]) {
    return false;
  }

  return geometryToPolygons(geometry).some((polygon) => polygonContainsPoint(polygon, point));
}

function polygonContainsPoint(polygon: readonly LngLat[][], point: LngLat): boolean {
  const [shell, ...holes] = polygon;

  if (!shell || !ringContainsPoint(shell, point)) {
    return false;
  }

  return !holes.some((hole) => ringContainsPoint(hole, point));
}

function ringContainsPoint(ring: readonly LngLat[], point: LngLat): boolean {
  let inside = false;
  const [x, y] = point;

  for (
    let index = 0, lastIndex = ring.length - 1;
    index < ring.length;
    lastIndex = index, index += 1
  ) {
    const current = ring[index];
    const previous = ring[lastIndex];

    if (!current || !previous) {
      continue;
    }

    if (pointOnSegment(point, previous, current)) {
      return true;
    }

    const intersects =
      current[1] > y !== previous[1] > y &&
      x < ((previous[0] - current[0]) * (y - current[1])) / (previous[1] - current[1]) + current[0];

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function pointOnSegment(point: LngLat, a: LngLat, b: LngLat): boolean {
  const crossProduct = cross(b[0] - a[0], b[1] - a[1], point[0] - a[0], point[1] - a[1]);

  if (Math.abs(crossProduct) > 1e-10) {
    return false;
  }

  const dot = (point[0] - a[0]) * (b[0] - a[0]) + (point[1] - a[1]) * (b[1] - a[1]);

  if (dot < -1e-10) {
    return false;
  }

  const squaredLength = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
  return dot <= squaredLength + 1e-10;
}

function toClippingMultiPolygon(geometry: TerritoryGeometry): ClippingMultiPolygon {
  return canonicalizeClippingGeometry(
    geometryToPolygons(geometry)
      .map((polygon) => {
        const rings = polygon
          .map(normalizeRing)
          .filter((ring) => ring.length >= 4 && ringHasArea(ring));
        return rings.length > 0 ? (rings as ClippingPolygon) : undefined;
      })
      .filter((polygon): polygon is ClippingPolygon => Boolean(polygon))
  );
}

function clippingMultiPolygonToGeoJsonGeometry(
  geometry: ClippingMultiPolygon
): Polygon | MultiPolygon | undefined {
  const polygons = canonicalizeClippingGeometry(geometry)
    .map((polygon) =>
      polygon.map(normalizeRing).filter((ring) => ring.length >= 4 && ringHasArea(ring))
    )
    .filter((polygon) => polygon.length > 0);

  if (polygons.length === 0) {
    return undefined;
  }

  if (polygons.length === 1) {
    return { type: "Polygon", coordinates: polygons[0]! };
  }

  return { type: "MultiPolygon", coordinates: polygons };
}

function intersectClippingGeometries(
  left: ClippingMultiPolygon,
  right: ClippingMultiPolygon
): ClippingMultiPolygon {
  if (left.length === 0 || right.length === 0) {
    return [];
  }

  try {
    return canonicalizeClippingGeometry(CLIPPER.intersection(left, right));
  } catch {
    return [];
  }
}

function canonicalizeClippingGeometry(geometry: ClippingMultiPolygon): ClippingMultiPolygon {
  return geometry
    .map((polygon) =>
      polygon
        .map((ring, ringIndex) => canonicalizeRing(ring, ringIndex > 0))
        .filter((ring) => ring.length >= 4)
        .sort((left, right) => signedRingArea(right) - signedRingArea(left))
    )
    .filter((polygon) => polygon.length > 0)
    .sort(compareClippingPolygons);
}

function canonicalizeRing(ring: readonly LngLat[], hole: boolean): LngLat[] {
  const normalized = normalizeRing(ring);
  const open = normalized.slice(0, -1);

  if (open.length === 0) {
    return [];
  }

  const oriented =
    signedRingArea([...open, open[0]!]) < 0 !== hole ? [...open].reverse() : [...open];
  const startIndex = oriented.reduce((best, point, index) => {
    const current = oriented[best]!;
    return point[0] < current[0] || (point[0] === current[0] && point[1] < current[1])
      ? index
      : best;
  }, 0);
  const rotated = [...oriented.slice(startIndex), ...oriented.slice(0, startIndex)];
  rotated.push(rotated[0]!);
  return rotated;
}

function normalizeRing(ring: readonly (readonly [number, number])[]): LngLat[] {
  const coordinates = ring
    .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
    .map((point) => [roundCoordinate(point[0]), roundCoordinate(point[1])] satisfies LngLat);
  const deduped: LngLat[] = [];

  for (const coordinate of coordinates) {
    const previous = deduped[deduped.length - 1];

    if (!previous || !pointsEqual(previous, coordinate)) {
      deduped.push(coordinate);
    }
  }

  if (deduped.length === 0) {
    return [];
  }

  const first = deduped[0]!;
  const last = deduped[deduped.length - 1]!;

  if (!pointsEqual(first, last)) {
    deduped.push([...first]);
  }

  return deduped;
}

function normalizeLineCoordinates(coordinates: readonly LngLat[]): LngLat[] {
  const deduped: LngLat[] = [];

  for (const point of coordinates) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
      continue;
    }

    const normalized = [roundCoordinate(point[0]), roundCoordinate(point[1])] satisfies LngLat;
    const previous = deduped[deduped.length - 1];

    if (!previous || !pointsEqual(previous, normalized)) {
      deduped.push(normalized);
    }
  }

  return deduped;
}

function geometryBBox(geometry: Geometry | null): TerritoryBBox {
  if (!geometry) {
    return [0, 0, 0, 0];
  }

  const coordinates = collectCoordinates(geometry);
  const lngs = coordinates.map((point) => point[0]);
  const lats = coordinates.map((point) => point[1]);

  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

function collectCoordinates(geometry: Geometry): LngLat[] {
  if (geometry.type === "Point") {
    return [geometry.coordinates as LngLat];
  }

  if (geometry.type === "MultiPoint" || geometry.type === "LineString") {
    return geometry.coordinates as LngLat[];
  }

  if (geometry.type === "MultiLineString" || geometry.type === "Polygon") {
    return (geometry.coordinates as LngLat[][]).flat();
  }

  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as LngLat[][][]).flat(2);
  }

  if (geometry.type === "GeometryCollection") {
    return geometry.geometries.flatMap(collectCoordinates);
  }

  return [];
}

function bboxesIntersect(left: TerritoryBBox, right: TerritoryBBox): boolean {
  return left[0] <= right[2] && left[2] >= right[0] && left[1] <= right[3] && left[3] >= right[1];
}

function spatialFilterContainsPoint(filter: SpatialExtractionFilter, point: LngLat): boolean {
  return filter.bboxes.some(
    (bbox) =>
      point[0] >= bbox[0] && point[0] <= bbox[2] && point[1] >= bbox[1] && point[1] <= bbox[3]
  );
}

function expandBbox(bbox: TerritoryBBox, paddingDegrees: number): TerritoryBBox {
  return [
    roundCoordinate(bbox[0] - paddingDegrees),
    roundCoordinate(bbox[1] - paddingDegrees),
    roundCoordinate(bbox[2] + paddingDegrees),
    roundCoordinate(bbox[3] + paddingDegrees)
  ];
}

function compareBboxes(left: TerritoryBBox, right: TerritoryBBox): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2] || left[3] - right[3];
}

function compareFeatures(left: Feature, right: Feature): number {
  return (
    String(left.id ?? "").localeCompare(String(right.id ?? "")) ||
    serializeJsonStable(left.properties ?? {}).localeCompare(
      serializeJsonStable(right.properties ?? {})
    ) ||
    serializeJsonStable(left.geometry).localeCompare(serializeJsonStable(right.geometry))
  );
}

function comparePendingWays(left: PendingWay, right: PendingWay): number {
  return (
    left.id - right.id ||
    serializeJsonStable(left.tags).localeCompare(serializeJsonStable(right.tags))
  );
}

function comparePendingRelations(left: PendingRelation, right: PendingRelation): number {
  return (
    left.id - right.id ||
    serializeJsonStable(left.tags).localeCompare(serializeJsonStable(right.tags))
  );
}

function compareLocalitySeeds(
  left: TurkeySmartFallbackLocalitySeed,
  right: TurkeySmartFallbackLocalitySeed
): number {
  return (
    (left.sourceId ?? left.id ?? "").localeCompare(right.sourceId ?? right.id ?? "") ||
    left.name.localeCompare(right.name) ||
    left.coordinate[0] - right.coordinate[0] ||
    left.coordinate[1] - right.coordinate[1]
  );
}

function compareLines(left: readonly LngLat[], right: readonly LngLat[]): number {
  return serializeJsonStable(left).localeCompare(serializeJsonStable(right));
}

function compareClippingPolygons(left: ClippingPolygon, right: ClippingPolygon): number {
  return serializeJsonStable(left).localeCompare(serializeJsonStable(right));
}

function compareIssues(left: TurkeyOsmBarrierIssue, right: TurkeyOsmBarrierIssue): number {
  return (
    left.code.localeCompare(right.code) ||
    (left.adm2Id ?? "").localeCompare(right.adm2Id ?? "") ||
    left.message.localeCompare(right.message)
  );
}

function dedupeLocalitySeeds(
  seeds: readonly TurkeySmartFallbackLocalitySeed[]
): TurkeySmartFallbackLocalitySeed[] {
  const seen = new Set<string>();
  const output: TurkeySmartFallbackLocalitySeed[] = [];

  for (const seed of [...seeds].sort(compareLocalitySeeds)) {
    const key = seed.sourceId ?? `${seed.name}:${seed.coordinate.join(",")}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(seed);
  }

  return output;
}

function isTerritoryZone(input: unknown): input is TerritoryZone {
  return isRecord(input) && typeof input.id === "string" && typeof input.level === "number";
}

function isString(input: unknown): input is string {
  return typeof input === "string" && input.length > 0;
}

function isRoadTag(input: string | undefined): input is (typeof ROAD_TAGS)[number] {
  return typeof input === "string" && ROAD_TAGS.includes(input as (typeof ROAD_TAGS)[number]);
}

function isRailwayTag(input: string | undefined): input is (typeof RAILWAY_TAGS)[number] {
  return typeof input === "string" && RAILWAY_TAGS.includes(input as (typeof RAILWAY_TAGS)[number]);
}

function isWaterwayTag(input: string | undefined): input is (typeof WATERWAY_TAGS)[number] {
  return (
    typeof input === "string" && WATERWAY_TAGS.includes(input as (typeof WATERWAY_TAGS)[number])
  );
}

function isWaterTag(input: string | undefined): input is (typeof WATER_TAGS)[number] {
  return typeof input === "string" && WATER_TAGS.includes(input as (typeof WATER_TAGS)[number]);
}

function isLeisureTag(input: string | undefined): input is (typeof LEISURE_TAGS)[number] {
  return typeof input === "string" && LEISURE_TAGS.includes(input as (typeof LEISURE_TAGS)[number]);
}

function isLanduseTag(input: string | undefined): input is (typeof LANDUSE_TAGS)[number] {
  return typeof input === "string" && LANDUSE_TAGS.includes(input as (typeof LANDUSE_TAGS)[number]);
}

function isLocalityPlace(input: string | undefined): input is (typeof PLACE_TAGS)[number] {
  return typeof input === "string" && PLACE_TAGS.includes(input as (typeof PLACE_TAGS)[number]);
}

function normalizeLocalityPlace(
  input: (typeof PLACE_TAGS)[number]
): "neighbourhood" | "suburb" | "quarter" | "village" | "locality" | "unknown" {
  if (
    input === "neighbourhood" ||
    input === "quarter" ||
    input === "suburb" ||
    input === "village" ||
    input === "locality"
  ) {
    return input;
  }

  return "locality";
}

function roadStrength(input: string): number {
  if (input === "motorway" || input === "motorway_link") {
    return 1;
  }

  if (input === "trunk" || input === "trunk_link") {
    return 0.95;
  }

  if (input === "primary" || input === "primary_link") {
    return 0.9;
  }

  if (input === "secondary" || input === "secondary_link") {
    return 0.75;
  }

  if (input === "tertiary" || input === "tertiary_link") {
    return 0.45;
  }

  if (input === "unclassified") {
    return 0.25;
  }

  if (input === "residential") {
    return 0.15;
  }

  return 0.1;
}

function railwayStrength(input: string): number {
  if (input === "rail") {
    return 0.75;
  }

  if (input === "light_rail") {
    return 0.6;
  }

  if (input === "subway") {
    return 0.45;
  }

  return 0.35;
}

function waterwayStrength(input: string): number {
  if (input === "river") {
    return 0.95;
  }

  if (input === "canal") {
    return 0.85;
  }

  return 0.55;
}

function ringHasArea(ring: readonly LngLat[]): boolean {
  return Math.abs(signedRingArea(ring)) > 1e-14;
}

function signedRingArea(ring: readonly LngLat[]): number {
  let area = 0;

  for (let index = 1; index < ring.length; index += 1) {
    const a = ring[index - 1];
    const b = ring[index];

    if (a && b) {
      area += a[0] * b[1] - b[0] * a[1];
    }
  }

  return area / 2;
}

function uniqueNumbers(values: readonly number[]): number[] {
  const output: number[] = [];

  for (const value of values) {
    const previous = output[output.length - 1];

    if (previous === undefined || Math.abs(previous - value) > 1e-10) {
      output.push(value);
    }
  }

  return output;
}

function interpolate(a: LngLat, b: LngLat, t: number): LngLat {
  return [roundCoordinate(a[0] + (b[0] - a[0]) * t), roundCoordinate(a[1] + (b[1] - a[1]) * t)];
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function pointsEqual(left: LngLat, right: LngLat): boolean {
  return Math.abs(left[0] - right[0]) <= 1e-10 && Math.abs(left[1] - right[1]) <= 1e-10;
}

function roundCoordinate(value: number): number {
  return Number(value.toFixed(7));
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}

function haversineKm(left: LngLat, right: LngLat): number {
  const radiusKm = 6371.0088;
  const lat1 = toRadians(left[1]);
  const lat2 = toRadians(right[1]);
  const deltaLat = toRadians(right[1] - left[1]);
  const deltaLng = toRadians(right[0] - left[0]);
  const a =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * radiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}
