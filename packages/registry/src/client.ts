import {
  TERRITORY_COVERAGE_STATUSES,
  TerritoryError,
  compareAdminLevels,
  getAdminLevelDepth
} from "@territory-kit/dataset";
import type { TerritoryAdminLevel, TerritoryCoverageStatus } from "@territory-kit/dataset";
import { validateTerritoryDatasetRegistry } from "./schema.js";
import { compareSemver, isPrerelease, matchesVersionRange } from "./semver.js";
import type {
  TerritoryDatasetRegistry,
  TerritoryInstalledArtifactMetadata,
  TerritoryInstalledDatasetHandle,
  TerritoryInstalledDatasetSummary,
  TerritoryRegistryArtifact,
  TerritoryRegistryArtifactCacheKey,
  TerritoryRegistryArtifactCompression,
  TerritoryRegistryCachedArtifact,
  TerritoryRegistryClient,
  TerritoryRegistryClientOptions,
  TerritoryRegistryDataset,
  TerritoryRegistryInstallOptions,
  TerritoryRegistryArtifactPurpose,
  TerritoryRegistryResolveArtifactOptions,
  TerritoryRegistryResolveDeepestAvailableTerritoryArtifactOptions,
  TerritoryRegistryResolvedTerritoryArtifact,
  TerritoryRegistryResolveTerritoryArtifactOptions,
  TerritoryRegistryResolvedArtifact,
  TerritoryRegistryTransport
} from "./types.js";
import {
  bytesToText,
  compareStrings,
  includesEvery,
  joinUrl,
  normalizeCompression,
  serializeJsonStable,
  sha256Hex
} from "./utils.js";
import { createMemoryTerritoryRegistryCache } from "./memory-cache.js";

