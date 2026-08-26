import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { compareAdminLevels } from "@territory-kit/dataset";
import type { TerritoryAdminLevel } from "@territory-kit/dataset";
import {
  createSourceCacheKey,
  readCachedSourceArtifact,
  writeSourceCacheEntry
} from "../sources/cache.js";
import { fetchHttpSourceArtifact } from "../sources/transports/http.js";
import { resolveFileSourceArtifact } from "../sources/transports/file.js";
import { isRecord, pathExists, serializeJsonStable, sha256Hex } from "../sources/utils.js";
import { extractZipMember } from "../sources/zip.js";
import { getTerritoryCountryConfig } from "./registry.js";
import { resolveTerritoryBoundarySource } from "./source-resolver.js";
import {
  createTurkeyAdm3SourceLockExtension,
  createTurkeyAdm3SyntheticSourceLockLevel,
  validateTurkeyAdm3SourceLockExtension,
  verifyTurkeyAdm3SourceLockExtension
} from "../turkey-adm3-ingestion.js";
import type {
  TerritoryCountryBuildIssue,
  TerritoryCountrySourceLock,
  TerritoryCountrySourceLockLevel,
  TerritoryResolvedBoundarySource,
  TerritorySourceLockCreateOptions
} from "./types.js";

const GENERATORS_PACKAGE_VERSION = "1.1.0";

export interface TerritoryCountrySourceLockResult {
  lock?: TerritoryCountrySourceLock;
  issues: TerritoryCountryBuildIssue[];
  outputPath?: string;
}

