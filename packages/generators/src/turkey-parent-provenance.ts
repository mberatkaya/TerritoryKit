import { createHash } from "node:crypto";
import type { TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";
import { sha256Hex, serializeJsonStable } from "./sources/utils.js";

export const TURKEY_PARENT_PROVENANCE_SCHEMA_VERSION =
  "territorykit-tr-parent-provenance@1" as const;

export const TURKEY_V2_ADM_PARENT_LEVELS = ["ADM0", "ADM1", "ADM2"] as const;
export type TurkeyV2AdmParentLevel = (typeof TURKEY_V2_ADM_PARENT_LEVELS)[number];

export type TurkeyParentLineageClassification =
  "CONFIRMED_ROOT_CAUSE" | "PARTIALLY_VERIFIED" | "BLOCKED_BY_MISSING_EVIDENCE";

export type TurkeyParentCatalogGeometryStatus =
  | "NOT_RUN"
  | "LOCKED_MEMBERS_VERIFIED"
  | "GEOMETRY_DIVERGENT_FROM_PARENT_DATASET"
  | "ARTIFACT_UNAVAILABLE"
  | "INSUFFICIENT_PARENT_FEATURES";

export type TurkeyParentDatasetLineageStatus =
  | "VERIFIED_CATALOG_PROVIDER_MATCH"
  | "CATALOG_LOCK_DIFFERS_FROM_PARENT_POLYGONS"
  | "PARENT_SOURCE_UNDECLARED"
  | "MIXED_PARENT_PROVIDERS";

export interface TurkeyNationalSourceCatalogLevels {
  ADM0?: { archiveMember: string; sha256: string; byteSize: number; actualFeatureCount: number };
  ADM1?: { archiveMember: string; sha256: string; byteSize: number; actualFeatureCount: number };
  ADM2?: { archiveMember: string; sha256: string; byteSize: number; actualFeatureCount: number };
}

export interface TurkeyNationalSourceCatalog {
  provider: string;
  sourceId?: string;
  sha256?: string;
  byteSize?: number;
  levels: TurkeyNationalSourceCatalogLevels;
}

export interface TurkeyParentProviderSummary {
  level: TurkeyV2AdmParentLevel;
  zoneCount: number;
  providers: string[];
  dominantProvider: string | null;
}

export interface TurkeyParentHdxGeometryComparison {
  level: TurkeyV2AdmParentLevel;
  catalogMemberSha256: string;
  hdxFeatureCount: number;
  parentZoneCount: number;
  nameMatchedPairs: number;
  exactGeometryHashMatches: number;
  geometryHashMismatches: number;
  unmatchedParentZones: number;
  unmatchedHdxFeatures: number;
  geometryHashMethod: "sha256-json-stringify-geometry";
  sampleMismatches: Array<{ name: string; parentHash: string; hdxHash: string }>;
}

export interface TurkeyParentProvenanceInspection {
  schemaVersion: typeof TURKEY_PARENT_PROVENANCE_SCHEMA_VERSION;
  parentDatasetVersion: string | null;
  providerSummary: TurkeyParentProviderSummary[];
  catalogProvider: string;
  observedDominantProvider: string | null;
  lineageStatus: TurkeyParentDatasetLineageStatus;
  catalogGeometryStatus: TurkeyParentCatalogGeometryStatus;
  geometryComparisons: TurkeyParentHdxGeometryComparison[];
  classification: TurkeyParentLineageClassification;
  summary: string;
}

export interface TurkeyParentProvenanceIssue {
  code:
    | "PARENT_PROVENANCE_PROVIDER_MISMATCH"
    | "PARENT_PROVENANCE_MIXED_PROVIDERS"
    | "PARENT_PROVENANCE_HDX_GEOMETRY_DIVERGENT"
    | "PARENT_PROVENANCE_UNDECLARED";
  message: string;
  severity: "error" | "warning";
  level?: TurkeyV2AdmParentLevel;
  expected?: string;
  actual?: string;
}

export interface TurkeyParentProvenanceVerification {
  ok: boolean;
  inspection: TurkeyParentProvenanceInspection;
  issues: TurkeyParentProvenanceIssue[];
}

export interface TurkeyParentHdxMemberPaths {
  ADM0?: string;
  ADM1?: string;
  ADM2?: string;
}

export interface InspectTurkeyParentProvenanceOptions {
  parentDataset: TerritoryDataset;
  catalog: TurkeyNationalSourceCatalog;
  hdxMemberPaths?: TurkeyParentHdxMemberPaths;
  readGeoJsonFeatures?: (
    path: string
  ) => Promise<Array<{ properties: Record<string, unknown>; geometry: unknown }>>;
}

const LEVEL_TO_NUMBER: Record<TurkeyV2AdmParentLevel, number> = {
  ADM0: 0,
  ADM1: 1,
  ADM2: 2
};

const NAME_PROPERTY_BY_LEVEL: Record<TurkeyV2AdmParentLevel, readonly string[]> = {
  ADM0: ["adm0_name1", "adm0_name"],
  ADM1: ["adm1_name1", "adm1_name"],
  ADM2: ["adm2_name1", "adm2_name"]
};

export function auditGeometryHash(geometry: unknown): string {
  return sha256Hex(serializeJsonStable(geometry));
}

function readTerritory(zone: TerritoryZone): Record<string, unknown> {
  const territory = zone.properties?.territory;
  return territory && typeof territory === "object" ? (territory as Record<string, unknown>) : {};
}

function readSourceProvider(zone: TerritoryZone): string | null {
  const territory = readTerritory(zone);
  const source = territory.source;
  if (source && typeof source === "object") {
    const provider = (source as Record<string, unknown>).provider;
    if (typeof provider === "string" && provider.length > 0) {
      return provider;
    }
  }
  if (typeof territory.sourceProvider === "string" && territory.sourceProvider.length > 0) {
    return territory.sourceProvider;
  }
  if (typeof territory.providerId === "string" && territory.providerId.length > 0) {
    return territory.providerId;
  }
  return null;
}

function zonesForLevel(dataset: TerritoryDataset, level: TurkeyV2AdmParentLevel): TerritoryZone[] {
  return dataset.zones.filter((zone) => zone.level === LEVEL_TO_NUMBER[level]);
}

function normalizeAdminName(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

function summarizeProviders(dataset: TerritoryDataset): TurkeyParentProviderSummary[] {
  return TURKEY_V2_ADM_PARENT_LEVELS.map((level) => {
    const zones = zonesForLevel(dataset, level);
    const providers = [
      ...new Set(
        zones.map((zone) => readSourceProvider(zone)).filter((value): value is string => !!value)
      )
    ].sort();
    const counts = new Map<string, number>();
    for (const zone of zones) {
      const provider = readSourceProvider(zone) ?? "__undeclared__";
      counts.set(provider, (counts.get(provider) ?? 0) + 1);
    }
    const dominant =
      [...counts.entries()].sort(
        (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
      )[0]?.[0] ?? null;
    return {
      level,
      zoneCount: zones.length,
      providers,
      dominantProvider: dominant === "__undeclared__" ? null : dominant
    };
  });
}

function resolveLineageStatus(input: {
  catalogProvider: string;
  summaries: TurkeyParentProviderSummary[];
}): TurkeyParentDatasetLineageStatus {
  const declared = input.summaries
    .flatMap((summary) => summary.providers)
    .filter((provider) => provider.length > 0);
  if (declared.length === 0) {
    return "PARENT_SOURCE_UNDECLARED";
  }
  const unique = [...new Set(declared)];
  if (unique.length > 1) {
    return "MIXED_PARENT_PROVIDERS";
  }
  if (unique[0] !== input.catalogProvider) {
    return "CATALOG_LOCK_DIFFERS_FROM_PARENT_POLYGONS";
  }
  return "VERIFIED_CATALOG_PROVIDER_MATCH";
}

function readHdxFeatureName(
  level: TurkeyV2AdmParentLevel,
  properties: Record<string, unknown>
): string | null {
  for (const key of NAME_PROPERTY_BY_LEVEL[level]) {
    const value = properties[key];
    if (typeof value === "string" && value.length > 0) {
      return normalizeAdminName(value);
    }
  }
  return null;
}

export async function inspectTurkeyParentProvenance(
  options: InspectTurkeyParentProvenanceOptions
): Promise<TurkeyParentProvenanceInspection> {
  const providerSummary = summarizeProviders(options.parentDataset);
  const lineageStatus = resolveLineageStatus({
    catalogProvider: options.catalog.provider,
    summaries: providerSummary
  });
  const dominantProviders = providerSummary
    .map((summary) => summary.dominantProvider)
    .filter((value): value is string => !!value);
  const observedDominantProvider =
    dominantProviders.length > 0 && new Set(dominantProviders).size === 1
      ? dominantProviders[0]!
      : dominantProviders.length > 0
        ? "mixed"
        : null;

  const geometryComparisons: TurkeyParentHdxGeometryComparison[] = [];
  let catalogGeometryStatus: TurkeyParentCatalogGeometryStatus = "NOT_RUN";

  if (options.hdxMemberPaths && options.readGeoJsonFeatures) {
    let anyCompared = false;
    let anyDivergent = false;
    let anyUnavailable = false;

    for (const level of TURKEY_V2_ADM_PARENT_LEVELS) {
      const catalogLevel = options.catalog.levels[level];
      const memberPath = options.hdxMemberPaths[level];
      if (!catalogLevel || !memberPath) {
        anyUnavailable = true;
        continue;
      }
      let hdxFeatures: Array<{ properties: Record<string, unknown>; geometry: unknown }>;
      try {
        hdxFeatures = await options.readGeoJsonFeatures(memberPath);
      } catch {
        anyUnavailable = true;
        continue;
      }
      const parentZones = zonesForLevel(options.parentDataset, level);
      const hdxByName = new Map<
        string,
        { properties: Record<string, unknown>; geometry: unknown }
      >();
      for (const feature of hdxFeatures) {
        const name = readHdxFeatureName(level, feature.properties);
        if (name) {
          hdxByName.set(name, feature);
        }
      }
      let nameMatchedPairs = 0;
      let exactGeometryHashMatches = 0;
      let geometryHashMismatches = 0;
      let unmatchedParentZones = 0;
      const sampleMismatches: TurkeyParentHdxGeometryComparison["sampleMismatches"] = [];
      const matchedHdx = new Set<string>();

      for (const zone of parentZones) {
        const name = normalizeAdminName(zone.name ?? "");
        if (!name) {
          unmatchedParentZones += 1;
          continue;
        }
        const feature = hdxByName.get(name);
        if (!feature) {
          unmatchedParentZones += 1;
          continue;
        }
        matchedHdx.add(name);
        nameMatchedPairs += 1;
        const parentHash = auditGeometryHash(zone.geometry);
        const hdxHash = auditGeometryHash(feature.geometry);
        if (parentHash === hdxHash) {
          exactGeometryHashMatches += 1;
        } else {
          geometryHashMismatches += 1;
          if (sampleMismatches.length < 5) {
            sampleMismatches.push({ name, parentHash, hdxHash });
          }
        }
      }

      const unmatchedHdxFeatures = hdxFeatures.length - matchedHdx.size;
      geometryComparisons.push({
        level,
        catalogMemberSha256: catalogLevel.sha256,
        hdxFeatureCount: hdxFeatures.length,
        parentZoneCount: parentZones.length,
        nameMatchedPairs,
        exactGeometryHashMatches,
        geometryHashMismatches,
        unmatchedParentZones,
        unmatchedHdxFeatures,
        geometryHashMethod: "sha256-json-stringify-geometry",
        sampleMismatches
      });
      anyCompared = true;
      if (geometryHashMismatches > 0 || unmatchedParentZones > 0 || unmatchedHdxFeatures > 0) {
        anyDivergent = true;
      }
    }

    catalogGeometryStatus =
      anyUnavailable && !anyCompared
        ? "ARTIFACT_UNAVAILABLE"
        : anyDivergent
          ? "GEOMETRY_DIVERGENT_FROM_PARENT_DATASET"
          : "LOCKED_MEMBERS_VERIFIED";
  }

  let classification: TurkeyParentLineageClassification = "BLOCKED_BY_MISSING_EVIDENCE";
  let summary = "Parent provenance could not be fully classified.";

  if (lineageStatus === "CATALOG_LOCK_DIFFERS_FROM_PARENT_POLYGONS") {
    classification = "CONFIRMED_ROOT_CAUSE";
    summary =
      "National catalog/source-lock provider does not match the provider recorded on parent polygon zones.";
  } else if (lineageStatus === "VERIFIED_CATALOG_PROVIDER_MATCH") {
    classification =
      catalogGeometryStatus === "GEOMETRY_DIVERGENT_FROM_PARENT_DATASET"
        ? "CONFIRMED_ROOT_CAUSE"
        : catalogGeometryStatus === "LOCKED_MEMBERS_VERIFIED"
          ? "PARTIALLY_VERIFIED"
          : "PARTIALLY_VERIFIED";
    summary =
      catalogGeometryStatus === "LOCKED_MEMBERS_VERIFIED"
        ? "Parent polygon provider matches the catalog lock and sampled HDX member geometry hashes align."
        : "Parent polygon provider matches the catalog lock; HDX geometry comparison was not fully verified.";
  } else if (lineageStatus === "MIXED_PARENT_PROVIDERS") {
    classification = "CONFIRMED_ROOT_CAUSE";
    summary = "Parent ADM0–ADM2 zones declare multiple source providers.";
  } else if (catalogGeometryStatus === "GEOMETRY_DIVERGENT_FROM_PARENT_DATASET") {
    classification = "CONFIRMED_ROOT_CAUSE";
    summary = "Locked HDX member geometry does not match the parent dataset polygons.";
  }

  return {
    schemaVersion: TURKEY_PARENT_PROVENANCE_SCHEMA_VERSION,
    parentDatasetVersion:
      typeof options.parentDataset.manifest?.datasetVersion === "string"
        ? options.parentDataset.manifest.datasetVersion
        : null,
    providerSummary,
    catalogProvider: options.catalog.provider,
    observedDominantProvider,
    lineageStatus,
    catalogGeometryStatus,
    geometryComparisons,
    classification,
    summary
  };
}

export function verifyTurkeyParentProvenance(
  inspection: TurkeyParentProvenanceInspection,
  options: { allowUndeclaredParentSource?: boolean } = {}
): TurkeyParentProvenanceVerification {
  const issues: TurkeyParentProvenanceIssue[] = [];

  if (inspection.lineageStatus === "CATALOG_LOCK_DIFFERS_FROM_PARENT_POLYGONS") {
    issues.push({
      code: "PARENT_PROVENANCE_PROVIDER_MISMATCH",
      severity: "error",
      message:
        "ADM0–ADM2 parent dataset source provider does not match the national catalog/source-lock provider.",
      expected: inspection.catalogProvider,
      actual: inspection.observedDominantProvider ?? "unknown"
    });
  }

  if (inspection.lineageStatus === "MIXED_PARENT_PROVIDERS") {
    issues.push({
      code: "PARENT_PROVENANCE_MIXED_PROVIDERS",
      severity: "error",
      message: "ADM0–ADM2 parent dataset declares multiple source providers across zones."
    });
  }

  if (
    inspection.lineageStatus === "PARENT_SOURCE_UNDECLARED" &&
    !options.allowUndeclaredParentSource
  ) {
    issues.push({
      code: "PARENT_PROVENANCE_UNDECLARED",
      severity: "warning",
      message:
        "ADM0–ADM2 parent dataset zones do not declare a source provider; catalog lock cannot be treated as polygon-backed evidence."
    });
  }

  if (inspection.catalogGeometryStatus === "GEOMETRY_DIVERGENT_FROM_PARENT_DATASET") {
    issues.push({
      code: "PARENT_PROVENANCE_HDX_GEOMETRY_DIVERGENT",
      severity: "error",
      message:
        "Locked HDX COD-AB member geometry does not match the configured parent dataset polygons."
    });
  }

  const ok = issues.every((issue) => issue.severity !== "error");
  return { ok, inspection, issues };
}

export function createTurkeyParentInputDatasetLock(inspection: TurkeyParentProvenanceInspection): {
  catalogProvider: string;
  observedDominantProvider: string | null;
  lineageStatus: TurkeyParentDatasetLineageStatus;
  catalogGeometryStatus: TurkeyParentCatalogGeometryStatus;
  zoneCounts: Record<TurkeyV2AdmParentLevel, number>;
  classification: TurkeyParentLineageClassification;
} {
  const zoneCounts = {
    ADM0: inspection.providerSummary.find((summary) => summary.level === "ADM0")?.zoneCount ?? 0,
    ADM1: inspection.providerSummary.find((summary) => summary.level === "ADM1")?.zoneCount ?? 0,
    ADM2: inspection.providerSummary.find((summary) => summary.level === "ADM2")?.zoneCount ?? 0
  } satisfies Record<TurkeyV2AdmParentLevel, number>;

  return {
    catalogProvider: inspection.catalogProvider,
    observedDominantProvider: inspection.observedDominantProvider,
    lineageStatus: inspection.lineageStatus,
    catalogGeometryStatus: inspection.catalogGeometryStatus,
    zoneCounts,
    classification: inspection.classification
  };
}

export function computeTurkeyNationalCatalogContentHash(
  catalog: TurkeyNationalSourceCatalog
): string {
  return createHash("sha256").update(serializeJsonStable(catalog)).digest("hex");
}
