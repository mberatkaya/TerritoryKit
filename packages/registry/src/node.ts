import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { brotliDecompress, gunzip } from "node:zlib";
import { promisify } from "node:util";
import type { TerritoryAdminLevel } from "@territory-kit/dataset";
import { createTerritoryRegistryClient } from "./client.js";
import { validateTerritoryDatasetRegistry } from "./schema.js";
import type {
  TerritoryDatasetRegistry,
  TerritoryRegistryArtifact,
  TerritoryRegistryArtifactFormat,
  TerritoryInstalledArtifactMetadata,
  TerritoryInstalledDatasetSummary,
  TerritoryRegistryArtifactCacheKey,
  TerritoryRegistryCache,
  TerritoryRegistryClient,
  TerritoryRegistryClientOptions,
  TerritoryRegistryDataset,
  TerritoryRegistrySnapshot,
  TerritoryRegistryTransport
} from "./types.js";
import { joinUrl, serializeJsonStable } from "./utils.js";

const gunzipAsync = promisify(gunzip);
const brotliDecompressAsync = promisify(brotliDecompress);

export interface NodeTerritoryRegistryClientOptions extends Omit<
  TerritoryRegistryClientOptions,
  "cache" | "transport" | "decompressArtifactBytes"
> {
  cache?: TerritoryRegistryCache | false;
  cacheDir?: string;
  transport?: TerritoryRegistryTransport;
}

export function createNodeTerritoryRegistryClient(
  options: NodeTerritoryRegistryClientOptions
): TerritoryRegistryClient {
  return createTerritoryRegistryClient({
    ...options,
    cache:
      options.cache === false
        ? false
        : (options.cache ??
          createNodeTerritoryRegistryCache({
            ...(options.cacheDir ? { rootDir: options.cacheDir } : {})
          })),
    transport: options.transport ?? createNodeRegistryTransport(),
    decompressArtifactBytes
  });
}

export function createNodeRegistryTransport(): TerritoryRegistryTransport {
  return {
    async fetch(request) {
      if (request.url.startsWith("file:")) {
        const path = fileURLToPath(request.url);
        const bytes = new Uint8Array(await readFile(path));

        if (request.maxBytes && bytes.byteLength > request.maxBytes) {
          throw new Error(`File response exceeded maxBytes for ${request.url}.`);
        }

        return {
          bytes,
          url: request.url,
          sizeBytes: bytes.byteLength
        };
      }

      if (/^[./]|^[A-Za-z]:/.test(request.url)) {
        const absolutePath = resolve(request.url);
        const bytes = new Uint8Array(await readFile(absolutePath));

        if (request.maxBytes && bytes.byteLength > request.maxBytes) {
          throw new Error(`File response exceeded maxBytes for ${request.url}.`);
        }

        return {
          bytes,
          url: pathToFileURL(absolutePath).toString(),
          sizeBytes: bytes.byteLength
        };
      }

      const controller = new AbortController();
      const timeout = request.timeoutMs
        ? setTimeout(() => controller.abort(), request.timeoutMs)
        : undefined;
      const linkedAbort = () => controller.abort();
      request.signal?.addEventListener("abort", linkedAbort, { once: true });

      try {
        const response = await fetch(request.url, {
          signal: controller.signal,
          redirect: "follow"
        });

        if (!response.ok) {
          throw new Error(
            `Failed to fetch ${request.url}: ${response.status} ${response.statusText}`
          );
        }

        const contentLength = response.headers.get("content-length");

        if (
          request.maxBytes &&
          contentLength &&
          Number.isFinite(Number(contentLength)) &&
          Number(contentLength) > request.maxBytes
        ) {
          throw new Error(`Response exceeded maxBytes for ${request.url}.`);
        }

        const bytes = new Uint8Array(await response.arrayBuffer());

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
          clearTimeout(timeout);
        }

        request.signal?.removeEventListener("abort", linkedAbort);
      }
    }
  };
}

export interface NodeTerritoryRegistryCacheOptions {
  rootDir?: string;
}

export function createNodeTerritoryRegistryCache(
  options: NodeTerritoryRegistryCacheOptions = {}
): TerritoryRegistryCache {
  const rootDir = resolve(options.rootDir ?? getDefaultTerritoryRegistryCacheDir());

  return {
    async getArtifact(key) {
      const directory = artifactDirectory(rootDir, key);
      const metadata = await readJson<TerritoryInstalledArtifactMetadata>(
        join(directory, "metadata.json")
      );

      if (!metadata) {
        return undefined;
      }

      const artifactBytes = new Uint8Array(await readFile(join(directory, "artifact")));

      if (
        metadata.sha256 !== sha256Hex(artifactBytes) ||
        metadata.sizeBytes !== artifactBytes.byteLength
      ) {
        await rm(directory, { recursive: true, force: true });
        return undefined;
      }

      return {
        key,
        artifact: {
          id: key.artifactId,
          purpose: "query",
          format: "territory-json",
          url: metadata.sourceUrl,
          sha256: metadata.sha256,
          sizeBytes: metadata.sizeBytes,
          compression: metadata.compression,
          ...(metadata.path ? { path: metadata.path } : {})
        },
        metadata,
        bytes: await decompressArtifactBytes(artifactBytes, metadata.compression)
      };
    },

    async putArtifact(input) {
      const directory = artifactDirectory(rootDir, input.key);
      const tempDirectory = `${directory}.tmp-${process.pid}-${Date.now()}`;
      await mkdir(tempDirectory, { recursive: true });

      try {
        await writeFile(join(tempDirectory, "artifact"), input.bytes);
        await writeFile(
          join(tempDirectory, "metadata.json"),
          serializeJsonStable(input.metadata),
          "utf8"
        );
        await rm(directory, { recursive: true, force: true });
        await mkdir(dirname(directory), { recursive: true });
        await rename(tempDirectory, directory);
      } catch (error) {
        await rm(tempDirectory, { recursive: true, force: true });
        throw error;
      }

      return {
        key: input.key,
        artifact: input.artifact,
        metadata: input.metadata,
        bytes:
          input.decodedBytes ??
          (await decompressArtifactBytes(input.bytes, input.metadata.compression))
      };
    },

    async removeDataset(datasetId, version) {
      const datasetDir = join(rootDir, "datasets", sanitizeSegment(datasetId));

      if (version) {
        await rm(join(datasetDir, sanitizeSegment(version)), { recursive: true, force: true });
      } else {
        await rm(datasetDir, { recursive: true, force: true });
      }
    },

    async listInstalledDatasets() {
      const result: TerritoryInstalledDatasetSummary[] = [];
      const datasetsDir = join(rootDir, "datasets");

      for (const datasetId of await readDirNames(datasetsDir)) {
        for (const version of await readDirNames(join(datasetsDir, datasetId))) {
          const artifactsDir = join(datasetsDir, datasetId, version);
          const metadataFiles = await collectMetadataFiles(artifactsDir);
          const metadata = (
            await Promise.all(
              metadataFiles.map((file) => readJson<TerritoryInstalledArtifactMetadata>(file))
            )
          ).filter((item): item is TerritoryInstalledArtifactMetadata => Boolean(item));

          if (metadata.length === 0) {
            continue;
          }

          result.push({
            datasetId: metadata[0]!.datasetId,
            version: metadata[0]!.version,
            artifactCount: metadata.length,
            installedAt: metadata.map((item) => item.installedAt).sort()[0]!,
            verified: true,
            registryHash: metadata[0]!.registryHash
          });
        }
      }

      return result.sort((left, right) =>
        `${left.datasetId}@${left.version}`.localeCompare(`${right.datasetId}@${right.version}`)
      );
    },

    async writeRegistrySnapshot(snapshot) {
      const file = registrySnapshotPath(rootDir, snapshot.registryUrl);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, serializeJsonStable(snapshot), "utf8");
    },

    async readRegistrySnapshot(registryUrl) {
      return readJson<TerritoryRegistrySnapshot>(registrySnapshotPath(rootDir, registryUrl));
    },

    async clear() {
      await rm(rootDir, { recursive: true, force: true });
    }
  };
}

