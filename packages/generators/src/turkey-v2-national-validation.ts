import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { normalize as normalizePosixPath } from "node:path/posix";
import { isRecord } from "./sources/utils.js";

export const TURKEY_V2_NATIONAL_EXPECTED_COUNTS = {
  ADM0: 1,
  ADM1: 81,
  ADM2: 973
} as const;

export type TurkeyV2NationalArtifactIntegrityErrorCode =
  | "REGISTRY_SCHEMA_PROBLEM"
  | "MISSING_ARTIFACT"
  | "EMPTY_ARTIFACT"
  | "MISSING_CHECKSUM"
  | "INVALID_CHECKSUM_FORMAT"
  | "CHECKSUM_MISMATCH"
  | "SIZE_MISMATCH"
  | "DUPLICATE_ARTIFACT_ID"
  | "DUPLICATE_ARTIFACT_PATH"
  | "UNSAFE_ARTIFACT_PATH"
  | "CHECKSUM_MANIFEST_MISMATCH"
  | "UNEXPECTED_MANDATORY_ARTIFACT_OMISSION";

export type TurkeyV2NationalCompletenessErrorCode =
  | "NATIONAL_ADM0_COUNT_MISMATCH"
  | "NATIONAL_ADM1_COUNT_MISMATCH"
  | "NATIONAL_ADM2_COUNT_MISMATCH"
  | "NATIONAL_SUCCESSFUL_ADM2_COUNT_MISMATCH"
  | "NATIONAL_FAILED_DISTRICT_COUNT_NONZERO"
  | "NATIONAL_SOURCE_LOCK_EXPECTED_COUNT_MISMATCH"
  | "NATIONAL_SOURCE_LOCK_ACTUAL_COUNT_MISMATCH"
  | "NATIONAL_SOURCE_LOCK_DATASET_COUNT_MISMATCH"
  | "NATIONAL_DISTRICT_WITHOUT_ADM3"
  | "NATIONAL_DISTRICT_COVERAGE_BELOW_THRESHOLD"
  | "NATIONAL_COVERAGE_BELOW_THRESHOLD"
  | "NATIONAL_PARTIAL_BUILD"
  | "NATIONAL_QUALITY_NOT_OK"
  | "NATIONAL_NOT_PUBLISH_READY";

export type TurkeyV2NationalValidationErrorCode =
  TurkeyV2NationalArtifactIntegrityErrorCode | TurkeyV2NationalCompletenessErrorCode;

export interface TurkeyV2NationalValidationIssue {
  code: TurkeyV2NationalValidationErrorCode;
  message: string;
  path?: string;
  artifactId?: string;
  expected?: string | number | boolean;
  actual?: string | number | boolean;
}

export interface TurkeyV2NationalValidationResult {
  ok: boolean;
  errorCount: number;
  errors: TurkeyV2NationalValidationIssue[];
}

export interface TurkeyV2NationalArtifactIntegrityInput {
  registry: unknown;
  checksums: unknown;
  outputRoot?: string;
  mandatoryArtifactIds?: readonly string[];
  producedPaths?: ReadonlySet<string>;
}

interface RegistryArtifactShape {
  id: string;
  path: string;
  sha256: string;
  sizeBytes: number;
}

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

export async function computeFileSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

