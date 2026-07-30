import { TerritoryError } from "@territory-kit/dataset";
import type { MobileTerritoryPlatform, MobileTerritoryStorageAdapter } from "./types.js";

export function joinMobilePath(
  root: string,
  segments: readonly string[],
  platform: MobileTerritoryPlatform = "unknown"
): string {
  const normalizedRoot = normalizeMobilePath(root, platform).replace(/\/+$/, "");
  const normalizedSegments = segments.map((segment) => normalizePathSegment(segment));

  return normalizeMobilePath([normalizedRoot, ...normalizedSegments].join("/"), platform);
}

export function storagePath(
  adapter: MobileTerritoryStorageAdapter,
  segments: readonly string[]
): string {
  return joinMobilePath(adapter.rootDirectory, segments, adapter.platform ?? "unknown");
}

export function joinRelativePath(segments: readonly string[]): string {
  return segments.map((segment) => normalizePathSegment(segment)).join("/");
}

export function normalizeMobilePath(
  input: string,
  _platform: MobileTerritoryPlatform = "unknown"
): string {
  const trimmed = input.trim().replaceAll("\\", "/");

  if (trimmed.length === 0) {
    throw new TerritoryError("RUNTIME_CONFIGURATION_INVALID", "Mobile storage path is empty.");
  }

  const scheme = /^([a-z][a-z0-9+.-]*:\/\/)(.*)$/i.exec(trimmed);
  const prefix = scheme?.[1] ?? "";
  const rest = scheme?.[2] ?? trimmed;
  const absolutePrefix = rest.startsWith("/") ? "/" : "";
  const parts = rest
    .split("/")
    .filter((part) => part.length > 0 && part !== ".")
    .map((part) => {
      if (part === "..") {
        throw new TerritoryError(
          "RUNTIME_CONFIGURATION_INVALID",
          "Mobile storage paths cannot contain '..' segments."
        );
      }

      return part;
    });

  const body = `${absolutePrefix}${parts.join("/")}`.replace(/\/+$/, "");

  if (prefix === "file://" && body.startsWith("/")) {
    return `${prefix}${body}`;
  }

  return `${prefix}${body}`;
}

export function normalizePathSegment(segment: string): string {
  const normalized = segment
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "");

  if (normalized.length === 0) {
    throw new TerritoryError("RUNTIME_CONFIGURATION_INVALID", "Storage path segment is empty.");
  }

  if (normalized.split("/").some((part) => part === ".." || part === "." || part.length === 0)) {
    throw new TerritoryError(
      "RUNTIME_CONFIGURATION_INVALID",
      `Storage path segment '${segment}' is not safe.`
    );
  }

  return normalized;
}

export function sanitizeStorageSegment(input: string): string {
  const segment = input.trim();

  if (segment.length === 0) {
    throw new TerritoryError("RUNTIME_CONFIGURATION_INVALID", "Storage segment is empty.");
  }

  return encodeURIComponent(segment).replaceAll("%", "_");
}
