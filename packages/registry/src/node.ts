import { createHash } from "node:crypto";
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
  TerritoryInstalledArtifactMetadata,
  TerritoryInstalledDatasetSummary,
  TerritoryRegistryArtifactCacheKey,
  TerritoryRegistryCache,
  TerritoryRegistryClient,
  TerritoryRegistryClientOptions,
  TerritoryRegistrySnapshot,
  TerritoryRegistryTransport
} from "./types.js";
import { serializeJsonStable } from "./utils.js";

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
      const level = /(?:^|\/)(ADM\d+)\/(?:dataset|adjacency)\.json$/.exec(relativePath)?.[1];
      const purpose = relativePath.startsWith("levels/")
        ? "query"
        : relativePath.startsWith("adjacency/") && relativePath.endsWith("/adjacency.json")
          ? "adjacency"
          : "metadata";
      const format = relativePath.endsWith(".geojson") ? "geojson" : "territory-json";

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
        contentType: "application/json"
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
