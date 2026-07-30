import type { TerritoryAdminLevel, TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";
import type {
  TerritoryDatasetRegistry,
  TerritoryInstalledArtifactMetadata,
  TerritoryRegistryArtifact,
  TerritoryRegistryDataset
} from "@territory-kit/registry";
import type { TerritoryBounds, TerritoryEngine } from "@territory-kit/core";

export type MobileTerritoryPlatform = "ios" | "android" | "unknown";

export type MobileTerritoryAppState = "active" | "inactive" | "background";

export interface MobileTerritoryStorageStat {
  readonly exists: boolean;
  readonly isDirectory?: boolean;
  readonly sizeBytes?: number;
}

export interface MobileTerritoryStorageAdapter {
  readonly platform?: MobileTerritoryPlatform;
  readonly rootDirectory: string;
  readFile(path: string): Promise<Uint8Array | undefined>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  makeDirectory(path: string): Promise<void>;
  moveFile(fromPath: string, toPath: string): Promise<void>;
  deleteFile(path: string, options?: { readonly recursive?: boolean }): Promise<void>;
  listDirectory?(path: string): Promise<readonly string[]>;
  stat?(path: string): Promise<MobileTerritoryStorageStat>;
}

export interface MobileTerritoryFetchRequest {
  readonly url: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

export interface MobileTerritoryFetchResponse {
  readonly bytes: Uint8Array;
  readonly url: string;
  readonly contentType?: string;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly sizeBytes?: number;
}

export interface MobileTerritoryFetchAdapter {
  fetch(request: MobileTerritoryFetchRequest): Promise<MobileTerritoryFetchResponse>;
}

export interface MobileTerritoryChecksumAdapter {
  sha256(bytes: Uint8Array): Promise<string>;
}

export interface MobileTerritoryCachePolicy {
  readonly memoryMaxEntries?: number;
  readonly memoryMaxBytes?: number;
  readonly backgroundMemoryMaxBytes?: number;
  readonly lowMemoryMaxBytes?: number;
  readonly installMaxArtifactBytes?: number;
  readonly requestTimeoutMs?: number;
  readonly fallbackToInstalledOnNetworkError?: boolean;
}

export type MobileTerritoryInstallEventType =
  | "install-started"
  | "registry-loaded"
  | "network-fallback"
  | "artifact-started"
  | "artifact-progress"
  | "artifact-verified"
  | "artifact-installed"
  | "partial-cleanup"
  | "dataset-activated"
  | "install-completed"
  | "install-failed"
  | "request-cancelled"
  | "lifecycle-change"
  | "memory-cache-evicted"
  | "worker-fallback";

export interface MobileTerritoryRuntimeEvent {
  readonly type: MobileTerritoryInstallEventType;
  readonly occurredAt: Date;
  readonly datasetId?: string;
  readonly version?: string;
  readonly artifactId?: string;
  readonly loadedBytes?: number;
  readonly totalBytes?: number;
  readonly message?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export type MobileTerritoryRuntimeListener = (event: MobileTerritoryRuntimeEvent) => void;

export interface MobileTerritoryRuntimeSubscription {
  unsubscribe(): void;
}

export interface MobileTerritoryInstallOptions {
  readonly datasetId: string;
  readonly version: string;
  readonly levels?: readonly TerritoryAdminLevel[];
  readonly purposes?: readonly ("query" | "index" | "render" | "metadata")[];
  readonly force?: boolean;
  readonly removeOld?: boolean;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface MobileTerritoryInstalledArtifact {
  readonly artifact: TerritoryRegistryArtifact;
  readonly metadata: TerritoryInstalledArtifactMetadata;
  readonly path: string;
}

export interface MobileTerritoryInstalledDatasetManifest {
  readonly dataset: TerritoryRegistryDataset;
  readonly registryHash: string;
  readonly installedAt: string;
  readonly activatedAt: string;
  readonly artifacts: readonly MobileTerritoryInstalledArtifact[];
}

export interface MobileTerritoryActiveDatasetManifest {
  readonly datasetId: string;
  readonly version: string;
  readonly registryHash: string;
  readonly activatedAt: string;
  readonly previous?: {
    readonly version: string;
    readonly registryHash: string;
  };
}

export interface MobileTerritoryInstallResult {
  readonly datasetId: string;
  readonly version: string;
  readonly registryHash: string;
  readonly artifactCount: number;
  readonly installedArtifacts: readonly MobileTerritoryInstalledArtifact[];
}

export interface MobileTerritoryInstalledDataset {
  readonly dataset: TerritoryRegistryDataset;
  readonly registryHash: string;
  readonly manifest: MobileTerritoryInstalledDatasetManifest;
  readonly queryDatasets: readonly TerritoryDataset[];
  readonly engines: readonly TerritoryEngine[];
  readonly artifacts: readonly MobileTerritoryInstalledArtifact[];
}

export interface MobileTerritoryViewport {
  readonly bounds: TerritoryBounds;
  readonly zoom: number;
  readonly level?: number;
}

export interface MobileTerritoryViewportQueryOptions {
  readonly datasetId: string;
  readonly version?: string;
  readonly viewport: MobileTerritoryViewport;
  readonly signal?: AbortSignal;
}

export interface MobileTerritoryViewportQueryResult {
  readonly datasetId: string;
  readonly version: string;
  readonly level: number;
  readonly zones: readonly TerritoryZone[];
  readonly cached: boolean;
}

export interface MobileTerritoryRollbackOptions {
  readonly datasetId: string;
  readonly toVersion?: string;
}

export interface MobileTerritoryRuntimeState {
  readonly appState: MobileTerritoryAppState;
  readonly activeRequests: number;
  readonly disposed: boolean;
  readonly memoryCache: {
    readonly entries: number;
    readonly bytes: number;
    readonly evictions: number;
  };
}

export interface MobileTerritoryRuntimeOptions {
  readonly registryUrl?: string;
  readonly registry?: TerritoryDatasetRegistry;
  readonly storageAdapter: MobileTerritoryStorageAdapter;
  readonly fetchAdapter?: MobileTerritoryFetchAdapter;
  readonly checksumAdapter?: MobileTerritoryChecksumAdapter;
  readonly cachePolicy?: MobileTerritoryCachePolicy;
  readonly offline?: boolean;
  readonly now?: () => Date;
}

export interface MobileTerritoryRuntime {
  readonly storageAdapter: MobileTerritoryStorageAdapter;
  installDataset(options: MobileTerritoryInstallOptions): Promise<MobileTerritoryInstallResult>;
  loadInstalledDataset(input: {
    readonly datasetId: string;
    readonly version?: string;
  }): Promise<MobileTerritoryInstalledDataset>;
  queryViewport(
    options: MobileTerritoryViewportQueryOptions
  ): Promise<MobileTerritoryViewportQueryResult>;
  listInstalledDatasets(): Promise<readonly MobileTerritoryActiveDatasetManifest[]>;
  rollbackDataset(
    options: MobileTerritoryRollbackOptions
  ): Promise<MobileTerritoryActiveDatasetManifest>;
  cleanupPartialDownloads(): Promise<number>;
  setAppState(state: MobileTerritoryAppState): void;
  handleLowMemory(): void;
  cancelActiveRequests(reason?: string): number;
  getState(): MobileTerritoryRuntimeState;
  subscribe(listener: MobileTerritoryRuntimeListener): MobileTerritoryRuntimeSubscription;
  dispose(): void;
}
