export function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

export function serializeJsonStable(input: unknown): string {
  return `${JSON.stringify(sortJson(input), null, 2)}\n`;
}

export function sortJson(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((item) => sortJson(item));
  }

  if (isRecord(input)) {
    return Object.fromEntries(
      Object.entries(input)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, sortJson(value)])
    );
  }

  return input;
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const subtle = globalThis.crypto?.subtle;

  if (!subtle) {
    throw new Error("SHA-256 requires Web Crypto in browser-safe registry code.");
  }

  const buffer =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.slice().buffer;
  const digest = await subtle.digest("SHA-256", buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function joinUrl(baseUrl: string | undefined, url: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    return url;
  }

  if (!baseUrl) {
    throw new Error(`Relative artifact URL '${url}' requires registry baseUrl.`);
  }

  return new URL(url, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

export function assertSafeRelativePath(path: string): void {
  const decoded = decodeURIComponent(path);

  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    decoded.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new Error(`Unsafe registry artifact path '${path}'.`);
  }
}

export function normalizeCompression(input: string | undefined): "none" | "gzip" | "br" {
  if (!input || input === "none") {
    return "none";
  }

  if (input === "gzip" || input === "br") {
    return input;
  }

  throw new Error(`Unsupported artifact compression '${input}'.`);
}

export function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

export function includesEvery<T>(
  values: readonly T[] | undefined,
  required: readonly T[]
): boolean {
  if (required.length === 0) {
    return true;
  }

  if (!values) {
    return false;
  }

  const set = new Set(values);
  return required.every((value) => set.has(value));
}

/** Read a response with a hard byte ceiling even when Content-Length is absent or false. */
export async function readBoundedResponse(
  response: Response,
  maxBytes: number
): Promise<Uint8Array> {
  const length = response.headers.get("content-length");
  if (length && Number.isFinite(Number(length)) && Number(length) > maxBytes) {
    await response.body?.cancel();
    throw new Error("Response exceeded maxBytes.");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("Response exceeded maxBytes.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
