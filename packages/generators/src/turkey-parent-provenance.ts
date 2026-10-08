import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { TerritoryDataset, TerritoryZone } from "@territory-kit/dataset";
import { sha256Hex, serializeJsonStable } from "./sources/utils.js";

export const TURKEY_PARENT_PROVENANCE_SCHEMA_VERSION =
  "territorykit-tr-parent-provenance@2" as const;

export const TURKEY_V2_ADM_PARENT_LEVELS = ["ADM0", "ADM1", "ADM2"] as const;
export type TurkeyV2AdmParentLevel = (typeof TURKEY_V2_ADM_PARENT_LEVELS)[number];

export const TURKEY_PARENT_INVENTORY_EXPECTED = {
  ADM0: 1,
  ADM1: 81,
  ADM2: 973
} as const;

export type TurkeyParentLineageClassification =
  "CONFIRMED_ROOT_CAUSE" | "PARTIALLY_VERIFIED" | "BLOCKED_BY_MISSING_EVIDENCE";

export type TurkeyParentProviderMetadataStatus =
  | "CATALOG_LOCK_DIFFERS_FROM_PARENT_POLYGONS"
  | "PROVIDER_METADATA_MATCHES_CATALOG"
  | "PARENT_SOURCE_UNDECLARED"
  | "PARENT_SOURCE_PARTIALLY_UNDECLARED"
  | "MIXED_PARENT_PROVIDERS";

/** @deprecated Use providerMetadataStatus */
export type TurkeyParentDatasetLineageStatus = TurkeyParentProviderMetadataStatus;

export type TurkeyParentSourceByteVerificationStatus =
  | "NOT_RUN"
  | "ARTIFACT_UNAVAILABLE"
  | "PARTIAL_MEMBERS_VERIFIED"
  | "ALL_LOCKED_MEMBERS_VERIFIED"
  | "CHECKSUM_MISMATCH";

export type TurkeyParentSerializedGeometryStatus =
  | "NOT_RUN"
  | "INSUFFICIENT_EVIDENCE"
  | "INVENTORY_INCOMPLETE"
  | "COMPARED"
  | "ALL_SERIALIZED_HASHES_MATCH";

export type TurkeyParentInventoryStatus = "COMPLETE" | "INCOMPLETE" | "MISSING_LEVEL";

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
  undeclaredZoneCount: number;
}

export interface TurkeyParentHdxGeometryComparison {
  level: TurkeyV2AdmParentLevel;
  catalogMemberSha256: string;
  hdxFeatureCount: number;
  parentZoneCount: number;
  identityMatchMethod: "native-admin-id" | "province-scoped-name" | "name-only" | "not-applicable";
  identityMatchedPairs: number;
  exactSerializedGeometryHashMatches: number;
  serializedGeometryHashMismatches: number;
  unmatchedParentZones: number;
  unmatchedHdxFeatures: number;
  serializedGeometryHashMethod: "sha256-json-stringify-geometry";
  geographicEquivalenceStatus: "NOT_ASSESSED";
  sampleSerializedMismatches: Array<{
    matchKey: string;
    parentHash: string;
    hdxHash: string;
  }>;
}

export interface TurkeyParentProvenanceInspection {
  schemaVersion: typeof TURKEY_PARENT_PROVENANCE_SCHEMA_VERSION;
  parentDatasetVersion: string | null;
  parentInventoryStatus: TurkeyParentInventoryStatus;
  providerSummary: TurkeyParentProviderSummary[];
  catalogProvider: string;
  observedDominantProvider: string | null;
  providerMetadataStatus: TurkeyParentProviderMetadataStatus;
  /** @deprecated */ lineageStatus: TurkeyParentProviderMetadataStatus;
  sourceByteVerificationStatus: TurkeyParentSourceByteVerificationStatus;
  serializedGeometryStatus: TurkeyParentSerializedGeometryStatus;
  /** @deprecated */ catalogGeometryStatus: TurkeyParentSerializedGeometryStatus;
  geometryComparisons: TurkeyParentHdxGeometryComparison[];
  geoBoundariesUpstreamBytesVerified: false;
  classification: TurkeyParentLineageClassification;
  summary: string;
}

export type TurkeyParentProvenanceIssueCode =
  | "PARENT_PROVENANCE_PROVIDER_MISMATCH"
  | "PARENT_PROVENANCE_MIXED_PROVIDERS"
  | "PARENT_PROVENANCE_UNDECLARED"
  | "PARENT_PROVENANCE_PARTIALLY_UNDECLARED"
  | "PARENT_PROVENANCE_SOURCE_BYTES_UNVERIFIED"
  | "PARENT_PROVENANCE_MEMBER_CHECKSUM_MISMATCH"
  | "PARENT_PROVENANCE_INVENTORY_INCOMPLETE"
  | "PARENT_PROVENANCE_SERIALIZED_GEOMETRY_DIFFERS"
  | "PARENT_PROVENANCE_PUBLISH_BYPASS_FORBIDDEN"
  | "PARENT_PROVENANCE_PUBLISH_LINEAGE_INSUFFICIENT";

