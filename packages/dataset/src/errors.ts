import type { TerritoryValidationIssue } from "./types.js";

export const TERRITORY_ERROR_CODES = [
  "UNKNOWN",
  "ZONE_NOT_FOUND",
  "INVALID_COORDINATE",
  "INVALID_BOUNDS",
  "INVALID_LEVEL",
  "INVALID_NEIGHBOR_DISTANCE",
  "ENGINE_STATE_INVALID",
  "DATASET_INVALID",
  "DATASET_SCHEMA_UNSUPPORTED",
  "DATASET_VERSION_UNSUPPORTED",
  "GEOMETRY_INVALID",
  "DATASET_NOT_FOUND",
  "ARTIFACT_NOT_FOUND",
  "CHECKSUM_MISMATCH",
  "ARTIFACT_CORRUPTED",
  "CACHE_CORRUPTED",
  "DOWNLOAD_TIMEOUT",
  "REQUEST_ABORTED",
  "RUNTIME_DISPOSED",
  "RUNTIME_NOT_READY",
  "RUNTIME_CONFIGURATION_INVALID",
  "CAPABILITY_UNSUPPORTED",
  "ADAPTER_NOT_ATTACHED",
  "ADAPTER_DISPOSED",
  "ADAPTER_TARGET_INVALID"
] as const;

export type TerritoryErrorCode = (typeof TERRITORY_ERROR_CODES)[number];

export type TerritoryErrorDetailValue =
  | null
  | boolean
  | number
  | string
  | readonly TerritoryErrorDetailValue[]
  | { readonly [key: string]: TerritoryErrorDetailValue };

export type TerritoryErrorDetails = Readonly<Record<string, TerritoryErrorDetailValue>>;

export interface TerritoryErrorOptions {
  details?: Readonly<Record<string, unknown>>;
  cause?: unknown;
}

export interface SerializedTerritoryErrorCause {
  name: string;
  message: string;
  code?: TerritoryErrorCode;
}

export interface SerializedTerritoryError {
  name: string;
  message: string;
  code: TerritoryErrorCode;
  details?: TerritoryErrorDetails;
  cause?: SerializedTerritoryErrorCause;
}

const TERRITORY_ERROR_CODE_SET: ReadonlySet<string> = new Set(TERRITORY_ERROR_CODES);
const REDACTED_DETAIL_KEYS = ["authorization", "cookie", "password", "secret", "token"];
const MAX_DETAIL_DEPTH = 4;

export class TerritoryError extends Error {
  readonly code: TerritoryErrorCode;
  readonly details?: TerritoryErrorDetails;
  readonly territoryKitError = true;

  constructor(code: TerritoryErrorCode, message: string, options: TerritoryErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "TerritoryError";
    this.code = code;

    const details = sanitizeDetails(options.details);

    if (details) {
      this.details = details;
    }
  }
}

export function isTerritoryError(input: unknown): input is TerritoryError {
  return (
    input instanceof TerritoryError ||
    (isRecord(input) &&
      input.territoryKitError === true &&
      typeof input.message === "string" &&
      isTerritoryErrorCode(input.code))
  );
}

export function serializeTerritoryError(input: unknown): SerializedTerritoryError {
  const error = toSerializedTerritoryError(input);
  const details = error.details ? sanitizeDetails(error.details) : undefined;

  return {
    name: error.name,
    message: error.message,
    code: error.code,
    ...(details ? { details } : {}),
    ...(error.cause ? { cause: error.cause } : {})
  };
}

export function deserializeTerritoryError(input: unknown): TerritoryError {
  if (!isRecord(input)) {
    return new TerritoryError("UNKNOWN", "Unknown TerritoryKit error.");
  }

  const code = isTerritoryErrorCode(input.code) ? input.code : "UNKNOWN";
  const message = typeof input.message === "string" ? input.message : "Unknown TerritoryKit error.";
  const details = sanitizeDetails(isRecord(input.details) ? input.details : undefined);
  const cause = deserializeCause(input.cause);

  return new TerritoryError(code, message, {
    ...(details ? { details } : {}),
    ...(cause ? { cause } : {})
  });
}

export class TerritoryDatasetValidationError extends TerritoryError {
  readonly issues: TerritoryValidationIssue[];