export function createTerritoryRegistryClient(
  options: TerritoryRegistryClientOptions
): TerritoryRegistryClient {
  const cache =
    options.cache === false
      ? createMemoryTerritoryRegistryCache()
      : (options.cache ?? createMemoryTerritoryRegistryCache());
  const verifyChecksums = options.verifyChecksums ?? true;
  const now = options.now ?? (() => new Date());
  let loadedRegistry: TerritoryDatasetRegistry | undefined;
  let loadedRegistryHash: string | undefined;

  async function loadRegistry(
    loadOptions: { refresh?: boolean } = {}
  ): Promise<TerritoryDatasetRegistry> {
    if (loadedRegistry && !loadOptions.refresh) {
      return loadedRegistry;
    }

    const registryUrl = options.registryUrl ?? "inline://registry";

    if (options.offline) {
      const snapshot = await cache.readRegistrySnapshot(registryUrl);

      if (!snapshot) {
        throw new TerritoryError(
          "CACHE_CORRUPTED",
          `Registry '${registryUrl}' is not available in offline cache.`,
          { details: { registryUrl } }
        );
      }

      loadedRegistry = snapshot.registry;
      loadedRegistryHash = snapshot.registryHash;
      return loadedRegistry;
    }

    const registryInput =
      options.registry ??
      JSON.parse(bytesToText((await fetchBytes(registryUrl, { purpose: "registry" })).bytes));
    const validation = validateTerritoryDatasetRegistry(registryInput);

    if (!validation.ok || !validation.registry) {
      throw new TerritoryError(
        "DATASET_INVALID",
        `Registry validation failed: ${validation.issues.map((issue) => issue.message).join("; ")}`,
        { details: { issueCount: validation.issues.length } }
      );
    }

    loadedRegistry = validation.registry;
    loadedRegistryHash = await sha256Hex(serializeJsonStable(loadedRegistry));
    await cache.writeRegistrySnapshot({
      registryUrl,
      registryHash: loadedRegistryHash,
      registry: loadedRegistry,
      savedAt: now().toISOString()
    });
    return loadedRegistry;
  }

  async function resolveArtifact(
    request: TerritoryRegistryResolveArtifactOptions
  ): Promise<TerritoryRegistryResolvedArtifact> {
    const registry = await loadRegistry();
    const dataset = selectDataset(registry.datasets, request);
    const candidates = dataset.artifacts
      .filter((artifact) => artifactMatchesRequest(artifact, request))
      .sort((left, right) => {
        const preference = compareFormatPreference(left, right, request.formatPreference);

        if (preference !== 0) {
          return preference;
        }

        return left.id.localeCompare(right.id);
      });

    if (candidates.length === 0) {
      throw new TerritoryError(
        "ARTIFACT_NOT_FOUND",
        `No registry artifact matches ${request.datasetId}.`,
        {
          details: { datasetId: request.datasetId }
        }
      );
    }

    if (!request.formatPreference && candidates.length > 1 && !request.path) {
      const first = candidates[0];
      const equivalent = candidates.every(
        (artifact) =>
          artifact.purpose === first?.purpose &&
          artifact.format === first.format &&
          artifact.detail === first.detail
      );

      if (!equivalent) {
        throw new TerritoryError(
          "RUNTIME_CONFIGURATION_INVALID",
          `Registry artifact request for ${request.datasetId} is ambiguous.`,
          { details: { datasetId: request.datasetId } }
        );
      }
    }

    const artifact = candidates[0];

    if (!artifact) {
      throw new TerritoryError(
        "ARTIFACT_NOT_FOUND",
        `No registry artifact matches ${request.datasetId}.`,
        {
          details: { datasetId: request.datasetId }
        }
      );
    }

    return {
      dataset,
      artifact,
      url: joinUrl(registry.baseUrl, artifact.url),
      registryHash: await currentRegistryHash()
    };
  }

  async function resolveTerritoryArtifact(
    request: TerritoryRegistryResolveTerritoryArtifactOptions
  ): Promise<TerritoryRegistryResolvedTerritoryArtifact> {
    return resolveTerritoryArtifactInternal({
      country: request.country,
      requestedLevel: request.level,
      ...(request.parentId ? { parentId: request.parentId } : {}),
      purpose: request.purpose ?? "query",
      ...(request.detail ? { detail: request.detail } : {}),
      ...(request.formatPreference ? { formatPreference: request.formatPreference } : {}),
      ...(request.version ? { version: request.version } : {}),
      ...(request.allowPrerelease ? { allowPrerelease: request.allowPrerelease } : {}),
      fallback: request.fallback ?? "none"
    });
  }

  async function resolveDeepestAvailableTerritoryArtifact(
    request: TerritoryRegistryResolveDeepestAvailableTerritoryArtifactOptions
  ): Promise<TerritoryRegistryResolvedTerritoryArtifact> {
    return resolveTerritoryArtifactInternal({
      country: request.country,
      requestedLevel: request.requestedLevel,
      ...(request.parentId ? { parentId: request.parentId } : {}),
      purpose: request.purpose ?? "query",
      ...(request.detail ? { detail: request.detail } : {}),
      ...(request.formatPreference ? { formatPreference: request.formatPreference } : {}),
      ...(request.version ? { version: request.version } : {}),
      ...(request.allowPrerelease ? { allowPrerelease: request.allowPrerelease } : {}),
      fallback: request.fallback ?? "deepest-available"
    });
  }

  async function resolveTerritoryArtifactInternal(request: {
    country: string;
    requestedLevel: TerritoryAdminLevel;
    parentId?: string;
    purpose: TerritoryRegistryArtifactPurpose;
    detail?: string;
    formatPreference?: readonly string[];
    version?: string;
    allowPrerelease?: boolean;
    fallback: "none" | "deepest-available";
  }): Promise<TerritoryRegistryResolvedTerritoryArtifact> {
    const registry = await loadRegistry();
    const datasets = selectCountryDatasets(registry.datasets, request);
    const exact = selectBestTerritoryArtifactCandidate(datasets, {
      ...request,
      level: request.requestedLevel,
      allowFallback: false
    });

    if (exact) {
      return createResolvedTerritoryArtifact({
        registry,
        match: exact,
        requestedLevel: request.requestedLevel,
        reason: "exact-match"
      });
    }

    if (request.fallback !== "deepest-available") {
      throw new TerritoryError(
        "ARTIFACT_NOT_FOUND",
        `No ${request.requestedLevel} artifact is available for country '${request.country}'.`,
        { details: { country: request.country, requestedLevel: request.requestedLevel } }
      );
    }

    const fallback = selectBestTerritoryArtifactCandidate(datasets, {
      ...request,
      level: request.requestedLevel,
      allowFallback: true
    });

    if (!fallback) {
      throw new TerritoryError(
        "ARTIFACT_NOT_FOUND",
        `No artifact at or above ${request.requestedLevel} is available for country '${request.country}'.`,
        { details: { country: request.country, requestedLevel: request.requestedLevel } }
      );
    }

    const areaRestrictedFallback = hasAreaRestrictedArtifact(datasets, request);

    return createResolvedTerritoryArtifact({
      registry,
      match: fallback,
      requestedLevel: request.requestedLevel,
      reason: areaRestrictedFallback
        ? "requested-level-unavailable-for-area"
        : "requested-level-unavailable",
      ...(areaRestrictedFallback ? { coverageStatus: "partial" } : {})
    });
  }

  async function createResolvedTerritoryArtifact(input: {
    registry: TerritoryDatasetRegistry;
    match: TerritoryArtifactCandidate;
    requestedLevel: TerritoryAdminLevel;
    reason: TerritoryRegistryResolvedTerritoryArtifact["reason"];
    coverageStatus?: TerritoryCoverageStatus;
  }): Promise<TerritoryRegistryResolvedTerritoryArtifact> {
    const exactMatch = input.reason === "exact-match";

    return {
      requestedLevel: input.requestedLevel,
      resolvedLevel: input.match.resolvedLevel,
      exactMatch,
      reason: input.reason,
      coverageStatus: exactMatch
        ? readCoverageStatus(input.match.artifact, input.match.dataset)
        : (input.coverageStatus ?? "source-unavailable"),
      dataset: input.match.dataset,
      artifact: input.match.artifact,
      url: joinUrl(input.registry.baseUrl, input.match.artifact.url),
      registryHash: await currentRegistryHash()
    };
  }

  async function installDataset(
    request: TerritoryRegistryInstallOptions
  ): Promise<TerritoryInstalledDatasetHandle> {
    if (request.refreshRegistry) {
      await loadRegistry({ refresh: true });
    }

    const registry = await loadRegistry();
    const dataset = selectDataset(registry.datasets, request);
    const artifacts = selectInstallArtifacts(dataset, request).sort((left, right) =>
      left.id.localeCompare(right.id)
    );
    const registryHash = await currentRegistryHash();
    const installed = [];

    for (const artifact of artifacts) {
      const key = createCacheKey(dataset, artifact);
      const cached = await readValidCachedArtifact(key, artifact);

      if (cached) {
        installed.push(cached);
        continue;
      }

      if (options.offline) {
        throw new TerritoryError(
          "ARTIFACT_NOT_FOUND",
          `Artifact ${artifact.id} is not installed and registry client is offline.`,
          { details: { artifactId: artifact.id, datasetId: dataset.id } }
        );
      }

      const sourceUrl = joinUrl(registry.baseUrl, artifact.url);
      const response = await fetchBytes(sourceUrl, {
        purpose: artifact.purpose,
        ...(request.signal ? { signal: request.signal } : {})
      });
      await verifyArtifactBytes(artifact, response.bytes);
      const compression = normalizeCompression(artifact.compression);
      const decodedBytes = await decodeBytes(response.bytes, compression);
      const metadata: TerritoryInstalledArtifactMetadata = {
        datasetId: dataset.id,
        version: dataset.version,
        artifactId: artifact.id,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
        installedAt: now().toISOString(),
        lastVerifiedAt: now().toISOString(),
        sourceUrl,
        registryHash,
        compression,
        ...(artifact.path ? { path: artifact.path } : {}),
        ...((response.contentType ?? artifact.contentType)
          ? { contentType: response.contentType ?? artifact.contentType }
          : {}),
        ...(response.etag ? { etag: response.etag } : {}),
        ...(response.lastModified ? { lastModified: response.lastModified } : {})
      };
      installed.push(
        await cache.putArtifact({
          key,
          artifact,
          bytes: response.bytes,
          decodedBytes,
          metadata
        })
      );
    }

    if (request.removeOld) {
      const installedSummaries = await cache.listInstalledDatasets();

      for (const summary of installedSummaries) {
        if (summary.datasetId === dataset.id && summary.version !== dataset.version) {
          await cache.removeDataset(summary.datasetId, summary.version);
        }
      }
    }

    return createInstalledDatasetHandle(dataset, registryHash, installed);
  }

  async function readValidCachedArtifact(
    key: TerritoryRegistryArtifactCacheKey,
    artifact: TerritoryRegistryArtifact
  ) {
    const cached = await cache.getArtifact(key);

    if (!cached) {
      return undefined;
    }

    if (!verifyChecksums) {
      return cached;
    }

    if (
      cached.metadata.sha256 !== artifact.sha256 ||
      cached.metadata.sizeBytes !== artifact.sizeBytes
    ) {
      return undefined;
    }

    return cached;
  }

  async function verifyInstalledDataset(
    datasetId: string,
    version?: string
  ): Promise<TerritoryInstalledDatasetSummary> {
    const installed = await cache.listInstalledDatasets();
    const matches = installed.filter(
      (summary) => summary.datasetId === datasetId && (!version || summary.version === version)
    );

    if (matches.length === 0) {
      throw new TerritoryError(
        "DATASET_NOT_FOUND",
        `Dataset ${datasetId}${version ? `@${version}` : ""} is not installed.`,
        { details: { datasetId, ...(version ? { version } : {}) } }
      );
    }

    return matches.sort((left, right) => compareSemver(right.version, left.version))[0]!;
  }

  async function currentRegistryHash(): Promise<string> {
    if (loadedRegistryHash) {
      return loadedRegistryHash;
    }

    await loadRegistry();

    if (!loadedRegistryHash) {
      throw new TerritoryError(
        "RUNTIME_CONFIGURATION_INVALID",
        "Registry hash was not initialized."
      );
    }

    return loadedRegistryHash;
  }

  async function fetchBytes(url: string, context: { purpose: string; signal?: AbortSignal }) {
    if (!options.transport) {
      if (!globalThis.fetch) {
        throw new TerritoryError(
          "RUNTIME_CONFIGURATION_INVALID",
          `No registry transport is configured for ${context.purpose}.`,
          { details: { purpose: context.purpose } }
        );
      }

      return createFetchTransport().fetch({
        url,
        ...(context.signal ? { signal: context.signal } : {}),
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.maxArtifactBytes ? { maxBytes: options.maxArtifactBytes } : {})
      });
    }

    return options.transport.fetch({
      url,
      ...(context.signal ? { signal: context.signal } : {}),
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.maxArtifactBytes ? { maxBytes: options.maxArtifactBytes } : {})
    });
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

    if (verifyChecksums) {
      const actual = await sha256Hex(bytes);

      if (actual !== artifact.sha256) {
        throw new TerritoryError(
          "CHECKSUM_MISMATCH",
          `Checksum mismatch for artifact ${artifact.id}.`,
          { details: { artifactId: artifact.id } }
        );
      }
    }
  }

  async function decodeBytes(
    bytes: Uint8Array,
    compression: TerritoryRegistryArtifactCompression
  ): Promise<Uint8Array> {
    if (compression === "none") {
      return bytes;
    }

    if (!options.decompressArtifactBytes) {
      throw new Error(`Artifact compression '${compression}' requires a decompressor.`);
    }

    const decoded = await options.decompressArtifactBytes(bytes, compression);

    if (options.maxDecompressedBytes && decoded.byteLength > options.maxDecompressedBytes) {
      throw new Error("Decompressed artifact exceeds maxDecompressedBytes.");
    }

    return decoded;
  }

  return {
    loadRegistry,
    async listDatasets() {
      return [...(await loadRegistry()).datasets].sort((left, right) =>
        `${left.id}@${left.version}`.localeCompare(`${right.id}@${right.version}`)
      );
    },
    async searchDatasets(query) {
      const normalized = query.trim().toLowerCase();
      return (await this.listDatasets()).filter(
        (dataset) =>
          dataset.id.toLowerCase().includes(normalized) ||
          dataset.displayName.toLowerCase().includes(normalized) ||
          dataset.country?.alpha2?.toLowerCase() === normalized ||
          dataset.country?.alpha3?.toLowerCase() === normalized
      );
    },
    async getDatasetInfo(datasetId, version) {
      return selectDataset((await loadRegistry()).datasets, {
        datasetId,
        ...(version ? { version } : {})
      });
    },
    resolveArtifact,
    resolveTerritoryArtifact,
    resolveDeepestAvailableTerritoryArtifact,
    installDataset,
    updateDataset: installDataset,
    verifyInstalledDataset,
    removeInstalledDataset(datasetId, version) {
      return cache.removeDataset(datasetId, version);
    },
    listInstalledDatasets() {
      return cache.listInstalledDatasets();
    }
  };
}

