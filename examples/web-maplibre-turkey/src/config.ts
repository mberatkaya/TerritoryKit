import { isDemoAdminLevel } from "./levels.js";
import type { DemoAdminLevel, DemoConfig, DemoMode, RequestedDemoMode } from "./types.js";

export const DEFAULT_DATASET_ID = "territory-kit-tr";
export const DEFAULT_DATASET_VERSION = "latest-compatible";
export const LOCAL_PLAYABLE_DATASET_ID = "territory-kit-tr-v2-playable";
export const LOCAL_PLAYABLE_DATASET_VERSION = "2.1.0-playable-v3";
export const LOCAL_PLAYABLE_CANDIDATE_MOUNT = "/territory-candidate";

interface DemoEnv {
  VITE_TERRITORY_DEMO_MODE?: string;
  VITE_TERRITORY_REGISTRY_URL?: string;
  VITE_TERRITORY_DELIVERY_MANIFEST_URL?: string;
  VITE_TERRITORY_DELIVERY_MANIFEST_HASH?: string;
  VITE_TERRITORY_DATASET_ID?: string;
  VITE_TERRITORY_DATASET_VERSION?: string;
  VITE_TERRITORY_ALLOW_PRERELEASE?: string;
  VITE_MAP_STYLE_URL?: string;
  VITE_TERRITORY_BASE_PATH?: string;
  VITE_TERRITORY_TELEMETRY_ENABLED?: string;
  VITE_TERRITORY_LOCAL_CANDIDATE_URL?: string;
  BASE_URL?: string;
}

export interface UrlState {
  territoryId?: string;
  level?: DemoAdminLevel;
  mode?: DemoMode;
  registryUrl?: string;
}

export function readDemoConfig(
  env: DemoEnv = import.meta.env,
  params: URLSearchParams = new URLSearchParams(globalThis.location?.search ?? "")
): DemoConfig {
  const requestedMode = readRequestedMode(params.get("mode") ?? env.VITE_TERRITORY_DEMO_MODE);
  const registryUrl = trimToUndefined(params.get("registryUrl") ?? env.VITE_TERRITORY_REGISTRY_URL);
  const deliveryManifestUrl = trimToUndefined(env.VITE_TERRITORY_DELIVERY_MANIFEST_URL);
  const deliveryManifestHash = trimToUndefined(env.VITE_TERRITORY_DELIVERY_MANIFEST_HASH);
  const styleUrl = trimToUndefined(env.VITE_MAP_STYLE_URL);
  const registryUrlError = registryUrl ? validateRegistryUrl(registryUrl) : undefined;
  const deliveryError = deliveryManifestUrl ? validateRegistryUrl(deliveryManifestUrl) : undefined;
  const datasetVersion = trimToUndefined(env.VITE_TERRITORY_DATASET_VERSION);
  const localCandidateBase = trimToUndefined(env.VITE_TERRITORY_LOCAL_CANDIDATE_URL);
  const localPlayable = requestedMode === "local-playable" || Boolean(localCandidateBase);
  const localRegistryUrl = localPlayable
    ? joinLocalCandidateUrl(localCandidateBase, "registry.json")
    : undefined;
  const localDeliveryUrl = localPlayable
    ? joinLocalCandidateUrl(localCandidateBase, "delivery-manifest.json")
    : undefined;
  const localSmartCoverageUrl = localPlayable
    ? joinLocalCandidateUrl(localCandidateBase, "smart-coverage.json")
    : undefined;
  const effectiveRegistryUrl = registryUrl ?? localRegistryUrl;
  const effectiveDeliveryUrl = deliveryManifestUrl ?? localDeliveryUrl;
  const effectiveRegistryError = effectiveRegistryUrl
    ? validateRegistryUrl(effectiveRegistryUrl)
    : undefined;
  const effectiveDeliveryError = effectiveDeliveryUrl
    ? validateRegistryUrl(effectiveDeliveryUrl)
    : undefined;
  const mode: DemoMode =
    requestedMode === "fixture"
      ? "fixture"
      : localPlayable && effectiveRegistryUrl && !effectiveRegistryError
        ? "local-playable"
        : effectiveRegistryUrl && !effectiveRegistryError
          ? "registry"
          : "fixture";
  const configError =
    registryUrlError ??
    deliveryError ??
    effectiveRegistryError ??
    effectiveDeliveryError ??
    (requestedMode === "registry" && !registryUrl
      ? "VITE_TERRITORY_DEMO_MODE=registry requires VITE_TERRITORY_REGISTRY_URL."
      : undefined) ??
    (requestedMode === "local-playable" && !effectiveRegistryUrl
      ? "local-playable requires bootstrap registry.json under .territory (pnpm data:tr:sprint4:playable-map:bootstrap)."
      : undefined);

  const resolvedDatasetId =
    trimToUndefined(env.VITE_TERRITORY_DATASET_ID) ??
    (localPlayable ? LOCAL_PLAYABLE_DATASET_ID : DEFAULT_DATASET_ID);
  const resolvedDatasetVersion =
    datasetVersion ?? (localPlayable ? LOCAL_PLAYABLE_DATASET_VERSION : DEFAULT_DATASET_VERSION);

  return {
    mode,
    requestedMode,
    datasetId: resolvedDatasetId,
    datasetVersion: resolvedDatasetVersion,
    datasetVersionPinned: Boolean(datasetVersion) || localPlayable,
    allowPrerelease: parseBoolean(env.VITE_TERRITORY_ALLOW_PRERELEASE) ?? localPlayable,
    basePath: trimToUndefined(env.VITE_TERRITORY_BASE_PATH) ?? env.BASE_URL ?? "/",
    telemetryEnabled: parseBoolean(env.VITE_TERRITORY_TELEMETRY_ENABLED) ?? false,
    ...(effectiveRegistryUrl ? { registryUrl: effectiveRegistryUrl } : {}),
    ...(effectiveDeliveryUrl ? { deliveryManifestUrl: effectiveDeliveryUrl } : {}),
    ...(deliveryManifestHash ? { deliveryManifestHash } : {}),
    ...(styleUrl ? { styleUrl } : {}),
    ...(localPlayable
      ? { localCandidateUrl: localCandidateBase ?? LOCAL_PLAYABLE_CANDIDATE_MOUNT }
      : {}),
    ...(localSmartCoverageUrl ? { smartCoverageUrl: localSmartCoverageUrl } : {}),
    ...(configError ? { configError } : {})
  };
}

