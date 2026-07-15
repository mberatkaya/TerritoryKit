import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { TerritorySourceError } from "../errors.js";
import type { TerritorySourceArtifact } from "../types.js";

export interface HttpSourceTransportOptions {
  provider: string;
  url: string;
  destinationDirectory?: string;
  expectedSha256?: string;
  sourceVersion?: string;
  maxSourceSizeBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
  now(): string;
}

export async function fetchHttpSourceArtifact(
  options: HttpSourceTransportOptions
): Promise<TerritorySourceArtifact> {
  const maxRedirects = options.maxRedirects ?? 5;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const destinationDirectory =
    options.destinationDirectory ?? (await mkdtemp(join(tmpdir(), "territory-source-http-")));

  await mkdir(destinationDirectory, { recursive: true });
  const targetPath = join(destinationDirectory, "artifact");

  try {
    const result = await fetchWithRedirects({
      ...options,
      url: assertSupportedHttpUrl(options.url).href,
      maxRedirects,
      timeoutMs
    });
    const response = result.response;
    const contentLength = response.headers.get("content-length");

    if (contentLength && Number(contentLength) > options.maxSourceSizeBytes) {
      throw new TerritorySourceError({
        code: "SOURCE_TOO_LARGE",
        message: `Remote source declares ${contentLength} bytes, above the ${options.maxSourceSizeBytes} byte limit.`,
        stage: "fetch",
        provider: options.provider,
        details: { url: result.url, contentLength, maxSourceSizeBytes: options.maxSourceSizeBytes }
      });
    }

    if (!response.body) {
      throw new TerritorySourceError({
        code: "SOURCE_FETCH_FAILED",
        message: "Remote source response did not include a readable body.",
        stage: "fetch",
        provider: options.provider,
        details: { url: result.url }
      });
    }

    const hash = createHash("sha256");
    const chunks: Uint8Array[] = [];
    const reader = response.body.getReader();
    let sizeBytes = 0;

    while (true) {
      const { done, value } = await readBodyChunkWithTimeout(reader, timeoutMs, {
        provider: options.provider,
        url: result.url
      });

      if (done) {
        break;
      }

      if (value) {
        sizeBytes += value.byteLength;

        if (sizeBytes > options.maxSourceSizeBytes) {
          throw new TerritorySourceError({
            code: "SOURCE_TOO_LARGE",
            message: `Remote source exceeded the ${options.maxSourceSizeBytes} byte limit.`,
            stage: "fetch",
            provider: options.provider,
            details: {
              url: result.url,
              sizeBytes,
              maxSourceSizeBytes: options.maxSourceSizeBytes
            }
          });
        }

        hash.update(value);
        chunks.push(value);
      }
    }

    await writeFile(targetPath, Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));

    const sha256 = hash.digest("hex");

    if (options.expectedSha256 && options.expectedSha256 !== sha256) {
      throw new TerritorySourceError({
        code: "SOURCE_CHECKSUM_MISMATCH",
        message: "Remote source SHA-256 does not match the expected checksum.",
        stage: "verify",
        provider: options.provider,
        details: {
          expectedSha256: options.expectedSha256,
          actualSha256: sha256,
          url: result.url
        }
      });
    }

    const fileStat = await stat(targetPath);

    const etag = response.headers.get("etag");
    const lastModified = response.headers.get("last-modified");

    return {
      provider: options.provider,
      localPath: targetPath,
      originalUrl: result.url,
      sha256,
      sizeBytes: fileStat.size,
      ...(etag ? { etag } : {}),
      ...(lastModified ? { lastModified } : {}),
      ...(options.sourceVersion ? { sourceVersion: options.sourceVersion } : {}),
      fetchedAt: options.now(),
      cacheHit: false
    };
  } catch (error) {
    await rm(targetPath, { force: true });

    if (error instanceof TerritorySourceError) {
      throw error;
    }

    throw new TerritorySourceError({
      code: "SOURCE_FETCH_FAILED",
      message: error instanceof Error ? error.message : String(error),
      stage: "fetch",
      provider: options.provider,
      details: { url: options.url }
    });
  }
}

async function readBodyChunkWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  context: { provider: string; url: string }
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
        timeout = setTimeout(() => {
          reject(
            new TerritorySourceError({
              code: "SOURCE_FETCH_TIMEOUT",
              message: `Remote source body stalled for more than ${timeoutMs} ms.`,
              stage: "fetch",
              provider: context.provider,
              details: { url: context.url, timeoutMs }
            })
          );
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function assertSupportedHttpUrl(input: string): URL {
  let url: URL;

  try {
    url = new URL(input);
  } catch (error) {
    throw new TerritorySourceError({
      code: "SOURCE_PROTOCOL_UNSUPPORTED",
      message: `Source URL '${input}' is invalid.`,
      stage: "fetch",
      details: { input },
      cause: error
    });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TerritorySourceError({
      code: "SOURCE_PROTOCOL_UNSUPPORTED",
      message: `Source URL protocol '${url.protocol}' is not supported.`,
      stage: "fetch",
      details: { protocol: url.protocol }
    });
  }

  return url;
}

async function fetchWithRedirects(options: {
  provider: string;
  url: string;
  maxRedirects: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<{ response: Response; url: string }> {
  let currentUrl = options.url;

  for (let redirectCount = 0; redirectCount <= options.maxRedirects; redirectCount += 1) {
    const response = await fetchWithTimeout(currentUrl, options);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");

      if (!location) {
        throw new TerritorySourceError({
          code: "SOURCE_FETCH_FAILED",
          message: "Remote source redirect did not include a Location header.",
          stage: "fetch",
          provider: options.provider,
          details: { url: currentUrl, status: response.status }
        });
      }

      currentUrl = assertSupportedHttpUrl(new URL(location, currentUrl).href).href;
      continue;
    }

    if (!response.ok) {
      throw new TerritorySourceError({
        code: "SOURCE_FETCH_FAILED",
        message: `Remote source returned HTTP ${response.status}.`,
        stage: "fetch",
        provider: options.provider,
        details: { url: currentUrl, status: response.status }
      });
    }

    return { response, url: currentUrl };
  }

  throw new TerritorySourceError({
    code: "SOURCE_FETCH_FAILED",
    message: `Remote source exceeded ${options.maxRedirects} redirects.`,
    stage: "fetch",
    provider: options.provider,
    details: { url: currentUrl, maxRedirects: options.maxRedirects }
  });
}

async function fetchWithTimeout(
  url: string,
  options: { timeoutMs: number; signal?: AbortSignal }
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  const abort = (): void => controller.abort();

  options.signal?.addEventListener("abort", abort, { once: true });

  try {
    return await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "user-agent": `TerritoryKit source-importer (${basename(process.argv[1] ?? "node")})`
      }
    });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
