import { createHash } from "node:crypto";
import type { TerritoryZone } from "@territory-kit/dataset";
import { TURKEY_SMART_FALLBACK_ALGORITHM_VERSION } from "./turkey-smart-fallback.js";
import type { TurkeyV2HybridDistrictBuildOptions } from "./turkey-v2-hybrid.js";

/**
 * District checkpoint envelope schema. Bump when stored checkpoint JSON shape changes.
 */
export const TURKEY_V2_NATIONAL_DISTRICT_CHECKPOINT_SCHEMA_VERSION =
  "territorykit-tr-smart-district-checkpoint@5" as const;

/**
 * Implementation / cache revision for national district geometry production.
 *
 * Distinct from {@link TURKEY_SMART_FALLBACK_ALGORITHM_VERSION}: bump this when hybrid/smart
 * production behavior changes without an algorithm version bump. Territory IDs and dataset
 * versions are unchanged; old checkpoints must not restore against a newer revision.
 */
export const TURKEY_V2_NATIONAL_CHECKPOINT_IMPLEMENTATION_REVISION =
  "national-playable-rescue-v1" as const;

/**
 * SHA-256 digests of modules that change national district geometry output without a smart-fallback
 * algorithm version bump. When any digest drifts, bump
 * {@link TURKEY_V2_NATIONAL_CHECKPOINT_IMPLEMENTATION_REVISION} and refresh this map in the same
 * change (see `turkey-v2-national-checkpoint.test.ts`).
 */
export const TURKEY_V2_NATIONAL_CHECKPOINT_PRODUCTION_BEHAVIOR_DIGESTS: Readonly<
  Record<string, string>
> = {
  "packages/generators/src/turkey-smart-fallback.ts":
    "2cb8df71a75074f0e0bd71ca555365158864a7496f665d6a3070f024fe5ecd3b",
  "packages/generators/src/turkey-seed-watershed.ts":
    "3edac6b215923f720049083802dd545a12428d7b615e4f378ebd3e1b3629ce97",
  "packages/generators/src/turkey-smart-derived-v2-pilot.ts":
    "e8434f71615f9945c9ec9fbe4471b778ccd1102d456e3855f26a74ca1d0c8c5b",
  "packages/generators/src/turkey-playable-rescue.ts":
    "4d6903db633dbfe8c34dcfb10347985c6d0b64f178c6097e8af89b389002660f",
  "packages/generators/src/turkey-v2-hybrid.ts":
    "7d9f44e058e5312bfe57e30dca424bc18669a253d5f8c25375434dd93e7dbec3",
  "packages/cli/src/turkey-adm3-hybrid.ts":
    "6ff9f43412b8c994ead240e0e8194b6515dd41c5cd7fc1f03886dd5f44a19743",
  "packages/cli/src/turkey-v2-national.ts":
    "4f9dc1687d6e78d092648dd1df4c11cc008d72b23ee43819a19c82b7524a27ad"
};

export type TurkeyV2NationalDistrictCheckpointKeyInput = {
  options: TurkeyV2HybridDistrictBuildOptions;
  officialNationalPriorityPolicy?: string;
  snapshotChecksum: string;
  datasetVersion: string;
  sourceLockHash: string;
};

export type TurkeyV2NationalDistrictCheckpointEnvelope = {
  schemaVersion: typeof TURKEY_V2_NATIONAL_DISTRICT_CHECKPOINT_SCHEMA_VERSION;
  implementationRevision: typeof TURKEY_V2_NATIONAL_CHECKPOINT_IMPLEMENTATION_REVISION;
  generationDurationMs?: number;
  key: string;
  resultHash: string;
  result: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableSerialize(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function stableNationalCheckpointHash(value: unknown): string {
  return createHash("sha256")
    .update(`${JSON.stringify(JSON.parse(stableSerialize(value)), null, 2)}\n`)
    .digest("hex");
}

export function resolveTurkeyV2NationalOfficialNationalPriorityPolicy(
  officialZones: readonly TerritoryZone[] | undefined
): string | undefined {
  return officialZones?.some((zone) => {
    const territory = isRecord(zone.properties.territory) ? zone.properties.territory : {};
    return (
      (territory.boundarySourceClass ??
        (isRecord(territory.source) ? territory.source.boundarySourceClass : undefined)) ===
      "official-national"
    );
  })
    ? "national-before-local-v1"
    : undefined;
}

export function createTurkeyV2NationalDistrictCheckpointKey(
  input: TurkeyV2NationalDistrictCheckpointKeyInput
): string {
  return stableNationalCheckpointHash({
    options: input.options,
    officialNationalPriorityPolicy: input.officialNationalPriorityPolicy,
    snapshotChecksum: input.snapshotChecksum,
    datasetVersion: input.datasetVersion,
    checkpointSchema: TURKEY_V2_NATIONAL_DISTRICT_CHECKPOINT_SCHEMA_VERSION,
    implementationRevision: TURKEY_V2_NATIONAL_CHECKPOINT_IMPLEMENTATION_REVISION,
    sourceLockHash: input.sourceLockHash,
    algorithm: TURKEY_SMART_FALLBACK_ALGORITHM_VERSION
  });
}

export type TurkeyV2NationalDistrictCheckpointRestoreDecision =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "invalid-envelope"
        | "schema-mismatch"
        | "implementation-revision-mismatch"
        | "quality-not-ok"
        | "key-mismatch"
        | "result-hash-mismatch";
    };

export function evaluateTurkeyV2NationalDistrictCheckpointRestore(
  stored: unknown,
  expectedKey: string
): TurkeyV2NationalDistrictCheckpointRestoreDecision {
  if (!isRecord(stored)) {
    return { ok: false, reason: "invalid-envelope" };
  }
  if (stored.schemaVersion !== TURKEY_V2_NATIONAL_DISTRICT_CHECKPOINT_SCHEMA_VERSION) {
    return { ok: false, reason: "schema-mismatch" };
  }
  if (stored.implementationRevision !== TURKEY_V2_NATIONAL_CHECKPOINT_IMPLEMENTATION_REVISION) {
    return { ok: false, reason: "implementation-revision-mismatch" };
  }
  const result = stored.result;
  if (!isRecord(result) || !isRecord(result.quality) || result.quality.ok !== true) {
    return { ok: false, reason: "quality-not-ok" };
  }
  if (stored.key !== expectedKey) {
    return { ok: false, reason: "key-mismatch" };
  }
  const storedResultHash = readString(stored.resultHash);
  if (!storedResultHash || stableNationalCheckpointHash(result) !== storedResultHash) {
    return { ok: false, reason: "result-hash-mismatch" };
  }
  return { ok: true };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function createTurkeyV2NationalDistrictCheckpointEnvelope(input: {
  generationDurationMs?: number;
  key: string;
  resultHash: string;
  result: unknown;
}): TurkeyV2NationalDistrictCheckpointEnvelope {
  return {
    schemaVersion: TURKEY_V2_NATIONAL_DISTRICT_CHECKPOINT_SCHEMA_VERSION,
    implementationRevision: TURKEY_V2_NATIONAL_CHECKPOINT_IMPLEMENTATION_REVISION,
    ...(input.generationDurationMs === undefined
      ? {}
      : { generationDurationMs: input.generationDurationMs }),
    key: input.key,
    resultHash: input.resultHash,
    result: input.result
  };
}
