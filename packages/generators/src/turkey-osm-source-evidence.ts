import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { TurkeyOsmBarrierManifest } from "./turkey-osm-barriers.js";
import {
  TURKEY_OSM_BARRIER_PROVIDER_ID,
  parseTurkeyOsmSnapshotSourceLock,
  verifyTurkeyOsmSnapshot,
  type TurkeyOsmSnapshotSourceLock
} from "./turkey-osm-barriers.js";
import { isRecord, serializeJsonStable, sha256Hex } from "./sources/utils.js";

export const TURKEY_OSM_SOURCE_EVIDENCE_ISSUE_CODES = [
  "SOURCE_LOCK_FILE_MISSING",
  "SOURCE_LOCK_SCHEMA_INVALID",
  "SOURCE_LOCK_CONTENT_HASH_FORGERY",
  "SOURCE_LOCK_SNAPSHOT_ID_MISMATCH",
  "SOURCE_LOCK_FILE_SIZE_MISMATCH",
  "OSM_SNAPSHOT_NOT_FOUND",
  "OSM_SNAPSHOT_CHECKSUM_MISMATCH",
  "BARRIER_SNAPSHOT_CHECKSUM_MISMATCH",
  "BARRIER_SOURCE_SNAPSHOT_CHECKSUM_MISMATCH",
  "BARRIER_PROVIDER_MISMATCH",
  "BARRIER_ADM2_LINEAGE_MISMATCH",
  "BARRIER_SNAPSHOT_DATE_MISMATCH",
  "LICENSE_NOT_IDENTIFIED",
  "REDISTRIBUTION_NOT_APPROVED"
] as const;

export type TurkeyOsmSourceEvidenceIssueCode =
  (typeof TURKEY_OSM_SOURCE_EVIDENCE_ISSUE_CODES)[number];

export type TurkeyOsmSourceEvidenceIssueSeverity = "error" | "warning";

export interface TurkeyOsmSourceEvidenceIssue {
  code: TurkeyOsmSourceEvidenceIssueCode | string;
  severity: TurkeyOsmSourceEvidenceIssueSeverity;
  message: string;
  path?: string;
}

export interface TurkeyOsmSourceEvidenceGates {
  /** Snapshot bytes match source-lock SHA-256 and barrier lineage checks passed. */
  sourceBytesVerified: boolean;
  /** License string present on lock + barrier manifest (not legal approval). */
  licenseIdentified: boolean;
  /** Human/legal redistribution approval — never inferred from ODbL text alone. */
  redistributionRightsApproved: boolean;
  /** Hosted/production delivery — requires all gates plus explicit human authorization. */
  productionEligible: boolean;
}

export interface TurkeyOsmSourceEvidenceEvaluation {
  ok: boolean;
  sourceLockState: "verified" | "pending" | "unknown";
  snapshotSha256: string | null;
  sourceLockPath: string | null;
  sourceLockContentHash: string | null;
  reasonCodes: string[];
  issues: TurkeyOsmSourceEvidenceIssue[];
  gates: TurkeyOsmSourceEvidenceGates;
  licenseState: "pending" | "approved" | "unknown";
  redistributionApproval: "pending" | "approved" | "unknown";
  hostedDeliveryApproval: "pending" | "approved" | "unknown";
}

export interface EvaluateTurkeyOsmSourceEvidenceOptions {
  repoRoot: string;
  sourceLockPath: string;
  barrierManifest?: Pick<TurkeyOsmBarrierManifest, "adm2Id" | "source" | "sourceSnapshotChecksum">;
  expectedAdm2Id?: string;
  /** When false, skip on-disk snapshot verification (metadata-only negative tests). */
  verifySnapshotBytes?: boolean;
}

const SOURCE_LOCK_CONTENT_HASH_FIELDS = [
  "schemaVersion",
  "providerId",
  "providerName",
  "countryCode",
  "sourceUrl",
  "downloadUrl",
  "sourceDatasetId",
  "snapshotDate",
  "downloadedAt",
  "fileSizeBytes",
  "sha256",
  "license",
  "attribution",
  "format",
  "contentAddressedSnapshotId",
  "cachePath",
  "pbfHeader"
] as const;

