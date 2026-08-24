import { createTerritoryEngine, decodeTerritoryBinarySpatialIndex } from "@territory-kit/core";
import type {
  TerritoryBinarySpatialIndex,
  TerritoryBounds,
  TerritoryEngine
} from "@territory-kit/core";
import {
  TerritoryError,
  isTerritoryAdminLevel,
  loadTerritoryDataset
} from "@territory-kit/dataset";
import type {
  TerritoryAdminLevel,
  TerritoryDataset,
  TerritoryQueryArtifact,
  TerritoryZone
} from "@territory-kit/dataset";
import { validateTerritoryDatasetRegistry } from "@territory-kit/registry";
import type {
  TerritoryDatasetRegistry,
  TerritoryInstalledArtifactMetadata,
  TerritoryRegistryArtifact,
  TerritoryRegistryArtifactPurpose,
  TerritoryRegistryDataset
} from "@territory-kit/registry";
import { jsonToBytes, parseJsonBytes } from "./bytes.js";
import { createMobileTerritoryChecksumAdapter } from "./checksum.js";
import { createReactNativeFetchAdapter } from "./fetch.js";
import { createMobileMemoryCache } from "./memory-cache.js";
import { joinRelativePath, sanitizeStorageSegment, storagePath } from "./path.js";
import type {
  MobileTerritoryActiveDatasetManifest,
  MobileTerritoryAppState,
  MobileTerritoryFetchAdapter,
  MobileTerritoryInstallOptions,
  MobileTerritoryInstallResult,
  MobileTerritoryInstalledArtifact,
  MobileTerritoryInstalledDataset,
  MobileTerritoryInstalledDatasetManifest,
  MobileTerritoryDatasetStatus,
  MobileTerritoryDatasetStatusOptions,
  MobileTerritoryPointQueryOptions,
  MobileTerritoryPointQueryResult,
  MobileTerritoryRuntime,
  MobileTerritoryRuntimeEvent,
  MobileTerritoryRuntimeListener,
  MobileTerritoryRuntimeOptions,
  MobileTerritoryRuntimeState,
  MobileTerritoryViewportQueryOptions,
  MobileTerritoryViewportQueryResult
} from "./types.js";

interface RegistryLoadResult {
  readonly registry: TerritoryDatasetRegistry;
  readonly registryHash: string;
}

interface RuntimeOperation {
  readonly controller: AbortController;
  readonly cleanup: () => void;
}

interface ParsedQueryDataset {
  readonly dataset: TerritoryDataset;
  readonly artifact: MobileTerritoryInstalledArtifact;
}

const DEFAULT_INSTALL_PURPOSES = ["query", "index", "render"] as const;
const ACTIVE_DIR = "active";
const DATASETS_DIR = "datasets";
const PARTIAL_DIR = ".partial";
const REGISTRY_DIR = "registry";
const REGISTRY_SNAPSHOT = "snapshot.json";