export interface TurkeyParentProvenanceIssue {
  code: TurkeyParentProvenanceIssueCode;
  message: string;
  severity: "error" | "warning";
  level?: TurkeyV2AdmParentLevel;
  expected?: string;
  actual?: string;
}

export interface TurkeyParentProvenanceVerification {
  ok: boolean;
  authorizedForNationalBuild: boolean;
  authorizedForPublishReady: boolean;
  inspection: TurkeyParentProvenanceInspection;
  issues: TurkeyParentProvenanceIssue[];
}

export interface TurkeyParentHdxMemberPaths {
  ADM0?: string;
  ADM1?: string;
  ADM2?: string;
}

export type TurkeyParentHdxMemberByteStatus =
  "LOCKED_BYTES_VERIFIED" | "ARTIFACT_NOT_AVAILABLE" | "CHECKSUM_MISMATCH";

export interface TurkeyParentVerifiedHdxMember {
  status: TurkeyParentHdxMemberByteStatus;
  sha256?: string;
  byteSize?: number;
}

export interface InspectTurkeyParentProvenanceOptions {
  parentDataset: TerritoryDataset;
  catalog: TurkeyNationalSourceCatalog;
  hdxMemberPaths?: TurkeyParentHdxMemberPaths;
  verifiedHdxMembers?: Partial<Record<TurkeyV2AdmParentLevel, TurkeyParentVerifiedHdxMember>>;
  readGeoJsonFeatures?: (
    path: string
  ) => Promise<Array<{ properties: Record<string, unknown>; geometry: unknown }>>;
  requireFullParentInventory?: boolean;
}

export interface VerifyTurkeyParentProvenanceOptions {
  allowUndeclaredParentSource?: boolean;
  allowProvenanceMismatchBypass?: boolean;
  /** Development-only: do not treat partial ADM0–ADM2 inventory as blocking national build. */
  allowPartialParentInventory?: boolean;
  purpose?: "diagnostic" | "national-build" | "publish-ready" | "audit-report";
}

export interface TurkeyHdxCatalogMemberByteReport {
  status: TurkeyParentHdxMemberByteStatus;
  path?: string;
  sha256?: string;
  byteSize?: number;
  expectedSha256: string;
  expectedByteSize: number;
  archiveMember: string;
}

export interface VerifyTurkeyNationalCatalogHdxMemberBytesResult {
  verifiedHdxMembers: Partial<Record<TurkeyV2AdmParentLevel, TurkeyParentVerifiedHdxMember>>;
  members: Partial<Record<TurkeyV2AdmParentLevel, TurkeyHdxCatalogMemberByteReport>>;
}

const LEVEL_TO_NUMBER: Record<TurkeyV2AdmParentLevel, number> = {
  ADM0: 0,
  ADM1: 1,
  ADM2: 2
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
    let undeclaredZoneCount = 0;
    for (const zone of zones) {
      const provider = readSourceProvider(zone);
      if (!provider) {
        undeclaredZoneCount += 1;
        continue;
      }
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
      dominantProvider: dominant,
      undeclaredZoneCount
    };
  });
}