export function computeTurkeyOsmSnapshotSourceLockContentHash(
  sourceLock: TurkeyOsmSnapshotSourceLock
): string {
  const identity = Object.fromEntries(
    SOURCE_LOCK_CONTENT_HASH_FIELDS.map((field) => [field, sourceLock[field]])
  );
  return sha256Hex(serializeJsonStable(identity));
}

export function detectForgedSourceLockContentHash(
  rawLock: Record<string, unknown>,
  sourceLock: TurkeyOsmSnapshotSourceLock
): TurkeyOsmSourceEvidenceIssue | null {
  if (!("contentHash" in rawLock)) {
    return null;
  }

  const claimed = rawLock.contentHash;
  if (typeof claimed !== "string" || claimed.length === 0) {
    return {
      code: "SOURCE_LOCK_CONTENT_HASH_FORGERY",
      severity: "error",
      message: "Source lock contentHash claim is present but not a non-empty string.",
      path: "$.contentHash"
    };
  }

  const expected = `sha256:${computeTurkeyOsmSnapshotSourceLockContentHash(sourceLock)}`;
  const normalizedClaim = claimed.startsWith("sha256:") ? claimed : `sha256:${claimed}`;
  if (normalizedClaim !== expected) {
    return {
      code: "SOURCE_LOCK_CONTENT_HASH_FORGERY",
      severity: "error",
      message: "Source lock contentHash does not match deterministic lock identity hash.",
      path: "$.contentHash"
    };
  }

  return null;
}