export function createMobileTerritoryRuntime(
  options: MobileTerritoryRuntimeOptions
): MobileTerritoryRuntime {
  const now = options.now ?? (() => new Date());
  const checksumAdapter = options.checksumAdapter ?? createMobileTerritoryChecksumAdapter();
  const queryCache = createMobileMemoryCache<MobileTerritoryViewportQueryResult>({
    ...(options.cachePolicy?.memoryMaxEntries !== undefined
      ? { maxEntries: options.cachePolicy.memoryMaxEntries }
      : {}),
    ...(options.cachePolicy?.memoryMaxBytes !== undefined
      ? { maxBytes: options.cachePolicy.memoryMaxBytes }
      : {}),
    estimateBytes: estimateQueryResultBytes
  });
  const installedCache = createMobileMemoryCache<MobileTerritoryInstalledDataset>({
    maxEntries: 8,
    estimateBytes: estimateInstalledDatasetBytes
  });
  const listeners = new Set<MobileTerritoryRuntimeListener>();
  const activeOperations = new Set<RuntimeOperation>();
  let disposed = false;
  let appState: MobileTerritoryAppState = "active";
  let fallbackReported = false;

  function emit(
    type: MobileTerritoryRuntimeEvent["type"],
    input: Omit<MobileTerritoryRuntimeEvent, "type" | "occurredAt"> = {}
  ): void {
    const event: MobileTerritoryRuntimeEvent = {
      type,
      occurredAt: now(),
      ...input
    };

    for (const listener of [...listeners]) {
      listener(event);
    }
  }

  function assertUsable(action: string): void {
    if (disposed) {
      throw new TerritoryError("RUNTIME_DISPOSED", `Cannot ${action} after runtime disposal.`);
    }
  }

  async function loadRegistry(signal?: AbortSignal): Promise<RegistryLoadResult> {
    if (options.registry) {
      return validateAndHashRegistry(options.registry);
    }

    const registryUrl = options.registryUrl;

    if (!registryUrl) {
      throw new TerritoryError(
        "RUNTIME_CONFIGURATION_INVALID",
        "Mobile registryUrl is required when an inline registry is not supplied."
      );
    }

    if (options.offline) {
      return readRegistrySnapshot(registryUrl);
    }

    try {
      const response = await getFetchAdapter().fetch({
        url: registryUrl,
        ...(signal ? { signal } : {}),
        ...(options.cachePolicy?.requestTimeoutMs
          ? { timeoutMs: options.cachePolicy.requestTimeoutMs }
          : {})
      });
      const registryInput = parseJsonBytes(response.bytes);
      const validation = validateTerritoryDatasetRegistry(registryInput);

      if (!validation.ok || !validation.registry) {
        throw new TerritoryError(
          "DATASET_INVALID",
          `Registry validation failed: ${validation.issues
            .map((issue) => issue.message)
            .join("; ")}`
        );
      }

      const registryHash = await checksumAdapter.sha256(jsonToBytes(validation.registry));
      const result = {
        registry: validation.registry,
        registryHash
      };
      await writeRegistrySnapshot(registryUrl, result);
      emit("registry-loaded", { details: { registryUrl, registryHash } });
      return result;
    } catch (error) {
      if (options.cachePolicy?.fallbackToInstalledOnNetworkError === false) {
        throw error;
      }

      const snapshot = await readRegistrySnapshot(registryUrl);
      emit("network-fallback", {
        message: "Registry network load failed; using the installed registry snapshot.",
        details: { registryUrl }
      });
      return snapshot;
    }
  }

  async function validateAndHashRegistry(
    registryInput: TerritoryDatasetRegistry
  ): Promise<RegistryLoadResult> {
    const validation = validateTerritoryDatasetRegistry(registryInput);

    if (!validation.ok || !validation.registry) {
      throw new TerritoryError(
        "DATASET_INVALID",
        `Registry validation failed: ${validation.issues.map((issue) => issue.message).join("; ")}`
      );
    }

    return {
      registry: validation.registry,
      registryHash: await checksumAdapter.sha256(jsonToBytes(validation.registry))
    };
  }

  async function installDataset(
    installOptions: MobileTerritoryInstallOptions
  ): Promise<MobileTerritoryInstallResult> {
    assertUsable("install a mobile dataset");
    const operation = createOperation(installOptions.signal, installOptions.timeoutMs);
    const cleanup = () => activeOperations.delete(operation);
    activeOperations.add(operation);
    const sessionId = createSessionId(now());
    const datasetIdSegment = sanitizeStorageSegment(installOptions.datasetId);
    const versionSegment = sanitizeStorageSegment(installOptions.version);
    const stagingSegments = [PARTIAL_DIR, datasetIdSegment, versionSegment, sessionId, "payload"];

    emit("install-started", {
      datasetId: installOptions.datasetId,
      version: installOptions.version
    });

    try {
      await cleanupPartialDownloads();
      throwIfAborted(operation.controller.signal);
      const { registry, registryHash } = await loadRegistry(operation.controller.signal);
      const dataset = selectPinnedDataset(registry.datasets, installOptions);
      const existingActive = await readActiveManifest(installOptions.datasetId);

      if (
        !installOptions.force &&
        existingActive?.version === dataset.version &&
        (await readInstalledManifest(installOptions.datasetId, dataset.version))
      ) {
        const existing = await loadInstalledDataset({
          datasetId: installOptions.datasetId,
          version: dataset.version
        });
        return {
          datasetId: dataset.id,
          version: dataset.version,
          registryHash: existing.registryHash,
          artifactCount: existing.artifacts.length,
          installedArtifacts: existing.artifacts
        };
      }

      const artifacts = selectInstallArtifacts(dataset, installOptions);

      if (artifacts.length === 0) {
        throw new TerritoryError(
          "ARTIFACT_NOT_FOUND",
          `No installable mobile artifact matches ${dataset.id}@${dataset.version}.`,
          { details: { datasetId: dataset.id, version: dataset.version } }
        );
      }

      await options.storageAdapter.makeDirectory(
        storagePath(options.storageAdapter, stagingSegments)
      );
      const installedArtifacts: MobileTerritoryInstalledArtifact[] = [];

      for (const artifact of artifacts) {
        throwIfAborted(operation.controller.signal);
        const installedArtifact = await downloadAndStageArtifact({
          artifact,
          dataset,
          registry,
          registryHash,
          stagingSegments,
          signal: operation.controller.signal,
          ...(installOptions.timeoutMs !== undefined ? { timeoutMs: installOptions.timeoutMs } : {})
        });
        installedArtifacts.push(installedArtifact);
      }

      const installedAt = now().toISOString();
      const finalManifest: MobileTerritoryInstalledDatasetManifest = {
        dataset,
        registryHash,
        installedAt,
        activatedAt: installedAt,
        artifacts: installedArtifacts
      };
      await writeJsonAtSegments([...stagingSegments, "manifest.json"], finalManifest);

      const finalSegments = [DATASETS_DIR, datasetIdSegment, versionSegment];
      await options.storageAdapter.deleteFile(storagePath(options.storageAdapter, finalSegments), {
        recursive: true
      });
      await options.storageAdapter.makeDirectory(
        storagePath(options.storageAdapter, [DATASETS_DIR, datasetIdSegment])
      );
      await options.storageAdapter.moveFile(
        storagePath(options.storageAdapter, stagingSegments),
        storagePath(options.storageAdapter, finalSegments)
      );

      const activeManifest: MobileTerritoryActiveDatasetManifest = {
        datasetId: dataset.id,
        version: dataset.version,
        registryHash,
        activatedAt: now().toISOString(),
        ...(existingActive && existingActive.version !== dataset.version
          ? {
              previous: {
                version: existingActive.version,
                registryHash: existingActive.registryHash
              }
            }
          : {})
      };
      await writeActiveManifest(activeManifest);
      installedCache.delete(installedDatasetCacheKey(dataset.id, dataset.version));
      emit("dataset-activated", {
        datasetId: dataset.id,
        version: dataset.version,
        details: { artifactCount: installedArtifacts.length }
      });

      if (installOptions.removeOld) {
        await removeOldVersions(dataset.id, dataset.version);
      }

      emit("install-completed", {
        datasetId: dataset.id,
        version: dataset.version,
        details: { artifactCount: installedArtifacts.length }
      });

      return {
        datasetId: dataset.id,
        version: dataset.version,
        registryHash,
        artifactCount: installedArtifacts.length,
        installedArtifacts
      };
    } catch (error) {
      await options.storageAdapter.deleteFile(
        storagePath(options.storageAdapter, [PARTIAL_DIR, datasetIdSegment]),
        { recursive: true }
      );
      emit("partial-cleanup", {
        datasetId: installOptions.datasetId,
        version: installOptions.version
      });

      if (operation.controller.signal.aborted) {
        emit("request-cancelled", {
          datasetId: installOptions.datasetId,
          version: installOptions.version
        });
        throw new TerritoryError("REQUEST_ABORTED", "Mobile dataset install was cancelled.", {
          details: { datasetId: installOptions.datasetId, version: installOptions.version },
          cause: error
        });
      } else {
        emit("install-failed", {
          datasetId: installOptions.datasetId,
          version: installOptions.version,
          message: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    } finally {
      operation.cleanup();
      cleanup();
    }
  }

  async function downloadAndStageArtifact(input: {
    readonly artifact: TerritoryRegistryArtifact;
    readonly dataset: TerritoryRegistryDataset;
    readonly registry: TerritoryDatasetRegistry;
    readonly registryHash: string;
    readonly stagingSegments: readonly string[];
    readonly signal: AbortSignal;
    readonly timeoutMs?: number;
  }): Promise<MobileTerritoryInstalledArtifact> {
    const artifact = input.artifact;
    const sourceUrl = joinRegistryUrl(input.registry.baseUrl, artifact.url);
    const artifactSegment = sanitizeStorageSegment(artifact.id);
    const artifactSegments = [...input.stagingSegments, "artifacts", artifactSegment];
    emit("artifact-started", {
      datasetId: input.dataset.id,
      version: input.dataset.version,
      artifactId: artifact.id,
      totalBytes: artifact.sizeBytes
    });

    const timeoutMs = input.timeoutMs ?? options.cachePolicy?.requestTimeoutMs;
    const response = await getFetchAdapter().fetch({
      url: sourceUrl,
      signal: input.signal,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(options.cachePolicy?.installMaxArtifactBytes
        ? { maxBytes: options.cachePolicy.installMaxArtifactBytes }
        : {})
    });
    emit("artifact-progress", {
      datasetId: input.dataset.id,
      version: input.dataset.version,
      artifactId: artifact.id,
      loadedBytes: response.bytes.byteLength,
      totalBytes: artifact.sizeBytes
    });
    await verifyArtifactBytes(artifact, response.bytes);

    if (artifact.compression && artifact.compression !== "none") {
      throw new TerritoryError(
        "RUNTIME_CONFIGURATION_INVALID",
        `Mobile artifact compression '${artifact.compression}' requires an application decompressor before it can be used offline.`,
        { details: { artifactId: artifact.id, compression: artifact.compression } }
      );
    }

    await options.storageAdapter.makeDirectory(
      storagePath(options.storageAdapter, artifactSegments)
    );
    const relativeArtifactPath = joinRelativePath(["artifacts", artifactSegment, "artifact"]);
    await options.storageAdapter.writeFile(
      storagePath(options.storageAdapter, [...artifactSegments, "artifact"]),
      response.bytes
    );
    const metadata: TerritoryInstalledArtifactMetadata = {
      datasetId: input.dataset.id,
      version: input.dataset.version,
      artifactId: artifact.id,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
      installedAt: now().toISOString(),
      lastVerifiedAt: now().toISOString(),
      sourceUrl,
      registryHash: input.registryHash,
      compression: artifact.compression ?? "none",
      ...(artifact.path ? { path: artifact.path } : {}),
      ...((response.contentType ?? artifact.contentType)
        ? { contentType: response.contentType ?? artifact.contentType }
        : {}),
      ...(response.etag ? { etag: response.etag } : {}),
      ...(response.lastModified ? { lastModified: response.lastModified } : {})
    };
    await writeJsonAtSegments([...artifactSegments, "metadata.json"], metadata);
    emit("artifact-verified", {
      datasetId: input.dataset.id,
      version: input.dataset.version,
      artifactId: artifact.id
    });
    emit("artifact-installed", {
      datasetId: input.dataset.id,
      version: input.dataset.version,
      artifactId: artifact.id
    });

    return {
      artifact,
      metadata,
      path: relativeArtifactPath
    };
  }

  async function verifyArtifactBytes(
    artifact: TerritoryRegistryArtifact,
    bytes: Uint8Array
  ): Promise<void> {
    if (bytes.byteLength !== artifact.sizeBytes) {
      throw new TerritoryError("ARTIFACT_CORRUPTED", `Size mismatch for artifact ${artifact.id}.`, {
        details: {
          artifactId: artifact.id,
          expectedSizeBytes: artifact.sizeBytes,
          actualSizeBytes: bytes.byteLength
        }
      });
    }

    const actual = await checksumAdapter.sha256(bytes);

    if (actual !== artifact.sha256) {
      throw new TerritoryError(
        "CHECKSUM_MISMATCH",
        `Checksum mismatch for artifact ${artifact.id}.`,
        {
          details: { artifactId: artifact.id }
        }
      );
    }
  }

  async function loadInstalledDataset(input: {
    readonly datasetId: string;
    readonly version?: string;
  }): Promise<MobileTerritoryInstalledDataset> {
    assertUsable("load an installed mobile dataset");
    const version = input.version ?? (await requireActiveManifest(input.datasetId)).version;
    const cacheKey = installedDatasetCacheKey(input.datasetId, version);
    const cached = installedCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const manifest = await readInstalledManifest(input.datasetId, version);

    if (!manifest) {
      throw new TerritoryError(
        "DATASET_NOT_FOUND",
        `Mobile dataset ${input.datasetId}@${version} is not installed.`,
        { details: { datasetId: input.datasetId, version } }
      );
    }

    const queryDatasets = await Promise.all(
      manifest.artifacts
        .filter((artifact) => artifact.artifact.purpose === "query")
        .map((artifact) => readQueryDataset(manifest, artifact))
    );
    const indexes = await readBinaryIndexes(manifest);
    const engines = queryDatasets.map((entry) =>
      createTerritoryEngine({
        dataset: entry.dataset,
        ...selectEngineIndex(entry.dataset, indexes)
      })
    );
    const loaded = {
      dataset: manifest.dataset,
      registryHash: manifest.registryHash,
      manifest,
      queryDatasets: queryDatasets.map((entry) => entry.dataset),
      engines,
      artifacts: manifest.artifacts
    };
    installedCache.set(cacheKey, loaded);
    return loaded;
  }

  async function readQueryDataset(
    manifest: MobileTerritoryInstalledDatasetManifest,
    artifact: MobileTerritoryInstalledArtifact
  ): Promise<ParsedQueryDataset> {
    const bytes = await readInstalledArtifactBytes(manifest, artifact);
    const input = parseJsonBytes(bytes);
    return {
      dataset: normalizeQueryDataset(input, manifest.dataset, manifest.installedAt),
      artifact
    };
  }

  async function readBinaryIndexes(
    manifest: MobileTerritoryInstalledDatasetManifest
  ): Promise<readonly TerritoryBinarySpatialIndex[]> {
    const indexes: TerritoryBinarySpatialIndex[] = [];

    for (const artifact of manifest.artifacts) {
      if (artifact.artifact.purpose !== "index" && artifact.artifact.format !== "tksi") {
        continue;
      }

      const bytes = await readInstalledArtifactBytes(manifest, artifact);
      indexes.push(
        decodeTerritoryBinarySpatialIndex(bytes, {
          datasetId: manifest.dataset.id,
          datasetVersion: manifest.dataset.version
        })
      );
    }

    return indexes;
  }

  function selectEngineIndex(
    dataset: TerritoryDataset,
    indexes: readonly TerritoryBinarySpatialIndex[]
  ): { readonly spatialIndex?: TerritoryBinarySpatialIndex } {
    const match = indexes.find(
      (index) =>
        index.metadata.datasetId === dataset.manifest.datasetId &&
        index.metadata.datasetVersion === dataset.manifest.datasetVersion &&
        index.metadata.geometryHash === dataset.manifest.geometryHash
    );

    return match ? { spatialIndex: match } : {};
  }

  async function readInstalledArtifactBytes(
    manifest: MobileTerritoryInstalledDatasetManifest,
    artifact: MobileTerritoryInstalledArtifact
  ): Promise<Uint8Array> {
    const bytes = await options.storageAdapter.readFile(
      storagePath(options.storageAdapter, [
        DATASETS_DIR,
        sanitizeStorageSegment(manifest.dataset.id),
        sanitizeStorageSegment(manifest.dataset.version),
        ...artifact.path.split("/")
      ])
    );

    if (!bytes) {
      throw new TerritoryError(
        "ARTIFACT_NOT_FOUND",
        `Installed artifact ${artifact.artifact.id} is missing.`
      );
    }

    await verifyArtifactBytes(artifact.artifact, bytes);
    return bytes;
  }

  function normalizeQueryDataset(
    input: unknown,
    registryDataset: TerritoryRegistryDataset,
    installedAt: string
  ): TerritoryDataset {
    if (isRecord(input) && isRecord(input.manifest) && Array.isArray(input.zones)) {
      const dataset = loadTerritoryDataset(input);
      assertQueryDatasetMatchesRegistry(dataset, registryDataset);
      return dataset;
    }

    if (isTerritoryQueryArtifact(input)) {
      const dataset = loadTerritoryDataset({
        manifest: {
          datasetId: input.datasetId,
          datasetVersion: input.datasetVersion,
          schemaVersion: input.schemaVersion,
          sourceDate: registryDataset.source.version ?? installedAt,
          geometryHash: input.datasetContentHash,
          adminLevels: input.levels,
          name: registryDataset.displayName,
          license: registryDataset.license.id
        },
        zones: input.zones
      });
      assertQueryDatasetMatchesRegistry(dataset, registryDataset);
      return dataset;
    }

    throw new TerritoryError(
      "DATASET_INVALID",
      "Installed query artifact is neither a TerritoryDataset nor a query artifact."
    );
  }

  function assertQueryDatasetMatchesRegistry(
    dataset: TerritoryDataset,
    registryDataset: TerritoryRegistryDataset
  ): void {
    if (
      dataset.manifest.datasetId !== registryDataset.id ||
      dataset.manifest.datasetVersion !== registryDataset.version
    ) {
      throw new TerritoryError(
        "DATASET_INVALID",
        `Installed query artifact ${dataset.manifest.datasetId}@${dataset.manifest.datasetVersion} does not match registry dataset ${registryDataset.id}@${registryDataset.version}.`,
        {
          details: {
            artifactDatasetId: dataset.manifest.datasetId,
            artifactDatasetVersion: dataset.manifest.datasetVersion,
            registryDatasetId: registryDataset.id,
            registryDatasetVersion: registryDataset.version
          }
        }
      );
    }
  }

  async function queryViewport(
    queryOptions: MobileTerritoryViewportQueryOptions
  ): Promise<MobileTerritoryViewportQueryResult> {
    assertUsable("query a mobile viewport");
    reportWorkerFallbackOnce();
    const operation = createOperation(queryOptions.signal);
    activeOperations.add(operation);

    try {
      const installed = await loadInstalledDataset({
        datasetId: queryOptions.datasetId,
        ...(queryOptions.version !== undefined ? { version: queryOptions.version } : {})
      });
      throwIfAborted(operation.controller.signal);
      const level = resolveViewportLevel(queryOptions.viewport, installed.engines);
      const key = createViewportCacheKey(
        queryOptions.datasetId,
        installed.dataset.version,
        level,
        queryOptions.viewport.bounds
      );
      const cached = queryCache.get(key);

      if (cached) {
        return {
          ...cached,
          cached: true
        };
      }

      const engine = installed.engines.find((candidate) =>
        candidate.availableLevels.includes(level)
      );

      if (!engine) {
        throw new TerritoryError(
          "ARTIFACT_NOT_FOUND",
          `No installed query artifact contains level ${level}.`,
          {
            details: {
              datasetId: queryOptions.datasetId,
              version: installed.dataset.version,
              level
            }
          }
        );
      }

      const zones = engine.getZonesInBounds({
        ...queryOptions.viewport.bounds,
        level
      });
      throwIfAborted(operation.controller.signal);
      const result: MobileTerritoryViewportQueryResult = {
        datasetId: queryOptions.datasetId,
        version: installed.dataset.version,
        level,
        zones,
        cached: false
      };
      queryCache.set(key, result);
      return result;
    } finally {
      operation.cleanup();
      activeOperations.delete(operation);
    }
  }

  async function queryPoint(
    queryOptions: MobileTerritoryPointQueryOptions
  ): Promise<MobileTerritoryPointQueryResult> {
    assertUsable("query a mobile point");
    reportWorkerFallbackOnce();
    const operation = createOperation(queryOptions.signal);
    activeOperations.add(operation);

    try {
      const installed = await loadInstalledDataset({
        datasetId: queryOptions.datasetId,
        ...(queryOptions.version !== undefined ? { version: queryOptions.version } : {})
      });
      throwIfAborted(operation.controller.signal);
      const engines = selectPointQueryEngines(installed.engines, queryOptions);

      if (engines.length === 0) {
        throw new TerritoryError(
          "ARTIFACT_NOT_FOUND",
          `No installed query artifact contains the requested point lookup level.`,
          {
            details: {
              datasetId: queryOptions.datasetId,
              version: installed.dataset.version,
              level: queryOptions.level,
              levels: queryOptions.levels
            }
          }
        );
      }

      const zonesById = new Map<string, TerritoryZone>();

      for (const engine of engines) {
        for (const match of engine.findTerritoriesAtPoint(queryOptions.coordinate, {
          ...(queryOptions.level !== undefined ? { level: queryOptions.level } : {}),
          ...(queryOptions.levels !== undefined ? { levels: [...queryOptions.levels] } : {})
        })) {
          zonesById.set(match.territoryId, match.zone);
        }
      }

      throwIfAborted(operation.controller.signal);
      const zones = [...zonesById.values()].sort(
        (left, right) => right.level - left.level || left.id.localeCompare(right.id)
      );

      return {
        datasetId: queryOptions.datasetId,
        version: installed.dataset.version,
        territoryId: zones[0]?.id ?? null,
        zones
      };
    } finally {
      operation.cleanup();
      activeOperations.delete(operation);
    }
  }

  async function checkDatasetStatus(
    statusOptions: MobileTerritoryDatasetStatusOptions
  ): Promise<MobileTerritoryDatasetStatus> {
    assertUsable("check mobile dataset status");
    const operation = createOperation(statusOptions.signal);
    activeOperations.add(operation);

    try {
      const active = await readActiveManifest(statusOptions.datasetId);
      const installed =
        active && (await readInstalledManifest(statusOptions.datasetId, active.version))
          ? true
          : false;
      throwIfAborted(operation.controller.signal);
      const { registry, registryHash } = await loadRegistry(operation.controller.signal);
      const availableDataset = statusOptions.version
        ? registry.datasets.find(
            (dataset) =>
              dataset.id === statusOptions.datasetId && dataset.version === statusOptions.version
          )
        : selectLatestRegistryDataset(registry.datasets, statusOptions.datasetId);
      const availableVersion = availableDataset?.version;
      const installedVersion = installed ? active?.version : undefined;
      const updateAvailable = Boolean(
        installedVersion && availableVersion && installedVersion !== availableVersion
      );

      return {
        datasetId: statusOptions.datasetId,
        installed,
        ...(installedVersion ? { installedVersion } : {}),
        available: Boolean(availableDataset),
        ...(availableVersion ? { availableVersion } : {}),
        stale: updateAvailable,
        updateAvailable,
        registryHash,
        ...(active?.registryHash ? { activeRegistryHash: active.registryHash } : {}),
        checkedAt: now().toISOString()
      };
    } finally {
      operation.cleanup();
      activeOperations.delete(operation);
    }
  }

  async function listInstalledDatasets(): Promise<readonly MobileTerritoryActiveDatasetManifest[]> {
    assertUsable("list installed mobile datasets");
    const entries = await options.storageAdapter.listDirectory?.(
      storagePath(options.storageAdapter, [ACTIVE_DIR])
    );

    if (!entries) {
      return [];
    }

    const manifests = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) =>
          readJsonAtSegments<MobileTerritoryActiveDatasetManifest>([ACTIVE_DIR, entry])
        )
    );
    return manifests
      .filter((manifest): manifest is MobileTerritoryActiveDatasetManifest => Boolean(manifest))
      .sort((left, right) => left.datasetId.localeCompare(right.datasetId));
  }

  async function rollbackDataset(input: {
    readonly datasetId: string;
    readonly toVersion?: string;
  }): Promise<MobileTerritoryActiveDatasetManifest> {
    assertUsable("roll back a mobile dataset");
    const current = await requireActiveManifest(input.datasetId);
    const targetVersion = input.toVersion ?? current.previous?.version;

    if (!targetVersion) {
      throw new TerritoryError(
        "DATASET_NOT_FOUND",
        `No previous installed version is recorded for ${input.datasetId}.`,
        { details: { datasetId: input.datasetId } }
      );
    }

    const target = await readInstalledManifest(input.datasetId, targetVersion);

    if (!target) {
      throw new TerritoryError(
        "DATASET_NOT_FOUND",
        `Rollback target ${input.datasetId}@${targetVersion} is not installed.`,
        { details: { datasetId: input.datasetId, version: targetVersion } }
      );
    }

    const active: MobileTerritoryActiveDatasetManifest = {
      datasetId: input.datasetId,
      version: target.dataset.version,
      registryHash: target.registryHash,
      activatedAt: now().toISOString(),
      previous: {
        version: current.version,
        registryHash: current.registryHash
      }
    };
    await writeActiveManifest(active);
    queryCache.clear();
    installedCache.delete(installedDatasetCacheKey(input.datasetId, current.version));
    return active;
  }

  async function cleanupPartialDownloads(): Promise<number> {
    assertUsable("clean partial mobile downloads");
    const entries = await options.storageAdapter.listDirectory?.(
      storagePath(options.storageAdapter, [PARTIAL_DIR])
    );

    if (!entries || entries.length === 0) {
      return 0;
    }

    await options.storageAdapter.deleteFile(storagePath(options.storageAdapter, [PARTIAL_DIR]), {
      recursive: true
    });
    emit("partial-cleanup", { details: { count: entries.length } });
    return entries.length;
  }

  function setAppState(nextState: MobileTerritoryAppState): void {
    assertUsable("update mobile app state");
    appState = nextState;
    emit("lifecycle-change", { details: { appState } });

    if (nextState !== "active" && options.cachePolicy?.backgroundMemoryMaxBytes !== undefined) {
      const removed = queryCache.evictToBytes(options.cachePolicy.backgroundMemoryMaxBytes);

      if (removed > 0) {
        emit("memory-cache-evicted", { details: { removed, reason: "background" } });
      }
    }
  }

  function handleLowMemory(): void {
    assertUsable("handle low memory");
    const target = options.cachePolicy?.lowMemoryMaxBytes ?? 0;
    const removed = queryCache.evictToBytes(target);

    if (removed > 0) {
      emit("memory-cache-evicted", { details: { removed, reason: "low-memory" } });
    }
  }

  function cancelActiveRequests(reason = "cancelled"): number {
    let cancelled = 0;

    for (const operation of activeOperations) {
      if (!operation.controller.signal.aborted) {
        operation.controller.abort(reason);
        cancelled += 1;
      }
    }

    if (cancelled > 0) {
      emit("request-cancelled", { details: { cancelled, reason } });
    }

    return cancelled;
  }

  function getState(): MobileTerritoryRuntimeState {
    const summary = queryCache.getSummary();

    return {
      appState,
      activeRequests: activeOperations.size,
      disposed,
      memoryCache: summary
    };
  }

  function dispose(): void {
    if (disposed) {
      return;
    }

    cancelActiveRequests("disposed");
    disposed = true;
    queryCache.clear();
    installedCache.clear();
    listeners.clear();
  }

  function subscribe(listener: MobileTerritoryRuntimeListener) {
    listeners.add(listener);

    return {
      unsubscribe() {
        listeners.delete(listener);
      }
    };
  }

  function createOperation(signal?: AbortSignal, timeoutMs?: number): RuntimeOperation {
    const controller = new AbortController();
    const linkedAbort = () => controller.abort(signal?.reason ?? "aborted");
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
    signal?.addEventListener("abort", linkedAbort, { once: true });

    if (timeoutMs !== undefined && timeoutMs > 0) {
      timeout = globalThis.setTimeout(() => controller.abort("timeout"), timeoutMs);
    }

    return {
      controller,
      cleanup() {
        signal?.removeEventListener("abort", linkedAbort);

        if (timeout) {
          globalThis.clearTimeout(timeout);
        }
      }
    };
  }

  function getFetchAdapter(): MobileTerritoryFetchAdapter {
    return options.fetchAdapter ?? createReactNativeFetchAdapter();
  }

  function reportWorkerFallbackOnce(): void {
    if (fallbackReported) {
      return;
    }

    fallbackReported = true;
    emit("worker-fallback", {
      message:
        "React Native runtime is using async JS fallback execution; large queries can still occupy the JS thread without a native worker/module."
    });
  }

  async function writeRegistrySnapshot(
    registryUrl: string,
    result: RegistryLoadResult
  ): Promise<void> {
    await writeJsonAtSegments([REGISTRY_DIR, REGISTRY_SNAPSHOT], {
      registryUrl,
      registryHash: result.registryHash,
      registry: result.registry,
      savedAt: now().toISOString()
    });
  }

  async function readRegistrySnapshot(registryUrl: string): Promise<RegistryLoadResult> {
    const snapshot = await readJsonAtSegments<{
      readonly registryUrl: string;
      readonly registryHash: string;
      readonly registry: TerritoryDatasetRegistry;
    }>([REGISTRY_DIR, REGISTRY_SNAPSHOT]);

    if (!snapshot || snapshot.registryUrl !== registryUrl) {
      throw new TerritoryError(
        "CACHE_CORRUPTED",
        `Registry '${registryUrl}' is not available in mobile offline storage.`,
        { details: { registryUrl } }
      );
    }

    return {
      registry: snapshot.registry,
      registryHash: snapshot.registryHash
    };
  }

  async function readInstalledManifest(
    datasetId: string,
    version: string
  ): Promise<MobileTerritoryInstalledDatasetManifest | undefined> {
    return readJsonAtSegments<MobileTerritoryInstalledDatasetManifest>([
      DATASETS_DIR,
      sanitizeStorageSegment(datasetId),
      sanitizeStorageSegment(version),
      "manifest.json"
    ]);
  }

  async function readActiveManifest(
    datasetId: string
  ): Promise<MobileTerritoryActiveDatasetManifest | undefined> {
    return readJsonAtSegments<MobileTerritoryActiveDatasetManifest>([
      ACTIVE_DIR,
      `${sanitizeStorageSegment(datasetId)}.json`
    ]);
  }

  async function requireActiveManifest(
    datasetId: string
  ): Promise<MobileTerritoryActiveDatasetManifest> {
    const manifest = await readActiveManifest(datasetId);

    if (!manifest) {
      throw new TerritoryError("DATASET_NOT_FOUND", `No active mobile dataset for ${datasetId}.`, {
        details: { datasetId }
      });
    }

    return manifest;
  }

  async function writeActiveManifest(
    manifest: MobileTerritoryActiveDatasetManifest
  ): Promise<void> {
    await writeJsonAtSegments(
      [ACTIVE_DIR, `${sanitizeStorageSegment(manifest.datasetId)}.json`],
      manifest
    );
  }

  async function removeOldVersions(datasetId: string, keepVersion: string): Promise<void> {
    const datasetSegments = [DATASETS_DIR, sanitizeStorageSegment(datasetId)];
    const entries = await options.storageAdapter.listDirectory?.(
      storagePath(options.storageAdapter, datasetSegments)
    );

    for (const entry of entries ?? []) {
      if (entry !== sanitizeStorageSegment(keepVersion)) {
        await options.storageAdapter.deleteFile(
          storagePath(options.storageAdapter, [...datasetSegments, entry]),
          { recursive: true }
        );
      }
    }
  }

  async function writeJsonAtSegments(segments: readonly string[], input: unknown): Promise<void> {
    await options.storageAdapter.makeDirectory(
      storagePath(options.storageAdapter, segments.slice(0, -1))
    );
    await options.storageAdapter.writeFile(
      storagePath(options.storageAdapter, segments),
      jsonToBytes(input)
    );
  }

  async function readJsonAtSegments<T>(segments: readonly string[]): Promise<T | undefined> {
    const bytes = await options.storageAdapter.readFile(
      storagePath(options.storageAdapter, segments)
    );
    return bytes ? (parseJsonBytes(bytes) as T) : undefined;
  }

  return {
    storageAdapter: options.storageAdapter,
    installDataset,
    loadInstalledDataset,
    queryViewport,
    queryPoint,
    checkDatasetStatus,
    listInstalledDatasets,
    rollbackDataset,
    cleanupPartialDownloads,
    setAppState,
    handleLowMemory,
    cancelActiveRequests,
    getState,
    subscribe,
    dispose
  };
}

