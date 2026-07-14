import { createTerritoryGlobalId, slugifyTerritoryIdPart } from "@territory-kit/dataset";
import type { TerritoryAdminLevel } from "@territory-kit/dataset";
import { readStringPropertyPath } from "../sources/utils.js";
import type {
  ParsedCountryFeature,
  TerritoryCountryBuildIssue,
  TerritoryCountryDatasetConfig,
  TerritoryIdentityDiff,
  TerritoryIdentityMap,
  TerritoryIdentityMapEntry,
  TerritoryIdentityStability
} from "./types.js";

export function createTerritoryCountryIdentity(input: {
  config: TerritoryCountryDatasetConfig;
  adminLevel: TerritoryAdminLevel;
  feature: ParsedCountryFeature;
  parentKey?: string;
  sourceDatasetVersion?: string;
}): TerritoryIdentityMapEntry {
  const strategy = input.config.identityStrategy;
  const officialCode = readFirstProperty(
    input.feature.rawProperties,
    strategy.officialCodeProperties
  );
  const stableCode =
    officialCode ??
    readFirstProperty(input.feature.rawProperties, strategy.sourceStableCodeProperties) ??
    input.feature.stableCode;
  const sourceId =
    input.feature.sourceId ??
    readFirstProperty(input.feature.rawProperties, strategy.sourceIdProperties) ??
    input.feature.rawFeatureId;
  const stability = classifyIdentityStability({
    ...(officialCode ? { officialCode } : {}),
    ...(stableCode ? { stableCode } : {}),
    ...(sourceId ? { sourceId } : {}),
    adminLevel: input.adminLevel
  });
  const localKey =
    input.adminLevel === "ADM0"
      ? undefined
      : createLocalIdentityKey({
          ...(officialCode ? { officialCode } : {}),
          ...(stableCode ? { stableCode } : {}),
          ...(sourceId ? { sourceId } : {}),
          name: input.feature.name,
          ...(input.parentKey ? { parentKey: input.parentKey } : {})
        });
  const territoryId = createTerritoryGlobalId({
    countryCode: input.config.countryCodeAlpha2,
    adminLevel: input.adminLevel,
    ...(localKey ? { localId: localKey } : {})
  });

  return {
    territoryId,
    adminLevel: input.adminLevel,
    ...(sourceId ? { sourceId } : {}),
    officialCodes: {
      ...(officialCode ? { official: officialCode } : {}),
      ...(stableCode && stableCode !== officialCode ? { source: stableCode } : {})
    },
    names: {
      default: input.feature.name
    },
    stability,
    ...(input.sourceDatasetVersion ? { sourceDatasetVersion: input.sourceDatasetVersion } : {})
  };
}

export function validateTerritoryIdentityMap(
  identityMap: TerritoryIdentityMap
): TerritoryCountryBuildIssue[] {
  const issues: TerritoryCountryBuildIssue[] = [];
  const territoryIds = new Set<string>();
  const sourceIds = new Map<string, string>();
  const officialCodes = new Map<string, string>();

  for (const entry of identityMap.entries) {
    if (territoryIds.has(entry.territoryId)) {
      issues.push({
        code: "IDENTITY_DUPLICATE_TERRITORY_ID",
        severity: "error",
        message: `Duplicate territory id '${entry.territoryId}'.`,
        zoneId: entry.territoryId
      });
    }

    territoryIds.add(entry.territoryId);

    if (entry.sourceId) {
      const existing = sourceIds.get(entry.sourceId);

      if (existing && existing !== entry.territoryId) {
        issues.push({
          code: "IDENTITY_DUPLICATE_SOURCE_ID",
          severity: "error",
          message: `Source id '${entry.sourceId}' maps to multiple territories.`,
          zoneId: entry.territoryId
        });
      }

      sourceIds.set(entry.sourceId, entry.territoryId);
    }

    for (const code of Object.values(entry.officialCodes)) {
      const key = `${entry.adminLevel}:${code}`;
      const existing = officialCodes.get(key);

      if (existing && existing !== entry.territoryId) {
        issues.push({
          code: "IDENTITY_DUPLICATE_OFFICIAL_CODE",
          severity: "error",
          message: `Official code '${code}' maps to multiple ${entry.adminLevel} territories.`,
          zoneId: entry.territoryId
        });
      }

      officialCodes.set(key, entry.territoryId);
    }
  }

  return issues;
}