export async function evaluateTurkeyOsmSourceEvidence(
  options: EvaluateTurkeyOsmSourceEvidenceOptions
): Promise<TurkeyOsmSourceEvidenceEvaluation> {
  const issues: TurkeyOsmSourceEvidenceIssue[] = [];
  const reasonCodes = new Set<string>();
  const verifySnapshotBytes = options.verifySnapshotBytes ?? true;
  const absoluteLockPath = isAbsolute(options.sourceLockPath)
    ? options.sourceLockPath
    : join(options.repoRoot, options.sourceLockPath);

  let rawLock: Record<string, unknown>;
  let sourceLock: TurkeyOsmSnapshotSourceLock;

  try {
    const parsed = JSON.parse(await readFile(absoluteLockPath, "utf8")) as Record<string, unknown>;
    rawLock = parsed;
    sourceLock = parseTurkeyOsmSnapshotSourceLock(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ENOENT") || message.includes("no such file")) {
      issues.push({
        code: "SOURCE_LOCK_FILE_MISSING",
        severity: "error",
        message: `OSM source lock not found at ${options.sourceLockPath}.`,
        path: options.sourceLockPath
      });
      reasonCodes.add("SOURCE_LOCK_MISSING");
    } else {
      issues.push({
        code: "SOURCE_LOCK_SCHEMA_INVALID",
        severity: "error",
        message: `Invalid OSM source lock: ${message}`,
        path: options.sourceLockPath
      });
      reasonCodes.add("SOURCE_LOCK_INVALID");
    }

    return finalizeEvaluation({
      sourceLockPath: options.sourceLockPath,
      snapshotSha256: null,
      sourceLockContentHash: null,
      issues,
      reasonCodes
    });
  }

  const forgeryIssue = detectForgedSourceLockContentHash(rawLock, sourceLock);
  if (forgeryIssue) {
    issues.push(forgeryIssue);
    reasonCodes.add("SOURCE_LOCK_CONTENT_HASH_FORGERY");
  }

  const expectedSnapshotId = `TR-${sourceLock.sha256.slice(0, 16)}`;
  if (sourceLock.contentAddressedSnapshotId !== expectedSnapshotId) {
    issues.push({
      code: "SOURCE_LOCK_SNAPSHOT_ID_MISMATCH",
      severity: "error",
      message: `Expected contentAddressedSnapshotId ${expectedSnapshotId}, received ${sourceLock.contentAddressedSnapshotId}.`,
      path: "$.contentAddressedSnapshotId"
    });
    reasonCodes.add("SOURCE_LOCK_SNAPSHOT_ID_MISMATCH");
  }

  const snapshotPath = isAbsolute(sourceLock.cachePath)
    ? sourceLock.cachePath
    : join(options.repoRoot, sourceLock.cachePath);

  if (verifySnapshotBytes) {
    try {
      const snapshotStat = await stat(snapshotPath);
      if (snapshotStat.size !== sourceLock.fileSizeBytes) {
        issues.push({
          code: "SOURCE_LOCK_FILE_SIZE_MISMATCH",
          severity: "error",
          message: `Source lock fileSizeBytes ${sourceLock.fileSizeBytes} does not match snapshot size ${snapshotStat.size}.`,
          path: sourceLock.cachePath
        });
        reasonCodes.add("SOURCE_LOCK_FILE_SIZE_MISMATCH");
      }
    } catch {
      issues.push({
        code: "OSM_SNAPSHOT_NOT_FOUND",
        severity: "error",
        message: `OSM snapshot bytes missing at ${sourceLock.cachePath}.`,
        path: sourceLock.cachePath
      });
      reasonCodes.add("SOURCE_BYTES_MISSING");
    }

    const verification = await verifyTurkeyOsmSnapshot({
      sourceLockPath: absoluteLockPath,
      snapshotPath
    });
    for (const issue of verification.issues) {
      issues.push({
        code: issue.code,
        severity: issue.severity === "warning" ? "warning" : "error",
        message: issue.message,
        ...(issue.path ? { path: issue.path } : {})
      });
      if (issue.code === "OSM_SNAPSHOT_CHECKSUM_MISMATCH") {
        reasonCodes.add("SOURCE_SNAPSHOT_CHECKSUM_MISMATCH");
      }
      if (issue.code === "OSM_SNAPSHOT_NOT_FOUND") {
        reasonCodes.add("SOURCE_BYTES_MISSING");
      }
    }
  }

  const manifest = options.barrierManifest;
  if (manifest) {
    if (options.expectedAdm2Id && manifest.adm2Id !== options.expectedAdm2Id) {
      issues.push({
        code: "BARRIER_ADM2_LINEAGE_MISMATCH",
        severity: "error",
        message: `Barrier artifact adm2Id ${manifest.adm2Id} does not match expected ${options.expectedAdm2Id}.`,
        path: "$.manifest.adm2Id"
      });
      reasonCodes.add("BARRIER_ADM2_LINEAGE_MISMATCH");
    }

    if (manifest.source.providerId !== TURKEY_OSM_BARRIER_PROVIDER_ID) {
      issues.push({
        code: "BARRIER_PROVIDER_MISMATCH",
        severity: "error",
        message: `Barrier provider ${manifest.source.providerId} does not match pinned ${TURKEY_OSM_BARRIER_PROVIDER_ID}.`,
        path: "$.manifest.source.providerId"
      });
      reasonCodes.add("BARRIER_PROVIDER_MISMATCH");
    }

    if (manifest.source.snapshotSha256 !== sourceLock.sha256) {
      issues.push({
        code: "BARRIER_SNAPSHOT_CHECKSUM_MISMATCH",
        severity: "error",
        message: "Barrier manifest snapshotSha256 does not match source-lock sha256.",
        path: "$.manifest.source.snapshotSha256"
      });
      reasonCodes.add("BARRIER_SNAPSHOT_CHECKSUM_MISMATCH");
    }

    if (manifest.sourceSnapshotChecksum && manifest.sourceSnapshotChecksum !== sourceLock.sha256) {
      issues.push({
        code: "BARRIER_SOURCE_SNAPSHOT_CHECKSUM_MISMATCH",
        severity: "error",
        message: "Barrier manifest sourceSnapshotChecksum does not match source-lock sha256.",
        path: "$.manifest.sourceSnapshotChecksum"
      });
      reasonCodes.add("BARRIER_SOURCE_SNAPSHOT_CHECKSUM_MISMATCH");
    }

    if (manifest.source.snapshotDate !== sourceLock.snapshotDate) {
      issues.push({
        code: "BARRIER_SNAPSHOT_DATE_MISMATCH",
        severity: "warning",
        message: "Barrier manifest snapshotDate differs from source-lock snapshotDate.",
        path: "$.manifest.source.snapshotDate"
      });
      reasonCodes.add("BARRIER_SNAPSHOT_DATE_MISMATCH");
    }
  }

  const licenseIdentified =
    Boolean(sourceLock.license?.trim()) && (!manifest || Boolean(manifest.source.license?.trim()));

  if (!licenseIdentified) {
    issues.push({
      code: "LICENSE_NOT_IDENTIFIED",
      severity: "warning",
      message: "License metadata missing on source lock or barrier manifest.",
      path: "$.license"
    });
    reasonCodes.add("LICENSE_NOT_IDENTIFIED");
  }

  reasonCodes.add("REDISTRIBUTION_NOT_APPROVED");
  issues.push({
    code: "REDISTRIBUTION_NOT_APPROVED",
    severity: "warning",
    message: "Redistribution/hosted delivery requires explicit human legal approval.",
    path: "$.gates.redistributionRightsApproved"
  });

  return finalizeEvaluation({
    sourceLockPath: options.sourceLockPath,
    snapshotSha256: sourceLock.sha256,
    sourceLockContentHash: computeTurkeyOsmSnapshotSourceLockContentHash(sourceLock),
    issues,
    reasonCodes,
    licenseIdentified
  });
}