export async function createTerritoryCountrySourceLock(
  options: TerritorySourceLockCreateOptions
): Promise<TerritoryCountrySourceLockResult> {
  const config = getTerritoryCountryConfig(options.country);
  const releaseType = options.releaseType ?? config.defaultReleaseType ?? "gbOpen";
  const resolvedAt = resolveBuildTimestamp(options.buildDate);
  const issues: TerritoryCountryBuildIssue[] = [];
  const levels: Partial<Record<TerritoryAdminLevel, TerritoryCountrySourceLockLevel>> = {};
  const adm3ProvinceCodes = options.adm3Provinces?.map((value) => value.trim()).filter(Boolean);
  const useTurkeyAdm3ProvinceCatalog =
    config.countryCodeAlpha2 === "TR" &&
    options.levels.includes("ADM3") &&
    Boolean(adm3ProvinceCodes && adm3ProvinceCodes.length > 0);

  for (const level of [...options.levels].sort(compareAdminLevels)) {
    if (useTurkeyAdm3ProvinceCatalog && level === "ADM3") {
      continue;
    }

    const levelConfig = config.levelMappings[level];

    if (!levelConfig) {
      levels[level] = {
        adminLevel: level,
        status: "unavailable",
        unavailableReason: "Level is not configured for this country."
      };
      continue;
    }

    const resolvedSource = await resolveTerritoryBoundarySource({
      country: config.countryCodeAlpha2,
      adminLevel: level,
      releaseType,
      ...(options.metadataPath ? { metadataPath: options.metadataPath } : {}),
      ...(options.metadataUrl ? { metadataUrl: options.metadataUrl } : {}),
      ...(options.buildDate ? { buildDate: options.buildDate } : {}),
      ...(options.cacheDir ? { cacheDir: options.cacheDir } : {}),
      ...(options.noCache ? { noCache: true } : {}),
      ...(options.refresh ? { refresh: true } : {}),
      ...(options.cwd ? { cwd: options.cwd } : {})
    });
    const sourceIssues = resolvedSource.issues.map((issue) =>
      downgradeOptionalUnavailableIssue(issue, levelConfig.required)
    );
    issues.push(...sourceIssues);

    if (!resolvedSource.source) {
      levels[level] = {
        adminLevel: level,
        status: "unavailable",
        unavailableReason: sourceIssues[0]?.message ?? "No usable source metadata was found."
      };
      continue;
    }

    try {
      const artifact = await acquireBoundarySourceArtifact(resolvedSource.source, {
        cwd: options.cwd ?? process.cwd(),
        ...(options.buildDate ? { buildDate: options.buildDate } : {}),
        ...(options.cacheDir ? { cacheDir: options.cacheDir } : {}),
        ...(options.noCache ? { noCache: true } : {}),
        ...(options.refresh ? { refresh: true } : {}),
        ...(options.maxSourceBytes ? { maxSourceBytes: options.maxSourceBytes } : {})
      });
      const sourceFeatureCount =
        resolvedSource.source.sourceFeatureCount ?? (await countSourceFeatures(artifact.localPath));
      levels[level] = createLockLevel(resolvedSource.source, {
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
        ...(artifact.sourcePath ? { sourcePath: artifact.sourcePath } : {}),
        ...(sourceFeatureCount !== undefined ? { sourceFeatureCount } : {})
      });
    } catch (error) {
      issues.push({
        code: "SOURCE_ACQUIRE_FAILED",
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
        level
      });
      levels[level] = {
        adminLevel: level,
        status: "unavailable",
        unavailableReason: error instanceof Error ? error.message : String(error)
      };
    }
  }

  const turkeyAdm3Extension = useTurkeyAdm3ProvinceCatalog
    ? await createTurkeyAdm3SourceLockExtension({
        ...(options.adm3CatalogPath ? { catalogPath: options.adm3CatalogPath } : {}),
        provinceCodes: adm3ProvinceCodes ?? [],
        generatedAt: resolvedAt,
        cwd: options.cwd ?? process.cwd(),
        ...(options.buildDate ? { buildDate: options.buildDate } : {}),
        ...(options.cacheDir ? { cacheDir: options.cacheDir } : {}),
        ...(options.noCache ? { noCache: true } : {}),
        ...(options.refresh ? { refresh: true } : {}),
        ...(options.maxSourceBytes ? { maxSourceBytes: options.maxSourceBytes } : {}),
        acquireSource: acquireBoundarySourceArtifact
      })
    : undefined;

  if (turkeyAdm3Extension) {
    issues.push(...turkeyAdm3Extension.issues);
    levels.ADM3 = createTurkeyAdm3SyntheticSourceLockLevel(turkeyAdm3Extension.extension);
  }

  const lockWithoutHash: Omit<TerritoryCountrySourceLock, "contentHash"> = {
    lockVersion: "1",
    country: {
      alpha2: config.countryCodeAlpha2,
      alpha3: config.countryCodeAlpha3
    },
    provider: config.sourceProvider,
    releaseType,
    resolvedAt,
    createdBy: {
      package: "@territory-kit/generators",
      version: GENERATORS_PACKAGE_VERSION
    },
    levels,
    ...(turkeyAdm3Extension ? { extensions: { turkeyAdm3: turkeyAdm3Extension.extension } } : {})
  };
  const lock = {
    ...lockWithoutHash,
    contentHash: computeTerritoryCountrySourceLockHash(lockWithoutHash)
  };

  if (options.outputPath) {
    await writeJsonFileAtomically(resolve(options.cwd ?? process.cwd(), options.outputPath), lock, {
      force: options.force ?? false
    });
  }

  return {
    lock,
    issues,
    ...(options.outputPath
      ? { outputPath: resolve(options.cwd ?? process.cwd(), options.outputPath) }
      : {})
  };
}

function downgradeOptionalUnavailableIssue(
  issue: TerritoryCountryBuildIssue,
  required: boolean
): TerritoryCountryBuildIssue {
  if (required || issue.severity !== "error" || issue.code !== "SOURCE_METADATA_NOT_FOUND") {
    return issue;
  }

  return {
    ...issue,
    severity: "warning"
  };
}