export async function readRegistryFile(path: string): Promise<TerritoryDatasetRegistry> {
  const input = JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
  const validation = validateTerritoryDatasetRegistry(input);

  if (!validation.ok || !validation.registry) {
    throw new Error(
      `Registry validation failed: ${validation.issues.map((issue) => issue.message).join("; ")}`
    );
  }

  return validation.registry;
}

export interface BuildTerritoryDatasetRegistryOptions {
  inputPath: string;
  baseUrl: string;
  generatedAt?: string;
}

export async function buildTerritoryDatasetRegistryFromArtifacts(
  options: BuildTerritoryDatasetRegistryOptions
): Promise<TerritoryDatasetRegistry> {
  const inputPath = resolve(options.inputPath);
  const roots = await discoverDatasetArtifactRoots(inputPath);
  const datasets = [];

  for (const root of roots) {
    const rootPrefix = relative(inputPath, root).split("\\").join("/");
    const manifest = await readJson<Record<string, unknown>>(join(root, "manifest.json"));
    const checksums = await readJson<{ files: Record<string, string> }>(
      join(root, "checksums.json")
    );

    if (!manifest || !checksums) {
      continue;
    }

    const datasetId = readRequiredString(manifest, "datasetId");
    const country = isRecord(manifest.country)
      ? {
          ...(typeof manifest.country.alpha2 === "string"
            ? { alpha2: manifest.country.alpha2 }
            : {}),
          ...(typeof manifest.country.alpha3 === "string"
            ? { alpha3: manifest.country.alpha3 }
            : {}),
          ...(typeof manifest.country.name === "string" ? { name: manifest.country.name } : {})
        }
      : undefined;
    const displayName =
      readOptionalString(manifest, "displayName", "name", "datasetName") ??
      country?.name ??
      datasetId;
    const datasetVersion = readOptionalString(manifest, "datasetVersion", "version") ?? "1.0.0";
    const schemaVersion = readRequiredString(manifest, "schemaVersion");
    const supportedLevels = readStringArray(manifest.supportedLevels);
    const artifacts: TerritoryRegistryArtifact[] = [];

    for (const [relativePath, sha256] of Object.entries(checksums.files).sort(([left], [right]) =>
      left.localeCompare(right)
    )) {
      if (relativePath === "checksums.json") {
        continue;
      }

      const filePath = join(root, relativePath);
      const fileStats = await stat(filePath);
      const level = /(?:^|\/)(ADM\d+)(?:\/(?:dataset|adjacency)\.json|\/index\/index\.tksi)$/.exec(
        relativePath
      )?.[1];
      const purpose = relativePath.endsWith(".tksi")
        ? "index"
        : relativePath.startsWith("levels/")
          ? "query"
          : relativePath.startsWith("adjacency/") && relativePath.endsWith("/adjacency.json")
            ? "adjacency"
            : "metadata";
      const format = inferArtifactFormat(relativePath);

      artifacts.push({
        id: createArtifactId(relativePath),
        purpose,
        format,
        ...(level ? { levels: [level as TerritoryAdminLevel] } : {}),
        path: relativePath,
        url: encodeRelativeUrl(joinUrlPath(rootPrefix === "." ? "" : rootPrefix, relativePath)),
        sha256,
        sizeBytes: fileStats.size,
        compression: "none",
        contentType: inferArtifactContentType(relativePath)
      });
    }

    if (!artifacts.some((artifact) => artifact.path === "checksums.json")) {
      const checksumsPath = join(root, "checksums.json");
      const checksumsBytes = new Uint8Array(await readFile(checksumsPath));
      artifacts.push({
        id: "checksums-json",
        purpose: "metadata",
        format: "territory-json",
        path: "checksums.json",
        url: encodeRelativeUrl(joinUrlPath(rootPrefix === "." ? "" : rootPrefix, "checksums.json")),
        sha256: sha256Hex(checksumsBytes),
        sizeBytes: checksumsBytes.byteLength,
        compression: "none",
        contentType: "application/json"
      });
    }

    const renderManifestPath = join(root, "render", "manifest.json");

    if (await pathExists(renderManifestPath)) {
      const renderBytes = new Uint8Array(await readFile(renderManifestPath));
      const renderManifest = JSON.parse(new TextDecoder().decode(renderBytes)) as Record<
        string,
        unknown
      >;
      const tileTemplate =
        typeof renderManifest.tileTemplate === "string"
          ? renderManifest.tileTemplate
          : "tiles/{z}/{x}/{y}.mvt";
      const renderFormat = renderManifest.format === "geojson" ? "geojson" : "mvt";
      const renderArtifactVersion =
        typeof renderManifest.renderArtifactVersion === "string"
          ? renderManifest.renderArtifactVersion
          : "1";
      const datasetContentHash =
        typeof renderManifest.datasetContentHash === "string"
          ? renderManifest.datasetContentHash
          : undefined;
      const identityMapHash =
        typeof renderManifest.identityMapHash === "string"
          ? renderManifest.identityMapHash
          : undefined;

      artifacts.push({
        id: "render-manifest",
        purpose: "render",
        format: renderFormat,
        path: "render/manifest.json",
        url: encodeRelativeUrl(
          joinUrlPath(rootPrefix === "." ? "" : rootPrefix, "render/manifest.json")
        ),
        sha256: sha256Hex(renderBytes),
        sizeBytes: renderBytes.byteLength,
        compression: "none",
        contentType: "application/json",
        tileUrlTemplate: encodeRelativeUrl(
          joinUrlPath(rootPrefix === "." ? "" : rootPrefix, "render", tileTemplate)
        ),
        renderArtifactVersion,
        ...(datasetContentHash ? { datasetContentHash } : {}),
        ...(identityMapHash ? { identityMapHash } : {})
      });
    }

    const sourceVersion = readOptionalString(manifest, "sourceVersion");
    datasets.push({
      id: datasetId,
      displayName,
      version: datasetVersion,
      schemaVersion,
      ...(country ? { country } : {}),
      levels: supportedLevels,
      source: {
        provider: readOptionalString(manifest, "sourceProvider") ?? "local-artifacts",
        ...(sourceVersion ? { version: sourceVersion } : {})
      },
      license: {
        id: readOptionalString(manifest, "licenseId") ?? "unknown",
        name: readOptionalString(manifest, "licenseName") ?? "Unknown",
        attribution:
          readOptionalString(manifest, "attribution") ??
          readOptionalString(manifest, "licenseAttribution") ??
          "See dataset manifest for attribution."
      },
      artifacts
    });
  }

  return {
    registryVersion: "1",
    generatedAt: options.generatedAt ?? new Date(0).toISOString(),
    baseUrl: options.baseUrl,
    datasets: datasets.sort((left, right) =>
      `${left.id}@${left.version}`.localeCompare(`${right.id}@${right.version}`)
    )
  };
}

