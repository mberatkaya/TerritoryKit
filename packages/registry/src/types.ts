import type {
  TerritoryAdminLevel,
  TerritoryCoverageStatus,
  TerritorySemanticAdminType
} from "@territory-kit/dataset";

export const TERRITORY_REGISTRY_VERSION = "1";

export type TerritoryRegistryVersion = typeof TERRITORY_REGISTRY_VERSION;

export type TerritoryRegistryArtifactPurpose =
  "query" | "render" | "metadata" | "adjacency" | "debug";

export type TerritoryRegistryArtifactFormat =
  "territory-json" | "geojson" | "json" | "br" | "gzip" | "pmtiles" | "mvt";

export type TerritoryRegistryArtifactCompression = "none" | "gzip" | "br";

export interface TerritoryRegistrySourceInfo {
  provider: string;
  version?: string;
  url?: string;
  attribution?: string;
}

export interface TerritoryRegistryLicenseInfo {
  id: string;
  name?: string;
  url?: string;
  attribution: string;
}

export interface TerritoryRegistryArtifact {
  id: string;
  purpose: TerritoryRegistryArtifactPurpose;
  format: TerritoryRegistryArtifactFormat;
  levels?: readonly TerritoryAdminLevel[];
  detail?: string;
  path?: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  compression?: TerritoryRegistryArtifactCompression;
  contentType?: string;
  datasetContentHash?: string;
  adjacencyForDatasetHash?: string;
  minCoreVersion?: string;
  maxCoreVersion?: string;
  identityMapHash?: string;
  renderArtifactVersion?: string;
  layer?: string;
  coverageStatus?: TerritoryCoverageStatus;
  semanticType?: TerritorySemanticAdminType;
  localTypeName?: string;
  partialCoverage?: boolean;
  [key: string]: unknown;
}

export interface TerritoryRegistryDataset {
  id: string;
  displayName: string;
  version: string;
  schemaVersion: string;
  country?: {
    alpha2?: string;
    alpha3?: string;
    name?: string;
  };
  levels: readonly TerritoryAdminLevel[];
  source: TerritoryRegistrySourceInfo;
  license: TerritoryRegistryLicenseInfo;
  artifacts: readonly TerritoryRegistryArtifact[];
  [key: string]: unknown;
}

export interface TerritoryDatasetRegistry {
  registryVersion: TerritoryRegistryVersion;
  generatedAt: string;
  baseUrl?: string;
  datasets: readonly TerritoryRegistryDataset[];
  [key: string]: unknown;
}

export interface TerritoryRegistryIssue {
  code: string;
  message: string;
  path?: string;
  severity: "error" | "warning";
}

export interface TerritoryRegistryValidationResult {
  ok: boolean;
  registry?: TerritoryDatasetRegistry;
  issues: TerritoryRegistryIssue[];
}

