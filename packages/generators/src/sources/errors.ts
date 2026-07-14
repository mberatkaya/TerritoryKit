import type { TerritorySourceIssue, TerritorySourceStage } from "./types.js";

export class TerritorySourceError extends Error {
  readonly code: string;
  readonly provider: string | undefined;
  readonly stage: TerritorySourceStage;
  readonly details: Record<string, unknown> | undefined;

  constructor(options: {
    code: string;
    message: string;
    stage: TerritorySourceStage;
    provider?: string;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "TerritorySourceError";
    this.code = options.code;
    this.stage = options.stage;
    this.provider = options.provider;
    this.details = options.details;
  }
}

export function createSourceIssue(options: {
  stage: TerritorySourceStage;
  severity?: "info" | "warning" | "error";
  code: string;
  message: string;
  provider?: string;
  featureId?: string;
  sourcePath?: string;
  cause?: string;
  repairSuggestion?: string;
  details?: Record<string, unknown>;
}): TerritorySourceIssue {
  return {
    stage: options.stage,
    severity: options.severity ?? "error",
    code: options.code,
    message: options.message,
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.featureId ? { featureId: options.featureId } : {}),
    ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
    ...(options.cause ? { cause: options.cause } : {}),
    ...(options.repairSuggestion ? { repairSuggestion: options.repairSuggestion } : {}),
    ...(options.details ? { details: options.details } : {})
  };
}

export function issueFromUnknownError(
  error: unknown,
  fallback: {
    stage: TerritorySourceStage;
    code: string;
    provider?: string;
  }
): TerritorySourceIssue {
  if (error instanceof TerritorySourceError) {
    return createSourceIssue({
      stage: error.stage,
      code: error.code,
      message: error.message,
      ...(error.provider ? { provider: error.provider } : {}),
      ...(error.details ? { details: error.details } : {})
    });
  }

  return createSourceIssue({
    stage: fallback.stage,
    code: fallback.code,
    message: error instanceof Error ? error.message : String(error),
    ...(fallback.provider ? { provider: fallback.provider } : {})
  });
}
