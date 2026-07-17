import { TERRITORY_ADMIN_LEVELS, normalizeTerritoryAdminLevel } from "@territory-kit/dataset";
import type { TerritoryAdminLevel } from "@territory-kit/dataset";
import type {
  TerritoryProviderCapabilitiesResult,
  TerritoryProviderLevelCapability,
  TerritorySourceRegistryLike
} from "./types.js";
import type { TerritoryOfficialOpenDataSourceManifest } from "./open-data-manifest.js";
import { validateOfficialOpenDataSourceManifest } from "./open-data-manifest.js";

export interface InspectTerritorySourceCapabilitiesOptions {
  registry: TerritorySourceRegistryLike;
  provider: string;
  country?: string;
  level?: TerritoryAdminLevel | string;
  manifest?: unknown;
  strictManifest?: boolean;
}

export function inspectTerritorySourceCapabilities(
  options: InspectTerritorySourceCapabilitiesOptions
): TerritoryProviderCapabilitiesResult {
  const adapter = options.registry.get(options.provider);
  const description = adapter.describe();
  const supportedLevels = new Set(description.supportedAdminLevels);
  const requestedLevel = options.level
    ? normalizeTerritoryAdminLevel(String(options.level))
    : undefined;
  const levelsToInspect = requestedLevel ? [requestedLevel] : TERRITORY_ADMIN_LEVELS;
  const manifest = options.manifest
    ? validateOfficialOpenDataSourceManifest(options.manifest, {
        strict: options.strictManifest ?? false
      })
    : undefined;
  const manifestValue = manifest?.manifest;
  const levels = Object.fromEntries(
    levelsToInspect.map((level) => [
      level,
      createLevelCapability({
        level,
        provider: description.id,
        supported: supportedLevels.has(level),
        ...(manifestValue ? { manifest: manifestValue } : {})
      })
    ])
  ) as Partial<Record<TerritoryAdminLevel, TerritoryProviderLevelCapability>>;

  return {
    provider: description.id,
    ...(options.country ? { country: options.country.toUpperCase() } : {}),
    ...(requestedLevel ? { requestedLevel } : {}),
    levels,
    issues: manifest?.issues ?? []
  };
}

function createLevelCapability(input: {
  level: TerritoryAdminLevel;
  provider: string;
  supported: boolean;
  manifest?: TerritoryOfficialOpenDataSourceManifest & {
    countryCode: string;
    adminLevel: TerritoryAdminLevel;
  };
}): TerritoryProviderLevelCapability {
  if (!input.supported) {
    return {
      level: input.level,
      supported: false,
      available: false,
      status: "provider-unsupported",
      reason: `${input.provider} does not support ${input.level}.`,
      provider: input.provider
    };
  }

  if (input.manifest?.adminLevel === input.level) {
    const restricted = input.manifest.redistributionStatus === "restricted";

    return {
      level: input.level,
      supported: true,
      available: !restricted,
      status: restricted ? "licence-restricted" : "available",
      reason: restricted
        ? "Manifest redistributionStatus is restricted."
        : "Manifest is available.",
      provider: input.manifest.provider,
      ...(input.manifest.sourceVersion ? { sourceVersion: input.manifest.sourceVersion } : {}),
      license: input.manifest.license,
      attribution: input.manifest.attribution
    };
  }

  return {
    level: input.level,
    supported: true,
    available: false,
    status: "source-unavailable",
    reason: "No source manifest is available for this country and level.",
    provider: input.provider
  };
}