export interface TerritoryRegistryObjectMetadata {
  key: string;
  sizeBytes: number;
  sha256?: string;
  etag?: string;
  contentType?: string;
  cacheControl?: string;
  lastModified?: string;
  metadata?: Readonly<Record<string, string>>;
}

export interface TerritoryRegistryObjectPutInput {
  key: string;
  bytes: Uint8Array;
  contentType?: string;
  cacheControl?: string;
  metadata?: Readonly<Record<string, string>>;
  immutable?: boolean;
  allowOverwrite?: boolean;
}

export interface TerritoryRegistryReadableObjectStore {
  readonly kind: string;
  headObject(key: string): Promise<TerritoryRegistryObjectMetadata | undefined>;
  getObject?(key: string): Promise<TerritoryRegistryObjectMetadata & { bytes: Uint8Array }>;
  getPublicUrl?(key: string): string;
}

export interface TerritoryRegistryWritableObjectStore extends TerritoryRegistryReadableObjectStore {
  putObject(input: TerritoryRegistryObjectPutInput): Promise<TerritoryRegistryObjectMetadata>;
  deleteObject?(key: string): Promise<void>;
}

export interface LocalTerritoryRegistryPublishTargetOptions {
  rootDir: string;
  publicBaseUrl?: string;
}

export function createLocalTerritoryRegistryPublishTarget(
  options: LocalTerritoryRegistryPublishTargetOptions
): TerritoryRegistryWritableObjectStore {
  const rootDir = resolve(options.rootDir);

  function pathForKey(key: string): string {
    return join(rootDir, normalizeObjectKey(key));
  }

  return {
    kind: "local",
    async headObject(key) {
      const file = pathForKey(key);

      try {
        const stats = await stat(file);

        if (!stats.isFile()) {
          return undefined;
        }

        const sha256 = await sha256File(file);

        return {
          key: normalizeObjectKey(key),
          sizeBytes: stats.size,
          sha256,
          etag: quoteEtag(sha256),
          lastModified: stats.mtime.toUTCString()
        };
      } catch {
        return undefined;
      }
    },
    async getObject(key) {
      const normalizedKey = normalizeObjectKey(key);
      const file = pathForKey(normalizedKey);
      const bytes = new Uint8Array(await readFile(file));
      const sha256 = sha256Hex(bytes);
      const stats = await stat(file);

      return {
        key: normalizedKey,
        bytes,
        sizeBytes: bytes.byteLength,
        sha256,
        etag: quoteEtag(sha256),
        lastModified: stats.mtime.toUTCString()
      };
    },
    async putObject(input) {
      const key = normalizeObjectKey(input.key);
      const file = pathForKey(key);

      if (!input.allowOverwrite && (await pathExists(file))) {
        throw new Error(`Object '${key}' already exists.`);
      }

      await mkdir(dirname(file), { recursive: true });
      const tempFile = join(
        dirname(file),
        `.${key.split("/").at(-1) ?? "object"}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`
      );

      try {
        await writeFile(tempFile, input.bytes);
        await rename(tempFile, file);
      } catch (error) {
        await rm(tempFile, { force: true });
        throw error;
      }

      const sha256 = sha256Hex(input.bytes);

      return {
        key,
        sizeBytes: input.bytes.byteLength,
        sha256,
        etag: quoteEtag(sha256),
        ...(input.contentType ? { contentType: input.contentType } : {}),
        ...(input.cacheControl ? { cacheControl: input.cacheControl } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {})
      };
    },
    async deleteObject(key) {
      await rm(pathForKey(key), { force: true });
    },
    getPublicUrl(key) {
      const normalizedKey = normalizeObjectKey(key);

      if (options.publicBaseUrl) {
        return joinUrl(options.publicBaseUrl, encodeObjectKeyForUrl(normalizedKey));
      }

      return pathToFileURL(pathForKey(normalizedKey)).toString();
    }
  };
}

export interface HttpTerritoryRegistryReadTargetOptions {
  baseUrl: string;
  transport?: TerritoryRegistryTransport;
}

export function createHttpTerritoryRegistryReadTarget(
  options: HttpTerritoryRegistryReadTargetOptions
): TerritoryRegistryReadableObjectStore {
  const transport = options.transport ?? createNodeRegistryTransport();

  function objectUrl(key: string): string {
    return joinUrl(options.baseUrl, encodeObjectKeyForUrl(normalizeObjectKey(key)));
  }

  return {
    kind: "http",
    async headObject(key) {
      try {
        const response = await transport.fetch({ url: objectUrl(key) });

        return {
          key: normalizeObjectKey(key),
          sizeBytes: response.sizeBytes ?? response.bytes.byteLength,
          ...(response.contentType ? { contentType: response.contentType } : {}),
          ...(response.etag ? { etag: response.etag } : {}),
          ...(response.lastModified ? { lastModified: response.lastModified } : {})
        };
      } catch {
        return undefined;
      }
    },
    async getObject(key) {
      const normalizedKey = normalizeObjectKey(key);
      const response = await transport.fetch({ url: objectUrl(normalizedKey) });
      const sha256 = sha256Hex(response.bytes);

      return {
        key: normalizedKey,
        bytes: response.bytes,
        sizeBytes: response.sizeBytes ?? response.bytes.byteLength,
        sha256,
        ...(response.contentType ? { contentType: response.contentType } : {}),
        ...(response.etag ? { etag: response.etag } : {}),
        ...(response.lastModified ? { lastModified: response.lastModified } : {})
      };
    },
    getPublicUrl: objectUrl
  };
}

export interface S3CompatibleRegistryObjectClient {
  headObject(
    input: S3CompatibleRegistryObjectRequest
  ): Promise<S3CompatibleRegistryObjectMetadata | undefined>;
  getObject(
    input: S3CompatibleRegistryObjectRequest
  ): Promise<S3CompatibleRegistryObjectMetadata & { body: Uint8Array }>;
  putObject(
    input: S3CompatibleRegistryPutObjectRequest
  ): Promise<S3CompatibleRegistryObjectMetadata>;
  deleteObject(input: S3CompatibleRegistryObjectRequest): Promise<void>;
}

export interface S3CompatibleRegistryObjectRequest {
  bucket: string;
  key: string;
}

export interface S3CompatibleRegistryPutObjectRequest extends S3CompatibleRegistryObjectRequest {
  body: Uint8Array;
  contentType?: string;
  cacheControl?: string;
  metadata?: Readonly<Record<string, string>>;
  ifNoneMatch?: "*";
}

export interface S3CompatibleRegistryObjectMetadata {
  sizeBytes: number;
  sha256?: string;
  etag?: string;
  contentType?: string;
  cacheControl?: string;
  lastModified?: string;
  metadata?: Readonly<Record<string, string>>;
}

export interface S3CompatibleTerritoryRegistryPublishTargetOptions {
  client: S3CompatibleRegistryObjectClient;
  bucket: string;
  prefix?: string;
  publicBaseUrl?: string;
}