export async function validateTurkeyV2NationalArtifactIntegrity(
  input: TurkeyV2NationalArtifactIntegrityInput
): Promise<TurkeyV2NationalValidationResult> {
  const errors: TurkeyV2NationalValidationIssue[] = [];
  const artifacts = readRegistryArtifacts(input.registry, errors);
  const checksums = readChecksums(input.checksums, errors);
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  const mandatory = new Set(input.mandatoryArtifactIds ?? []);

  for (const artifact of artifacts) {
    if (seenIds.has(artifact.id)) {
      errors.push({
        code: "DUPLICATE_ARTIFACT_ID",
        message: `Registry defines artifact id '${artifact.id}' more than once.`,
        artifactId: artifact.id
      });
    }
    seenIds.add(artifact.id);

    if (seenPaths.has(artifact.path)) {
      errors.push({
        code: "DUPLICATE_ARTIFACT_PATH",
        message: `Registry defines artifact path '${artifact.path}' more than once.`,
        artifactId: artifact.id,
        path: artifact.path
      });
    }
    seenPaths.add(artifact.path);
    mandatory.delete(artifact.id);

    if (!isSafeArtifactPath(artifact.path)) {
      errors.push({
        code: "UNSAFE_ARTIFACT_PATH",
        message: `Artifact path '${artifact.path}' must stay inside the output root.`,
        artifactId: artifact.id,
        path: artifact.path
      });
      continue;
    }

    if (!SHA256_HEX_RE.test(artifact.sha256)) {
      errors.push({
        code: artifact.sha256.length === 0 ? "MISSING_CHECKSUM" : "INVALID_CHECKSUM_FORMAT",
        message: `Artifact '${artifact.id}' has an invalid SHA-256 checksum.`,
        artifactId: artifact.id,
        path: artifact.path,
        expected: "64 lowercase hexadecimal characters",
        actual: artifact.sha256
      });
    }

    if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes <= 0) {
      errors.push({
        code: "EMPTY_ARTIFACT",
        message: `Artifact '${artifact.id}' declares an empty or invalid byte size.`,
        artifactId: artifact.id,
        path: artifact.path,
        expected: "> 0",
        actual: artifact.sizeBytes
      });
    }

    const manifestEntry = checksums.get(artifact.path);
    if (!manifestEntry) {
      errors.push({
        code: "MISSING_CHECKSUM",
        message: `Checksums manifest does not include '${artifact.path}'.`,
        artifactId: artifact.id,
        path: artifact.path
      });
    } else {
      if (!SHA256_HEX_RE.test(manifestEntry.sha256)) {
        errors.push({
          code: manifestEntry.sha256.length === 0 ? "MISSING_CHECKSUM" : "INVALID_CHECKSUM_FORMAT",
          message: `Checksums manifest has an invalid SHA-256 for '${artifact.path}'.`,
          artifactId: artifact.id,
          path: artifact.path,
          expected: "64 lowercase hexadecimal characters",
          actual: manifestEntry.sha256
        });
      }

      if (manifestEntry.sha256 !== artifact.sha256) {
        errors.push({
          code: "CHECKSUM_MANIFEST_MISMATCH",
          message: `Registry checksum for '${artifact.path}' does not match checksums manifest.`,
          artifactId: artifact.id,
          path: artifact.path,
          expected: manifestEntry.sha256,
          actual: artifact.sha256
        });
      }

      if (manifestEntry.byteSize !== artifact.sizeBytes) {
        errors.push({
          code: "SIZE_MISMATCH",
          message: `Registry size for '${artifact.path}' does not match checksums manifest.`,
          artifactId: artifact.id,
          path: artifact.path,
          expected: manifestEntry.byteSize,
          actual: artifact.sizeBytes
        });
      }
    }

    if (input.producedPaths && !input.producedPaths.has(artifact.path)) {
      errors.push({
        code: "MISSING_ARTIFACT",
        message: `Artifact '${artifact.path}' was registered but not produced by the build.`,
        artifactId: artifact.id,
        path: artifact.path
      });
    }

    if (input.outputRoot) {
      await validateArtifactFile(input.outputRoot, artifact, errors);
    }
  }

  for (const artifactId of [...mandatory].sort()) {
    errors.push({
      code: "UNEXPECTED_MANDATORY_ARTIFACT_OMISSION",
      message: `Mandatory artifact '${artifactId}' is missing from the registry.`,
      artifactId
    });
  }

  return toValidationResult(errors);
}