export async function readTerritoryCountrySourceLockPath(
  inputPath: string
): Promise<TerritoryCountrySourceLock> {
  return JSON.parse(await readFile(resolve(inputPath), "utf8")) as TerritoryCountrySourceLock;
}

export async function verifyTerritoryCountrySourceLock(
  lock: TerritoryCountrySourceLock,
  options: { cwd?: string; buildDate?: string } = {}
): Promise<{ ok: boolean; issues: TerritoryCountryBuildIssue[] }> {
  const issues = validateTerritoryCountrySourceLock(lock);

  for (const level of Object.values(lock.levels).sort((left, right) =>
    compareAdminLevels(left.adminLevel, right.adminLevel)
  )) {
    if (level.status !== "available") {
      continue;
    }

    if (level.adminLevel === "ADM3" && lock.extensions?.turkeyAdm3) {
      continue;
    }

    try {
      const artifact = await acquireBoundarySourceArtifact(
        {
          provider: lock.provider,
          sourceUrl: level.sourcePath ?? level.sourceUrl ?? "",
          ...(level.sha256 ? { expectedSha256: level.sha256 } : {}),
          ...(level.sourceVersion ? { sourceVersion: level.sourceVersion } : {})
        },
        {
          cwd: options.cwd ?? process.cwd(),
          ...(options.buildDate ? { buildDate: options.buildDate } : {})
        }
      );

      if (level.sha256 && artifact.sha256 !== level.sha256) {
        issues.push({
          code: "SOURCE_CHECKSUM_MISMATCH",
          severity: "error",
          message: `Checksum mismatch for ${level.adminLevel}.`,
          level: level.adminLevel
        });
      }
    } catch (error) {
      issues.push({
        code: "SOURCE_VERIFY_FAILED",
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
        level: level.adminLevel
      });
    }
  }

  if (lock.extensions?.turkeyAdm3) {
    issues.push(
      ...(await verifyTurkeyAdm3SourceLockExtension(lock.extensions.turkeyAdm3, {
        cwd: options.cwd ?? process.cwd(),
        ...(options.buildDate ? { buildDate: options.buildDate } : {}),
        acquireSource: acquireBoundarySourceArtifact
      }))
    );
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issues
  };
}

export function validateTerritoryCountrySourceLock(
  lock: TerritoryCountrySourceLock
): TerritoryCountryBuildIssue[] {
  const issues: TerritoryCountryBuildIssue[] = [];
  const expectedHash = computeTerritoryCountrySourceLockHash(lock);
  const seenUrls = new Set<string>();

  if (lock.lockVersion !== "1") {
    issues.push({
      code: "SOURCE_LOCK_VERSION",
      severity: "error",
      message: "Lock version must be 1."
    });
  }

  if (lock.contentHash !== expectedHash) {
    issues.push({
      code: "SOURCE_LOCK_HASH_MISMATCH",
      severity: "error",
      message: "Source lock content hash does not match."
    });
  }

  if (lock.extensions?.turkeyAdm3) {
    issues.push(...validateTurkeyAdm3SourceLockExtension(lock.extensions.turkeyAdm3));
  }

  for (const level of Object.values(lock.levels)) {
    if (!level.adminLevel || !level.status) {
      issues.push({
        code: "SOURCE_LOCK_LEVEL_INVALID",
        severity: "error",
        message: "Invalid source lock level."
      });
      continue;
    }

    if (level.status === "available") {
      const source = level.sourcePath ?? level.sourceUrl;

      if (!source) {
        issues.push({
          code: "SOURCE_URL_MISSING",
          severity: "error",
          message: "Available source lock levels require a source path or URL.",
          level: level.adminLevel
        });
      } else if (seenUrls.has(source)) {
        issues.push({
          code: "SOURCE_DUPLICATE",
          severity: "error",
          message: "Duplicate source entry in lock.",
          level: level.adminLevel
        });
      }

      if (source) {
        seenUrls.add(source);
      }

      if (!level.license) {
        issues.push({
          code: "SOURCE_LICENSE_MISSING",
          severity: "error",
          message: "Available source lock levels require license metadata.",
          level: level.adminLevel
        });
      }

      if (!level.attribution) {
        issues.push({
          code: "SOURCE_ATTRIBUTION_MISSING",
          severity: "error",
          message: "Available source lock levels require attribution.",
          level: level.adminLevel
        });
      }

      if (!level.sha256) {
        issues.push({
          code: "SOURCE_CHECKSUM_MISSING",
          severity: "error",
          message: "Available source lock levels require SHA-256.",
          level: level.adminLevel
        });
      }

      if (
        level.sourceSnapshotChecksum &&
        level.sha256 &&
        level.sourceSnapshotChecksum !== level.sha256
      ) {
        issues.push({
          code: "SOURCE_SNAPSHOT_CHECKSUM_MISMATCH",
          severity: "error",
          message: "Source snapshot checksum must match the locked SHA-256.",
          level: level.adminLevel
        });
      }
    }
  }

  return issues.sort(
    (left, right) =>
      (left.level ?? "").localeCompare(right.level ?? "") || left.code.localeCompare(right.code)
  );
}