export function createS3CompatibleTerritoryRegistryPublishTarget(
  options: S3CompatibleTerritoryRegistryPublishTargetOptions
): TerritoryRegistryWritableObjectStore {
  function s3Key(key: string): string {
    return joinObjectKey(options.prefix ?? "", normalizeObjectKey(key));
  }

  function metadataForKey(
    key: string,
    metadata: S3CompatibleRegistryObjectMetadata
  ): TerritoryRegistryObjectMetadata {
    return {
      key: normalizeObjectKey(key),
      sizeBytes: metadata.sizeBytes,
      ...(metadata.sha256 ? { sha256: metadata.sha256 } : {}),
      ...(metadata.etag ? { etag: metadata.etag } : {}),
      ...(metadata.contentType ? { contentType: metadata.contentType } : {}),
      ...(metadata.cacheControl ? { cacheControl: metadata.cacheControl } : {}),
      ...(metadata.lastModified ? { lastModified: metadata.lastModified } : {}),
      ...(metadata.metadata ? { metadata: metadata.metadata } : {})
    };
  }

  return {
    kind: "s3-compatible",
    async headObject(key) {
      try {
        const normalizedKey = normalizeObjectKey(key);
        const metadata = await options.client.headObject({
          bucket: options.bucket,
          key: s3Key(normalizedKey)
        });

        return metadata ? metadataForKey(normalizedKey, metadata) : undefined;
      } catch (error) {
        if (isObjectNotFoundError(error)) {
          return undefined;
        }

        throw error;
      }
    },
    async getObject(key) {
      const normalizedKey = normalizeObjectKey(key);
      const object = await options.client.getObject({
        bucket: options.bucket,
        key: s3Key(normalizedKey)
      });

      return {
        ...metadataForKey(normalizedKey, object),
        bytes: object.body
      };
    },
    async putObject(input) {
      const key = normalizeObjectKey(input.key);
      const metadata = await options.client.putObject({
        bucket: options.bucket,
        key: s3Key(key),
        body: input.bytes,
        ...(input.contentType ? { contentType: input.contentType } : {}),
        ...(input.cacheControl ? { cacheControl: input.cacheControl } : {}),
        metadata: {
          ...(input.metadata ?? {}),
          "territory-kit-sha256": sha256Hex(input.bytes)
        },
        ...(!input.allowOverwrite && input.immutable ? { ifNoneMatch: "*" as const } : {})
      });

      return metadataForKey(key, metadata);
    },
    async deleteObject(key) {
      await options.client.deleteObject({
        bucket: options.bucket,
        key: s3Key(normalizeObjectKey(key))
      });
    },
    ...(options.publicBaseUrl
      ? {
          getPublicUrl(key: string) {
            return joinUrl(options.publicBaseUrl, encodeObjectKeyForUrl(normalizeObjectKey(key)));
          }
        }
      : {})
  };
}

export interface TerritoryRegistryPublishProvenance {
  sourceRepository?: string;
  sourceCommit?: string;
  sourceBranch?: string;
  workflowRunId?: string;
  buildId?: string;
  builtAt?: string;
  builder?: string;
  command?: string;
  artifactRoot?: string;
  [key: string]: unknown;
}

export interface TerritoryRegistryPublishCacheOptions {
  immutableArtifacts?: string;
  immutableRegistry?: string;
  mutableRegistry?: string;
  inventory?: string;
  rollback?: string;
}

export interface TerritoryRegistryPublishOptions {
  artifactRoot: string;
  target: TerritoryRegistryWritableObjectStore;
  datasetId: string;
  version: string;
  baseUrl: string;
  alias?: string | false;
  generatedAt?: string;
  publishedAt?: string;
  artifactKeyPrefix?: string;
  registryKey?: string;
  immutableRegistryKey?: string;
  inventoryKey?: string;
  rollbackKey?: string;
  cacheControl?: TerritoryRegistryPublishCacheOptions;
  provenance?: TerritoryRegistryPublishProvenance;
  dryRun?: boolean;
  allowOverwrite?: boolean;
  smokeTest?: boolean;
  smokeRegistryUrl?: string;
}

export interface TerritoryRegistryArtifactInventoryFile {
  path: string;
  objectKey: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
  cacheControl: string;
  etag: string;
  immutable: true;
}

export interface TerritoryRegistryArtifactInventory {
  inventoryVersion: "territorykit-artifact-inventory@1";
  datasetId: string;
  version: string;
  generatedAt: string;
  baseUrl: string;
  artifactKeyPrefix: string;
  artifactCount: number;
  totalSizeBytes: number;
  files: TerritoryRegistryArtifactInventoryFile[];
  registry: {
    activeRegistryKey: string;
    immutableRegistryKey: string;
    inventoryKey: string;
    rollbackKey: string;
  };
  provenance: TerritoryRegistryPublishProvenance;
}

export interface TerritoryRegistryRollbackManifest {
  rollbackVersion: "territorykit-registry-rollback@1";
  datasetId: string;
  version: string;
  alias?: string;
  createdAt: string;
  activeRegistryKey: string;
  immutableRegistryKey: string;
  previous?: {
    registryHash: string;
    generatedAt: string;
    datasetVersions: string[];
    registry: TerritoryDatasetRegistry;
  };
  restore: {
    action: "replace-active-registry";
    fromPreviousRegistryHash?: string;
    targetRegistryKey: string;
  };
}

export interface TerritoryRegistryPublishResult {
  ok: true;
  dryRun: boolean;
  datasetId: string;
  version: string;
  alias?: string;
  artifactKeyPrefix: string;
  registryKey: string;
  immutableRegistryKey: string;
  inventoryKey: string;
  rollbackKey: string;
  artifactCount: number;
  totalSizeBytes: number;
  uploadedKeys: string[];
  inventory: TerritoryRegistryArtifactInventory;
  smokeTest?: TerritoryRegistryPublicationVerifyResult;
}