function createFetchTransport(): TerritoryRegistryTransport {
  return {
    async fetch(request) {
      const controller = new AbortController();
      const timeout = request.timeoutMs
        ? globalThis.setTimeout(() => controller.abort(), request.timeoutMs)
        : undefined;
      const linkedAbort = () => controller.abort();
      request.signal?.addEventListener("abort", linkedAbort, { once: true });

      try {
        const response = await globalThis.fetch(request.url, { signal: controller.signal });

        if (!response.ok) {
          throw new Error(
            `Failed to fetch ${request.url}: ${response.status} ${response.statusText}`
          );
        }

        const arrayBuffer = await response.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        if (request.maxBytes && bytes.byteLength > request.maxBytes) {
          throw new Error(`Response exceeded maxBytes for ${request.url}.`);
        }

        const result = {
          bytes,
          url: response.url,
          sizeBytes: bytes.byteLength
        };
        const contentType = response.headers.get("content-type");
        const etag = response.headers.get("etag");
        const lastModified = response.headers.get("last-modified");

        return {
          ...result,
          ...(contentType ? { contentType } : {}),
          ...(etag ? { etag } : {}),
          ...(lastModified ? { lastModified } : {})
        };
      } finally {
        if (timeout) {
          globalThis.clearTimeout(timeout);
        }

        request.signal?.removeEventListener("abort", linkedAbort);
      }
    }
  };
}