function finalizeEvaluation(input: {
  sourceLockPath: string | null;
  snapshotSha256: string | null;
  sourceLockContentHash: string | null;
  issues: TurkeyOsmSourceEvidenceIssue[];
  reasonCodes: Set<string>;
  licenseIdentified?: boolean;
}): TurkeyOsmSourceEvidenceEvaluation {
  const hardErrors = input.issues.filter((issue) => issue.severity === "error");
  const sourceBytesVerified = hardErrors.length === 0 && input.snapshotSha256 !== null;
  const licenseIdentified = input.licenseIdentified ?? false;

  const gates: TurkeyOsmSourceEvidenceGates = {
    sourceBytesVerified,
    licenseIdentified,
    redistributionRightsApproved: false,
    productionEligible: false
  };

  let sourceLockState: TurkeyOsmSourceEvidenceEvaluation["sourceLockState"] = "unknown";
  if (sourceBytesVerified) {
    sourceLockState = "verified";
  } else if (
    input.reasonCodes.has("SOURCE_LOCK_MISSING") ||
    input.reasonCodes.has("SOURCE_BYTES_MISSING")
  ) {
    sourceLockState = "unknown";
  } else if (input.issues.length > 0) {
    sourceLockState = "pending";
  }

  if (!sourceBytesVerified && !input.reasonCodes.has("SOURCE_LOCK_MISSING")) {
    input.reasonCodes.add("SOURCE_VERIFICATION_FAILED");
  }

  return {
    ok: sourceBytesVerified,
    sourceLockState,
    snapshotSha256: input.snapshotSha256,
    sourceLockPath: input.sourceLockPath,
    sourceLockContentHash: input.sourceLockContentHash,
    reasonCodes: [...input.reasonCodes].sort(),
    issues: input.issues,
    gates,
    licenseState: licenseIdentified ? "pending" : "unknown",
    redistributionApproval: "pending",
    hostedDeliveryApproval: "pending"
  };
}

export function readOptionalContentHashField(raw: unknown): string | null {
  if (!isRecord(raw) || typeof raw.contentHash !== "string") {
    return null;
  }
  return raw.contentHash;
}
