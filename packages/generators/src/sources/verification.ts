import { stat } from "node:fs/promises";
import { createSourceIssue } from "./errors.js";
import { sha256File } from "./transports/file.js";
import type {
  TerritorySourceArtifact,
  TerritorySourceContext,
  TerritorySourceIssue,
  TerritorySourceRequest,
  TerritorySourceVerificationResult
} from "./types.js";

export async function verifySourceArtifact(
  artifact: TerritorySourceArtifact,
  context: TerritorySourceContext,
  request: TerritorySourceRequest
): Promise<TerritorySourceVerificationResult> {
  const issues: TerritorySourceIssue[] = [];

  try {
    const fileStat = await stat(artifact.localPath);

    if (!fileStat.isFile()) {
      issues.push(
        createSourceIssue({
          stage: "verify",
          code: "SOURCE_INPUT_NOT_FILE",
          message: "Source artifact is not a regular file.",
          provider: artifact.provider,
          sourcePath: artifact.localPath
        })
      );
    }

    if (fileStat.size > context.maxSourceSizeBytes) {
      issues.push(
        createSourceIssue({
          stage: "verify",
          code: "SOURCE_TOO_LARGE",
          message: `Source artifact is ${fileStat.size} bytes, above the ${context.maxSourceSizeBytes} byte limit.`,
          provider: artifact.provider,
          sourcePath: artifact.localPath,
          details: { sizeBytes: fileStat.size, maxSourceSizeBytes: context.maxSourceSizeBytes }
        })
      );
    }

    const actualSha256 = await sha256File(artifact.localPath);

    if (artifact.sha256 !== actualSha256) {
      issues.push(
        createSourceIssue({
          stage: "verify",
          code: "SOURCE_CACHE_CORRUPT",
          message: "Source artifact checksum changed after fetch.",
          provider: artifact.provider,
          sourcePath: artifact.localPath,
          details: { expectedSha256: artifact.sha256, actualSha256 }
        })
      );
    }

    if (request.expectedSha256 && request.expectedSha256 !== actualSha256) {
      issues.push(
        createSourceIssue({
          stage: "verify",
          code: "SOURCE_CHECKSUM_MISMATCH",
          message: "Source SHA-256 does not match the expected checksum.",
          provider: artifact.provider,
          sourcePath: artifact.localPath,
          details: { expectedSha256: request.expectedSha256, actualSha256 }
        })
      );
    }
  } catch (error) {
    issues.push(
      createSourceIssue({
        stage: "verify",
        code: "SOURCE_INPUT_NOT_FOUND",
        message: error instanceof Error ? error.message : String(error),
        provider: artifact.provider,
        sourcePath: artifact.localPath
      })
    );
  }

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    issues
  };
}