export async function publishTerritoryDatasetRegistry(
  options: TerritoryRegistryPublishOptions
): Promise<TerritoryRegistryPublishResult> {
  assertSafeAlias(options.alias);
  assertSafeDatasetVersion(options.datasetId, options.version);

  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const publishedAt = options.publishedAt ?? generatedAt;
  const alias = options.alias === false ? undefined : (options.alias ?? "latest");
  const cacheControl = {
    immutableArtifacts:
      options.cacheControl?.immutableArtifacts ?? "public, max-age=31536000, immutable",
    immutableRegistry:
      options.cacheControl?.immutableRegistry ?? "public, max-age=31536000, immutable",
    mutableRegistry: options.cacheControl?.mutableRegistry ?? "public, max-age=60",
    inventory: options.cacheControl?.inventory ?? "public, max-age=31536000, immutable",
    rollback: options.cacheControl?.rollback ?? "private, max-age=0, no-store"
  };
  const artifactKeyPrefix = normalizeObjectKey(
    options.artifactKeyPrefix ??
      deriveArtifactKeyPrefix(options.baseUrl, options.datasetId, options.version)
  );
  const registryKey = normalizeObjectKey(options.registryKey ?? "registry.json");
  const immutableRegistryKey = normalizeObjectKey(
    options.immutableRegistryKey ?? joinObjectKey(artifactKeyPrefix, "registry.json")
  );
  const inventoryKey = normalizeObjectKey(
    options.inventoryKey ?? joinObjectKey(artifactKeyPrefix, "inventory.json")
  );
  const rollbackKey = normalizeObjectKey(
    options.rollbackKey ??
      joinObjectKey("rollback", options.datasetId, `${options.version}.rollback.json`)
  );
  const artifactRoot = resolve(options.artifactRoot);
  const provenance: TerritoryRegistryPublishProvenance = {
    builder: "territory-kit-registry-publisher@1",
    builtAt: publishedAt,
    artifactRoot,
    ...(options.provenance ?? {})
  };
  const inventoryFiles = await readPublishArtifactInventory({
    artifactRoot,
    artifactKeyPrefix,
    baseUrl: options.baseUrl,
    cacheControl: cacheControl.immutableArtifacts
  });
  const inventoryByPath = new Map(inventoryFiles.map((file) => [file.path, file]));
  const builtRegistry = await buildTerritoryDatasetRegistryFromArtifacts({
    inputPath: artifactRoot,
    baseUrl: options.baseUrl,
    generatedAt
  });

  if (builtRegistry.datasets.length !== 1) {
    throw new Error(
      `Publish expects one artifact root; found ${builtRegistry.datasets.length} dataset roots.`
    );
  }

  const sourceDataset = builtRegistry.datasets[0]!;

  if (sourceDataset.id !== options.datasetId) {
    throw new Error(
      `Artifact manifest datasetId '${sourceDataset.id}' does not match --dataset '${options.datasetId}'.`
    );
  }

  if (sourceDataset.version !== options.version) {
    throw new Error(
      `Artifact manifest version '${sourceDataset.version}' does not match --version '${options.version}'.`
    );
  }

  const immutableDataset = enhancePublishedDataset(sourceDataset, {
    baseUrl: options.baseUrl,
    inventoryByPath,
    absoluteUrls: false,
    cacheControl: cacheControl.immutableArtifacts,
    publishedAt,
    provenance
  });
  const activeDataset = enhancePublishedDataset(sourceDataset, {
    baseUrl: options.baseUrl,
    inventoryByPath,
    absoluteUrls: true,
    cacheControl: cacheControl.immutableArtifacts,
    publishedAt,
    provenance
  });
  const immutableRegistry = createPublishedRegistry({
    registry: {
      ...builtRegistry,
      baseUrl: options.baseUrl,
      datasets: [immutableDataset]
    },
    generatedAt,
    publishedAt,
    alias,
    datasetId: options.datasetId,
    version: options.version,
    activeRegistryKey: registryKey,
    immutableRegistryKey,
    inventoryKey,
    rollbackKey,
    provenance
  });
  const previousRegistry = await readPreviousRegistryFromTarget(options.target, registryKey);

  if (
    previousRegistry?.registry.datasets.some(
      (dataset) => dataset.id === options.datasetId && dataset.version === options.version
    ) &&
    !options.allowOverwrite
  ) {
    throw new Error(
      `Dataset ${options.datasetId}@${options.version} already exists in ${registryKey}.`
    );
  }

  const activeRegistry = createPublishedRegistry({
    registry: {
      registryVersion: "1",
      generatedAt,
      datasets: [
        ...(previousRegistry
          ? canonicalizeRegistryDatasets(previousRegistry.registry).filter(
              (dataset) =>
                !(dataset.id === options.datasetId && dataset.version === options.version)
            )
          : []),
        activeDataset
      ].sort((left, right) =>
        `${left.id}@${left.version}`.localeCompare(`${right.id}@${right.version}`)
      )
    },
    generatedAt,
    publishedAt,
    alias,
    datasetId: options.datasetId,
    version: options.version,
    activeRegistryKey: registryKey,
    immutableRegistryKey,
    inventoryKey,
    rollbackKey,
    provenance,
    ...(previousRegistry?.aliases ? { previousAliases: previousRegistry.aliases } : {})
  });
  const inventory: TerritoryRegistryArtifactInventory = {
    inventoryVersion: "territorykit-artifact-inventory@1",
    datasetId: options.datasetId,
    version: options.version,
    generatedAt,
    baseUrl: options.baseUrl,
    artifactKeyPrefix,
    artifactCount: inventoryFiles.length,
    totalSizeBytes: inventoryFiles.reduce((sum, file) => sum + file.sizeBytes, 0),
    files: inventoryFiles,
    registry: {
      activeRegistryKey: registryKey,
      immutableRegistryKey,
      inventoryKey,
      rollbackKey
    },
    provenance
  };
  const rollback = createRollbackManifest({
    datasetId: options.datasetId,
    version: options.version,
    alias,
    createdAt: publishedAt,
    activeRegistryKey: registryKey,
    immutableRegistryKey,
    previousRegistry
  });
  const immutableUploadKeys = [
    ...inventoryFiles.map((file) => file.objectKey),
    immutableRegistryKey,
    inventoryKey,
    rollbackKey
  ];

  if (!options.allowOverwrite) {
    for (const key of immutableUploadKeys) {
      const existing = await options.target.headObject(key);

      if (existing) {
        throw new Error(`Immutable publish target object '${key}' already exists.`);
      }
    }
  }

  const result: TerritoryRegistryPublishResult = {
    ok: true,
    dryRun: Boolean(options.dryRun),
    datasetId: options.datasetId,
    version: options.version,
    ...(alias ? { alias } : {}),
    artifactKeyPrefix,
    registryKey,
    immutableRegistryKey,
    inventoryKey,
    rollbackKey,
    artifactCount: inventory.artifactCount,
    totalSizeBytes: inventory.totalSizeBytes,
    uploadedKeys: [],
    inventory
  };

  if (options.dryRun) {
    return result;
  }

  const uploadedKeys: string[] = [];

  try {
    for (const file of inventoryFiles) {
      const bytes = new Uint8Array(await readFile(join(artifactRoot, file.path)));
      const metadata = await options.target.putObject({
        key: file.objectKey,
        bytes,
        contentType: file.contentType,
        cacheControl: file.cacheControl,
        metadata: {
          "territory-kit-dataset": options.datasetId,
          "territory-kit-version": options.version,
          "territory-kit-sha256": file.sha256
        },
        immutable: true,
        ...(options.allowOverwrite ? { allowOverwrite: true } : {})
      });
      uploadedKeys.push(file.objectKey);

      if (metadata.sha256 && metadata.sha256 !== file.sha256) {
        throw new Error(`Uploaded object '${file.objectKey}' checksum metadata changed.`);
      }
    }

    await putJsonObject(options.target, inventoryKey, inventory, {
      contentType: "application/json",
      cacheControl: cacheControl.inventory,
      immutable: true,
      ...(options.allowOverwrite ? { allowOverwrite: true } : {})
    });
    uploadedKeys.push(inventoryKey);

    await putJsonObject(options.target, immutableRegistryKey, immutableRegistry, {
      contentType: "application/json",
      cacheControl: cacheControl.immutableRegistry,
      immutable: true,
      ...(options.allowOverwrite ? { allowOverwrite: true } : {})
    });
    uploadedKeys.push(immutableRegistryKey);

    await putJsonObject(options.target, rollbackKey, rollback, {
      contentType: "application/json",
      cacheControl: cacheControl.rollback,
      immutable: true,
      ...(options.allowOverwrite ? { allowOverwrite: true } : {})
    });
    uploadedKeys.push(rollbackKey);

    await putJsonObject(options.target, registryKey, activeRegistry, {
      contentType: "application/json",
      cacheControl: cacheControl.mutableRegistry,
      allowOverwrite: true
    });
    uploadedKeys.push(registryKey);
  } catch (error) {
    await cleanupUploadedObjects(
      options.target,
      uploadedKeys.filter((key) => key !== registryKey)
    );
    throw error;
  }

  result.uploadedKeys = uploadedKeys;

  const smokeRegistryUrl =
    options.smokeRegistryUrl ??
    (options.smokeTest ? options.target.getPublicUrl?.(registryKey) : undefined);

  if (smokeRegistryUrl && options.smokeTest !== false) {
    const smokeTest = await verifyTerritoryRegistryPublication({
      registryUrl: smokeRegistryUrl,
      datasetId: options.datasetId,
      version: options.version
    });

    if (!smokeTest.ok) {
      throw new Error(
        `Post-publish smoke test failed: ${smokeTest.issues
          .filter((issue) => issue.severity === "error")
          .map((issue) => issue.message)
          .join("; ")}`
      );
    }

    result.smokeTest = smokeTest;
  }

  return result;
}