export function computeTerritoryCountrySourceLockHash(
  lock: Omit<TerritoryCountrySourceLock, "contentHash"> & { contentHash?: string }
): string {
  const { contentHash: _contentHash, resolvedAt: _resolvedAt, ...stableLock } = lock;
  return `sha256:${sha256Hex(serializeJsonStable(stableLock))}`;
}

export async function acquireBoundarySourceArtifact(
  source: Pick<
    TerritoryResolvedBoundarySource,
    "provider" | "sourceUrl" | "expectedSha256" | "sourceVersion"
  >,
  options: {
    cwd: string;
    buildDate?: string;
    cacheDir?: string;
    noCache?: boolean;
    refresh?: boolean;
    maxSourceBytes?: number;
  }
): Promise<{
  localPath: string;
  sha256: string;
  sizeBytes: number;
  sourcePath?: string;
  originalUrl?: string;
}> {
  const maxSourceSizeBytes = options.maxSourceBytes ?? 100 * 1024 * 1024;
  const archiveReference = splitArchiveMemberReference(source.sourceUrl);
  const artifactSourceUrl = archiveReference?.archiveUrl ?? source.sourceUrl;

  if (isRemoteUrl(artifactSourceUrl)) {
    const cacheEnabled = !options.noCache;
    const request = {
      url: source.sourceUrl,
      ...(source.expectedSha256 ? { expectedSha256: source.expectedSha256 } : {}),
      ...(source.sourceVersion ? { version: source.sourceVersion } : {}),
      ...(options.refresh ? { refresh: true } : {})
    };
    const cacheDir = resolve(
      options.cwd,
      options.cacheDir ?? join(".territory", "cache", "sources")
    );
    const cacheKey = createSourceCacheKey(source.provider, request);

    if (cacheEnabled && !options.refresh) {
      const cached = await readCachedSourceArtifact({
        provider: source.provider,
        cacheDir,
        cacheKey,
        request
      });
      const blockingIssue = cached.issues.find((issue) => issue.severity === "error");

      if (blockingIssue) {
        throw new Error(blockingIssue.message);
      }

      if (cached.artifact) {
        return {
          localPath: cached.artifact.localPath,
          sha256: cached.artifact.sha256,
          sizeBytes: cached.artifact.sizeBytes,
          ...(cached.artifact.originalUrl ? { originalUrl: cached.artifact.originalUrl } : {})
        };
      }
    }

    const downloadDir = cacheEnabled
      ? join(cacheDir, source.provider, `${cacheKey}.download`)
      : undefined;

    if (downloadDir) {
      await mkdir(downloadDir, { recursive: true });
    }

    const fetchedArtifact = await fetchHttpSourceArtifact({
      provider: source.provider,
      url: artifactSourceUrl,
      ...(downloadDir ? { destinationDirectory: downloadDir } : {}),
      ...(source.expectedSha256 && !archiveReference
        ? { expectedSha256: source.expectedSha256 }
        : {}),
      ...(source.sourceVersion ? { sourceVersion: source.sourceVersion } : {}),
      maxSourceSizeBytes,
      now: () => resolveBuildTimestamp(options.buildDate)
    });
    const artifact = archiveReference
      ? await extractSourceArchiveMember(fetchedArtifact, archiveReference.member, {
          ...(source.expectedSha256 ? { expectedSha256: source.expectedSha256 } : {})
        })
      : fetchedArtifact;
    const cachedArtifact = cacheEnabled
      ? await writeSourceCacheEntry({
          provider: source.provider,
          cacheDir,
          cacheKey,
          artifact
        })
      : artifact;

    return {
      localPath: cachedArtifact.localPath,
      sha256: cachedArtifact.sha256,
      sizeBytes: cachedArtifact.sizeBytes,
      ...(cachedArtifact.originalUrl ? { originalUrl: cachedArtifact.originalUrl } : {})
    };
  }

  const sourcePath = artifactSourceUrl.startsWith("file:")
    ? new URL(artifactSourceUrl).pathname
    : artifactSourceUrl;
  const fileArtifact = await resolveFileSourceArtifact({
    provider: source.provider,
    request: {
      input: sourcePath,
      ...(source.expectedSha256 && !archiveReference
        ? { expectedSha256: source.expectedSha256 }
        : {}),
      ...(source.sourceVersion ? { version: source.sourceVersion } : {})
    },
    cwd: options.cwd,
    maxSourceSizeBytes
  });
  const artifact = archiveReference
    ? await extractSourceArchiveMember(fileArtifact, archiveReference.member, {
        ...(source.expectedSha256 ? { expectedSha256: source.expectedSha256 } : {})
      })
    : fileArtifact;

  if (source.expectedSha256 && artifact.sha256 !== source.expectedSha256) {
    throw new Error("Local source SHA-256 does not match the expected checksum.");
  }

  return {
    localPath: artifact.localPath,
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes,
    sourcePath: archiveReference ? `${sourcePath}#${archiveReference.member}` : sourcePath
  };
}

