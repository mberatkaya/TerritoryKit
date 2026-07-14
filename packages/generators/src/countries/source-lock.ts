import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { TerritoryAdminLevel } from "@territory-kit/dataset";
import { fetchHttpSourceArtifact } from "../sources/transports/http.js";
import { resolveFileSourceArtifact } from "../sources/transports/file.js";
import { pathExists, serializeJsonStable, sha256Hex } from "../sources/utils.js";
import { getTerritoryCountryConfig } from "./registry.js";
import { resolveTerritoryBoundarySource } from "./source-resolver.js";
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

  for (const level of [...options.levels].sort(compareAdminLevels)) {
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
    issues.push(...resolvedSource.issues);

    if (!resolvedSource.source) {
      levels[level] = {
        adminLevel: level,
        status: "unavailable",
        unavailableReason:
          resolvedSource.issues[0]?.message ?? "No usable source metadata was found."
      };
      continue;
    }

    try {
      const artifact = await acquireBoundarySourceArtifact(resolvedSource.source, {
        cwd: options.cwd ?? process.cwd(),
        ...(options.buildDate ? { buildDate: options.buildDate } : {})
      });
      levels[level] = createLockLevel(resolvedSource.source, {
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
        ...(artifact.sourcePath ? { sourcePath: artifact.sourcePath } : {})
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
    levels
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
  options: { cwd: string; buildDate?: string }
): Promise<{ localPath: string; sha256: string; sizeBytes: number; sourcePath?: string }> {
  if (isRemoteUrl(source.sourceUrl)) {
    const artifact = await fetchHttpSourceArtifact({
      provider: source.provider,
      url: source.sourceUrl,
      ...(source.expectedSha256 ? { expectedSha256: source.expectedSha256 } : {}),
      ...(source.sourceVersion ? { sourceVersion: source.sourceVersion } : {}),
      maxSourceSizeBytes: 100 * 1024 * 1024,
      now: () => resolveBuildTimestamp(options.buildDate)
    });

    return {
      localPath: artifact.localPath,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes
    };
  }

  const sourcePath = source.sourceUrl.startsWith("file:")
    ? new URL(source.sourceUrl).pathname
    : source.sourceUrl;
  const artifact = await resolveFileSourceArtifact({
    provider: source.provider,
    request: {
      input: sourcePath,
      ...(source.expectedSha256 ? { expectedSha256: source.expectedSha256 } : {}),
      ...(source.sourceVersion ? { version: source.sourceVersion } : {})
    },
    cwd: options.cwd,
    maxSourceSizeBytes: 100 * 1024 * 1024
  });

  if (source.expectedSha256 && artifact.sha256 !== source.expectedSha256) {
    throw new Error("Local source SHA-256 does not match the expected checksum.");
  }

  return {
    localPath: artifact.localPath,
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes,
    sourcePath: sourcePath
  };
}

function createLockLevel(
  source: TerritoryResolvedBoundarySource,
  artifact: { sha256: string; sizeBytes: number; sourcePath?: string }
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
    ...(source.metadataUrl ? { metadataUrl: source.metadataUrl } : {}),
    ...(source.sourceVersion ? { sourceVersion: source.sourceVersion } : {}),
    ...(source.sourceDate ? { sourceDate: source.sourceDate } : {}),
    license: source.sourceLicense ?? "unknown",
    ...(source.licenseDetail ? { licenseDetail: source.licenseDetail } : {}),
    attribution: source.attribution,
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes
  };
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

function compareAdminLevels(left: TerritoryAdminLevel, right: TerritoryAdminLevel): number {
  return Number(left.slice(3)) - Number(right.slice(3));
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