export function validateTurkeyV2NationalCompleteness(input: {
  coverage: unknown;
  quality?: unknown;
  sourceLock?: unknown;
  strictPublishReady?: boolean;
}): TurkeyV2NationalValidationResult {
  const errors: TurkeyV2NationalValidationIssue[] = [];
  const coverage = isRecord(input.coverage) ? input.coverage : undefined;
  const quality = isRecord(input.quality) ? input.quality : undefined;
  const sourceLock = isRecord(input.sourceLock) ? input.sourceLock : undefined;
  const strict = input.strictPublishReady ?? false;

  if (!coverage) {
    return toValidationResult(errors);
  }

  validateCount(errors, "NATIONAL_ADM0_COUNT_MISMATCH", "ADM0", 1, readNumber(coverage.adm0Count));
  validateCount(
    errors,
    "NATIONAL_ADM1_COUNT_MISMATCH",
    "ADM1",
    TURKEY_V2_NATIONAL_EXPECTED_COUNTS.ADM1,
    readNumber(coverage.provinceCount)
  );
  validateCount(
    errors,
    "NATIONAL_ADM2_COUNT_MISMATCH",
    "ADM2",
    TURKEY_V2_NATIONAL_EXPECTED_COUNTS.ADM2,
    readNumber(coverage.districtCount)
  );
  validateCount(
    errors,
    "NATIONAL_SUCCESSFUL_ADM2_COUNT_MISMATCH",
    "successful ADM2",
    TURKEY_V2_NATIONAL_EXPECTED_COUNTS.ADM2,
    readNumber(coverage.successfulDistrictCount)
  );

  const failedDistrictCount = readNumber(coverage.failedDistrictCount);
  if (failedDistrictCount !== undefined && failedDistrictCount !== 0) {
    errors.push({
      code: "NATIONAL_FAILED_DISTRICT_COUNT_NONZERO",
      message: "Publish-ready Turkey V2 national output must have zero failed districts.",
      path: "coverage.json",
      expected: 0,
      actual: failedDistrictCount
    });
  }

  const finalCoverage = readNumber(coverage.finalCoveragePercent);
  if (finalCoverage !== undefined && finalCoverage < 99.99) {
    errors.push({
      code: "NATIONAL_COVERAGE_BELOW_THRESHOLD",
      message: "National final coverage must be at least 99.99%.",
      path: "coverage.json",
      expected: ">= 99.99",
      actual: finalCoverage
    });
  }

  if (Array.isArray(coverage.districts)) {
    for (const district of coverage.districts) {
      if (!isRecord(district)) {
        continue;
      }

      const districtId = readString(district.districtId);
      const zoneCount = readNumber(district.zoneCount);
      const districtCoverage = readNumber(district.finalCoveragePercent);

      if (zoneCount !== undefined && zoneCount <= 0) {
        errors.push({
          code: "NATIONAL_DISTRICT_WITHOUT_ADM3",
          message: `District '${districtId ?? "unknown"}' has no ADM3 zones.`,
          path: "coverage.json",
          expected: "> 0",
          actual: zoneCount,
          ...(districtId ? { artifactId: districtId } : {})
        });
      }

      if (districtCoverage !== undefined && districtCoverage < 99.99) {
        errors.push({
          code: "NATIONAL_DISTRICT_COVERAGE_BELOW_THRESHOLD",
          message: `District '${districtId ?? "unknown"}' final coverage is below 99.99%.`,
          path: "coverage.json",
          expected: ">= 99.99",
          actual: districtCoverage,
          ...(districtId ? { artifactId: districtId } : {})
        });
      }
    }
  }

  if (sourceLock) {
    validateSourceLockCounts(errors, sourceLock, coverage);
  }

  if (quality) {
    if (quality.ok !== true) {
      errors.push({
        code: "NATIONAL_QUALITY_NOT_OK",
        message: "Quality report is not ok.",
        path: "quality-report.json",
        expected: true,
        actual: quality.ok === undefined ? "missing" : String(quality.ok)
      });
    }

    if (strict) {
      if (quality.buildMode === "partial") {
        errors.push({
          code: "NATIONAL_PARTIAL_BUILD",
          message: "Partial, capped, smoke, or benchmark output is not publish-ready.",
          path: "quality-report.json",
          expected: "publish-ready",
          actual: "partial"
        });
      }

      if (quality.publishReady !== true) {
        errors.push({
          code: "NATIONAL_NOT_PUBLISH_READY",
          message: "Quality report does not mark this output as publish-ready.",
          path: "quality-report.json",
          expected: true,
          actual: quality.publishReady === undefined ? "missing" : String(quality.publishReady)
        });
      }
    }
  }

  return toValidationResult(strict ? errors : []);
}