function selectDataset(
  datasets: readonly TerritoryRegistryDataset[],
  request: { datasetId: string; version?: string; allowPrerelease?: boolean }
): TerritoryRegistryDataset {
  const requestedVersion = request.version ?? "latest-compatible";
  const candidates = datasets
    .filter((dataset) => dataset.id === request.datasetId)
    .filter((dataset) => request.allowPrerelease || !isPrerelease(dataset.version))
    .filter((dataset) => {
      if (requestedVersion === "latest" || requestedVersion === "latest-compatible") {
        return true;
      }

      return matchesVersionRange(dataset.version, requestedVersion);
    })
    .sort((left, right) => compareSemver(right.version, left.version));

  if (candidates.length === 0) {
    throw new TerritoryError(
      "DATASET_NOT_FOUND",
      `Dataset ${request.datasetId}@${requestedVersion} was not found in registry.`,
      { details: { datasetId: request.datasetId, requestedVersion } }
    );
  }

  return candidates[0]!;
}

interface TerritoryArtifactCandidate {
  dataset: TerritoryRegistryDataset;
  artifact: TerritoryRegistryArtifact;
  resolvedLevel: TerritoryAdminLevel;
}

function selectCountryDatasets(
  datasets: readonly TerritoryRegistryDataset[],
  request: { country: string; version?: string; allowPrerelease?: boolean }
): TerritoryRegistryDataset[] {
  const country = request.country.trim().toUpperCase();
  const requestedVersion = request.version ?? "latest-compatible";
  const candidates = datasets
    .filter(
      (dataset) =>
        dataset.country?.alpha2?.toUpperCase() === country ||
        dataset.country?.alpha3?.toUpperCase() === country
    )
    .filter((dataset) => request.allowPrerelease || !isPrerelease(dataset.version))
    .filter((dataset) => {
      if (requestedVersion === "latest" || requestedVersion === "latest-compatible") {
        return true;
      }

      return matchesVersionRange(dataset.version, requestedVersion);
    })
    .sort((left, right) => compareSemver(right.version, left.version));

  if (candidates.length === 0) {
    throw new TerritoryError(
      "DATASET_NOT_FOUND",
      `No registry dataset is available for country '${request.country}'.`,
      { details: { country: request.country } }
    );
  }

  return candidates;
}

