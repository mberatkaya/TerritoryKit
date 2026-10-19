export const LOCAL_PLAYABLE_CANDIDATE_MOUNT = "/territory-candidate";
export const DEFAULT_LOCAL_PLAYABLE_DEV_ORIGIN = "http://127.0.0.1:5173";

export function readLocalPlayableDevOrigin(env: {
  VITE_TERRITORY_LOCAL_DEV_ORIGIN?: string;
}): string {
  const fromEnv = env.VITE_TERRITORY_LOCAL_DEV_ORIGIN?.trim();
  if (fromEnv) {
    return fromEnv.endsWith("/") ? fromEnv.slice(0, -1) : fromEnv;
  }

  if (
    typeof globalThis.location?.origin === "string" &&
    globalThis.location.origin.length > 0 &&
    globalThis.location.origin !== "null"
  ) {
    return globalThis.location.origin;
  }

  return DEFAULT_LOCAL_PLAYABLE_DEV_ORIGIN;
}

/** Turn a same-origin candidate mount path into an absolute http(s) URL for registry clients. */
export function resolveLocalPlayableArtifactUrl(
  candidateMount: string,
  relativeFile: string,
  devOrigin: string
): string {
  const mount = candidateMount.endsWith("/") ? candidateMount.slice(0, -1) : candidateMount;
  const file = relativeFile.replace(/^\/+/, "");
  const combined = `${mount}/${file}`;
  if (/^https?:\/\//i.test(combined)) {
    return combined;
  }
  const origin = devOrigin.endsWith("/") ? devOrigin.slice(0, -1) : devOrigin;
  return combined.startsWith("/") ? `${origin}${combined}` : `${origin}/${combined}`;
}

export function defaultLocalCandidateMount(): string {
  return LOCAL_PLAYABLE_CANDIDATE_MOUNT;
}