function readRegistryArtifacts(
  registry: unknown,
  errors: TurkeyV2NationalValidationIssue[]
): RegistryArtifactShape[] {
  if (!isRecord(registry) || !Array.isArray(registry.datasets)) {
    errors.push({
      code: "REGISTRY_SCHEMA_PROBLEM",
      message: "Registry entry must contain a datasets array.",
      path: "registry-entry.json"
    });
    return [];
  }

  const artifacts: RegistryArtifactShape[] = [];

  for (const dataset of registry.datasets) {
    if (!isRecord(dataset) || !Array.isArray(dataset.artifacts)) {
      errors.push({
        code: "REGISTRY_SCHEMA_PROBLEM",
        message: "Registry dataset must contain an artifacts array.",
        path: "registry-entry.json"
      });
      continue;
    }

    for (const artifact of dataset.artifacts) {
      if (
        !isRecord(artifact) ||
        typeof artifact.id !== "string" ||
        typeof artifact.path !== "string" ||
        typeof artifact.sha256 !== "string" ||
        typeof artifact.sizeBytes !== "number"
      ) {
        errors.push({
          code: "REGISTRY_SCHEMA_PROBLEM",
          message: "Registry artifact is missing id, path, sha256, or sizeBytes.",
          path: "registry-entry.json"
        });
        continue;
      }

      artifacts.push({
        id: artifact.id,
        path: artifact.path,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes
      });
    }
  }

  return artifacts;
}

function readChecksums(
  checksums: unknown,
  errors: TurkeyV2NationalValidationIssue[]
): Map<string, { sha256: string; byteSize: number }> {
  const result = new Map<string, { sha256: string; byteSize: number }>();

  if (!isRecord(checksums) || !isRecord(checksums.files)) {
    errors.push({
      code: "REGISTRY_SCHEMA_PROBLEM",
      message: "Checksums manifest must contain a files object.",
      path: "checksums.json"
    });
    return result;
  }

  for (const [path, entry] of Object.entries(checksums.files)) {
    if (
      !isRecord(entry) ||
      typeof entry.sha256 !== "string" ||
      typeof entry.byteSize !== "number"
    ) {
      errors.push({
        code: "REGISTRY_SCHEMA_PROBLEM",
        message: `Checksum entry for '${path}' must contain sha256 and byteSize.`,
        path
      });
      continue;
    }

    result.set(path, { sha256: entry.sha256, byteSize: entry.byteSize });
  }

  return result;
}

async function validateArtifactFile(
  outputRoot: string,
  artifact: RegistryArtifactShape,
  errors: TurkeyV2NationalValidationIssue[]
): Promise<void> {
  const root = resolve(outputRoot);
  const target = resolve(root, artifact.path);

  if (!target.startsWith(`${root}/`) && target !== root) {
    errors.push({
      code: "UNSAFE_ARTIFACT_PATH",
      message: `Artifact path '${artifact.path}' resolves outside the output root.`,
      artifactId: artifact.id,
      path: artifact.path
    });
    return;
  }

  let stats;
  try {
    stats = await stat(target);
  } catch {
    errors.push({
      code: "MISSING_ARTIFACT",
      message: `Artifact '${artifact.path}' does not exist.`,
      artifactId: artifact.id,
      path: artifact.path
    });
    return;
  }

  if (!stats.isFile()) {
    errors.push({
      code: "MISSING_ARTIFACT",
      message: `Artifact '${artifact.path}' is not a regular file.`,
      artifactId: artifact.id,
      path: artifact.path
    });
    return;
  }

  if (stats.size === 0) {
    errors.push({
      code: "EMPTY_ARTIFACT",
      message: `Artifact '${artifact.path}' is empty.`,
      artifactId: artifact.id,
      path: artifact.path,
      expected: "> 0",
      actual: 0
    });
  }

  if (stats.size !== artifact.sizeBytes) {
    errors.push({
      code: "SIZE_MISMATCH",
      message: `Artifact '${artifact.path}' size does not match registry metadata.`,
      artifactId: artifact.id,
      path: artifact.path,
      expected: artifact.sizeBytes,
      actual: stats.size
    });
  }

  if (SHA256_HEX_RE.test(artifact.sha256)) {
    const actual = await computeFileSha256(target);
    if (actual !== artifact.sha256) {
      errors.push({
        code: "CHECKSUM_MISMATCH",
        message: `Artifact '${artifact.path}' checksum does not match registry metadata.`,
        artifactId: artifact.id,
        path: artifact.path,
        expected: artifact.sha256,
        actual
      });
    }
  }
}