async function extractSourceArchiveMember(
  artifact: {
    provider: string;
    localPath: string;
    originalUrl?: string;
    sourceVersion?: string;
  },
  member: string,
  options: { expectedSha256?: string } = {}
): Promise<{
  localPath: string;
  sha256: string;
  sizeBytes: number;
  originalUrl?: string;
  provider: string;
  cacheHit: boolean;
}> {
  const extraction = extractZipMember(await readFile(artifact.localPath), member);
  const sha256 = sha256Hex(extraction.bytes);

  if (options.expectedSha256 && options.expectedSha256 !== sha256) {
    throw new Error("ZIP member SHA-256 does not match the expected checksum.");
  }

  const outputPath = join(dirname(artifact.localPath), sanitizeArchiveMemberName(member));
  await writeFile(outputPath, extraction.bytes);

  return {
    provider: artifact.provider,
    localPath: outputPath,
    sha256,
    sizeBytes: extraction.bytes.byteLength,
    cacheHit: false
  };
}

function splitArchiveMemberReference(
  sourceUrl: string
): { archiveUrl: string; member: string } | undefined {
  const hashIndex = sourceUrl.indexOf("#");

  if (hashIndex === -1) {
    return undefined;
  }

  const archiveUrl = sourceUrl.slice(0, hashIndex);
  const member = decodeURIComponent(sourceUrl.slice(hashIndex + 1));

  if (!archiveUrl.toLowerCase().endsWith(".zip") || !member) {
    return undefined;
  }

  return { archiveUrl, member };
}

