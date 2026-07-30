import { TerritoryError } from "@territory-kit/dataset";
import type { MobileTerritoryFetchAdapter } from "./types.js";

interface FetchLikeHeaders {
  get(name: string): string | null;
}

interface FetchLikeResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
  readonly headers: FetchLikeHeaders;
  arrayBuffer(): Promise<ArrayBuffer>;
}

type FetchLike = (
  url: string,
  init?: { readonly signal?: AbortSignal; readonly redirect?: "follow" }
) => Promise<FetchLikeResponse>;

export function createReactNativeFetchAdapter(fetchLike?: FetchLike): MobileTerritoryFetchAdapter {
  const transport = fetchLike ?? readGlobalFetch();

  return {
    async fetch(request) {
      const controller = new AbortController();
      const timeout = request.timeoutMs
        ? globalThis.setTimeout(() => controller.abort(), request.timeoutMs)
        : undefined;
      const linkedAbort = () => controller.abort();
      request.signal?.addEventListener("abort", linkedAbort, { once: true });

      try {
        const response = await transport(request.url, {
          signal: controller.signal,
          redirect: "follow"
        });

        if (!response.ok) {
          throw new TerritoryError(
            "ARTIFACT_NOT_FOUND",
            `Failed to fetch ${request.url}: ${response.status} ${response.statusText}`,
            { details: { url: request.url, status: response.status } }
          );
        }

        const contentLength = response.headers.get("content-length");

        if (
          request.maxBytes !== undefined &&
          contentLength &&
          Number.isFinite(Number(contentLength)) &&
          Number(contentLength) > request.maxBytes
        ) {
          throw new TerritoryError("ARTIFACT_CORRUPTED", "Response exceeded maxBytes.", {
            details: { url: request.url, maxBytes: request.maxBytes }
          });
        }

        const bytes = new Uint8Array(await response.arrayBuffer());

        if (request.maxBytes !== undefined && bytes.byteLength > request.maxBytes) {
          throw new TerritoryError("ARTIFACT_CORRUPTED", "Response exceeded maxBytes.", {
            details: { url: request.url, maxBytes: request.maxBytes }
          });
        }

        const contentType = response.headers.get("content-type");
        const etag = response.headers.get("etag");
        const lastModified = response.headers.get("last-modified");

        return {
          bytes,
          url: response.url || request.url,
          sizeBytes: bytes.byteLength,
          ...(contentType ? { contentType } : {}),
          ...(etag ? { etag } : {}),
          ...(lastModified ? { lastModified } : {})
        };
      } catch (error) {
        if (controller.signal.aborted || request.signal?.aborted) {
          throw new TerritoryError("REQUEST_ABORTED", "Mobile fetch request was cancelled.", {
            details: { url: request.url },
            cause: error
          });
        }

        throw error;
      } finally {
        if (timeout) {
          globalThis.clearTimeout(timeout);
        }

        request.signal?.removeEventListener("abort", linkedAbort);
      }
    }
  };
}

function readGlobalFetch(): FetchLike {
  const candidate = globalThis.fetch;

  if (!candidate) {
    throw new TerritoryError(
      "RUNTIME_CONFIGURATION_INVALID",
      "React Native fetch is not available; pass fetchAdapter to createMobileTerritoryRuntime."
    );
  }

  return candidate as FetchLike;
}