  constructor(issues: TerritoryValidationIssue[]) {
    const summary = issues
      .slice(0, 3)
      .map((issue) => `${issue.code} at ${issue.path}`)
      .join(", ");

    super(
      "DATASET_INVALID",
      `Territory dataset validation failed with ${issues.length} issue(s)${
        summary.length > 0 ? `: ${summary}` : ""
      }`,
      {
        details: {
          issueCount: issues.length,
          issues: issues.slice(0, 5).map((issue) => ({
            code: issue.code,
            path: issue.path,
            severity: issue.severity
          }))
        }
      }
    );

    this.name = "TerritoryDatasetValidationError";
    this.issues = issues;
  }
}

function toSerializedTerritoryError(input: unknown): SerializedTerritoryError {
  if (isTerritoryError(input)) {
    const cause = readErrorCause(input);

    return {
      name: input.name,
      message: input.message,
      code: input.code,
      ...(input.details ? { details: input.details } : {}),
      ...(cause ? { cause } : {})
    };
  }

  if (input instanceof Error) {
    const cause = readErrorCause(input);

    return {
      name: input.name || "Error",
      message: input.message || "Unknown TerritoryKit error.",
      code: "UNKNOWN",
      ...(cause ? { cause } : {})
    };
  }

  return {
    name: "TerritoryError",
    message: "Unknown TerritoryKit error.",
    code: "UNKNOWN"
  };
}

function readErrorCause(error: Error): SerializedTerritoryErrorCause | undefined {
  if (!("cause" in error) || error.cause === undefined) {
    return undefined;
  }

  if (isTerritoryError(error.cause)) {
    return {
      name: error.cause.name,
      message: error.cause.message,
      code: error.cause.code
    };
  }

  if (error.cause instanceof Error) {
    return {
      name: error.cause.name || "Error",
      message: error.cause.message || "Unknown error"
    };
  }

  return {
    name: "Error",
    message: "Unknown error"
  };
}

function deserializeCause(input: unknown): Error | undefined {
  if (!isRecord(input)) {
    return undefined;
  }

  const message = typeof input.message === "string" ? input.message : "Unknown error";

  if (isTerritoryErrorCode(input.code)) {
    return new TerritoryError(input.code, message);
  }

  const cause = new Error(message);
  cause.name = typeof input.name === "string" ? input.name : "Error";
  return cause;
}

function sanitizeDetails(
  details: Readonly<Record<string, unknown>> | undefined
): TerritoryErrorDetails | undefined {
  if (!details) {
    return undefined;
  }

  const output: Record<string, TerritoryErrorDetailValue> = {};

  for (const [key, value] of Object.entries(details)) {
    const sanitized = shouldRedactDetailKey(key)
      ? "[Redacted]"
      : sanitizeDetailValue(value, MAX_DETAIL_DEPTH);

    if (sanitized !== undefined) {
      output[key] = sanitized;
    }
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function sanitizeDetailValue(
  input: unknown,
  remainingDepth: number
): TerritoryErrorDetailValue | undefined {
  if (remainingDepth <= 0) {
    return "[Truncated]";
  }

  if (input === null || typeof input === "string" || typeof input === "boolean") {
    return input;
  }

  if (typeof input === "number") {
    return Number.isFinite(input) ? input : String(input);
  }

  if (typeof input === "bigint") {
    return input.toString();
  }

  if (input instanceof Date) {
    return input.toISOString();
  }

  if (Array.isArray(input)) {
    return input
      .map((item) => sanitizeDetailValue(item, remainingDepth - 1))
      .filter((item): item is TerritoryErrorDetailValue => item !== undefined);
  }

  if (isRecord(input)) {
    const output: Record<string, TerritoryErrorDetailValue> = {};

    for (const [key, value] of Object.entries(input)) {
      const sanitized = shouldRedactDetailKey(key)
        ? "[Redacted]"
        : sanitizeDetailValue(value, remainingDepth - 1);

      if (sanitized !== undefined) {
        output[key] = sanitized;
      }
    }

    return output;
  }

  return undefined;
}

function shouldRedactDetailKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return REDACTED_DETAIL_KEYS.some((redacted) => normalized.includes(redacted));
}

function isTerritoryErrorCode(input: unknown): input is TerritoryErrorCode {
  return typeof input === "string" && TERRITORY_ERROR_CODE_SET.has(input);
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
