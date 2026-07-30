import { isDemoAdminLevel } from "./levels.js";
import type { DemoAdminLevel, DemoConfig, DemoMode, RequestedDemoMode } from "./types.js";

export const DEFAULT_DATASET_ID = "territory-kit-tr";
export const DEFAULT_DATASET_VERSION = "latest-compatible";

interface DemoEnv {
  VITE_TERRITORY_DEMO_MODE?: string;
  VITE_TERRITORY_REGISTRY_URL?: string;
  VITE_TERRITORY_DATASET_ID?: string;
  VITE_TERRITORY_DATASET_VERSION?: string;
  VITE_TERRITORY_ALLOW_PRERELEASE?: string;
  VITE_MAP_STYLE_URL?: string;
  VITE_TERRITORY_BASE_PATH?: string;
  VITE_TERRITORY_TELEMETRY_ENABLED?: string;
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
  const styleUrl = trimToUndefined(env.VITE_MAP_STYLE_URL);
  const registryUrlError = registryUrl ? validateRegistryUrl(registryUrl) : undefined;
  const datasetVersion = trimToUndefined(env.VITE_TERRITORY_DATASET_VERSION);
  const mode: DemoMode =
    requestedMode === "fixture"
      ? "fixture"
      : registryUrl && !registryUrlError
        ? "registry"
        : "fixture";
  const configError =
    registryUrlError ??
    (requestedMode === "registry" && !registryUrl
      ? "VITE_TERRITORY_DEMO_MODE=registry requires VITE_TERRITORY_REGISTRY_URL."
      : undefined);

  return {
    mode,
    requestedMode,
    datasetId: trimToUndefined(env.VITE_TERRITORY_DATASET_ID) ?? DEFAULT_DATASET_ID,
    datasetVersion: datasetVersion ?? DEFAULT_DATASET_VERSION,
    datasetVersionPinned: Boolean(datasetVersion),
    allowPrerelease: parseBoolean(env.VITE_TERRITORY_ALLOW_PRERELEASE) ?? false,
    basePath: trimToUndefined(env.VITE_TERRITORY_BASE_PATH) ?? env.BASE_URL ?? "/",
    telemetryEnabled: parseBoolean(env.VITE_TERRITORY_TELEMETRY_ENABLED) ?? false,
    ...(registryUrl ? { registryUrl } : {}),
    ...(styleUrl ? { styleUrl } : {}),
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
    ...(mode === "fixture" || mode === "registry" ? { mode } : {}),
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
  if (value === "fixture" || value === "registry") {
    return value;
  }

  return "auto";
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