export interface TerritoryRegistryPublicationVerifyOptions {
  registryUrl: string;
  datasetId?: string;
  version?: string;
  transport?: TerritoryRegistryTransport;
  verifyContentType?: boolean;
  verifyEtags?: boolean;
}

export interface TerritoryRegistryPublicationVerifyIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
  path?: string;
  url?: string;
  artifactId?: string;
}

export interface TerritoryRegistryPublicationVerifyResult {
  ok: boolean;
  registryUrl: string;
  registryHash?: string;
  datasetCount: number;
  checkedArtifactCount: number;
  checkedBytes: number;
  issues: TerritoryRegistryPublicationVerifyIssue[];
}

export async function verifyTerritoryRegistryPublication(
  options: TerritoryRegistryPublicationVerifyOptions
): Promise<TerritoryRegistryPublicationVerifyResult> {
  const transport = options.transport ?? createNodeRegistryTransport();
  const issues: TerritoryRegistryPublicationVerifyIssue[] = [];
  let registryBytes: Uint8Array;

  try {
    registryBytes = (await transport.fetch({ url: options.registryUrl })).bytes;
  } catch (error) {
    return {
      ok: false,
      registryUrl: options.registryUrl,
      datasetCount: 0,
      checkedArtifactCount: 0,
      checkedBytes: 0,
      issues: [
        {
          code: "REGISTRY_FETCH_FAILED",
          severity: "error",
          message: error instanceof Error ? error.message : String(error)
        }
      ]
    };
  }

  let registryInput: unknown;

  try {
    registryInput = JSON.parse(new TextDecoder().decode(registryBytes)) as unknown;
  } catch (error) {
    return {
      ok: false,
      registryUrl: options.registryUrl,
      registryHash: sha256Hex(registryBytes),
      datasetCount: 0,
      checkedArtifactCount: 0,
      checkedBytes: 0,
      issues: [
        {
          code: "REGISTRY_JSON_INVALID",
          severity: "error",
          message: error instanceof Error ? error.message : String(error)
        }
      ]
    };
  }

  const validation = validateTerritoryDatasetRegistry(registryInput);

  for (const issueItem of validation.issues) {
    issues.push({
      code: issueItem.code,
      message: issueItem.message,
      severity: issueItem.severity,
      ...(issueItem.path ? { path: issueItem.path } : {})
    });
  }

  if (!validation.ok || !validation.registry) {
    return {
      ok: false,
      registryUrl: options.registryUrl,
      registryHash: sha256Hex(registryBytes),
      datasetCount: 0,
      checkedArtifactCount: 0,
      checkedBytes: 0,
      issues
    };
  }

  const selectedDatasets = validation.registry.datasets.filter(
    (dataset) =>
      (!options.datasetId || dataset.id === options.datasetId) &&
      (!options.version || dataset.version === options.version)
  );

  if (selectedDatasets.length === 0) {
    issues.push({
      code: "DATASET_NOT_FOUND",
      severity: "error",
      message: `Dataset ${options.datasetId ?? "*"}@${options.version ?? "*"} was not found.`
    });
  }

  let checkedArtifactCount = 0;
  let checkedBytes = 0;

  for (const [datasetIndex, dataset] of selectedDatasets.entries()) {
    for (const [artifactIndex, artifact] of dataset.artifacts.entries()) {
      const path = `$.datasets[${datasetIndex}].artifacts[${artifactIndex}]`;
      let artifactUrl: string;

      try {
        artifactUrl = joinUrl(validation.registry.baseUrl, artifact.url);
      } catch (error) {
        issues.push({
          code: "ARTIFACT_URL_RESOLVE_FAILED",
          severity: "error",
          message: error instanceof Error ? error.message : String(error),
          path,
          artifactId: artifact.id
        });
        continue;
      }

      try {
        const response = await transport.fetch({
          url: artifactUrl,
          maxBytes: artifact.sizeBytes + 1
        });
        checkedArtifactCount += 1;
        checkedBytes += response.bytes.byteLength;

        if (response.bytes.byteLength !== artifact.sizeBytes) {
          issues.push({
            code: "ARTIFACT_SIZE_MISMATCH",
            severity: "error",
            message: `Size mismatch for artifact ${artifact.id}.`,
            path,
            url: artifactUrl,
            artifactId: artifact.id
          });
        }

        const actualSha256 = sha256Hex(response.bytes);

        if (actualSha256 !== artifact.sha256) {
          issues.push({
            code: "ARTIFACT_CHECKSUM_MISMATCH",
            severity: "error",
            message: `Checksum mismatch for artifact ${artifact.id}.`,
            path,
            url: artifactUrl,
            artifactId: artifact.id
          });
        }

        if (
          options.verifyContentType &&
          artifact.contentType &&
          response.contentType &&
          normalizeHeaderValue(response.contentType).split(";")[0] !==
            normalizeHeaderValue(artifact.contentType)
        ) {
          issues.push({
            code: "ARTIFACT_CONTENT_TYPE_MISMATCH",
            severity: "warning",
            message: `Content-Type mismatch for artifact ${artifact.id}.`,
            path,
            url: artifactUrl,
            artifactId: artifact.id
          });
        }

        if (
          options.verifyEtags &&
          artifact.etag &&
          response.etag &&
          normalizeEtag(response.etag) !== normalizeEtag(artifact.etag)
        ) {
          issues.push({
            code: "ARTIFACT_ETAG_MISMATCH",
            severity: "warning",
            message: `ETag mismatch for artifact ${artifact.id}.`,
            path,
            url: artifactUrl,
            artifactId: artifact.id
          });
        }
      } catch (error) {
        issues.push({
          code: "ARTIFACT_FETCH_FAILED",
          severity: "error",
          message: error instanceof Error ? error.message : String(error),
          path,
          url: artifactUrl,
          artifactId: artifact.id
        });
      }
    }
  }

  return {
    ok: issues.every((issueItem) => issueItem.severity !== "error"),
    registryUrl: options.registryUrl,
    registryHash: sha256Hex(registryBytes),
    datasetCount: selectedDatasets.length,
    checkedArtifactCount,
    checkedBytes,
    issues
  };
}

interface ReadPublishArtifactInventoryOptions {
  artifactRoot: string;
  artifactKeyPrefix: string;
  baseUrl: string;
  cacheControl: string;
}

