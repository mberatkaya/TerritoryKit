import path from "node:path";

/**
 * Resolve a URL path segment under candidateRoot; return null when traversal escapes the root.
 */
export function resolveSafeCandidateFile(
  candidateRoot: string,
  requestPath: string
): string | null {
  const root = path.resolve(candidateRoot);
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }

  if (decoded.includes("\0")) {
    return null;
  }

  const normalized = path.normalize(decoded).replace(/^[/\\]+/, "");
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    return null;
  }

  const absolute = path.resolve(root, normalized);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return absolute;
}
