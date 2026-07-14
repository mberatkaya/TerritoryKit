import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { createSourceIssue } from "./errors.js";
import { sha256File } from "./transports/file.js";
import type {
  TerritorySourceArtifact,
  TerritorySourceIssue,
  TerritorySourceRequest
} from "./types.js";
import { isRecord, serializeJsonStable, sha256Hex } from "./utils.js";

export interface SourceCacheLookupResult {
  artifact?: TerritorySourceArtifact;
  issues: TerritorySourceIssue[];
}

interface SourceCacheMetadata {
  provider: string;
  originalUrl?: string;
  sha256: string;
  sizeBytes: number;
  etag?: string;
  lastModified?: string;
  fetchedAt?: string;
  sourceVersion?: string;
}

export function getDefaultSourceCacheDir(): string {
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Caches", "TerritoryKit", "sources");
  }

  if (platform() === "win32") {
    return join(
      process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
      "TerritoryKit",
      "Cache",
      "sources"
    );
  }

  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "territory-kit", "sources");
}

export function createSourceCacheKey(provider: string, request: TerritorySourceRequest): string {
  const identity = {
    provider,
    input: request.input ? resolve(request.input) : undefined,
    url: request.url ? new URL(request.url).href : undefined,
    version: request.version,
    expectedSha256: request.expectedSha256
  };

  return sha256Hex(serializeJsonStable(identity));
}

export async function readCachedSourceArtifact(options: {
  provider: string;
  cacheDir: string;
  cacheKey: string;
  request: TerritorySourceRequest;
}): Promise<SourceCacheLookupResult> {
  const entryDir = getCacheEntryDir(options.cacheDir, options.provider, options.cacheKey);
  const metadataPath = join(entryDir, "metadata.json");
  const artifactPath = join(entryDir, "artifact");
  const issues: TerritorySourceIssue[] = [];

  let metadata: SourceCacheMetadata;

  try {
    metadata = parseCacheMetadata(JSON.parse(await readFile(metadataPath, "utf8")));
  } catch (error) {
    issues.push(
      createSourceIssue({
        stage: "fetch",
        severity: "warning",
        code: "SOURCE_CACHE_MISS",
        message: "Source cache entry is missing or metadata is unreadable.",
        provider: options.provider,
        cause: error instanceof Error ? error.message : String(error)
      })
    );
    return { issues };
  }

  try {
    const fileStat = await stat(artifactPath);

    if (!fileStat.isFile()) {
      throw new Error("cached artifact is not a regular file");
    }

    const actualSha256 = await sha256File(artifactPath);

    if (actualSha256 !== metadata.sha256) {
      await rm(entryDir, { force: true, recursive: true });
      issues.push(
        createSourceIssue({
          stage: "fetch",
          severity: "warning",
          code: "SOURCE_CACHE_CORRUPT",
          message:
            "Source cache artifact checksum does not match metadata; cache entry was removed.",
          provider: options.provider,
          details: { expectedSha256: metadata.sha256, actualSha256 }
        })
      );
      return { issues };
    }

    if (options.request.expectedSha256 && options.request.expectedSha256 !== actualSha256) {
      await rm(entryDir, { force: true, recursive: true });
      issues.push(
        createSourceIssue({
          stage: "verify",
          code: "SOURCE_CHECKSUM_MISMATCH",
          message: "Cached source SHA-256 does not match the expected checksum.",
          provider: options.provider,
          details: {
            expectedSha256: options.request.expectedSha256,
            actualSha256
          }
        })
      );
      return { issues };
    }

    return {
      issues,
      artifact: {
        provider: options.provider,
        localPath: artifactPath,
        sha256: actualSha256,
        sizeBytes: fileStat.size,
        ...(metadata.originalUrl ? { originalUrl: metadata.originalUrl } : {}),
        ...(metadata.etag ? { etag: metadata.etag } : {}),
        ...(metadata.lastModified ? { lastModified: metadata.lastModified } : {}),
        ...(metadata.sourceVersion ? { sourceVersion: metadata.sourceVersion } : {}),
        ...(metadata.fetchedAt ? { fetchedAt: metadata.fetchedAt } : {}),
        cacheHit: true
      }
    };
  } catch (error) {
    await rm(entryDir, { force: true, recursive: true });
    issues.push(
      createSourceIssue({
        stage: "fetch",
        severity: "warning",
        code: "SOURCE_CACHE_CORRUPT",
        message: "Source cache entry is unreadable; cache entry was removed.",
        provider: options.provider,
        cause: error instanceof Error ? error.message : String(error)
      })
    );
    return { issues };
  }
}

export async function writeSourceCacheEntry(options: {
  provider: string;
  cacheDir: string;
  cacheKey: string;
  artifact: TerritorySourceArtifact;
}): Promise<TerritorySourceArtifact> {
  const entryDir = getCacheEntryDir(options.cacheDir, options.provider, options.cacheKey);
  const tempDir = `${entryDir}.tmp-${process.pid}-${Date.now()}`;
  await rm(tempDir, { force: true, recursive: true });
  await mkdir(tempDir, { recursive: true });

  try {
    const artifactPath = join(tempDir, "artifact");
    await copyFile(options.artifact.localPath, artifactPath);
    const metadata: SourceCacheMetadata = {
      provider: options.provider,
      sha256: options.artifact.sha256,
      sizeBytes: options.artifact.sizeBytes,
      ...(options.artifact.originalUrl ? { originalUrl: options.artifact.originalUrl } : {}),
      ...(options.artifact.etag ? { etag: options.artifact.etag } : {}),
      ...(options.artifact.lastModified ? { lastModified: options.artifact.lastModified } : {}),
      ...(options.artifact.fetchedAt ? { fetchedAt: options.artifact.fetchedAt } : {}),
      ...(options.artifact.sourceVersion ? { sourceVersion: options.artifact.sourceVersion } : {})
    };
    await writeFile(join(tempDir, "metadata.json"), serializeJsonStable(metadata), "utf8");
    await rm(entryDir, { force: true, recursive: true });
    await mkdir(join(entryDir, ".."), { recursive: true });
    await rename(tempDir, entryDir);

    return {
      ...options.artifact,
      localPath: join(entryDir, "artifact"),
      cacheHit: false
    };
  } catch (error) {
    await rm(tempDir, { force: true, recursive: true });
    throw error;
  }
}

function getCacheEntryDir(cacheDir: string, provider: string, cacheKey: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(provider) || !/^[a-f0-9]{64}$/.test(cacheKey)) {
    throw new Error("Invalid source cache provider or cache key.");
  }

  return join(cacheDir, provider, cacheKey);
}

function parseCacheMetadata(input: unknown): SourceCacheMetadata {
  if (
    !isRecord(input) ||
    typeof input.provider !== "string" ||
    typeof input.sha256 !== "string" ||
    typeof input.sizeBytes !== "number"
  ) {
    throw new Error("Invalid source cache metadata.");
  }

  return {
    provider: input.provider,
    sha256: input.sha256,
    sizeBytes: input.sizeBytes,
    ...(typeof input.originalUrl === "string" ? { originalUrl: input.originalUrl } : {}),
    ...(typeof input.etag === "string" ? { etag: input.etag } : {}),
    ...(typeof input.lastModified === "string" ? { lastModified: input.lastModified } : {}),
    ...(typeof input.fetchedAt === "string" ? { fetchedAt: input.fetchedAt } : {}),
    ...(typeof input.sourceVersion === "string" ? { sourceVersion: input.sourceVersion } : {})
  };
}