function selectBestTerritoryArtifactCandidate(
  datasets: readonly TerritoryRegistryDataset[],
  request: {
    level: TerritoryAdminLevel;
    parentId?: string;
    purpose: TerritoryRegistryArtifactPurpose;
    detail?: string;
    formatPreference?: readonly string[];
    allowFallback: boolean;
  }
): TerritoryArtifactCandidate | undefined {
  const requestedDepth = getAdminLevelDepth(request.level);
  const candidates = datasets.flatMap((dataset) =>
    dataset.artifacts.flatMap((artifact): TerritoryArtifactCandidate[] => {
      if (artifact.purpose !== request.purpose) {
        return [];
      }

      if (request.detail && artifact.detail && artifact.detail !== request.detail) {
        return [];
      }

      if (request.formatPreference && !request.formatPreference.includes(artifact.format)) {
        return [];
      }

      if (!artifactCoversParent(artifact, request.parentId)) {
        return [];
      }

      const artifactLevels = normalizeLevels(artifact.levels ?? dataset.levels);
      const matchingLevels = request.allowFallback
        ? artifactLevels.filter((level) => getAdminLevelDepth(level) <= requestedDepth)
        : artifactLevels.filter((level) => level === request.level);
      const resolvedLevel = matchingLevels.sort(compareAdminLevels).at(-1);

      return resolvedLevel ? [{ dataset, artifact, resolvedLevel }] : [];
    })
  );

  return candidates.sort((left, right) => {
    const depth = getAdminLevelDepth(right.resolvedLevel) - getAdminLevelDepth(left.resolvedLevel);

    if (depth !== 0) {
      return depth;
    }

    const format = compareFormatPreference(left.artifact, right.artifact, request.formatPreference);

    if (format !== 0) {
      return format;
    }

    const version = compareSemver(right.dataset.version, left.dataset.version);

    if (version !== 0) {
      return version;
    }

    return (
      left.dataset.id.localeCompare(right.dataset.id) ||
      left.artifact.id.localeCompare(right.artifact.id)
    );
  })[0];
}