function sanitizeArchiveMemberName(member: string): string {
  return member.split(/[\\/]/).filter(Boolean).at(-1) ?? "artifact.geojson";
}

function createLockLevel(
  source: TerritoryResolvedBoundarySource,
  artifact: {
    sha256: string;
    sizeBytes: number;
    sourcePath?: string;
    resolvedDownloadUrl?: string;
    sourceFeatureCount?: number;
  }
): TerritoryCountrySourceLockLevel {
  return {
    adminLevel: source.adminLevel,
    status: "available",
    ...(source.boundaryId ? { boundaryId: source.boundaryId } : {}),
    ...(source.boundaryName ? { boundaryName: source.boundaryName } : {}),
    ...(source.boundaryYearRepresented
      ? { boundaryYearRepresented: source.boundaryYearRepresented }
      : {}),
    ...(artifact.sourcePath
      ? { sourcePath: artifact.sourcePath }
      : { sourceUrl: source.sourceUrl }),
    resolvedDownloadUrl:
      artifact.resolvedDownloadUrl ?? source.resolvedDownloadUrl ?? source.sourceUrl,
    ...(source.metadataUrl ? { metadataUrl: source.metadataUrl } : {}),
    ...(source.sourceVersion ? { sourceVersion: source.sourceVersion } : {}),
    ...(source.sourceDate ? { sourceDate: source.sourceDate } : {}),
    license: source.sourceLicense ?? "unknown",
    licenseState: source.redistributionStatus === "restricted" ? "restricted" : "approved",
    ...(source.licenseUrl ? { licenseUrl: source.licenseUrl } : {}),
    ...(source.licenseDetail ? { licenseDetail: source.licenseDetail } : {}),
    attribution: source.attribution,
    ...(source.redistributionStatus ? { redistributionStatus: source.redistributionStatus } : {}),
    ...(source.commercialUseStatus ? { commercialUseStatus: source.commercialUseStatus } : {}),
    boundarySourceClass: "official-national",
    sourceSnapshotChecksum: artifact.sha256,
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes,
    ...(source.originalFilename ? { originalFilename: source.originalFilename } : {}),
    ...(source.originalFormat ? { originalFormat: source.originalFormat } : {}),
    ...(artifact.sourceFeatureCount !== undefined
      ? { sourceFeatureCount: artifact.sourceFeatureCount }
      : {})
  };
}

async function countSourceFeatures(path: string): Promise<number | undefined> {
  try {
    const input = JSON.parse(await readFile(path, "utf8")) as unknown;

    if (isRecord(input) && Array.isArray(input.features)) {
      return input.features.length;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function isRemoteUrl(input: string): boolean {
  return /^https?:\/\//i.test(input);
}

function resolveBuildTimestamp(buildDate: string | undefined): string {
  if (buildDate) {
    return new Date(buildDate).toISOString();
  }

  const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH;

  if (sourceDateEpoch && /^\d+$/.test(sourceDateEpoch)) {
    return new Date(Number(sourceDateEpoch) * 1000).toISOString();
  }

  return new Date().toISOString();
}

async function writeJsonFileAtomically(
  outputPath: string,
  input: unknown,
  options: { force?: boolean } = {}
): Promise<void> {
  if (!options.force && (await pathExists(outputPath))) {
    throw new Error(`Output path '${outputPath}' already exists.`);
  }

  await mkdir(dirname(outputPath), { recursive: true });
  const tempDirectory = await mkdtemp(join(dirname(outputPath), `.${basename(outputPath)}-tmp-`));
  const tempPath = join(tempDirectory, basename(outputPath));

  try {
    await writeFile(tempPath, serializeJsonStable(input), "utf8");
    await rename(tempPath, outputPath);
    await rm(tempDirectory, { force: true, recursive: true });
  } catch (error) {
    await rm(tempDirectory, { force: true, recursive: true });
    throw error;
  }
}