export interface TerritoryRegistryTransportRequest {
  url: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface TerritoryRegistryTransportResponse {
  bytes: Uint8Array;
  url: string;
  contentType?: string;
  etag?: string;
  lastModified?: string;
  sizeBytes?: number;
}

export interface TerritoryRegistryTransport {
  fetch(request: TerritoryRegistryTransportRequest): Promise<TerritoryRegistryTransportResponse>;
}

export interface TerritoryRegistryCachedArtifact {
  key: TerritoryRegistryArtifactCacheKey;
  artifact: TerritoryRegistryArtifact;
  metadata: TerritoryInstalledArtifactMetadata;
  bytes: Uint8Array;
}

export interface TerritoryRegistryArtifactCacheKey {
  datasetId: string;
  version: string;
  artifactId: string;
}

export interface TerritoryInstalledArtifactMetadata {
  datasetId: string;
  version: string;
  artifactId: string;
  sha256: string;
  sizeBytes: number;
  installedAt: string;
  lastVerifiedAt?: string;
  sourceUrl: string;
  registryHash: string;
  compression: TerritoryRegistryArtifactCompression;
  path?: string;
  contentType?: string;
  etag?: string;
  lastModified?: string;
}

export interface TerritoryInstalledDatasetSummary {
  datasetId: string;
  version: string;
  artifactCount: number;
  installedAt: string;
  verified: boolean;
  registryUrl?: string;
  registryHash: string;
}

export interface TerritoryRegistrySnapshot {
  registryUrl: string;
  registryHash: string;
  registry: TerritoryDatasetRegistry;
  savedAt: string;
}

export interface TerritoryRegistryCache {
  getArtifact(
    key: TerritoryRegistryArtifactCacheKey
  ): Promise<TerritoryRegistryCachedArtifact | undefined>;
  putArtifact(input: {
    key: TerritoryRegistryArtifactCacheKey;
    artifact: TerritoryRegistryArtifact;
    bytes: Uint8Array;
    decodedBytes?: Uint8Array;
    metadata: TerritoryInstalledArtifactMetadata;
  }): Promise<TerritoryRegistryCachedArtifact>;
  removeDataset(datasetId: string, version?: string): Promise<void>;
  listInstalledDatasets(): Promise<TerritoryInstalledDatasetSummary[]>;
  writeRegistrySnapshot(snapshot: TerritoryRegistrySnapshot): Promise<void>;
  readRegistrySnapshot(registryUrl: string): Promise<TerritoryRegistrySnapshot | undefined>;
  clear?(): Promise<void>;
}

export interface TerritoryRegistryResolvedArtifact {
  dataset: TerritoryRegistryDataset;
  artifact: TerritoryRegistryArtifact;
  url: string;
  registryHash: string;
}

export type TerritoryRegistryTerritoryArtifactFallback = "none" | "deepest-available";

export interface TerritoryRegistryResolveTerritoryArtifactOptions {
  country: string;
  level: TerritoryAdminLevel;
  parentId?: string;
  purpose?: TerritoryRegistryArtifactPurpose;
  detail?: string;
  formatPreference?: readonly TerritoryRegistryArtifactFormat[];
  version?: string;
  allowPrerelease?: boolean;
  fallback?: TerritoryRegistryTerritoryArtifactFallback;
}

export interface TerritoryRegistryResolveDeepestAvailableTerritoryArtifactOptions {
  country: string;
  requestedLevel: TerritoryAdminLevel;
  parentId?: string;
  purpose?: TerritoryRegistryArtifactPurpose;
  detail?: string;
  formatPreference?: readonly TerritoryRegistryArtifactFormat[];
  version?: string;
  allowPrerelease?: boolean;
  fallback?: TerritoryRegistryTerritoryArtifactFallback;
}

export interface TerritoryRegistryResolvedTerritoryArtifact {
  requestedLevel: TerritoryAdminLevel;
  resolvedLevel: TerritoryAdminLevel;
  exactMatch: boolean;
  reason: "exact-match" | "requested-level-unavailable" | "requested-level-unavailable-for-area";
  coverageStatus: TerritoryCoverageStatus;
  dataset: TerritoryRegistryDataset;
  artifact: TerritoryRegistryArtifact;
  url: string;
  registryHash: string;
}

export interface TerritoryRegistryResolveArtifactOptions {
  datasetId: string;
  purpose?: TerritoryRegistryArtifactPurpose;
  levels?: readonly TerritoryAdminLevel[];
  detail?: string;
  formatPreference?: readonly TerritoryRegistryArtifactFormat[];
  version?: string;
  allowPrerelease?: boolean;
  path?: string;
}

export interface TerritoryRegistryInstallOptions {
  datasetId: string;
  levels?: readonly TerritoryAdminLevel[];
  detail?: string;
  version?: string;
  allowPrerelease?: boolean;
  loadAdjacency?: boolean;
  refreshRegistry?: boolean;
  removeOld?: boolean;
  signal?: AbortSignal;
}

export interface TerritoryDatasetArtifactResolver {
  resolveArtifact(path: string): Promise<unknown>;
}

export interface TerritoryInstalledDatasetHandle extends TerritoryDatasetArtifactResolver {
  dataset: TerritoryRegistryDataset;
  registryHash: string;
  installedArtifacts: readonly TerritoryRegistryCachedArtifact[];
  manifest: TerritoryInstalledDatasetSummary;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
}

export interface TerritoryRegistryClient {
  loadRegistry(options?: { refresh?: boolean }): Promise<TerritoryDatasetRegistry>;
  listDatasets(): Promise<TerritoryRegistryDataset[]>;
  searchDatasets(query: string): Promise<TerritoryRegistryDataset[]>;
  getDatasetInfo(datasetId: string, version?: string): Promise<TerritoryRegistryDataset>;
  resolveArtifact(
    options: TerritoryRegistryResolveArtifactOptions
  ): Promise<TerritoryRegistryResolvedArtifact>;
  resolveTerritoryArtifact(
    options: TerritoryRegistryResolveTerritoryArtifactOptions
  ): Promise<TerritoryRegistryResolvedTerritoryArtifact>;
  resolveDeepestAvailableTerritoryArtifact(
    options: TerritoryRegistryResolveDeepestAvailableTerritoryArtifactOptions
  ): Promise<TerritoryRegistryResolvedTerritoryArtifact>;
  installDataset(
    options: TerritoryRegistryInstallOptions
  ): Promise<TerritoryInstalledDatasetHandle>;
  updateDataset(options: TerritoryRegistryInstallOptions): Promise<TerritoryInstalledDatasetHandle>;
  verifyInstalledDataset(
    datasetId: string,
    version?: string
  ): Promise<TerritoryInstalledDatasetSummary>;
  removeInstalledDataset(datasetId: string, version?: string): Promise<void>;
  listInstalledDatasets(): Promise<TerritoryInstalledDatasetSummary[]>;
}

export interface TerritoryRegistryClientOptions {
  registryUrl?: string;
  registry?: TerritoryDatasetRegistry;
  transport?: TerritoryRegistryTransport;
  cache?: TerritoryRegistryCache | false;
  verifyChecksums?: boolean;
  offline?: boolean;
  allowHttp?: boolean;
  timeoutMs?: number;
  maxArtifactBytes?: number;
  maxDecompressedBytes?: number;
  now?: () => Date;
  decompressArtifactBytes?: (
    bytes: Uint8Array,
    compression: TerritoryRegistryArtifactCompression
  ) => Promise<Uint8Array>;
}