function hasAreaRestrictedArtifact(
  datasets: readonly TerritoryRegistryDataset[],
  request: {
    requestedLevel: TerritoryAdminLevel;
    parentId?: string;
    purpose: TerritoryRegistryArtifactPurpose;
  }
): boolean {
  if (!request.parentId) {
    return false;
  }

  return datasets.some((dataset) =>
    dataset.artifacts.some(
      (artifact) =>
        artifact.purpose === request.purpose &&
        normalizeLevels(artifact.levels ?? dataset.levels).includes(request.requestedLevel) &&
        Array.isArray(artifact.coveredParentIds)
    )
  );
}

function artifactCoversParent(
  artifact: TerritoryRegistryArtifact,
  parentId: string | undefined
): boolean {
  if (!parentId || !Array.isArray(artifact.coveredParentIds)) {
    return true;
  }

  return artifact.coveredParentIds.includes(parentId);
}

function readCoverageStatus(
  artifact: TerritoryRegistryArtifact,
  dataset: TerritoryRegistryDataset
): TerritoryCoverageStatus {
  const artifactCoverageStatus = artifact.coverageStatus;

  if (artifactCoverageStatus && TERRITORY_COVERAGE_STATUSES.includes(artifactCoverageStatus)) {
    return artifactCoverageStatus;
  }

  const datasetCoverageStatus = dataset.coverageStatus;

  if (
    typeof datasetCoverageStatus === "string" &&
    TERRITORY_COVERAGE_STATUSES.includes(datasetCoverageStatus as TerritoryCoverageStatus)
  ) {
    return datasetCoverageStatus as TerritoryCoverageStatus;
  }

  return artifact.partialCoverage ? "partial" : "generated";
}