function selectPinnedDataset(
  datasets: readonly TerritoryRegistryDataset[],
  request: Pick<MobileTerritoryInstallOptions, "datasetId" | "version">
): TerritoryRegistryDataset {
  const match = datasets.find(
    (dataset) => dataset.id === request.datasetId && dataset.version === request.version
  );

  if (!match) {
    throw new TerritoryError(
      "DATASET_NOT_FOUND",
      `Dataset ${request.datasetId}@${request.version} was not found in registry.`,
      { details: { datasetId: request.datasetId, version: request.version } }
    );
  }

  return match;
}

function selectLatestRegistryDataset(
  datasets: readonly TerritoryRegistryDataset[],
  datasetId: string
): TerritoryRegistryDataset | undefined {
  return datasets
    .filter((dataset) => dataset.id === datasetId)
    .sort((left, right) =>
      right.version.localeCompare(left.version, undefined, {
        numeric: true,
        sensitivity: "base"
      })
    )[0];
}

function selectPointQueryEngines(
  engines: readonly TerritoryEngine[],
  queryOptions: MobileTerritoryPointQueryOptions
): readonly TerritoryEngine[] {
  const level = queryOptions.level;

  if (level !== undefined) {
    return engines.filter((engine) => engine.availableLevels.includes(level));
  }

  if (queryOptions.levels && queryOptions.levels.length > 0) {
    const levels = new Set(queryOptions.levels);
    return engines.filter((engine) => engine.availableLevels.some((level) => levels.has(level)));
  }

  return engines;
}