async function readPublishArtifactInventory(
  options: ReadPublishArtifactInventoryOptions
): Promise<TerritoryRegistryArtifactInventoryFile[]> {
  const manifestPath = join(options.artifactRoot, "manifest.json");
  const checksums = await readJson<{ files?: Record<string, string> }>(
    join(options.artifactRoot, "checksums.json")
  );

  if (!(await pathExists(manifestPath))) {
    throw new Error("Artifact root is missing manifest.json.");
  }

  if (!checksums?.files || !isRecord(checksums.files)) {
    throw new Error("Artifact root is missing checksums.json files metadata.");
  }

  const files = new Map<string, string>(Object.entries(checksums.files));

  if (!files.has("manifest.json")) {
    throw new Error("checksums.json must include manifest.json.");
  }

  const checksumBytes = new Uint8Array(
    await readFile(join(options.artifactRoot, "checksums.json"))
  );
  files.set("checksums.json", sha256Hex(checksumBytes));

  const inventory: TerritoryRegistryArtifactInventoryFile[] = [];

  for (const [relativePath, expectedSha256] of [...files.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const normalizedPath = normalizeObjectKey(relativePath);
    const filePath = join(options.artifactRoot, normalizedPath);
    const bytes = new Uint8Array(await readFile(filePath));
    const actualSha256 = sha256Hex(bytes);

    if (actualSha256 !== expectedSha256) {
      throw new Error(`Checksum mismatch before publish for ${normalizedPath}.`);
    }

    const contentType = inferArtifactContentType(normalizedPath);
    const objectKey = joinObjectKey(options.artifactKeyPrefix, normalizedPath);

    inventory.push({
      path: normalizedPath,
      objectKey,
      url: joinUrl(options.baseUrl, encodeObjectKeyForUrl(normalizedPath)),
      sha256: actualSha256,
      sizeBytes: bytes.byteLength,
      contentType,
      cacheControl: options.cacheControl,
      etag: quoteEtag(actualSha256),
      immutable: true
    });
  }

  return inventory;
}

function enhancePublishedDataset(
  dataset: TerritoryRegistryDataset,
  options: {
    baseUrl: string;
    inventoryByPath: ReadonlyMap<string, TerritoryRegistryArtifactInventoryFile>;
    absoluteUrls: boolean;
    cacheControl: string;
    publishedAt: string;
    provenance: TerritoryRegistryPublishProvenance;
  }
): TerritoryRegistryDataset {
  return {
    ...dataset,
    artifacts: dataset.artifacts.map((artifact) => {
      const inventory = artifact.path ? options.inventoryByPath.get(artifact.path) : undefined;
      const url = options.absoluteUrls ? joinUrl(options.baseUrl, artifact.url) : artifact.url;
      const enhanced: TerritoryRegistryArtifact = {
        ...artifact,
        url,
        ...(inventory
          ? {
              sha256: inventory.sha256,
              sizeBytes: inventory.sizeBytes,
              contentType: inventory.contentType,
              cacheControl: options.cacheControl,
              etag: inventory.etag,
              immutable: true
            }
          : {
              cacheControl: options.cacheControl,
              immutable: true
            })
      };
      const maybeTileTemplate = enhanced as TerritoryRegistryArtifact & {
        tileUrlTemplate?: unknown;
      };

      if (options.absoluteUrls && typeof maybeTileTemplate.tileUrlTemplate === "string") {
        return {
          ...enhanced,
          tileUrlTemplate: joinUrl(options.baseUrl, maybeTileTemplate.tileUrlTemplate)
        };
      }

      return enhanced;
    }),
    publishedAt: options.publishedAt,
    artifactBaseUrl: options.baseUrl,
    provenance: options.provenance
  };
}

function createPublishedRegistry(input: {
  registry: TerritoryDatasetRegistry;
  generatedAt: string;
  publishedAt: string;
  alias: string | undefined;
  datasetId: string;
  version: string;
  activeRegistryKey: string;
  immutableRegistryKey: string;
  inventoryKey: string;
  rollbackKey: string;
  provenance: TerritoryRegistryPublishProvenance;
  previousAliases?: Record<string, unknown>;
}): TerritoryDatasetRegistry {
  return {
    ...input.registry,
    generatedAt: input.generatedAt,
    publishedAt: input.publishedAt,
    ...(input.alias
      ? {
          aliases: {
            ...(input.previousAliases ?? {}),
            [input.alias]: {
              alias: input.alias,
              datasetId: input.datasetId,
              version: input.version,
              mutable: true,
              registryKey: input.activeRegistryKey,
              immutableRegistryKey: input.immutableRegistryKey,
              inventoryKey: input.inventoryKey,
              rollbackKey: input.rollbackKey,
              updatedAt: input.publishedAt
            }
          }
        }
      : {}),
    publishing: {
      layout: "territorykit-hosted-registry@1",
      activeRegistryKey: input.activeRegistryKey,
      immutableRegistryKey: input.immutableRegistryKey,
      inventoryKey: input.inventoryKey,
      rollbackKey: input.rollbackKey,
      provenance: input.provenance
    }
  };
}

function canonicalizeRegistryDatasets(
  registry: TerritoryDatasetRegistry
): TerritoryRegistryDataset[] {
  return registry.datasets.map((dataset) => ({
    ...dataset,
    artifacts: dataset.artifacts.map((artifact) => {
      const canonicalArtifact: TerritoryRegistryArtifact = {
        ...artifact,
        url: joinUrl(registry.baseUrl, artifact.url)
      };
      const maybeTileTemplate = canonicalArtifact as TerritoryRegistryArtifact & {
        tileUrlTemplate?: unknown;
      };

      if (typeof maybeTileTemplate.tileUrlTemplate === "string") {
        return {
          ...canonicalArtifact,
          tileUrlTemplate: joinUrl(registry.baseUrl, maybeTileTemplate.tileUrlTemplate)
        };
      }

      return canonicalArtifact;
    })
  }));
}

function createRollbackManifest(input: {
  datasetId: string;
  version: string;
  alias: string | undefined;
  createdAt: string;
  activeRegistryKey: string;
  immutableRegistryKey: string;
  previousRegistry:
    | {
        registry: TerritoryDatasetRegistry;
        registryHash: string;
      }
    | undefined;
}): TerritoryRegistryRollbackManifest {
  return {
    rollbackVersion: "territorykit-registry-rollback@1",
    datasetId: input.datasetId,
    version: input.version,
    ...(input.alias ? { alias: input.alias } : {}),
    createdAt: input.createdAt,
    activeRegistryKey: input.activeRegistryKey,
    immutableRegistryKey: input.immutableRegistryKey,
    ...(input.previousRegistry
      ? {
          previous: {
            registryHash: input.previousRegistry.registryHash,
            generatedAt: input.previousRegistry.registry.generatedAt,
            datasetVersions: input.previousRegistry.registry.datasets
              .map((dataset) => `${dataset.id}@${dataset.version}`)
              .sort(),
            registry: input.previousRegistry.registry
          }
        }
      : {}),
    restore: {
      action: "replace-active-registry",
      ...(input.previousRegistry
        ? { fromPreviousRegistryHash: input.previousRegistry.registryHash }
        : {}),
      targetRegistryKey: input.activeRegistryKey
    }
  };
}

async function readPreviousRegistryFromTarget(
  target: TerritoryRegistryReadableObjectStore,
  key: string
): Promise<
  | {
      registry: TerritoryDatasetRegistry;
      registryHash: string;
      aliases?: Record<string, unknown>;
    }
  | undefined
> {
  const existing = await target.headObject(key);

  if (!existing || !target.getObject) {
    return undefined;
  }

  const object = await target.getObject(key);
  const input = JSON.parse(new TextDecoder().decode(object.bytes)) as unknown;
  const validation = validateTerritoryDatasetRegistry(input);

  if (!validation.ok || !validation.registry) {
    throw new Error(
      `Existing registry '${key}' is invalid: ${validation.issues
        .map((issueItem) => issueItem.message)
        .join("; ")}`
    );
  }

  return {
    registry: validation.registry,
    registryHash: sha256Hex(object.bytes),
    ...(isRecord(validation.registry.aliases) ? { aliases: validation.registry.aliases } : {})
  };
}

async function putJsonObject(
  target: TerritoryRegistryWritableObjectStore,
  key: string,
  input: unknown,
  options: {
    contentType: string;
    cacheControl: string;
    immutable?: boolean;
    allowOverwrite?: boolean;
  }
): Promise<TerritoryRegistryObjectMetadata> {
  return target.putObject({
    key,
    bytes: new TextEncoder().encode(serializeJsonStable(input)),
    contentType: options.contentType,
    cacheControl: options.cacheControl,
    ...(options.immutable ? { immutable: true } : {}),
    ...(options.allowOverwrite ? { allowOverwrite: true } : {})
  });
}

async function cleanupUploadedObjects(
  target: TerritoryRegistryWritableObjectStore,
  keys: readonly string[]
): Promise<void> {
  if (!target.deleteObject) {
    return;
  }

  for (const key of [...keys].reverse()) {
    try {
      await target.deleteObject(key);
    } catch {
      // Best-effort cleanup keeps the original publish failure actionable.
    }
  }
}

function inferArtifactFormat(path: string): TerritoryRegistryArtifactFormat {
  if (path.endsWith(".geojson")) {
    return "geojson";
  }

  if (path.endsWith(".pmtiles")) {
    return "pmtiles";
  }

  if (path.endsWith(".mvt")) {
    return "mvt";
  }

  if (path.endsWith(".tksi")) {
    return "tksi";
  }

  if (path.endsWith(".br")) {
    return "br";
  }

  if (path.endsWith(".gz") || path.endsWith(".gzip")) {
    return "gzip";
  }

  if (path.endsWith(".json")) {
    return "territory-json";
  }

  return "json";
}

function inferArtifactContentType(path: string): string {
  if (path.endsWith(".geojson")) {
    return "application/geo+json";
  }

  if (path.endsWith(".json")) {
    return "application/json";
  }

  if (path.endsWith(".mvt")) {
    return "application/vnd.mapbox-vector-tile";
  }

  if (path.endsWith(".pmtiles")) {
    return "application/vnd.pmtiles";
  }

  if (path.endsWith(".tksi")) {
    return "application/vnd.territorykit.spatial-index";
  }

  return "application/octet-stream";
}

function deriveArtifactKeyPrefix(baseUrl: string, datasetId: string, version: string): string {
  try {
    const path = new URL(baseUrl).pathname.replace(/^\/+|\/+$/g, "");

    if (path) {
      return decodeURIComponent(path);
    }
  } catch {
    const relativePath = baseUrl.replace(/^\/+|\/+$/g, "");

    if (relativePath && !/^[a-z][a-z0-9+.-]*:/i.test(relativePath)) {
      return decodeURIComponent(relativePath);
    }
  }

  return joinObjectKey("datasets", datasetId, version);
}

function normalizeObjectKey(key: string): string {
  const raw = key.trim();
  const trimmed = raw.replace(/\/+$/g, "");

  if (
    !trimmed ||
    raw.startsWith("/") ||
    trimmed.includes("\\") ||
    trimmed.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new Error(`Unsafe registry object key '${key}'.`);
  }

  return trimmed;
}

function joinObjectKey(...parts: string[]): string {
  return parts
    .map((part) => part.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

function encodeObjectKeyForUrl(key: string): string {
  return normalizeObjectKey(key)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function quoteEtag(sha256: string): string {
  return `"${sha256}"`;
}

function normalizeEtag(input: string): string {
  return input.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
}

function normalizeHeaderValue(input: string): string {
  return input.trim().toLowerCase();
}

function assertSafeDatasetVersion(datasetId: string, version: string): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(datasetId)) {
    throw new Error(`Invalid dataset id '${datasetId}'.`);
  }

  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid dataset version '${version}'.`);
  }
}

function assertSafeAlias(alias: string | false | undefined): void {
  if (alias === false || alias === undefined) {
    return;
  }

  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(alias)) {
    throw new Error(`Invalid registry alias '${alias}'.`);
  }
}

function isObjectNotFoundError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }

  const metadata = isRecord(error.$metadata) ? error.$metadata : undefined;

  return (
    error.name === "NotFound" ||
    error.name === "NoSuchKey" ||
    error.code === "NotFound" ||
    error.code === "NoSuchKey" ||
    error.statusCode === 404 ||
    metadata?.httpStatusCode === 404
  );
}

export function getDefaultTerritoryRegistryCacheDir(): string {
  return process.env.TERRITORY_KIT_CACHE_DIR ?? join(homedir(), ".territory-kit");
}

async function decompressArtifactBytes(
  bytes: Uint8Array,
  compression: "none" | "gzip" | "br"
): Promise<Uint8Array> {
  if (compression === "none") {
    return bytes;
  }

  if (compression === "gzip") {
    return new Uint8Array(await gunzipAsync(bytes));
  }

  return new Uint8Array(await brotliDecompressAsync(bytes));
}

function artifactDirectory(rootDir: string, key: TerritoryRegistryArtifactCacheKey): string {
  return join(
    rootDir,
    "datasets",
    sanitizeSegment(key.datasetId),
    sanitizeSegment(key.version),
    sanitizeSegment(key.artifactId)
  );
}

function registrySnapshotPath(rootDir: string, registryUrl: string): string {
  return join(rootDir, "registries", `${sha256Hex(new TextEncoder().encode(registryUrl))}.json`);
}

function sanitizeSegment(input: string): string {
  if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(input)) {
    throw new Error(`Unsafe cache path segment '${input}'.`);
  }

  return input;
}

function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function readDirNames(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function collectMetadataFiles(root: string): Promise<string[]> {
  const entries = await readDirNames(root);
  return entries.map((entry) => join(root, entry, "metadata.json"));
}

async function discoverDatasetArtifactRoots(inputPath: string): Promise<string[]> {
  if (await pathExists(join(inputPath, "manifest.json"))) {
    return [inputPath];
  }

  const entries = await readDirNames(inputPath);
  const roots = [];

  for (const entry of entries) {
    const candidate = join(inputPath, entry);

    if (await pathExists(join(candidate, "manifest.json"))) {
      roots.push(candidate);
    }
  }

  return roots.sort();
}

function createArtifactId(relativePath: string): string {
  return relativePath
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function joinUrlPath(...parts: string[]): string {
  return parts
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

function encodeRelativeUrl(path: string): string {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function readRequiredString(input: Record<string, unknown>, ...keys: string[]): string {
  const value = readOptionalString(input, ...keys);

  if (!value) {
    throw new Error(`Manifest is missing ${keys.join(" or ")}.`);
  }

  return value;
}

function readOptionalString(input: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function readStringArray(input: unknown): TerritoryAdminLevel[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.filter((value): value is TerritoryAdminLevel => typeof value === "string");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");

  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk: Uint8Array) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });

  return hash.digest("hex");
}