function artifactMatchesRequest(
  artifact: TerritoryRegistryArtifact,
  request: TerritoryRegistryResolveArtifactOptions
): boolean {
  if (request.path) {
    return artifact.path === request.path;
  }

  if (request.purpose && artifact.purpose !== request.purpose) {
    return false;
  }

  if (request.levels && !includesEvery(artifact.levels, request.levels)) {
    return false;
  }

  if (request.detail && artifact.detail && artifact.detail !== request.detail) {
    return false;
  }

  if (request.formatPreference && !request.formatPreference.includes(artifact.format)) {
    return false;
  }

  return true;
}

function compareFormatPreference(
  left: TerritoryRegistryArtifact,
  right: TerritoryRegistryArtifact,
  preference: readonly string[] | undefined
): number {
  if (!preference) {
    return 0;
  }

  const leftIndex = preference.indexOf(left.format);
  const rightIndex = preference.indexOf(right.format);
  return (
    (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
    (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex)
  );
}

function selectInstallArtifacts(
  dataset: TerritoryRegistryDataset,
  request: TerritoryRegistryInstallOptions
): TerritoryRegistryArtifact[] {
  const requestedLevels = normalizeLevels(request.levels ?? dataset.levels);
  const selected = dataset.artifacts.filter((artifact) => {
    if (artifact.purpose === "metadata") {
      return true;
    }

    if (artifact.purpose === "query") {
      return levelsOverlap(artifact.levels, requestedLevels);
    }

    if (artifact.purpose === "adjacency") {
      return Boolean(request.loadAdjacency) && levelsOverlap(artifact.levels, requestedLevels);
    }

    return false;
  });

  if (selected.length === 0) {
    throw new TerritoryError(
      "ARTIFACT_NOT_FOUND",
      `Registry dataset ${dataset.id} has no installable query artifacts.`,
      { details: { datasetId: dataset.id } }
    );
  }

  return selected;
}

function levelsOverlap(
  artifactLevels: readonly TerritoryAdminLevel[] | undefined,
  requestedLevels: readonly TerritoryAdminLevel[]
): boolean {
  if (!artifactLevels || artifactLevels.length === 0) {
    return true;
  }

  const requested = new Set(requestedLevels);
  return artifactLevels.some((level) => requested.has(level));
}

function normalizeLevels(levels: readonly TerritoryAdminLevel[]): TerritoryAdminLevel[] {
  return [...new Set(levels)].sort((left, right) => Number(left.slice(3)) - Number(right.slice(3)));
}

function createCacheKey(
  dataset: TerritoryRegistryDataset,
  artifact: TerritoryRegistryArtifact
): TerritoryRegistryArtifactCacheKey {
  return {
    datasetId: dataset.id,
    version: dataset.version,
    artifactId: artifact.id
  };
}

function createInstalledDatasetHandle(
  dataset: TerritoryRegistryDataset,
  registryHash: string,
  artifacts: readonly TerritoryRegistryCachedArtifact[]
): TerritoryInstalledDatasetHandle {
  const byPath = new Map(
    artifacts
      .map((artifact) => [artifact.artifact.path ?? artifact.artifact.id, artifact] as const)
      .sort(([left], [right]) => compareStrings(left, right))
  );
  const installedAt =
    artifacts.map((artifact) => artifact.metadata.installedAt).sort(compareStrings)[0] ??
    new Date(0).toISOString();

  async function readBytes(path: string): Promise<Uint8Array> {
    const artifact = byPath.get(path);

    if (!artifact) {
      throw new Error(`Installed dataset ${dataset.id} does not include '${path}'.`);
    }

    return artifact.bytes;
  }

  async function readText(path: string): Promise<string> {
    return bytesToText(await readBytes(path));
  }

  return {
    dataset,
    registryHash,
    installedArtifacts: artifacts,
    manifest: {
      datasetId: dataset.id,
      version: dataset.version,
      artifactCount: artifacts.length,
      installedAt,
      verified: true,
      registryHash
    },
    readBytes,
    readText,
    async resolveArtifact(path) {
      return readText(path);
    }
  };
}
