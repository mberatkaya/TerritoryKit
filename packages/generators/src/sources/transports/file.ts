import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { TerritorySourceError } from "../errors.js";
import type { TerritorySourceArtifact, TerritorySourceRequest } from "../types.js";

export async function resolveFileSourceArtifact(options: {
  provider: string;
  request: TerritorySourceRequest;
  cwd: string;
  maxSourceSizeBytes: number;
}): Promise<TerritorySourceArtifact> {
  const input = options.request.input;

  if (!input) {
    throw new TerritorySourceError({
      code: "SOURCE_INPUT_NOT_FOUND",
      message: "A local source input path is required.",
      stage: "fetch",
      provider: options.provider
    });
  }

  const localPath = await realpath(resolve(options.cwd, input)).catch((error: unknown) => {
    throw new TerritorySourceError({
      code: "SOURCE_INPUT_NOT_FOUND",
      message: error instanceof Error ? error.message : String(error),
      stage: "fetch",
      provider: options.provider,
      details: { input }
    });
  });
  const fileStat = await stat(localPath);

  if (!fileStat.isFile()) {
    throw new TerritorySourceError({
      code: "SOURCE_INPUT_NOT_FILE",
      message: `Source input '${localPath}' is not a regular file.`,
      stage: "fetch",
      provider: options.provider,
      details: { localPath }
    });
  }

  if (fileStat.size > options.maxSourceSizeBytes) {
    throw new TerritorySourceError({
      code: "SOURCE_TOO_LARGE",
      message: `Source input is ${fileStat.size} bytes, above the ${options.maxSourceSizeBytes} byte limit.`,
      stage: "fetch",
      provider: options.provider,
      details: {
        localPath,
        sizeBytes: fileStat.size,
        maxSourceSizeBytes: options.maxSourceSizeBytes
      }
    });
  }

  const sha256 = await sha256File(localPath);

  return {
    provider: options.provider,
    localPath,
    sha256,
    sizeBytes: fileStat.size,
    ...(options.request.version ? { sourceVersion: options.request.version } : {}),
    cacheHit: false
  };
}

export async function sha256File(localPath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(localPath);

  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }

  return hash.digest("hex");
}