function isSafeArtifactPath(path: string): boolean {
  if (path.trim() === "" || isAbsolute(path) || path.includes("\\") || path.includes("\0")) {
    return false;
  }

  const normalized = normalizePosixPath(path);
  return normalized !== "." && normalized === path && !normalized.startsWith("../");
}

function validateCount(
  errors: TurkeyV2NationalValidationIssue[],
  code: TurkeyV2NationalCompletenessErrorCode,
  label: string,
  expected: number,
  actual: number | undefined
): void {
  if (actual !== undefined && actual !== expected) {
    errors.push({
      code,
      message: `Publish-ready Turkey V2 national output must contain exactly ${expected} ${label} records.`,
      path: "coverage.json",
      expected,
      actual
    });
  }
}

function validateSourceLockCounts(
  errors: TurkeyV2NationalValidationIssue[],
  sourceLock: Record<string, unknown>,
  coverage: Record<string, unknown>
): void {
  const adm0Adm2 = isRecord(sourceLock.adm0Adm2) ? sourceLock.adm0Adm2 : undefined;
  const levels = adm0Adm2 && isRecord(adm0Adm2.levels) ? adm0Adm2.levels : undefined;

  for (const [level, expectedNationalCount] of Object.entries(TURKEY_V2_NATIONAL_EXPECTED_COUNTS)) {
    const lock = levels && isRecord(levels[level]) ? levels[level] : undefined;
    if (!lock) {
      continue;
    }

    const expectedFeatureCount = readNumber(lock.expectedFeatureCount);
    const actualFeatureCount = readNumber(lock.actualFeatureCount);
    const reportCount =
      level === "ADM0"
        ? readNumber(coverage.adm0Count)
        : level === "ADM1"
          ? readNumber(coverage.provinceCount)
          : readNumber(coverage.districtCount);

    if (expectedFeatureCount !== undefined && expectedFeatureCount !== expectedNationalCount) {
      errors.push({
        code: "NATIONAL_SOURCE_LOCK_EXPECTED_COUNT_MISMATCH",
        message: `Source-lock expected ${level} count must be ${expectedNationalCount}.`,
        path: "source-lock.json",
        expected: expectedNationalCount,
        actual: expectedFeatureCount
      });
    }

    if (actualFeatureCount !== undefined && actualFeatureCount !== expectedNationalCount) {
      errors.push({
        code: "NATIONAL_SOURCE_LOCK_ACTUAL_COUNT_MISMATCH",
        message: `Source-lock actual ${level} count must be ${expectedNationalCount}.`,
        path: "source-lock.json",
        expected: expectedNationalCount,
        actual: actualFeatureCount
      });
    }

    if (
      reportCount !== undefined &&
      actualFeatureCount !== undefined &&
      reportCount !== actualFeatureCount
    ) {
      errors.push({
        code: "NATIONAL_SOURCE_LOCK_DATASET_COUNT_MISMATCH",
        message: `Coverage ${level} count must match source-lock actual count.`,
        path: "source-lock.json",
        expected: actualFeatureCount,
        actual: reportCount
      });
    }
  }
}

function readNumber(input: unknown): number | undefined {
  return typeof input === "number" && Number.isFinite(input) ? input : undefined;
}

function readString(input: unknown): string | undefined {
  return typeof input === "string" && input.trim().length > 0 ? input.trim() : undefined;
}

function toValidationResult(
  errors: TurkeyV2NationalValidationIssue[]
): TurkeyV2NationalValidationResult {
  return {
    ok: errors.length === 0,
    errorCount: errors.length,
    errors: errors.sort(
      (left, right) =>
        left.code.localeCompare(right.code) ||
        (left.path ?? "").localeCompare(right.path ?? "") ||
        (left.artifactId ?? "").localeCompare(right.artifactId ?? "")
    )
  };
}