function selectInstallArtifacts(
  dataset: TerritoryRegistryDataset,
  options: MobileTerritoryInstallOptions
): readonly TerritoryRegistryArtifact[] {
  const purposes = new Set<TerritoryRegistryArtifactPurpose>(
    (options.purposes ?? DEFAULT_INSTALL_PURPOSES) as readonly TerritoryRegistryArtifactPurpose[]
  );

  return dataset.artifacts
    .filter((artifact) => purposes.has(artifact.purpose))
    .filter((artifact) => levelsMatch(artifact.levels, options.levels))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function levelsMatch(
  artifactLevels: readonly TerritoryAdminLevel[] | undefined,
  requestedLevels: readonly TerritoryAdminLevel[] | undefined
): boolean {
  if (
    !requestedLevels ||
    requestedLevels.length === 0 ||
    !artifactLevels ||
    artifactLevels.length === 0
  ) {
    return true;
  }

  const requested = new Set(requestedLevels);
  return artifactLevels.some((level) => requested.has(level));
}

function joinRegistryUrl(baseUrl: string | undefined, url: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    return url;
  }

  if (!baseUrl) {
    throw new TerritoryError(
      "RUNTIME_CONFIGURATION_INVALID",
      `Relative artifact URL '${url}' requires registry baseUrl.`
    );
  }

  return new URL(url, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

function resolveViewportLevel(
  viewport: { readonly zoom: number; readonly level?: number },
  engines: readonly TerritoryEngine[]
): number {
  if (viewport.level !== undefined) {
    return viewport.level;
  }

  const preferred = zoomToMobileLevel(viewport.zoom);

  if (engines.some((engine) => engine.availableLevels.includes(preferred))) {
    return preferred;
  }

  const available = [...new Set(engines.flatMap((engine) => engine.availableLevels))].sort(
    (left, right) => left - right
  );

  return available.find((level) => level >= preferred) ?? available.at(-1) ?? preferred;
}

function zoomToMobileLevel(zoom: number): number {
  if (zoom < 5) {
    return 0;
  }

  if (zoom < 8) {
    return 1;
  }

  if (zoom < 12) {
    return 2;
  }

  if (zoom < 15) {
    return 3;
  }

  if (zoom < 18) {
    return 4;
  }

  return 5;
}

function createViewportCacheKey(
  datasetId: string,
  version: string,
  level: number,
  bounds: TerritoryBounds
): string {
  return [datasetId, version, level, bounds.west, bounds.south, bounds.east, bounds.north].join(
    ":"
  );
}

function isTerritoryQueryArtifact(input: unknown): input is TerritoryQueryArtifact {
  return (
    isRecord(input) &&
    input.queryArtifactVersion === "1" &&
    typeof input.datasetId === "string" &&
    typeof input.datasetVersion === "string" &&
    input.schemaVersion === "territory-schema@1" &&
    Array.isArray(input.levels) &&
    input.levels.every((level) => typeof level === "string" && isTerritoryAdminLevel(level)) &&
    typeof input.datasetContentHash === "string" &&
    Array.isArray(input.zones)
  );
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new TerritoryError("REQUEST_ABORTED", "Mobile runtime request was cancelled.");
  }
}

function createSessionId(date: Date): string {
  return `${date.getTime()}-${Math.random().toString(36).slice(2)}`;
}

function installedDatasetCacheKey(datasetId: string, version: string): string {
  return `${datasetId}@${version}`;
}

function estimateQueryResultBytes(result: MobileTerritoryViewportQueryResult): number {
  return 256 + result.zones.length * 192;
}

function estimateInstalledDatasetBytes(dataset: MobileTerritoryInstalledDataset): number {
  return 1024 + dataset.queryDatasets.reduce((sum, item) => sum + item.zones.length * 256, 0);
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