export function readUrlState(
  params: URLSearchParams = new URLSearchParams(globalThis.location?.search ?? "")
): UrlState {
  const territoryId = trimToUndefined(params.get("territory"));
  const level = params.get("level") ?? undefined;
  const mode = params.get("mode") ?? undefined;
  const registryUrl = trimToUndefined(params.get("registryUrl"));

  return {
    ...(territoryId ? { territoryId } : {}),
    ...(isDemoAdminLevel(level) ? { level } : {}),
    ...(mode === "fixture" || mode === "registry" || mode === "local-playable" ? { mode } : {}),
    ...(registryUrl ? { registryUrl } : {})
  };
}

export function writeUrlState(input: {
  territoryId?: string;
  level?: DemoAdminLevel;
  mode: DemoMode;
  registryUrl?: string;
}): void {
  const url = new URL(globalThis.location.href);

  if (input.territoryId) {
    url.searchParams.set("territory", input.territoryId);
  } else {
    url.searchParams.delete("territory");
  }

  if (input.level) {
    url.searchParams.set("level", input.level);
  } else {
    url.searchParams.delete("level");
  }

  url.searchParams.set("mode", input.mode);

  if (input.registryUrl && url.searchParams.has("registryUrl")) {
    url.searchParams.set("registryUrl", input.registryUrl);
  }

  globalThis.history.replaceState({}, "", url);
}

export function validateRegistryUrl(value: string): string | undefined {
  try {
    const url = new URL(value);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return "Registry URL must use https:// or http://.";
    }

    return undefined;
  } catch {
    return "Registry URL is not a valid absolute URL.";
  }
}

function readRequestedMode(value: string | undefined | null): RequestedDemoMode {
  if (value === "fixture" || value === "registry" || value === "local-playable") {
    return value;
  }

  return "auto";
}

function joinLocalCandidateUrl(base: string | undefined, relativePath: string): string {
  const mount = trimToUndefined(base) ?? LOCAL_PLAYABLE_CANDIDATE_MOUNT;
  const normalized = mount.endsWith("/") ? mount.slice(0, -1) : mount;
  return `${normalized}/${relativePath}`;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(value.toLowerCase())) {
    return false;
  }

  return undefined;
}

function trimToUndefined(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