export function summarizeIdentityStability(
  entries: readonly TerritoryIdentityMapEntry[]
): Record<TerritoryIdentityStability, number> {
  return {
    "official-code": entries.filter((entry) => entry.stability === "official-code").length,
    "source-stable-code": entries.filter((entry) => entry.stability === "source-stable-code")
      .length,
    "source-id": entries.filter((entry) => entry.stability === "source-id").length,
    "name-parent-fallback": entries.filter((entry) => entry.stability === "name-parent-fallback")
      .length
  };
}

export function compareTerritoryIdentityMaps(
  previous: TerritoryIdentityMap,
  next: TerritoryIdentityMap
): TerritoryIdentityDiff {
  const previousById = new Map(previous.entries.map((entry) => [entry.territoryId, entry]));
  const nextById = new Map(next.entries.map((entry) => [entry.territoryId, entry]));
  const unchanged: string[] = [];
  const sourceIdChanged: string[] = [];
  const nameChanged: string[] = [];
  const parentChanged: string[] = [];

  for (const [territoryId, previousEntry] of previousById.entries()) {
    const nextEntry = nextById.get(territoryId);

    if (!nextEntry) {
      continue;
    }

    if (previousEntry.sourceId !== nextEntry.sourceId) {
      sourceIdChanged.push(territoryId);
    }

    if (previousEntry.names.default !== nextEntry.names.default) {
      nameChanged.push(territoryId);
    }

    if (previousEntry.parentId !== nextEntry.parentId) {
      parentChanged.push(territoryId);
    }

    if (
      previousEntry.sourceId === nextEntry.sourceId &&
      previousEntry.names.default === nextEntry.names.default &&
      previousEntry.parentId === nextEntry.parentId
    ) {
      unchanged.push(territoryId);
    }
  }

  return {
    unchanged: unchanged.sort(),
    added: [...nextById.keys()].filter((id) => !previousById.has(id)).sort(),
    removed: [...previousById.keys()].filter((id) => !nextById.has(id)).sort(),
    sourceIdChanged: sourceIdChanged.sort(),
    nameChanged: nameChanged.sort(),
    parentChanged: parentChanged.sort(),
    ambiguousMatches: []
  };
}

function classifyIdentityStability(input: {
  officialCode?: string;
  stableCode?: string;
  sourceId?: string;
  adminLevel: TerritoryAdminLevel;
}): TerritoryIdentityStability {
  if (input.adminLevel === "ADM0" || input.officialCode) {
    return "official-code";
  }

  if (input.stableCode) {
    return "source-stable-code";
  }

  if (input.sourceId) {
    return "source-id";
  }

  return "name-parent-fallback";
}

function createLocalIdentityKey(input: {
  officialCode?: string;
  stableCode?: string;
  sourceId?: string;
  name: string;
  parentKey?: string;
}): string {
  const stable = input.officialCode ?? input.stableCode ?? input.sourceId;

  if (stable) {
    return stable;
  }

  return `${input.parentKey ? `${slugifyTerritoryIdPart(input.parentKey)}-` : ""}${slugifyTerritoryIdPart(
    input.name
  )}`;
}

function readFirstProperty(
  properties: Record<string, unknown>,
  paths: readonly string[]
): string | undefined {
  for (const path of paths) {
    const value = readStringPropertyPath(properties, path);

    if (value) {
      return value;
    }
  }

  return undefined;
}