async function sha256FilePath(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export async function findHdxMemberInCacheRoot(
  cacheRoot: string,
  memberName: string
): Promise<string | null> {
  try {
    for (const entry of await readdir(cacheRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(cacheRoot, entry.name, memberName);
      try {
        await stat(candidate);
        return candidate;
      } catch {
        // continue
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function verifyTurkeyNationalCatalogHdxMemberBytes(
  catalog: TurkeyNationalSourceCatalog,
  memberPaths: Partial<TurkeyParentHdxMemberPaths>
): Promise<VerifyTurkeyNationalCatalogHdxMemberBytesResult> {
  const verifiedHdxMembers: Partial<Record<TurkeyV2AdmParentLevel, TurkeyParentVerifiedHdxMember>> =
    {};
  const members: Partial<Record<TurkeyV2AdmParentLevel, TurkeyHdxCatalogMemberByteReport>> = {};

  for (const level of TURKEY_V2_ADM_PARENT_LEVELS) {
    const meta = catalog.levels[level];
    if (!meta) {
      continue;
    }
    const localPath = memberPaths[level];
    if (!localPath) {
      members[level] = {
        status: "ARTIFACT_NOT_AVAILABLE",
        expectedSha256: meta.sha256,
        expectedByteSize: meta.byteSize,
        archiveMember: meta.archiveMember
      };
      verifiedHdxMembers[level] = { status: "ARTIFACT_NOT_AVAILABLE" };
      continue;
    }
    const sha256 = await sha256FilePath(localPath);
    const byteSize = (await stat(localPath)).size;
    const status: TurkeyParentHdxMemberByteStatus =
      sha256 === meta.sha256 && byteSize === meta.byteSize
        ? "LOCKED_BYTES_VERIFIED"
        : "CHECKSUM_MISMATCH";
    members[level] = {
      status,
      path: localPath,
      sha256,
      byteSize,
      expectedSha256: meta.sha256,
      expectedByteSize: meta.byteSize,
      archiveMember: meta.archiveMember
    };
    verifiedHdxMembers[level] = { status, sha256, byteSize };
  }

  return { verifiedHdxMembers, members };
}

function resolveParentInventoryStatus(
  dataset: TerritoryDataset,
  summaries: TurkeyParentProviderSummary[],
  requireFull: boolean
): TurkeyParentInventoryStatus {
  if (summaries.some((summary) => summary.zoneCount === 0)) {
    return "MISSING_LEVEL";
  }
  for (const level of TURKEY_V2_ADM_PARENT_LEVELS) {
    const zones = zonesForLevel(dataset, level);
    const ids = zones.map((zone) => zone.id);
    if (new Set(ids).size !== ids.length) {
      return "INCOMPLETE";
    }
  }
  const adm1Ids = new Set(zonesForLevel(dataset, "ADM1").map((zone) => zone.id));
  const adm0Ids = new Set(zonesForLevel(dataset, "ADM0").map((zone) => zone.id));
  for (const zone of zonesForLevel(dataset, "ADM2")) {
    if (!zone.parentId || !adm1Ids.has(zone.parentId)) {
      return "INCOMPLETE";
    }
  }
  for (const zone of zonesForLevel(dataset, "ADM1")) {
    if (zone.parentId && !adm0Ids.has(zone.parentId)) {
      return "INCOMPLETE";
    }
  }
  if (!requireFull) {
    return "COMPLETE";
  }
  for (const level of TURKEY_V2_ADM_PARENT_LEVELS) {
    const summary = summaries.find((row) => row.level === level);
    const expected = TURKEY_PARENT_INVENTORY_EXPECTED[level];
    if (!summary || summary.zoneCount !== expected) {
      return "INCOMPLETE";
    }
  }
  return "COMPLETE";
}

function resolveProviderMetadataStatus(input: {
  catalogProvider: string;
  summaries: TurkeyParentProviderSummary[];
  requireFull: boolean;
}): TurkeyParentProviderMetadataStatus {
  const totalZones = input.summaries.reduce((sum, row) => sum + row.zoneCount, 0);
  const undeclaredTotal = input.summaries.reduce((sum, row) => sum + row.undeclaredZoneCount, 0);
  const declared = input.summaries
    .flatMap((summary) => summary.providers)
    .filter((provider) => provider.length > 0);

  if (totalZones > 0 && undeclaredTotal === totalZones) {
    return "PARENT_SOURCE_UNDECLARED";
  }
  if (undeclaredTotal > 0) {
    return "PARENT_SOURCE_PARTIALLY_UNDECLARED";
  }
  const unique = [...new Set(declared)];
  if (unique.length > 1) {
    return "MIXED_PARENT_PROVIDERS";
  }
  if (unique.length === 0) {
    return "PARENT_SOURCE_UNDECLARED";
  }
  if (unique[0] !== input.catalogProvider) {
    return "CATALOG_LOCK_DIFFERS_FROM_PARENT_POLYGONS";
  }
  return "PROVIDER_METADATA_MATCHES_CATALOG";
}

function resolveSourceByteVerificationStatus(
  verified?: Partial<Record<TurkeyV2AdmParentLevel, TurkeyParentVerifiedHdxMember>>
): TurkeyParentSourceByteVerificationStatus {
  if (!verified || Object.keys(verified).length === 0) {
    return "NOT_RUN";
  }
  const levels = TURKEY_V2_ADM_PARENT_LEVELS.map((level) => verified[level]);
  if (levels.some((entry) => entry?.status === "CHECKSUM_MISMATCH")) {
    return "CHECKSUM_MISMATCH";
  }
  const verifiedCount = levels.filter((entry) => entry?.status === "LOCKED_BYTES_VERIFIED").length;
  if (verifiedCount === 0) {
    return "ARTIFACT_UNAVAILABLE";
  }
  if (verifiedCount === TURKEY_V2_ADM_PARENT_LEVELS.length) {
    return "ALL_LOCKED_MEMBERS_VERIFIED";
  }
  return "PARTIAL_MEMBERS_VERIFIED";
}

function provinceCodeToAdm1Pcode(provinceCode: string): string {
  const digits = provinceCode.replace(/\D/g, "");
  return `TUR${digits.padStart(3, "0")}`;
}

function readCanonicalAdm1Pcode(zone: TerritoryZone): string | null {
  const territory = readTerritory(zone);
  const codes = territory.codes;
  if (codes && typeof codes === "object") {
    const official = (codes as Record<string, unknown>).official;
    if (typeof official === "string" && /^TR-\d{1,2}$/i.test(official)) {
      return provinceCodeToAdm1Pcode(official.slice(3));
    }
  }
  if (typeof territory.provinceCode === "string") {
    return provinceCodeToAdm1Pcode(territory.provinceCode);
  }
  return null;
}

function readHdxString(properties: Record<string, unknown>, key: string): string | null {
  const value = properties[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function buildHdxFeatureIndex(
  level: TurkeyV2AdmParentLevel,
  features: Array<{ properties: Record<string, unknown>; geometry: unknown }>
): {
  byNativeId: Map<string, { properties: Record<string, unknown>; geometry: unknown }>;
  byProvinceScopedName: Map<string, { properties: Record<string, unknown>; geometry: unknown }>;
  byName: Map<string, { properties: Record<string, unknown>; geometry: unknown }>;
} {
  const byNativeId = new Map<string, { properties: Record<string, unknown>; geometry: unknown }>();
  const byProvinceScopedName = new Map<
    string,
    { properties: Record<string, unknown>; geometry: unknown }
  >();
  const byName = new Map<string, { properties: Record<string, unknown>; geometry: unknown }>();

  for (const feature of features) {
    const props = feature.properties;
    if (level === "ADM0") {
      const pcode = readHdxString(props, "adm0_pcode");
      if (pcode) byNativeId.set(pcode, feature);
      continue;
    }
    if (level === "ADM1") {
      const pcode = readHdxString(props, "adm1_pcode");
      if (pcode) byNativeId.set(pcode, feature);
      const name = readHdxString(props, "adm1_name1") ?? readHdxString(props, "adm1_name");
      if (name) byName.set(normalizeAdminName(name), feature);
      continue;
    }
    const adm2 = readHdxString(props, "adm2_pcode");
    const adm1 = readHdxString(props, "adm1_pcode");
    if (adm1 && adm2) byNativeId.set(`${adm1}|${adm2}`, feature);
    const name = readHdxString(props, "adm2_name1") ?? readHdxString(props, "adm2_name");
    if (adm1 && name) {
      byProvinceScopedName.set(`${adm1}|${normalizeAdminName(name)}`, feature);
    }
    if (name) byName.set(normalizeAdminName(name), feature);
  }

  return { byNativeId, byProvinceScopedName, byName };
}

function resolveParentMatchKey(
  level: TurkeyV2AdmParentLevel,
  zone: TerritoryZone,
  adm1ById: Map<string, TerritoryZone>
): { key: string; method: TurkeyParentHdxGeometryComparison["identityMatchMethod"] } | null {
  if (level === "ADM0") {
    return { key: "TUR", method: "native-admin-id" };
  }
  if (level === "ADM1") {
    const pcode = readCanonicalAdm1Pcode(zone);
    if (pcode) return { key: pcode, method: "native-admin-id" };
    const name = normalizeAdminName(zone.name ?? "");
    return name ? { key: name, method: "name-only" } : null;
  }
  const parent = zone.parentId ? adm1ById.get(zone.parentId) : undefined;
  const adm1Pcode = parent ? readCanonicalAdm1Pcode(parent) : null;
  const name = normalizeAdminName(zone.name ?? "");
  if (adm1Pcode && name) {
    return { key: `${adm1Pcode}|${name}`, method: "province-scoped-name" };
  }
  return name ? { key: name, method: "name-only" } : null;
}

function lookupHdxFeature(
  level: TurkeyV2AdmParentLevel,
  matchKey: string,
  method: TurkeyParentHdxGeometryComparison["identityMatchMethod"],
  indexes: ReturnType<typeof buildHdxFeatureIndex>
): { properties: Record<string, unknown>; geometry: unknown } | undefined {
  if (method === "native-admin-id") {
    return indexes.byNativeId.get(matchKey);
  }
  if (method === "province-scoped-name") {
    return (
      indexes.byProvinceScopedName.get(matchKey) ?? indexes.byName.get(matchKey.split("|")[1] ?? "")
    );
  }
  return indexes.byName.get(matchKey);
}

export async function inspectTurkeyParentProvenance(
  options: InspectTurkeyParentProvenanceOptions
): Promise<TurkeyParentProvenanceInspection> {
  const requireFull =
    options.requireFullParentInventory ??
    zonesForLevel(options.parentDataset, "ADM2").length === TURKEY_PARENT_INVENTORY_EXPECTED.ADM2;

  const providerSummary = summarizeProviders(options.parentDataset);
  const parentInventoryStatus = resolveParentInventoryStatus(
    options.parentDataset,
    providerSummary,
    requireFull
  );
  const providerMetadataStatus = resolveProviderMetadataStatus({
    catalogProvider: options.catalog.provider,
    summaries: providerSummary,
    requireFull
  });
  const sourceByteVerificationStatus = resolveSourceByteVerificationStatus(
    options.verifiedHdxMembers
  );

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
  let serializedGeometryStatus: TurkeyParentSerializedGeometryStatus = "NOT_RUN";

  const adm1ById = new Map(
    zonesForLevel(options.parentDataset, "ADM1").map((zone) => [zone.id, zone])
  );

  if (options.hdxMemberPaths && options.readGeoJsonFeatures) {
    if (parentInventoryStatus !== "COMPLETE" && requireFull) {
      serializedGeometryStatus = "INVENTORY_INCOMPLETE";
    } else {
      let comparedAny = false;
      let allMatched = true;
      let insufficient = false;

      for (const level of TURKEY_V2_ADM_PARENT_LEVELS) {
        const catalogLevel = options.catalog.levels[level];
        const memberPath = options.hdxMemberPaths[level];
        if (!catalogLevel || !memberPath) {
          insufficient = true;
          continue;
        }
        let hdxFeatures: Array<{ properties: Record<string, unknown>; geometry: unknown }>;
        try {
          hdxFeatures = await options.readGeoJsonFeatures(memberPath);
        } catch {
          insufficient = true;
          continue;
        }
        const indexes = buildHdxFeatureIndex(level, hdxFeatures);
        const parentZones = zonesForLevel(options.parentDataset, level);
        let identityMatchedPairs = 0;
        let exactSerializedGeometryHashMatches = 0;
        let serializedGeometryHashMismatches = 0;
        let unmatchedParentZones = 0;
        const sampleSerializedMismatches: TurkeyParentHdxGeometryComparison["sampleSerializedMismatches"] =
          [];
        const matchedHdxKeys = new Set<string>();
        let matchMethod: TurkeyParentHdxGeometryComparison["identityMatchMethod"] =
          "not-applicable";

        for (const zone of parentZones) {
          const resolved = resolveParentMatchKey(level, zone, adm1ById);
          if (!resolved) {
            unmatchedParentZones += 1;
            continue;
          }
          matchMethod = resolved.method;
          let feature = lookupHdxFeature(level, resolved.key, resolved.method, indexes);
          if (!feature && level === "ADM1") {
            const fallbackName = normalizeAdminName(zone.name ?? "");
            feature = fallbackName ? indexes.byName.get(fallbackName) : undefined;
            if (feature) matchMethod = "name-only";
          }
          if (!feature) {
            unmatchedParentZones += 1;
            continue;
          }
          matchedHdxKeys.add(resolved.key);
          identityMatchedPairs += 1;
          const parentHash = auditGeometryHash(zone.geometry);
          const hdxHash = auditGeometryHash(feature.geometry);
          if (parentHash === hdxHash) {
            exactSerializedGeometryHashMatches += 1;
          } else {
            serializedGeometryHashMismatches += 1;
            allMatched = false;
            if (sampleSerializedMismatches.length < 5) {
              sampleSerializedMismatches.push({
                matchKey: resolved.key,
                parentHash,
                hdxHash
              });
            }
          }
        }

        const unmatchedHdxFeatures = hdxFeatures.length - matchedHdxKeys.size;
        geometryComparisons.push({
          level,
          catalogMemberSha256: catalogLevel.sha256,
          hdxFeatureCount: hdxFeatures.length,
          parentZoneCount: parentZones.length,
          identityMatchMethod: matchMethod,
          identityMatchedPairs,
          exactSerializedGeometryHashMatches,
          serializedGeometryHashMismatches,
          unmatchedParentZones,
          unmatchedHdxFeatures,
          serializedGeometryHashMethod: "sha256-json-stringify-geometry",
          geographicEquivalenceStatus: "NOT_ASSESSED",
          sampleSerializedMismatches
        });
        comparedAny = true;
        if (unmatchedParentZones > 0 || unmatchedHdxFeatures > 0) {
          allMatched = false;
        }
      }

      serializedGeometryStatus =
        insufficient && !comparedAny
          ? "INSUFFICIENT_EVIDENCE"
          : parentInventoryStatus !== "COMPLETE" && requireFull
            ? "INVENTORY_INCOMPLETE"
            : allMatched && comparedAny
              ? "ALL_SERIALIZED_HASHES_MATCH"
              : "COMPARED";
    }
  }

  let classification: TurkeyParentLineageClassification = "BLOCKED_BY_MISSING_EVIDENCE";
  let summary = "Parent provenance could not be fully classified.";

  if (providerMetadataStatus === "CATALOG_LOCK_DIFFERS_FROM_PARENT_POLYGONS") {
    classification = "CONFIRMED_ROOT_CAUSE";
    summary =
      "National catalog/source-lock provider metadata does not match parent polygon zone providers (e.g. geoBoundaries vs HDX).";
  } else if (providerMetadataStatus === "MIXED_PARENT_PROVIDERS") {
    classification = "CONFIRMED_ROOT_CAUSE";
    summary = "Parent ADM0–ADM2 zones declare multiple source providers.";
  } else if (
    providerMetadataStatus === "PARENT_SOURCE_UNDECLARED" ||
    providerMetadataStatus === "PARENT_SOURCE_PARTIALLY_UNDECLARED"
  ) {
    classification = "BLOCKED_BY_MISSING_EVIDENCE";
    summary = "Parent polygon zones lack complete source-provider metadata.";
  } else if (providerMetadataStatus === "PROVIDER_METADATA_MATCHES_CATALOG") {
    if (sourceByteVerificationStatus === "ALL_LOCKED_MEMBERS_VERIFIED") {
      classification =
        serializedGeometryStatus === "ALL_SERIALIZED_HASHES_MATCH"
          ? "PARTIALLY_VERIFIED"
          : "PARTIALLY_VERIFIED";
      summary =
        serializedGeometryStatus === "ALL_SERIALIZED_HASHES_MATCH"
          ? "Provider metadata and locked HDX member bytes align; serialized geometry hashes match (geographic equivalence not assessed)."
          : "Provider metadata and locked HDX member bytes align; serialized geometry hashes differ (not a geographic boundary proof).";
    } else {
      classification = "BLOCKED_BY_MISSING_EVIDENCE";
      summary =
        "Provider metadata matches the catalog lock, but locked HDX member bytes were not independently verified for this inspection.";
    }
  }

  return {
    schemaVersion: TURKEY_PARENT_PROVENANCE_SCHEMA_VERSION,
    parentDatasetVersion:
      typeof options.parentDataset.manifest?.datasetVersion === "string"
        ? options.parentDataset.manifest.datasetVersion
        : null,
    parentInventoryStatus,
    providerSummary,
    catalogProvider: options.catalog.provider,
    observedDominantProvider,
    providerMetadataStatus,
    lineageStatus: providerMetadataStatus,
    sourceByteVerificationStatus,
    serializedGeometryStatus,
    catalogGeometryStatus: serializedGeometryStatus,
    geometryComparisons,
    geoBoundariesUpstreamBytesVerified: false,
    classification,
    summary
  };
}

export function verifyTurkeyParentProvenance(
  inspection: TurkeyParentProvenanceInspection,
  options: VerifyTurkeyParentProvenanceOptions = {}
): TurkeyParentProvenanceVerification {
  const purpose = options.purpose ?? "national-build";
  const issues: TurkeyParentProvenanceIssue[] = [];

  if (inspection.providerMetadataStatus === "CATALOG_LOCK_DIFFERS_FROM_PARENT_POLYGONS") {
    if (!options.allowProvenanceMismatchBypass || purpose === "publish-ready") {
      issues.push({
        code: "PARENT_PROVENANCE_PROVIDER_MISMATCH",
        severity: "error",
        message:
          "ADM0–ADM2 parent dataset source provider does not match the national catalog/source-lock provider.",
        expected: inspection.catalogProvider,
        actual: inspection.observedDominantProvider ?? "unknown"
      });
    }
  }

  if (inspection.providerMetadataStatus === "MIXED_PARENT_PROVIDERS") {
    issues.push({
      code: "PARENT_PROVENANCE_MIXED_PROVIDERS",
      severity: "error",
      message: "ADM0–ADM2 parent dataset declares multiple source providers across zones."
    });
  }

  if (inspection.providerMetadataStatus === "PARENT_SOURCE_UNDECLARED") {
    if (!options.allowUndeclaredParentSource) {
      issues.push({
        code: "PARENT_PROVENANCE_UNDECLARED",
        severity: "error",
        message:
          "ADM0–ADM2 parent dataset zones do not declare a source provider; catalog lock cannot be treated as polygon-backed evidence."
      });
    }
  }

  if (inspection.providerMetadataStatus === "PARENT_SOURCE_PARTIALLY_UNDECLARED") {
    if (!options.allowUndeclaredParentSource) {
      issues.push({
        code: "PARENT_PROVENANCE_PARTIALLY_UNDECLARED",
        severity: "error",
        message: "Some ADM0–ADM2 parent zones omit source provider metadata."
      });
    }
  }

  if (inspection.parentInventoryStatus !== "COMPLETE") {
    if (
      (purpose === "national-build" || purpose === "publish-ready" || purpose === "audit-report") &&
      !options.allowPartialParentInventory
    ) {
      issues.push({
        code: "PARENT_PROVENANCE_INVENTORY_INCOMPLETE",
        severity: purpose === "audit-report" ? "warning" : "error",
        message: `Parent inventory status is ${inspection.parentInventoryStatus}; expected ADM0=${TURKEY_PARENT_INVENTORY_EXPECTED.ADM0}, ADM1=${TURKEY_PARENT_INVENTORY_EXPECTED.ADM1}, ADM2=${TURKEY_PARENT_INVENTORY_EXPECTED.ADM2} for national scope.`
      });
    }
  }

  if (inspection.providerMetadataStatus === "PROVIDER_METADATA_MATCHES_CATALOG") {
    if (inspection.sourceByteVerificationStatus !== "ALL_LOCKED_MEMBERS_VERIFIED") {
      issues.push({
        code: "PARENT_PROVENANCE_SOURCE_BYTES_UNVERIFIED",
        severity: "error",
        message:
          "Provider metadata matches the catalog, but locked HDX member SHA-256 evidence was not fully verified for this build."
      });
    }
  }

  if (inspection.sourceByteVerificationStatus === "CHECKSUM_MISMATCH") {
    issues.push({
      code: "PARENT_PROVENANCE_MEMBER_CHECKSUM_MISMATCH",
      severity: "error",
      message: "At least one HDX catalog member failed SHA-256 or byte-size verification."
    });
  }

  if (
    inspection.serializedGeometryStatus === "COMPARED" &&
    inspection.providerMetadataStatus === "PROVIDER_METADATA_MATCHES_CATALOG" &&
    inspection.sourceByteVerificationStatus === "ALL_LOCKED_MEMBERS_VERIFIED"
  ) {
    issues.push({
      code: "PARENT_PROVENANCE_SERIALIZED_GEOMETRY_DIFFERS",
      severity: "warning",
      message:
        "Serialized geometry hashes differ between verified HDX members and parent polygons; geographic boundary change was not assessed."
    });
  }

  if (purpose === "publish-ready" && options.allowProvenanceMismatchBypass) {
    issues.push({
      code: "PARENT_PROVENANCE_PUBLISH_BYPASS_FORBIDDEN",
      severity: "error",
      message: "Publish-ready builds cannot use --allow-parent-provenance-mismatch."
    });
  }

  const authorizedForNationalBuild = computeAuthorizedForNationalBuild(inspection, issues, options);
  const authorizedForPublishReady = computeAuthorizedForPublishReady(inspection, issues, options);

  if (purpose === "publish-ready" && !authorizedForPublishReady) {
    const hasOtherPublishBlockingError = issues.some(
      (issue) =>
        issue.severity === "error" &&
        issue.code !== "PARENT_PROVENANCE_PUBLISH_LINEAGE_INSUFFICIENT"
    );
    if (!hasOtherPublishBlockingError) {
      issues.push({
        code: "PARENT_PROVENANCE_PUBLISH_LINEAGE_INSUFFICIENT",
        severity: "error",
        message:
          "Publish-ready builds require verified parent lineage: matching provider metadata, all locked HDX member bytes, complete national inventory, and exact serialized geometry agreement between verified members and parent polygons."
      });
    }
  }

  const ok =
    purpose === "diagnostic"
      ? issues.every((issue) => issue.severity !== "error")
      : purpose === "publish-ready"
        ? authorizedForPublishReady
        : authorizedForNationalBuild;

  return {
    ok,
    authorizedForNationalBuild,
    authorizedForPublishReady,
    inspection,
    issues
  };
}

function computeAuthorizedForNationalBuild(
  inspection: TurkeyParentProvenanceInspection,
  issues: TurkeyParentProvenanceIssue[],
  options: VerifyTurkeyParentProvenanceOptions
): boolean {
  if (purposeBlocksNationalBuild(options)) {
    return false;
  }

  const blockingErrors = issues.filter((issue) => {
    if (issue.severity !== "error") {
      return false;
    }
    if (
      issue.code === "PARENT_PROVENANCE_PROVIDER_MISMATCH" &&
      options.allowProvenanceMismatchBypass
    ) {
      return false;
    }
    if (
      issue.code === "PARENT_PROVENANCE_INVENTORY_INCOMPLETE" &&
      options.allowPartialParentInventory
    ) {
      return false;
    }
    if (issue.code === "PARENT_PROVENANCE_PUBLISH_LINEAGE_INSUFFICIENT") {
      return false;
    }
    return true;
  });
  if (blockingErrors.length > 0) {
    return false;
  }

  if (inspection.providerMetadataStatus === "CATALOG_LOCK_DIFFERS_FROM_PARENT_POLYGONS") {
    return options.allowProvenanceMismatchBypass === true;
  }

  if (inspection.providerMetadataStatus === "PROVIDER_METADATA_MATCHES_CATALOG") {
    if (inspection.sourceByteVerificationStatus !== "ALL_LOCKED_MEMBERS_VERIFIED") {
      return false;
    }
  }

  if (!options.allowPartialParentInventory && inspection.parentInventoryStatus !== "COMPLETE") {
    return false;
  }

  return true;
}

function computeAuthorizedForPublishReady(
  inspection: TurkeyParentProvenanceInspection,
  issues: TurkeyParentProvenanceIssue[],
  options: VerifyTurkeyParentProvenanceOptions
): boolean {
  if (options.allowProvenanceMismatchBypass) {
    return false;
  }
  if (issues.some((issue) => issue.severity === "error")) {
    return false;
  }
  if (inspection.parentInventoryStatus !== "COMPLETE") {
    return false;
  }
  if (inspection.providerMetadataStatus !== "PROVIDER_METADATA_MATCHES_CATALOG") {
    return false;
  }
  if (inspection.sourceByteVerificationStatus !== "ALL_LOCKED_MEMBERS_VERIFIED") {
    return false;
  }
  if (inspection.serializedGeometryStatus !== "ALL_SERIALIZED_HASHES_MATCH") {
    return false;
  }
  return true;
}

function purposeBlocksNationalBuild(options: VerifyTurkeyParentProvenanceOptions): boolean {
  return options.purpose === "publish-ready" && options.allowProvenanceMismatchBypass === true;
}

export function createTurkeyParentInputDatasetLock(
  inspection: TurkeyParentProvenanceInspection,
  options: { provenanceAuthorizationBypass?: string } = {}
): {
  catalogProvider: string;
  observedDominantProvider: string | null;
  providerMetadataStatus: TurkeyParentProviderMetadataStatus;
  sourceByteVerificationStatus: TurkeyParentSourceByteVerificationStatus;
  serializedGeometryStatus: TurkeyParentSerializedGeometryStatus;
  parentInventoryStatus: TurkeyParentInventoryStatus;
  zoneCounts: Record<TurkeyV2AdmParentLevel, number>;
  classification: TurkeyParentLineageClassification;
  geoBoundariesUpstreamBytesVerified: false;
  provenanceAuthorizationBypass?: string;
} {
  const zoneCounts = {
    ADM0: inspection.providerSummary.find((summary) => summary.level === "ADM0")?.zoneCount ?? 0,
    ADM1: inspection.providerSummary.find((summary) => summary.level === "ADM1")?.zoneCount ?? 0,
    ADM2: inspection.providerSummary.find((summary) => summary.level === "ADM2")?.zoneCount ?? 0
  } satisfies Record<TurkeyV2AdmParentLevel, number>;

  return {
    catalogProvider: inspection.catalogProvider,
    observedDominantProvider: inspection.observedDominantProvider,
    providerMetadataStatus: inspection.providerMetadataStatus,
    sourceByteVerificationStatus: inspection.sourceByteVerificationStatus,
    serializedGeometryStatus: inspection.serializedGeometryStatus,
    parentInventoryStatus: inspection.parentInventoryStatus,
    zoneCounts,
    classification: inspection.classification,
    geoBoundariesUpstreamBytesVerified: false,
    ...(options.provenanceAuthorizationBypass
      ? { provenanceAuthorizationBypass: options.provenanceAuthorizationBypass }
      : {})
  };
}

export function computeTurkeyNationalCatalogContentHash(
  catalog: TurkeyNationalSourceCatalog
): string {
  return createHash("sha256").update(serializeJsonStable(catalog)).digest("hex");
}
